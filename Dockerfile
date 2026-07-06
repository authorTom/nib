# ---- Build stage -------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app
# Install dependencies first so they cache independently of source changes.
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- Runtime stage -----------------------------------------------------------
# nginx-unprivileged runs as a non-root user and listens on 8080 — a smaller
# attack surface than stock nginx, on an Alpine base (~15 MB compressed).
FROM nginxinc/nginx-unprivileged:stable-alpine
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:8080/ || exit 1
