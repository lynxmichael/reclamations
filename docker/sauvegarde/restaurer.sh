#!/usr/bin/env bash
# =============================================================================
#  Restauration d'une sauvegarde (étape 10)
#
#    restaurer liste                               archives locales et hors du VPS
#    restaurer <archive>                           VÉRIFICATION : restaure dans une base jetable,
#                                                  contrôle, puis la supprime (aucun effet sur la production)
#    restaurer --remplacer <archive>               REMPLACEMENT de la base de production
#
#  <archive> : derniere | reclamations-…tar.age (dossier local) | distant:quotidien/… | distant:mensuel/…
#  Options   : --oui (pas de question, pour --remplacer)  --garder (garde la base de vérification)
#
#  La clé privée age n'est jamais sur le VPS : elle est lue dans /run/secrets/cle-age si un fichier
#  y est monté, sinon saisie au clavier (rien ne s'affiche) et gardée en mémoire le temps de l'opération.
#
#  Contrôles : empreintes de l'archive, restauration sans erreur, chaînes du journal d'audit
#  (verifier_chaine_audit), politiques d'isolation présentes, chaque pièce jointe présente avec la
#  bonne empreinte SHA-256, chaque logo présent.
#
#  Les deux modes restaurent d'abord dans la base jetable reclamations_restauration et la
#  contrôlent : on ne remplace la production qu'avec une sauvegarde vérifiée. --remplacer bascule
#  ensuite les noms (l'API et le worker doivent être arrêtés) : la base actuelle devient
#  reclamations_avant_<date>, jamais supprimée par ce script ; les fichiers de l'archive sont ajoutés
#  au volume sans écraser l'existant (clés aléatoires, fichiers jamais modifiés).
# =============================================================================
set -Eeuo pipefail
# shellcheck source=commun.sh
. "$(dirname "$(readlink -f "$0")")/commun.sh"

usage() { sed -n '5,14p' "$(readlink -f "$0")" | sed 's/^# \{0,3\}//'; }

lister() {
  journal "Copies locales ($DOSSIER) :"
  local a
  while read -r a; do
    [[ -n $a ]] && printf '    %-40s %10s\n' "$a" "$(taille "$(stat -c %s "$DOSSIER/$a")")"
  done < <(archives_locales)
  if distant_configure; then
    for d in quotidien mensuel; do
      journal "Hors du VPS ($(distant "$d/")) :"
      while read -r octets _ _ nom_distant; do
        printf '    %-50s %10s\n' "distant:$d/$nom_distant" "$(taille "$octets")"
      done < <(rclone_ lsl --include '*.tar.age' "$(distant "$d/")" | sort -k4 -r)
    done
  else
    journal "Hors du VPS : non configuré"
  fi
}

mode=verification oui=0 garder=0 source=''
while (($#)); do
  case $1 in
    liste) lister; exit 0 ;;
    --remplacer) mode=remplacement ;;
    --oui) oui=1 ;;
    --garder) garder=1 ;;
    -h | --help) usage; exit 0 ;;
    -*) echec "option inconnue : $1" ;;
    *) [[ -z $source ]] || echec "une seule archive à la fois"; source=$1 ;;
  esac
  shift
done
[[ -n $source ]] || { usage; exit 1; }

debut=$(date +%s)
horodatage=$(date -u +%Y%m%d_%H%M%S)
travail=$(mktemp -d /tmp/restauration.XXXXXX)
cle=$(mktemp -p /dev/shm cle.XXXXXX 2>/dev/null || mktemp -p "$travail")
cible="${BASE}_restauration" base_creee=0 ancienne='' basculee=0
nettoyer() {
  local code=$?
  rm -rf "$travail" "$cle"
  if ((code != 0)) && [[ -n $ancienne ]] && ((basculee == 0)); then
    # Bascule interrompue : la base actuelle reprend son nom
    journal "Remplacement interrompu : la base actuelle reprend son nom"
    psql -Xq -d postgres -c "ALTER DATABASE \"$ancienne\" RENAME TO \"$BASE\"" || true
  fi
  if ((base_creee == 1 && basculee == 0)) && [[ $garder == 0 || $code != 0 ]]; then
    psql -Xq -d postgres -c "DROP DATABASE IF EXISTS \"$cible\" WITH (FORCE)" 2>/dev/null || true
  fi
  ((code == 0)) || journal "Restauration en échec (code $code) : la production n'a pas changé" >&2
}
trap nettoyer EXIT
sql() { psql -X -v ON_ERROR_STOP=1 -At -F $'\t' "$@"; }
export PGOPTIONS='-c client_min_messages=warning'

