-- =============================================================================
--  Étape 16 — Attribution et escalade automatiques (décision I10 de l'étape 14)
--
--  - Groupes d'agents : chaque catégorie et chaque agence peut être confiée à un groupe ; une
--    nouvelle réclamation va à l'agent disponible le moins chargé (application, domaine/attribution).
--  - Absences des agents (jours inclus, sans motif).
--  - Mode d'attribution de la banque : à la main, suggérée au superviseur, ou automatique.
--  - Second niveau d'escalade, vers l'Admin Entreprise, à un seuil du délai cible réglable par
--    banque, par catégorie et par priorité. Les alertes à 75 % et au dépassement ne changent pas.
--  Le tout s'ouvre banque par banque (banque.attribution_automatique, réglée par le Super Admin,
--  décision I2) ; une banque qui ne l'a pas ne voit aucun changement.
-- =============================================================================

-- CreateEnum
CREATE TYPE "mode_attribution" AS ENUM ('MANUELLE', 'SUGGESTION', 'AUTOMATIQUE');

-- AlterEnum
ALTER TYPE "type_evenement" ADD VALUE 'ESCALADE_ADMIN';

-- AlterTable
ALTER TABLE "agence" ADD COLUMN     "groupe_id" UUID;

-- AlterTable
ALTER TABLE "banque" ADD COLUMN     "attribution_automatique" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "mode_attribution" "mode_attribution" NOT NULL DEFAULT 'MANUELLE',
ADD COLUMN     "seuil_escalade_admin_pourcent" INTEGER,
ADD COLUMN     "seuil_escalade_admin_urgent_pourcent" INTEGER;

-- AlterTable
ALTER TABLE "categorie" ADD COLUMN     "groupe_id" UUID,
ADD COLUMN     "seuil_escalade_admin_pourcent" INTEGER,
ADD COLUMN     "seuil_escalade_admin_urgent_pourcent" INTEGER;

-- AlterTable
ALTER TABLE "reclamation" ADD COLUMN     "escaladee_admin_le" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "utilisateur" ADD COLUMN     "derniere_attribution_le" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "groupe_agents" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "nom" VARCHAR(120) NOT NULL,
    "cree_le" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifie_le" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "groupe_agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "groupe_agents_membre" (
    "tenant_id" UUID NOT NULL,
    "groupe_id" UUID NOT NULL,
    "utilisateur_id" UUID NOT NULL,

    CONSTRAINT "groupe_agents_membre_pkey" PRIMARY KEY ("groupe_id","utilisateur_id")
);

-- CreateTable
CREATE TABLE "absence_agent" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "utilisateur_id" UUID NOT NULL,
    "du" DATE NOT NULL,
    "au" DATE NOT NULL,
    "cree_le" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "absence_agent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "groupe_agents_tenant_id_id_key" ON "groupe_agents"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "groupe_agents_tenant_id_nom_key" ON "groupe_agents"("tenant_id", "nom");

-- CreateIndex
CREATE INDEX "groupe_agents_membre_tenant_id_utilisateur_id_idx" ON "groupe_agents_membre"("tenant_id", "utilisateur_id");

-- CreateIndex
CREATE INDEX "absence_agent_tenant_id_utilisateur_id_au_idx" ON "absence_agent"("tenant_id", "utilisateur_id", "au");

-- AddForeignKey
ALTER TABLE "agence" ADD CONSTRAINT "agence_tenant_id_groupe_id_fkey" FOREIGN KEY ("tenant_id", "groupe_id") REFERENCES "groupe_agents"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categorie" ADD CONSTRAINT "categorie_tenant_id_groupe_id_fkey" FOREIGN KEY ("tenant_id", "groupe_id") REFERENCES "groupe_agents"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "groupe_agents" ADD CONSTRAINT "groupe_agents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "banque"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "groupe_agents_membre" ADD CONSTRAINT "groupe_agents_membre_tenant_id_groupe_id_fkey" FOREIGN KEY ("tenant_id", "groupe_id") REFERENCES "groupe_agents"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "groupe_agents_membre" ADD CONSTRAINT "groupe_agents_membre_tenant_id_utilisateur_id_fkey" FOREIGN KEY ("tenant_id", "utilisateur_id") REFERENCES "utilisateur"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "absence_agent" ADD CONSTRAINT "absence_agent_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "banque"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "absence_agent" ADD CONSTRAINT "absence_agent_tenant_id_utilisateur_id_fkey" FOREIGN KEY ("tenant_id", "utilisateur_id") REFERENCES "utilisateur"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- -----------------------------------------------------------------------------
--  Contraintes
-- -----------------------------------------------------------------------------

