#!/usr/bin/env bash
# =============================================================================
#  Sauvegarde chiffrée de la plateforme (étape 10)
#
#    sauvegarder              une sauvegarde maintenant (planifier.sh la lance chaque nuit)
#    sauvegarder --controler  vérifie la configuration sans rien sauvegarder, verrouillage compris
#    sauvegarder --preparer   crée le compartiment avec le verrouillage des objets, puis contrôle
#    sauvegarder --acquitter  après enquête, ne plus signaler les copies masquées ou remplacées déjà vues
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
#
#  Étape 12 : chaque copie hors du VPS est verrouillée (S3 Object Lock, mode SAUVEGARDE_VERROU)
#  pour toute sa durée de conservation. Qui prend le VPS a les clés du compartiment : il peut masquer
#  une copie ou en déposer une autre à la place, jamais effacer la version verrouillée. Chaque nuit,
#  la sauvegarde vérifie le verrou des copies envoyées et signale en échec toute copie masquée ou
#  remplacée : la rotation, elle, efface les copies expirées pour de bon, sans laisser de trace.
# =============================================================================
set -Eeuo pipefail
# shellcheck source=commun.sh
. "$(dirname "$(readlink -f "$0")")/commun.sh"

LOCALES=${SAUVEGARDE_LOCALES:-7}
JOURS=${SAUVEGARDE_JOURS:-30}
MOIS=${SAUVEGARDE_MOIS:-12}
for v in LOCALES JOURS MOIS; do [[ ${!v} =~ ^[1-9][0-9]*$ ]] || echec "SAUVEGARDE_$v doit être un entier positif"; done

ACQUITTEES=$DOSSIER/.versions-acquittees

# Le verrouillage fonctionne-t-il vraiment ? Une petite sonde verrouillée un jour, puis une tentative
# d'effacement qui doit être refusée. Les sondes expirées partent avec la rotation.
sonde_verrou() {
  local nom f
  nom="sonde-$(date -u +%Y%m%dT%H%M%SZ).txt"
  f=$(mktemp)
  echo "Sonde de verrouillage des sauvegardes, $(date -u)" >"$f"
  mapfile -t options < <(verrou 1d)
  if ! rclone_ copyto "${options[@]}" "$f" "$(distant "verrou/$nom")"; then
    rm -f "$f"
    journal "ATTENTION : envoi verrouillé refusé : le compartiment « $BUCKET » a-t-il été créé avec le verrouillage ? (sauvegarder --preparer, sur un nouveau compartiment ; si le mode $VERROU n'est pas pris en charge : SAUVEGARDE_VERROU=GOVERNANCE)"
    return 1
  fi
  rm -f "$f"
  verifier_verrou "$(distant "verrou/$nom")" $(($(date +%s) + 23 * 3600)) || {
    journal "ATTENTION : le compartiment accepte les copies sans les verrouiller (créé sans verrouillage ?)"
    return 1
  }
  if rclone --retries 1 --low-level-retries 1 --stats 0 -q delete --s3-versions --include "$nom" "$(distant verrou/)" 2>/dev/null \
    || [[ -z $(rclone_ lsf --s3-versions --include "$nom" "$(distant verrou/)") ]]; then
    journal "ATTENTION : une copie verrouillée a pu être effacée : le verrouillage ne protège pas ce compartiment"
    return 1
  fi
  journal "Verrouillage $VERROU : copie verrouillée, effacement refusé"
  [[ $VERROU == COMPLIANCE ]] || journal "ATTENTION : en mode $VERROU, des clés autorisées peuvent passer outre le verrou ; COMPLIANCE est recommandé"
}

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
    if [[ $VERROU == aucun ]]; then
      journal "ATTENTION : copies non verrouillées (SAUVEGARDE_VERROU=aucun) : qui prend le VPS peut les effacer"
    else
      sonde_verrou || ok=1
    fi
  else
    journal "ATTENTION : compartiment « $BUCKET » injoignable (adresse, clés ou nom du compartiment ; sauvegarder --preparer pour le créer)"
    ok=1
  fi
  return $ok
}

# Crée le compartiment avec le verrouillage des objets, qu'on ne peut pas activer après coup
preparer() {
  distant_configure || echec "renseigner d'abord SAUVEGARDE_S3_ENDPOINT, SAUVEGARDE_S3_BUCKET et les clés"
  if rclone_ lsf --max-depth 1 "distant:$BUCKET" >/dev/null 2>&1; then
    journal "Compartiment « $BUCKET » déjà créé : contrôle du verrouillage"
  else
    local options=()
    [[ $VERROU == aucun ]] || options=(--s3-bucket-object-lock-enabled)
    RCLONE_CONFIG_DISTANT_NO_CHECK_BUCKET=false rclone_ mkdir "${options[@]}" "distant:$BUCKET" \
      || echec "création du compartiment « $BUCKET » refusée (nom déjà pris ailleurs, clés sans droit de création ?)"
    journal "Compartiment « $BUCKET » créé$([[ $VERROU == aucun ]] || echo ", avec le verrouillage des objets")"
  fi
  controler
}

