# syntax=docker/dockerfile:1.7
# =============================================================================
#  Sauvegarde et restauration (étape 10, décision A9 de l'étape 3)
#
#  Outils PostgreSQL de la même version majeure que le serveur (16), age pour le chiffrement,
#  rclone pour la copie hors du VPS (Contabo Object Storage, compatible S3).
#
#    sauvegarder   une sauvegarde tout de suite (planifier la lance chaque nuit)
#    restaurer     vérifier une sauvegarde (par défaut) ou remplacer la base (--remplacer)
# =============================================================================
FROM postgres:16-bookworm

RUN apt-get update \
 && apt-get install -y --no-install-recommends age rclone jq curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY --chmod=0755 commun.sh sauvegarder.sh restaurer.sh planifier.sh sante.sh /usr/local/lib/sauvegarde/
# Fins de ligne Windows retirées au cas où (dépôt extrait sous Windows sans .gitattributes)
RUN sed -i 's/\r$//' /usr/local/lib/sauvegarde/*.sh \
 && ln -s /usr/local/lib/sauvegarde/sauvegarder.sh /usr/local/bin/sauvegarder \
 && ln -s /usr/local/lib/sauvegarde/restaurer.sh /usr/local/bin/restaurer \
 && ln -s /usr/local/lib/sauvegarde/planifier.sh /usr/local/bin/planifier \
 && mkdir -p /sauvegardes

ENV TZ=UTC \
    SAUVEGARDE_DOSSIER=/sauvegardes \
    SAUVEGARDE_FICHIERS=/donnees/fichiers

WORKDIR /sauvegardes
HEALTHCHECK --interval=5m --timeout=10s --start-period=1m CMD ["/usr/local/lib/sauvegarde/sante.sh"]
ENTRYPOINT []
CMD ["planifier"]
