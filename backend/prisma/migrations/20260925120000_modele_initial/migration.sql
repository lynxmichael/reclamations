-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "role_utilisateur" AS ENUM ('SUPER_ADMIN', 'ADMIN_ENTREPRISE', 'SUPERVISEUR', 'AGENT');

-- CreateEnum
CREATE TYPE "statut_utilisateur" AS ENUM ('INVITE', 'ACTIF', 'DESACTIVE');

-- CreateEnum
CREATE TYPE "type_jeton" AS ENUM ('INVITATION', 'REINITIALISATION');

-- CreateEnum
CREATE TYPE "canal_depot" AS ENUM ('QR_CODE', 'LIEN_WEB');

-- CreateEnum
CREATE TYPE "statut_reclamation" AS ENUM ('OUVERTE', 'EN_COURS', 'EN_ATTENTE_CLIENT', 'RESOLUE', 'CLOTUREE');

-- CreateEnum
CREATE TYPE "priorite" AS ENUM ('NORMALE', 'URGENTE');

-- CreateEnum
CREATE TYPE "mode_cloture" AS ENUM ('CONFIRMATION_CLIENT', 'AUTOMATIQUE', 'FORCEE');

-- CreateEnum
CREATE TYPE "motif_cloture_forcee" AS ENUM ('DOUBLON', 'HORS_PERIMETRE', 'ABUS', 'AUTRE');

-- CreateEnum
CREATE TYPE "type_commentaire" AS ENUM ('NOTE_INTERNE', 'REPONSE_AU_CLIENT', 'MESSAGE_DU_CLIENT');

-- CreateEnum
CREATE TYPE "type_evenement" AS ENUM ('CREATION', 'PRISE_EN_CHARGE', 'QUESTION_AU_CLIENT', 'REPONSE_DU_CLIENT', 'RESOLUTION', 'CONFIRMATION', 'CONTESTATION', 'CLOTURE_AUTOMATIQUE', 'CLOTURE_FORCEE', 'ASSIGNATION', 'CHANGEMENT_PRIORITE', 'ESCALADE', 'ALERTE_SLA_PREVENTIVE', 'DEPASSEMENT_SLA', 'MESSAGE', 'PIECE_JOINTE');

-- CreateEnum
CREATE TYPE "type_acteur" AS ENUM ('CLIENT', 'UTILISATEUR', 'SYSTEME');

-- CreateEnum
CREATE TYPE "canal_notification" AS ENUM ('EMAIL', 'SMS', 'IN_APP');

-- CreateEnum
CREATE TYPE "statut_notification" AS ENUM ('EN_ATTENTE', 'ENVOYEE', 'DELIVREE', 'ECHEC');

