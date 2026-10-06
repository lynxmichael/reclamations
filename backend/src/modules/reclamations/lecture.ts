/**
 * Lecture d'une réclamation et mise en forme selon le contrat : fiche du personnel
 * (ReclamationDetail), ligne des files (ReclamationResume), vue du client (ReclamationClient),
 * chronologie publique (EtapeSuivi). Le chrono SLA est calculé à la lecture, en minutes ouvrées.
 */
import type { components } from '../../contrat/api.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { OPERATIONS, TRANSITIONS, verifierOperation, verifierTransition, type Acteur, type ActionStatut, type Operation } from '../../domaine/reclamation/machine.js';
import { estEnRetard } from '../../domaine/reclamation/sla.js';
import { minutesOuvreesEntre, type CalendrierNormalise } from '../../domaine/temps-ouvre/calendrier.js';
import { etat } from '../../application/reclamations/cycle-de-vie.js';
import type { ClientTransaction } from '../../infrastructure/base-de-donnees/index.js';
import { introuvable } from '../../infrastructure/contrat/probleme.js';
import { etatAvis } from '../../domaine/satisfaction.js';
import type { Choix } from '../../domaine/attribution.js';
import { chargerContexte, suggestion, type ContexteAttribution } from '../../application/reclamations/attribution.js';
import type { ParametresBanque } from '../../application/reclamations/parametres.js';
import { clientEnLigne, disponibilite, nonLueParLaBanque, reponseDue } from '../../domaine/conversation.js';
import { canalDuFil } from '../../domaine/canaux.js';

type S<N extends keyof components['schemas']> = components['schemas'][N];

export const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);
export const nomComplet = (u: { prenom: string; nom: string }) => `${u.prenom} ${u.nom}`;
const reference = (u: { id: string; prenom: string; nom: string } | null) => (u ? { id: u.id, nom: nomComplet(u) } : null);

const PERSONNE = { select: { id: true, nom: true, prenom: true } } as const;
const PIECE = { select: { id: true, nomFichier: true, typeMime: true, tailleOctets: true, creeLe: true } } as const;

/** Un message et ses pièces jointes (fiche, vue du client, conversations). */
export const INCLUSION_MESSAGE = {
  auteurUtilisateur: { select: { nom: true, prenom: true } },
  piecesJointes: { ...PIECE, orderBy: [{ creeLe: 'asc' }, { id: 'asc' }] },
} satisfies Prisma.CommentaireInclude;

export const INCLUSION_FICHE = {
  categorie: { select: { id: true, nom: true } },
  agence: { select: { id: true, nom: true } },
  pointDepot: { select: { id: true, libelle: true } },
  agent: PERSONNE,
  escaladeeVers: PERSONNE,
  cloturePar: PERSONNE,
  client: { select: { id: true, nom: true, email: true, telephone: true } },
  commentaires: { orderBy: [{ creeLe: 'asc' }, { id: 'asc' }], include: INCLUSION_MESSAGE },
  piecesJointes: { where: { commentaireId: null }, ...PIECE, orderBy: [{ creeLe: 'asc' }, { id: 'asc' }] },
  evenements: { orderBy: [{ creeLe: 'asc' }, { id: 'asc' }], include: { acteurUtilisateur: { select: { nom: true, prenom: true } } } },
  enquete: true,
  conversation: true,
} satisfies Prisma.ReclamationInclude;

export type TicketComplet = Prisma.ReclamationGetPayload<{ include: typeof INCLUSION_FICHE }>;

export const piece = (p: { id: string; nomFichier: string; typeMime: string; tailleOctets: number; creeLe: Date }): S<'PieceJointe'> =>
  ({ id: p.id, nomFichier: p.nomFichier, typeMime: p.typeMime, tailleOctets: p.tailleOctets, creeLe: p.creeLe.toISOString() });

// ---------------------------------------------------------------------------
//  Chrono SLA
// ---------------------------------------------------------------------------

