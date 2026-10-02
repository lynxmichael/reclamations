/**
 * Enquête de satisfaction (étape 15) : ouverture à la clôture, dans la transaction de la clôture.
 * Les règles (durée, modes de clôture, NPS) sont dans domaine/satisfaction.ts.
 */
import { clotureAvecEnquete, finEnquete, type ModeClotureAvecEnquete } from '../../domaine/satisfaction.js';
import type { ClientTransaction } from '../../infrastructure/base-de-donnees/index.js';
import type { ParametresBanque } from './parametres.js';

/**
 * Ouvre l'enquête d'une réclamation qui vient d'être clôturée, si la banque les a activées.
 * Rend true si une enquête est ouverte : le message de clôture porte alors son lien.
 */
export async function ouvrirEnquete(
  tx: ClientTransaction, t: { id: string; tenantId: string }, p: ParametresBanque, mode: ModeClotureAvecEnquete, maintenant: Date,
): Promise<boolean> {
  if (!p.banque.enqueteSatisfaction || !clotureAvecEnquete(mode)) return false;
  await tx.enqueteSatisfaction.create({
    data: { tenantId: t.tenantId, reclamationId: t.id, creeLe: maintenant, expireLe: finEnquete(maintenant) },
  });
  return true;
}
