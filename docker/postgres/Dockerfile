# syntax=docker/dockerfile:1.7
# =============================================================================
#  PostgreSQL de la production et de la démonstration (étape 13)
#
#  L'image officielle, avec le script qui crée les rôles à la création du volume. Il était monté
#  depuis le dépôt ; il est maintenant copié dans l'image. La production ne dépend ainsi d'aucun
#  fichier du dépôt à l'exécution, et docker compose peut se lancer depuis un conteneur d'outils
#  (répétition sur un poste Windows, deploiement/outils.ps1), qui ne partage pas ses chemins
#  avec le moteur Docker.
#
#  Étiquette fixe (reclamations-postgres:16) : une mise à jour de l'application ne redémarre pas la
#  base, sauf si l'image de base a reçu un correctif (construction avec --pull).
# =============================================================================
FROM postgres:16-bookworm

COPY --chmod=0755 init/02-roles.sh /docker-entrypoint-initdb.d/02-roles.sh
# Fins de ligne Windows retirées au cas où (dépôt extrait sous Windows sans .gitattributes)
RUN sed -i 's/\r$//' /docker-entrypoint-initdb.d/02-roles.sh
