# syntax=docker/dockerfile:1.7
# =============================================================================
#  Conteneur d'outils (étape 13) : les scripts de deploiement/ depuis Windows, sans WSL ni Git Bash
#
#  Les scripts du VPS (bash, docker compose, openssl, curl, age) tournent dans ce conteneur, qui
#  pilote le Docker Desktop du poste par sa socket. Construit et lancé par deploiement/outils.ps1 :
#
#    .\deploiement\outils.ps1 ./deploiement/verifier.sh --domaine reclamations.ci --portail alpha
#    .\deploiement\outils.ps1 age-keygen
#
#  Le dossier du dépôt est monté en /depot. docker compose lancé d'ici envoie les chemins de /depot
#  au moteur, qui ne les voit pas : c'est pourquoi docker-compose.prod.yml ne monte aucun fichier
#  du dépôt (tout est copié dans les images).
# =============================================================================
FROM docker:29.8.1-cli AS docker

FROM debian:bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends bash ca-certificates curl openssl jq age \
 && rm -rf /var/lib/apt/lists/*
# Client Docker et ses extensions compose et buildx : binaires statiques (Go), sans dépendance
COPY --from=docker /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker /usr/local/libexec/docker/cli-plugins/docker-compose /usr/local/libexec/docker/cli-plugins/docker-compose
COPY --from=docker /usr/local/libexec/docker/cli-plugins/docker-buildx /usr/local/libexec/docker/cli-plugins/docker-buildx

ENV LANG=C.UTF-8 \
    DOCKER_CLI_HINTS=false
WORKDIR /depot
CMD ["bash"]
