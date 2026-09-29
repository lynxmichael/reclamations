# syntax=docker/dockerfile:1.7
# =============================================================================
#  Image web (étape 8) — Caddy et les deux applications construites
#  Contexte de construction : la racine du dépôt (les écrans lisent contrat/openapi.yaml).
#
#    docker build -f frontend/Dockerfile -t reclamations-web .
#
#  /srv/console  : console du personnel, servie sur console.<domaine>
#  /srv/portail  : portail client, servi sur <slug>.<domaine>
#  /etc/caddy    : Caddyfile et commun.caddy (HTTPS, en-têtes, cache, CSP, /api vers l'API)
# =============================================================================

# ---- Construction des deux applications ----------------------------------------
FROM node:22-bookworm-slim AS construction
WORKDIR /depot/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY contrat/openapi.yaml /depot/contrat/openapi.yaml
COPY frontend/ ./
RUN npm run build:applications

# ---- Caddy ---------------------------------------------------------------------
FROM caddy:2.11.4 AS web
COPY docker/caddy/Caddyfile docker/caddy/commun.caddy /etc/caddy/
COPY --from=construction /depot/frontend/dist/console /srv/console
COPY --from=construction /depot/frontend/dist/portail /srv/portail
