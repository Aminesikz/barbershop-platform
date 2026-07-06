# Multi-stage build for the API (an always-on Express + WebSocket server — NOT for
# Vercel/serverless). Build the whole workspace, then run apps/api/dist.
#
# node:22-slim (Debian/glibc) is used over alpine so bcrypt's native build resolves
# cleanly via prebuilt binaries.

# ---- build stage ----
FROM node:25-slim AS build
WORKDIR /repo
COPY . .
RUN npm ci
RUN npm run build -w apps/api

# ---- runtime stage ----
FROM node:25-slim AS runtime
ENV NODE_ENV=production
WORKDIR /repo
# Bring the installed workspace + the compiled API. node-pg-migrate is a prod dep, so
# `npm run migrate:up` works here as a release step. db/ + migrations/ ship for migrations.
COPY --from=build /repo ./
WORKDIR /repo/apps/api
EXPOSE 3000
# Run DB migrations as a release step (e.g. Railway/Render "release command"):
#   npm run migrate:up
# then the container starts the server:
CMD ["node", "dist/server.js"]