type ChampsChrono = Pick<TicketComplet, 'statut' | 'echeanceSlaLe' | 'alertePreventiveLe' | 'slaSuspenduLe' | 'slaMinutesRestantes'>;

export function chrono(t: ChampsChrono, maintenant: Date, cal: CalendrierNormalise): { etat: S<'EtatChrono'>; minutesRestantes: number | null } {
  if (t.statut === 'RESOLUE' || t.statut === 'CLOTUREE') {
    return { etat: 'ARRETE', minutesRestantes: t.statut === 'RESOLUE' ? t.slaMinutesRestantes : null };
  }
  if (t.slaSuspenduLe) return { etat: 'EN_PAUSE', minutesRestantes: t.slaMinutesRestantes };
  if (!t.echeanceSlaLe) return { etat: 'DANS_LES_DELAIS', minutesRestantes: t.slaMinutesRestantes };
  const restantes = t.echeanceSlaLe > maintenant
    ? Math.floor(minutesOuvreesEntre(maintenant, t.echeanceSlaLe, cal))
    : -Math.ceil(minutesOuvreesEntre(t.echeanceSlaLe, maintenant, cal));
  const e = t.echeanceSlaLe <= maintenant ? 'DEPASSE' : t.alertePreventiveLe && t.alertePreventiveLe <= maintenant ? 'ALERTE' : 'DANS_LES_DELAIS';
  return { etat: e, minutesRestantes: restantes };
}

const enCours = (statut: string) => statut === 'OUVERTE' || statut === 'EN_COURS' || statut === 'EN_ATTENTE_CLIENT';

// ---------------------------------------------------------------------------
//  Actions permises (machine d'états de l'étape 4)
// ---------------------------------------------------------------------------

type EtatMachine = Parameters<typeof verifierTransition>[1];

export function actionsPossibles(e: EtatMachine, acteur: Acteur, maintenant: Date): ActionStatut[] {
  return (Object.keys(TRANSITIONS) as ActionStatut[]).filter((a) => verifierTransition(a, e, acteur, maintenant).ok);
}

export function operationsPossibles(e: EtatMachine, acteur: Acteur): Operation[] {
  return (Object.keys(OPERATIONS) as Operation[]).filter((o) => verifierOperation(o, e, acteur).ok);
}

// ---------------------------------------------------------------------------
//  Fiche du personnel
// ---------------------------------------------------------------------------

/**
 * Fiche d'une réclamation pour un membre du personnel. Un agent ne lit que les tickets qui lui
 * sont assignés : les autres lui répondent 404 (décision C5), comme ceux d'une autre banque.
 */
export async function lireFiche(tx: ClientTransaction, id: string, acteur: Acteur, maintenant: Date, p: ParametresBanque): Promise<S<'ReclamationDetail'>> {
  const t = await tx.reclamation.findUnique({ where: { id }, include: INCLUSION_FICHE });
  if (!t || !verifierOperation('CONSULTER', etat(t), acteur).ok) throw introuvable('Réclamation introuvable');
  const ctx = peutRecevoirSuggestion(p, acteur) && !t.agentId && t.statut === 'OUVERTE' ? await chargerContexte(tx, p, maintenant) : null;
  return fiche(t, acteur, maintenant, p.sla.calendrier, suggestion(ctx, t), p.banque);
}

/** Mode suggestion (étape 16) : l'agent proposé s'affiche pour qui peut assigner, le superviseur. */
export function peutRecevoirSuggestion(p: ParametresBanque, acteur: Acteur): boolean {
  return p.banque.modeAttribution === 'SUGGESTION' && acteur.type === 'UTILISATEUR' && acteur.role === 'SUPERVISEUR';
}

/** Suggestions d'une page des files : un seul chargement des groupes et des charges. */
export async function contexteSuggestions(tx: ClientTransaction, p: ParametresBanque, acteur: Acteur, maintenant: Date): Promise<ContexteAttribution | null> {
  return peutRecevoirSuggestion(p, acteur) ? chargerContexte(tx, p, maintenant) : null;
}

