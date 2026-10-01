#!/usr/bin/env bash
# =============================================================================
#  Mise à jour et retour arrière en production (étape 10), sur le VPS, dans le dossier du dépôt.
#
#    ./deploiement/mettre-a-jour.sh 1.1.0     le code de la version 1.1.0 est déjà en place
#    ./deploiement/mettre-a-jour.sh --retour  revient à la version d'avant (ses images sont gardées)
#
#  Options : --portail SLUG (vérifié après le déploiement)  --sans-sauvegarde  --oui  --env FICHIER
#            (--env .env.demo : environnement de démonstration)
#
#  Mise à jour : sauvegarde immédiate, construction des images étiquetées 1.1.0 (le site tourne
#  encore sur l'ancienne version pendant ce temps), VERSION changée dans .env.production, migrations
#  puis redémarrage, contrôle complet (deploiement/verifier.sh). Le retour arrière relance les images
#  précédentes ; si la version annulée avait migré la base, il indique la sauvegarde à restaurer.
# =============================================================================
set -Eeuo pipefail
# shellcheck source=commun.sh
. "$(dirname "$(readlink -f "$0")")/commun.sh"

env_fichier=$RACINE/.env.production cible='' retour=0 sauvegarde=1 oui=0 portail=''
while (($#)); do
  case $1 in
    --retour) retour=1 ;;
    --sans-sauvegarde) sauvegarde=0 ;;
    --oui) oui=1 ;;
    --portail) portail=${2:?}; shift ;;
    --env) env_fichier=${2:?}; shift ;;
    -h | --help) sed -n '4,16p' "$0" | sed 's/^# \{0,3\}//'; exit 0 ;;
    -*) echo "Option inconnue : $1" >&2; exit 2 ;;
    *) cible=$1 ;;
  esac
  shift
done
env_fichier=$(readlink -f "$env_fichier")
cd "$RACINE"
PRECEDENT=$(dirname "$env_fichier")/.deploiement-precedent
VERIFIER=${VERIFIER:-$RACINE/deploiement/verifier.sh}

etape() { printf '\n==> %s\n' "$*"; }
arret() { printf '\nARRÊT : %s\n' "$*" >&2; exit 1; }
changer_version() { sed -i "s/^VERSION=.*/VERSION=$1/" "$env_fichier"; }
confirmer() {
  ((oui == 1)) && return 0
  [[ -t 0 ]] || arret "confirmation impossible hors d'un terminal : ajoutez --oui"
  read -rp "$1 [o/N] " r
  [[ $r =~ ^[oO] ]] || arret "abandon, rien n'a changé"
}

# Attend que l'API (migrations comprises), le worker et la sauvegarde soient sains
attendre_api() {
  attendre_sante 60 || arret "services pas tous sains après 3 minutes (ci-dessus) : docker compose … ps, puis … logs --tail 100 migrations api worker"
}

verifier_deploiement() {
  etape "Contrôle du déploiement"
  bash "$VERIFIER" --env "$env_fichier" --local ${portail:+--portail "$portail"} || arret "des contrôles échouent (ci-dessus) ; retour arrière possible : ./deploiement/mettre-a-jour.sh --retour"
}

[[ -r $env_fichier ]] || arret "$env_fichier introuvable (./deploiement/generer-env.sh)"
actuelle=$(valeur_env VERSION)

# ---- Retour arrière ------------------------------------------------------------------------------------
if ((retour)); then
  [[ -r $PRECEDENT ]] || arret "aucun déploiement précédent enregistré ($PRECEDENT)"
  lire_precedent() { sed -n "s/^$1=//p" "$PRECEDENT" | tail -n 1; }
  precedente=$(lire_precedent version)
  archive=$(lire_precedent sauvegarde)
  migrations=$(lire_precedent migrations)
  [[ -n $precedente ]] || arret "$PRECEDENT illisible"
  etape "Retour de la version $actuelle à la version $precedente"
  images=(application migrations web)
  est_demo || images+=(sauvegarde)
  for image in "${images[@]}"; do
    docker image inspect "reclamations-$image:$precedente" >/dev/null 2>&1 || arret "image reclamations-$image:$precedente absente : reconstruire l'ancienne version (./deploiement/mettre-a-jour.sh $precedente avec son code)"
  done
  if ((${migrations:-0} > 0)); then
    echo "La version $actuelle a appliqué $migrations migration(s) : la version $precedente tournera sur le nouveau schéma."
    echo "Si elle ne fonctionne pas, restaurer la sauvegarde faite avant la mise à jour${archive:+ ($archive)},"
    echo "au prix des saisies faites depuis : docs/exploitation.md, « Restaurer la production »."
  fi
  confirmer "Revenir à la version $precedente ?"
  printf 'version=%s\nsauvegarde=%s\nmigrations=0\ndate=%s\n' "$actuelle" "$archive" "$(date -u +%FT%TZ)" >"$PRECEDENT"
  changer_version "$precedente"
  dc up -d --no-build --pull never --remove-orphans
  attendre_api
  verifier_deploiement
  echo
  echo "Version $precedente rétablie. (--retour à nouveau pour repasser en $actuelle)"
  exit 0
fi

# ---- Mise à jour -------------------------------------------------------------------------------------------
[[ $cible =~ ^[0-9A-Za-z][0-9A-Za-z._-]{0,63}$ ]] || arret "version attendue, ex. ./deploiement/mettre-a-jour.sh 1.1.0"
[[ $cible != "$actuelle" ]] || confirmer "La version $cible est déjà déployée : reconstruire et redémarrer quand même ?"
etape "Mise à jour de la version $actuelle vers $cible"

# Migrations que cette version va appliquer (dossiers du code absents de la base)
# shellcheck disable=SC2016  # $POSTGRES_USER est celui du conteneur postgres
appliquees=$(dc exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d reclamations -XAtc "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL"' 2>/dev/null || true)
nouvelles=0
for d in backend/prisma/migrations/*/; do
  nom=$(basename "$d")
  grep -qx "$nom" <<<"$appliquees" || { nouvelles=$((nouvelles + 1)); echo "  migration à appliquer : $nom"; }
done
echo "  $nouvelles migration(s) à appliquer"

archive=''
if est_demo; then
  echo "  environnement de démonstration : pas de sauvegarde (données remises à zéro chaque nuit)"
elif ((sauvegarde)); then
  etape "Sauvegarde avant mise à jour"
  dc exec -T sauvegarde sauvegarder || arret "la sauvegarde a échoué : corriger (journal ci-dessus) ou relancer avec --sans-sauvegarde en connaissance de cause"
  archive=$(dc exec -T sauvegarde sh -c 'ls -1 /sauvegardes/reclamations-*.tar.age | sort | tail -n 1' | xargs -r basename)
  echo "  sauvegarde : $archive"
fi

etape "Construction des images $cible (le site tourne toujours en $actuelle)"
# --pull : dernières corrections de sécurité des images de base (node, postgres, caddy)
VERSION=$cible dc build --pull

etape "Déploiement"
printf 'version=%s\nsauvegarde=%s\nmigrations=%s\ndate=%s\n' "$actuelle" "$archive" "$nouvelles" "$(date -u +%FT%TZ)" >"$PRECEDENT"
changer_version "$cible"
dc up -d --remove-orphans
attendre_api
verifier_deploiement

echo
echo "Version $cible en production. Retour arrière : ./deploiement/mettre-a-jour.sh --retour"
echo "Anciennes images (garder la précédente) : docker image ls 'reclamations-*'"
