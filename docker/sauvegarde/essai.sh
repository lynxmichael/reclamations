#!/usr/bin/env bash
# =============================================================================
#  Essai de la sauvegarde et de la restauration, hors production (étape 10)
#
#    ESSAI_SOURCE=reclamations_test_sauvegarde docker/sauvegarde/essai.sh
#
#  Prérequis : PostgreSQL 16 (psql, pg_dump, pg_restore) joignable avec les variables PG* d'un
#  superutilisateur, age et age-keygen, rclone, curl, jq. La recette automatique le lance avec ces
#  outils (docker compose run --rm recette), sur une base semée pour l'occasion.
#  Compartiment hors du VPS simulé par moto (python3 -m moto.server, S3 avec verrouillage des
#  objets, étape 12) et rclone 1.70 ou plus ; sinon par « rclone serve s3 » ou un dossier, sans
#  verrouillage (contrôles du verrou non vérifiés). Supervision simulée si python3 est là.
#  ESSAI_SOURCE : une base migrée et semée, au journal d'audit intact (par défaut reclamations_navigateur).
#
#  Tout se passe dans des bases reclamations_essai* et un dossier temporaire, supprimés à la fin.
#  Le remplacement remet le mot de passe du rôle reclamations_app à ESSAI_MDP_APP (par défaut
#  « reclamations_app », celui du développement) : ne jamais lancer cet essai sur un serveur réel.
# =============================================================================
set -Euo pipefail
ICI=$(dirname "$(readlink -f "$0")")
SOURCE=${ESSAI_SOURCE:-reclamations_navigateur}
BASE=reclamations_essai
export PGDATABASE=$BASE

for outil in psql pg_dump pg_restore age age-keygen rclone curl jq; do
  command -v "$outil" >/dev/null || { echo "Outil manquant : $outil"; exit 2; }
done

T=$(mktemp -d /tmp/essai-sauvegarde.XXXXXX)
JOURNAL=${ESSAI_JOURNAL:-$T/sortie.txt}
DELAI=${ESSAI_DELAI_ETAPE:-120}
: >"$JOURNAL"
# Connexion à PostgreSQL bornée : jamais d'attente sans fin
export PGCONNECT_TIMEOUT=${PGCONNECT_TIMEOUT:-10}
reussis=0 echoues=0 ignores=0
ignore() { ignores=$((ignores + 1)); printf '  —      %s\n' "$1"; }
# Chaque étape est bornée (ESSAI_DELAI_ETAPE secondes, 120 par défaut) : une étape bloquée échoue
# et l'essai continue. Le journal détaillé (ESSAI_JOURNAL) reçoit chaque étape et toute sa sortie.
controle() { # controle "libellé" commande…
  local libelle=$1 debut code
  shift
  debut=$(date +%s)
  printf '\n==> %s\n' "$libelle" >>"$JOURNAL"
  if declare -F "$1" >/dev/null; then "$@" >>"$JOURNAL" 2>&1; else timeout "$DELAI" "$@" >>"$JOURNAL" 2>&1; fi
  code=$?
  if ((code == 0)); then
    reussis=$((reussis + 1)); printf '  ok     %s (%s s)\n' "$libelle" "$(($(date +%s) - debut))"
  else
    echoues=$((echoues + 1)); printf '  ÉCHEC  %s (%s s%s)\n' "$libelle" "$(($(date +%s) - debut))" "$( ((code == 124)) && echo ", arrêtée après $DELAI s")"
  fi
}
contient() { grep -q -- "$1" "$T/derniere.txt"; }
lancer() { timeout "$DELAI" "$@" >"$T/derniere.txt" 2>&1; local c=$?; cat "$T/derniere.txt" >>"$JOURNAL"; return $c; }
bases() { psql -XAtd postgres -c "SELECT datname FROM pg_database WHERE datname LIKE '${BASE}%' ORDER BY 1"; }

