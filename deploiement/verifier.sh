#!/usr/bin/env bash
# shellcheck disable=SC2015  # « test && ok || ko » : ok ne peut pas échouer
# =============================================================================
#  Vérification d'un déploiement (étape 10) : à lancer après chaque mise en production.
#
#    ./deploiement/verifier.sh                         domaine et version lus dans .env.production
#    ./deploiement/verifier.sh --portail alpha --local sur le VPS : aussi conteneurs, pare-feu, disque
#    ./deploiement/verifier.sh --domaine reclamations.ci --portail alpha   depuis n'importe quel poste
#
#  Options : --env FICHIER  --domaine D  --version V  --portail SLUG (une banque existante)
#            --ip IP (interroge cette adresse sans attendre le DNS)  --ca FICHIER (autorité de test)
#            --local (sur le VPS : docker compose, ports publiés, UFW, disque, sauvegarde)
#  Code de sortie 1 si un contrôle échoue.
# =============================================================================
set -Euo pipefail
# shellcheck source=commun.sh
. "$(dirname "$(readlink -f "$0")")/commun.sh"

env_fichier=$RACINE/.env.production domaine='' version='' portail='' ip='' ca='' local=0
while (($#)); do
  case $1 in
    --env) env_fichier=${2:?}; shift ;;
    --domaine) domaine=${2:?}; shift ;;
    --version) version=${2:?}; shift ;;
    --portail) portail=${2:?}; shift ;;
    --ip) ip=${2:?}; shift ;;
    --ca) ca=${2:?}; shift ;;
    --local) local=1 ;;
    -h | --help) sed -n '5,13p' "$0" | sed 's/^# \{0,3\}//'; exit 0 ;;
    *) echo "Option inconnue : $1" >&2; exit 2 ;;
  esac
  shift
done
[[ -r $env_fichier ]] || env_fichier=/dev/null
[[ -n $domaine ]] || domaine=$(valeur_env DOMAINE_PLATEFORME)
[[ -n $version ]] || version=$(valeur_env VERSION)
[[ -n $domaine ]] || { echo "Domaine inconnu : --domaine ou DOMAINE_PLATEFORME dans $env_fichier" >&2; exit 2; }
for outil in curl openssl; do command -v $outil >/dev/null || { echo "Outil manquant : $outil" >&2; exit 2; }; done

console=console.$domaine
inconnu=verification-$RANDOM$RANDOM.$domaine
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT

reussis=0 echoues=0 attentions=0
ok() { reussis=$((reussis + 1)); printf '  ok         %s\n' "$1"; }
ko() { echoues=$((echoues + 1)); printf '  ÉCHEC      %s\n' "$1"; [[ -z ${2:-} ]] || printf '             %s\n' "$2"; }
attention() { attentions=$((attentions + 1)); printf '  attention  %s\n' "$1"; [[ -z ${2:-} ]] || printf '             %s\n' "$2"; }
verifier() { local libelle=$1; shift; if "$@"; then ok "$libelle"; else ko "$libelle"; fi; }

CURL=(curl -sS --max-time 20)
for h in "$console" "$inconnu" ${portail:+"$portail.$domaine"}; do
  [[ -z $ip ]] || CURL+=(--resolve "$h:443:$ip" --resolve "$h:80:$ip")
done
[[ -z $ca ]] || CURL+=(--cacert "$ca")
# Réponse : en-têtes dans $T/entetes, corps dans $T/corps, code HTTP en sortie
requete() { : >"$T/entetes"; : >"$T/corps"; "${CURL[@]}" -D "$T/entetes" -o "$T/corps" -w '%{http_code}' "$@" 2>"$T/erreur"; }
entete() { tr -d '\r' <"$T/entetes" | sed -n "s/^$1: //Ip" | tail -n 1; }

echo "Vérification de https://$console${portail:+ et https://$portail.$domaine}${version:+ (version attendue : $version)}"

# ---- DNS ---------------------------------------------------------------------------------------------
echo "DNS"
if [[ -n $ip ]]; then
  attention "résolution DNS non vérifiée (--ip $ip)"
