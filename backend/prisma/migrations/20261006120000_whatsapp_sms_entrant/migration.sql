-- =============================================================================
--  Étape 20 — WhatsApp Business et SMS entrant (décisions I1, I2 et I7 de l'étape 14)
--
--  - banque.whatsapp, banque.sms_entrant : ouverts par Makor banque par banque (décision I2),
--    seulement avec le chat web : les messages entrent dans la conversation de la réclamation et dans
--    la boîte de réception des agents (étape 17).
--  - canal_banque : le numéro WhatsApp ou SMS de la banque, raccordé par Makor. Les messages reçus sont
--    routés vers la banque par son identifiant. Le jeton WhatsApp, chiffré, n'est lu que par le système.
--  - session_canal : l'échange en cours avec un client (réclamation choisie, dépôt en préparation),
--    effacé 24 h après son dernier message.
--  - message_entrant : un message reçu ne se traite qu'une fois (Meta renvoie ses webhooks jusqu'à
--    7 jours). Ni contenu ni numéro : le texte est dans le commentaire de la réclamation.
--  - commentaire.canal : où le client a écrit, ou par où la réponse de la banque lui est partie.
--  - notification : canal WHATSAPP ; expéditeur des SMS d'une conversation ; facturation de Meta.
--
--  Les nouvelles valeurs d'énumération ne sont pas employées dans cette migration (PostgreSQL ne le
--  permet pas avant la fin de la transaction) : les contraintes comparent leur texte.
-- =============================================================================

-- AlterEnum
ALTER TYPE "canal_depot" ADD VALUE 'WHATSAPP';
ALTER TYPE "canal_depot" ADD VALUE 'SMS';

-- AlterEnum
ALTER TYPE "canal_notification" ADD VALUE 'WHATSAPP';

-- AlterTable
ALTER TABLE "banque" ADD COLUMN     "sms_entrant" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "whatsapp" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "commentaire" ADD COLUMN     "canal" "canal_conversation";

-- AlterTable
ALTER TABLE "notification" ADD COLUMN     "categorie_tarif" VARCHAR(30),
ADD COLUMN     "expediteur" VARCHAR(20),
ADD COLUMN     "facturable" BOOLEAN;

-- CreateTable
CREATE TABLE "canal_banque" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "canal" "canal_conversation" NOT NULL,
    "identifiant" VARCHAR(64) NOT NULL,
    "numero" VARCHAR(20) NOT NULL,
    "compte_whatsapp" VARCHAR(64),
    "jeton_chiffre" VARCHAR(2000),
    "point_depot_id" UUID NOT NULL,
    "cree_le" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifie_le" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "canal_banque_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_canal" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "canal" "canal_conversation" NOT NULL,
    "telephone" VARCHAR(20) NOT NULL,
    "etape" VARCHAR(20) NOT NULL DEFAULT 'LIBRE',
    "reclamation_id" UUID,
    "donnees" JSONB,
    "dernier_message_le" TIMESTAMPTZ(3) NOT NULL,
    "reponses_auto" INTEGER NOT NULL DEFAULT 0,
    "jour_reponses_auto" VARCHAR(10),
    "cree_le" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifie_le" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "session_canal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_entrant" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "canal" "canal_conversation" NOT NULL,
    "id_externe" VARCHAR(160) NOT NULL,
    "issue" VARCHAR(20) NOT NULL,
    "commentaire_id" UUID,
    "recu_le" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "message_entrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "canal_banque_canal_identifiant_key" ON "canal_banque"("canal", "identifiant");

-- CreateIndex
CREATE UNIQUE INDEX "canal_banque_tenant_id_canal_key" ON "canal_banque"("tenant_id", "canal");

-- CreateIndex
CREATE UNIQUE INDEX "canal_banque_tenant_id_point_depot_id_key" ON "canal_banque"("tenant_id", "point_depot_id");

-- CreateIndex
CREATE INDEX "session_canal_dernier_message_le_idx" ON "session_canal"("dernier_message_le");

-- CreateIndex
CREATE UNIQUE INDEX "session_canal_tenant_id_canal_telephone_key" ON "session_canal"("tenant_id", "canal", "telephone");

-- CreateIndex
CREATE INDEX "message_entrant_tenant_id_recu_le_idx" ON "message_entrant"("tenant_id", "recu_le");

-- CreateIndex
CREATE INDEX "notification_id_fournisseur_idx" ON "notification"("id_fournisseur");

-- CreateIndex
CREATE UNIQUE INDEX "message_entrant_canal_id_externe_key" ON "message_entrant"("canal", "id_externe");