# ---- 1. Archive --------------------------------------------------------------------------------
case $source in
  derniere)
    nom=$(archives_locales | head -n 1)
    [[ -n $nom ]] || echec "aucune archive dans $DOSSIER"
    archive=$DOSSIER/$nom ;;
  distant:*)
    distant_configure || echec "copie hors du VPS non configurée (SAUVEGARDE_S3_BUCKET, SAUVEGARDE_S3_ENDPOINT)"
    nom=$(basename "${source#distant:}")
    archive=$travail/$nom
    journal "Téléchargement de $(distant "${source#distant:}")"
    rclone_ copyto "$(distant "${source#distant:}")" "$archive"
    rclone_ copyto "$(distant "${source#distant:}").sha256" "$archive.sha256" 2>/dev/null || true ;;
  *)
    if [[ -f $source ]]; then archive=$source; else archive=$DOSSIER/$source; fi
    [[ -f $archive ]] || echec "archive introuvable : $source (voir « restaurer liste »)"
    nom=$(basename "$archive") ;;
esac
journal "Archive : $nom ($(taille "$(stat -c %s "$archive")"))"
if [[ -f $archive.sha256 ]]; then
  (cd "$(dirname "$archive")" && sha256sum --quiet -c "$nom.sha256") || echec "empreinte de l'archive incorrecte : fichier endommagé"
  journal "Empreinte de l'archive : conforme"
fi

# ---- 2. Clé privée ------------------------------------------------------------------------------
if [[ -r ${SAUVEGARDE_CLE_PRIVEE:-/run/secrets/cle-age} ]]; then
  cat "${SAUVEGARDE_CLE_PRIVEE:-/run/secrets/cle-age}" > "$cle"
elif [[ -t 0 ]]; then
  read -rsp "Clé privée age (AGE-SECRET-KEY-1…, rien ne s'affiche) : " saisie
  echo
  printf '%s\n' "$saisie" > "$cle"
  unset saisie
else
  echec "clé privée absente : montez-la en /run/secrets/cle-age ou lancez la commande dans un terminal"
fi
grep -q '^AGE-SECRET-KEY-1' "$cle" || echec "clé privée age invalide (elle commence par AGE-SECRET-KEY-1)"

# ---- 3. Déchiffrement et empreintes du contenu --------------------------------------------------
contenu=$travail/contenu
mkdir "$contenu"
if ! age -d -i "$cle" "$archive" | tar -C "$contenu" -xf -; then
  echec "déchiffrement impossible : la clé ne correspond pas à cette archive, ou l'archive est endommagée"
fi
rm -f "$cle"
(cd "$contenu" && sha256sum --quiet -c SHA256SUMS) || echec "empreintes du contenu incorrectes"
journal "Contenu : $(jq -r '"sauvegarde du \(.cree_le), application \(.version_application), migration \(if (.derniere_migration // "") == "" then "inconnue" else .derniere_migration end), \(.fichiers) fichier(s)"' "$contenu/manifeste.json")"

# ---- 4. Rôles (idempotent, comme docker/postgres/init/02-roles.sh) -------------------------------
sql -q -d postgres <<'SQL'
SELECT 'CREATE ROLE acces_banque NOLOGIN' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'acces_banque') \gexec
SELECT 'CREATE ROLE acces_plateforme NOLOGIN' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'acces_plateforme') \gexec
SELECT 'CREATE ROLE acces_systeme NOLOGIN BYPASSRLS' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'acces_systeme') \gexec
SELECT 'CREATE ROLE reclamations_app LOGIN NOINHERIT' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'reclamations_app') \gexec
SET client_min_messages = warning;
GRANT acces_banque, acces_plateforme, acces_systeme TO reclamations_app;
SQL

# ---- 5. Restauration dans la base jetable ---------------------------------------------------------------
connexions() { sql -d postgres -c "SELECT count(*) FROM pg_stat_activity WHERE datname = '$BASE' AND pid <> pg_backend_pid()"; }
if [[ $mode == remplacement ]]; then
  n=$(connexions)
  ((n == 0)) || echec "$n connexion(s) ouverte(s) sur « $BASE » : arrêtez d'abord l'API et le worker (docker compose … stop api worker)"
fi
sql -q -d postgres -c "DROP DATABASE IF EXISTS \"$cible\" WITH (FORCE)"
sql -q -d postgres -c "CREATE DATABASE \"$cible\" TEMPLATE template0"
base_creee=1
journal "Restauration dans la base jetable « $cible »"
pg_restore --exit-on-error --no-password -j 2 -d "$cible" "$contenu/base.dump"
rm -f "$contenu/base.dump"
dossier_fichiers=$travail/fichiers
mkdir "$dossier_fichiers"
tar -C "$dossier_fichiers" --same-owner --numeric-owner -xf "$contenu/fichiers.tar"
rm -f "$contenu/fichiers.tar"

# ---- 6. Contrôles ------------------------------------------------------------------------------------------
problemes=0

chaines=0
while IFS=$'\t' read -r chaine valide _ rupture; do
  chaines=$((chaines + 1))
  if [[ $valide != t ]]; then
    journal "PROBLÈME : chaîne d'audit « $chaine » rompue à la ligne $rupture"
    problemes=$((problemes + 1))
  fi
