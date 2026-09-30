#!/usr/bin/env bash
# =============================================================================
#  Sauvegarde chiffrée de la plateforme (étape 10)
#
#    sauvegarder              une sauvegarde maintenant (planifier.sh la lance chaque nuit)
#    sauvegarder --controler  vérifie la configuration sans rien sauvegarder
#
#  Contenu de l'archive reclamations-AAAAMMJJTHHMMSSZ.tar.age (tar chiffré par age) :
#    base.dump        pg_dump -Fc de la base (instantané cohérent)
#    roles.sql        rôles du serveur, sans mot de passe (pour information : restaurer.sh les recrée)
#    fichiers.tar     pièces jointes et logos
#    manifeste.json   date, version de l'application, versions, tailles
#    SHA256SUMS       empreintes des quatre fichiers précédents
#
#  La base est lue avant les fichiers : une pièce jointe est écrite avant la ligne qui la
#  référence, donc toute pièce citée par la base figure dans l'archive.
#
#  Seules les clés publiques sont sur le VPS : qui prend le serveur ne peut pas lire les copies.
#  Copies : SAUVEGARDE_LOCALES dans le volume « sauvegardes » ; hors du VPS, quotidien/ garde
#  SAUVEGARDE_JOURS jours, mensuel/ la première sauvegarde de chaque mois pendant SAUVEGARDE_MOIS mois.
# =============================================================================
set -Eeuo pipefail
# shellcheck source=commun.sh
. "$(dirname "$(readlink -f "$0")")/commun.sh"

LOCALES=${SAUVEGARDE_LOCALES:-7}
JOURS=${SAUVEGARDE_JOURS:-30}
MOIS=${SAUVEGARDE_MOIS:-12}
for v in LOCALES JOURS MOIS; do [[ ${!v} =~ ^[1-9][0-9]*$ ]] || echec "SAUVEGARDE_$v doit être un entier positif"; done

controler() {
  local ok=0
  destinataires
  journal "Chiffrement : $((${#DESTINATAIRES[@]} / 2)) clé(s) publique(s) age"
  if psql -XAtqc 'SELECT 1' "$BASE" >/dev/null 2>&1; then journal "Base « $BASE » joignable"; else journal "ATTENTION : base « $BASE » injoignable"; ok=1; fi
  if [[ -r $FICHIERS ]]; then journal "Fichiers : $FICHIERS lisible"; else journal "ATTENTION : $FICHIERS illisible"; ok=1; fi
  if ! distant_configure; then
    journal "ATTENTION : aucune copie hors du VPS (SAUVEGARDE_S3_BUCKET ou SAUVEGARDE_S3_ENDPOINT vide) — chaque sauvegarde sera signalée en échec"
    ok=1
  elif rclone_ lsf --max-depth 1 "distant:$BUCKET" >/dev/null; then
    journal "Copie hors du VPS : compartiment « $BUCKET » joignable"
  else
    journal "ATTENTION : compartiment « $BUCKET » injoignable (adresse, clés ou nom du compartiment)"
    ok=1
  fi
  return $ok
}

