-- =============================================================================
--  Étape 4 · Cycle de vie et SLA
--  Plateforme de gestion des réclamations — Makor Telecoms · Solution 1
--
--  1. Transitions de statut autorisées, vérifiées par la base (§6.3)
--  2. Cohérence des champs SLA et des jalons selon le statut (arbitrage 4, §6.4)
--
--  Le service du cycle de vie (src/application/reclamations) applique déjà ces règles ;
--  la base les garantit même en cas de bug ou d'écriture SQL directe.
-- =============================================================================


-- -----------------------------------------------------------------------------
--  1. Transitions autorisées
-- -----------------------------------------------------------------------------
--   OUVERTE → EN_COURS                  prise en charge
--   EN_COURS → EN_ATTENTE_CLIENT        question au client
--   EN_ATTENTE_CLIENT → EN_COURS        réponse du client
--   EN_COURS → RESOLUE                  résolution
--   RESOLUE → CLOTUREE                  confirmation ou clôture automatique
--   RESOLUE → EN_COURS                  contestation
--   OUVERTE | EN_COURS | EN_ATTENTE_CLIENT → CLOTUREE   clôture forcée
--   CLOTUREE : état final

CREATE OR REPLACE FUNCTION reclamation_transition_autorisee(avant statut_reclamation, apres statut_reclamation)
  RETURNS boolean LANGUAGE sql IMMUTABLE
AS $$
  SELECT avant = apres OR (avant, apres) IN (
    ('OUVERTE'::statut_reclamation, 'EN_COURS'::statut_reclamation),
    ('EN_COURS', 'EN_ATTENTE_CLIENT'),
    ('EN_ATTENTE_CLIENT', 'EN_COURS'),
    ('EN_COURS', 'RESOLUE'),
    ('RESOLUE', 'CLOTUREE'),
    ('RESOLUE', 'EN_COURS'),
    ('OUVERTE', 'CLOTUREE'),
    ('EN_COURS', 'CLOTUREE'),
    ('EN_ATTENTE_CLIENT', 'CLOTUREE'))
$$;

CREATE OR REPLACE FUNCTION reclamation_verifier_transition() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.statut = 'CLOTUREE' THEN
    RAISE EXCEPTION 'Réclamation % clôturée : plus aucune modification', OLD.numero
      USING ERRCODE = 'check_violation';
  END IF;
  IF NOT reclamation_transition_autorisee(OLD.statut, NEW.statut) THEN
    RAISE EXCEPTION 'Transition interdite pour %: % → %', OLD.numero, OLD.statut, NEW.statut
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER reclamation_transition BEFORE UPDATE ON reclamation
  FOR EACH ROW EXECUTE FUNCTION reclamation_verifier_transition();

-- Un dépôt naît toujours « Ouverte » (les jeux de test du propriétaire peuvent contourner
-- ce trigger ; les rôles de l'application, non)
CREATE OR REPLACE FUNCTION reclamation_naissance_ouverte() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.statut <> 'OUVERTE' AND current_user IN ('acces_banque', 'acces_plateforme', 'acces_systeme') THEN
    RAISE EXCEPTION 'Une réclamation est créée au statut OUVERTE (reçu : %)', NEW.statut
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER reclamation_naissance BEFORE INSERT ON reclamation
  FOR EACH ROW EXECUTE FUNCTION reclamation_naissance_ouverte();


-- -----------------------------------------------------------------------------
--  2. Cohérence SLA et jalons selon le statut
-- -----------------------------------------------------------------------------

-- Chrono en marche : échéance et alerte connues, pas de pause
ALTER TABLE reclamation ADD CONSTRAINT reclamation_sla_actif CHECK (
  statut NOT IN ('OUVERTE', 'EN_COURS')
  OR (echeance_sla_le IS NOT NULL AND alerte_preventive_le IS NOT NULL
      AND sla_suspendu_le IS NULL AND sla_minutes_restantes IS NULL));

-- « En attente client » : chrono suspendu, temps restant figé
ALTER TABLE reclamation ADD CONSTRAINT reclamation_sla_en_pause CHECK (
  statut <> 'EN_ATTENTE_CLIENT'
  OR (echeance_sla_le IS NULL AND alerte_preventive_le IS NULL
      AND sla_suspendu_le IS NOT NULL AND sla_minutes_restantes IS NOT NULL
      AND passe_en_attente_client));

-- Résolue ou clôturée : plus d'échéance à surveiller
ALTER TABLE reclamation ADD CONSTRAINT reclamation_sla_arrete CHECK (
  statut NOT IN ('RESOLUE', 'CLOTUREE')
  OR (echeance_sla_le IS NULL AND alerte_preventive_le IS NULL AND sla_suspendu_le IS NULL));

-- Résolue : date de résolution, verdict SLA et date de clôture automatique connus
ALTER TABLE reclamation ADD CONSTRAINT reclamation_resolue_complete CHECK (
  statut <> 'RESOLUE'
  OR (resolue_le IS NOT NULL AND sla_respecte IS NOT NULL AND cloture_auto_prevue_le IS NOT NULL));

-- Prise en charge : jamais en « Ouverte », toujours avec un agent ensuite
ALTER TABLE reclamation ADD CONSTRAINT reclamation_prise_en_charge CHECK (
  (statut <> 'OUVERTE' OR pris_en_charge_le IS NULL)
  AND (statut NOT IN ('EN_COURS', 'EN_ATTENTE_CLIENT', 'RESOLUE')
       OR (pris_en_charge_le IS NOT NULL AND agent_id IS NOT NULL)));

-- Compteurs et durées positifs
ALTER TABLE reclamation ADD CONSTRAINT reclamation_compteurs_positifs CHECK (
  nb_reouvertures >= 0
  AND (sla_minutes_restantes IS NULL OR sla_minutes_restantes >= 0)
  AND (delai_premiere_reponse_minutes IS NULL OR delai_premiere_reponse_minutes >= 0)
  AND (delai_resolution_minutes IS NULL OR delai_resolution_minutes >= 0));

-- Jalons dans l'ordre
ALTER TABLE reclamation ADD CONSTRAINT reclamation_jalons_ordonnes CHECK (
  (pris_en_charge_le IS NULL OR pris_en_charge_le >= cree_le)
  AND (premiere_reponse_le IS NULL OR premiere_reponse_le >= cree_le)
  AND (resolue_le IS NULL OR resolue_le >= cree_le)
  AND (cloture_le IS NULL OR cloture_le >= cree_le));
