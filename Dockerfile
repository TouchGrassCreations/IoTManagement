# syntax=docker/dockerfile:1

# The build needs the dev dependencies — vite, the Cloudflare plugin, the
# TypeScript toolchain — and the runtime needs none of them, so they stay in a
# stage that is thrown away.
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    DATABASE_PATH=/data/cabinet.db \
    MIGRATIONS_DIR=/app/drizzle

# `output: "standalone"` bundles vinext and its own dependencies but not the
# application's, so the production dependencies are installed first and the
# standalone output is merged over them. COPY adds to a directory rather than
# replacing it, so both halves of node_modules survive.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist/standalone ./

# The migrations are not part of the server bundle: the first query applies
# whichever ones the volume has not seen.
COPY --from=build /app/drizzle ./drizzle

# The database lives on the volume so the image stays disposable.
RUN mkdir -p /data && chown -R node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

CMD ["node", "server.js"]
