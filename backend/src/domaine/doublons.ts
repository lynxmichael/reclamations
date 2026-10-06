/**
 * Doublons (étape 21) : règles pures, partagées par l'API et la démo cliquable.
 *
 * Un doublon possible : deux réclamations du même client (reconnu à son téléphone ou à son e-mail),
 * de la même catégorie, toutes deux non clôturées, déposées à moins de 30 jours d'écart. Il est
 * signalé dans la file et sur la fiche ; rien n'est fusionné de soi-même.
 *
 * Le rattachement, décidé par l'agent assigné ou le superviseur, joint un doublon à la réclamation
 * principale du même client, quelle que soit sa catégorie : le doublon est clôturé (motif
 * « Doublon »), garde ses messages et ses pièces jointes, et le client ne suit plus que la principale.
 */
import type { StatutReclamation } from './enumerations.js';

export const ECART_DOUBLON_JOURS = 30;
const ECART_MS = ECART_DOUBLON_JOURS * 86_400_000;

export interface ReclamationComparee {
  readonly id: string;
  readonly clientId: string;
  readonly categorieId: string;
  readonly statut: StatutReclamation;
  readonly creeLe: Date;
}

/** Deux réclamations distinctes, même client et même catégorie, non clôturées, à moins de 30 jours d'écart. */
export function doublonPossible(a: ReclamationComparee, b: ReclamationComparee): boolean {
  return a.id !== b.id
    && a.clientId === b.clientId
    && a.categorieId === b.categorieId
    && a.statut !== 'CLOTUREE'
    && b.statut !== 'CLOTUREE'
    && Math.abs(a.creeLe.getTime() - b.creeLe.getTime()) < ECART_MS;
}

export interface Rattachable {
  readonly id: string;
  readonly clientId: string;
  readonly statut: StatutReclamation;
  readonly rattacheeAId: string | null;
}

export type RefusRattachement = 'MEME_RECLAMATION' | 'AUTRE_CLIENT' | 'PRINCIPALE_CLOTUREE' | 'DEJA_RATTACHEE';

export const MESSAGES_RATTACHEMENT: Record<RefusRattachement, string> = {
  MEME_RECLAMATION: 'Une réclamation ne peut pas être rattachée à elle-même',
  AUTRE_CLIENT: 'Seule une réclamation du même client peut être rattachée',
  PRINCIPALE_CLOTUREE: 'La réclamation principale est clôturée : rattachez-la à une réclamation en cours',
  DEJA_RATTACHEE: 'La réclamation principale est elle-même un doublon rattaché',
};

/**
 * Le doublon peut-il être joint à cette principale ? (La machine d'états vérifie en plus que le
 * doublon n'est pas clôturé et que l'acteur est l'agent assigné ou un superviseur.)
 */
export function refusRattachement(doublon: Rattachable, principale: Rattachable): RefusRattachement | null {
  if (doublon.id === principale.id) return 'MEME_RECLAMATION';
  if (doublon.clientId !== principale.clientId) return 'AUTRE_CLIENT';
  if (principale.rattacheeAId) return 'DEJA_RATTACHEE';
  if (principale.statut === 'CLOTUREE') return 'PRINCIPALE_CLOTUREE';
  return null;
}
