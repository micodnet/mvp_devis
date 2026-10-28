# ────────────────────────────────────────────────────────────
# STAGE 1 — deps : installe TOUTES les deps + génère le client Prisma
# ────────────────────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app

# Prisma a besoin d'openssl sur alpine
RUN apk add --no-cache openssl

# On copie d'abord uniquement les manifestes → cache Docker optimal
COPY package.json package-lock.json* ./
COPY prisma ./prisma

# Install complet (dev + prod) puis génération du client Prisma
RUN npm ci && npx prisma generate

# ────────────────────────────────────────────────────────────
# STAGE 2 — builder : élague les devDependencies
# ────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package.json /app/package-lock.json* ./
COPY --from=deps /app/prisma ./prisma

# Ne garde que les deps de prod (mais conserve .prisma/client généré)
RUN npm prune --omit=dev

# ────────────────────────────────────────────────────────────
# STAGE 3 — runtime : image finale, minimale, non-root
# ────────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000

# openssl pour Prisma + wget pour le healthcheck
RUN apk add --no-cache openssl wget \
 && addgroup -S app -G app \
 && adduser -S app -G app

# node_modules élagué + client Prisma déjà généré
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

# Schéma Prisma (utile pour `prisma migrate deploy` en initContainer)
COPY --from=deps /app/prisma ./prisma

# Code source
COPY express ./express
COPY agents ./agents
COPY workers ./workers

# Propriété des fichiers à l'utilisateur non-root
RUN chown -R app:app /app
USER app

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

# Par défaut : l'API. Le worker utilise `command: ["node","workers/cron.js"]`
CMD ["node", "express/server.js"]