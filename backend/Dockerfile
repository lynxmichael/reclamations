# syntax=docker/dockerfile:1.7
# =============================================================================
#  Image de l'application (API et worker) — Plateforme de gestion des réclamations
#  Contexte de construction : la racine du dépôt (le contrat d'API est servi par l'API).
#
#    docker build -f backend/Dockerfile --target application -t reclamations-api .
#    docker build -f backend/Dockerfile --target migrations  -t reclamations-migrations .
# =============================================================================

# ---- Dépendances (dont Prisma CLI) et client Prisma généré ---------------------
FROM node:22-bookworm-slim AS dependances
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json backend/prisma.config.ts ./
COPY backend/prisma ./prisma
RUN npm ci --no-audit --no-fund

# ---- Compilation TypeScript, puis dépendances de production seules ---------------
FROM dependances AS construction
COPY backend/tsconfig.json backend/tsconfig.build.json ./
COPY backend/src ./src
COPY backend/scripts ./scripts
RUN npm run build && npm prune --omit=dev --no-audit --no-fund

# ---- Migrations : prisma migrate deploy, lancé avant chaque démarrage de l'API ----
FROM dependances AS migrations
ENV NODE_ENV=production
CMD ["npx", "prisma", "migrate", "deploy"]

# ---- Application : API (par défaut) ou worker (node dist/src/worker.js) ------------
FROM node:22-bookworm-slim AS application
ENV NODE_ENV=production \
    PORT=3000 \
    CONTRAT_CHEMIN=/app/contrat/openapi.yaml \
    STOCKAGE_DOSSIER=/donnees/fichiers
WORKDIR /app/backend
COPY --from=construction /app/backend/package.json ./
COPY --from=construction /app/backend/node_modules ./node_modules
COPY --from=construction /app/backend/dist ./dist
COPY contrat/openapi.yaml /app/contrat/openapi.yaml
RUN mkdir -p /donnees/fichiers && chown node:node /donnees/fichiers
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/v1/sante').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "dist/src/main.js"]
