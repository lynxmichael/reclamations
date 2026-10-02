-- =============================================================================
--  Étape 17 — Conversations et chat web (décisions I1 et I8 de l'étape 14)
--
--  - Une conversation par réclamation, commune à tous les canaux : chat du portail à cette étape,
--    WhatsApp et SMS entrant à l'étape 19. Ses messages sont les commentaires publics de la
--    réclamation : SLA, chronologie, pièces jointes et immuabilité ne changent pas.
--  - La conversation porte le canal où le client a écrit en dernier, l'heure du dernier message de
--    chaque côté, les marques de lecture (client, banque) et l'heure du dernier avis différé.
--  Le chat s'ouvre banque par banque (banque.chat_web, réglée par le Super Admin, décision I2) ; une
--  banque qui ne l'a pas garde le fil de messages de l'espace client.
-- =============================================================================

-- CreateEnum
CREATE TYPE "canal_conversation" AS ENUM ('WEB', 'WHATSAPP', 'SMS');

-- AlterTable
ALTER TABLE "banque" ADD COLUMN     "chat_web" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "conversation" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "reclamation_id" UUID NOT NULL,
    "canal" "canal_conversation" NOT NULL DEFAULT 'WEB',
    "cree_le" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dernier_message_client_le" TIMESTAMPTZ(3),
    "dernier_message_banque_le" TIMESTAMPTZ(3),
    "lu_client_le" TIMESTAMPTZ(3),
    "lu_banque_le" TIMESTAMPTZ(3),
    "avis_client_le" TIMESTAMPTZ(3),

    CONSTRAINT "conversation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "conversation_tenant_id_dernier_message_client_le_idx" ON "conversation"("tenant_id", "dernier_message_client_le");

-- CreateIndex
CREATE INDEX "conversation_dernier_message_banque_le_idx" ON "conversation"("dernier_message_banque_le");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_tenant_id_id_key" ON "conversation"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_tenant_id_reclamation_id_key" ON "conversation"("tenant_id", "reclamation_id");

-- AddForeignKey
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "banque"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_tenant_id_reclamation_id_fkey" FOREIGN KEY ("tenant_id", "reclamation_id") REFERENCES "reclamation"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- -----------------------------------------------------------------------------
--  Contraintes
-- -----------------------------------------------------------------------------

-- Un avis différé suit toujours une réponse de la banque
ALTER TABLE conversation ADD CONSTRAINT conversation_avis_apres_reponse
  CHECK (avis_client_le IS NULL OR dernier_message_banque_le IS NOT NULL);


-- -----------------------------------------------------------------------------
--  Droits et isolation (mêmes règles que l'étape 3)
-- -----------------------------------------------------------------------------

-- Banque : une conversation s'ouvre puis se met à jour ; elle ne se supprime pas
GRANT SELECT, INSERT ON conversation TO acces_banque;
GRANT UPDATE (canal, dernier_message_client_le, dernier_message_banque_le, lu_client_le, lu_banque_le, avis_client_le)
  ON conversation TO acces_banque;

-- Worker : repère les réponses restées non lues, toutes banques confondues ; l'avis s'écrit ensuite
-- dans la transaction de la banque concernée
GRANT SELECT (id, tenant_id, reclamation_id, dernier_message_banque_le, lu_client_le, avis_client_le)
  ON conversation TO acces_systeme;

ALTER TABLE conversation ENABLE ROW LEVEL SECURITY;

CREATE POLICY banque_isolation ON conversation FOR ALL TO acces_banque
  USING (tenant_id = app_tenant_courant()) WITH CHECK (tenant_id = app_tenant_courant());

-- Le Super Admin n'a aucun droit sur les conversations (arbitrage 7, décision I5) : il ouvre le chat
-- à une banque (banque.chat_web, droits de l'étape 3 sur banque), sans jamais voir un échange.
