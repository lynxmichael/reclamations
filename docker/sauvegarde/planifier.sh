#!/usr/bin/env bash
# =============================================================================
#  Planificateur du service « sauvegarde » : une sauvegarde par jour à SAUVEGARDE_HEURE (UTC,
#  l'heure d'Abidjan). Contrôle la configuration au démarrage ; un échec de sauvegarde est
#  signalé (supervision, contrôle de santé du conteneur) sans arrêter le planificateur.
# =============================================================================
set -Euo pipefail
# shellcheck source=commun.sh
. "$(dirname "$(readlink -f "$0")")/commun.sh"

heure=${SAUVEGARDE_HEURE:-02:30}
[[ $heure =~ ^([01][0-9]|2[0-3]):[0-5][0-9]$ ]] || echec "SAUVEGARDE_HEURE doit être au format HH:MM (reçu : $heure)"

touch /tmp/.demarrage
trap 'journal "Arrêt du planificateur"; exit 0' TERM INT

journal "Planificateur de sauvegarde : chaque jour à $heure UTC"
"$(dirname "$(readlink -f "$0")")/sauvegarder.sh" --controler || true

while true; do
  maintenant=$(date -u +%s)
  cible=$(date -u -d "today $heure" +%s)
  ((cible > maintenant)) || cible=$(date -u -d "tomorrow $heure" +%s)
  journal "Prochaine sauvegarde : $(date -u -d "@$cible" '+%d/%m/%Y à %H:%M') UTC"
  # « sleep & wait » : un « docker compose stop » interrompt l'attente aussitôt
  sleep $((cible - maintenant)) &
  wait $!
  "$(dirname "$(readlink -f "$0")")/sauvegarder.sh" || true
done
