-- =============================================================================
--  Étape 19 — Double authentification au choix de la banque
--
--  - banque.double_authentification_obligatoire : l'Admin Entreprise rend la double authentification
--    obligatoire pour tout son personnel, ou la laisse facultative (chacun l'active depuis « Mon
--    compte »). Facultative par défaut, pour les banques existantes comme pour les nouvelles.
--  - Le Super Admin (comptes Makor, sans banque) reste toujours soumis à la double authentification :
--    la règle est dans l'API, pas dans cette colonne.
--  - L'activité des agences (même étape) se lit sur les tables existantes : rien à créer.
-- =============================================================================

-- AlterTable
ALTER TABLE "banque" ADD COLUMN     "double_authentification_obligatoire" BOOLEAN NOT NULL DEFAULT false;


-- -----------------------------------------------------------------------------
--  Droits (mêmes règles que l'étape 3) : l'Admin Entreprise règle sa banque, la RLS limite la
--  mise à jour à la sienne. Le Super Admin lit le réglage (droits de l'étape 3 sur banque).
-- -----------------------------------------------------------------------------
GRANT UPDATE (double_authentification_obligatoire) ON banque TO acces_banque;
