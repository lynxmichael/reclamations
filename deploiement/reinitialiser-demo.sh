#!/usr/bin/env bash
# =============================================================================
#  Remise à zéro de l'environnement de démonstration (étape 10)
#
#    ./deploiement/reinitialiser-demo.sh                   maintenant (par exemple avant un rendez-vous)
#    ./deploiement/reinitialiser-demo.sh --installer-cron  chaque nuit à DEMO_HEURE (heure du serveur, UTC)
#
#  Base recréée puis migrée, jeu de démonstration semé (deux banques, 60 jours d'historique jusqu'à
#  aujourd'hui), pièces jointes et Redis vidés : ce que les prospects ont saisi disparaît. Le site
#  répond « indisponible » pendant une à deux minutes.
#
#  Refusé ailleurs que sur l'environnement de démonstration : .env.demo doit contenir
#  DEMONSTRATION=1 et le projet docker compose s'appeler reclamations-demo.
# =============================================================================
set -Eeuo pipefail
# shellcheck source=commun.sh
. "$(dirname "$(readlink -f "$0")")/commun.sh"

env_fichier=$RACINE/.env.demo cron=0
while (($#)); do
  case $1 in
    --installer-cron) cron=1 ;;
    --env) env_fichier=${2:?}; shift ;;
    -h | --help) sed -n '4,14p' "$0" | sed 's/^# \{0,3\}//'; exit 0 ;;
    *) echo "Option inconnue : $1" >&2; exit 2 ;;
  esac
  shift
done
journal() { printf '%s  %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*"; }
arret() { journal "ARRÊT : $*" >&2; exit 1; }

# ---- Garde-fous : jamais sur la production ------------------------------------------------------------
[[ -r $env_fichier ]] || arret "$env_fichier introuvable (./deploiement/generer-env.sh --demo)"
env_fichier=$(readlink -f "$env_fichier")
est_demo || arret "$env_fichier ne contient pas DEMONSTRATION=1 : remise à zéro refusée"
projet=$(dc config 2>/dev/null | sed -n 's/^name: //p' | head -n 1)
[[ $projet == reclamations-demo ]] || arret "projet docker compose « ${projet:-?} » : seul reclamations-demo peut être remis à zéro"

if ((cron)); then
  [[ $EUID == 0 ]] || arret "--installer-cron : à lancer en root (sudo)"
  heure=$(valeur_env DEMO_HEURE)
  heure=${heure:-03:17}
  [[ $heure =~ ^([01][0-9]|2[0-3]):([0-5][0-9])$ ]] || arret "DEMO_HEURE invalide : $heure"
  # Heure du serveur : UTC sur les VPS Contabo (timedatectl pour le vérifier), l'heure d'Abidjan
  printf '# Remise à zéro nocturne de la démonstration (deploiement/reinitialiser-demo.sh)\n%s %s * * * root %q --env %q >> /var/log/reclamations-demo.log 2>&1\n' \
    "$((10#${BASH_REMATCH[2]}))" "$((10#${BASH_REMATCH[1]}))" "$RACINE/deploiement/reinitialiser-demo.sh" "$env_fichier" > /etc/cron.d/reclamations-demo
  chmod 644 /etc/cron.d/reclamations-demo
  journal "Remise à zéro planifiée chaque nuit à $heure (heure du serveur : $(date +%Z)) (/etc/cron.d/reclamations-demo, journal /var/log/reclamations-demo.log)"
  exit 0
fi

debut=$(date +%s)
journal "Remise à zéro de la démonstration ($(valeur_env DOMAINE_PLATEFORME))"

journal "1/6 Arrêt de l'API et du worker"
dc stop api worker

journal "2/6 Base recréée (même tri français que l'initialisation)"
# shellcheck disable=SC2016  # $POSTGRES_USER est celui du conteneur postgres
dc exec -T postgres sh -c 'psql -X -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres \
  -c "DROP DATABASE IF EXISTS reclamations WITH (FORCE)" \
  -c "CREATE DATABASE reclamations TEMPLATE template0 ENCODING '\''UTF8'\'' LOCALE_PROVIDER icu ICU_LOCALE '\''fr-FR'\'' LOCALE '\''C.UTF-8'\''"'

journal "3/6 Redis et pièces jointes vidés"
dc exec -T redis redis-cli FLUSHALL >/dev/null
dc run --rm --no-deps -T api sh -c 'find /donnees/fichiers -mindepth 1 -delete'

journal "4/6 Migrations"
dc run --rm -T migrations

journal "5/6 Jeu de démonstration"
dc run --rm --no-deps -T api node dist/scripts/semer.js

journal "6/6 Redémarrage"
dc up -d
for _ in $(seq 1 60); do
  [[ $(dc ps --format '{{.Health}}' api 2>/dev/null | head -n 1) == healthy ]] && break
  sleep 3
done
[[ $(dc ps --format '{{.Health}}' api 2>/dev/null | head -n 1) == healthy ]] || arret "l'API n'est pas saine après 3 minutes : docker compose … logs --tail 100 api"
journal "Démonstration remise à zéro en $(($(date +%s) - debut)) s"