export function fiche(
  t: TicketComplet, acteur: Acteur, maintenant: Date, cal: CalendrierNormalise, suggeree: Choix | null = null,
  canaux: CanauxOuverts | null = null,
): S<'ReclamationDetail'> {
  const c = chrono(t, maintenant, cal);
  const qui = (type: 'CLIENT' | 'UTILISATEUR' | 'SYSTEME', u: { nom: string; prenom: string } | null): S<'ActeurVisible'> =>
    ({ type, nom: type === 'UTILISATEUR' && u ? nomComplet(u) : null });
  return {
    id: t.id,
    numero: t.numero,
    statut: t.statut,
    priorite: t.priorite,
    canal: t.canal,
    description: t.description,
    categorie: { id: t.categorie.id, nom: t.categorie.nom },
    agence: t.agence ? { id: t.agence.id, nom: t.agence.nom } : null,
    pointDepot: { id: t.pointDepot.id, libelle: t.pointDepot.libelle },
    agent: reference(t.agent),
    escaladeeVers: reference(t.escaladeeVers),
    client: { id: t.client.id, nom: t.client.nom, email: t.client.email, telephone: t.client.telephone },
    creeLe: t.creeLe.toISOString(),
    sla: {
      etat: c.etat,
      delaiCibleMinutes: t.delaiCibleMinutes,
      echeanceLe: iso(t.echeanceSlaLe),
      alertePreventiveLe: iso(t.alertePreventiveLe),
      enPauseDepuis: iso(t.slaSuspenduLe),
      minutesRestantes: c.minutesRestantes,
      enRetard: enCours(t.statut) && estEnRetard(t, maintenant),
      respecte: t.slaRespecte,
    },
    jalons: {
      prisEnChargeLe: iso(t.prisEnChargeLe),
      premiereReponseLe: iso(t.premiereReponseLe),
      resolueLe: iso(t.resolueLe),
      clotureLe: iso(t.clotureLe),
      clotureAutoPrevueLe: iso(t.clotureAutoPrevueLe),
      escaladeeLe: iso(t.escaladeeLe),
      escaladeeAdminLe: iso(t.escaladeeAdminLe),
    },
    cloture: t.modeCloture
      ? { mode: t.modeCloture, motif: t.motifClotureForcee, precision: t.commentaireCloture, par: reference(t.cloturePar) }
      : null,
    nbReouvertures: t.nbReouvertures,
    messages: t.commentaires.map(messagePersonnel),
    piecesJointes: t.piecesJointes.map(piece),
    chronologie: t.evenements.map((e) => ({
      type: e.type,
      statutAvant: e.statutAvant,
      statutApres: e.statutApres,
      acteur: qui(e.acteurType, e.acteurUtilisateur),
      visibleClient: e.visibleClient,
      date: e.creeLe.toISOString(),
    })),
    actionsPossibles: actionsPossibles(etat(t), acteur, maintenant),
    operationsPossibles: operationsPossibles(etat(t), acteur),
    avis: avisReclamation(t.enquete, maintenant),
    attributionSuggeree: suggeree
      ? { agent: { id: suggeree.agent.id, nom: suggeree.agent.nom }, groupe: { id: suggeree.groupe.id, nom: suggeree.groupe.nom } }
      : null,
    conversation: canaux?.chatWeb && t.conversation ? conversationTicket(t.conversation, t.statut, maintenant, canaux) : null,
    depotAssistant: depotAssistant(t.evenements),
  };
}

/** Déposée avec l'assistant du portail (étape 18) : noté dans l'événement de création. */
export function depotAssistant(evenements: readonly { type: string; donnees: unknown }[]): boolean {
  const creation = evenements.find((e) => e.type === 'CREATION');
  return !!creation && typeof creation.donnees === 'object' && creation.donnees !== null && 'assistant' in creation.donnees;
}

type LigneConversation = NonNullable<TicketComplet['conversation']>;

