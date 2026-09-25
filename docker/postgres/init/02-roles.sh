#!/usr/bin/env bash
# Exécuté une seule fois par l'image postgres, à la création du volume.
# Crée les rôles d'accès et le rôle de connexion de l'application.
# Les migrations Prisma (étape 3) accordent ensuite les droits table par table.
set -euo pipefail

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  --set=mot_de_passe="${APP_DB_PASSWORD:?APP_DB_PASSWORD manquant}" <<'EOSQL'
CREATE ROLE acces_banque NOLOGIN;
CREATE ROLE acces_plateforme NOLOGIN;
CREATE ROLE acces_systeme NOLOGIN BYPASSRLS;
-- NOINHERIT : sans « SET ROLE » explicite, ce rôle n'a aucun droit
CREATE ROLE reclamations_app LOGIN NOINHERIT PASSWORD :'mot_de_passe';
GRANT acces_banque, acces_plateforme, acces_systeme TO reclamations_app;
EOSQL
