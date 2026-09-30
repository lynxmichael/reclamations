#!/usr/bin/env bash
# Contrôle de santé du conteneur « sauvegarde » (docker compose ps : healthy / unhealthy)
#   malsain si la dernière sauvegarde a échoué,
#   ou si aucune n'a réussi depuis 26 heures alors que le planificateur tourne depuis 26 heures.
DOSSIER=${SAUVEGARDE_DOSSIER:-/sauvegardes}
[[ $DOSSIER/.dernier-echec -nt $DOSSIER/.derniere-reussite ]] && { echo "dernière sauvegarde en échec"; exit 1; }
[[ -n $(find "$DOSSIER/.derniere-reussite" /tmp/.demarrage -mmin -1560 2>/dev/null) ]] && exit 0
echo "aucune sauvegarde réussie depuis 26 heures"
exit 1
