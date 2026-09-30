# syntax=docker/dockerfile:1.7
# =============================================================================
#  Image de la recette automatique (docker compose run --rm recette) : navigateurs Playwright,
#  plus les outils de l'essai de sauvegarde : client PostgreSQL 16, age, jq, rclone 1.75 (le
#  verrouillage des copies de l'étape 12 demande la 1.70 ou plus ; Ubuntu livre la 1.60) et moto,
#  qui simule un compartiment S3 avec verrouillage des objets.
#  Construite une fois : les lancements suivants n'installent plus rien.
# =============================================================================
FROM rclone/rclone:1.75.1 AS rclone

FROM mcr.microsoft.com/playwright:v1.56.0-noble

RUN apt-get update \
 && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      postgresql-client-16 age jq curl python3 python3-venv \
 && rm -rf /var/lib/apt/lists/*
COPY --from=rclone /usr/local/bin/rclone /usr/local/bin/rclone
RUN python3 -m venv /opt/moto \
 && /opt/moto/bin/pip install --no-cache-dir "moto[server]==5.2.3"
# python3 de l'environnement moto en premier : l'essai lance « python3 -m moto.server »
ENV PATH=/opt/moto/bin:$PATH
