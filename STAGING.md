# Staging environment (DevSecOps Phase 4)

A throwaway, fully **isolated** clone of the API used as the *only* place active
security testing (DAST, fuzzing, injection payloads) is allowed to run. Production
(`*.dzbarbers.com`) stays **passive-checks-only** per the rules of engagement in
[`SECURITY.md`](SECURITY.md). This file documents how staging is stood up and why
it is built the way it is.

## Why staging is isolated (the point of the whole phase)

Active testing deliberately does hostile things: floods rate limiters, submits
malformed and oversized bodies, tries injection strings, forges tokens, hammers
the login endpoint. Doing that against production would (a) create garbage rows in
real tenants' data, (b) trip our own rate limiters against paying customers, and
(c) generate traffic patterns that can violate the host's (Railway's) Acceptable
Use Policy, because we own the *app* but not the *infrastructure*. Staging exists
so every one of those actions lands somewhere that **cannot reach production data,
production infrastructure, or production's usage budget**.

Isolation here means four separate things, each closing a different leak path:

| Isolation axis | What it prevents |
| --- | --- |
| **Separate Railway project** (own Postgres + Redis *instances*) | An attack that corrupts or deletes data, or exhausts a connection pool, touches only throwaway data. No shared plugin, no shared pool. |
| **Distinct secrets** (`SESSION_SECRET`, `JWT_SECRET`, `PHONE_HMAC_SECRET`) | A secret we *deliberately try to leak* on staging is worthless against prod. A JWT forged with staging's `JWT_SECRET` fails `jwt.verify` on prod; a staging session cookie is not portable. |
| **Junk tenant data** (fake shops, owners, barbers, bookings) | No real customer PII is ever in the blast radius. If a finding proves we *can* read another tenant's data, the data read is fake. |
| **Config-identical otherwise** (`NODE_ENV=production`, `TRUST_PROXY_HOPS=1`, helmet, rate limits all ON) | Findings actually transfer to prod. Staging must mirror prod's *security posture* exactly — only data, secrets, and infra differ. A staging that runs in dev mode would test the wrong app. |

The one thing we deliberately **do not** copy from prod is the custom domain — see
"URL & the cookie gotcha" below.

## Topology (minimal, cost-smart)

Three services in **one dedicated Railway project** (`barber-staging`), separate from
the production project:

| Service | Source | Purpose |
| --- | --- | --- |
| API + WebSocket | `apps/api/Dockerfile` | the entire attack surface for our catalog |
| Postgres | Railway PostgreSQL plugin | throwaway DB, own instance |
| Redis | Railway Redis plugin | rate-limit + session store, own instance |

**The two frontends are intentionally not deployed to staging.** The Phase 5 catalog
(cross-tenant isolation, barber-own-bookings, dual-auth, rate-limit / honeypot /
idempotency / double-booking, Zod / 64 KB limits, SQLi, WS origin) is *entirely* the
API. ZAP's baseline and active scans both target the API URL directly. Skipping the
SPAs saves two services' worth of cost and removes nothing we need to test.

## URL & the cookie gotcha

Staging uses the **free `*.up.railway.app` URL** Railway assigns the API service
(e.g. `barber-api-staging.up.railway.app`). No custom domain, no DNS record, no Hobby
domain quota consumed.

`*.up.railway.app` is on the **Public Suffix List**, so a browser refuses any cookie
scoped `Domain=.up.railway.app` — that is the Phase 3 gotcha. It does **not** affect
staging, because:

