# Fonctions communes à sauvegarder.sh, restaurer.sh et planifier.sh (sourcé, jamais exécuté).
# shellcheck disable=SC2034  # variables utilisées par les scripts qui sourcent ce fichier
#
# Configuration (docker-compose.prod.yml, .env.production) :
#   PGHOST PGUSER PGPASSWORD PGDATABASE   propriétaire de la base (superutilisateur du conteneur postgres)
#   SAUVEGARDE_CLES_AGE        clés publiques age des destinataires (« age1… », séparées par des espaces)
#   SAUVEGARDE_DOSSIER         copies locales chiffrées (volume « sauvegardes »)
#   SAUVEGARDE_FICHIERS        pièces jointes et logos (volume « fichiers »)
#   SAUVEGARDE_S3_BUCKET       compartiment Contabo Object Storage ; vide = aucune copie hors du VPS
#   RCLONE_CONFIG_DISTANT_*    accès au compartiment (distant « distant » de rclone)
#   SAUVEGARDE_PING_URL        supervision « dead man's switch » (healthchecks.io ou compatible)
#   SAUVEGARDE_VERROU          verrouillage des copies hors du VPS (étape 12) : COMPLIANCE (par
#                              défaut), GOVERNANCE, ou « aucun » (compartiment sans verrouillage)

# Archives, fichiers extraits et clé : lisibles par le seul propriétaire
umask 077

DOSSIER=${SAUVEGARDE_DOSSIER:-/sauvegardes}
FICHIERS=${SAUVEGARDE_FICHIERS:-/donnees/fichiers}
BASE=${PGDATABASE:-reclamations}
BUCKET=${SAUVEGARDE_S3_BUCKET:-}
PREFIXE_ARCHIVE=reclamations-

journal() { printf '%s  %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*"; }
echec() { journal "ÉCHEC : $*" >&2; exit 1; }

# Taille lisible (octets -> « 12,3 Mo »)
taille() { if (($1 < 1024)); then echo "$1 o"; else numfmt --to=iec --format='%.1f' "$1" | sed 's/\./,/; s/\([KMGTP]\)$/ \1o/'; fi; }

VERROU=${SAUVEGARDE_VERROU:-COMPLIANCE}
case $VERROU in COMPLIANCE | GOVERNANCE | aucun) ;; *) echo "SAUVEGARDE_VERROU doit valoir COMPLIANCE, GOVERNANCE ou aucun (reçu : $VERROU)" >&2; exit 1 ;; esac
# Nom d'une version conservée par le compartiment, tel que rclone l'affiche avec --s3-versions :
# « reclamations-….tar-v2026-09-30-023012-000.age » (date de la version, avant l'extension)
MOTIF_VERSION='-v[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{6}-[0-9]{3}'

distant_configure() { [[ -n $BUCKET && -n ${RCLONE_CONFIG_DISTANT_ENDPOINT:-} ]]; }
distant() { printf 'distant:%s/%s' "$BUCKET" "$1"; }
# Relances en cas d'erreur réseau ; aucune barre de progression dans les journaux
rclone_() { rclone --retries 3 --low-level-retries 10 --contimeout 30s --timeout 10m --stats 0 -q "$@"; }

# Options d'envoi d'une copie verrouillée pour une durée (« 30d », « 12M ») : personne ne peut
# l'effacer ni la remplacer avant la date, pas même avec les clés du compartiment (COMPLIANCE)
verrou() { [[ $VERROU == aucun ]] || printf -- '--s3-object-lock-mode\n%s\n--s3-object-lock-retain-until-date\n%s\n' "$VERROU" "$1"; }

# Vérifie qu'une copie distante porte le verrou attendu, au moins jusqu'à la date donnée (secondes Unix)
verifier_verrou() { # verifier_verrou distant:… date_minimale
  [[ $VERROU == aucun ]] && return 0
  local meta mode jusqua
  meta=$(rclone_ lsjson --metadata "$1" | jq -c '.[0].Metadata // {}')
  mode=$(jq -r '.["object-lock-mode"] // ""' <<<"$meta")
  jusqua=$(jq -r '.["object-lock-retain-until-date"] // ""' <<<"$meta")
  [[ $mode == "$VERROU" ]] || { journal "Verrou absent sur $1 (mode « ${mode:-aucun} », attendu $VERROU)"; return 1; }
  if [[ -z $jusqua ]] || (($(date -u -d "$jusqua" +%s) < $2)); then
    journal "Verrou trop court sur $1 (jusqu'au ${jusqua:-?})"
    return 1
  fi
}

# Versions masquées ou remplacées : la rotation efface les copies expirées pour de bon, sans jamais
# laisser de marque de suppression ni d'ancienne version ; toute trace de ce genre vient d'ailleurs
# (suppression ou remplacement par quelqu'un qui a les clés). Une par ligne, avec sa taille.
versions_suspectes() {
  local d
  for d in quotidien mensuel; do
    rclone_ lsjson --s3-versions --s3-version-deleted "$(distant "$d/")" \
      | jq -r --arg d "$d" --arg motif "$MOTIF_VERSION" '.[] | select(.IsDir | not) | select(.Name | test($motif)) | "\($d)/\(.Name) \(.Size)"'
  done
}

# Destinataires age : « -r age1… » pour chaque clé ; refuse une clé mal formée
destinataires() {
  local cle n=0
  DESTINATAIRES=()
  for cle in ${SAUVEGARDE_CLES_AGE//,/ }; do
    [[ $cle =~ ^age1[02-9ac-hj-np-z]{58}$ ]] || echec "clé publique age invalide dans SAUVEGARDE_CLES_AGE : ${cle:0:12}…"
    DESTINATAIRES+=(-r "$cle")
    n=$((n + 1))
  done
  ((n > 0)) || echec "SAUVEGARDE_CLES_AGE est vide : aucune clé publique pour chiffrer les sauvegardes"
}

# Supervision : « start », « fail » ou succès (sans suffixe) ; corps facultatif (fin du journal)
signaler() {
  [[ -n ${SAUVEGARDE_PING_URL:-} ]] || return 0
  local url="${SAUVEGARDE_PING_URL%/}${1:+/$1}"
  if [[ -n ${2:-} && -f $2 ]]; then
    tail -c 10000 "$2" | curl -fsS -m 15 --retry 3 -o /dev/null --data-binary @- "$url" || journal "Signal de supervision non envoyé (${1:-succès})"
  else
    curl -fsS -m 15 --retry 3 -o /dev/null "$url" || journal "Signal de supervision non envoyé (${1:-succès})"
  fi
}

# Archives présentes dans le dossier local, de la plus récente à la plus ancienne
archives_locales() { find "$DOSSIER" -maxdepth 1 -type f -name "${PREFIXE_ARCHIVE}*.tar.age" -printf '%f\n' | sort -r; }
