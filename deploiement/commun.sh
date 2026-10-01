# Fonctions communes aux scripts de deploiement/ (sourcé, jamais exécuté). Le script appelant
# définit env_fichier (.env.production, ou .env.demo pour l'environnement de démonstration).
# shellcheck disable=SC2034,SC2154  # RACINE sert aux scripts appelants, qui définissent env_fichier

RACINE=$(dirname "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")")

# Valeur d'une clé du fichier d'environnement (fin de ligne Windows retirée : fichier édité au Bloc-notes)
valeur_env() { sed -n "s/^$1=//p" "$env_fichier" | tail -n 1 | tr -d '\r'; }

# Environnement de démonstration : DEMONSTRATION=1 dans son fichier d'environnement
est_demo() { [[ $(valeur_env DEMONSTRATION) == 1 ]]; }

# Répétition locale sur un poste (étape 13) : REPETITION=1 dans son fichier d'environnement
est_repetition() { [[ $(valeur_env REPETITION) == 1 ]]; }

# Attend que les services à contrôle de santé soient sains (API, worker, sauvegarde) : $1 × 3 s au plus
# (60 par défaut). Échec : leur état est affiché.
attendre_sante() {
  local etats=''
  for _ in $(seq 1 "${1:-60}"); do
    etats=$({ dc ps --format '{{.Service}}:{{.Health}}' 2>/dev/null || true; } | { grep -v ':$' || true; } | sort | tr '\n' ' ')
    [[ $etats == *api:healthy* && $etats != *:starting* && $etats != *:unhealthy* ]] && return 0
    sleep 3
  done
  echo "états : ${etats:-aucun service}" >&2
  return 1
}

# docker compose de l'environnement : production, + surcharge de démonstration, + surcharge de
# répétition locale ; projet nommé par COMPOSE_PROJECT_NAME s'il est dans le fichier d'environnement
dc() {
  local fichiers=(-f "$RACINE/docker-compose.prod.yml") projet
  if est_demo; then fichiers+=(-f "$RACINE/docker-compose.demo.yml"); fi
  if est_repetition; then fichiers+=(-f "$RACINE/docker-compose.repetition.yml"); fi
  projet=$(valeur_env COMPOSE_PROJECT_NAME)
  docker compose "${fichiers[@]}" ${projet:+-p "$projet"} --env-file "$env_fichier" "$@"
}
