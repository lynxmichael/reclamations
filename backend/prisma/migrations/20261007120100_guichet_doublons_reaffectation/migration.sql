-- =============================================================================
--  Étape 21 — Saisie au guichet et par téléphone, réclamations retrouvées, doublons, réaffectation
--
--  - point_depot GUICHET (un par agence) et TELEPHONE (un par banque) : créés à la première saisie
--    par le personnel, jamais ouverts au portail ; ils portent le canal de la réclamation comme les
--    QR codes et les liens.
--  - reclamation.rattachee_a_id : un doublon rattaché à la réclamation principale du même client.
--    Il est clôturé (motif « Doublon ») ; ses messages et pièces jointes restent les siens.
--  - Retrouver ses réclamations, renvoyer le lien de suivi, réassigner en lot : rien à stocker de
--    plus (codes à usage unique de l'étape 7, assignations de l'étape 4).
-- =============================================================================

-- AlterTable
ALTER TABLE "reclamation" ADD COLUMN "rattachee_a_id" UUID;

-- CreateIndex
CREATE INDEX "reclamation_tenant_id_rattachee_a_id_idx" ON "reclamation"("tenant_id", "rattachee_a_id");

-- AddForeignKey
ALTER TABLE "reclamation" ADD CONSTRAINT "reclamation_tenant_id_rattachee_a_id_fkey" FOREIGN KEY ("tenant_id", "rattachee_a_id") REFERENCES "reclamation"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- -----------------------------------------------------------------------------
--  Contraintes
-- -----------------------------------------------------------------------------

-- Un doublon rattaché est clôturé avec le motif « Doublon », et jamais rattaché à lui-même
ALTER TABLE reclamation ADD CONSTRAINT reclamation_rattachee_doublon CHECK (
  rattachee_a_id IS NULL OR (rattachee_a_id <> id AND statut = 'CLOTUREE' AND motif_cloture_forcee = 'DOUBLON'));

-- Guichet : toujours une agence ; téléphone : aucune (l'agence de la réclamation se choisit à part)
ALTER TABLE point_depot ADD CONSTRAINT point_depot_guichet_avec_agence
  CHECK (canal <> 'GUICHET' OR agence_id IS NOT NULL);
ALTER TABLE point_depot ADD CONSTRAINT point_depot_telephone_sans_agence
  CHECK (canal <> 'TELEPHONE' OR agence_id IS NULL);

-- Un seul point « Guichet » par agence, un seul point « Téléphone » par banque
CREATE UNIQUE INDEX point_depot_guichet_par_agence ON point_depot (tenant_id, agence_id) WHERE canal = 'GUICHET';
CREATE UNIQUE INDEX point_depot_telephone_par_banque ON point_depot (tenant_id) WHERE canal = 'TELEPHONE';


-- -----------------------------------------------------------------------------
--  Droits : la banque rattache ses doublons (contexte banque, comme une clôture forcée)
-- -----------------------------------------------------------------------------

GRANT UPDATE (rattachee_a_id) ON reclamation TO acces_banque;
