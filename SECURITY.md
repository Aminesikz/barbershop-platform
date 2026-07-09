# Security

This document records the security posture of the platform and the findings log
from periodic assessments. It is a living document — each assessment appends a
dated section.

## Reporting a vulnerability

If you find a security issue, please email the maintainer rather than opening a
public issue. Include steps to reproduce and the affected surface (API, customer
web app, or admin app).

## Threat model at a glance

Multi-tenant SaaS; tenants are isolated by shop `slug`/`shop_id`. Two staff actor
types with deliberately different trust models:

- **Owners** — `express-session` cookie (`sid`), Redis-backed. Cookie is
  `HttpOnly; Secure; SameSite=Strict; Domain=.dzbarbers.com` so one session works
  across the apex and subdomains. No CSRF surface reachable cross-site
  (`SameSite=Strict`).
- **Barbers** — JWT bearer token in `localStorage`. No cookie → no CSRF surface,
  but the token is JavaScript-readable, so it is XSS-exfiltratable. Accepted
  tradeoff, documented here rather than treated as a defect.

Correctness-critical invariants (tenant isolation, double-booking, idempotency)
are enforced in Postgres, not app code. See `CLAUDE.md` for the architecture.

## Assessment boundary (rules of engagement)

- **Production (`*.dzbarbers.com`) gets PASSIVE checks only.** The app is live and
  multi-tenant, and it runs on Railway (infrastructure we do not own — Railway
  terminates TLS at its edge). Active/intrusive testing (DAST, fuzzing, injection
  payloads, load) could hit Railway's platform, create garbage tenant data, or
  trip our own rate limiters against real customers, and may violate Railway's AUP.
- **Active testing (DAST) is gated behind a dedicated staging environment** with
  its own throwaway data and distinct secrets (a later roadmap phase).

---

## Findings log

### Assessment 2026-07-08 — Phase 6: passive production scans

Surfaces: `api.dzbarbers.com` (Express + helmet), `dzbarbers.com` /
`*.dzbarbers.com` (customer SPA, Caddy static host), `admin.dzbarbers.com`
(admin SPA, Caddy static host).

Tools/methods: SSL Labs, securityheaders.com, Mozilla Observatory, and manual
`curl` probes for response headers, cookie flags, CORS reflection, and
X-Forwarded-For spoofing.

#### Summary of grades

| Surface | SSL Labs | securityheaders.com | Observatory |
| --- | --- | --- | --- |
| `api.dzbarbers.com` | A+ | A | not graded (see F-002) |
| `dzbarbers.com` | A | F | D |
| `admin.dzbarbers.com` | A | F | D |

Letter grades are not comparable across tools (each weights differently); the
itemized findings below are the authoritative record.

#### F-001 — Frontend SPAs send no HTTP security headers — **Medium — RESOLVED 2026-07-09**

- **Surface:** `dzbarbers.com`, `admin.dzbarbers.com` (Caddy static host).
- **Method:** securityheaders.com (F); Observatory (D); `curl -sSI https://dzbarbers.com/`.
- **Observation:** responses carry no `Content-Security-Policy`,
  `Strict-Transport-Security`, `X-Frame-Options`, `X-Content-Type-Options`,
  `Referrer-Policy`, or `Permissions-Policy`. The Caddyfiles set only
  `Cache-Control` on `/assets/*`.
- **Impact:** the SPAs are framable (clickjacking), have no browser-enforced XSS
  mitigation (no CSP) on surfaces that execute scripts, and miss SSL-strip
  protection (no HSTS — this is also the sole reason SSL Labs grades the frontends
  A instead of A+).
- **Severity:** Medium. Script-rendering surfaces missing baseline controls; no
  confirmed active exploit, but real clickjacking exposure on the admin console.
