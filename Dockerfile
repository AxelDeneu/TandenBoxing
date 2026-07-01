# syntax=docker/dockerfile:1

# --- Stage build ---
FROM node:26-bookworm-slim AS build
WORKDIR /app

# Outils pour compiler better-sqlite3 si aucun prebuilt n'est disponible.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# --- Stage runtime ---
FROM node:26-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    NUXT_DATABASE_PATH=/app/data/tanden.db \
    NUXT_TIMEZONE=Europe/Paris \
    PORT=3000 \
    HOST=0.0.0.0

# Sortie autonome de Nitro (inclut better-sqlite3) + migrations SQL.
# Les migrations sont appliquées au démarrage par le plugin Nitro (server/plugins/0.database.ts).
COPY --from=build /app/.output ./.output
COPY --from=build /app/drizzle ./drizzle

RUN mkdir -p /app/data
VOLUME ["/app/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", ".output/server/index.mjs"]
