# Barbershop Platform — Claude Code Context

## Project

Multi-tenant SaaS for Algerian barbershops. One codebase, multiple shops isolated by slug/subdomain.

## Stack

- Backend: Node.js + Express + TypeScript
- Database: PostgreSQL (parameterized queries only, no ORM)
- Auth: JWT (barbers) + express-session + connect-redis (owners)
- Real-time: ws library (not Socket.IO)
- Notifications: Twilio WhatsApp + Resend email
- Frontend: React + i18next (Arabic RTL + English) — not started yet

## Monorepo structure

- apps/api — Express backend
- apps/web — React frontend
- packages/shared-types — shared DTOs

## Rules for this codebase

- No ORM. Raw SQL with parameterized queries via pg Pool only.
- No any types. Strict TypeScript throughout.
- Zod for all input validation — every request body, query param, and env var.
- bcrypt for all password hashing (cost factor 12).
- All errors go through the central errorHandler middleware.
- Never log passwords, tokens, or phone numbers.
- All times stored as UTC TIMESTAMPTZ. Display uses shop timezone (Africa/Algiers default).
- Security headers (CSP, HSTS, X-Frame-Options) applied globally.
- Rate limiting on every public endpoint via redis-backed rate limiter.

## Current task

Building the auth system — see prompt below.