elif command -v getent >/dev/null; then
  verifier "console.$domaine résolu" getent hosts "$console"
  verifier "sous-domaines des banques résolus (enregistrement *.$domaine)" getent hosts "$inconnu"
fi

# ---- HTTPS et certificats --------------------------------------------------------------------------------
echo "HTTPS"
code=$(requete "http://$console/")
if [[ $code =~ ^30[178]$ && $(entete location) == "https://$console/" ]]; then ok "http:// redirigé vers https://"; else ko "http:// redirigé vers https://" "reçu : $code $(entete location)"; fi
code=$(requete "https://$console/")
if [[ $code == 200 ]]; then ok "console : certificat valide, page servie"; else ko "console : certificat valide, page servie" "$code $(head -c 300 "$T/erreur")"; fi

fin_certificat() { # jours restants du certificat servi pour $1
  local fin
  fin=$(echo | openssl s_client -connect "${ip:-$1}:443" -servername "$1" 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)
  [[ -n $fin ]] && echo $((($(date -d "$fin" +%s) - $(date +%s)) / 3600))
}
heures=$(fin_certificat "$console")
if [[ -z $heures ]]; then ko "échéance du certificat lue"
elif ((heures >= 14 * 24)); then ok "certificat valable encore $((heures / 24)) jours (renouvelé automatiquement avant la fin)"
else ko "certificat valable encore $((heures / 24)) jour(s) et $((heures % 24)) h seulement" "renouvellement en échec ? docker compose … logs caddy"; fi

# ---- En-têtes de sécurité (console) ------------------------------------------------------------------------
echo "En-têtes de sécurité"
requete "https://$console/" >/dev/null
[[ $(entete strict-transport-security) == *max-age=31536000* ]] && ok "HSTS un an" || ko "HSTS un an" "reçu : $(entete strict-transport-security)"
csp=$(entete content-security-policy)
[[ $csp == *"default-src 'self'"* && $csp == *"frame-ancestors 'none'"* && $csp != *unsafe-inline* ]] && ok "CSP stricte (sans unsafe-inline)" || ko "CSP stricte" "reçu : $csp"
[[ $(entete x-content-type-options) == nosniff ]] && ok "X-Content-Type-Options" || ko "X-Content-Type-Options"
[[ $(entete x-frame-options) == DENY ]] && ok "X-Frame-Options" || ko "X-Frame-Options"
[[ $(entete referrer-policy) == no-referrer ]] && ok "Referrer-Policy" || ko "Referrer-Policy"
[[ -z $(entete server) ]] && ok "aucun en-tête Server" || ko "aucun en-tête Server" "reçu : $(entete server)"
[[ $(entete cache-control) == no-cache ]] && ok "index.html revalidé à chaque visite" || ko "index.html revalidé à chaque visite" "reçu : $(entete cache-control)"
script=$(grep -o '/assets/[^"]*\.js' "$T/corps" | head -n 1)
if [[ -n $script ]]; then
  code=$(requete "https://$console$script")
  [[ $code == 200 && $(entete cache-control) == *immutable* ]] && ok "fichiers /assets/ gardés un an" || ko "fichiers /assets/ gardés un an" "$code $(entete cache-control)"
else
  ko "script de l'application trouvé dans la page"
fi

# ---- API -------------------------------------------------------------------------------------------------------
echo "API"
code=$(requete "https://$console/api/v1/sante")
sante=$(tr -d ' \n' <"$T/corps")
champ() { sed -n "s/.*\"$1\":\"\([^\"]*\)\".*/\1/p" <<<"$sante"; }
if [[ $code == 200 && $(champ statut) == ok ]]; then
  ok "santé : tout va bien (base, Redis, worker, envois, disque)"
elif [[ $code == 200 ]]; then
  ko "santé : dégradée" "worker $(champ worker), envois $(champ envois), disque $(champ disque)"
else
  ko "santé : l'API ne répond pas normalement" "$code $sante"
fi
if [[ -n $version ]]; then
  [[ $(champ version) == "$version" ]] && ok "version déployée : $version" || ko "version déployée : $version" "l'API annonce « $(champ version) » : images non reconstruites ou conteneurs non redémarrés"
