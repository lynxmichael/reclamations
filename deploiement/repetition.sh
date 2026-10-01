#!/usr/bin/env bash
# =============================================================================
#  Répétition locale complète du déploiement (étape 13), sur un poste avec Docker
#
#  Sous Windows : .\deploiement\repetition.ps1 <commande>   (PowerShell, lance ce script dans le
#  conteneur d'outils). Sous Linux ou macOS : ./deploiement/repetition.sh <commande>.
#
#    installer              installation complète, comme sur le VPS (docs/exploitation.md, partie 5)
#    verifier [--portail S] contrôle du déploiement (deploiement/verifier.sh --local)
#    sauvegarde             sauvegarde, vérification de la dernière archive, liste des copies
#    intrusion              un intrus efface les copies hors du VPS : alerte, restauration, acquittement
#    restauration           remplacement de la base par la dernière sauvegarde (partie 10 du guide)
#    mise-a-jour VERSION    mise à jour (deploiement/mettre-a-jour.sh), par exemple 1.0.1
#    retour                 retour à la version précédente
#    demo                   environnement de démonstration (arrête la répétition de la production)
#    totp E-MAIL            code de double authentification d'un compte de démonstration
#    demarrer | arreter     relance (après un redémarrage de Docker) ou arrête, sans rien effacer
#    etat                   conteneurs, adresses et comptes
#    supprimer              efface la répétition : conteneurs, volumes, secrets et clé de sauvegarde
#
#  --demo : la commande porte sur la démonstration (verifier, mise-a-jour, retour, demarrer,
#  arreter, etat, supprimer). --oui : pas de question (restauration, supprimer).
#
#  Tout ce que la répétition crée sur le poste est dans .repetition/ (jamais dans le dépôt ni dans
#  une archive) : fichier d'environnement et secrets, clé privée de sauvegarde, autorité locale.
# =============================================================================
set -Eeuo pipefail
# shellcheck source=commun.sh
. "$(dirname "$(readlink -f "$0")")/commun.sh"
cd "$RACINE"

commande=${1:-aide}
(($# == 0)) || shift
demo=0 oui=0 args=()
for a; do
  case $a in
    --demo) demo=1 ;;
    --oui) oui=1 ;;
    *) args+=("$a") ;;
  esac
done
[[ $commande != demo ]] || { commande=installer; demo=1; }

if ((demo)); then
  DOSSIER=$RACINE/.repetition/demonstration DOMAINE=demo.reclamations.localhost PROJET=reclamations-demo AUTRE=reclamations-repetition
  NOM="la démonstration" OPT_DEMO=' --demo'
else
  DOSSIER=$RACINE/.repetition/production DOMAINE=reclamations.localhost PROJET=reclamations-repetition AUTRE=reclamations-demo
  NOM="la production" OPT_DEMO=''
fi
env_fichier=$DOSSIER/.env
CLE=$DOSSIER/cle-age.txt
MAILPIT="http://localhost:${REPETITION_PORT_MAILPIT:-8026}"
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT

etape() { printf '\n==> %s\n' "$*"; }
vps() { printf '    (sur le VPS : %s)\n' "$*"; }
info() { printf '    %s\n' "$*"; }
arret() { printf '\nARRÊT : %s\n' "$*" >&2; exit 1; }
confirmer() {
  ((oui)) && return 0
  [[ -t 0 ]] || arret "confirmation impossible hors d'un terminal : ajoutez --oui"
  read -rp "$1 [o/N] " r
  [[ $r =~ ^[oO] ]] || arret "abandon, rien n'a changé"
}
relatif() { printf '%s' "${1#"$RACINE"/}"; }
# Journal des scripts de sauvegarde, sans l'horodatage de chaque ligne, en retrait
sans_heure() { sed -E 's/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:]{8}Z  //; s/^/    /'; }

exiger_docker() {
  command -v docker >/dev/null || arret "docker introuvable"
  docker info >/dev/null 2>&1 || arret "Docker ne répond pas : lancez Docker Desktop, attendez « Engine running », puis recommencez"
}
exiger_installee() {
  [[ -r $env_fichier ]] || arret "répétition de $NOM pas encore installée : repetition installer$OPT_DEMO"
}
exiger_production() {
  ((demo == 0)) || arret "pas de sauvegarde en démonstration (comme sur le serveur de démonstration)"
  exiger_installee
}

