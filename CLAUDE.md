# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Multi-tenant SaaS for Algerian barbershops. One codebase serves many shops, isolated by `slug` (subdomain). Customers self-book; shop owners and barbers manage bookings/schedules from a console.

## Stack

- Backend: Node.js (22+) + Express 4 + TypeScript (ESM, strict)
- Database: PostgreSQL 16 (parameterized queries only, no ORM)
- Auth: JWT (barbers) + express-session + connect-redis (owners)
- Real-time: `ws` library (not Socket.IO)
- Notifications: Twilio WhatsApp + Resend email (planned, not wired yet)
- Frontend: React 18 + Vite. i18next / Arabic RTL is planned but the current console is English-only.

## Monorepo layout (npm workspaces)

- `apps/api` — Express backend (`@barber/api`)
- `apps/web` — React + Vite console (`@barber/web`)
- `packages/shared-types` — DTOs imported by both apps (`@barber/shared-types`, source-only, no build step)

## Commands

Local infra (Postgres + Redis) must be up first. The DB schema/seed in `apps/api/db/*.sql` is auto-applied by Postgres on first boot, in filename order:

```bash
docker compose up -d            # start Postgres (:5432) + Redis (:6379)
docker compose down -v          # stop AND drop seeded data (the -v matters)
```

API (`apps/api`, or via root `npm run dev:api` / `npm run test:api`):

```bash
npm run dev      # nodemon + tsx, watches src
npm run build    # tsc → dist  (CI runs this with --noEmit as the typecheck gate)
npm start        # node dist/server.js
npm test         # node:test runner over src/tests/**/*.test.ts
```

Run a single test file / filter by name (from `apps/api`):

```bash
node --import tsx/esm --experimental-test-module-mocks --test src/tests/auth.test.ts
node --import tsx/esm --experimental-test-module-mocks --test --test-name-pattern "normalizeDzPhone" src/tests/**/*.test.ts
```

Web (`apps/web`):

```bash
npm run dev        # Vite on :5173, proxies /api and /auth → :3000 (same-origin, cookie works, no CORS)
npm run typecheck  # tsc --noEmit
npm run build      # tsc --noEmit && vite build
```

### Environment & toolchain gotchas

- **No dotenv.** `config/env.ts` validates `process.env` with Zod and `process.exit(1)`s if anything is missing — env vars must already be in the shell. Required: `DATABASE_URL`, `REDIS_URL`, `SESSION_SECRET` (≥32), `JWT_SECRET` (≥32), `PHONE_HMAC_SECRET` (≥32), `ALLOWED_ORIGIN_PATTERN`. See `config/env.ts` for the full list + defaults.
- **Node 22 required** — tests rely on `node:test` module mocking (`--experimental-test-module-mocks`, added in 22.3).
- **ESM / NodeNext**: relative imports MUST carry a `.js` extension even though the source is `.ts` (e.g. `import { env } from './config/env.js'`). Omitting it breaks at runtime.

## Architecture

### Request lifecycle (`apps/api/src/app.ts`)

Global middleware order is load-bearing: `trust proxy` (exact hop count, never `true`) → helmet (explicit CSP/HSTS/frameguard) → CORS (regex from `ALLOWED_ORIGIN_PATTERN`, wildcard subdomains) → `express.json({ limit: '64kb' })` → global Redis rate limiter → session. Then routes; the central `errorHandler` is mounted **last**.

- `/auth/*` is **not** tenant-scoped (owner login by email, barber login by email+shop).
- `/api/*` is **always** mounted behind `tenantResolver`, which sets `req.shop`.

### Multi-tenancy