done < <(sql -d "$cible" -c "SELECT c.chaine, v.valide, v.lignes, coalesce(v.premiere_rupture::text, '-')
                             FROM (SELECT DISTINCT chaine FROM journal_audit) c
                             CROSS JOIN LATERAL verifier_chaine_audit(c.chaine) v ORDER BY 1")
journal "Journal d'audit : $chaines chaîne(s), $(sql -d "$cible" -c "SELECT count(*) FROM journal_audit") ligne(s), $( ((problemes == 0)) && echo intactes || echo "$problemes rompue(s)")"

IFS=$'\t' read -r politiques tables_rls < <(sql -d "$cible" -c "SELECT (SELECT count(*) FROM pg_policies WHERE schemaname = 'public'),
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity)")
if ((politiques == 0 || tables_rls == 0)); then
  journal "PROBLÈME : isolation des banques absente ($politiques politique(s), $tables_rls table(s) sous RLS)"
  problemes=$((problemes + 1))
else
  journal "Isolation des banques : $politiques politique(s) sur $tables_rls table(s) sous RLS"
fi

pieces=0 logos=0 manquants=0 alteres=0
while IFS=$'\t' read -r genre empreinte cle_fichier; do
  if [[ $genre == piece ]]; then pieces=$((pieces + 1)); else logos=$((logos + 1)); fi
  if [[ ! -f $dossier_fichiers/$cle_fichier ]]; then
    manquants=$((manquants + 1))
    journal "PROBLÈME : fichier manquant $cle_fichier"
  elif [[ $genre == piece && $(sha256sum < "$dossier_fichiers/$cle_fichier" | cut -d' ' -f1) != "$empreinte" ]]; then
    alteres=$((alteres + 1))
    journal "PROBLÈME : empreinte incorrecte $cle_fichier"
  fi
done < <(sql -d "$cible" -c "SELECT 'piece', empreinte_sha256, cle_stockage FROM piece_jointe
                             UNION ALL SELECT 'logo', '-', logo_cle FROM banque WHERE logo_cle IS NOT NULL")
problemes=$((problemes + manquants + alteres))
journal "Fichiers : $pieces pièce(s) jointe(s) et $logos logo(s) ; $manquants manquant(s), $alteres altéré(s)"

journal "Contenu : $(sql -d "$cible" -c "SELECT format('%s banque(s), %s utilisateur(s), %s réclamation(s), %s notification(s)',
  (SELECT count(*) FROM banque), (SELECT count(*) FROM utilisateur), (SELECT count(*) FROM reclamation), (SELECT count(*) FROM notification))")"

((problemes == 0)) || echec "$problemes problème(s) : cette sauvegarde ne doit pas servir telle quelle"

if [[ $mode == verification ]]; then
  journal "Sauvegarde vérifiée en $(($(date +%s) - debut)) s : restaurable, journal d'audit intact, fichiers complets"
  ((garder == 0)) || journal "Base de vérification gardée : « $cible » (à supprimer ensuite)"
  exit 0
fi

# ---- 7. Bascule (--remplacer) ---------------------------------------------------------------------------------
if ((oui == 0)); then
  [[ -t 0 ]] || echec "remplacement sans terminal : ajoutez --oui"
  read -rp "Sauvegarde vérifiée. Remplacer la base « $BASE » par celle-ci ? Tapez REMPLACER : " reponse
  [[ $reponse == REMPLACER ]] || echec "abandon"
fi
n=$(connexions)
((n == 0)) || echec "$n connexion(s) ouverte(s) sur « $BASE » : arrêtez d'abord l'API et le worker"
if [[ $(sql -d postgres -c "SELECT count(*) FROM pg_database WHERE datname = '$BASE'") == 1 ]]; then
  ancienne="${BASE}_avant_${horodatage}"
  sql -q -d postgres -c "ALTER DATABASE \"$BASE\" RENAME TO \"$ancienne\""
fi
sql -q -d postgres -c "ALTER DATABASE \"$cible\" RENAME TO \"$BASE\""
basculee=1
[[ -n $ancienne ]] && journal "Base précédente conservée sous le nom « $ancienne »"
if [[ -n ${APP_DB_PASSWORD:-} ]]; then
  sql -q -d postgres -v mdp="$APP_DB_PASSWORD" <<<"ALTER ROLE reclamations_app PASSWORD :'mdp';"
fi
mkdir -p "$FICHIERS"
ajoutes=$(cd "$dossier_fichiers" && find . -type f | while read -r f; do [[ -e $FICHIERS/$f ]] || echo "$f"; done | wc -l)
tar -C "$dossier_fichiers" --numeric-owner -cf - . | tar -C "$FICHIERS" --skip-old-files --same-owner --numeric-owner -xf -
journal "Fichiers : $ajoutes ajouté(s) au volume, existants inchangés"

journal "Base « $BASE » remplacée en $(($(date +%s) - debut)) s. Suite :"
journal "  1. docker compose -f docker-compose.prod.yml --env-file .env.production up -d   (migrations plus récentes, puis API et worker)"
journal "  2. ./deploiement/verifier.sh   (contrôle du site)"
[[ -z $ancienne ]] || journal "  3. le service vérifié : docker compose … exec postgres dropdb -U \$POSTGRES_USER \"$ancienne\""
