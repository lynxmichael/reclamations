import type { Verdict } from '../../domaine/reclamation/machine.js';

/**
 * Refus métier, traduit en réponse HTTP par l'API (étape 7).
 * 404 : introuvable (y compris ticket d'une autre banque) · 403 : acteur non autorisé ·
 * 409 : action impossible dans l'état actuel · 422 : donnée invalide.
 */
export class ErreurMetier extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statutHttp: 403 | 404 | 409 | 422,
  ) {
    super(message);
    this.name = 'ErreurMetier';
  }
}

export function exiger(verdict: Verdict): void {
  if (verdict.ok) return;
  const statut = verdict.code === 'ACTEUR_NON_AUTORISE' ? 403 : 409;
  throw new ErreurMetier(verdict.code, verdict.message, statut);
}

export const introuvable = () => new ErreurMetier('INTROUVABLE', 'Réclamation introuvable', 404);
