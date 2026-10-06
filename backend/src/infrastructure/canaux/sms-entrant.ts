/**
 * SMS entrant (étape 20) : un SMS reçu par la passerelle de Makor au numéro d'une banque, transmis à
 * l'API (opération recevoirSmsEntrant). Interface proposée à la passerelle, à confirmer avec son équipe :
 *
 *   POST https://console.<domaine>/api/v1/webhooks/sms
 *   X-Signature: sha256=<HMAC-SHA256 du corps avec SMS_ENTRANT_SECRET>
 *   { "id": "<identifiant du SMS>", "de": "+225…", "vers": "+225…", "texte": "…", "recuLe": "2026-10-06T09:12:00Z" }
 *
 * Réponse 200 { "recu": true } : SMS pris en compte (ou ignoré, numéro inconnu) ; sinon, la passerelle
 * réessaie avec le même identifiant, traité une seule fois.
 */
import { normaliserTelephone } from '../../domaine/contact.js';

export interface SmsRecu {
  readonly idExterne: string;
  readonly de: string;
  readonly vers: string;
  readonly texte: string;
  readonly recuLe: Date;
}

/** Lecture d'un corps déjà validé contre le contrat ; null si un numéro est illisible. */
export function lireSmsEntrant(corps: { id: string; de: string; vers: string; texte: string; recuLe?: string }, maintenant: Date): SmsRecu | null {
  try {
    const de = normaliserTelephone(corps.de);
    const vers = normaliserTelephone(corps.vers);
    if (!de || !vers) return null;
    const recu = corps.recuLe ? new Date(corps.recuLe) : maintenant;
    return { idExterne: corps.id, de, vers, texte: corps.texte, recuLe: Number.isNaN(recu.getTime()) ? maintenant : recu };
  } catch {
    return null;
  }
}
