# Dockerfile del servicio sync de Laural.
# Decisiones: docs/plans/despliegue-sync-vps.md (2026-11-23)
#   1. Docker Compose, como el resto del VPS.
#   2. nginx existente en el host (este Dockerfile no incluye proxy).
#   3. PostgreSQL dedicado (ver compose.yaml).
#
# Contexto de build: LA RAÍZ DEL REPO, no server/.
#   docker build -f server/Dockerfile .
#   docker-compose -f server/compose.yaml build
# Motivo: server/tsconfig.json tiene rootDir ".." e incluye
# ../shared/**, y server/scripts/copy-assets.mjs copia
# ../shared/preference-snapshot-v1.schema.json, server/migrations y
# server/web a dist/. Sin la raíz del repo en el contexto, el build
# no puede ver shared/.
#
# Scripts reales que ejecuta el build (server/package.json):
#   "build": "node scripts/bundle-passkeys.mjs && tsc -p tsconfig.json
#              && node scripts/copy-assets.mjs"
# bundle-passkeys.mjs genera web/passkeys-client.js y
# web/recovery-client.js (ficheros ignorados en Git) antes de tsc;
# copy-assets.mjs deja dist/shared, dist/server/migrations y
# dist/server/web. Por eso el build NO es solo `tsc`.
#
# Arranque real (server/package.json):
#   "start":   "node --env-file-if-exists=.env dist/server/src/main.js"
#   "migrate": "node --env-file-if-exists=.env dist/server/src/migrate.js"
# Con WORKDIR /app/server, esas rutas son
# /app/server/dist/server/src/main.js y .../migrate.js.
# En el contenedor no hay fichero .env: las variables llegan por
# env_file de Compose (ver compose.yaml). --env-file-if-exists no
# hace nada si no existe, y no es un error.
#
# argon2 es dependencia nativa. En la etapa de build se instalan
# python3/make/g++ por si hace falta compilarla; en runtime se
# reutilizan los node_modules ya construidos en la etapa de build
# (misma imagen base, glibc), para no reinstalar sin herramientas.
#
FROM node:22-bookworm-slim AS build

# Herramientas por si alguna dependencia nativa (argon2) necesita
# compilarse. Solo en esta etapa; no llegan a la imagen final.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app/server

# Solo los ficheros necesarios para instalar dependencias. No se
# copia server/ entero: así no entran node_modules, dist ni .env
# locales en el contexto.
COPY server/package.json server/package-lock.json ./
RUN npm ci

# Ficheros que necesita el build. Rutas relativas al contexto
# (raíz del repo).
COPY server/tsconfig.json ./
COPY server/src ./src
COPY server/web ./web
COPY server/migrations ./migrations
COPY server/scripts ./scripts
COPY shared /app/shared

RUN npm run build

# ---------- Etapa de runtime ----------
FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production

WORKDIR /app/server

# node_modules ya construidos en la etapa de build (misma base).
COPY --from=build --chown=node:node /app/server/node_modules ./node_modules
# dist/ ya construido: dist/server/src/main.js, dist/server/src/migrate.js,
# dist/server/migrations (14 migraciones), dist/server/web y dist/shared.
COPY --from=build --chown=node:node /app/server/dist ./dist
# package.json para poder usar `npm run migrate` / `npm run start`
# dentro del contenedor si hace falta (el arranque de Compose usa
# `node` directamente, ver compose.yaml).
COPY --chown=node:node server/package.json ./package.json

USER node

EXPOSE 8080

# /health/live existe en el servicio (server/README.md): comprueba
# que el proceso responde. /health/ready hace además SELECT 1 a
# PostgreSQL. Aquí se usa /health/live para no acoplar el
# healthcheck del contenedor a la base de datos.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--env-file-if-exists=.env", "dist/server/src/main.js"]
