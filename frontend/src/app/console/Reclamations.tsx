/**
 * Réclamations dans le back-office : files de traitement (listerReclamations) et fiche avec ses
 * actions (lireReclamation et les opérations du cycle de vie). Les critères de la file sont dans
 * l'adresse : un lien copié rouvre la même vue.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ErreurApi, enregistrer, messageErreur } from '../../api/client';
import type { S } from '../../api/types';
import { Files, type ChoixEnLot, type CriteresFiles, type File as FileTraitement, type Periode, type TriFiles } from '../../ecrans/back-office/Files';
import { NouvelleReclamation, SAISIE_VIDE, type SaisieGuichet } from '../../ecrans/back-office/NouvelleReclamation';
import { Ticket, type ActionsFiche } from '../../ecrans/back-office/Ticket';
import { REGLES_PIECES } from '../../ui/ChoixFichiers';
import { TelechargerPiece } from '../../ui/contextes';
import { CANAL } from '../../ui/libelles';
import { nouvelleCle } from '../commun/requetes';
import { useAnnoncer } from '../commun/Annonces';
import { Chargement, ErreurChargement } from '../commun/Etats';
import { INTERVALLE_MS } from './Cadre';
import { ROUTES_BANQUE, nomDe, useConsole, useParametres } from './contexte';
import { adressePortail } from './Parametrage';
import { useExport } from './Reporting';

const FILES: FileTraitement[] = ['recues', 'assignees', 'urgentes', 'en-retard', 'escaladees', 'toutes', 'a-reassigner'];
const CANAUX = Object.keys(CANAL) as S<'CanalDepot'>[];
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
    canal: val('canal', CANAUX),
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
  const cache = useQueryClient();
  const annoncer = useAnnoncer();
  // Mode suggestion (étape 16) : le superviseur valide l'agent proposé depuis la file
  const valider = useMutation({
    mutationFn: ({ r, agent }: { r: S<'ReclamationResume'>; agent: S<'ReferenceNommee'> }) =>
      appeler('assignerReclamation', { chemin: { id: r.id }, corps: { agentId: agent.id } }),
    onSuccess: (_, { r, agent }) => {
      void cache.invalidateQueries({ queryKey: ['reclamations'] });
      void cache.invalidateQueries({ queryKey: ['compteurs'] });
      annoncer(`${r.numero} assignée à ${agent.nom}.`);
    },
    onError: (e) => {
      annoncer(messageErreur(e), 'erreur');
      void cache.invalidateQueries({ queryKey: ['reclamations'] });
    },
  });

  // Étape 21 : réassignation en lot (un agent, ou réparties entre les agents disponibles)
  const enLot = useMutation({
    mutationFn: ({ ids, choix }: { ids: string[]; choix: ChoixEnLot }) =>
      appeler('assignerEnLot', { corps: 'agentId' in choix ? { reclamationIds: ids, agentId: choix.agentId } : { reclamationIds: ids, repartir: true } }),
    onSuccess: (r) => {
      void cache.invalidateQueries({ queryKey: ['reclamations'] });
      void cache.invalidateQueries({ queryKey: ['compteurs'] });
      const faites = r.assignees.length;
      const laissees = r.laissees.map((l) => `${l.numero ?? 'réclamation inconnue'} (${l.raison.toLowerCase()})`).join(', ');
      annoncer(
        `${faites} réclamation${faites > 1 ? 's' : ''} assignée${faites > 1 ? 's' : ''}${laissees ? ` ; laissée${r.laissees.length > 1 ? 's' : ''} : ${laissees}` : ''}.`,
        faites === 0 ? 'erreur' : 'ok',
      );
    },
    onError: (e) => annoncer(messageErreur(e), 'erreur'),
  });

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
      // (un agent, depuis l'étape 11 : les siennes seulement, comme sa file)
      surExporter={() => void exporter(() => appeler('exporterReclamations', {
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
      surValiderSuggestion={(r, agent) => valider.mutate({ r, agent })}
      surNouvelle={moi.role === 'ADMIN_ENTREPRISE' ? undefined : () => navigate(`${ROUTES_BANQUE.reclamations}/nouvelle`)}
      surAssignerEnLot={moi.role === 'SUPERVISEUR'
        ? (ids, choix) => enLot.mutateAsync({ ids, choix }).then((r) => r.assignees.length > 0).catch(() => false)
        : undefined}
    />
  );
}

/** Étape 21 : saisie au guichet ou au téléphone, puis le récépissé à imprimer. */
export function PageNouvelle() {
  const { appeler, moi } = useConsole();
  const parametres = useParametres();
  const navigate = useNavigate();
  const cache = useQueryClient();
  const categories = useQuery({ queryKey: ['categories'], queryFn: () => appeler('listerCategories'), staleTime: 60_000 });
  const agences = useQuery({ queryKey: ['agences'], queryFn: () => appeler('listerAgences'), staleTime: 60_000 });
  const [saisie, setSaisie] = useState<SaisieGuichet>(SAISIE_VIDE);
  const [version, setVersion] = useState(0);
  const [erreur, setErreur] = useState<S<'Probleme'> | null>(null);
  const [accuse, setAccuse] = useState<{ accuse: S<'AccuseSaisie'>; saisie: SaisieGuichet } | null>(null);
  const cle = useRef(nouvelleCle());
  useTitre('Nouvelle réclamation');

  const envoi = useMutation({
    mutationFn: (v: SaisieGuichet) =>
      appeler('saisirReclamation', {
        entetes: { 'Idempotency-Key': cle.current },
        // Un champ vide n'est pas envoyé : l'API répond « Champ obligatoire » plutôt que « invalide »
        corps: {
          canal: v.canal,
          ...(v.agenceId ? { agenceId: v.agenceId } : {}),
          ...(v.categorieId ? { categorieId: v.categorieId } : ({} as { categorieId: string })),
          description: v.description,
          nom: v.nom.trim(),
          ...(v.telephone.trim() ? { telephone: v.telephone } : {}),
          ...(v.email.trim() ? { email: v.email } : {}),
          consentementInforme: v.consentementInforme as true,
          urgente: v.urgente,
          meLAssigner: v.meLAssigner,
          fichiers: v.fichiers,
        },
      }),
    onSuccess: (a, v) => {
      cle.current = nouvelleCle();
      setErreur(null);
      setAccuse({ accuse: a, saisie: v });
      void cache.invalidateQueries({ queryKey: ['reclamations'] });
      void cache.invalidateQueries({ queryKey: ['compteurs'] });
      window.scrollTo({ top: 0 });
    },
    onError: (e, v) => {
      if (e instanceof ErreurApi && e.statut >= 400 && e.statut < 500) cle.current = nouvelleCle();
      setErreur(e instanceof ErreurApi ? e.probleme : { type: '/erreurs/inattendue', title: 'Enregistrement impossible', status: 0, code: 'ERREUR_INTERNE', detail: messageErreur(e) });
      setSaisie({ ...v });
      setVersion((n) => n + 1);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
  });

  if (categories.isPending || agences.isPending) return <Chargement />;
  if (categories.isError) return <ErreurChargement erreur={categories.error} surReessayer={() => void categories.refetch()} />;
  if (agences.isError) return <ErreurChargement erreur={agences.error} surReessayer={() => void agences.refetch()} />;
  const banque: S<'BanquePublique'> = {
    nom: parametres.nom, slug: parametres.slug, logoUrl: parametres.logoUrl, couleurPrimaire: parametres.couleurPrimaire, couleurSecondaire: parametres.couleurSecondaire, whatsapp: parametres.whatsapp,
  };
  return (
    <NouvelleReclamation
      key={version}
      banque={banque}
      moi={moi}
      categories={categories.data.filter((c) => c.active).map((c) => ({ id: c.id, nom: c.nom }))}
      agences={agences.data.filter((a) => a.active).map((a) => ({ id: a.id, nom: a.nom }))}
      regles={REGLES_PIECES}
      lienPolitique={`${window.location.protocol}//${adressePortail(parametres.slug)}/politique-donnees`}
      saisie={saisie}
      erreur={erreur}
      occupe={envoi.isPending}
      accuse={accuse}
      surEnvoyer={(v) => envoi.mutate(v)}
      surRetour={() => navigate(ROUTES_BANQUE.reclamations)}
      surAutre={() => {
        setAccuse(null);
        setSaisie(SAISIE_VIDE);
        setVersion((n) => n + 1);
      }}
      surOuvrir={(id) => navigate(`${ROUTES_BANQUE.reclamations}/${id}`)}
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
    ouvrirConversation: (conversation) => navigate(`${ROUTES_BANQUE.conversations}/${conversation}?filtre=toutes`),
    // Étape 21 : doublons, lien de suivi perdu, autres réclamations du client
    rattacher: (principaleId) => {
      const numero = f.duMemeClient.find((d) => d.id === principaleId)?.numero ?? 'la réclamation principale';
      return executer(() => appeler('rattacherReclamation', { chemin: { id }, corps: { principaleId } }), `Rattachée à ${numero} et clôturée : le client reçoit un seul message, avec le lien de celle-ci.`);
    },
    renvoyerLien: () =>
      void appeler('renvoyerLienSuivi', { chemin: { id } })
        .then((r) => annoncer(`Lien de suivi renvoyé ${r.envois.map((e) => `${e.canal === 'EMAIL' ? 'par e-mail à' : e.canal === 'SMS' ? 'par SMS au' : 'sur WhatsApp au'} ${e.destinationMasquee}`).join(' et ')}.`))
        .catch((e: unknown) => annoncer(messageErreur(e), 'erreur')),
    ouvrir: (autre) => navigate(`${ROUTES_BANQUE.reclamations}/${autre}`),
    // Étape 22 : un message non remis, renvoyé tel quel à la même coordonnée
    renvoyerMessage: (envoiId) => {
      const e = f.envois.find((x) => x.id === envoiId);
      const vers = e ? ` ${e.canal === 'EMAIL' ? 'par e-mail à' : 'par SMS au'} ${e.destinationMasquee}` : '';
      void executer(() => appeler('renvoyerMessage', { chemin: { id, envoiId } }), `« ${e?.objet ?? 'Message'} » renvoyé${vers} : son état s'affiche dans « Messages au client ».`);
    },
    // Assistant IA (étape 18) : un brouillon, que l'agent relit et envoie lui-même
    suggerer: parametres.assistantIa && f.operationsPossibles.includes('REPONDRE_AU_CLIENT')
      ? async () => {
        try {
          return await appeler('suggererReponse', { chemin: { id } });
        } catch (e) {
          annoncer(messageErreur(e), 'erreur');
          return null;
        }
      }
      : undefined,
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
