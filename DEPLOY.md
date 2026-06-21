# Deploying (multi-shop, wildcard subdomains)

One `apps/web` build serves **every** shop — the shop is resolved at runtime from the
hostname (`slug.platform.dz`). Creating a shop in the admin app makes it live instantly
(wildcard DNS already covers it; no per-shop build or config).

> The API is a long-lived Express + **WebSocket** server with a stateful `pg` pool and
> in-memory WS rooms. It **cannot run on Vercel serverless.** Frontends → Vercel; API →
> an always-on host (Railway / Render / a VPS).

## Topology

| Piece            | Host                | Domain                         |
| ---------------- | ------------------- | ------------------------------ |
| Customer + staff | Vercel (`apps/web`) | `*.platform.dz` (wildcard)     |
| Platform admin   | Vercel (`apps/web-admin`) | `admin.platform.dz`       |
| API + WebSocket  | Railway / Render    | `api.platform.dz`              |
| Postgres + Redis | managed (Neon/Supabase + Upstash, or the host's add-ons) | — |

## API (Railway / Render)

- Build from `apps/api/Dockerfile` (build context = repo root):
  `docker build -f apps/api/Dockerfile -t barber-api .`
- **Release command** (runs migrations before the new version serves traffic):
  `npm run migrate:up -w apps/api`  (uses `DATABASE_URL`)
- **Seed the first platform admin** (one-off, AFTER the first migrate — a fresh prod DB
  has zero admins, so nobody could log into the admin app otherwise):
  `ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='a-strong-password' npm run seed:admin -w apps/api`
  (idempotent — re-running with the same email just resets the password)
- **Start**: the image's `CMD` → `node dist/server.js`
- Env vars:
  - `NODE_ENV=production`
  - `DATABASE_URL`, `REDIS_URL` (managed)
  - `SESSION_SECRET`, `JWT_SECRET`, `PHONE_HMAC_SECRET` — each ≥ 32 chars
  - `ALLOWED_ORIGIN_PATTERN=https://*.platform.dz`
  - `COOKIE_DOMAIN=.platform.dz`  ← required so the session cookie set by
    `api.platform.dz` is sent on `*.platform.dz` requests
  - `TRUST_PROXY_HOPS=1` (Railway/Render put one proxy in front)

## Frontends (Vercel) — two projects, same repo

For each: set **Root Directory** to the app folder, Framework = **Vite** (auto build →
`dist`). `vercel.json` in each app already supplies the SPA rewrite.

- `apps/web` → add domain `*.platform.dz` (Vercel issues wildcard TLS). Env:
  `VITE_API_BASE=https://api.platform.dz`
- `apps/web-admin` → domain `admin.platform.dz`. Env:
  `VITE_API_BASE=https://api.platform.dz`

## DNS

- `*.platform.dz`  → Vercel (the `apps/web` project's wildcard domain)
- `admin.platform.dz` → Vercel (`apps/web-admin`) — add explicitly; a specific record
  wins over the wildcard
- `api.platform.dz` → the API host

## Cookies / CORS (already wired)

`api.platform.dz` and `shop.platform.dz` share the registrable domain `platform.dz`, so
with `COOKIE_DOMAIN=.platform.dz` the owner session cookie flows across subdomains. CORS
already accepts any `https://<slug>.platform.dz` origin with credentials
(`ALLOWED_ORIGIN_PATTERN`). `sameSite: 'strict'` is kept (these are same-site requests).

## Hardening to consider (post-launch)

- A strict `Content-Security-Policy` on the Vercel responses with
  `connect-src 'self' https://api.platform.dz wss://api.platform.dz`.
- Validate the WS upgrade's `Origin`/`Host` in `apps/api/src/realtime/ws.auth.ts`.
- Per-shop custom domains (CNAME) on top of the subdomain.

## Local dev (unchanged)

`db/*.sql` still bootstraps the local Docker Postgres. Migrations (`migrations/`, run with
`npm run migrate:up -w apps/api`) are the authoritative path for **production** DBs;
`0001_initial_schema.cjs` is the frozen baseline — never edit it, add new numbered
migrations for schema changes.
