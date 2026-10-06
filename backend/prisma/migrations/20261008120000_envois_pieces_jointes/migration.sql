-- Étape 22 : état des envois au client, accusés de remise des SMS, tentatives espacées ;
-- pièces jointes analysées par l'antivirus (ClamAV).

-- ---- Envois -------------------------------------------------------------------------------------

ALTER TABLE notification
  -- Échec temporaire : heure de la tentative suivante (1, 5, 30 puis 120 minutes)
  ADD COLUMN prochaine_tentative_le TIMESTAMPTZ(3),
  -- Accusé de remise : SMS (passerelle) ou WhatsApp (Meta)
  ADD COLUMN remise_le TIMESTAMPTZ(3),
  -- Non remis : pourquoi, en code (le message technique reste dans derniere_erreur)
  ADD COLUMN motif_echec VARCHAR(40);

ALTER TABLE notification ADD CONSTRAINT notification_motif_echec CHECK (
  motif_echec IS NULL OR motif_echec IN
    ('NUMERO_INVALIDE', 'INJOIGNABLE', 'EXPIRE', 'REFUSE', 'ADRESSE_INVALIDE', 'WHATSAPP_INDISPONIBLE', 'ERREUR_TECHNIQUE'));

-- Relances du worker : les notifications à retenter, par heure
CREATE INDEX notification_relances ON notification (prochaine_tentative_le) WHERE statut = 'EN_ATTENTE' AND tentatives > 0;

-- ---- Pièces jointes -----------------------------------------------------------------------------

CREATE TYPE etat_antivirus AS ENUM ('EN_ATTENTE', 'SAIN', 'INFECTE');

-- Les fichiers déjà reçus sont analysés par le worker dans les minutes qui suivent la mise à jour
ALTER TABLE piece_jointe
  ADD COLUMN antivirus etat_antivirus NOT NULL DEFAULT 'EN_ATTENTE',
  ADD COLUMN analysee_le TIMESTAMPTZ(3),
  ADD COLUMN virus VARCHAR(120);

-- Un fichier infecté est effacé du stockage : il garde le nom du virus, et lui seul l'a
ALTER TABLE piece_jointe ADD CONSTRAINT piece_jointe_virus CHECK ((antivirus = 'INFECTE') = (virus IS NOT NULL));

CREATE INDEX piece_jointe_a_analyser ON piece_jointe (cree_le) WHERE antivirus = 'EN_ATTENTE';

-- La pièce jointe reste immuable pour la banque ; seul le système note le résultat de l'analyse
GRANT UPDATE (antivirus, analysee_le, virus) ON piece_jointe TO acces_systeme;

-- Écriture seule (§6.8), sauf ce résultat : une fois, d'« en attente » à « saine » ou « infectée »,
-- sans rien changer d'autre à la ligne. Ni suppression, ni retour en arrière.
CREATE FUNCTION piece_jointe_analyse_seule() RETURNS trigger
  LANGUAGE plpgsql
AS $$
DECLARE
  resultat CONSTANT text[] := ARRAY['antivirus', 'analysee_le', 'virus'];
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.antivirus = 'EN_ATTENTE' AND NEW.antivirus <> 'EN_ATTENTE'
     AND to_jsonb(NEW) - resultat = to_jsonb(OLD) - resultat THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'La table % est en écriture seule : % interdit', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END $$;

DROP TRIGGER piece_jointe_ecriture_seule ON piece_jointe;
CREATE TRIGGER piece_jointe_ecriture_seule BEFORE UPDATE OR DELETE ON piece_jointe
  FOR EACH ROW EXECUTE FUNCTION piece_jointe_analyse_seule();

-- ---- Facturation SMS : les SMS remis ----------------------------------------------------------
-- Un SMS accepté par la passerelle est facturé même si l'opérateur ne le remet pas : il est compté
-- dès qu'il est parti (envoyee_le), quel que soit l'accusé de remise.

DROP FUNCTION facturation_sms(timestamptz, timestamptz);

CREATE FUNCTION facturation_sms(p_debut timestamptz, p_fin timestamptz)
  RETURNS TABLE (tenant_id uuid, sms bigint, segments bigint, remis bigint, echecs bigint)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT n.tenant_id,
         count(*) FILTER (WHERE n.envoyee_le >= p_debut AND n.envoyee_le < p_fin),
         coalesce(sum(n.segments_sms) FILTER (WHERE n.envoyee_le >= p_debut AND n.envoyee_le < p_fin), 0)::bigint,
         count(*) FILTER (WHERE n.statut = 'DELIVREE' AND n.envoyee_le >= p_debut AND n.envoyee_le < p_fin),
         count(*) FILTER (WHERE n.statut = 'ECHEC' AND n.cree_le >= p_debut AND n.cree_le < p_fin)
    FROM notification n
   WHERE n.canal = 'SMS'
     AND n.tenant_id IS NOT NULL
     AND ((n.envoyee_le >= p_debut AND n.envoyee_le < p_fin) OR (n.cree_le >= p_debut AND n.cree_le < p_fin))
   GROUP BY n.tenant_id
$$;

REVOKE ALL ON FUNCTION facturation_sms(timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION facturation_sms(timestamptz, timestamptz) TO acces_plateforme;