- We **do not set `COOKIE_DOMAIN`** on staging. The owner `sid` cookie is then
  *host-only* (bound to the API's exact railway hostname). curl and ZAP store and
  replay host-only cookies against that host perfectly — the public-suffix rule only
  bites *cross-subdomain browser* cookie sharing, which the pentest never needs.
- Tenant selection uses the **`X-Shop-Slug` header** (the tenant resolver honours it
  above the Host subdomain), so every request picks its shop explicitly. We hit the
  API host directly and name the tenant in a header — no per-shop subdomain required.

Net: owner-session, barber-JWT, and public flows are all fully testable on the bare
railway URL with tool-driven clients. (If a browser-driven session test is ever wanted,
that is the only thing needing a real attached subdomain — out of scope for DAST.)

## Environment variables (staging API service)

Identical shape to prod (see `DEPLOY.md`), with **isolation-critical differences bolded**:

- `NODE_ENV=production`  ← mirror prod posture (Secure cookies, etc.)
- `DATABASE_URL`, `REDIS_URL` — from the **staging** Railway plugins (never prod's)
- **`SESSION_SECRET`, `JWT_SECRET`, `PHONE_HMAC_SECRET`** — freshly generated, ≥32 chars, **never reused from prod**
- `ALLOWED_ORIGIN_PATTERN=https://*.up.railway.app` — gives the CORS + WS origin guard a real allow/deny boundary to test
- **`COOKIE_DOMAIN` — leave UNSET** (host-only cookie; see gotcha above)
- `TRUST_PROXY_HOPS=1` — Railway edge = exactly one hop (mirror prod, or the X-Forwarded-For test lies)
- Do **not** set `PORT` — Railway injects it.
- `RESEND_API_KEY` — **leave unset** on staging (no real emails; password-reset / notification endpoints return 503, which is the correct staging behaviour and itself a testable path).

Secrets are generated per-environment and delivered out-of-band (chat / password
manager) — **never committed**. This file only names them.

## Click-by-click: standing it up

> You drive the Railway dashboard; each step says exactly what to click and what to
> type. Stop at the checkpoints and hand back the two values requested.

1. **New project.** Railway dashboard → **New Project** → **Empty Project**. Name it
   `barber-staging`. (A separate *project*, not a new environment inside the prod
   project — separate projects get separate plugin instances and separate usage,
   which is the isolation we want.)
2. **Add Postgres.** Inside the project → **New** → **Database** → **Add PostgreSQL**.
3. **Add Redis.** **New** → **Database** → **Add Redis**.
4. **Add the API service.** **New** → **GitHub Repo** → select this repo → branch
   `main`. When it asks about the build, we set the Dockerfile next.
5. **Point it at the API Dockerfile.** Open the new service → **Settings** →
   **Build** → set **Dockerfile Path** / add variable
   `RAILWAY_DOCKERFILE_PATH=apps/api/Dockerfile` (build context is the repo root).
6. **Wire the DB/Redis references.** Service → **Variables** → **New Variable** →
   use the **Reference** picker to add `DATABASE_URL` = the staging Postgres's
   connection string and `REDIS_URL` = the staging Redis's. (Reference the *staging*
   plugins created in steps 2–3 — this is where a copy-paste from prod would break
   isolation; use the reference picker, don't paste a URL.)
7. **Add the remaining variables** (from the out-of-band secrets block): `NODE_ENV`,
   `SESSION_SECRET`, `JWT_SECRET`, `PHONE_HMAC_SECRET`, `ALLOWED_ORIGIN_PATTERN`,
   `TRUST_PROXY_HOPS`. Leave `COOKIE_DOMAIN` and `RESEND_API_KEY` unset.
8. **Pre-deploy (release) command.** Service → **Settings** → **Deploy** →
   **Pre-Deploy Command**: `npm run migrate:up` (applies all migrations to the fresh
   staging DB before the version serves traffic). **No `-w apps/api` flag** — the
   container's working dir is already `/repo/apps/api`, so the workspace flag would
   fail resolution (this matches how prod is actually configured; DEPLOY.md's
   `-w apps/api` form assumes the repo root as cwd). This step reads only
   `DATABASE_URL`; if it fails in seconds, check that `DATABASE_URL` is referenced
   on the service (step 6).
9. **Health check.** Same Deploy section → **Healthcheck Path**: `/health`.
10. **Generate a public URL.** Service → **Settings** → **Networking** →
    **Generate Domain**. Railway gives a `*.up.railway.app` URL. **← hand this back.**
11. **Enable the Postgres TCP proxy.** Open the Postgres service → **Settings** →
    **Networking** → **TCP Proxy** (enable public proxy). This yields a public
    `DATABASE_URL` (host:port) I use to seed junk data and query UUIDs from local.
    **← hand this back too** (treat it like a password).
12. **Deploy** and wait for green + the health check to pass.

**Checkpoint — hand back:** (a) the API's public `https://…up.railway.app` URL, and
(b) the Postgres TCP-proxy `DATABASE_URL`. With those I run `seed:admin`, load the
junk-tenant seed, then execute Phase 5. **Disable the TCP proxy again** once seeding
and the pentest are done.

## Seeding junk tenant data

After migrations run (step 8) and the admin is seeded
(`ADMIN_EMAIL=… ADMIN_PASSWORD=… npm run seed:admin -w apps/api` against the proxy
`DATABASE_URL`), the junk seed loads **two active shops + one inactive shop**:

- **`alpha-cuts`** (active) — owner A, barbers **A1** and **A2** (two barbers in one
  shop lets us test *barber-vs-barber* isolation, not just cross-tenant), services,
  hours, and a booking per barber.
- **`beta-cuts`** (active) — owner B, barber B1, services, hours, one booking. The
  *other tenant* for cross-tenant isolation tests.
- **`ghost-cuts`** (inactive) — for negative tenant-resolution tests (404).

The seed SQL and all seed credentials are kept out-of-band (local only), because they
contain login passwords — same policy as the secrets.

## Teardown

`docker`-free: delete the `barber-staging` project in the Railway dashboard when the
assessment is done, or leave it stopped. Nothing in staging is load-bearing. Always
**re-disable the Postgres TCP proxy** after seeding/pentest even if the project stays.