- **Verdict:** Fixed. Both Caddyfiles now set HSTS, `X-Frame-Options: DENY`,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`, and a
  frontend-specific CSP (see the Phase 7 spec below). Shipped in PR #38, deployed
  and confirmed live via `curl -sSI` on both hosts. The customer app allows
  `wss://api.dzbarbers.com` in `connect-src`; the admin app omits it (no WebSocket).
- **Resolution note:** verified against the real production build — the Vite dev
  server can't validate a prod CSP (dev needs `unsafe-inline`/`unsafe-eval`), so the
  built `dist/` was served with the exact headers and loaded in a browser: scripts,
  CSS, Google Fonts (Inter + Fraunces), and inline styles all load, a fetch to the
  API and a `wss://` WebSocket both reach the network (CSP-permitted), and zero
  `securitypolicyviolation` events fired. Expected re-scan result: securityheaders.com
  F→A, SSL Labs A→A+ on both frontends (HSTS now present).
- **Note:** the API already sent all of these via `helmet()`; the gap was
  frontend-only. The stale "Vercel" comment in `app.ts` was corrected in the same PR
  (frontends are Caddy on Railway).

#### F-002 — Observatory cannot grade the API (404 on host root) — **Informational**

- **Surface:** `api.dzbarbers.com`.
- **Observation:** Mozilla Observatory scans the host root (`GET /`); the API
  mounts no route there and returns 404, so Observatory declines to grade it.
- **Assessment:** Not a security issue. Security headers are present even on the
  404 response (helmet runs before routing — verified: HSTS, `nosniff`,
  `X-Frame-Options: DENY`, `Content-Security-Policy: default-src 'none'`), and
  SSL Labs + securityheaders.com both grade the API from other responses.
- **Verdict:** Won't-fix (accepted). Optionally add a `GET /` 200 stub if an
  Observatory grade for the API is ever desired.

#### F-003 — Barber JWT stored in `localStorage` — **Informational (accepted tradeoff)**

- **Observation:** barber tokens live in `localStorage`, readable by JavaScript
  and therefore XSS-exfiltratable.
- **Assessment:** deliberate. Avoids a cookie/CSRF surface for the barber flow;
  the exposure is bounded (a barber may only ever act on their own bookings, and
  the token expires). Mitigated in depth by the strict CSP once F-001 lands.
- **Verdict:** Accepted. Revisit if a stronger token-storage story is warranted.

#### Controls verified working (passing checks)

Recording what passed is as important as recording gaps.

- **TLS (SSL Labs A/A+):** TLS 1.2/1.3, forward secrecy, valid chain (Railway edge).
- **API security headers (helmet):** strict CSP, HSTS `max-age=31536000;
  includeSubDomains; preload`, `X-Frame-Options: DENY`, `X-Content-Type-Options:
  nosniff`, `Referrer-Policy: no-referrer`, COOP/CORP `same-origin`.
- **CORS allowlist — no origin reflection:** verified against `/api/shop`. Real
  subdomain and bare apex origins are allowed (with `Allow-Credentials: true`);
  `dzbarbers.com.evil.com` (suffix lookalike), `evil.com`, and `a.b.dzbarbers.com`
  (nested) are all rejected — no `Access-Control-Allow-Origin` returned. The
  compiled origin regex (`apps/api/src/shared/originPattern.ts`) is `^`/`$`
  anchored; the same regex guards the WebSocket upgrade.
- **X-Forwarded-For spoofing defeated:** five requests with rotating forged
  `X-Forwarded-For` values decremented a single shared rate-limit bucket
  (`remaining` 114→113→112→111…), proving the forged IPs are ignored. Defense:
  `app.set('trust proxy', TRUST_PROXY_HOPS)` with an exact hop count (never `true`).
- **No session cookie on failed/anonymous requests:** a failed owner login returns
  401 with no `Set-Cookie` (`saveUninitialized: false`). On success the `sid`
  cookie is `HttpOnly; Secure; SameSite=Strict; Domain=.dzbarbers.com` (verified
  in-browser 2026-07-04 at cross-subdomain session cutover).