acquitter() {
  distant_configure || echec "copie hors du VPS non configurée"
  local liste
  liste=$(versions_suspectes)
  if [[ -z $liste ]]; then journal "Aucune copie masquée ou remplacée"; return 0; fi
  touch "$ACQUITTEES"
  sort -u -o "$ACQUITTEES" <(printf '%s\n' "$liste") "$ACQUITTEES"
  journal "$(wc -l <<<"$liste") trace(s) acquittée(s) : elles ne seront plus signalées ; les archives restent récupérables jusqu'à la fin de leur verrou (restaurer liste)"
}

case ${1:-} in
  --controler) controler; exit $? ;;
  --preparer) preparer; exit $? ;;
  --acquitter) acquitter; exit $? ;;
  '') ;;
  *) echec "usage : sauvegarder [--controler | --preparer | --acquitter]" ;;
esac
[[ $# -le 1 ]] || echec "usage : sauvegarder [--controler | --preparer | --acquitter]"

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

# ---- 6. Copie hors du VPS, verrouillée pour sa durée de conservation, puis rotation ---------------
distant_configure || echec "aucune copie hors du VPS : renseigner SAUVEGARDE_S3_BUCKET, SAUVEGARDE_S3_ENDPOINT et les clés (la copie locale est faite)"
envoyer() { # envoyer quotidien|mensuel durée date_minimale_du_verrou
  local options
  mapfile -t options < <(verrou "$2")
  rclone_ copyto "${options[@]}" "$DOSSIER/$nom" "$(distant "$1/$nom")"
  rclone_ copyto "${options[@]}" "$DOSSIER/$nom.sha256" "$(distant "$1/$nom.sha256")"
  # rclone compare taille et empreinte après l'envoi ; on relit tout de même la taille distante
  taille_distante=$(rclone_ lsjson "$(distant "$1/$nom")" | jq '.[0].Size')
  [[ $taille_distante == "$(stat -c %s "$DOSSIER/$nom")" ]] || echec "taille distante inattendue ($taille_distante octets)"
  verifier_verrou "$(distant "$1/$nom")" "$3" || echec "copie $1 envoyée mais pas verrouillée : voir sauvegarder --controler"
}
maintenant=$(date +%s)
envoyer quotidien "${JOURS}d" $((maintenant + JOURS * 86400 - 3600))
journal "Copiée vers $(distant quotidien/)$([[ $VERROU == aucun ]] || echo ", verrouillée $JOURS jours ($VERROU)")"

# Première sauvegarde réussie du mois : copie mensuelle, envoyée avec son propre verrou
mois=${horodatage:0:6}
if [[ -z $(rclone_ lsf --include "${PREFIXE_ARCHIVE}${mois}*.tar.age" "$(distant mensuel/)") ]]; then
  envoyer mensuel "$((MOIS * 31))d" $((maintenant + MOIS * 31 * 86400 - 3600))
  journal "Copie mensuelle : $(distant "mensuel/$nom")$([[ $VERROU == aucun ]] || echo ", verrouillée $((MOIS * 31)) jours")"
fi

# Copies masquées ou remplacées depuis la dernière nuit (hors rotation) : alerte, après la rotation
suspectes=$(versions_suspectes | sort)
nouvelles=$(comm -23 <(printf '%s\n' "$suspectes" | sed '/^$/d') <(sort "$ACQUITTEES" 2>/dev/null) || true)

# Rotation : chaque version expirée (verrou échu) est effacée pour de bon, marques de suppression
# comprises ; un jour de marge pour ne jamais buter sur un verrou qui finit dans la minute
tourner() { rclone_ --retries 1 delete --s3-versions --s3-version-deleted --min-age "$2" "$(distant "$1/")" || journal "ATTENTION : rotation de $1/ incomplète (copies encore verrouillées ?)"; }
tourner quotidien "$((JOURS + 1))d"
tourner mensuel "$((MOIS * 31 + 1))d"
tourner verrou 2d
journal "Hors du VPS : $(rclone_ lsf --include '*.tar.age' "$(distant quotidien/)" | wc -l) quotidienne(s), $(rclone_ lsf --include '*.tar.age' "$(distant mensuel/)" | wc -l) mensuelle(s)"

if [[ -n $nouvelles ]]; then
  journal "ALERTE : des copies hors du VPS ont été masquées ou remplacées en dehors de la rotation ($(wc -l <<<"$nouvelles") trace(s))."
  journal "Quelqu'un a utilisé les clés du compartiment : changez-les (panneau Contabo) et examinez le VPS."
  journal "Archives gardées par le verrou, restaurables telles quelles (restaurer <nom>) :"
  awk '$2 > 0 && $1 ~ /\.tar-v[0-9-]+\.age$/ { print "    distant:" $1 }' <<<"$nouvelles"
  journal "Après enquête : sauvegarder --acquitter"
  echec "copies hors du VPS masquées ou remplacées"
fi
journal "Sauvegarde $nom terminée"
