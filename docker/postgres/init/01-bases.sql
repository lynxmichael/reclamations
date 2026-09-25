-- Exécuté une seule fois par l'image postgres, à la création du volume.
-- reclamations_dev est créée par POSTGRES_DB ; on ajoute la base jetable des vérifications.
CREATE DATABASE reclamations_verif;
