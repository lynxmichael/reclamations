/**
 * Réclamations dans le back-office : files de traitement (listerReclamations) et fiche avec ses
 * actions (lireReclamation et les opérations du cycle de vie). Les critères de la file sont dans
 * l'adresse : un lien copié rouvre la même vue.
 */
import { useEffect, useMemo } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ErreurApi, enregistrer, messageErreur } from '../../api/client';
import type { S } from '../../api/types';
import { Files, type CriteresFiles, type File as FileTraitement, type Periode, type TriFiles } from '../../ecrans/back-office/Files';
import { Ticket, type ActionsFiche } from '../../ecrans/back-office/Ticket';
import { TelechargerPiece } from '../../ui/contextes';
import { useAnnoncer } from '../commun/Annonces';
import { Chargement, ErreurChargement } from '../commun/Etats';
import { INTERVALLE_MS } from './Cadre';
import { nomDe, useConsole, useParametres } from './contexte';
import { useExport } from './Reporting';

const FILES: FileTraitement[] = ['recues', 'assignees', 'urgentes', 'en-retard', 'escaladees', 'toutes'];
const TRIS: TriFiles[] = ['echeanceSlaLe', '-creeLe', 'creeLe', '-priorite', '-echeanceSlaLe'];

function useTitre(titre: string) {
  useEffect(() => {
    document.title = `${titre} — Réclamations`;
  }, [titre]);
}

function debutPeriode(p: Periode | undefined): string | undefined {
  if (!p) return undefined;
  const d = new Date();
  if (p === 'mois') return new Date(d.getFullYear(), d.getMonth(), 1).toISOString();
  return new Date(d.getTime() - (p === '7j' ? 7 : 30) * 86_400_000).toISOString();
}

function lireCriteres(params: URLSearchParams, role: S<'RoleUtilisateur'>): CriteresFiles {
  const val = <T extends string>(cle: string, permis?: readonly T[]) => {
    const v = params.get(cle) ?? undefined;
    return v && (!permis || permis.includes(v as T)) ? (v as T) : undefined;
  };
  const defaut: FileTraitement = role === 'AGENT' ? 'assignees' : role === 'SUPERVISEUR' ? 'recues' : 'toutes';
  return {
    file: val('file', FILES) ?? defaut,
    statut: val('statut', ['OUVERTE', 'EN_COURS', 'EN_ATTENTE_CLIENT', 'RESOLUE', 'CLOTUREE'] as const),
    categorieId: val('categorieId'),
    agenceId: val('agenceId'),
    canal: val('canal', ['QR_CODE', 'LIEN_WEB'] as const),
    agentId: val('agentId'),
    periode: val('periode', ['7j', '30j', 'mois'] as const),
    recherche: val('recherche'),
    tri: val('tri', TRIS) ?? 'echeanceSlaLe',
    page: Math.max(1, Number(params.get('page')) || 1),
  };
}

function ecrireCriteres(c: CriteresFiles): URLSearchParams {
  const p = new URLSearchParams();
  for (const [cle, v] of Object.entries(c)) {
    if (v === undefined || v === '' || (cle === 'page' && v === 1) || (cle === 'tri' && v === 'echeanceSlaLe')) continue;
    p.set(cle, String(v));
  }
  return p;
}

/** Agents actifs de la banque : filtres de la file et assignation. */
function useAgents(actif: boolean) {
  const { appeler } = useConsole();
  return useQuery({
    queryKey: ['agents'],
    queryFn: () => appeler('listerUtilisateurs', { requete: { role: 'AGENT', statut: 'ACTIF', parPage: 100 } }),
    enabled: actif,
    staleTime: 60_000,
    select: (p) => p.donnees.map((u): S<'ReferenceNommee'> => ({ id: u.id, nom: nomDe(u) })),
  });
}

export function PageFiles() {
  const { appeler, moi } = useConsole();
  const parametres = useParametres();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const criteres = useMemo(() => lireCriteres(params, moi.role), [params, moi.role]);
  useTitre('Réclamations');

  const page = useQuery({
    queryKey: ['reclamations', criteres],
    queryFn: () =>
      appeler('listerReclamations', {
        requete: {
          file: criteres.file,
          statut: criteres.statut ? [criteres.statut] : undefined,
          categorieId: criteres.categorieId,
          agenceId: criteres.agenceId,
          canal: criteres.canal,
          agentId: criteres.agentId,
          du: debutPeriode(criteres.periode),
          recherche: criteres.recherche,
          tri: criteres.tri,
          page: criteres.page,
          parPage: 25,
        },
      }),
    placeholderData: keepPreviousData,
    refetchInterval: INTERVALLE_MS,
  });
  const categories = useQuery({ queryKey: ['categories'], queryFn: () => appeler('listerCategories'), staleTime: 60_000 });
  const agences = useQuery({ queryKey: ['agences'], queryFn: () => appeler('listerAgences'), staleTime: 60_000 });
  const agents = useAgents(moi.role !== 'AGENT');
  const { exporter, enCours } = useExport();

  if (page.isPending) return <Chargement />;
  if (page.isError) return <ErreurChargement erreur={page.error} surReessayer={() => void page.refetch()} />;
  return (
    <Files
      page={page.data}
      moi={moi}
      maintenant={new Date().toISOString()}
      seuil={parametres.seuilAlerteSlaPourcent}
      criteres={criteres}
      surCriteres={(c) => setParams(ecrireCriteres(c))}
      chargement={page.isFetching && page.isPlaceholderData}
      // Étape 9 : les réclamations de la file et des filtres affichés, toutes pages confondues
      surExporter={moi.role === 'AGENT' ? undefined : () => void exporter(() => appeler('exporterReclamations', {
        requete: {
          file: criteres.file,
          statut: criteres.statut ? [criteres.statut] : undefined,
          categorieId: criteres.categorieId,
          agenceId: criteres.agenceId,
          canal: criteres.canal,
          agentId: criteres.agentId,
          du: debutPeriode(criteres.periode),
          recherche: criteres.recherche,
        },
      }))}
      exportEnCours={enCours}
      references={{
        categories: (categories.data ?? []).map((c) => ({ id: c.id, nom: c.nom })),
        agences: (agences.data ?? []).filter((a) => a.active).map((a) => ({ id: a.id, nom: a.nom })),
        agents: agents.data ?? [],
      }}
      surOuvrir={(id) => navigate(`/reclamations/${id}`, { state: { depuis: `/reclamations?${params.toString()}` } })}
    />
  );
}

