# syntax=docker/dockerfile:1

# NEXT_PUBLIC_* variables are inlined into the client bundle at build time —
# confirmed by apps/frontend/src/lib/axios.ts (`baseURL: process.env.NEXT_PUBLIC_API_URL`)
# and src/lib/companies.ts. It must be supplied as a build ARG, not just a
# runtime env var, or the deployed bundle would still point at localhost.

ARG NODE_VERSION=22-alpine

# ---- deps --------------------------------------------------------------
FROM node:${NODE_VERSION} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- builder -------------------------------------------------------------
FROM node:${NODE_VERSION} AS builder
WORKDIR /app
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
# Public Meta Embedded Signup identifiers — inlined into the client bundle and
# used to gate the CSP relaxation for Meta's SDK (never the app secret).
ARG NEXT_PUBLIC_WHATSAPP_APP_ID
ENV NEXT_PUBLIC_WHATSAPP_APP_ID=${NEXT_PUBLIC_WHATSAPP_APP_ID}
ARG NEXT_PUBLIC_WHATSAPP_CONFIG_ID
ENV NEXT_PUBLIC_WHATSAPP_CONFIG_ID=${NEXT_PUBLIC_WHATSAPP_CONFIG_ID}
# Public Cloudflare Turnstile site key — inlined into the client bundle and used
# to gate the CSP relaxation + render the login widget (never the secret, which
# stays backend-only as TURNSTILE_SECRET_KEY).
ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY
ENV NEXT_PUBLIC_TURNSTILE_SITE_KEY=${NEXT_PUBLIC_TURNSTILE_SITE_KEY}
# Espejo de CAPTCHA_ENABLED del backend: si es "true" y falta la site key, el
# build falla (build-guard) para no bloquear todos los logins.
ARG NEXT_PUBLIC_TURNSTILE_REQUIRED
ENV NEXT_PUBLIC_TURNSTILE_REQUIRED=${NEXT_PUBLIC_TURNSTILE_REQUIRED}
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---- runner: Next.js standalone output ------------------------------------
FROM node:${NODE_VERSION} AS runner
ENV NODE_ENV=production
WORKDIR /app

# Deployed-version identity for traceability (not consumed by the app at
# runtime — NEXT_PUBLIC_* is inlined at build — but useful on the image label).
ARG GIT_SHA=unknown
LABEL org.opencontainers.image.revision=$GIT_SHA

RUN addgroup -S nodeapp && adduser -S nextjs -G nodeapp

COPY --from=builder /app/public ./public
# .next/standalone already contains a pruned node_modules with only the
# packages actually traced/used at runtime — no separate prod-deps stage
# needed here, unlike the backend.
COPY --from=builder --chown=nextjs:nodeapp /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodeapp /app/.next/static ./.next/static

USER nextjs

ENV PORT=3000
ENV HOSTNAME=0.0.0.0
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/ || exit 1

CMD ["node", "server.js"]
