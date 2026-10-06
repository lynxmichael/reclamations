/**
 * Attribution et escalade automatiques (étape 16) : règles et groupes d'agents (Admin Entreprise,
 * superviseur en lecture), absences (superviseur et Admin Entreprise). Pages offertes quand Makor a
 * ouvert la fonction à la banque ; sinon l'API répond FONCTION_NON_OUVERTE.
 */
import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Absences } from '../../ecrans/back-office/Absences';
import { Attribution } from '../../ecrans/back-office/Attribution';
import type { S } from '../../api/types';
import { useEcriture } from '../commun/ecriture';
import { Chargement, ErreurChargement } from '../commun/Etats';
import { ROUTES_BANQUE, nomDe, useConsole, useParametres } from './contexte';

const MESSAGE_MODE: Record<S<'ModeAttribution'>, string> = {
  MANUELLE: 'Attribution manuelle : le superviseur assigne chaque réclamation.',
  SUGGESTION: 'Mode suggestion : le superviseur voit l\'agent proposé et valide en un clic.',
  AUTOMATIQUE: 'Attribution automatique : chaque nouvelle réclamation part à l\'agent disponible le moins chargé.',
};

function useTitre(titre: string) {
  useEffect(() => {
    document.title = `${titre} — Réclamations`;
  }, [titre]);
}

/** Aujourd'hui (AAAA-MM-JJ) dans le fuseau de la banque. */
function aujourdhui(fuseau: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: fuseau, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

/** Agents de la banque dont le compte n'est pas désactivé : membres des groupes, absences. */
function useAgentsDeLaBanque() {
  const { appeler } = useConsole();
  return useQuery({
    queryKey: ['agents-banque'],
    queryFn: () => appeler('listerUtilisateurs', { requete: { role: 'AGENT', parPage: 100 } }),
    staleTime: 60_000,
    select: (p) => p.donnees
      .filter((u) => u.statut !== 'DESACTIVE')
      .map((u) => ({ id: u.id, nom: nomDe(u), statut: u.statut }))
      .sort((a, b) => a.nom.localeCompare(b.nom, 'fr')),
  });
}

export function PageAttribution() {
  const { appeler, moi } = useConsole();
  useTitre('Attribution et escalade');
  const admin = moi.role === 'ADMIN_ENTREPRISE';
  const regles = useQuery({ queryKey: ['regles'], queryFn: () => appeler('lireReglesTraitement') });
  const groupes = useQuery({ queryKey: ['groupes'], queryFn: () => appeler('listerGroupes') });
  const agents = useAgentsDeLaBanque();
  // Le mode change les suggestions des files ; les paramètres de la banque le portent aussi
  const { ecrire, occupe, erreurs } = useEcriture([['regles'], ['groupes'], ['parametres'], ['reclamations'], ['reclamation']]);
  if (regles.isPending || groupes.isPending) return <Chargement />;
  if (regles.isError || groupes.isError) {
    return <ErreurChargement erreur={regles.error ?? groupes.error} surReessayer={() => void Promise.all([regles.refetch(), groupes.refetch()])} />;
  }
  return (
    <Attribution
      regles={regles.data}
      groupes={groupes.data}
      agents={agents.data ?? []}
      modifiable={admin}
      actions={admin ? {
        occupe,
        erreurs,
        changerMode: (mode) => ecrire(() => appeler('modifierReglesTraitement', { corps: { mode } }), MESSAGE_MODE[mode]),
        enregistrerRegles: (m) => ecrire(() => appeler('modifierReglesTraitement', { corps: m }), 'Règles enregistrées : elles s\'appliquent aux nouvelles réclamations.'),
        creerGroupe: (v) => ecrire(() => appeler('creerGroupe', { corps: v }), `Groupe « ${v.nom} » créé : confiez-lui des catégories ou des agences.`),
        modifierGroupe: (id, v) => ecrire(() => appeler('modifierGroupe', { chemin: { id }, corps: v }), 'Groupe enregistré.'),
        supprimerGroupe: (g) => ecrire(() => appeler('supprimerGroupe', { chemin: { id: g.id } }), `Groupe « ${g.nom} » supprimé.`),
      } : undefined}
    />
  );
}

export function PageAbsences() {
  const { appeler } = useConsole();
  const parametres = useParametres();
  const navigate = useNavigate();
  useTitre('Absences');
  const absences = useQuery({ queryKey: ['absences'], queryFn: () => appeler('listerAbsences') });
  const agents = useAgentsDeLaBanque();
  const { ecrire, occupe, erreurs } = useEcriture([['absences'], ['groupes'], ['reclamations'], ['reclamation']]);
  if (absences.isPending) return <Chargement />;
  if (absences.isError) return <ErreurChargement erreur={absences.error} surReessayer={() => void absences.refetch()} />;
  const nom = (id: string) => agents.data?.find((a) => a.id === id)?.nom ?? 'l\'agent';
  return (
    <Absences
      absences={absences.data}
      agents={(agents.data ?? []).map((a) => ({ id: a.id, nom: a.nom }))}
      aujourdhui={aujourdhui(parametres.fuseauHoraire)}
      surAReassigner={(agentId) => navigate(`${ROUTES_BANQUE.reclamations}?file=a-reassigner&agentId=${agentId}`)}
      actions={{
        occupe,
        erreurs,
        ajouter: (v) => ecrire(() => appeler('ajouterAbsence', { corps: v }), `Absence de ${nom(v.agentId)} déclarée : il ne recevra pas de réclamation ces jours-là.`),
        supprimer: (a) => ecrire(() => appeler('supprimerAbsence', { chemin: { id: a.id } }), `Absence de ${a.agent.nom} retirée.`),
      }}
    />
  );
}
