# ---- Build stage -------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app
# Install dependencies first so they cache independently of source changes.
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- Runtime stage -----------------------------------------------------------
# A small Node server (see server/) replaces the previous nginx runtime. It
# serves the same static bundle with the same cache and security headers, and
# adds the optional server vault — notes stored as .md files inside the
# container instead of on the user's device. The server uses only Node built-ins,
# so there are no runtime dependencies to install.
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app

COPY server ./server
COPY --from=build /app/dist ./dist

# Where the server vault lives when NIB_SERVER_VAULT=true. Created here (owned
# by the unprivileged "node" user the server runs as) so a named volume mounted
# at this path inherits the right ownership. Bind mounts must be writable by
# uid 1000.
RUN mkdir -p /data && chown -R node:node /data
USER node

ENV PORT=8080 \
    NIB_VAULT_DIR=/data
VOLUME ["/data"]

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:8080/ || exit 1

CMD ["node", "server/index.mjs"]