-- AddForeignKey
ALTER TABLE "canal_banque" ADD CONSTRAINT "canal_banque_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "banque"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "canal_banque" ADD CONSTRAINT "canal_banque_tenant_id_point_depot_id_fkey" FOREIGN KEY ("tenant_id", "point_depot_id") REFERENCES "point_depot"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_canal" ADD CONSTRAINT "session_canal_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "banque"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_canal" ADD CONSTRAINT "session_canal_tenant_id_reclamation_id_fkey" FOREIGN KEY ("tenant_id", "reclamation_id") REFERENCES "reclamation"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_entrant" ADD CONSTRAINT "message_entrant_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "banque"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_entrant" ADD CONSTRAINT "message_entrant_tenant_id_commentaire_id_fkey" FOREIGN KEY ("tenant_id", "commentaire_id") REFERENCES "commentaire"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- -----------------------------------------------------------------------------
--  Contraintes
-- -----------------------------------------------------------------------------

-- Les messages entrent dans la conversation de la réclamation : pas de WhatsApp ni de SMS entrant sans chat web
ALTER TABLE banque ADD CONSTRAINT banque_canaux_avec_chat CHECK ((NOT whatsapp AND NOT sms_entrant) OR chat_web);

-- Un point de dépôt WhatsApp ou SMS est le numéro de la banque : il n'appartient à aucune agence
ALTER TABLE point_depot ADD CONSTRAINT point_depot_canal_message_sans_agence
  CHECK (canal::text NOT IN ('WHATSAPP', 'SMS') OR agence_id IS NULL);

ALTER TABLE canal_banque
  ADD CONSTRAINT canal_banque_canal CHECK (canal <> 'WEB'),
  ADD CONSTRAINT canal_banque_numero CHECK (numero ~ '^\+[1-9][0-9]{7,14}$'),
  -- WhatsApp : le compte de la banque et son jeton ; SMS : le numéro de réception, sans jeton
  ADD CONSTRAINT canal_banque_whatsapp CHECK (canal <> 'WHATSAPP' OR (compte_whatsapp IS NOT NULL AND jeton_chiffre IS NOT NULL)),
  ADD CONSTRAINT canal_banque_sms CHECK (canal <> 'SMS' OR (identifiant = numero AND compte_whatsapp IS NULL AND jeton_chiffre IS NULL));

ALTER TABLE session_canal
  ADD CONSTRAINT session_canal_canal CHECK (canal <> 'WEB'),
  ADD CONSTRAINT session_canal_etape CHECK (etape IN ('LIBRE', 'CHOIX', 'DESCRIPTION', 'CATEGORIE', 'CONFIRMATION', 'NOM')),
  ADD CONSTRAINT session_canal_telephone CHECK (telephone ~ '^\+[1-9][0-9]{7,14}$'),
  ADD CONSTRAINT session_canal_reponses_auto CHECK (reponses_auto >= 0);

ALTER TABLE message_entrant
  ADD CONSTRAINT message_entrant_canal CHECK (canal <> 'WEB'),
  -- EN_COURS : réservé à la réception, avant le traitement (effacé si le traitement échoue : Meta réessaie)
  ADD CONSTRAINT message_entrant_issue CHECK (issue IN ('EN_COURS', 'RATTACHE', 'CONFIRMATION', 'DEPOT', 'ASSISTANT', 'CHOIX', 'NON_PRIS_EN_CHARGE', 'LIMITE')),
  ADD CONSTRAINT message_entrant_rattache CHECK ((issue = 'RATTACHE') = (commentaire_id IS NOT NULL));

-- Seuls un message du client et une réponse de la banque ont un canal ; jamais une note interne
ALTER TABLE commentaire ADD CONSTRAINT commentaire_canal CHECK (canal IS NULL OR type <> 'NOTE_INTERNE');

-- Expéditeur : SMS seulement ; facturation de Meta : WhatsApp seulement
ALTER TABLE notification
  ADD CONSTRAINT notification_expediteur CHECK (expediteur IS NULL OR canal::text = 'SMS'),
  ADD CONSTRAINT notification_facturation_whatsapp CHECK ((categorie_tarif IS NULL AND facturable IS NULL) OR canal::text = 'WHATSAPP');