- **Cross-site WebSocket hijacking guard:** WS upgrade validates the `Origin`
  header against the same allowlist (shipped 2026-07-08).

#### F-004 — CodeQL `js/missing-token-validation` on the session middleware — **Informational (dismissed 2026-07-09, risk accepted)**

- **Observation:** CodeQL flags the `express-session` middleware in
  `apps/api/src/app.ts` ("cookie middleware serving request handlers without
  CSRF protection"). The alert had been open on `main` since 2026-07-02 and
  resurfaced as "new" on PR #40 because that PR mounts an additional router
  behind the same middleware.
- **Assessment:** mitigated by design, per the threat model above. The `sid`
  cookie is `SameSite=Strict`, so browsers never attach it to any cross-site
  request — the CSRF vehicle does not exist. Defense in depth: the API accepts
  only JSON bodies (`express.json`, no form parsing — a cross-origin JSON POST
  requires a CORS preflight, which the anchored origin allowlist rejects), and
  there are no state-changing GET handlers. Token middleware (e.g. `csurf`,
  itself deprecated) would add no protection this configuration doesn't already
  provide.
- **Verdict:** dismissed as accepted risk with this document as the rationale.
  Revisit if the cookie ever moves off `SameSite=Strict` or a form-encoded
  endpoint is added.

#### Reproduction commands

```bash
API=https://api.dzbarbers.com; WEB=https://dzbarbers.com; ADMIN=https://admin.dzbarbers.com

# Response headers (compare API vs frontends)
curl -sSI $API/health
curl -sSI $WEB/ ; curl -sSI $ADMIN/

# CORS: legit allowed, hostile rejected (test a post-CORS route, not /health)
curl -s -o /dev/null -D - -H "Origin: https://dzbarbers.com"       -H "X-Shop-Slug: demo-cuts" $API/api/shop | grep -i access-control-allow
curl -s -o /dev/null -D - -H "Origin: https://dzbarbers.com.evil.com" -H "X-Shop-Slug: demo-cuts" $API/api/shop | grep -i access-control-allow  # expect none

# X-Forwarded-For spoof (expect monotonic 'remaining', not a reset per IP)
for i in $(seq 1 5); do curl -s -o /dev/null -D - -H "X-Forwarded-For: 9.9.9.$i" -H "X-Shop-Slug: demo-cuts" $API/api/shop | grep -i '^ratelimit:'; done
```

---

## Phase 7 spec — Caddy frontend security headers (resolves F-001)

Add a global `header { }` block to both `apps/web/Caddyfile` and
`apps/web-admin/Caddyfile`:

- `Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"`
  (matches the API; also lifts SSL Labs A → A+).
- `X-Content-Type-Options "nosniff"`
- `X-Frame-Options "DENY"`
- `Referrer-Policy "strict-origin-when-cross-origin"`
- `Content-Security-Policy` — **frontend-specific**, must allow the SPA's real
  dependencies or the app breaks:
  - `default-src 'self'`
  - `style-src 'self' https://fonts.googleapis.com` (Google Fonts stylesheet)
  - `font-src https://fonts.gstatic.com` (Google Fonts files)
  - `connect-src 'self' https://api.dzbarbers.com wss://api.dzbarbers.com`
    (API calls + WebSocket)
  - `img-src 'self' data:`
  - `object-src 'none'`; `frame-ancestors 'none'`; `base-uri 'self'`
  - Watch for `unsafe-inline` needs from the Vite build; prefer hashes/nonces over
    blanket-allowing inline. Verify the booking page, admin console, fonts, and
    live WebSocket all still work after applying.
- Optional: self-host the fonts to drop the Google origins from the CSP entirely,
  and add Subresource Integrity to the font `<link>` if kept remote.
- Reconcile the stale "Vercel" comment in `apps/api/src/app.ts`.
