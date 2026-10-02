/**
 * Escalade à plusieurs niveaux (étape 16, décision I10 de l'étape 14).
 *
 *   75 % du délai cible   alerte préventive à l'agent (inchangé, étape 4)
 *   100 %                 dépassement : escalade au superviseur (inchangé)
 *   seuil de second niveau, par exemple 150 % : l'Admin Entreprise est prévenu
 *
 * Le seuil se règle pour la banque et, au besoin, pour une catégorie ; une réclamation urgente a
 * son propre seuil. Il se compte en minutes ouvrées après l'échéance, comme le retard affiché sur
 * la fiche : à 150 %, la moitié du délai cible après l'échéance.
 */
import { ajouterMinutesOuvrees, type CalendrierNormalise } from '../temps-ouvre/calendrier.js';

export interface SeuilsEscalade {
  /** Pourcentage du délai cible ; vide : pas de second niveau */
  readonly pourcent: number | null;
  /** Le même, pour une réclamation urgente ; vide : le seuil normal */
  readonly urgentPourcent: number | null;
}

/** Seuil applicable : celui de la catégorie, sinon celui de la banque ; null, pas de second niveau. */
export function seuilEscaladeAdmin(priorite: 'NORMALE' | 'URGENTE', categorie: SeuilsEscalade, banque: SeuilsEscalade): number | null {
  if (priorite === 'URGENTE') {
    return categorie.urgentPourcent ?? banque.urgentPourcent ?? categorie.pourcent ?? banque.pourcent;
  }
  return categorie.pourcent ?? banque.pourcent;
}

/** Instant du second niveau : l'échéance, plus (seuil − 100) % du délai cible, en minutes ouvrées. */
export function instantEscaladeAdmin(echeance: Date, delaiCibleMinutes: number, seuilPourcent: number, cal: CalendrierNormalise): Date {
  return ajouterMinutesOuvrees(echeance, Math.ceil((delaiCibleMinutes * (seuilPourcent - 100)) / 100), cal);
}