# ---- Fichier d'environnement : celui de la production, avec les réglages propres au poste ------------------
regler() { # regler CLE valeur : remplace la ligne CLE=…, ou l'ajoute
  local v=${2//\\/\\\\}
  v=${v//&/\\&}
  v=${v//|/\\|}
  if grep -q "^$1=" "$env_fichier"; then sed -i "s|^$1=.*|$1=$v|" "$env_fichier"; else printf '%s=%s\n' "$1" "$2" >>"$env_fichier"; fi
}
preparer_env() {
  [[ ! -r $env_fichier ]] || return 0
  etape "Fichier d'environnement $(relatif "$env_fichier"), secrets tirés au hasard"
  vps "./deploiement/generer-env.sh$OPT_DEMO --domaine <domaine> --acme <adresse>"
  mkdir -p "$DOSSIER"
  local options=(--domaine "$DOMAINE" --acme "exploitation@$DOMAINE" --sortie "$env_fichier")
  if ((demo)); then options+=(--demo); fi
  bash "$RACINE/deploiement/generer-env.sh" "${options[@]}" >/dev/null
  regler SMTP_URL smtp://mailpit:1025
  if ((demo == 0)); then
    # Clé de chiffrement des sauvegardes : sur le VPS, la clé privée reste sur un poste de confiance ;
    # ici, elle est dans .repetition/production/ pour que les vérifications se fassent sans saisie
    etape "Clé de chiffrement des sauvegardes (age-keygen) et compartiment simulé"
    vps "age-keygen sur un poste de confiance ; la clé publique dans SAUVEGARDE_CLES_AGE"
    [[ -r $CLE ]] || age-keygen -o "$CLE" 2>/dev/null
    regler SAUVEGARDE_CLES_AGE "$(sed -n 's/^# public key: //p' "$CLE")"
    regler SAUVEGARDE_S3_ENDPOINT http://s3:5000
    regler SAUVEGARDE_S3_BUCKET reclamations-repetition
    regler SAUVEGARDE_S3_CLE repetition
    regler SAUVEGARDE_S3_SECRET repetition-secret-simule
    info "clé publique : $(sed -n 's/^# public key: //p' "$CLE")"
  fi
  # Depuis le conteneur d'outils, Caddy se joint par le poste (host.docker.internal), comme depuis
  # Internet ; lancé directement sous Linux ou macOS, par 127.0.0.1
  local ip=127.0.0.1
  [[ ! -e /.dockerenv ]] || ip=host.docker.internal
  {
    printf '\n# ---- Répétition locale (étape 13, deploiement/repetition.sh) ----------------------------------\n'
    printf '# Ajoute docker-compose.repetition.yml : autorité de certification locale, Mailpit, S3 simulé\n'
    printf 'REPETITION=1\n'
    ((demo)) || printf 'COMPOSE_PROJECT_NAME=%s\n' "$PROJET"
    printf '# Contrôles de deploiement/verifier.sh : adresse de Caddy et autorité locale (chemin relatif à ce fichier)\n'
    printf 'VERIFICATION_IP=%s\n' "$ip"
    printf 'VERIFICATION_CA=autorite-locale.crt\n'
  } >>"$env_fichier"
}

# ---- Ports 80 et 443 : un seul Caddy à la fois sur le poste -------------------------------------------------
liberer_ports() {
  local nom projet
  while read -r nom projet; do
    [[ -n $nom && $projet != "$PROJET" ]] || continue
    if [[ $projet == "$AUTRE" ]]; then
      info "arrêt de la répétition « $projet », qui occupe les ports 80 et 443 (ses données sont gardées)"
      # Par l'étiquette du projet : « docker compose -p … » lirait ici le docker-compose.yml du développement
      docker ps -q --filter "label=com.docker.compose.project=$projet" | xargs -r docker stop >/dev/null
    else
      arret "le conteneur « $nom »${projet:+ (projet $projet)} occupe le port 80 ou 443 : docker stop $nom, puis recommencez"
    fi
  done < <(docker ps --filter publish=80 --filter publish=443 --format '{{.Names}} {{.Label "com.docker.compose.project"}}' | sort -u)
}

# API (migrations comprises), worker et sauvegarde sains ; 5 minutes au plus (premier démarrage)
attendre_api() {
  attendre_sante 100 || arret "services pas tous sains après 5 minutes (ci-dessus) : repetition etat$OPT_DEMO, puis docker logs --tail 100 $PROJET-api-1 (ou -migrations-1, -worker-1)"
}

# Autorité locale de Caddy (créée dans son volume au premier démarrage), copiée pour Windows et verifier.sh
autorite() {
  local crt=$DOSSIER/autorite-locale.crt
  for _ in $(seq 1 30); do
    if dc exec -T caddy cat /data/caddy/pki/authorities/local/root.crt >"$T/racine.crt" 2>/dev/null \
      && grep -q 'BEGIN CERTIFICATE' "$T/racine.crt"; then
      cp "$T/racine.crt" "$crt"
      return 0
    fi
    sleep 2
  done
  arret "autorité locale introuvable dans le conteneur caddy : docker logs --tail 50 $PROJET-caddy-1"
}

controle() {
  etape "Contrôle du déploiement"
  vps "./deploiement/verifier.sh --local${*:+ $*}"
  bash "$RACINE/deploiement/verifier.sh" --env "$env_fichier" --local "$@"
}

# Restauration avec la clé privée de la répétition, passée par l'entrée standard (rien sur le disque du conteneur)
restaurer() {
  [[ -r $CLE ]] || arret "clé privée de sauvegarde absente : $(relatif "$CLE")"
  # shellcheck disable=SC2016  # « $@ » est celui du conteneur
  dc run --rm -T restauration sh -c 'cat > /dev/shm/cle-age && SAUVEGARDE_CLE_PRIVEE=/dev/shm/cle-age exec restaurer "$@"' restaurer "$@" <"$CLE"
}

super_admin() {
  local email=admin@$DOMAINE
  etape "Premier Super Admin ($email)"
  vps "dcp run --rm api node dist/scripts/creer-super-admin.js <e-mail> <prénom> <nom>"
  if dc run --rm --no-deps -T api node dist/scripts/creer-super-admin.js "$email" Admin Répétition >"$T/super-admin" 2>&1; then
    grep -o 'https://[^ ]*' "$T/super-admin" | tail -n 1 >"$DOSSIER/lien-invitation.txt"
    info "invité : lien dans $(relatif "$DOSSIER/lien-invitation.txt") et dans Mailpit ($MAILPIT)"
  elif grep -q 'déjà un compte' "$T/super-admin"; then
    info "déjà créé"
  else
    cat "$T/super-admin" >&2
    arret "création du Super Admin impossible"
  fi
}

resume() {
  local version
  version=$(valeur_env VERSION)
  etape "Répétition de $NOM en place (version ${version:-?})"
  info "Console           https://console.$DOMAINE"
  if ((demo)); then
    info "Portails          https://alpha.$DOMAINE/d/7K3QX9P2MA   https://horizon.$DOMAINE/d/H7P4XK2RQD"
    info "Comptes           fatou.diabate@banque-alpha.example (Admin Entreprise), serge.kouadio@… (Superviseur),"
    info "                  aya.konan@banque-alpha.example (Agent), koffi.admin@makortelecoms.example (Super Admin)…"
    info "                  (liste complète : docs/recette/cahier-de-recette.md)"
    info "Mot de passe      $(valeur_env DEMO_MOT_DE_PASSE)"
    info "Double auth.      repetition totp <e-mail> : code du moment et adresse otpauth:// pour le téléphone"
  else
    info "Super Admin       admin@$DOMAINE : ouvrir le lien d'invitation ci-dessous, choisir le mot de passe,"
    info "                  enrôler la double authentification avec le téléphone"
    [[ ! -s $DOSSIER/lien-invitation.txt ]] || info "                  $(cat "$DOSSIER/lien-invitation.txt")"
    info "Portail           https://<slug>.$DOMAINE, une fois la banque créée dans la console"
    info "                  (puis : repetition verifier --portail <slug>)"
  fi
  info "E-mails           $MAILPIT (Mailpit)"
  info "Autorité locale   $(relatif "$DOSSIER/autorite-locale.crt")"
}

# ---- Commandes ----------------------------------------------------------------------------------------------
installer() {
  exiger_docker
  preparer_env
  liberer_ports
  etape "Construction des images et démarrage (la première fois : 5 à 15 minutes)"
  vps "dcp up -d --build"
  dc up -d --build
  attendre_api
  autorite
  if ((demo)); then
    etape "Jeu de démonstration : deux banques fictives, 60 jours d'historique (1 à 2 minutes)"
    vps "./deploiement/reinitialiser-demo.sh"
    bash "$RACINE/deploiement/reinitialiser-demo.sh" --env "$env_fichier"
    controle --portail alpha || { resume; arret "des contrôles échouent (ci-dessus)"; }
  else
    etape "Compartiment des copies hors du VPS, créé avec le verrouillage"
    vps "dcp exec sauvegarde sauvegarder --preparer"
    dc exec -T sauvegarde sauvegarder --preparer
    super_admin
    controle || { resume; arret "des contrôles échouent (ci-dessus)"; }
  fi
  resume
}

verifier() {
  exiger_installee
  controle "${args[@]}"
}

sauvegarde() {
  exiger_production
  etape "Sauvegarde maintenant : base et fichiers, chiffrés, copiés hors du VPS et verrouillés"
  vps "dcp exec sauvegarde sauvegarder"
  dc exec -T sauvegarde sauvegarder
  etape "Vérification de la dernière sauvegarde : restaurée dans une base jetable, contrôlée, supprimée"
  vps "dcp run --rm restauration restaurer derniere   (clé privée saisie au clavier)"
  restaurer derniere
  etape "Copies sur le VPS et hors du VPS"
  vps "dcp run --rm restauration restaurer liste"
  dc run --rm -T restauration restaurer liste
}

# Un intrus a pris le VPS : il a les clés du compartiment (étape 12)
intrusion() {
  exiger_production
  etape "1/6 Une sauvegarde, copiée hors du VPS et verrouillée"
  dc exec -T sauvegarde sauvegarder >"$T/sauvegarde" 2>&1 || { cat "$T/sauvegarde"; arret "sauvegarde en échec avant l'intrusion (déjà une alerte ? repetition sauvegarde)"; }
  { grep 'verrouillée' "$T/sauvegarde" || true; } | sans_heure

  etape "2/6 L'intrus efface tout avec les clés du compartiment (rclone, comme sur le VPS)"
  # shellcheck disable=SC2016  # script exécuté dans le conteneur
  dc run --rm --no-deps -T --entrypoint bash sauvegarde -c '
    B=$SAUVEGARDE_S3_BUCKET
    essai() { local l=$1; shift; if rclone -q --retries 1 "$@" 2>/dev/null; then r=accepté; else r="refusé "; fi; printf "    %s  %s\n" "$r" "$l"; }
    derniere=$(rclone -q lsf "distant:$B/mensuel/" | grep "\.tar\.age$" | sort | tail -n 1)
    essai "rclone purge (supprimer le compartiment)" purge "distant:$B"
    essai "rclone delete --s3-versions (effacer les versions)" delete --s3-versions "distant:$B/mensuel/"
    echo rançon >/tmp/rancon.tar.age
    essai "faux fichier déposé sous le nom de la dernière mensuelle" copyto /tmp/rancon.tar.age "distant:$B/mensuel/$derniere"
    essai "rclone delete quotidien/ (supprimer les copies)" delete "distant:$B/quotidien/"
    printf "    Ce que l'"'"'intrus voit maintenant dans quotidien/ : %s copie(s)\n" "$(rclone -q lsf "distant:$B/quotidien/" | grep -c "\.age$")"
  '
  info "« accepté » ne veut pas dire « effacé » : une copie verrouillée n'est que masquée, ou recouverte"
  info "par une nouvelle version ; l'original reste jusqu'à la fin de son verrou."

  etape "3/6 La sauvegarde suivante donne l'alerte (healthchecks.io prévenu, conteneur « unhealthy »)"
  vps "chaque nuit, ou dcp exec sauvegarde sauvegarder"
  if dc exec -T sauvegarde sauvegarder >"$T/alerte" 2>&1; then
    cat "$T/alerte"
    arret "aucune alerte : la protection de l'étape 12 ne fonctionne pas"
  fi
  sed -n '/ALERTE/,$p' "$T/alerte" | sans_heure

  etape "4/6 Les copies masquées ou remplacées restent listées, et restaurables"
  vps "dcp run --rm restauration restaurer liste"
  dc run --rm -T restauration restaurer liste | tee "$T/liste"
  local masquee
  masquee=$({ grep -o 'distant:quotidien/[^ ]*-v[0-9-]*\.age' "$T/liste" || true; } | head -n 1)
  [[ -n $masquee ]] || arret "aucune copie masquée listée"

  etape "5/6 Vérification d'une copie masquée"
  vps "dcp run --rm restauration restaurer $masquee"
  restaurer "$masquee"

  etape "6/6 Incident clos (clés changées, VPS examiné) : l'alerte est acquittée"
  vps "dcp exec sauvegarde sauvegarder --acquitter"
  dc exec -T sauvegarde sauvegarder --acquitter
  dc exec -T sauvegarde sauvegarder >"$T/apres" 2>&1 || { cat "$T/apres"; arret "la sauvegarde reste en échec après l'acquittement"; }
  info "sauvegarde suivante : réussie, conteneur de nouveau « healthy »"
  info "Sur le VPS, avant d'acquitter : docs/exploitation.md, partie 7 (changer les clés, examiner le VPS)"
}

restauration() {
  exiger_production
  confirmer "La base de la répétition va être remplacée par la dernière sauvegarde (saisies faites depuis perdues). Continuer ?"
  etape "1/3 Arrêt de l'API et du worker"
  vps "dcp stop api worker"
  dc stop api worker
  etape "2/3 Remplacement de la base par la dernière sauvegarde, vérifiée d'abord"
  vps "dcp run --rm restauration restaurer --remplacer derniere   (taper REMPLACER)"
  restaurer --remplacer --oui derniere
  etape "3/3 Redémarrage"
  vps "dcp up -d"
  dc up -d
  attendre_api
  controle
}

# Autres options transmises à mettre-a-jour.sh (--portail <slug>, --sans-sauvegarde) ; alpha en démonstration
mise_a_jour() {
  exiger_installee
  [[ ${args[0]:-} =~ ^[0-9A-Za-z] ]] || arret "version attendue : repetition mise-a-jour 1.0.1$OPT_DEMO"
  etape "Mise à jour vers la version ${args[0]} (le code reste le même : c'est la procédure qu'on répète)"
  vps "./deploiement/mettre-a-jour.sh ${args[*]}"
  bash "$RACINE/deploiement/mettre-a-jour.sh" --env "$env_fichier" --oui ${portail_demo:+--portail alpha} "${args[@]}"
}

retour() {
  exiger_installee
  etape "Retour à la version précédente"
  vps "./deploiement/mettre-a-jour.sh --retour"
  bash "$RACINE/deploiement/mettre-a-jour.sh" --env "$env_fichier" --oui --retour ${portail_demo:+--portail alpha} "${args[@]}"
}

totp() {
  ((demo)) || arret "comptes de démonstration seulement : repetition totp <e-mail> --demo"
  exiger_installee
  ((${#args[@]} == 1)) || arret "e-mail attendu : repetition totp aya.konan@banque-alpha.example --demo"
  dc exec -T api node dist/scripts/totp.js "${args[0]}"
}

demarrer() {
  exiger_docker
  exiger_installee
  liberer_ports
  etape "Démarrage de $NOM"
  dc up -d
  attendre_api
  autorite
  if ((demo == 0)); then
    # Le S3 simulé garde ses copies en mémoire : après un redémarrage, son compartiment est recréé
    dc exec -T sauvegarde sauvegarder --preparer >"$T/preparer" 2>&1 || { cat "$T/preparer"; arret "compartiment simulé indisponible"; }
    info "compartiment simulé prêt (verrouillage vérifié)"
  fi
  resume
}

arreter() {
  exiger_installee
  etape "Arrêt de $NOM (données gardées : repetition demarrer$OPT_DEMO)"
  dc stop
}

etat() {
  exiger_installee
  dc ps --all --format 'table {{.Service}}\t{{.State}}\t{{.Health}}\t{{.Ports}}'
  resume
}

supprimer() {
  exiger_docker
  [[ -r $env_fichier ]] || { info "rien à supprimer pour $NOM"; return 0; }
  confirmer "Effacer la répétition de $NOM : conteneurs, base, sauvegardes, secrets et clé de .repetition/ ?"
  etape "Suppression de $NOM"
  dc down --volumes --remove-orphans
  rm -rf "$DOSSIER"
  rmdir "$RACINE/.repetition" 2>/dev/null || true
  info "Images gardées (réutilisées à la prochaine installation) : docker image ls 'reclamations-*'"
}

aide() { sed -n '4,27p' "$0" | sed 's/^# \{0,3\}//'; }

# La démonstration se vérifie avec son portail alpha, y compris après une mise à jour
portail_demo=''
((demo == 0)) || portail_demo=1

case $commande in
  installer) installer ;;
  verifier) verifier ;;
  sauvegarde) sauvegarde ;;
  intrusion) intrusion ;;
  restauration) restauration ;;
  mise-a-jour) mise_a_jour ;;
  retour) retour ;;
  totp) totp ;;
  demarrer) demarrer ;;
  arreter) arreter ;;
  etat) etat ;;
  supprimer) supprimer ;;
  aide | -h | --help) aide ;;
  *) aide; echo; arret "commande inconnue : $commande" ;;
esac