`tenantResolver` derives the shop slug from the `Host` subdomain (`slug.platform.dz`), falling back to the `X-Shop-Slug` header for local/mobile clients, looks it up, and sets `req.shop = { id, slug, timezone }` (404 if missing/inactive). **Every** SQL query in the booking domain is filtered by `shop_id`. In handlers, narrow the request with `getShop(req)` / `getStaff(req)` from `shared/reqContext.ts` (they throw → 500 if the upstream middleware didn't run).

### Dual auth model

Two distinct actors, resolved into one `StaffPrincipal` (`shared/principal.ts`):

- **Owners** authenticate via `express-session` (Redis-backed, `sid` cookie) → `req.session.owner`.
- **Barbers** authenticate via JWT bearer token → verified by `verifyBarberToken`.

`requireStaff` (in `shared/middleware/`) accepts either and is **fail-closed**: an owner session must match `req.shop.id` (no fall-through to JWT), a barber JWT must verify AND match `req.shop.id`. `requireOwner` is the owner-only variant. **A barber may only ever read/act on their own bookings** — enforced in the service layer by appending `barber_id = staff.id` to the WHERE clause. Use `assertCanManageBarber(staff, barberId)` before schedule/time-off mutations.

### Module pattern

Each domain under `apps/api/src/modules/<name>/` follows `router → controller → service` (+ `mapper` where row↔DTO shapes diverge):

- **router**: mounts middleware (`requireStaff`, rate limiters) and wraps every async controller in `asyncHandler` (Express 4 does not catch async rejections — without it, thrown errors hang the request instead of reaching `errorHandler`).
- **controller**: Zod-parses `req.body`/`query`/`params` (`.strict()`), pulls `getShop`/`getStaff`, calls the service. No SQL here.
- **service**: all raw parameterized SQL lives here.

Errors: throw the `AppError` helpers (`badRequest`, `notFound`, `conflict`, `tooManyRequests`, …) from `shared/httpError.ts`. `errorHandler` turns 4xx into exposed messages, 5xx into a generic "Internal server error", and `ZodError` into a 400 with field errors.

### Database access

- One `pg` `Pool` (`config/db.ts`). Most reads/writes use `pool.query` directly.
- **Multi-statement atomic flows MUST go through `withTransaction()`** (booking create, working-hours full-replace, time-off). `pool.query` calls can each land on a different pooled connection, so a manual BEGIN/…/COMMIT would scatter and not be atomic. `withTransaction` also sets `SET LOCAL lock_timeout`/`statement_timeout` so a stuck lock can't exhaust the pool.
- **Two Redis clients on purpose**: `config/redis.ts` exports an `ioredis` client (app + rate limiters); `app.ts` separately creates a `node-redis` client because `connect-redis` v7 requires it. Don't try to unify them.

### Invariants enforced in SQL, not app code

The schema (`apps/api/db/01_schema.sql`) is authoritative — treat the DB as the source of truth for correctness-critical rules:

- **Double-booking guard**: `EXCLUDE USING gist (barber_id WITH =, during WITH &&) WHERE status IN ('pending','confirmed')`. The app validates slots, but overlap is ultimately the DB's job → a `23P01` is mapped to a 409. Same pattern guards overlapping working-hours shifts and time-off.
- `bookings.during` (a `tstzrange`) is maintained by a `BEFORE` trigger, not the app, so the EXCLUDE guard can't be bypassed.
- **Idempotency**: `UNIQUE (shop_id, idempotency_key)`; a `23505` on insert means replay → return the existing booking with **no second WS broadcast**.
- Composite FKs `(barber_id, shop_id)` / `(service_id, shop_id)` make the shop pairing a DB invariant.
- `shared/pgErrors.ts` centralizes Postgres-error-code → HTTP mapping.

### Real-time (`apps/api/src/realtime/`)

`ws` only. On HTTP upgrade, `wsAuth` authenticates, then the socket joins `shop:<id>` and `barber:<id>` rooms (`ws.rooms.ts`), with a ping/pong heartbeat. Services never touch sockets directly: they `eventBus.emit('booking.created', …)` and `ws.server.ts` is the sole subscriber that broadcasts. `eventBus` is a typed `EventEmitter` (`shared/eventBus.ts`). **Broadcasts carry the redacted `BookingBroadcastDTO`** (compiler-enforced to omit customer phone/PII).

### Time, money, and PII conventions

- All instants stored as UTC `TIMESTAMPTZ`; display uses the shop timezone (`Africa/Algiers` default).
- Working hours are **minutes-of-day in shop-local wall-clock**; `weekday` is `0=Sunday..6=Saturday` to match Postgres `EXTRACT(DOW)`. The availability/booking validation joins on this — keep the convention.
- `price_dzd` is a whole-integer Algerian dinar amount (DZD has no circulating subunit).
- `customer_phone` is E.164 (`shared/phone.ts` normalizes Algerian mobiles) and is **never logged or broadcast**. For Redis keys / dedup, use `hmacPhone()` (keyed HMAC, never plain SHA-256).

### Rate limiting & bot defense

Layered: global limiter (`app.ts`) + stricter per-endpoint login limiter + `createPublicLimiter` (keyed `shopId:ip` so one shop's flood can't drain another's budget) + a per-`(shop+phoneHmac)` cap inside the booking controller. Public booking also has a `website` honeypot field that returns a fabricated 201 and persists nothing.

### Frontend (`apps/web`)

React 18 + Vite, no router lib — `App.tsx` switches views by state. `api.ts` is a thin `fetch` wrapper that sends `credentials: 'include'` (owner cookie) and adds `Authorization: Bearer` (barber token from `localStorage`) plus `X-Shop-Slug` on `/api` calls. Auth state lives in `app/AuthContext.tsx`.

## Codebase rules

- No ORM. Raw SQL with parameterized queries via the `pg` Pool only.
- No `any`. Strict TypeScript throughout (`exactOptionalPropertyTypes`, `noUnusedLocals/Parameters` are on).
- Zod for all input validation — every request body, query param, and env var. Reuse the primitives in `shared/validation.ts`.
- bcrypt for all password hashing (cost factor 12).
- All errors flow through the central `errorHandler`; throw `AppError` helpers, don't `res.status().json()` ad hoc in services.
- Never log passwords, tokens, or phone numbers.
- Security headers (CSP, HSTS, X-Frame-Options) applied globally; rate-limit every public endpoint via the Redis-backed limiter.

## Testing

`node:test` + `supertest`, no external Postgres/Redis needed — DB/Redis modules are replaced with `mock.module(...)` and env is stubbed at the top of each test file **before** any module that imports `config/env.ts` is loaded. Pure-logic modules (`phone`, `time`, `validation`, mappers) are imported dynamically and tested directly. Follow this pattern; don't introduce a live DB dependency into the suite.

## Local dev credentials (from `apps/api/db/02_seed.sql`)

- Active shop slug: `algiers-cuts` (also an inactive `closed-shop` for negative tests)
- Owner: `owner@algiers-cuts.dz` / `OwnerPass123!`
- Barber: `barber@algiers-cuts.dz` / `BarberPass123!`

## Notes

- `apps/api/db/*.sql` is a throwaway dev bootstrap, **not** a migration tool — replace with one (e.g. node-pg-migrate) before prod.
- GitHub is on the free plan (no branch protection); CI (`.github/workflows/ci.yml`) is the only gate: typecheck + tests on PRs/pushes to `main`.
</content>
</invoke>
