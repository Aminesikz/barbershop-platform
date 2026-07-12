# DZ Barbers — multi-tenant barbershop booking SaaS

[![CI](https://github.com/Aminesikz/barbershop-platform/actions/workflows/ci.yml/badge.svg)](https://github.com/Aminesikz/barbershop-platform/actions/workflows/ci.yml)
[![CodeQL](https://github.com/Aminesikz/barbershop-platform/actions/workflows/codeql.yml/badge.svg)](https://github.com/Aminesikz/barbershop-platform/actions/workflows/codeql.yml)
[![Security](https://github.com/Aminesikz/barbershop-platform/actions/workflows/security.yml/badge.svg)](https://github.com/Aminesikz/barbershop-platform/actions/workflows/security.yml)
![Node](https://img.shields.io/badge/Node-22_LTS-339933?logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)
![License](https://img.shields.io/badge/license-All_rights_reserved-lightgrey)

A production **multi-tenant SaaS** where Algerian barbershops take online bookings and
run their chair from a console. One codebase serves every shop, isolated by subdomain
(`shop.dzbarbers.com`). Customers self-book in under a minute; owners and barbers manage
bookings, schedules, staff, and reviews in real time.

**Live:** [dzbarbers.com](https://dzbarbers.com) · demo shop
[demo-cuts.dzbarbers.com](https://demo-cuts.dzbarbers.com) · console at
`<shop>.dzbarbers.com/business`

> Built solo as an end-to-end exercise in shipping *and securing* a real product:
> design → build → deploy on a custom domain → shift-left CI security → staging +
> dynamic pentest → documented findings. The security narrative lives in
> **[SECURITY.md](SECURITY.md)**.

---

## Why this repo is worth a look

- **Correctness enforced in the database, not hopeful app code.** Double-booking,
  tenant pairing, and idempotency are Postgres constraints (`EXCLUDE USING gist`,
  composite FKs, `UNIQUE`), so they hold even if a validation path is ever bypassed.
- **Two distinct auth actors, one fail-closed authorization layer.** Owners use
  Redis-backed sessions; barbers use JWTs; a single guard resolves either and refuses
  anything that doesn't match the resolved tenant — no fall-through, at most one
  principal ever granted.
- **Real DevSecOps, not a checklist.** Shift-left CI (CodeQL, Semgrep, gitleaks, npm
  audit — all blocking, actions SHA-pinned), branch protection, an isolated staging
  environment, and a hand-run dynamic pentest whose findings are triaged and logged.
- **No ORM, no `any`, no `dotenv` magic.** Parameterized SQL only, strict TypeScript
  end to end, and Zod-validated env that refuses to boot if misconfigured.

## Architecture

```mermaid
flowchart TB
    subgraph clients [Clients]
      C["Customer<br/>browser"]
      O["Owner<br/>session cookie"]
      B["Barber<br/>JWT bearer"]
      A["Platform admin<br/>session cookie"]
    end
    subgraph rw [Railway - one project]
      WEB["apps/web (Caddy SPA)<br/>*.dzbarbers.com"]
      ADM["apps/web-admin (Caddy SPA)<br/>admin.dzbarbers.com"]
      API["apps/api — Express 4 + ws<br/>api.dzbarbers.com"]
      PG[(PostgreSQL 16)]
      RD[(Redis)]
    end
    C --> WEB
    O --> WEB
    A --> ADM
    WEB -->|/api /auth + wss| API
    ADM -->|/admin /auth| API
    B -->|Authorization: Bearer + wss| API
    API -->|parameterized SQL| PG
    API -->|sessions + rate limits| RD
```

Three deployables from one npm-workspaces monorepo. The API is an always-on Express +
WebSocket server (stateful `pg` pool, in-memory WS rooms), which is why it runs on a
container, not serverless. Both frontends are static `dist/` folders served by Caddy.

**Request lifecycle (load-bearing order):** `trust proxy` (exact hop count) → helmet
(CSP/HSTS/frameguard) → CORS (anchored regex from `ALLOWED_ORIGIN_PATTERN`) →
`express.json({ limit: '64kb' })` → global Redis rate limiter → session → routes →
central `errorHandler`. `/api/*` is always mounted behind a tenant resolver that sets
`req.shop`; `/auth/*` is not tenant-scoped.

**Multi-tenancy:** the shop slug comes from the `Host` subdomain (or `X-Shop-Slug` for
local/mobile), and **every** booking-domain query is filtered by `shop_id`. A barber may
only ever read or act on their *own* bookings — enforced in SQL, not just the UI.

## Security posture

Full threat model and the findings log (F-001…F-007) are in **[SECURITY.md](SECURITY.md)**.
Highlights:

| Area | What's in place |
| --- | --- |
| **Tenant isolation** | `shop_id` on every query; composite FKs `(barber_id, shop_id)` make the pairing a DB invariant; verified under cross-tenant attack on staging |
| **AuthZ** | fail-closed dual-auth guard (session **or** JWT, never both); session id rotated at every login (fixation fix, F-005) |
| **Booking integrity** | `EXCLUDE USING gist` double-booking guard; `UNIQUE` idempotency key; `tstzrange` maintained by a DB trigger so the guard can't be bypassed |
| **Abuse defense** | layered Redis rate limits (global + per-endpoint + per-`shop:ip` + per-`shop:phone-HMAC`), a booking honeypot, and a bot-friendly fabricated response |
| **Transport & headers** | helmet CSP/HSTS on the API; least-privilege CSP + HSTS on both SPAs (F-001); anchored CORS with no origin reflection |
| **PII** | phone numbers are E.164, never logged or broadcast; Redis/dedup keys use a keyed HMAC, never plain SHA-256; WS broadcasts carry a compiler-enforced redacted DTO |
| **Real-time** | WebSocket upgrade validates `Origin` against the same allowlist (CSWSH guard) plus a signed token + tenant match |
| **Supply chain / CI** | CodeQL (`security-extended`), Semgrep (`p/ci`), gitleaks (full history), `npm audit` high+ — all blocking; GitHub Actions SHA-pinned; Dependabot with a major-version policy; branch protection on `main` |
| **Assessment** | passive scans on prod (SSL Labs A+, headers), a dedicated **isolated staging** env for active DAST + a manual app-specific pentest — [STAGING.md](STAGING.md) |

## Tech stack

| Layer | Choice |
| --- | --- |
| Backend | Node.js 22 · Express 4 · TypeScript (ESM, strict, `exactOptionalPropertyTypes`) |
| Database | PostgreSQL 16 — raw parameterized SQL via `pg`, **no ORM**; `node-pg-migrate` migrations |
| Auth | JWT (barbers) + `express-session` / `connect-redis` (owners & admins) · bcrypt (cost 12) |
| Real-time | `ws` (native WebSocket), room-based broadcast via a typed event bus |
| Validation | Zod on every body, query param, and env var |
| Email | Resend (password reset, booking + review notifications) |
| Frontend | React 18 · Vite · no router lib on the customer app (state-driven views) |
| Infra | Railway (API + 2 static Caddy frontends + managed Postgres + Redis), one domain |

## Monorepo layout

```
apps/api            Express + WebSocket backend (@barber/api)
apps/web            Customer site + owner/barber console (@barber/web)
apps/web-admin      Platform-admin console (@barber/web-admin)
packages/shared-types  DTOs imported by both apps (source-only, 21 exports)
```

Each API domain (`bookings`, `availability`, `barbers`, `services`, `working-hours`,
`time-off`, `reviews`, `auth`, `admin`) follows `router → controller → service` with
raw SQL confined to the service layer.

## Local development

Requires Node 22 and Docker.

```bash
# 1. Infra (Postgres :5432 + Redis :6379). db/*.sql auto-seeds on first boot.
docker compose up -d

# 2. API (env is validated by Zod — it won't boot if anything is missing)
cd apps/api
DATABASE_URL=postgresql://barber:barber_dev_pw@localhost:5432/barbershop \
REDIS_URL=redis://localhost:6379 \
SESSION_SECRET=dev_session_secret_min_32_chars_xxxx \
JWT_SECRET=dev_jwt_secret_min_32_chars_xxxxxxxxx \
PHONE_HMAC_SECRET=dev_phone_hmac_secret_min_32_chars_x \
ALLOWED_ORIGIN_PATTERN=http://localhost:5173 \
npm run dev

# 3. Customer web (Vite :5173, proxies /api + /auth → :3000, same-origin)
npm run dev -w apps/web
```

Seeded demo shop `algiers-cuts` — owner `owner@algiers-cuts.dz` / `OwnerPass123!`,
barber `barber@algiers-cuts.dz` / `BarberPass123!`.

## Testing

```bash
npm test -w apps/api
```

A 130+ case `node:test` + `supertest` suite covering the full booking domain, both auth
models, tenant isolation, rate limiting, idempotency, the WebSocket auth handshake, and
every regression fix. **No live Postgres/Redis needed** — the DB/Redis modules are
replaced with `mock.module(...)` and env is stubbed per file, so the suite runs fast in
CI. Typechecking (`tsc --noEmit`) gates every PR alongside the tests.

## CI/CD & deployment

- **CI** (`ci.yml`): typecheck + test the API, build both frontends — the merge gate.
- **CodeQL** (`codeql.yml`) and **Security** (`security.yml`): SAST + secret + dependency
  scanning on every PR and weekly on a schedule; all blocking.
- **Deploy:** Railway, one project, wildcard subdomains — see **[DEPLOY.md](DEPLOY.md)**.
- **Staging:** isolated second environment for active security testing — see
  **[STAGING.md](STAGING.md)**.

## Project status

Live in production on a custom domain. Booking, availability, dual-auth, real-time
updates, platform/owner/barber management, password reset, email notifications,
customer reviews, and barber profiles are all shipped. Planned next: Arabic / RTL
(i18n) and WhatsApp notifications.

---

Built by [Amine](https://github.com/Aminesikz). See [CLAUDE.md](CLAUDE.md) for the
full architecture guide and [SECURITY.md](SECURITY.md) for the security assessment log.

**License:** source published for review only — all rights reserved. See [LICENSE](LICENSE).