export function PageFiche() {
  const { id = '' } = useParams();
  const { appeler } = useConsole();
  const parametres = useParametres();
  const navigate = useNavigate();
  const cache = useQueryClient();
  const annoncer = useAnnoncer();
  const cle = ['reclamation', id];
  const r = useQuery({ queryKey: cle, queryFn: () => appeler('lireReclamation', { chemin: { id } }), refetchInterval: INTERVALLE_MS });
  const assignable = !!r.data?.operationsPossibles.includes('ASSIGNER');
  const agents = useAgents(assignable);
  useTitre(r.data?.numero ?? 'Réclamation');

  const action = useMutation({
    mutationFn: ({ faire }: { faire: () => Promise<S<'ReclamationDetail'>>; succes: string }) => faire(),
    onSuccess: (maj, { succes }) => {
      cache.setQueryData(cle, maj);
      void cache.invalidateQueries({ queryKey: ['reclamations'] });
      void cache.invalidateQueries({ queryKey: ['compteurs'] });
      annoncer(succes);
    },
    onError: (e) => {
      annoncer(messageErreur(e), 'erreur');
      // Refus dû à l'état (quelqu'un d'autre a agi entre-temps) : la fiche est relue
      if (e instanceof ErreurApi && [409, 422].includes(e.statut)) void r.refetch();
    },
  });
  const executer = (faire: () => Promise<S<'ReclamationDetail'>>, succes: string) =>
    action
      .mutateAsync({ faire, succes })
      .then(() => true)
      .catch(() => false);

  if (r.isPending) return <Chargement />;
  if (r.isError) {
    if (r.error instanceof ErreurApi && r.error.statut === 404) {
      return <ErreurChargement erreur={r.error} surReessayer={() => navigate('/reclamations')} />;
    }
    return <ErreurChargement erreur={r.error} surReessayer={() => void r.refetch()} />;
  }
  const f = r.data;
  const nomAgent = (agentId: string) => agents.data?.find((a) => a.id === agentId)?.nom ?? 'l\'agent';
  const actions: ActionsFiche = {
    occupe: action.isPending,
    retour: () => navigate(-1),
    prendreEnCharge: () => void executer(() => appeler('prendreEnCharge', { chemin: { id } }), 'Réclamation prise en charge : le client est prévenu.'),
    assigner: (agentId) => void executer(() => appeler('assignerReclamation', { chemin: { id }, corps: { agentId } }), `Réclamation assignée à ${nomAgent(agentId)}.`),
    repondre: (contenu, attendreReponse, fichiers) =>
      executer(
        () => appeler('repondreAuClient', { chemin: { id }, corps: { contenu, attendreReponse, fichiers } }),
        attendreReponse ? 'Question envoyée : le chrono SLA est en pause jusqu\'à la réponse du client.' : 'Réponse envoyée au client.',
      ),
    note: (contenu, fichiers) => executer(() => appeler('ajouterNoteInterne', { chemin: { id }, corps: { contenu, fichiers } }), 'Note interne ajoutée, invisible du client.'),
    resoudre: (reponseFinale) => executer(() => appeler('resoudreReclamation', { chemin: { id }, corps: { reponseFinale } }), 'Réclamation résolue : le client peut confirmer ou contester.'),
    priorite: () =>
      void executer(
        () => appeler('changerPriorite', { chemin: { id }, corps: { priorite: f.priorite === 'URGENTE' ? 'NORMALE' : 'URGENTE' } }),
        f.priorite === 'URGENTE' ? 'Réclamation repassée en priorité normale.' : 'Réclamation passée en urgent : l\'équipe est alertée.',
      ),
    escalader: () => void executer(() => appeler('escaladerReclamation', { chemin: { id }, corps: {} }), 'Réclamation escaladée au superviseur.'),
    cloturer: (motif, precision) => executer(() => appeler('cloturerDeForce', { chemin: { id }, corps: { motif, precision } }), 'Réclamation clôturée de force, motif inscrit au journal.'),
  };
  const telecharger = (piece: S<'PieceJointe'>) =>
    void appeler('telechargerPieceJointe', { chemin: { id, pieceId: piece.id } })
      .then((fichier) => enregistrer(fichier, piece.nomFichier))
      .catch((e: unknown) => annoncer(messageErreur(e), 'erreur'));

  return (
    <TelechargerPiece.Provider value={telecharger}>
      <Ticket
        key={f.id}
        r={f}
        agents={agents.data ?? (f.agent ? [f.agent] : [])}
        delaiClotureJours={parametres.delaiClotureAutoJours}
        seuil={parametres.seuilAlerteSlaPourcent}
        actions={actions}
        suggestions={{ reponse: '', resolution: '' }}
        ecran
      />
    </TelechargerPiece.Provider>
  );
}
