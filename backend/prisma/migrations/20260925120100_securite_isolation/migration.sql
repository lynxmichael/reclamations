-- =============================================================================
--  Étape 3 · Sécurité et intégrité de la base
--  Plateforme de gestion des réclamations — Makor Telecoms · Solution 1
--
--  1. Rôles d'accès et droits (par table et par colonne)
--  2. Row-Level Security : cloisonnement par banque (arbitrage 2)
--  3. Contraintes CHECK
--  4. Journal d'audit chaîné par SHA-256, en écriture seule (§6.8)
--  5. Tables immuables : messages, pièces jointes, historique
--
--  Cette migration s'exécute avec le propriétaire des tables (superutilisateur
--  du conteneur PostgreSQL). L'application ne s'y connecte jamais : elle utilise
--  le rôle de connexion « reclamations_app », qui n'a aucun droit propre.
-- =============================================================================


-- -----------------------------------------------------------------------------
--  1. Rôles d'accès
-- -----------------------------------------------------------------------------
--  acces_banque      personnel d'une banque : ne voit que les lignes de sa banque (RLS)
--  acces_plateforme  Super Admin : toutes les banques, mais jamais le contenu des
--                    réclamations ni les coordonnées des clients (arbitrage 7)
--  acces_systeme     workers, authentification, résolution d'un QR code : toutes
--                    les banques (BYPASSRLS), sans pouvoir modifier ce qui est immuable
--
--  Le rôle de connexion reclamations_app est NOINHERIT : sans « SET ROLE » explicite
--  il n'a aucun droit. Une requête lancée sans contexte échoue au lieu de fuiter.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'acces_banque') THEN
    CREATE ROLE acces_banque NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'acces_plateforme') THEN
    CREATE ROLE acces_plateforme NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'acces_systeme') THEN
    CREATE ROLE acces_systeme NOLOGIN BYPASSRLS;
  END IF;
  -- Le rôle de connexion (avec mot de passe) est créé hors migration :
  -- docker/postgres/init/02-roles.sh en développement, provisionnement en production.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'reclamations_app') THEN
    GRANT acces_banque, acces_plateforme, acces_systeme TO reclamations_app;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO acces_banque, acces_plateforme, acces_systeme;
GRANT USAGE ON SEQUENCE journal_audit_id_seq TO acces_banque, acces_plateforme, acces_systeme;

-- Tenant courant, posé par l'application au début de chaque transaction.
-- Absent ou vide → NULL → aucune ligne visible.
CREATE OR REPLACE FUNCTION app_tenant_courant() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
AS $$ SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $$;


-- ---- acces_banque ------------------------------------------------------------

GRANT SELECT ON plan TO acces_banque;

GRANT SELECT ON banque TO acces_banque;
-- L'Admin Entreprise ne règle que l'apparence et le contact ; le reste relève du Super Admin
GRANT UPDATE (couleur_primaire, couleur_secondaire, logo_cle, email_contact, modifie_le) ON banque TO acces_banque;

GRANT SELECT, INSERT, UPDATE ON agence, categorie TO acces_banque;
GRANT SELECT, INSERT, UPDATE, DELETE ON horaire_ouvre, jour_ferie TO acces_banque;

GRANT SELECT, INSERT ON point_depot TO acces_banque;
-- Le code d'un point de dépôt est imprimé sur le QR code : il ne change jamais
GRANT UPDATE (agence_id, libelle, actif, modifie_le) ON point_depot TO acces_banque;