fi
code=$(requete "https://$console/interne/tls?domain=$console")
[[ $code == 404 ]] && ok "route interne de l'API non publiée" || ko "route interne de l'API non publiée" "reçu : $code"
code=$(requete "https://$console/api/v1/auth/moi")
[[ $code == 401 ]] && ok "route protégée refusée sans connexion (401)" || ko "route protégée refusée sans connexion" "reçu : $code"

# ---- Portails des banques -----------------------------------------------------------------------------------
echo "Portails des banques"
if [[ -n $portail ]]; then
  code=$(requete "https://$portail.$domaine/")
  [[ $code == 200 && $(entete content-security-policy) == *"default-src 'self'"* ]] && ok "portail « $portail » : certificat obtenu, page servie" || ko "portail « $portail »" "$code $(head -c 300 "$T/erreur")"
else
  attention "portail d'une banque non vérifié (--portail <slug>)"
fi
code=$(requete "https://$inconnu/")
rc=$?
# 35 : poignée de main TLS refusée (Caddy n'a pas obtenu de certificat) ; 60 : certificat non valide
if [[ $rc == 35 || $rc == 60 ]]; then ok "aucun certificat pour un sous-domaine inconnu"
else ko "aucun certificat pour un sous-domaine inconnu" "reçu : $code (curl $rc) $(head -c 200 "$T/erreur")"; fi

# ---- Sur le VPS -----------------------------------------------------------------------------------------------
if ((local)); then
  echo "Serveur"
  if ! command -v docker >/dev/null; then
    ko "docker disponible"
  else
    dc ps --all --format '{{.Service}}|{{.State}}|{{.Health}}|{{.ExitCode}}' >"$T/services" 2>"$T/erreur" || ko "docker compose ps" "$(cat "$T/erreur")"
    services=(caddy api worker postgres redis)
    est_demo || services+=(sauvegarde)
    for s in "${services[@]}"; do
      IFS='|' read -r _ etat sante_c _ < <(grep "^$s|" "$T/services")
      if [[ $etat == running && ( -z $sante_c || $sante_c == healthy ) ]]; then ok "service $s : ${sante_c:-en marche}"
      else ko "service $s : ${etat:-absent} ${sante_c}" "docker compose … logs --tail 50 $s"; fi
    done
    IFS='|' read -r _ etat _ sortie < <(grep '^migrations|' "$T/services")
    [[ $etat == exited && $sortie == 0 ]] && ok "migrations appliquées" || ko "migrations appliquées" "état $etat, code $sortie"
    publies=$(docker ps --format '{{.Names}} {{.Ports}}' | grep -E '0\.0\.0\.0:|\[::\]:' | grep -v -- '-caddy-' || true)
    [[ -z $publies ]] && ok "seul Caddy publie des ports" || ko "seul Caddy publie des ports" "$publies"
  fi
  if command -v ufw >/dev/null && [[ $EUID == 0 ]]; then
    ufw status | grep -q '^Status: active' && ok "pare-feu UFW actif" || ko "pare-feu UFW actif" "ufw allow OpenSSH && ufw allow 80,443/tcp && ufw enable"
  else
    attention "pare-feu non vérifié (ufw absent ou non root)"
  fi
  occupe=$(df -P / | awk 'NR == 2 { sub("%", "", $5); print $5 }')
  ((occupe < 85)) && ok "disque occupé à $occupe %" || ko "disque occupé à $occupe %" "docker system prune ; anciennes images : docker image ls reclamations-*"
  if est_demo; then
    attention "environnement de démonstration : pas de sauvegarde (remise à zéro chaque nuit)"
  elif command -v docker >/dev/null; then
    derniere=$(dc exec -T sauvegarde sh -c 'ls -1 /sauvegardes/reclamations-*.tar.age 2>/dev/null | sort | tail -n 1' 2>/dev/null)
    [[ -n $derniere ]] && ok "dernière sauvegarde : $(basename "$derniere")" || attention "aucune sauvegarde encore" "docker compose … exec sauvegarde sauvegarder   puis   … run --rm restauration restaurer derniere"
  fi
fi

echo
echo "$reussis contrôle(s) réussi(s), $echoues échec(s), $attentions point(s) d'attention"
((echoues == 0))