/** Fonctions de conversation ouvertes à la banque : chat (étape 17), WhatsApp et SMS (étape 20) */
export interface CanauxOuverts {
  readonly chatWeb: boolean;
  readonly whatsapp: boolean;
  readonly smsEntrant: boolean;
}

/** Étape 20 : par où partira la prochaine réponse (WhatsApp dans les 24 h, SMS, sinon le suivi). */
export function reponseVers(c: Pick<LigneConversation, 'canal' | 'dernierMessageClientLe'>, canaux: CanauxOuverts, maintenant: Date): S<'ReponseVers'> {
  const r = canalDuFil(c, canaux, maintenant);
  return { canal: r.canal, finFenetreLe: iso(r.finFenetreLe) };
}

/** Conversation sur la fiche (étape 17) : à répondre, non lue, client en ligne, canal de la réponse (étape 20). */
export function conversationTicket(c: LigneConversation, statut: string, maintenant: Date, canaux: CanauxOuverts): S<'ConversationTicket'> {
  return {
    id: c.id,
    canal: c.canal,
    aRepondre: reponseDue(c, statut),
    nonLue: nonLueParLaBanque(c),
    // Le client « en ligne » est celui qui a le chat du portail à l'écran
    clientEnLigne: c.canal === 'WEB' && clientEnLigne(c, maintenant),
    luParLeClientLe: iso(c.luClientLe),
    reponseVers: reponseVers(c, canaux, maintenant),
  };
}

/** Le chat vu du client (étape 17) : disponibilité de la banque, sa dernière lecture. */
export function etatChat(c: { luBanqueLe: Date | null } | null, maintenant: Date, cal: CalendrierNormalise): S<'EtatChat'> {
  const d = disponibilite(maintenant, cal);
  return { ouvert: d.ouverte, repriseLe: iso(d.repriseLe), luParLaBanqueLe: iso(c?.luBanqueLe) };
}

/** Message tel que le personnel le voit : auteur nommé, notes internes comprises sur la fiche. */
export function messagePersonnel(m: TicketComplet['commentaires'][number]): S<'Message'> {
  return {
    id: m.id,
    type: m.type,
    contenu: m.contenu,
    canal: m.canal,
    auteur: m.type === 'MESSAGE_DU_CLIENT'
      ? { type: 'CLIENT', nom: null }
      : { type: 'UTILISATEUR', nom: m.auteurUtilisateur ? nomComplet(m.auteurUtilisateur) : null },
    creeLe: m.creeLe.toISOString(),
    piecesJointes: m.piecesJointes.map(piece),
  };
}

/** Message public tel que le client le voit : jamais le nom de l'agent. */
export function messageVisible(m: TicketComplet['commentaires'][number]): S<'MessageVisible'> {
  return {
    id: m.id,
    type: m.type as 'REPONSE_AU_CLIENT' | 'MESSAGE_DU_CLIENT',
    contenu: m.contenu,
    canal: m.canal,
    auteur: m.type === 'MESSAGE_DU_CLIENT' ? 'CLIENT' : 'BANQUE',
    creeLe: m.creeLe.toISOString(),
    piecesJointes: m.piecesJointes.map(piece),
  };
}

type Enquete = TicketComplet['enquete'];

/** Enquête de satisfaction vue par le personnel (étape 15) : réponse et commentaire compris. */
export function avisReclamation(e: Enquete, maintenant: Date): S<'AvisReclamation'> | null {
  if (!e) return null;
  return {
    etat: etatAvis(e, maintenant),
    ouverteLe: e.creeLe.toISOString(),
    expireLe: e.expireLe.toISOString(),
    reponse: e.reponduLe
      ? { note: e.note!, recommandation: e.recommandation!, commentaire: e.commentaire, reponduLe: e.reponduLe.toISOString() }
      : null,
  };
}

/** Enquête vue par le client dans son espace, avec l'adresse de sa page sur le portail. */
export function avisClient(e: Enquete, jetonSuivi: string, maintenant: Date): S<'AvisClient'> | null {
  if (!e) return null;
  return { etat: etatAvis(e, maintenant), expireLe: e.expireLe.toISOString(), chemin: `/suivi/${jetonSuivi}/avis` };
}

