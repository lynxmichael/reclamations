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
# Puis les paquets « dev ou optionnels » seulement (devOptional dans package-lock.json) : la CLI
# Prisma et TypeScript, pairs facultatifs de @prisma/client, que « npm prune » garde. L'image de
# l'application passe de 386 à 137 Mo de dépendances, sans mysql2 ni deepmerge-ts, signalés par
# npm audit et jamais utilisés à l'exécution (étape 10) ; l'image des migrations garde la CLI.
RUN npm run build && npm prune --omit=dev --no-audit --no-fund \
 && node -e "const p=require('./package-lock.json').packages;for(const[k,v]of Object.entries(p))if(k&&v.devOptional)require('fs').rmSync(k,{recursive:true,force:true})" \
 && find node_modules/.bin -xtype l -delete

# ---- Migrations : prisma migrate deploy, lancé avant chaque démarrage de l'API ----
FROM dependances AS migrations
ENV NODE_ENV=production
CMD ["npx", "prisma", "migrate", "deploy"]

# ---- Application : API (par défaut) ou worker (node dist/src/worker.js) ------------
FROM node:22-bookworm-slim AS application
# Étiquette de l'image (VERSION de .env.production), publiée par /api/v1/sante
ARG VERSION=dev
ENV NODE_ENV=production \
    APP_VERSION=${VERSION} \
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
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/v1/sante').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "dist/src/main.js"]
