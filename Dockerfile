# syntax=docker/dockerfile:1.7
#
# Imagen de producción de Boutique POS. Se construye con:
#   docker compose --env-file .env.production -f docker-compose.prod.yml build
#
# Decisión: la imagen final conserva node_modules completo (con la CLI de Prisma y tsx) en vez de usar
# `output: "standalone"`. Pesa más (~1 GB) pero así el mismo contenedor aplica las migraciones al arrancar y puede
# ejecutar `pnpm admin:create-owner`, `pnpm db:reconcile` y `pnpm job:expire-layaways` sin imágenes extra.

ARG NODE_VERSION=24
FROM node:${NODE_VERSION}-bookworm-slim AS base
ENV CI=true
# openssl: Prisma lo busca para elegir su motor y, sin él, avisa «failed to detect libssl» (en rojo) en cada comando de arranque.
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
RUN npm install --global pnpm@12.15.0
WORKDIR /app

# ---- dependencias (capa que casi nunca cambia) ----
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# Sin `--mount=type=cache`: Railway exige que el id de un caché de construcción lleve el prefijo `s/<id del servicio>-` y rechaza
# el Dockerfile entero si falta. La capa de dependencias ya se reutiliza mientras no cambie el archivo de bloqueo.
RUN pnpm install --frozen-lockfile --store-dir /pnpm-store

# ---- compilación ----
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Valores solo para compilar (Next evalúa módulos que leen el entorno); no llegan a la imagen final.
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build \
    AUTH_SECRET=build-time-only-secret-not-used-at-runtime-0000 \
    APP_URL=http://localhost:3000
# next/font/google descarga la tipografía en este paso: la construcción necesita internet.
RUN pnpm db:generate && pnpm build

# ---- imagen final ----
FROM base AS runtime
ARG APP_VERSION=dev
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    APP_VERSION=${APP_VERSION} \
    PORT=3000 \
    UPLOADS_DIR=/data/uploads
COPY --from=build --chown=node:node /app /app
# Las fotos de los productos viven en un volumen montado aquí (docs/RUNBOOK.md §18); la carpeta existe y es de `node` para que
# Docker la copie con ese dueño al crear el volumen. Sin volumen, las fotos se perderían al actualizar la imagen.
RUN mkdir -p /data/uploads && chown -R node:node /data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["sh", "docker/entrypoint.sh"]
