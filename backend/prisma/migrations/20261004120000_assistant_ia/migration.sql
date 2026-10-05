-- =============================================================================
--  Étape 18 — Assistant IA de première ligne (décisions I3 à I6 de l'étape 14)
--
--  - banque.assistant_ia : ouvert par Makor banque par banque (décision I2), seulement avec le chat
--    web (l'assistant passe la main à un conseiller dans le chat).
--  - reponse_assistant : la base de réponses écrite et validée par l'Admin Entreprise. Sur le portail,
--    le client ne lit que ces réponses et les textes fixes de l'assistant (décision I4).
--  - appel_ia : un enregistrement par appel, sans aucun contenu (décision I5) ; il sert au plafond
--    quotidien de la banque et à la facturation de l'usage (décision I2).
-- =============================================================================

-- CreateEnum
CREATE TYPE "finalite_ia" AS ENUM ('ACCUEIL_PORTAIL', 'SUGGESTION_AGENT');

-- CreateEnum
CREATE TYPE "issue_appel_ia" AS ENUM ('OK', 'REGLES', 'PLAFOND', 'HORS_DELAI', 'ERREUR', 'REPONSE_INVALIDE');

-- AlterTable
ALTER TABLE "banque" ADD COLUMN     "assistant_ia" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "reponse_assistant" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "question" VARCHAR(300) NOT NULL,
    "reponse" VARCHAR(2000) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "ordre" INTEGER NOT NULL DEFAULT 0,
    "cree_le" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifie_le" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "reponse_assistant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appel_ia" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "finalite" "finalite_ia" NOT NULL,
    "fournisseur" VARCHAR(20) NOT NULL,
    "modele" VARCHAR(80),
    "jetons_entree" INTEGER NOT NULL DEFAULT 0,
    "jetons_sortie" INTEGER NOT NULL DEFAULT 0,
    "cout_micro_usd" INTEGER NOT NULL DEFAULT 0,
    "duree_ms" INTEGER NOT NULL,
    "issue" "issue_appel_ia" NOT NULL,
    "cree_le" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "appel_ia_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reponse_assistant_tenant_id_ordre_idx" ON "reponse_assistant"("tenant_id", "ordre");

-- CreateIndex
CREATE UNIQUE INDEX "reponse_assistant_tenant_id_id_key" ON "reponse_assistant"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "appel_ia_tenant_id_cree_le_idx" ON "appel_ia"("tenant_id", "cree_le");

-- CreateIndex
CREATE INDEX "appel_ia_cree_le_idx" ON "appel_ia"("cree_le");

-- AddForeignKey
ALTER TABLE "reponse_assistant" ADD CONSTRAINT "reponse_assistant_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "banque"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appel_ia" ADD CONSTRAINT "appel_ia_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "banque"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- -----------------------------------------------------------------------------
--  Contraintes
-- -----------------------------------------------------------------------------

-- L'assistant passe la main dans le chat : pas d'assistant sans chat web
ALTER TABLE banque ADD CONSTRAINT banque_assistant_avec_chat CHECK (NOT assistant_ia OR chat_web);

ALTER TABLE reponse_assistant ADD CONSTRAINT reponse_assistant_remplie
  CHECK (length(btrim(question)) > 0 AND length(btrim(reponse)) > 0);

ALTER TABLE appel_ia
  ADD CONSTRAINT appel_ia_volumes CHECK (jetons_entree >= 0 AND jetons_sortie >= 0 AND cout_micro_usd >= 0 AND duree_ms >= 0),
  -- « regles » : aucun fournisseur configuré ; rien n'est alors envoyé
  ADD CONSTRAINT appel_ia_regles CHECK ((issue = 'REGLES') = (fournisseur = 'regles')),
  -- Sans envoi (règles seules, plafond atteint), ni jeton ni coût
  ADD CONSTRAINT appel_ia_sans_envoi CHECK (
    issue NOT IN ('REGLES', 'PLAFOND') OR (jetons_entree = 0 AND jetons_sortie = 0 AND cout_micro_usd = 0)
  );


-- -----------------------------------------------------------------------------
--  Droits et isolation (mêmes règles que l'étape 3)
-- -----------------------------------------------------------------------------

-- Banque : l'Admin Entreprise écrit sa base de réponses ; tout le personnel la lit
GRANT SELECT, INSERT, DELETE ON reponse_assistant TO acces_banque;
GRANT UPDATE (question, reponse, active, ordre, modifie_le) ON reponse_assistant TO acces_banque;

-- Journal des appels : il s'écrit, il ne se modifie ni ne s'efface
GRANT SELECT, INSERT ON appel_ia TO acces_banque;

-- Super Admin : le journal des appels, sans contenu, pour la facturation (décision I2) ; rien sur la
-- base de réponses. Il ouvre l'assistant à une banque (banque.assistant_ia, droits de l'étape 3).
GRANT SELECT ON appel_ia TO acces_plateforme;

ALTER TABLE reponse_assistant ENABLE ROW LEVEL SECURITY;
ALTER TABLE appel_ia          ENABLE ROW LEVEL SECURITY;

CREATE POLICY banque_isolation ON reponse_assistant FOR ALL TO acces_banque
  USING (tenant_id = app_tenant_courant()) WITH CHECK (tenant_id = app_tenant_courant());
CREATE POLICY banque_isolation ON appel_ia FOR ALL TO acces_banque
  USING (tenant_id = app_tenant_courant()) WITH CHECK (tenant_id = app_tenant_courant());

-- Le Super Admin lit le journal de toutes les banques (comme reclamation, étape 3)
CREATE POLICY plateforme_toutes_banques ON appel_ia FOR SELECT TO acces_plateforme USING (true);
