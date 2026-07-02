# Deploying (Railway-only, multi-shop, wildcard subdomains)

Everything runs on **Railway**: the API, both static frontends, Postgres, and Redis.
One provider owns the domain's DNS — no split across hosts.

One `apps/web` build serves **every** shop — the shop is resolved at runtime from the
hostname (`slug.<domain>`). Creating a shop in the admin app makes it live instantly
(wildcard DNS already covers it; no per-shop build or config).

> The API is a long-lived Express + **WebSocket** server with a stateful `pg` pool and
> in-memory WS rooms. It **cannot run on Vercel/serverless** — it needs an always-on
> container, which is why everything sits on Railway. The two frontends are plain static
> `dist/` folders served by Caddy, so hosting them on Railway too costs nothing extra and
> keeps DNS in one place.

## Topology (all on Railway)

| Service        | Source                          | Domain                      |
| -------------- | ------------------------------- | --------------------------- |
| API + WebSocket| `apps/api/Dockerfile`           | `api.<domain>`              |
| Customer+staff | `apps/web/Dockerfile` (Caddy)   | `*.<domain>` (wildcard)     |
| Platform admin | `apps/web-admin/Dockerfile` (Caddy) | `admin.<domain>`        |
| Postgres       | Railway PostgreSQL plugin       | — (private)                 |
| Redis          | Railway Redis plugin            | — (private)                 |

All five live in **one Railway project**. Every service builds from the **repo root** as
its build context (the Dockerfiles `COPY . .` and `npm ci` at root for the npm workspaces);
point each service at its Dockerfile via `RAILWAY_DOCKERFILE_PATH`.

## 1. API service (`apps/api/Dockerfile`)

- New service → Deploy from this GitHub repo, branch `main`.
- **Dockerfile path**: `RAILWAY_DOCKERFILE_PATH=apps/api/Dockerfile` (build context = repo root).
- Add the **PostgreSQL** + **Redis** plugins to the project; reference their connection
  strings as `DATABASE_URL` / `REDIS_URL` on this service.
- **Release / pre-deploy command** (runs migrations before the new version serves traffic):
  `npm run migrate:up -w apps/api`  (uses `DATABASE_URL`)
- **Seed the first platform admin** (one-off, AFTER the first migrate — a fresh prod DB
  has zero admins, so nobody could log into the admin app otherwise):
  `ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='a-strong-password' npm run seed:admin -w apps/api`
  (idempotent — re-running with the same email just resets the password)
- **Start**: the image's `CMD` → `node dist/server.js`
- **Health check path**: `/health`
- Env vars:
  - `NODE_ENV=production`
  - `DATABASE_URL`, `REDIS_URL` (from the Railway plugins)
  - `SESSION_SECRET`, `JWT_SECRET`, `PHONE_HMAC_SECRET` — each ≥ 32 chars
  - `ALLOWED_ORIGIN_PATTERN=https://*.<domain>`
  - `COOKIE_DOMAIN=.<domain>`  ← required so the session cookie set by
    `api.<domain>` is sent on `*.<domain>` requests
  - `TRUST_PROXY_HOPS=1` (Railway puts one proxy in front — exact hop count, never `true`)
  - Do **not** set `PORT` — Railway injects it; the server binds `0.0.0.0:$PORT`.
- Add **custom domain** `api.<domain>`.

## 2. Frontends — two static Railway services

Each frontend is built by its Dockerfile and served by Caddy (SPA history fallback +
hashed-asset caching baked into the `Caddyfile`). Caddy listens on `$PORT`; Railway
terminates TLS at its edge.

- **`apps/web`**: new service → `RAILWAY_DOCKERFILE_PATH=apps/web/Dockerfile`.
  - Variable `VITE_API_BASE=https://api.<domain>` (inlined at **build** time — set it
    before the first deploy; changing it later requires a rebuild).
  - Custom domain: **`*.<domain>`** (wildcard — Railway issues wildcard TLS).
- **`apps/web-admin`**: new service → `RAILWAY_DOCKERFILE_PATH=apps/web-admin/Dockerfile`.
  - Variable `VITE_API_BASE=https://api.<domain>`.
  - Custom domain: `admin.<domain>`.

## 3. DNS (at your registrar)

Add the CNAME targets Railway shows for each custom domain:

- `api.<domain>`   → API service
- `*.<domain>`     → `apps/web` service (covers every shop slug)
- `admin.<domain>` → `apps/web-admin` service — add explicitly; a specific record beats
  the wildcard.

Manage DNS at the registrar directly (no nameserver change needed). Do **not** proxy the
Railway CNAME targets through a CDN.

## Cookies / CORS (already wired)

`api.<domain>` and `<slug>.<domain>` share the registrable domain, so with
`COOKIE_DOMAIN=.<domain>` the owner session cookie flows across subdomains. CORS already
accepts any `https://<slug>.<domain>` origin with credentials (`ALLOWED_ORIGIN_PATTERN`).
`sameSite: 'strict'` is kept (these are same-site requests).

## Verification (post-deploy, end-to-end)

1. `https://api.<domain>/health` → `{"status":"ok"}`.
2. Log into `admin.<domain>` (seeded admin) → **create a shop** with a slug + name.
3. Open `https://<that-slug>.<domain>` → its booking page renders (no rebuild needed).
4. In `<that-slug>.<domain>/business` (owner) add a barber + service + hours, then **book
   as a customer**; confirm it shows for the owner and streams live (`wss://api.<domain>`)
   to a barber session.
5. `https://<random-unknown>.<domain>` → ShopNotFound page.

## Watch-items

- **Wildcard TLS uses DNS-01** — it can take minutes-to-hours to issue/propagate, and
  `*.<domain>` matches only ONE label (`shop.<domain>`, not `a.b.<domain>`). Add `api.`
  and `admin.` as their own records.
- **WS proxying**: the frontend must use `wss://api.<domain>` (not `ws://`); `TRUST_PROXY_HOPS=1`.
- **`VITE_API_BASE` is build-time** — a wrong/missing value bakes into the bundle; fix +
  redeploy the frontend, not just restart.

## Hardening to consider (post-launch)

- A strict `Content-Security-Policy` on the frontend responses with
  `connect-src 'self' https://api.<domain> wss://api.<domain>`.
- Validate the WS upgrade's `Origin`/`Host` in `apps/api/src/realtime/ws.auth.ts`
  (CORS does not protect the upgrade handshake).
- Per-shop custom domains (CNAME) on top of the subdomain.

## Local dev (unchanged)

`db/*.sql` still bootstraps the local Docker Postgres. Migrations (`migrations/`, run with
`npm run migrate:up -w apps/api`) are the authoritative path for **production** DBs;
`0001_initial_schema.cjs` is the frozen baseline — never edit it, add new numbered
migrations for schema changes.