-- Personnel : jamais le hash du mot de passe ni le secret TOTP (réservés à l'authentification)
GRANT SELECT (id, tenant_id, role, statut, email, nom, prenom, telephone, totp_active_le,
              superviseur_id, echecs_connexion, verrouille_jusqu_a, derniere_connexion_le,
              desactive_le, cree_le, modifie_le) ON utilisateur TO acces_banque;
GRANT INSERT (id, tenant_id, role, statut, email, nom, prenom, telephone, superviseur_id,
              echecs_connexion, cree_le, modifie_le) ON utilisateur TO acces_banque;
GRANT UPDATE (role, statut, email, nom, prenom, telephone, superviseur_id, desactive_le,
              modifie_le) ON utilisateur TO acces_banque;

GRANT SELECT, INSERT ON client_final TO acces_banque;
GRANT UPDATE (nom, email, telephone, modifie_le) ON client_final TO acces_banque;

GRANT SELECT, INSERT ON code_otp TO acces_banque;
GRANT UPDATE (tentatives, utilise_le) ON code_otp TO acces_banque;

GRANT SELECT, INSERT ON reclamation TO acces_banque;
-- Colonnes figées à la création : numéro, jeton de suivi, client, point de dépôt, canal,
-- description, consentement, délai cible (« un changement de barème ne touche pas les tickets en cours »)
GRANT UPDATE (categorie_id, agence_id, statut, priorite, agent_id,
              echeance_sla_le, alerte_preventive_le, sla_minutes_restantes, sla_suspendu_le,
              alerte_preventive_envoyee_le, depassement_sla_signale_le, sla_respecte,
              escaladee_le, escaladee_vers_id,
              pris_en_charge_le, premiere_reponse_le, delai_premiere_reponse_minutes,
              resolue_le, delai_resolution_minutes, passe_en_attente_client, nb_reouvertures,
              cloture_auto_prevue_le, cloture_le, mode_cloture, motif_cloture_forcee,
              commentaire_cloture, cloture_par_id, modifie_le) ON reclamation TO acces_banque;

GRANT SELECT, INSERT, UPDATE ON compteur_numero TO acces_banque;

-- Immuables : ni UPDATE ni DELETE
GRANT SELECT, INSERT ON commentaire, piece_jointe, reclamation_evenement TO acces_banque;

GRANT SELECT, INSERT ON notification TO acces_banque;
GRANT UPDATE (lue_le) ON notification TO acces_banque;

GRANT SELECT, INSERT ON journal_audit TO acces_banque;


-- ---- acces_plateforme (Super Admin) -------------------------------------------

GRANT SELECT, INSERT, UPDATE ON plan, banque TO acces_plateforme;
GRANT SELECT ON agence, categorie TO acces_plateforme;

GRANT SELECT (id, tenant_id, role, statut, email, nom, prenom, telephone, totp_active_le,
              superviseur_id, echecs_connexion, verrouille_jusqu_a, derniere_connexion_le,
              desactive_le, cree_le, modifie_le) ON utilisateur TO acces_plateforme;
GRANT INSERT (id, tenant_id, role, statut, email, nom, prenom, telephone, superviseur_id,
              echecs_connexion, cree_le, modifie_le) ON utilisateur TO acces_plateforme;
GRANT UPDATE (role, statut, email, nom, prenom, telephone, superviseur_id, desactive_le,
              modifie_le) ON utilisateur TO acces_plateforme;

-- Métadonnées seules (arbitrage 7) : ni description, ni client, ni jeton de suivi,
-- ni commentaire de clôture. Statistiques et alertes restent possibles.
GRANT SELECT (id, tenant_id, numero, categorie_id, agence_id, canal, statut, priorite,
              delai_cible_minutes, sla_respecte, escaladee_le, pris_en_charge_le,
              premiere_reponse_le, delai_premiere_reponse_minutes, resolue_le,
              delai_resolution_minutes, passe_en_attente_client, nb_reouvertures,
              cloture_le, mode_cloture, cree_le) ON reclamation TO acces_plateforme;

GRANT SELECT ON notification TO acces_plateforme;
GRANT UPDATE (lue_le) ON notification TO acces_plateforme;

GRANT SELECT, INSERT ON journal_audit TO acces_plateforme;

-- Aucun droit sur : client_final, code_otp, commentaire, piece_jointe,
-- reclamation_evenement, compteur_numero, point_depot, horaire_ouvre, jour_ferie,
-- session_utilisateur, jeton_utilisateur.


-- ---- acces_systeme (workers, authentification) --------------------------------

GRANT SELECT, INSERT, UPDATE ON plan, banque, agence, point_depot, categorie, horaire_ouvre,
  jour_ferie, client_final, compteur_numero, notification TO acces_systeme;
GRANT SELECT, INSERT, UPDATE, DELETE ON session_utilisateur, jeton_utilisateur, code_otp TO acces_systeme;
GRANT SELECT, INSERT, UPDATE ON utilisateur TO acces_systeme;
GRANT SELECT, INSERT ON reclamation TO acces_systeme;
GRANT UPDATE (categorie_id, agence_id, statut, priorite, agent_id,
              echeance_sla_le, alerte_preventive_le, sla_minutes_restantes, sla_suspendu_le,
              alerte_preventive_envoyee_le, depassement_sla_signale_le, sla_respecte,
              escaladee_le, escaladee_vers_id,
              pris_en_charge_le, premiere_reponse_le, delai_premiere_reponse_minutes,
              resolue_le, delai_resolution_minutes, passe_en_attente_client, nb_reouvertures,
              cloture_auto_prevue_le, cloture_le, mode_cloture, motif_cloture_forcee,
              commentaire_cloture, cloture_par_id, modifie_le) ON reclamation TO acces_systeme;
GRANT SELECT, INSERT ON commentaire, piece_jointe, reclamation_evenement, journal_audit TO acces_systeme;


-- -----------------------------------------------------------------------------
--  2. Row-Level Security
-- -----------------------------------------------------------------------------

ALTER TABLE banque                ENABLE ROW LEVEL SECURITY;
ALTER TABLE agence                ENABLE ROW LEVEL SECURITY;
ALTER TABLE point_depot           ENABLE ROW LEVEL SECURITY;
ALTER TABLE categorie             ENABLE ROW LEVEL SECURITY;
ALTER TABLE horaire_ouvre         ENABLE ROW LEVEL SECURITY;
ALTER TABLE jour_ferie            ENABLE ROW LEVEL SECURITY;
ALTER TABLE utilisateur           ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_final          ENABLE ROW LEVEL SECURITY;
ALTER TABLE code_otp              ENABLE ROW LEVEL SECURITY;
ALTER TABLE reclamation           ENABLE ROW LEVEL SECURITY;
ALTER TABLE compteur_numero       ENABLE ROW LEVEL SECURITY;
ALTER TABLE commentaire           ENABLE ROW LEVEL SECURITY;
ALTER TABLE piece_jointe          ENABLE ROW LEVEL SECURITY;
ALTER TABLE reclamation_evenement ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification          ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_audit         ENABLE ROW LEVEL SECURITY;

-- Personnel d'une banque : sa banque seulement, en lecture comme en écriture
CREATE POLICY banque_isolation ON banque FOR ALL TO acces_banque
  USING (id = app_tenant_courant()) WITH CHECK (id = app_tenant_courant());

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['agence', 'point_depot', 'categorie', 'horaire_ouvre', 'jour_ferie',
    'utilisateur', 'client_final', 'code_otp', 'reclamation', 'compteur_numero', 'commentaire',
    'piece_jointe', 'reclamation_evenement', 'notification', 'journal_audit']
  LOOP
    EXECUTE format(
      'CREATE POLICY banque_isolation ON %I FOR ALL TO acces_banque
         USING (tenant_id = app_tenant_courant()) WITH CHECK (tenant_id = app_tenant_courant())', t);
  END LOOP;
END $$;

-- Super Admin : toutes les banques sur les tables où il a des droits (les colonnes
-- autorisées sont limitées par les GRANT ci-dessus)
CREATE POLICY plateforme_toutes_banques ON banque      FOR ALL TO acces_plateforme USING (true) WITH CHECK (true);
CREATE POLICY plateforme_toutes_banques ON agence      FOR SELECT TO acces_plateforme USING (true);
CREATE POLICY plateforme_toutes_banques ON categorie   FOR SELECT TO acces_plateforme USING (true);
CREATE POLICY plateforme_toutes_banques ON utilisateur FOR ALL TO acces_plateforme USING (true) WITH CHECK (true);
CREATE POLICY plateforme_toutes_banques ON reclamation FOR SELECT TO acces_plateforme USING (true);
-- Ses notifications sont celles de la plateforme (sans banque)
CREATE POLICY plateforme_notifications ON notification FOR ALL TO acces_plateforme
  USING (tenant_id IS NULL) WITH CHECK (tenant_id IS NULL);
-- Il lit le journal de toutes les banques, mais n'écrit que dans la chaîne de la plateforme
CREATE POLICY plateforme_lecture ON journal_audit FOR SELECT TO acces_plateforme USING (true);
CREATE POLICY plateforme_ecriture ON journal_audit FOR INSERT TO acces_plateforme WITH CHECK (tenant_id IS NULL);

-- acces_systeme a BYPASSRLS : pas de politique.


-- -----------------------------------------------------------------------------
--  3. Contraintes CHECK
-- -----------------------------------------------------------------------------

-- Retenues par le CDC (§9)
ALTER TABLE utilisateur ADD CONSTRAINT utilisateur_banque_ssi_pas_super_admin
  CHECK ((role = 'SUPER_ADMIN') = (tenant_id IS NULL));
ALTER TABLE client_final ADD CONSTRAINT client_final_email_ou_telephone
  CHECK (email IS NOT NULL OR telephone IS NOT NULL);

-- Formats
ALTER TABLE banque ADD CONSTRAINT banque_prefixe_format CHECK (prefixe_tickets ~ '^[A-Z0-9]{2,10}$');
ALTER TABLE banque ADD CONSTRAINT banque_slug_format CHECK (slug ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$');
ALTER TABLE banque ADD CONSTRAINT banque_couleurs_format CHECK (
  (couleur_primaire IS NULL OR couleur_primaire ~ '^#[0-9A-Fa-f]{6}$') AND
  (couleur_secondaire IS NULL OR couleur_secondaire ~ '^#[0-9A-Fa-f]{6}$'));
ALTER TABLE utilisateur ADD CONSTRAINT utilisateur_email_minuscules CHECK (email = lower(email));
ALTER TABLE client_final ADD CONSTRAINT client_final_email_minuscules CHECK (email IS NULL OR email = lower(email));
ALTER TABLE client_final ADD CONSTRAINT client_final_telephone_e164 CHECK (telephone IS NULL OR telephone ~ '^\+[1-9][0-9]{7,14}$');
ALTER TABLE reclamation ADD CONSTRAINT reclamation_numero_format CHECK (numero ~ '^[A-Z0-9]{2,10}-[0-9]{4}-[0-9]{6}$');
ALTER TABLE journal_audit ADD CONSTRAINT journal_audit_empreintes_hex CHECK (
  empreinte ~ '^[0-9a-f]{64}$' AND empreinte_precedente ~ '^[0-9a-f]{64}$');

-- Bornes
ALTER TABLE banque ADD CONSTRAINT banque_seuil_alerte CHECK (seuil_alerte_sla_pourcent BETWEEN 1 AND 99);
ALTER TABLE banque ADD CONSTRAINT banque_delai_cloture CHECK (delai_cloture_auto_jours BETWEEN 1 AND 60);
ALTER TABLE plan ADD CONSTRAINT plan_plafonds_positifs CHECK (
  (plafond_agents IS NULL OR plafond_agents > 0) AND (plafond_tickets_mois IS NULL OR plafond_tickets_mois > 0));
ALTER TABLE categorie ADD CONSTRAINT categorie_delai_positif CHECK (delai_cible_minutes > 0);
ALTER TABLE reclamation ADD CONSTRAINT reclamation_delai_positif CHECK (delai_cible_minutes > 0);
ALTER TABLE horaire_ouvre ADD CONSTRAINT horaire_ouvre_bornes CHECK (
  jour_semaine BETWEEN 1 AND 7 AND debut_minute >= 0 AND debut_minute < fin_minute AND fin_minute <= 1440);
ALTER TABLE piece_jointe ADD CONSTRAINT piece_jointe_taille_positive CHECK (taille_octets > 0);
ALTER TABLE code_otp ADD CONSTRAINT code_otp_tentatives CHECK (tentatives >= 0);

-- Cohérences métier
ALTER TABLE point_depot ADD CONSTRAINT point_depot_qr_avec_agence
  CHECK (canal <> 'QR_CODE' OR agence_id IS NOT NULL);                    -- arbitrage 3
ALTER TABLE code_otp ADD CONSTRAINT code_otp_canal CHECK (canal IN ('EMAIL', 'SMS'));
ALTER TABLE commentaire ADD CONSTRAINT commentaire_auteur_selon_type
  CHECK ((type = 'MESSAGE_DU_CLIENT') = (auteur_utilisateur_id IS NULL));
ALTER TABLE commentaire ADD CONSTRAINT commentaire_non_vide CHECK (length(btrim(contenu)) > 0);
ALTER TABLE piece_jointe ADD CONSTRAINT piece_jointe_deposant
  CHECK ((depose_par_type = 'UTILISATEUR') = (depose_par_utilisateur_id IS NOT NULL) AND depose_par_type <> 'SYSTEME');
ALTER TABLE reclamation_evenement ADD CONSTRAINT evenement_acteur
  CHECK ((acteur_type = 'UTILISATEUR') = (acteur_utilisateur_id IS NOT NULL));
ALTER TABLE reclamation ADD CONSTRAINT reclamation_cloture_coherente CHECK (
  (statut = 'CLOTUREE') = (cloture_le IS NOT NULL) AND (statut = 'CLOTUREE') = (mode_cloture IS NOT NULL));
ALTER TABLE reclamation ADD CONSTRAINT reclamation_cloture_forcee_motivee CHECK (
  mode_cloture IS DISTINCT FROM 'FORCEE'
  OR (motif_cloture_forcee IS NOT NULL AND length(btrim(coalesce(commentaire_cloture, ''))) > 0
      AND cloture_par_id IS NOT NULL));                                     -- §6.3
ALTER TABLE reclamation ADD CONSTRAINT reclamation_motif_si_forcee
  CHECK (motif_cloture_forcee IS NULL OR mode_cloture = 'FORCEE');
ALTER TABLE reclamation ADD CONSTRAINT reclamation_cloture_auto_si_resolue
  CHECK (cloture_auto_prevue_le IS NULL OR statut = 'RESOLUE');
ALTER TABLE notification ADD CONSTRAINT notification_plateforme_metadonnees
  CHECK (tenant_id IS NOT NULL OR (reclamation_id IS NULL AND destinataire_client_id IS NULL)); -- arbitrage 7
ALTER TABLE notification ADD CONSTRAINT notification_segments_sms
  CHECK (segments_sms IS NULL OR (canal = 'SMS' AND segments_sms > 0));


-- -----------------------------------------------------------------------------
--  4. Journal d'audit chaîné (§6.8)
-- -----------------------------------------------------------------------------
--  Une chaîne par banque (« banque:<uuid> ») et une pour la plateforme.
--  empreinte = SHA-256(empreinte_precedente || contenu canonique de la ligne).
--  Le trigger impose chaîne, rang, horodatage et empreintes : l'application ne
--  peut ni les choisir ni les falsifier.

CREATE OR REPLACE FUNCTION journal_audit_contenu_canonique(j journal_audit) RETURNS text
  LANGUAGE sql STABLE
AS $$
  SELECT jsonb_build_array(
    j.chaine, j.rang, j.tenant_id,
    to_char(j.horodatage AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    j.acteur_type, j.acteur_id, j.acteur_libelle, j.acteur_role,
    j.action, j.entite, j.entite_id, j.donnees, j.ip, j.user_agent
  )::text
$$;

CREATE OR REPLACE FUNCTION journal_audit_empreinte(precedente text, j journal_audit) RETURNS text
  LANGUAGE sql STABLE
AS $$ SELECT encode(sha256(convert_to(precedente || journal_audit_contenu_canonique(j), 'UTF8')), 'hex') $$;

CREATE OR REPLACE FUNCTION journal_audit_chainer() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  precedent record;
BEGIN
  NEW.chaine := CASE WHEN NEW.tenant_id IS NULL THEN 'plateforme' ELSE 'banque:' || NEW.tenant_id::text END;
  -- Une écriture à la fois par chaîne ; le verrou tombe à la fin de la transaction
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.chaine, 0));
  SELECT rang, empreinte INTO precedent
    FROM journal_audit WHERE chaine = NEW.chaine ORDER BY rang DESC LIMIT 1;
  NEW.rang := coalesce(precedent.rang, 0) + 1;
  NEW.empreinte_precedente := coalesce(precedent.empreinte, repeat('0', 64));
  NEW.horodatage := clock_timestamp();
  NEW.empreinte := journal_audit_empreinte(NEW.empreinte_precedente, NEW);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION journal_audit_chainer() FROM PUBLIC;

CREATE TRIGGER journal_audit_chainage BEFORE INSERT ON journal_audit
  FOR EACH ROW EXECUTE FUNCTION journal_audit_chainer();

-- Vérification : recalcule toute la chaîne et renvoie la première ligne rompue.
-- Exécutée avec les droits de l'appelant : un Admin Entreprise ne vérifie que sa banque.
CREATE OR REPLACE FUNCTION verifier_chaine_audit(p_chaine text)
  RETURNS TABLE (valide boolean, lignes bigint, premiere_rupture bigint)
  LANGUAGE plpgsql STABLE
AS $$
DECLARE
  ligne journal_audit;
  precedente text := repeat('0', 64);
  rang_attendu bigint := 1;
  n bigint := 0;
BEGIN
  FOR ligne IN SELECT * FROM journal_audit WHERE chaine = p_chaine ORDER BY rang LOOP
    n := n + 1;
    IF ligne.rang <> rang_attendu
       OR ligne.empreinte_precedente <> precedente
       OR ligne.empreinte <> journal_audit_empreinte(ligne.empreinte_precedente, ligne) THEN
      RETURN QUERY SELECT false, n, rang_attendu;
      RETURN;
    END IF;
    precedente := ligne.empreinte;
    rang_attendu := rang_attendu + 1;
  END LOOP;
  RETURN QUERY SELECT true, n, NULL::bigint;
END $$;


-- -----------------------------------------------------------------------------
--  5. Écriture seule : journal d'audit, messages, pièces jointes, historique
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION interdire_modification() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'La table % est en écriture seule : % interdit', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END $$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['journal_audit', 'commentaire', 'piece_jointe', 'reclamation_evenement']
  LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I
                      FOR EACH ROW EXECUTE FUNCTION interdire_modification()', t || '_ecriture_seule', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON %I
                      FOR EACH STATEMENT EXECUTE FUNCTION interdire_modification()', t || '_sans_truncate', t);
  END LOOP;
END $$;
