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
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---- runner: Next.js standalone output ------------------------------------
FROM node:${NODE_VERSION} AS runner
ENV NODE_ENV=production
WORKDIR /app

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