nettoyer() {
  [[ -n ${pid_s3:-} ]] && kill "$pid_s3" 2>/dev/null
  [[ -n ${pid_moto:-} ]] && kill "$pid_moto" 2>/dev/null
  [[ -n ${pid_ping:-} ]] && kill "$pid_ping" 2>/dev/null
  for b in $(bases); do psql -Xqd postgres -c "DROP DATABASE IF EXISTS \"$b\" WITH (FORCE)" 2>/dev/null; done
  ((echoues == 0)) || echo "Journal détaillé : $JOURNAL"
  [[ $JOURNAL == "$T"/* && $echoues -gt 0 ]] || rm -rf "$T"
}
trap nettoyer EXIT

# ---- Préparation : base d'essai, fichiers cohérents, clés, S3 et supervision simulés --------------
echo "Préparation (source : $SOURCE)"
for b in $(bases); do psql -Xqd postgres -c "DROP DATABASE \"$b\" WITH (FORCE)"; done
psql -Xqd postgres -c "CREATE DATABASE $BASE TEMPLATE \"$SOURCE\"" || exit 2
mkdir -p "$T/fichiers" "$T/sauvegardes" "$T/s3/essai" "$T/vieux"
# Au moins trois pièces jointes, même si la base source n'en a pas (contenus créés plus bas)
psql -Xqd "$BASE" -c "INSERT INTO piece_jointe (id, tenant_id, reclamation_id, nom_fichier, type_mime, taille_octets, cle_stockage, empreinte_sha256, depose_par_type)
  SELECT gen_random_uuid(), tenant_id, id, 'essai.pdf', 'application/pdf', 1, 'pieces-jointes/' || tenant_id || '/essai/' || md5(random()::text), repeat('0', 64), 'CLIENT'
  FROM reclamation LIMIT greatest(0, 3 - (SELECT count(*) FROM piece_jointe))"
# Un contenu aléatoire par pièce jointe et par logo ; les empreintes de la base d'essai sont alignées
while IFS=$'\t' read -r id cle; do
  mkdir -p "$(dirname "$T/fichiers/$cle")"
  head -c $((RANDOM + 100)) /dev/urandom >"$T/fichiers/$cle"
  [[ $id == logo ]] || psql -Xqd "$BASE" -c "SET session_replication_role = replica;
    UPDATE piece_jointe SET empreinte_sha256 = '$(sha256sum <"$T/fichiers/$cle" | cut -d' ' -f1)' WHERE id = '$id'"
done < <(psql -XAt -F $'\t' -d "$BASE" -c "SELECT id::text, cle_stockage FROM piece_jointe UNION ALL SELECT 'logo', logo_cle FROM banque WHERE logo_cle IS NOT NULL")
age-keygen -o "$T/cle1.txt" 2>/dev/null
age-keygen -o "$T/cle2.txt" 2>/dev/null
age-keygen -o "$T/autre.txt" 2>/dev/null

port_s3=$((20000 + RANDOM % 10000))
port_ping=$((port_s3 + 1))
# « rclone serve s3 » n'existe qu'à partir de rclone 1.65 (Debian et Ubuntu livrent la 1.60). Un
# « rclone serve <inconnu> --help » répond pourtant 0 : on cherche une option propre à serve s3, puis
# on attend que le serveur réponde. Sinon, dossier local : sans serveur, chaque appel rclone
# réessaierait pendant 4 minutes.
mode_distant='' verrou=0
# Verrouillage des copies (étape 12) : moto simule un S3 qui l'applique ; rclone 1.70 ou plus l'envoie
# (grep sans -q : avec pipefail, un grep -q qui s'arrête tôt fait échouer rclone sur SIGPIPE)
if rclone help flags 2>/dev/null | grep -- '--s3-object-lock-mode' >/dev/null && python3 -c 'import moto.server, flask' 2>/dev/null; then
  port_moto=$((port_s3 + 2))
  python3 -m moto.server -H 127.0.0.1 -p "$port_moto" >"$T/moto.txt" 2>&1 &
  pid_moto=$!
  for _ in $(seq 1 50); do
    curl -s -o /dev/null --noproxy "*" --max-time 1 "http://127.0.0.1:$port_moto/" && { mode_distant="S3 simulé avec verrouillage des objets (moto)"; verrou=1; break; }
    sleep 0.2
  done
  if ((verrou)); then
    export SAUVEGARDE_S3_BUCKET=essai SAUVEGARDE_VERROU=COMPLIANCE
    export RCLONE_CONFIG_DISTANT_TYPE=s3 RCLONE_CONFIG_DISTANT_PROVIDER=Other RCLONE_CONFIG_DISTANT_ENDPOINT=http://127.0.0.1:$port_moto
    export RCLONE_CONFIG_DISTANT_ACCESS_KEY_ID=ESSAI RCLONE_CONFIG_DISTANT_SECRET_ACCESS_KEY=SECRET-ESSAI RCLONE_CONFIG_DISTANT_NO_CHECK_BUCKET=true
  else
    kill "$pid_moto" 2>/dev/null
    pid_moto=''
  fi
fi
if [[ -z $mode_distant ]] && rclone serve s3 --help 2>&1 | grep -- '--auth-key' >/dev/null; then
  rclone serve s3 --auth-key ESSAI,SECRET-ESSAI --addr "127.0.0.1:$port_s3" --dir-cache-time 1s "$T/s3" >"$T/s3.txt" 2>&1 &
  pid_s3=$!
  for _ in $(seq 1 50); do
    curl -s -o /dev/null --noproxy "*" --max-time 1 "http://127.0.0.1:$port_s3/" && { mode_distant="S3 simulé (rclone serve s3)"; break; }
    sleep 0.2
  done
  if [[ -n $mode_distant ]]; then
    export SAUVEGARDE_S3_BUCKET=essai
    export RCLONE_CONFIG_DISTANT_TYPE=s3 RCLONE_CONFIG_DISTANT_PROVIDER=Other RCLONE_CONFIG_DISTANT_ENDPOINT=http://127.0.0.1:$port_s3
    export RCLONE_CONFIG_DISTANT_ACCESS_KEY_ID=ESSAI RCLONE_CONFIG_DISTANT_SECRET_ACCESS_KEY=SECRET-ESSAI RCLONE_CONFIG_DISTANT_NO_CHECK_BUCKET=true
  else
    kill "$pid_s3" 2>/dev/null
    pid_s3=''
  fi
fi
((verrou)) || export SAUVEGARDE_VERROU=aucun
if [[ -z $mode_distant ]]; then
  mode_distant="dossier local (rclone $(rclone version 2>/dev/null | head -n 1 | cut -d' ' -f2), sans « serve s3 »)"
  export SAUVEGARDE_S3_BUCKET=$T/s3/essai RCLONE_CONFIG_DISTANT_TYPE=local RCLONE_CONFIG_DISTANT_ENDPOINT=dossier-local
fi
echo "  hors du VPS : $mode_distant"
B=$SAUVEGARDE_S3_BUCKET
supervision=0
command -v python3 >/dev/null && supervision=1
cat >"$T/ping.py" <<EOF
import http.server
class H(http.server.BaseHTTPRequestHandler):
    def _r(self):
        n = int(self.headers.get('Content-Length') or 0)
        self.rfile.read(n)
        open('$T/pings.txt', 'a').write(self.path + '\n')
        self.send_response(200); self.end_headers()
    do_GET = do_POST = _r
    def log_message(self, *a): pass
http.server.HTTPServer(('127.0.0.1', $port_ping), H).serve_forever()
EOF
if ((supervision)); then
  python3 "$T/ping.py" &
  pid_ping=$!
fi
sleep 2

export NO_PROXY=127.0.0.1,localhost no_proxy=127.0.0.1,localhost
export SAUVEGARDE_DOSSIER=$T/sauvegardes SAUVEGARDE_FICHIERS=$T/fichiers VERSION=essai APP_DB_PASSWORD=${ESSAI_MDP_APP:-reclamations_app}
SAUVEGARDE_CLES_AGE="$(grep -o 'age1.*' "$T/cle1.txt") $(grep -o 'age1.*' "$T/cle2.txt")"
export SAUVEGARDE_CLES_AGE
if ((supervision)); then export SAUVEGARDE_PING_URL=http://127.0.0.1:$port_ping/essai; else export SAUVEGARDE_PING_URL=''; fi
# Compartiment créé avec le verrouillage des objets (étape 12), comme en production
if ((verrou)); then
  controle "compartiment créé avec le verrouillage ; sonde verrouillée, effacement refusé" lancer "$ICI/sauvegarder.sh" --preparer
fi
# Anciennes copies distantes (dates de modification dans le passé) pour la rétention. Avec le
# verrouillage, leur verrou finit dans quelques secondes (la rotation doit pouvoir les effacer),
# sauf une, encore verrouillée : la rotation doit la laisser sans faire échouer la sauvegarde.
fin_verrou=$(date -u -d '+8 seconds' +%Y-%m-%dT%H:%M:%SZ)
ancienne() { # ancienne quotidien|mensuel jours [verrou]
  local n
  n=reclamations-$(date -u -d "$2 days ago" +%Y%m%d)T023000Z.tar.age
  echo ancienne >"$T/vieux/$n"; touch -d "$2 days ago" "$T/vieux/$n"
  local o=()
  ((verrou)) && o=(--s3-object-lock-mode COMPLIANCE --s3-object-lock-retain-until-date "${3:-$fin_verrou}")
  timeout "$DELAI" rclone copyto -q "${o[@]}" "$T/vieux/$n" "distant:$B/$1/$n"
}
for jours in 10 31 45; do ancienne quotidien "$jours"; done
for jours in 200 400; do ancienne mensuel "$jours"; done
((verrou)) && ancienne quotidien 50 1d
((verrou)) && sleep 8
quotidiennes() { rclone -q lsf --include '*.tar.age' "distant:$B/quotidien/"; }
# Verrou d'une copie distante : « COMPLIANCE 29 » (mode, jours restants)
jours_de_verrou() {
  local m
  m=$(rclone -q lsjson --metadata "$1" | jq -r '.[0].Metadata | "\(.["object-lock-mode"]) \(.["object-lock-retain-until-date"])"')
  echo "${m%% *} $((($(date -u -d "${m#* }" +%s) - $(date +%s)) / 86400))"
}
verrous_attendus() {
  local q m
  q=$(jours_de_verrou "distant:$B/quotidien/$archive")
  m=$(jours_de_verrou "distant:$B/mensuel/$archive")
  echo "quotidienne : $q ; mensuelle : $m"
  [[ $q == "COMPLIANCE 29" || $q == "COMPLIANCE 30" ]] && [[ $m == "COMPLIANCE 371" || $m == "COMPLIANCE 372" ]]
}
verrouillee_gardee() {
  quotidiennes | grep "$(date -u -d '50 days ago' +%Y%m%d)" >/dev/null && grep -q 'rotation de quotidien/ incomplète' "$T/derniere.txt"
}

# ---- Sauvegarde ------------------------------------------------------------------------------------
echo "Sauvegarde"
controle "configuration contrôlée (clés, base, fichiers, compartiment)" "$ICI/sauvegarder.sh" --controler
controle "sauvegarde réussie" lancer "$ICI/sauvegarder.sh"
archive=$(find "$T/sauvegardes" -name 'reclamations-*.tar.age' -printf '%f\n' | sort | tail -1)
controle "archive chiffrée (en-tête age) et empreinte à côté" bash -c "head -c 40 '$T/sauvegardes/$archive' | grep -q 'age-encryption.org/v1' && test -f '$T/sauvegardes/$archive.sha256'"
controle "aucun contenu lisible sans la clé" bash -c "! grep -qa 'journal_audit' '$T/sauvegardes/$archive'"
controle "copie hors du VPS (quotidien/ et mensuel/)" bash -c "rclone -q lsf 'distant:$B/quotidien/' | grep -q '$archive' && rclone -q lsf 'distant:$B/mensuel/' | grep -q '$archive'"
controle "rétention : quotidiennes de plus de 30 jours et mensuelles de plus de 12 mois supprimées" \
  bash -c "[[ \$(rclone -q lsf --include '*.tar.age' 'distant:$B/quotidien/' | wc -l) == $((2 + verrou)) && \$(rclone -q lsf --include '*.tar.age' 'distant:$B/mensuel/' | wc -l) == 2 ]]"
if ((verrou)); then
  controle "  copie encore verrouillée gardée, sans faire échouer la sauvegarde" verrouillee_gardee
  controle "  verrous : quotidienne 30 jours, mensuelle 12 mois et plus (COMPLIANCE, 372 jours)" verrous_attendus
else
  ignore "verrouillage des copies : non vérifié (moto ou rclone 1.70 absent)"
fi
if ((supervision)); then
  controle "supervision : début puis succès signalés" bash -c "grep -qx /essai/start '$T/pings.txt' && grep -qx /essai '$T/pings.txt'"
else
  ignore "supervision non vérifiée (python3 absent)"
fi
controle "contrôle de santé : sain" "$ICI/sante.sh"
lancer "$ICI/sauvegarder.sh"
controle "une seule copie mensuelle par mois" bash -c "[[ \$(rclone -q lsf --include 'reclamations-$(date -u +%Y%m)*.tar.age' 'distant:$B/mensuel/' | wc -l) == 1 ]]"
controle "copies locales limitées (SAUVEGARDE_LOCALES=1)" bash -c "SAUVEGARDE_LOCALES=1 '$ICI/sauvegarder.sh' && [[ \$(find '$T/sauvegardes' -name '*.tar.age' | wc -l) == 1 ]]"

# ---- Vérification (base jetable) ---------------------------------------------------------------------
echo "Vérification d'une sauvegarde"
controle "vérification de la dernière sauvegarde (clé 1)" lancer env SAUVEGARDE_CLE_PRIVEE="$T/cle1.txt" "$ICI/restaurer.sh" derniere
controle "  journal d'audit intact, isolation présente, fichiers complets" bash -c "grep -q intactes '$T/derniere.txt' && grep -q 'politique(s) sur' '$T/derniere.txt' && grep -q '0 manquant(s), 0 altéré(s)' '$T/derniere.txt'"
controle "  base jetable supprimée" bash -c "[[ \$(psql -XAtd postgres -c \"SELECT count(*) FROM pg_database WHERE datname = '${BASE}_restauration'\") == 0 ]]"
distante=$(quotidiennes | sort | tail -1)
controle "vérification d'une copie hors du VPS (clé 2)" lancer env SAUVEGARDE_CLE_PRIVEE="$T/cle2.txt" "$ICI/restaurer.sh" "distant:quotidien/$distante"
controle "clé d'une autre installation refusée" bash -c "! SAUVEGARDE_CLE_PRIVEE='$T/autre.txt' '$ICI/restaurer.sh' derniere"
cp "$T/sauvegardes/$(find "$T/sauvegardes" -name '*.tar.age' -printf '%f\n' | tail -1)" "$T/alteree.tar.age"
printf '\x00\x01' | dd of="$T/alteree.tar.age" bs=1 seek=4000 conv=notrunc 2>/dev/null
controle "archive endommagée refusée" bash -c "! SAUVEGARDE_CLE_PRIVEE='$T/cle1.txt' '$ICI/restaurer.sh' '$T/alteree.tar.age'"
controle "sans clé ni terminal : refus" bash -c "! '$ICI/restaurer.sh' derniere </dev/null"

# Journal d'audit modifié à la main et fichiers perdus : la vérification le signale
psql -Xqd postgres -c "CREATE DATABASE ${BASE}_falsifiee TEMPLATE $BASE"
psql -Xqd "${BASE}_falsifiee" -c "SET session_replication_role = replica;
  UPDATE journal_audit SET donnees = '{\"falsifie\": true}' WHERE rang = 3 AND chaine = (SELECT min(chaine) FROM journal_audit)"
cp -a "$T/fichiers" "$T/fichiers-abimes"
rm "$(find "$T/fichiers-abimes/pieces-jointes" -type f | sort | head -1)"
mkdir -p "$T/sauvegardes-falsifiees"
PGDATABASE=${BASE}_falsifiee SAUVEGARDE_DOSSIER=$T/sauvegardes-falsifiees SAUVEGARDE_FICHIERS=$T/fichiers-abimes SAUVEGARDE_S3_BUCKET='' \
  timeout "$DELAI" "$ICI/sauvegarder.sh" >>"$JOURNAL" 2>&1
controle "sans copie hors du VPS : sauvegarde locale faite mais signalée en échec" bash -c "{ ((! $supervision)) || grep -qx /essai/fail '$T/pings.txt'; } && [[ \$(find '$T/sauvegardes-falsifiees' -name '*.tar.age' | wc -l) == 1 ]]"
controle "contrôle de santé : malsain après un échec" bash -c "! SAUVEGARDE_DOSSIER='$T/sauvegardes-falsifiees' '$ICI/sante.sh'"
lancer env PGDATABASE="${BASE}_falsifiee" SAUVEGARDE_DOSSIER="$T/sauvegardes-falsifiees" SAUVEGARDE_CLE_PRIVEE="$T/cle1.txt" "$ICI/restaurer.sh" derniere
controle "journal d'audit falsifié : sauvegarde refusée, ligne rompue nommée" bash -c "grep -q 'rompue à la ligne 3' '$T/derniere.txt' && grep -q 'ne doit pas servir' '$T/derniere.txt'"
controle "pièce jointe perdue : signalée" bash -c "grep -q 'fichier manquant' '$T/derniere.txt'"

# ---- Remplacement ---------------------------------------------------------------------------------------
echo "Remplacement de la base"
psql -Xqc "SELECT pg_sleep(6)" >/dev/null 2>&1 &
connexion=$!
sleep 1
controle "refusé tant que l'application est connectée" bash -c "! SAUVEGARDE_CLE_PRIVEE='$T/cle1.txt' '$ICI/restaurer.sh' --remplacer --oui derniere"
wait "$connexion"
controle "refusé sans --oui hors d'un terminal" bash -c "! SAUVEGARDE_CLE_PRIVEE='$T/cle1.txt' '$ICI/restaurer.sh' --remplacer derniere </dev/null"
perdu=$(find "$T/fichiers/pieces-jointes" -type f | sort | head -1)
rm "$perdu"
psql -Xqc "SET session_replication_role = replica; DELETE FROM notification WHERE ctid IN (SELECT ctid FROM notification LIMIT 5)"
avant=$(psql -XAtc "SELECT count(*) FROM notification")
controle "remplacement réussi" lancer env SAUVEGARDE_CLE_PRIVEE="$T/cle1.txt" "$ICI/restaurer.sh" --remplacer --oui derniere
controle "  données de la sauvegarde rétablies" bash -c "[[ \$(psql -XAtc 'SELECT count(*) FROM notification') == \$(($avant + 5)) ]]"
controle "  ancienne base conservée sous un autre nom" bash -c "psql -XAtd postgres -c \"SELECT datname FROM pg_database\" | grep -q '^${BASE}_avant_'"
controle "  fichier perdu remis en place" test -f "$perdu"
controle "  rôle de l'application : connexion, isolation par banque active" bash -c "
  t=\$(psql -XAtc 'SELECT tenant_id FROM reclamation LIMIT 1');
  n=\$(PGUSER=reclamations_app PGPASSWORD=\$APP_DB_PASSWORD psql -XAtq -c \"BEGIN; SET LOCAL ROLE acces_banque; SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000000', true); SELECT count(*) FROM reclamation; COMMIT;\" | sed -n 2p);
  [[ -n \$t && \$n == 0 ]]"

# ---- Copies protégées contre l'effacement (étape 12) -------------------------------------------------------
# Un intrus a les clés du compartiment (celles du VPS) : il supprime, purge, remplace. Les versions
# verrouillées doivent survivre, la sauvegarde suivante doit donner l'alerte, et chaque copie
# masquée ou remplacée doit rester restaurable.
copies() { # « dossier/nom taille » de chaque vraie archive (les anciennes simulées, au verrou échu, à part)
  local d
  for d in quotidien mensuel; do
    rclone -q lsjson --s3-versions "distant:$B/$d/" \
      | jq -r --arg d "$d" '.[] | select(.Size > 100) | select(.Name | test("\\.tar(-v[0-9-]+)?\\.age$")) | "\($d)/\(.Name | sub("-v[0-9-]+\\.age$"; ".age")) \(.Size)"'
  done | sort
}
attaque() {
  rclone -q --retries 1 purge "distant:$B"
  rclone -q --retries 1 delete --s3-versions "distant:$B/mensuel/"
  echo "rançon" >"$T/rancon.tar.age"
  rclone -q --retries 1 copyto "$T/rancon.tar.age" "distant:$B/mensuel/$archive"
  rclone -q --retries 1 delete "distant:$B/quotidien/"
  return 0
}
rien_perdu() { comm -23 "$T/copies-avant.txt" <(copies) >"$T/perdues.txt"; cat "$T/perdues.txt"; [[ ! -s $T/perdues.txt ]]; }
intrusion_signalee() {
  ! lancer "$ICI/sauvegarder.sh" && grep -q 'ALERTE' "$T/derniere.txt" && grep -q '^    distant:quotidien/.*\.tar-v.*\.age$' "$T/derniere.txt" \
    && { ((! supervision)) || [[ $(tail -n 1 "$T/pings.txt") == /essai/fail ]]; }
}
masquee() { rclone -q lsf --s3-versions "distant:$B/$1/" | grep "^${archive%.tar.age}\.tar-v.*\.age$" | head -n 1; }
sans_verrou_detecte() {
  RCLONE_CONFIG_DISTANT_NO_CHECK_BUCKET=false rclone -q mkdir "distant:sans-verrou"
  ! SAUVEGARDE_S3_BUCKET=sans-verrou lancer "$ICI/sauvegarder.sh" --controler && grep -q 'verrou' "$T/derniere.txt"
}
if ((verrou)); then
  echo "Copies protégées contre l'effacement"
  copies >"$T/copies-avant.txt"
  controle "intrus avec les clés : suppression, purge et remplacement tentés" attaque
  controle "  aucune copie verrouillée perdue ($(wc -l <"$T/copies-avant.txt") archives)" rien_perdu
  controle "  la sauvegarde suivante donne l'alerte (échec signalé)" intrusion_signalee
  controle "  « restaurer liste » montre les copies masquées ou remplacées" bash -c "'$ICI/restaurer.sh' liste | grep -q 'masquée ou remplacée'"
  controle "  copie masquée restaurée et vérifiée (clé 2)" lancer env SAUVEGARDE_CLE_PRIVEE="$T/cle2.txt" "$ICI/restaurer.sh" "distant:quotidien/$(masquee quotidien)"
  controle "  copie remplacée par l'intrus refusée ; l'originale, restaurable" bash -c "! SAUVEGARDE_CLE_PRIVEE='$T/cle1.txt' '$ICI/restaurer.sh' 'distant:mensuel/$archive' && [[ -n '$(masquee mensuel)' ]]"
  controle "  après acquittement, les sauvegardes repassent au vert" bash -c "'$ICI/sauvegarder.sh' --acquitter && '$ICI/sauvegarder.sh'"
  controle "compartiment créé sans verrouillage : détecté" sans_verrou_detecte
else
  ignore "copies protégées contre l'effacement : non vérifié (moto ou rclone 1.70 absent)"
fi

echo
echo "Sauvegarde et restauration : $reussis/$((reussis + echoues)) contrôles réussis$( ((ignores == 0)) || echo ", $ignores non vérifié(s)")"
((echoues == 0))
