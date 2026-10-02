/**
 * Enquête de satisfaction après la clôture (étape 15, décision I9 de l'étape 14) : règles pures,
 * partagées par l'API, le worker et la démo cliquable.
 *
 * - une enquête par réclamation, ouverte à la clôture confirmée par le client ou automatique
 *   (jamais à une clôture forcée : doublon, abandon, réclamation hors sujet) ;
 * - ouverte 7 jours ; une seule réponse, qui ne se modifie plus ;
 * - deux questions : satisfaction sur le traitement (CSAT, 1 à 5) et recommandation de la
 *   banque (NPS, 0 à 10), plus un commentaire facultatif.
 */

export const DUREE_ENQUETE_JOURS = 7;
export const LONGUEUR_COMMENTAIRE = 1000;

export type EtatAvis = 'A_DONNER' | 'DONNE' | 'TERMINE';
export type ModeClotureAvecEnquete = 'CONFIRMATION_CLIENT' | 'AUTOMATIQUE' | 'FORCEE';

/** Une clôture forcée n'ouvre pas d'enquête : elle ne conclut pas un traitement. */
export function clotureAvecEnquete(mode: ModeClotureAvecEnquete): boolean {
  return mode !== 'FORCEE';
}

/** Fin de l'enquête : 7 jours après son ouverture. */
export function finEnquete(ouverture: Date): Date {
  return new Date(ouverture.getTime() + DUREE_ENQUETE_JOURS * 24 * 3600 * 1000);
}

/** Une réponse est acceptée jusqu'à la fin de l'enquête incluse. */
export function etatAvis(e: { reponduLe: Date | null; expireLe: Date }, maintenant: Date): EtatAvis {
  if (e.reponduLe) return 'DONNE';
  return maintenant > e.expireLe ? 'TERMINE' : 'A_DONNER';
}

export interface ReponseAvis {
  readonly note: number;
  readonly recommandation: number;
  readonly commentaire: string | null;
}

/**
 * Réponse normalisée, ou la raison du refus. Le contrat borne déjà les notes ; on revérifie ici
 * pour la démo et pour un appel direct. Commentaire vide ou blanc : absent.
 */
export function normaliserReponse(r: { note: number; recommandation: number; commentaire?: string | null }): ReponseAvis | string {
  if (!Number.isInteger(r.note) || r.note < 1 || r.note > 5) return 'La note va de 1 à 5';
  if (!Number.isInteger(r.recommandation) || r.recommandation < 0 || r.recommandation > 10) return 'La recommandation va de 0 à 10';
  const commentaire = r.commentaire?.trim() || null;
  if (commentaire && commentaire.length > LONGUEUR_COMMENTAIRE) return `Le commentaire fait ${LONGUEUR_COMMENTAIRE} caractères au plus`;
  return { note: r.note, recommandation: r.recommandation, commentaire };
}

export type CategorieNps = 'PROMOTEUR' | 'PASSIF' | 'DETRACTEUR';

/** 9 et 10 : promoteur ; 7 et 8 : passif ; 0 à 6 : détracteur. */
export function categorieNps(recommandation: number): CategorieNps {
  return recommandation >= 9 ? 'PROMOTEUR' : recommandation >= 7 ? 'PASSIF' : 'DETRACTEUR';
}

/** Une note de 4 ou 5 compte comme « satisfait » (CSAT). */
export const estSatisfait = (note: number) => note >= 4;

/** NPS de -100 à 100, arrondi ; null sans réponse. */
export function nps(promoteurs: number, detracteurs: number, reponses: number): number | null {
  return reponses > 0 ? Math.round((100 * (promoteurs - detracteurs)) / reponses) : null;
}

export interface BilanAvis {
  readonly reponses: number;
  readonly satisfaits: number;
  readonly promoteurs: number;
  readonly passifs: number;
  readonly detracteurs: number;
  readonly sommeNotes: number;
}

/** Bilan d'une liste de réponses (démo et tests ; l'API calcule le même en SQL). */
export function bilanAvis(reponses: readonly { note: number; recommandation: number }[]): BilanAvis {
  let satisfaits = 0, promoteurs = 0, passifs = 0, detracteurs = 0, sommeNotes = 0;
  for (const r of reponses) {
    sommeNotes += r.note;
    if (estSatisfait(r.note)) satisfaits++;
    const c = categorieNps(r.recommandation);
    if (c === 'PROMOTEUR') promoteurs++;
    else if (c === 'PASSIF') passifs++;
    else detracteurs++;
  }
  return { reponses: reponses.length, satisfaits, promoteurs, passifs, detracteurs, sommeNotes };
}
