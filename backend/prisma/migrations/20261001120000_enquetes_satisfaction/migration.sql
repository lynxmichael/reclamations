-- =============================================================================
--  Étape 15 — Enquêtes de satisfaction (CSAT et NPS) à la clôture
--
--  Une enquête par réclamation, ouverte à sa clôture confirmée ou automatique, pendant 7 jours.
--  Elle s'active banque par banque (banque.enquete_satisfaction, réglée par le Super Admin,
--  décision I2 de l'étape 14). La réponse, une fois donnée, ne se modifie plus.
--  Le Super Admin lit les notes pour ses totaux par banque, jamais le commentaire (arbitrage 7).
-- =============================================================================

-- AlterTable
ALTER TABLE "banque" ADD COLUMN     "enquete_satisfaction" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "enquete_satisfaction" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "reclamation_id" UUID NOT NULL,
    "cree_le" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expire_le" TIMESTAMPTZ(3) NOT NULL,
    "repondu_le" TIMESTAMPTZ(3),
    "note" SMALLINT,
    "recommandation" SMALLINT,
    "commentaire" VARCHAR(1000),

    CONSTRAINT "enquete_satisfaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "enquete_satisfaction_tenant_id_cree_le_idx" ON "enquete_satisfaction"("tenant_id", "cree_le");

-- CreateIndex
CREATE UNIQUE INDEX "enquete_satisfaction_tenant_id_reclamation_id_key" ON "enquete_satisfaction"("tenant_id", "reclamation_id");

-- AddForeignKey
ALTER TABLE "enquete_satisfaction" ADD CONSTRAINT "enquete_satisfaction_tenant_id_reclamation_id_fkey" FOREIGN KEY ("tenant_id", "reclamation_id") REFERENCES "reclamation"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- -----------------------------------------------------------------------------
--  Contraintes : bornes des notes, réponse complète ou absente
-- -----------------------------------------------------------------------------

ALTER TABLE enquete_satisfaction
  ADD CONSTRAINT enquete_satisfaction_duree CHECK (expire_le > cree_le),
  ADD CONSTRAINT enquete_satisfaction_note CHECK (note BETWEEN 1 AND 5),
  ADD CONSTRAINT enquete_satisfaction_recommandation CHECK (recommandation BETWEEN 0 AND 10),
  ADD CONSTRAINT enquete_satisfaction_reponse_complete CHECK (
    (repondu_le IS NULL AND note IS NULL AND recommandation IS NULL AND commentaire IS NULL)
    OR (repondu_le IS NOT NULL AND note IS NOT NULL AND recommandation IS NOT NULL)),
  ADD CONSTRAINT enquete_satisfaction_commentaire CHECK (commentaire IS NULL OR length(btrim(commentaire)) > 0);

-- Une réponse se donne une fois, avant la fin de l'enquête, et ne se modifie plus
CREATE FUNCTION enquete_satisfaction_reponse() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.repondu_le IS NOT NULL THEN
    RAISE EXCEPTION 'Enquête de satisfaction % déjà répondue : la réponse ne se modifie plus', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.repondu_le IS NOT NULL AND NEW.repondu_le > OLD.expire_le THEN
    RAISE EXCEPTION 'Enquête de satisfaction % terminée le %', OLD.id, OLD.expire_le
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER enquete_satisfaction_reponse
  BEFORE UPDATE ON enquete_satisfaction
  FOR EACH ROW EXECUTE FUNCTION enquete_satisfaction_reponse();


-- -----------------------------------------------------------------------------
--  Droits et isolation (mêmes règles que l'étape 3)
-- -----------------------------------------------------------------------------

-- Banque : ouverture à la clôture, réponse du client (seules les colonnes de la réponse changent)
GRANT SELECT, INSERT ON enquete_satisfaction TO acces_banque;
GRANT UPDATE (repondu_le, note, recommandation, commentaire) ON enquete_satisfaction TO acces_banque;

-- Plateforme : notes et dates pour les totaux par banque, jamais le commentaire du client
GRANT SELECT (id, tenant_id, reclamation_id, cree_le, expire_le, repondu_le, note, recommandation)
  ON enquete_satisfaction TO acces_plateforme;

ALTER TABLE enquete_satisfaction ENABLE ROW LEVEL SECURITY;

CREATE POLICY banque_isolation ON enquete_satisfaction FOR ALL TO acces_banque
  USING (tenant_id = app_tenant_courant()) WITH CHECK (tenant_id = app_tenant_courant());
CREATE POLICY plateforme_toutes_banques ON enquete_satisfaction FOR SELECT TO acces_plateforme USING (true);