if [[ ${1:-} == --controler ]]; then controler; exit $?; fi
[[ $# -eq 0 ]] || echec "usage : sauvegarder [--controler]"

mkdir -p "$DOSSIER"
horodatage=$(date -u +%Y%m%dT%H%M%SZ)
nom="${PREFIXE_ARCHIVE}${horodatage}.tar.age"
travail=$(mktemp -d /tmp/sauvegarde.XXXXXX)
journal_execution="$travail/journal.txt"
partiel="$DOSSIER/.$nom.partiel"

fin() {
  local code=$?
  if ((code == 0)); then
    touch "$DOSSIER/.derniere-reussite"
    signaler "" "$journal_execution"
  else
    journal "Sauvegarde $nom en échec (code $code)" >&2
    touch "$DOSSIER/.dernier-echec"
    signaler fail "$journal_execution"
  fi
  rm -rf "$travail" "$partiel"
}
trap fin EXIT
exec > >(tee -a "$journal_execution") 2>&1

signaler start
destinataires
journal "Sauvegarde $nom"

# ---- 1. Base : instantané cohérent, compressé, restaurable table par table ------------------
pg_dump -Fc -Z 6 --no-password -f "$travail/base.dump" "$BASE"
pg_dumpall --roles-only --no-role-passwords --no-password -f "$travail/roles.sql"

# ---- 2. Fichiers (après la base) ------------------------------------------------------------------
nb_fichiers=0
if [[ -d $FICHIERS ]]; then
  tar -C "$FICHIERS" --numeric-owner -cf "$travail/fichiers.tar" .
  nb_fichiers=$(find "$FICHIERS" -type f | wc -l)
else
  journal "ATTENTION : $FICHIERS absent, archive des fichiers vide"
  tar -C "$travail" -cf "$travail/fichiers.tar" --files-from /dev/null
fi

# ---- 3. Manifeste et empreintes ---------------------------------------------------------------------
jq -n \
  --arg cree_le "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg application "${VERSION:-inconnue}" \
  --arg serveur "$(psql -XAtqc 'SHOW server_version' "$BASE")" \
  --arg outils "$(pg_dump --version)" \
  --arg migration "$(psql -XAtqc "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name DESC LIMIT 1" "$BASE" 2>/dev/null || echo inconnue)" \
  --argjson base "$(stat -c %s "$travail/base.dump")" \
  --argjson fichiers "$nb_fichiers" \
  '{format: 1, cree_le: $cree_le, version_application: $application, derniere_migration: $migration,
    postgresql: {serveur: $serveur, outils: $outils}, base_octets: $base, fichiers: $fichiers}' \
  > "$travail/manifeste.json"
(cd "$travail" && sha256sum base.dump roles.sql fichiers.tar manifeste.json > SHA256SUMS)

# ---- 4. Chiffrement vers les clés publiques ; le fichier n'apparaît qu'une fois complet -------
tar -C "$travail" -cf - manifeste.json SHA256SUMS base.dump roles.sql fichiers.tar | age "${DESTINATAIRES[@]}" > "$partiel"
mv "$partiel" "$DOSSIER/$nom"
(cd "$DOSSIER" && sha256sum "$nom" > "$nom.sha256")
journal "Archive chiffrée : $(taille "$(stat -c %s "$DOSSIER/$nom")") (base $(taille "$(stat -c %s "$travail/base.dump")"), $nb_fichiers fichier(s))"

# ---- 5. Copies locales : les SAUVEGARDE_LOCALES plus récentes ----------------------------------
archives_locales | tail -n +$((LOCALES + 1)) | while read -r ancienne; do
  rm -f "$DOSSIER/$ancienne" "$DOSSIER/$ancienne.sha256"
done
journal "Copies locales : $(archives_locales | wc -l)"

# ---- 6. Copie hors du VPS, puis rétention -----------------------------------------------------------
distant_configure || echec "aucune copie hors du VPS : renseigner SAUVEGARDE_S3_BUCKET, SAUVEGARDE_S3_ENDPOINT et les clés (la copie locale est faite)"
rclone_ copyto "$DOSSIER/$nom" "$(distant "quotidien/$nom")"
rclone_ copyto "$DOSSIER/$nom.sha256" "$(distant "quotidien/$nom.sha256")"
# rclone compare taille et empreinte après l'envoi ; on relit tout de même la taille distante
taille_distante=$(rclone_ lsjson "$(distant "quotidien/$nom")" | jq '.[0].Size')
[[ $taille_distante == "$(stat -c %s "$DOSSIER/$nom")" ]] || echec "taille distante inattendue ($taille_distante octets)"
journal "Copiée vers $(distant quotidien/)"

# Première sauvegarde réussie du mois : copie mensuelle (copie côté serveur)
mois=${horodatage:0:6}
if [[ -z $(rclone_ lsf --include "${PREFIXE_ARCHIVE}${mois}*.tar.age" "$(distant mensuel/)") ]]; then
  rclone_ copyto "$(distant "quotidien/$nom")" "$(distant "mensuel/$nom")"
  rclone_ copyto "$(distant "quotidien/$nom.sha256")" "$(distant "mensuel/$nom.sha256")"
  journal "Copie mensuelle : $(distant "mensuel/$nom")"
fi

rclone_ delete --min-age "${JOURS}d" "$(distant quotidien/)"
rclone_ delete --min-age "$((MOIS * 31))d" "$(distant mensuel/)"
journal "Hors du VPS : $(rclone_ lsf --include '*.tar.age' "$(distant quotidien/)" | wc -l) quotidienne(s), $(rclone_ lsf --include '*.tar.age' "$(distant mensuel/)" | wc -l) mensuelle(s)"
journal "Sauvegarde $nom terminée"
