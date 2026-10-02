/**
 * Conversations et chat web (étape 17, décisions I1 et I8 de l'étape 14) : règles pures, partagées
 * par l'API, le worker et la démo cliquable.
 *
 * - une conversation par réclamation, commune à tous les canaux ; ses messages sont les commentaires
 *   publics de la réclamation (réponses de la banque, messages du client) ;
 * - elle est lue par la banque quand l'agent assigné l'ouvre (un superviseur si la réclamation n'est
 *   pas assignée), ou dès que la banque répond ; un superviseur qui regarde la conversation d'un
 *   agent ne la marque pas lue à sa place ;
 * - une réponse de la banque n'est signalée au client par e-mail ou SMS que s'il ne l'a pas lue dans
 *   le chat 2 minutes après ; plusieurs réponses rapprochées ne donnent qu'un avis ;
 * - un message du client n'alerte l'agent que si rien n'attendait déjà sa lecture : une rafale de
 *   messages, une seule alerte.
 */
import { prochainInstantOuvre, type CalendrierNormalise } from './temps-ouvre/calendrier.js';

export type CanalConversation = 'WEB' | 'WHATSAPP' | 'SMS';

/** Délai avant l'avis par e-mail ou SMS d'une réponse restée non lue dans le chat. */
export const DELAI_AVIS_CLIENT_MS = 2 * 60_000;
/** Le client est « en ligne » s'il avait le chat à l'écran il y a moins de 2 minutes. */
export const PRESENCE_MS = 2 * 60_000;
/** Le chat ouvert le signale à ce rythme (en plus de chaque lecture de nouveaux messages). */
export const BATTEMENT_CHAT_MS = 60_000;
/** Longueur de l'extrait du dernier message dans la boîte de réception. */
export const LONGUEUR_EXTRAIT = 140;

export interface EtatConversation {
  readonly dernierMessageClientLe: Date | null;
  readonly dernierMessageBanqueLe: Date | null;
  readonly luClientLe: Date | null;
  readonly luBanqueLe: Date | null;
  readonly avisClientLe: Date | null;
}

const ms = (d: Date | null): number => (d ? d.getTime() : Number.NEGATIVE_INFINITY);

/** Le client a écrit en dernier : la banque lui doit une réponse. */
export function aRepondre(c: Pick<EtatConversation, 'dernierMessageClientLe' | 'dernierMessageBanqueLe'>): boolean {
  return c.dernierMessageClientLe !== null && ms(c.dernierMessageClientLe) > ms(c.dernierMessageBanqueLe);
}

/** Statuts où la banque répond encore : après la résolution, le client confirme ou conteste. */
const STATUTS_OUVERTS: readonly string[] = ['OUVERTE', 'EN_COURS', 'EN_ATTENTE_CLIENT'];

/** Réponse due : le client a écrit en dernier, sur une réclamation encore ouverte (« À répondre »). */
export function reponseDue(c: Pick<EtatConversation, 'dernierMessageClientLe' | 'dernierMessageBanqueLe'>, statut: string): boolean {
  return STATUTS_OUVERTS.includes(statut) && aRepondre(c);
}

/** Un message du client attend la lecture de la banque. */
export function nonLueParLaBanque(c: Pick<EtatConversation, 'dernierMessageClientLe' | 'luBanqueLe'>): boolean {
  return c.dernierMessageClientLe !== null && ms(c.dernierMessageClientLe) > ms(c.luBanqueLe);
}

/** Une réponse de la banque attend la lecture du client. */
export function nonLueParLeClient(c: Pick<EtatConversation, 'dernierMessageBanqueLe' | 'luClientLe'>): boolean {
  return c.dernierMessageBanqueLe !== null && ms(c.dernierMessageBanqueLe) > ms(c.luClientLe);
}

/** Le client avait le chat à l'écran il y a moins de 2 minutes. */
export function clientEnLigne(c: Pick<EtatConversation, 'luClientLe'>, maintenant: Date): boolean {
  return c.luClientLe !== null && maintenant.getTime() - c.luClientLe.getTime() < PRESENCE_MS;
}

/** Les réponses de la banque écrites avant cet instant, encore non lues, appellent un avis. */
export function limiteAvisClient(maintenant: Date): Date {
  return new Date(maintenant.getTime() - DELAI_AVIS_CLIENT_MS);
}

/**
 * Avis différé dû : la dernière réponse de la banque date d'au moins 2 minutes, le client ne l'a pas
 * lue dans le chat, et aucun avis n'est parti depuis.
 */
export function avisClientDu(c: EtatConversation, maintenant: Date): boolean {
  const r = c.dernierMessageBanqueLe;
  if (!r || r > limiteAvisClient(maintenant)) return false;
  return nonLueParLeClient(c) && ms(r) > ms(c.avisClientLe);
}

/** Un nouveau message du client alerte l'agent si la conversation n'avait rien de non lu (état d'avant ce message). */
export function alerterAgent(avant: Pick<EtatConversation, 'dernierMessageClientLe' | 'luBanqueLe'> | null): boolean {
  return !avant || !nonLueParLaBanque(avant);
}

export interface Lecteur {
  readonly id: string;
  readonly role: string;
}

/** Qui marque la conversation lue pour la banque : l'agent assigné ; sans agent, un superviseur. */
export function marqueLaLecture(lecteur: Lecteur, agentId: string | null): boolean {
  return agentId ? lecteur.role === 'AGENT' && lecteur.id === agentId : lecteur.role === 'SUPERVISEUR';
}

/** Extrait d'un message sur une ligne, pour la boîte de réception. */
export function extrait(texte: string, longueur = LONGUEUR_EXTRAIT): string {
  const ligne = texte.replace(/\s+/g, ' ').trim();
  if (ligne.length <= longueur) return ligne;
  const coupe = ligne.slice(0, longueur - 1);
  const espace = coupe.lastIndexOf(' ');
  return `${(espace > longueur * 0.6 ? coupe.slice(0, espace) : coupe).trimEnd()}…`;
}

/** Ce que le client voit en tête du chat : la banque est-elle dans ses heures d'ouverture, et sinon quand reprend-elle. */
export function disponibilite(maintenant: Date, cal: CalendrierNormalise): { ouverte: boolean; repriseLe: Date | null } {
  const prochain = prochainInstantOuvre(maintenant, cal);
  const ouverte = prochain.getTime() === maintenant.getTime();
  return { ouverte, repriseLe: ouverte ? null : prochain };
}
