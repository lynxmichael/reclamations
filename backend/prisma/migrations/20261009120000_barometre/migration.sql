-- =============================================================================
--  Étape 23 — Baromètre mensuel de l'expérience client et recommandations
--
--  - banque.barometre : ouvert par Makor banque par banque (décision I2 de l'étape 14).
--  - barometre : un instantané par banque et par mois, publié le 1er du mois suivant par le worker, figé
--    ensuite (aucun droit de modification ni de suppression). Lu par la banque seulement : il contient
--    les commentaires des clients ; le Super Admin n'y a aucun droit (arbitrage 7).
--  - recommandation_barometre : ses recommandations ; la banque n'en modifie que la décision.
--  - finalite_ia : BAROMETRE, pour le journal des appels à l'IA (plafond, facturation).
--
--  La nouvelle valeur d'énumération n'est pas employée dans cette migration.
-- =============================================================================

-- AlterEnum
ALTER TYPE "finalite_ia" ADD VALUE 'BAROMETRE';

-- AlterTable
ALTER TABLE "banque" ADD COLUMN "barometre" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "barometre" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "mois" DATE NOT NULL,
    "source" VARCHAR(10) NOT NULL,
    "contenu" JSONB NOT NULL,
    "genere_le" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "barometre_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recommandation_barometre" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "barometre_id" UUID NOT NULL,
    "ordre" SMALLINT NOT NULL,
    "titre" VARCHAR(160) NOT NULL,
    "constat" VARCHAR(600) NOT NULL,
    "action" VARCHAR(600) NOT NULL,
    "categorie_id" UUID,
    "priorite" VARCHAR(10) NOT NULL,
    "source" VARCHAR(10) NOT NULL,
    "decision" VARCHAR(12) NOT NULL DEFAULT 'A_ETUDIER',
    "commentaire" VARCHAR(1000),
    "decidee_par_id" UUID,
    "decidee_le" TIMESTAMPTZ(3),

    CONSTRAINT "recommandation_barometre_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "barometre_tenant_id_mois_key" ON "barometre"("tenant_id", "mois");

-- CreateIndex
CREATE UNIQUE INDEX "barometre_tenant_id_id_key" ON "barometre"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "recommandation_barometre_barometre_id_ordre_key" ON "recommandation_barometre"("barometre_id", "ordre");

-- CreateIndex
CREATE INDEX "recommandation_barometre_tenant_id_barometre_id_idx" ON "recommandation_barometre"("tenant_id", "barometre_id");

-- AddForeignKey
ALTER TABLE "barometre" ADD CONSTRAINT "barometre_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "banque"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recommandation_barometre" ADD CONSTRAINT "recommandation_barometre_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "banque"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recommandation_barometre" ADD CONSTRAINT "recommandation_barometre_tenant_id_barometre_id_fkey" FOREIGN KEY ("tenant_id", "barometre_id") REFERENCES "barometre"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recommandation_barometre" ADD CONSTRAINT "recommandation_barometre_tenant_id_categorie_id_fkey" FOREIGN KEY ("tenant_id", "categorie_id") REFERENCES "categorie"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recommandation_barometre" ADD CONSTRAINT "recommandation_barometre_tenant_id_decidee_par_id_fkey" FOREIGN KEY ("tenant_id", "decidee_par_id") REFERENCES "utilisateur"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---- Contraintes ----------------------------------------------------------------------------------

-- Un baromètre par mois civil : le premier jour du mois
ALTER TABLE barometre ADD CONSTRAINT barometre_premier_du_mois CHECK (mois = date_trunc('month', mois)::date);
ALTER TABLE barometre ADD CONSTRAINT barometre_source CHECK (source IN ('IA', 'REGLES'));
ALTER TABLE barometre ADD CONSTRAINT barometre_contenu_objet CHECK (jsonb_typeof(contenu) = 'object');

ALTER TABLE recommandation_barometre ADD CONSTRAINT recommandation_ordre CHECK (ordre BETWEEN 1 AND 5);
ALTER TABLE recommandation_barometre ADD CONSTRAINT recommandation_priorite CHECK (priorite IN ('HAUTE', 'MOYENNE'));
ALTER TABLE recommandation_barometre ADD CONSTRAINT recommandation_source CHECK (source IN ('IA', 'REGLES'));
ALTER TABLE recommandation_barometre ADD CONSTRAINT recommandation_decision CHECK (decision IN ('A_ETUDIER', 'RETENUE', 'ECARTEE'));
-- Qui a décidé, et quand : les deux ensemble
ALTER TABLE recommandation_barometre ADD CONSTRAINT recommandation_decidee CHECK ((decidee_le IS NULL) = (decidee_par_id IS NULL));

-- ---- Droits ---------------------------------------------------------------------------------------

-- Banque : elle lit ses baromètres ; elle ne décide que des recommandations, rien d'autre ne change
GRANT SELECT ON barometre, recommandation_barometre TO acces_banque;
GRANT UPDATE (decision, commentaire, decidee_par_id, decidee_le) ON recommandation_barometre TO acces_banque;

-- Système (worker) : il publie, sans pouvoir modifier ni effacer ce qui est publié
GRANT SELECT, INSERT ON barometre, recommandation_barometre TO acces_systeme;

-- Super Admin : aucun droit (les commentaires des clients y figurent) ; il ouvre la fonction
-- (banque.barometre, droits de l'étape 3) et voit l'usage de l'IA (appel_ia)

ALTER TABLE barometre                ENABLE ROW LEVEL SECURITY;
ALTER TABLE recommandation_barometre ENABLE ROW LEVEL SECURITY;

CREATE POLICY banque_isolation ON barometre FOR SELECT TO acces_banque USING (tenant_id = app_tenant_courant());
CREATE POLICY banque_isolation ON recommandation_barometre FOR ALL TO acces_banque
  USING (tenant_id = app_tenant_courant()) WITH CHECK (tenant_id = app_tenant_courant());
