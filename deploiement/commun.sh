# Fonctions communes aux scripts de deploiement/ (sourcé, jamais exécuté). Le script appelant
# définit env_fichier (.env.production, ou .env.demo pour l'environnement de démonstration).
# shellcheck disable=SC2034,SC2154  # RACINE sert aux scripts appelants, qui définissent env_fichier

RACINE=$(dirname "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")")

valeur_env() { sed -n "s/^$1=//p" "$env_fichier" | tail -n 1; }

# Environnement de démonstration : DEMONSTRATION=1 dans son fichier d'environnement
est_demo() { [[ $(valeur_env DEMONSTRATION) == 1 ]]; }

# docker compose de l'environnement : production, ou production + surcharge de démonstration
dc() {
  local fichiers=(-f "$RACINE/docker-compose.prod.yml")
  if est_demo; then fichiers+=(-f "$RACINE/docker-compose.demo.yml"); fi
  docker compose "${fichiers[@]}" --env-file "$env_fichier" "$@"
}