-- Une banque sans la fonction reste en attribution manuelle
ALTER TABLE banque
  ADD CONSTRAINT banque_attribution_ouverte CHECK (attribution_automatique OR mode_attribution = 'MANUELLE'),
  ADD CONSTRAINT banque_seuils_escalade_admin CHECK (
    (seuil_escalade_admin_pourcent IS NULL OR seuil_escalade_admin_pourcent BETWEEN 101 AND 1000)
    AND (seuil_escalade_admin_urgent_pourcent IS NULL OR seuil_escalade_admin_urgent_pourcent BETWEEN 101 AND 1000));

ALTER TABLE categorie
  ADD CONSTRAINT categorie_seuils_escalade_admin CHECK (
    (seuil_escalade_admin_pourcent IS NULL OR seuil_escalade_admin_pourcent BETWEEN 101 AND 1000)
    AND (seuil_escalade_admin_urgent_pourcent IS NULL OR seuil_escalade_admin_urgent_pourcent BETWEEN 101 AND 1000));

ALTER TABLE groupe_agents ADD CONSTRAINT groupe_agents_nom CHECK (length(btrim(nom)) > 0);

-- Une absence d'un an au plus, fin incluse
ALTER TABLE absence_agent ADD CONSTRAINT absence_agent_periode CHECK (au >= du AND au - du <= 366);

-- Le second niveau suit toujours le dépassement de l'échéance
ALTER TABLE reclamation ADD CONSTRAINT reclamation_escalade_admin CHECK (escaladee_admin_le IS NULL OR depassement_sla_signale_le IS NOT NULL);


-- -----------------------------------------------------------------------------
--  Droits et isolation (mêmes règles que l'étape 3)
-- -----------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON groupe_agents, groupe_agents_membre TO acces_banque;
-- Une absence se déclare ou se retire ; elle ne se modifie pas
GRANT SELECT, INSERT, DELETE ON absence_agent TO acces_banque;

-- L'Admin Entreprise règle le mode et les seuils ; ouvrir la fonction reste au Super Admin
GRANT UPDATE (mode_attribution, seuil_escalade_admin_pourcent, seuil_escalade_admin_urgent_pourcent) ON banque TO acces_banque;

GRANT SELECT (derniere_attribution_le), UPDATE (derniere_attribution_le) ON utilisateur TO acces_banque;
GRANT UPDATE (escaladee_admin_le) ON reclamation TO acces_banque, acces_systeme;

ALTER TABLE groupe_agents        ENABLE ROW LEVEL SECURITY;
ALTER TABLE groupe_agents_membre ENABLE ROW LEVEL SECURITY;
ALTER TABLE absence_agent        ENABLE ROW LEVEL SECURITY;

CREATE POLICY banque_isolation ON groupe_agents FOR ALL TO acces_banque
  USING (tenant_id = app_tenant_courant()) WITH CHECK (tenant_id = app_tenant_courant());
CREATE POLICY banque_isolation ON groupe_agents_membre FOR ALL TO acces_banque
  USING (tenant_id = app_tenant_courant()) WITH CHECK (tenant_id = app_tenant_courant());
CREATE POLICY banque_isolation ON absence_agent FOR ALL TO acces_banque
  USING (tenant_id = app_tenant_courant()) WITH CHECK (tenant_id = app_tenant_courant());

-- Le Super Admin ne voit ni les groupes, ni les absences, ni les seuils des catégories :
-- seulement le réglage banque.attribution_automatique (droits de l'étape 3 sur banque).
