# syntax=docker/dockerfile:1.7
# Multi-stage build producing two images: `app` (Next.js) and `worker` (BullMQ jobs).
# Both run as a non-root user with only production dependencies.

FROM node:24.22.1-bookworm-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

# ── Dependencies ────────────────────────────────────────────────────────────
FROM base AS deps
COPY package.json package-lock.json .npmrc ./
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npm ci --no-audit --no-fund

# ── Build ───────────────────────────────────────────────────────────────────
FROM deps AS build
COPY . .
RUN npx prisma generate && npm run build

# ── Production node_modules (for worker + migrations) ───────────────────────
FROM base AS prod-deps
COPY package.json package-lock.json .npmrc ./
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npm ci --omit=dev --no-audit --no-fund && npm install --no-save --no-audit --no-fund prisma@7.10.1

# ── App image ───────────────────────────────────────────────────────────────
FROM base AS app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]

# ── Worker image (also runs migrations / seed as one-off commands) ──────────
FROM base AS worker
ENV NODE_ENV=production SERVICE_NAME=worker
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/src/generated ./src/generated
COPY --chown=node:node package.json prisma.config.ts ./
COPY --chown=node:node prisma ./prisma
USER node
CMD ["node", "dist/worker.mjs"]