// ---------------------------------------------------------------------------
//  Ligne des files
// ---------------------------------------------------------------------------

export const INCLUSION_RESUME = {
  categorie: { select: { id: true, nom: true } },
  agence: { select: { id: true, nom: true } },
  agent: PERSONNE,
  client: { select: { nom: true } },
} satisfies Prisma.ReclamationInclude;

export type TicketResume = Prisma.ReclamationGetPayload<{ include: typeof INCLUSION_RESUME }>;

export function resume(t: TicketResume, maintenant: Date, cal: CalendrierNormalise, ctx: ContexteAttribution | null = null): S<'ReclamationResume'> {
  const suggeree = suggestion(ctx, t);
  const c = chrono(t, maintenant, cal);
  return {
    id: t.id,
    numero: t.numero,
    statut: t.statut,
    priorite: t.priorite,
    canal: t.canal,
    categorie: { id: t.categorie.id, nom: t.categorie.nom },
    agence: t.agence ? { id: t.agence.id, nom: t.agence.nom } : null,
    agent: reference(t.agent),
    agentSuggere: suggeree ? { id: suggeree.agent.id, nom: suggeree.agent.nom } : null,
    client: { nom: t.client.nom },
    creeLe: t.creeLe.toISOString(),
    echeanceSlaLe: c.etat === 'EN_PAUSE' || c.etat === 'ARRETE' ? null : iso(t.echeanceSlaLe),
    enRetard: enCours(t.statut) && estEnRetard(t, maintenant),
    escaladee: t.escaladeeVersId !== null || t.escaladeeLe !== null,
    sla: { etat: c.etat, delaiCibleMinutes: t.delaiCibleMinutes, minutesRestantes: c.etat === 'ARRETE' ? null : c.minutesRestantes },
  };
}

// ---------------------------------------------------------------------------
//  Vue du client
// ---------------------------------------------------------------------------

/** Étapes visibles du client : changements de statut seulement, horodatés. */
export function etapesSuivi(evenements: readonly { visibleClient: boolean; statutApres: TicketComplet['statut'] | null; type: TicketComplet['evenements'][number]['type']; creeLe: Date }[]): S<'EtapeSuivi'>[] {
  return evenements
    .filter((e) => e.visibleClient && e.statutApres)
    .map((e) => ({ type: e.type, statut: e.statutApres!, date: e.creeLe.toISOString() }));
}

/** Réclamation vue par son client : jamais de note interne ni de pièce jointe d'une note. */
export async function lireVueClient(tx: ClientTransaction, id: string, clientId: string, maintenant: Date, p: ParametresBanque): Promise<S<'ReclamationClient'>> {
  const t = await tx.reclamation.findUnique({ where: { id }, include: INCLUSION_FICHE });
  if (!t || t.clientId !== clientId) throw introuvable('Réclamation introuvable');
  const acteur: Acteur = { type: 'CLIENT', clientId };
  return {
    id: t.id,
    numero: t.numero,
    statut: t.statut,
    categorie: t.categorie.nom,
    description: t.description,
    creeLe: t.creeLe.toISOString(),
    clotureAutoPrevueLe: t.statut === 'RESOLUE' ? iso(t.clotureAutoPrevueLe) : null,
    messages: t.commentaires.filter((m) => m.type !== 'NOTE_INTERNE').map(messageVisible),
    piecesJointes: t.piecesJointes.map(piece),
    etapes: etapesSuivi(t.evenements),
    actionsPossibles: actionsPossibles(etat(t), acteur, maintenant),
    operationsPossibles: operationsPossibles(etat(t), acteur),
    avis: avisClient(t.enquete, t.jetonSuivi, maintenant),
    chat: p.banque.chatWeb ? etatChat(t.conversation, maintenant, p.sla.calendrier) : null,
  };
}