-- CreateTable
CREATE TABLE "plan" (
    "id" UUID NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "nom" VARCHAR(120) NOT NULL,
    "description" TEXT,
    "plafond_agents" INTEGER,
    "plafond_tickets_mois" INTEGER,
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "cree_le" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifie_le" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "banque" (
    "id" UUID NOT NULL,
    "nom" VARCHAR(160) NOT NULL,
    "slug" VARCHAR(63) NOT NULL,
    "prefixe_tickets" VARCHAR(10) NOT NULL,
    "plan_id" UUID NOT NULL,
    "fuseau_horaire" VARCHAR(64) NOT NULL DEFAULT 'Africa/Abidjan',
    "couleur_primaire" VARCHAR(7),
    "couleur_secondaire" VARCHAR(7),
    "logo_cle" VARCHAR(255),
    "email_contact" VARCHAR(254),
    "seuil_alerte_sla_pourcent" INTEGER NOT NULL DEFAULT 75,
    "delai_cloture_auto_jours" INTEGER NOT NULL DEFAULT 5,
    "sms_chaque_changement_statut" BOOLEAN NOT NULL DEFAULT true,
    "suspendue_le" TIMESTAMPTZ(3),
    "motif_suspension" TEXT,
    "cree_le" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifie_le" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "banque_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agence" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "nom" VARCHAR(160) NOT NULL,
    "ville" VARCHAR(120),
    "adresse" VARCHAR(255),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "cree_le" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifie_le" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "agence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "point_depot" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "agence_id" UUID,
    "code" VARCHAR(16) NOT NULL,
    "canal" "canal_depot" NOT NULL,
    "libelle" VARCHAR(160) NOT NULL,
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "cree_le" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifie_le" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "point_depot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categorie" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "nom" VARCHAR(120) NOT NULL,
    "description" TEXT,
    "priorite_par_defaut" "priorite" NOT NULL DEFAULT 'NORMALE',
    "delai_cible_minutes" INTEGER NOT NULL,
    "ordre" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "cree_le" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifie_le" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "categorie_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "horaire_ouvre" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "jour_semaine" INTEGER NOT NULL,
    "debut_minute" INTEGER NOT NULL,
    "fin_minute" INTEGER NOT NULL,
    "cree_le" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifie_le" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "horaire_ouvre_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jour_ferie" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "libelle" VARCHAR(120) NOT NULL,
    "recurrent" BOOLEAN NOT NULL DEFAULT false,
    "cree_le" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifie_le" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "jour_ferie_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "utilisateur" (
    "id" UUID NOT NULL,
    "tenant_id" UUID,
    "role" "role_utilisateur" NOT NULL,
    "statut" "statut_utilisateur" NOT NULL DEFAULT 'INVITE',
    "email" VARCHAR(254) NOT NULL,
    "nom" VARCHAR(120) NOT NULL,
    "prenom" VARCHAR(120) NOT NULL,
    "telephone" VARCHAR(20),
    "mot_de_passe_hash" VARCHAR(255),
    "totp_secret_chiffre" VARCHAR(255),
    "totp_active_le" TIMESTAMPTZ(3),
    "superviseur_id" UUID,
    "echecs_connexion" INTEGER NOT NULL DEFAULT 0,
    "verrouille_jusqu_a" TIMESTAMPTZ(3),
    "derniere_connexion_le" TIMESTAMPTZ(3),
    "desactive_le" TIMESTAMPTZ(3),
    "cree_le" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifie_le" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "utilisateur_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_utilisateur" (
    "id" UUID NOT NULL,
    "utilisateur_id" UUID NOT NULL,
    "famille" UUID NOT NULL,
    "refresh_token_hash" CHAR(64) NOT NULL,
    "expire_le" TIMESTAMPTZ(3) NOT NULL,
    "remplace_le" TIMESTAMPTZ(3),
    "revoque_le" TIMESTAMPTZ(3),
    "ip" VARCHAR(45),
    "user_agent" VARCHAR(512),
    "cree_le" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_utilisateur_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jeton_utilisateur" (
    "id" UUID NOT NULL,
    "utilisateur_id" UUID NOT NULL,
    "type" "type_jeton" NOT NULL,
    "jeton_hash" CHAR(64) NOT NULL,
    "expire_le" TIMESTAMPTZ(3) NOT NULL,
    "utilise_le" TIMESTAMPTZ(3),
    "cree_le" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "jeton_utilisateur_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_final" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "nom" VARCHAR(160) NOT NULL,
    "email" VARCHAR(254),
    "telephone" VARCHAR(20),
    "cree_le" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifie_le" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "client_final_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "code_otp" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "canal" "canal_notification" NOT NULL,
    "destination" VARCHAR(254) NOT NULL,
    "code_hash" CHAR(64) NOT NULL,
    "expire_le" TIMESTAMPTZ(3) NOT NULL,
    "tentatives" INTEGER NOT NULL DEFAULT 0,
    "utilise_le" TIMESTAMPTZ(3),
    "cree_le" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "code_otp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reclamation" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "numero" VARCHAR(32) NOT NULL,
    "jeton_suivi" VARCHAR(64) NOT NULL,
    "client_id" UUID NOT NULL,
    "categorie_id" UUID NOT NULL,
    "point_depot_id" UUID NOT NULL,
    "agence_id" UUID,
    "canal" "canal_depot" NOT NULL,
    "description" TEXT NOT NULL,
    "statut" "statut_reclamation" NOT NULL DEFAULT 'OUVERTE',
    "priorite" "priorite" NOT NULL,
    "agent_id" UUID,
    "consentement_le" TIMESTAMPTZ(3) NOT NULL,
    "consentement_version" VARCHAR(20) NOT NULL,
    "delai_cible_minutes" INTEGER NOT NULL,
    "echeance_sla_le" TIMESTAMPTZ(3),
    "alerte_preventive_le" TIMESTAMPTZ(3),
    "sla_minutes_restantes" INTEGER,
    "sla_suspendu_le" TIMESTAMPTZ(3),
    "alerte_preventive_envoyee_le" TIMESTAMPTZ(3),
    "depassement_sla_signale_le" TIMESTAMPTZ(3),
    "sla_respecte" BOOLEAN,
    "escaladee_le" TIMESTAMPTZ(3),
    "escaladee_vers_id" UUID,
    "pris_en_charge_le" TIMESTAMPTZ(3),
    "premiere_reponse_le" TIMESTAMPTZ(3),
    "delai_premiere_reponse_minutes" INTEGER,
    "resolue_le" TIMESTAMPTZ(3),
    "delai_resolution_minutes" INTEGER,
    "passe_en_attente_client" BOOLEAN NOT NULL DEFAULT false,
    "nb_reouvertures" INTEGER NOT NULL DEFAULT 0,
    "cloture_auto_prevue_le" TIMESTAMPTZ(3),
    "cloture_le" TIMESTAMPTZ(3),
    "mode_cloture" "mode_cloture",
    "motif_cloture_forcee" "motif_cloture_forcee",
    "commentaire_cloture" TEXT,
    "cloture_par_id" UUID,
    "cree_le" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifie_le" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "reclamation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compteur_numero" (
    "tenant_id" UUID NOT NULL,
    "annee" INTEGER NOT NULL,
    "dernier" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "compteur_numero_pkey" PRIMARY KEY ("tenant_id","annee")
);

-- CreateTable
CREATE TABLE "commentaire" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "reclamation_id" UUID NOT NULL,
    "type" "type_commentaire" NOT NULL,
    "contenu" TEXT NOT NULL,
    "auteur_utilisateur_id" UUID,
    "cree_le" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commentaire_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "piece_jointe" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "reclamation_id" UUID NOT NULL,
    "commentaire_id" UUID,
    "nom_fichier" VARCHAR(255) NOT NULL,
    "type_mime" VARCHAR(100) NOT NULL,
    "taille_octets" INTEGER NOT NULL,
    "cle_stockage" VARCHAR(255) NOT NULL,
    "empreinte_sha256" CHAR(64) NOT NULL,
    "depose_par_type" "type_acteur" NOT NULL,
    "depose_par_utilisateur_id" UUID,
    "cree_le" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "piece_jointe_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reclamation_evenement" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "reclamation_id" UUID NOT NULL,
    "type" "type_evenement" NOT NULL,
    "statut_avant" "statut_reclamation",
    "statut_apres" "statut_reclamation",
    "acteur_type" "type_acteur" NOT NULL,
    "acteur_utilisateur_id" UUID,
    "visible_client" BOOLEAN NOT NULL,
    "donnees" JSONB,
    "cree_le" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reclamation_evenement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification" (
    "id" UUID NOT NULL,
    "tenant_id" UUID,
    "canal" "canal_notification" NOT NULL,
    "modele" VARCHAR(80) NOT NULL,
    "destinataire_utilisateur_id" UUID,
    "destinataire_client_id" UUID,
    "destination" VARCHAR(254),
    "reclamation_id" UUID,
    "sujet" VARCHAR(255),
    "contenu" TEXT NOT NULL,
    "statut" "statut_notification" NOT NULL DEFAULT 'EN_ATTENTE',
    "tentatives" INTEGER NOT NULL DEFAULT 0,
    "derniere_erreur" TEXT,
    "id_fournisseur" VARCHAR(128),
    "segments_sms" INTEGER,
    "cle_deduplication" VARCHAR(200),
    "envoyee_le" TIMESTAMPTZ(3),
    "lue_le" TIMESTAMPTZ(3),
    "cree_le" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_audit" (
    "id" BIGSERIAL NOT NULL,
    "chaine" VARCHAR(48) NOT NULL,
    "rang" BIGINT NOT NULL,
    "tenant_id" UUID,
    "horodatage" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acteur_type" "type_acteur" NOT NULL,
    "acteur_id" UUID,
    "acteur_libelle" VARCHAR(255),
    "acteur_role" VARCHAR(40),
    "action" VARCHAR(80) NOT NULL,
    "entite" VARCHAR(60),
    "entite_id" VARCHAR(64),
    "donnees" JSONB,
    "ip" VARCHAR(45),
    "user_agent" VARCHAR(512),
    "empreinte_precedente" CHAR(64) NOT NULL,
    "empreinte" CHAR(64) NOT NULL,

    CONSTRAINT "journal_audit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "plan_code_key" ON "plan"("code");

-- CreateIndex
CREATE UNIQUE INDEX "banque_slug_key" ON "banque"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "banque_prefixe_tickets_key" ON "banque"("prefixe_tickets");

-- CreateIndex
CREATE INDEX "banque_plan_id_idx" ON "banque"("plan_id");

-- CreateIndex
CREATE UNIQUE INDEX "agence_tenant_id_id_key" ON "agence"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "agence_tenant_id_code_key" ON "agence"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "point_depot_code_key" ON "point_depot"("code");

-- CreateIndex
CREATE INDEX "point_depot_tenant_id_agence_id_idx" ON "point_depot"("tenant_id", "agence_id");

-- CreateIndex
CREATE UNIQUE INDEX "point_depot_tenant_id_id_key" ON "point_depot"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "categorie_tenant_id_id_key" ON "categorie"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "categorie_tenant_id_nom_key" ON "categorie"("tenant_id", "nom");

-- CreateIndex
CREATE UNIQUE INDEX "horaire_ouvre_tenant_id_jour_semaine_debut_minute_key" ON "horaire_ouvre"("tenant_id", "jour_semaine", "debut_minute");

-- CreateIndex
CREATE UNIQUE INDEX "jour_ferie_tenant_id_date_key" ON "jour_ferie"("tenant_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "utilisateur_email_key" ON "utilisateur"("email");

-- CreateIndex
CREATE INDEX "utilisateur_tenant_id_role_statut_idx" ON "utilisateur"("tenant_id", "role", "statut");

-- CreateIndex
CREATE INDEX "utilisateur_tenant_id_superviseur_id_idx" ON "utilisateur"("tenant_id", "superviseur_id");

-- CreateIndex
CREATE UNIQUE INDEX "utilisateur_tenant_id_id_key" ON "utilisateur"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "session_utilisateur_refresh_token_hash_key" ON "session_utilisateur"("refresh_token_hash");

-- CreateIndex
CREATE INDEX "session_utilisateur_utilisateur_id_idx" ON "session_utilisateur"("utilisateur_id");

-- CreateIndex
CREATE INDEX "session_utilisateur_famille_idx" ON "session_utilisateur"("famille");

-- CreateIndex
CREATE UNIQUE INDEX "jeton_utilisateur_jeton_hash_key" ON "jeton_utilisateur"("jeton_hash");

-- CreateIndex
CREATE INDEX "jeton_utilisateur_utilisateur_id_type_idx" ON "jeton_utilisateur"("utilisateur_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "client_final_tenant_id_id_key" ON "client_final"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "client_final_tenant_id_email_key" ON "client_final"("tenant_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "client_final_tenant_id_telephone_key" ON "client_final"("tenant_id", "telephone");

-- CreateIndex
CREATE INDEX "code_otp_tenant_id_client_id_cree_le_idx" ON "code_otp"("tenant_id", "client_id", "cree_le");

-- CreateIndex
CREATE UNIQUE INDEX "reclamation_jeton_suivi_key" ON "reclamation"("jeton_suivi");

-- CreateIndex
CREATE INDEX "reclamation_tenant_id_statut_cree_le_idx" ON "reclamation"("tenant_id", "statut", "cree_le");

-- CreateIndex
CREATE INDEX "reclamation_tenant_id_agent_id_statut_idx" ON "reclamation"("tenant_id", "agent_id", "statut");

-- CreateIndex
CREATE INDEX "reclamation_tenant_id_priorite_statut_idx" ON "reclamation"("tenant_id", "priorite", "statut");

-- CreateIndex
CREATE INDEX "reclamation_tenant_id_escaladee_vers_id_statut_idx" ON "reclamation"("tenant_id", "escaladee_vers_id", "statut");

-- CreateIndex
CREATE INDEX "reclamation_tenant_id_client_id_cree_le_idx" ON "reclamation"("tenant_id", "client_id", "cree_le");

-- CreateIndex
CREATE INDEX "reclamation_tenant_id_agence_id_cree_le_idx" ON "reclamation"("tenant_id", "agence_id", "cree_le");

-- CreateIndex
CREATE INDEX "reclamation_tenant_id_categorie_id_cree_le_idx" ON "reclamation"("tenant_id", "categorie_id", "cree_le");

-- CreateIndex
CREATE INDEX "reclamation_tenant_id_canal_cree_le_idx" ON "reclamation"("tenant_id", "canal", "cree_le");

-- CreateIndex
CREATE INDEX "reclamation_statut_alerte_preventive_le_idx" ON "reclamation"("statut", "alerte_preventive_le");

-- CreateIndex
CREATE INDEX "reclamation_statut_echeance_sla_le_idx" ON "reclamation"("statut", "echeance_sla_le");

-- CreateIndex
CREATE INDEX "reclamation_statut_cloture_auto_prevue_le_idx" ON "reclamation"("statut", "cloture_auto_prevue_le");

-- CreateIndex
CREATE UNIQUE INDEX "reclamation_tenant_id_id_key" ON "reclamation"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "reclamation_tenant_id_numero_key" ON "reclamation"("tenant_id", "numero");

-- CreateIndex
CREATE INDEX "commentaire_tenant_id_reclamation_id_cree_le_idx" ON "commentaire"("tenant_id", "reclamation_id", "cree_le");

-- CreateIndex
CREATE UNIQUE INDEX "commentaire_tenant_id_id_key" ON "commentaire"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "piece_jointe_cle_stockage_key" ON "piece_jointe"("cle_stockage");

-- CreateIndex
CREATE INDEX "piece_jointe_tenant_id_reclamation_id_idx" ON "piece_jointe"("tenant_id", "reclamation_id");

-- CreateIndex
CREATE INDEX "piece_jointe_tenant_id_commentaire_id_idx" ON "piece_jointe"("tenant_id", "commentaire_id");

-- CreateIndex
CREATE INDEX "reclamation_evenement_tenant_id_reclamation_id_cree_le_idx" ON "reclamation_evenement"("tenant_id", "reclamation_id", "cree_le");

-- CreateIndex
CREATE INDEX "reclamation_evenement_tenant_id_type_cree_le_idx" ON "reclamation_evenement"("tenant_id", "type", "cree_le");

-- CreateIndex
CREATE UNIQUE INDEX "notification_cle_deduplication_key" ON "notification"("cle_deduplication");

-- CreateIndex
CREATE INDEX "notification_destinataire_utilisateur_id_canal_lue_le_idx" ON "notification"("destinataire_utilisateur_id", "canal", "lue_le");

-- CreateIndex
CREATE INDEX "notification_statut_cree_le_idx" ON "notification"("statut", "cree_le");

-- CreateIndex
CREATE INDEX "notification_tenant_id_canal_cree_le_idx" ON "notification"("tenant_id", "canal", "cree_le");

-- CreateIndex
CREATE INDEX "notification_tenant_id_reclamation_id_idx" ON "notification"("tenant_id", "reclamation_id");

-- CreateIndex
CREATE UNIQUE INDEX "journal_audit_empreinte_key" ON "journal_audit"("empreinte");

-- CreateIndex
CREATE INDEX "journal_audit_tenant_id_horodatage_idx" ON "journal_audit"("tenant_id", "horodatage");

-- CreateIndex
CREATE INDEX "journal_audit_entite_entite_id_idx" ON "journal_audit"("entite", "entite_id");

-- CreateIndex
CREATE UNIQUE INDEX "journal_audit_chaine_rang_key" ON "journal_audit"("chaine", "rang");

-- AddForeignKey
ALTER TABLE "banque" ADD CONSTRAINT "banque_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agence" ADD CONSTRAINT "agence_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "banque"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "point_depot" ADD CONSTRAINT "point_depot_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "banque"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "point_depot" ADD CONSTRAINT "point_depot_tenant_id_agence_id_fkey" FOREIGN KEY ("tenant_id", "agence_id") REFERENCES "agence"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categorie" ADD CONSTRAINT "categorie_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "banque"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "horaire_ouvre" ADD CONSTRAINT "horaire_ouvre_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "banque"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jour_ferie" ADD CONSTRAINT "jour_ferie_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "banque"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "utilisateur" ADD CONSTRAINT "utilisateur_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "banque"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "utilisateur" ADD CONSTRAINT "utilisateur_tenant_id_superviseur_id_fkey" FOREIGN KEY ("tenant_id", "superviseur_id") REFERENCES "utilisateur"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_utilisateur" ADD CONSTRAINT "session_utilisateur_utilisateur_id_fkey" FOREIGN KEY ("utilisateur_id") REFERENCES "utilisateur"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jeton_utilisateur" ADD CONSTRAINT "jeton_utilisateur_utilisateur_id_fkey" FOREIGN KEY ("utilisateur_id") REFERENCES "utilisateur"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_final" ADD CONSTRAINT "client_final_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "banque"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "code_otp" ADD CONSTRAINT "code_otp_tenant_id_client_id_fkey" FOREIGN KEY ("tenant_id", "client_id") REFERENCES "client_final"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reclamation" ADD CONSTRAINT "reclamation_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "banque"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reclamation" ADD CONSTRAINT "reclamation_tenant_id_client_id_fkey" FOREIGN KEY ("tenant_id", "client_id") REFERENCES "client_final"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reclamation" ADD CONSTRAINT "reclamation_tenant_id_categorie_id_fkey" FOREIGN KEY ("tenant_id", "categorie_id") REFERENCES "categorie"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reclamation" ADD CONSTRAINT "reclamation_tenant_id_point_depot_id_fkey" FOREIGN KEY ("tenant_id", "point_depot_id") REFERENCES "point_depot"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reclamation" ADD CONSTRAINT "reclamation_tenant_id_agence_id_fkey" FOREIGN KEY ("tenant_id", "agence_id") REFERENCES "agence"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reclamation" ADD CONSTRAINT "reclamation_tenant_id_agent_id_fkey" FOREIGN KEY ("tenant_id", "agent_id") REFERENCES "utilisateur"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reclamation" ADD CONSTRAINT "reclamation_tenant_id_escaladee_vers_id_fkey" FOREIGN KEY ("tenant_id", "escaladee_vers_id") REFERENCES "utilisateur"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reclamation" ADD CONSTRAINT "reclamation_tenant_id_cloture_par_id_fkey" FOREIGN KEY ("tenant_id", "cloture_par_id") REFERENCES "utilisateur"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compteur_numero" ADD CONSTRAINT "compteur_numero_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "banque"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commentaire" ADD CONSTRAINT "commentaire_tenant_id_reclamation_id_fkey" FOREIGN KEY ("tenant_id", "reclamation_id") REFERENCES "reclamation"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commentaire" ADD CONSTRAINT "commentaire_tenant_id_auteur_utilisateur_id_fkey" FOREIGN KEY ("tenant_id", "auteur_utilisateur_id") REFERENCES "utilisateur"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "piece_jointe" ADD CONSTRAINT "piece_jointe_tenant_id_reclamation_id_fkey" FOREIGN KEY ("tenant_id", "reclamation_id") REFERENCES "reclamation"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "piece_jointe" ADD CONSTRAINT "piece_jointe_tenant_id_commentaire_id_fkey" FOREIGN KEY ("tenant_id", "commentaire_id") REFERENCES "commentaire"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "piece_jointe" ADD CONSTRAINT "piece_jointe_tenant_id_depose_par_utilisateur_id_fkey" FOREIGN KEY ("tenant_id", "depose_par_utilisateur_id") REFERENCES "utilisateur"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reclamation_evenement" ADD CONSTRAINT "reclamation_evenement_tenant_id_reclamation_id_fkey" FOREIGN KEY ("tenant_id", "reclamation_id") REFERENCES "reclamation"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reclamation_evenement" ADD CONSTRAINT "reclamation_evenement_tenant_id_acteur_utilisateur_id_fkey" FOREIGN KEY ("tenant_id", "acteur_utilisateur_id") REFERENCES "utilisateur"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "banque"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_destinataire_utilisateur_id_fkey" FOREIGN KEY ("destinataire_utilisateur_id") REFERENCES "utilisateur"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_tenant_id_destinataire_client_id_fkey" FOREIGN KEY ("tenant_id", "destinataire_client_id") REFERENCES "client_final"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_tenant_id_reclamation_id_fkey" FOREIGN KEY ("tenant_id", "reclamation_id") REFERENCES "reclamation"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
