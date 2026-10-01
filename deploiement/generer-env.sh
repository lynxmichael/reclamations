#!/usr/bin/env bash
# =============================================================================
#  Crée .env.production à partir de .env.production.example, secrets générés sur le VPS (étape 10)
#
#    ./deploiement/generer-env.sh                      puis compléter les valeurs signalées
#    ./deploiement/generer-env.sh --domaine reclamations.ci --acme exploitation@makor.ci
#    ./deploiement/generer-env.sh --demo --domaine demo.reclamations.ci --acme …   (.env.demo)
#
#  N'écrase jamais un fichier existant. Secrets en hexadécimal : ils passent tels quels dans les
#  adresses de connexion (postgresql://utilisateur:motdepasse@…), où « / », « + » ou « = » d'un
#  secret en base64 casseraient l'adresse. Fichier lisible par son seul propriétaire (chmod 600).
# =============================================================================
set -Eeuo pipefail
cd "$(dirname "$(readlink -f "$0")")/.."

cible='' modele=.env.production.example domaine='' acme=''
while (($#)); do
  case $1 in
    --demo) modele=.env.demo.example ;;
    --domaine) domaine=${2:?}; shift ;;
    --acme) acme=${2:?}; shift ;;
    --sortie) cible=${2:?}; shift ;;
    -h | --help) sed -n '4,7p' "$0" | sed 's/^# \{0,3\}//'; exit 0 ;;
    *) echo "Option inconnue : $1" >&2; exit 1 ;;
  esac
  shift
done
[[ -n $cible ]] || { [[ $modele == .env.demo.example ]] && cible=.env.demo || cible=.env.production; }

[[ ! -e $cible ]] || { echo "$cible existe déjà : rien n'est écrasé (supprimez-le d'abord s'il faut vraiment le refaire)" >&2; exit 1; }
command -v openssl >/dev/null || { echo "openssl est nécessaire (apt install openssl)" >&2; exit 1; }
[[ -z $domaine || $domaine =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$ ]] || { echo "Domaine invalide : $domaine" >&2; exit 1; }

umask 077
cp "$modele" "$cible"
# Sur un dossier Windows partagé avec Docker (répétition locale), les droits Unix sont sans effet
chmod 600 "$cible" 2>/dev/null || echo "Attention : droits de $cible non restreints (système de fichiers sans droits Unix)" >&2

remplir() { # remplir CLE valeur : seulement si la ligne « CLE= » est vide
  sed -i "s|^$1=\$|$1=$2|" "$cible"
}
remplir POSTGRES_PASSWORD "$(openssl rand -hex 24)"
remplir APP_DB_PASSWORD "$(openssl rand -hex 24)"
remplir JWT_SECRET "$(openssl rand -hex 48)"
remplir CLE_CHIFFREMENT_TOTP "$(openssl rand -hex 32)"
remplir CLE_OTP "$(openssl rand -hex 48)"
# Démonstration : mot de passe lisible des comptes fictifs, graine des secrets TOTP
remplir DEMO_MOT_DE_PASSE "Demo-$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-12)"
remplir DEMO_GRAINE_TOTP "$(openssl rand -hex 32)"
if [[ -n $domaine ]]; then
  remplir DOMAINE_PLATEFORME "$domaine"
  sed -i "s|^EMAIL_EXPEDITEUR=.*|EMAIL_EXPEDITEUR=Réclamations <no-reply@$domaine>|" "$cible"
fi
[[ -z $acme ]] || remplir ACME_EMAIL "$acme"

echo "$cible créé (lisible par vous seul), secrets générés."
echo
echo "À compléter avant le premier démarrage :"
grep -E '^[A-Z0-9_]+=$' "$cible" | cut -d= -f1 | while read -r v; do
  case $v in
    SMS_URL | SMS_CLE | SAUVEGARDE_PING_URL) printf '  %-24s (facultatif pour l\x27instant)\n' "$v" ;;
    *) printf '  %s\n' "$v" ;;
  esac
done
echo
echo "Gardez une copie de ce fichier hors du VPS (gestionnaire de mots de passe) : CLE_CHIFFREMENT_TOTP"
echo "perdue, tout le personnel doit réenrôler sa double authentification."
