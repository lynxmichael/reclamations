-- =============================================================================
--  Étape 21 — valeurs d'énumération (seules dans leur migration : PostgreSQL ne permet pas de les
--  employer dans la transaction qui les crée ; la migration suivante s'en sert)
--
--  - canal_depot : GUICHET (saisie par le personnel, en agence) et TELEPHONE (saisie pendant un appel)
--  - type_evenement : RATTACHEMENT (un doublon joint à la réclamation principale du même client)
-- =============================================================================

-- AlterEnum
ALTER TYPE "canal_depot" ADD VALUE 'GUICHET';
ALTER TYPE "canal_depot" ADD VALUE 'TELEPHONE';

-- AlterEnum
ALTER TYPE "type_evenement" ADD VALUE 'RATTACHEMENT';
