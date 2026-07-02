# apps/web — the customer + staff SPA, served as STATIC files on Railway (not Vercel).
# Build the Vite bundle, then serve dist/ with Caddy (SPA history fallback).
#
# Build context = repo ROOT (workspace deps + @barber/shared-types resolve via npm ci):
#   docker build -f apps/web/Dockerfile -t barber-web .
# On Railway: set Root Directory = repo root and RAILWAY_DOCKERFILE_PATH=apps/web/Dockerfile.
#
# VITE_* vars are inlined at BUILD time, so VITE_API_BASE must be a build arg. Railway
# passes service variables to the build, so setting VITE_API_BASE on the service is enough.

# ---- build stage ----
FROM node:26-slim AS build
WORKDIR /repo
ARG VITE_API_BASE=""
ENV VITE_API_BASE=$VITE_API_BASE
COPY . .
RUN npm ci
RUN npm run build -w apps/web

# ---- runtime stage (static file server) ----
FROM caddy:2-alpine AS runtime
COPY apps/web/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/apps/web/dist /srv
# Caddy listens on $PORT (injected by Railway); see Caddyfile.
EXPOSE 80
