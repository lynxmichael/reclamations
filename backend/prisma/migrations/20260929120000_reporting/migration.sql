-- =============================================================================
--  Étape 9 — Reporting : facturation des SMS par banque
--
--  Le rôle de la plateforme (acces_plateforme) ne lit que les notifications de la plateforme
--  (politique plateforme_notifications de l'étape 3) : il ne voit ni les numéros ni les textes
--  envoyés aux clients des banques. Pour refacturer les SMS, il appelle cette fonction, qui ne
--  rend que des totaux par banque.
--
--  - sms, segments : SMS remis à la passerelle pendant la période (envoyee_le) ;
--  - echecs        : SMS créés pendant la période et abandonnés après 5 tentatives.
-- =============================================================================

CREATE OR REPLACE FUNCTION facturation_sms(p_debut timestamptz, p_fin timestamptz)
  RETURNS TABLE (tenant_id uuid, sms bigint, segments bigint, echecs bigint)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT n.tenant_id,
         count(*) FILTER (WHERE n.statut IN ('ENVOYEE', 'DELIVREE') AND n.envoyee_le >= p_debut AND n.envoyee_le < p_fin),
         coalesce(sum(n.segments_sms) FILTER (WHERE n.statut IN ('ENVOYEE', 'DELIVREE') AND n.envoyee_le >= p_debut AND n.envoyee_le < p_fin), 0)::bigint,
         count(*) FILTER (WHERE n.statut = 'ECHEC' AND n.cree_le >= p_debut AND n.cree_le < p_fin)
    FROM notification n
   WHERE n.canal = 'SMS'
     AND n.tenant_id IS NOT NULL
     AND ((n.envoyee_le >= p_debut AND n.envoyee_le < p_fin) OR (n.cree_le >= p_debut AND n.cree_le < p_fin))
   GROUP BY n.tenant_id
$$;

REVOKE ALL ON FUNCTION facturation_sms(timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION facturation_sms(timestamptz, timestamptz) TO acces_plateforme;
