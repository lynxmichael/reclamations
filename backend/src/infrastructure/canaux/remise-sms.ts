/**
 * Accusé de remise d'un SMS envoyé (étape 22), transmis par la passerelle de Makor à l'API (opération
 * recevoirRemiseSms). Interface proposée à la passerelle, à confirmer avec son équipe :
 *
 *   POST https://console.<domaine>/api/v1/webhooks/sms/remise
 *   X-Signature: sha256=<HMAC-SHA256 du corps avec SMS_ENTRANT_SECRET>
 *   { "id": "<identifiant rendu à l'envoi>", "reference": "<identifiant envoyé avec le SMS>",
 *     "statut": "REMIS" | "NON_REMIS" | "EXPIRE" | "REJETE" | "EN_COURS", "code": "<code de l'opérateur>",
 *     "recuLe": "2026-10-08T09:12:00Z" }
 *
 * Réponse 200 { "recu": true } dans tous les cas où la signature est bonne (SMS inconnu compris) :
 * la passerelle n'a pas à réessayer. Un même accusé reçu deux fois ne change rien.
 */
import type { StatutRemise } from '../../domaine/envois.js';

export interface RemiseRecue {
  readonly id: string | null;
  readonly reference: string | null;
  readonly statut: StatutRemise;
  readonly code: string | null;
  readonly recuLe: Date;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Lecture d'un corps déjà validé contre le contrat. */
export function lireRemiseSms(corps: { id?: string; reference?: string; statut: StatutRemise; code?: string; recuLe?: string }, maintenant: Date): RemiseRecue {
  const recu = corps.recuLe ? new Date(corps.recuLe) : maintenant;
  return {
    id: corps.id?.trim() || null,
    reference: corps.reference && UUID.test(corps.reference) ? corps.reference : null,
    statut: corps.statut,
    code: corps.code?.trim().slice(0, 60) || null,
    // Une heure future (horloge de la passerelle) est ramenée à maintenant
    recuLe: Number.isNaN(recu.getTime()) || recu > maintenant ? maintenant : recu,
  };
}
