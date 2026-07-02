# apps/web-admin — the platform-admin SPA, served as STATIC files on Railway (not Vercel).
# Build the Vite bundle, then serve dist/ with Caddy (SPA history fallback).
#
# Build context = repo ROOT (workspace deps + @barber/shared-types resolve via npm ci):
#   docker build -f apps/web-admin/Dockerfile -t barber-web-admin .
# On Railway: set Root Directory = repo root and RAILWAY_DOCKERFILE_PATH=apps/web-admin/Dockerfile.
#
# VITE_* vars are inlined at BUILD time, so VITE_API_BASE must be a build arg. Railway
# passes service variables to the build, so setting VITE_API_BASE on the service is enough.

# ---- build stage ----
FROM node:22-slim AS build
WORKDIR /repo
ARG VITE_API_BASE=""
ENV VITE_API_BASE=$VITE_API_BASE
COPY . .
RUN npm ci
RUN npm run build -w apps/web-admin

# ---- runtime stage (static file server) ----
FROM caddy:2-alpine AS runtime
COPY apps/web-admin/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/apps/web-admin/dist /srv
# Caddy listens on $PORT (injected by Railway); see Caddyfile.
EXPOSE 80