-- -----------------------------------------------------------------------------
--  Droits et isolation (mêmes règles que l'étape 3)
-- -----------------------------------------------------------------------------

-- Système : routage des messages reçus, envoi (jeton), raccordement par Makor, effacement des sessions
GRANT SELECT, INSERT, UPDATE, DELETE ON canal_banque, session_canal TO acces_systeme;
GRANT SELECT, INSERT, UPDATE, DELETE ON message_entrant TO acces_systeme;

-- Système : un statut de Meta (réponse lue sur WhatsApp, message non remis) met à jour la lecture du
-- client et rouvre l'avis différé de la conversation (étape 17), sans rien lire d'autre
GRANT UPDATE (lu_client_le, avis_client_le) ON conversation TO acces_systeme;

-- Banque : son numéro (sans identifiant chez Meta ni jeton) ; ses sessions et messages reçus
GRANT SELECT (id, tenant_id, canal, numero, point_depot_id, cree_le, modifie_le) ON canal_banque TO acces_banque;
GRANT SELECT, INSERT, UPDATE, DELETE ON session_canal TO acces_banque;
GRANT SELECT, INSERT ON message_entrant TO acces_banque;
GRANT UPDATE (issue, commentaire_id) ON message_entrant TO acces_banque;

-- Super Admin : le raccordement de chaque banque, sans le jeton ; ni session, ni message (il compte les
-- volumes par la fonction facturation_canaux ci-dessous)
GRANT SELECT (id, tenant_id, canal, identifiant, numero, compte_whatsapp, point_depot_id, cree_le, modifie_le) ON canal_banque TO acces_plateforme;

ALTER TABLE canal_banque    ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_canal   ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_entrant ENABLE ROW LEVEL SECURITY;

CREATE POLICY banque_isolation ON canal_banque FOR SELECT TO acces_banque USING (tenant_id = app_tenant_courant());
CREATE POLICY banque_isolation ON session_canal FOR ALL TO acces_banque
  USING (tenant_id = app_tenant_courant()) WITH CHECK (tenant_id = app_tenant_courant());
CREATE POLICY banque_isolation ON message_entrant FOR ALL TO acces_banque
  USING (tenant_id = app_tenant_courant()) WITH CHECK (tenant_id = app_tenant_courant());

CREATE POLICY plateforme_toutes_banques ON canal_banque FOR SELECT TO acces_plateforme USING (true);


-- -----------------------------------------------------------------------------
--  Facturation par banque (décision I2) : totaux seulement, comme facturation_sms (étape 9)
-- -----------------------------------------------------------------------------
--  - whatsapp_envoyes   : messages remis à Meta pendant la période ;
--  - whatsapp_factures  : ceux que Meta a déclarés facturables (au-delà de ses gratuités) ;
--  - whatsapp_echecs    : messages créés pendant la période et abandonnés ;
--  - whatsapp_recus, sms_recus : messages des clients reçus pendant la période.

CREATE OR REPLACE FUNCTION facturation_canaux(p_debut timestamptz, p_fin timestamptz)
  RETURNS TABLE (tenant_id uuid, whatsapp_envoyes bigint, whatsapp_factures bigint, whatsapp_echecs bigint, whatsapp_recus bigint, sms_recus bigint)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  WITH envoyes AS (
    SELECT n.tenant_id,
           count(*) FILTER (WHERE n.statut IN ('ENVOYEE', 'DELIVREE') AND n.envoyee_le >= p_debut AND n.envoyee_le < p_fin) AS envoyes,
           count(*) FILTER (WHERE n.facturable AND n.envoyee_le >= p_debut AND n.envoyee_le < p_fin) AS factures,
           count(*) FILTER (WHERE n.statut = 'ECHEC' AND n.cree_le >= p_debut AND n.cree_le < p_fin) AS echecs
      FROM notification n
     WHERE n.canal::text = 'WHATSAPP'
       AND n.tenant_id IS NOT NULL
       AND ((n.envoyee_le >= p_debut AND n.envoyee_le < p_fin) OR (n.cree_le >= p_debut AND n.cree_le < p_fin))
     GROUP BY n.tenant_id
  ), recus AS (
    SELECT m.tenant_id,
           count(*) FILTER (WHERE m.canal = 'WHATSAPP') AS whatsapp,
           count(*) FILTER (WHERE m.canal = 'SMS') AS sms
      FROM message_entrant m
     WHERE m.recu_le >= p_debut AND m.recu_le < p_fin
     GROUP BY m.tenant_id
  )
  SELECT coalesce(e.tenant_id, r.tenant_id),
         coalesce(e.envoyes, 0), coalesce(e.factures, 0), coalesce(e.echecs, 0),
         coalesce(r.whatsapp, 0), coalesce(r.sms, 0)
    FROM envoyes e FULL JOIN recus r ON r.tenant_id = e.tenant_id
$$;

REVOKE ALL ON FUNCTION facturation_canaux(timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION facturation_canaux(timestamptz, timestamptz) TO acces_plateforme;
