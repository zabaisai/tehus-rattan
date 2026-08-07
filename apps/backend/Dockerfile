# syntax=docker/dockerfile:1

# Build/runtime commands were verified against apps/backend/package.json AND
# by actually running the built image (see dist/src/main note near CMD below):
#   - "build": "nest build"               -> emits ./dist (incl. dist/scripts/*.js)
#   - "start:prod": "node dist/src/main"  -> the real production entrypoint
# Prisma has no custom `output` in schema.prisma, so the generated client
# lives at the default node_modules/.prisma + node_modules/@prisma/client.

ARG NODE_VERSION=22-alpine

# ---- deps: full install (incl. devDependencies), used to build -------------
FROM node:${NODE_VERSION} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- builder: generate Prisma client + compile TypeScript -------------------
FROM node:${NODE_VERSION} AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate --schema=./prisma/schema.prisma
RUN npm run build

# ---- prod-deps: production-only node_modules (no devDependencies) ----------
FROM node:${NODE_VERSION} AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ---- runner: minimal final image -------------------------------------------
FROM node:${NODE_VERSION} AS runner
ENV NODE_ENV=production
WORKDIR /app

# Deployed-version identity, injected at build time (deploy.sh passes the exact
# git SHA + timestamp). Surfaced by the app via RELEASE_INFO — logged at startup
# and returned by GET /api/health/version. Not secrets.
ARG GIT_SHA=unknown
ARG BUILD_TIME=unknown
ENV RELEASE_SHA=$GIT_SHA
ENV BUILD_TIME=$BUILD_TIME
LABEL org.opencontainers.image.revision=$GIT_SHA

RUN addgroup -S nodeapp && adduser -S nestjs -G nodeapp

# Production node_modules, then overlay the Prisma client that was actually
# generated in `builder` — a plain `npm ci --omit=dev` cannot regenerate it
# because the `prisma` CLI is a devDependency and is not installed here.
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma/client ./node_modules/@prisma/client

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma

# Uploads are served from process.cwd()/uploads (see main.ts) and must exist
# with the right ownership before a named volume is first mounted here, since
# Docker seeds a fresh volume from the image directory's contents/owner.
RUN mkdir -p /app/uploads && chown -R nestjs:nodeapp /app/uploads

# CARPETA DE IMPORTACIONES, CREADA Y CON DUEÑO ANTES DE MONTAR EL VOLUMEN.
#
# Un volumen nombrado nuevo nace vacio y propiedad de root; el contenedor corre
# como `nestjs`, asi que no podria escribir en el. Docker inicializa el volumen
# copiando lo que la imagen tenga en ese punto de montaje —contenido Y dueño—,
# de modo que crearla aqui es lo que hace que backend y worker puedan escribir.
#
# Sin esto el arreglo del volumen compartido no serviria de nada: el archivo
# seguiria sin llegar al worker, ahora por permisos en vez de por ruta.
RUN mkdir -p /var/lib/takto/importaciones  && chown -R nestjs:nodeapp /var/lib/takto/importaciones

USER nestjs

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3001/api/health || exit 1

# dist/src/main.js, not dist/main.js: apps/backend/scripts/*.ts sits next to
# src/ as a sibling top-level folder, so tsc's inferred rootDir is the
# project root and mirrors that into dist/ (verified by actually running the
# built image — package.json's start:prod was pointing at the wrong path
# until this same fix).
#
# Migrations are NOT run here — they run as a controlled, separate step
# (`npx prisma migrate deploy`) from deploy.sh before this container starts,
# per the staging deployment procedure.
CMD ["node", "dist/src/main"]
