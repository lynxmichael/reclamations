/**
 * Ce que l'IA ne doit jamais écrire (étape 18, décision I4 de l'étape 14) : promettre un
 * remboursement ou un délai, annoncer un statut, donner un conseil financier, demander un code
 * secret. Vérifié sur chaque brouillon proposé à un agent (l'agent voit les alertes et décide),
 * sur chaque réponse de la base de la banque (avertissement à l'Admin Entreprise) et sur les
 * textes de l'assistant du portail (tests).
 *
 * Et ce que le client peut écrire pour parler à un humain (décision I3) : « conseiller »,
 * « agent », « humain »… avec les fautes de frappe courantes.
 */
import { aplatir } from './texte.js';

export type CodeInterdit = 'REMBOURSEMENT_PROMIS' | 'DELAI_PROMIS' | 'STATUT_ANNONCE' | 'CONSEIL_FINANCIER' | 'CODE_SECRET_DEMANDE';

export interface Alerte {
  readonly code: CodeInterdit;
  /** Les mots en cause, tels qu'écrits */
  readonly extrait: string;
}

export const LIBELLE_INTERDIT: Record<CodeInterdit, string> = {
  REMBOURSEMENT_PROMIS: 'promet un remboursement',
  DELAI_PROMIS: 'promet un délai',
  STATUT_ANNONCE: 'annonce un statut de la réclamation',
  CONSEIL_FINANCIER: 'donne un conseil financier',
  CODE_SECRET_DEMANDE: 'demande un code secret ou un mot de passe',
};

const DUREE = '(?:\\d+|un|une|deux|trois|quatre|cinq|six|sept|huit|dix|quinze|vingt|trente|quelques|48|72|24)\\s*(?:h\\b|heures?|jours?|semaines?|mois|minutes?)';

const REGLES: readonly { code: CodeInterdit; motif: RegExp }[] = [
  { code: 'REMBOURSEMENT_PROMIS', motif: /\b(?:vous (?:serez|allez etre|seriez)|nous (?:allons|vous) (?:vous )?|on va vous )\s*(?:integralement |bien |rapidement )?(?:rembours|recredit|restitu)\w*/ },
  { code: 'REMBOURSEMENT_PROMIS', motif: /\b(?:remboursement|recredit\w*|restitution)\s+(?:est|sera|serait)\s+(?:garanti|assure|effectue|fait|certain|automatique)\w*/ },
  { code: 'REMBOURSEMENT_PROMIS', motif: /\b(?:nous (?:vous )?garantissons|je vous garantis|garanti)\b[^.!?]{0,40}\brembours\w*/ },
  { code: 'REMBOURSEMENT_PROMIS', motif: /\bvotre argent (?:vous )?sera (?:rendu|restitue|recredite|reverse)\b/ },
  { code: 'DELAI_PROMIS', motif: new RegExp(`\\b(?:sous|dans|d'ici|avant|en moins de|au plus tard dans)\\s+(?:les |un delai de )?${DUREE}`) },
  { code: 'DELAI_PROMIS', motif: /\b(?:d'ici|avant|au plus tard|des) (?:demain|ce soir|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|la fin (?:de la |du )?(?:journee|semaine|mois))\b/ },
  { code: 'DELAI_PROMIS', motif: /\b(?:demain|aujourd'hui) (?:sans faute|au plus tard|c'est sur|garanti)\b/ },
  { code: 'STATUT_ANNONCE', motif: /\b(?:votre|la|cette) (?:reclamation|plainte|dossier|demande) (?:est|a ete|sera) (?:resolue?|cloturee?|fermee?|classee?|reglee?|annulee?|acceptee?|validee?)\b/ },
  { code: 'STATUT_ANNONCE', motif: /\bje (?:cloture|ferme|resous|classe|annule)\b/ },
  { code: 'CONSEIL_FINANCIER', motif: /\b(?:je vous (?:conseille|recommande|suggere)|vous devriez|il (?:vous )?faut|mieux vaut)\s+(?:de |d')?(?:investir|placer|acheter|vendre|emprunter|souscrire|epargner|miser|transferer votre epargne)/ },
  { code: 'CONSEIL_FINANCIER', motif: /\b(?:bon|meilleur) (?:placement|investissement)\b|\b(?:investissez|placez votre argent|achetez des (?:actions|cryptos?))\b/ },
  { code: 'CODE_SECRET_DEMANDE', motif: /\b(?:communiquez|donnez|envoyez|indiquez|transmettez|confirmez|precisez|ecrivez|tapez|saisissez|rappelez|communiquer|donner|envoyer|indiquer|transmettre|confirmer|preciser|ecrire|saisir)(?:-?(?:nous|moi))?\b[^.!?]{0,60}\b(?:code (?:secret|pin|confidentiel|otp|de validation|recu par sms)|mot de passe|mdp|cvv|cvc|cryptogramme|code a 4 chiffres)/ },
  { code: 'CODE_SECRET_DEMANDE', motif: /\b(?:quel est|c'est quoi) (?:votre|ton) (?:code (?:secret|pin)|mot de passe)\b/ },
];

/** Les interdits présents dans un texte (vide : rien à signaler). */
export function verifierInterdits(texte: string): Alerte[] {
  const alertes: Alerte[] = [];
  // Phrase par phrase : une consigne à la forme négative (« ne communiquez jamais votre code ») n'est pas une demande
  for (const phrase of aplatir(texte).split(/(?<=[.!?;])\s+/)) {
    const negative = /\b(?:ne|n')\b|\bjamais\b|\ben aucun cas\b/.test(phrase);
    for (const r of REGLES) {
      if (negative && NEGATION_POSSIBLE.has(r.code)) continue;
      const m = r.motif.exec(phrase);
      if (m && !alertes.some((a) => a.code === r.code)) alertes.push({ code: r.code, extrait: m[0] });
    }
  }
  return alertes;
}

/** Interdits qu'une négation renverse : « ne communiquez jamais votre code », « je ne vous conseille pas d'investir ». */
const NEGATION_POSSIBLE: ReadonlySet<CodeInterdit> = new Set(['CODE_SECRET_DEMANDE', 'CONSEIL_FINANCIER']);

/** Le client demande à parler à un humain (décision I3), fautes courantes comprises. */
export function demandeHumain(texte: string): boolean {
  const t = aplatir(texte);
  // « conseiller », « conseiler », « conseillère » ; « un conseillé » (mais pas « je vous conseille », ni « un conseil »)
  return /\bconseill?(?:er|ere|eres|ers)\b/.test(t)
    || /\b(?:un|une|le|la|au|a un|mon|ma|votre) conseill?ee?\b/.test(t)
    || /\bagents?\b/.test(t)
    || /\b(?:humain|operateur|operatrice|gestionnaire)\b/.test(t)
    || /\bparler (?:a|avec) (?:quelqu.?un|qqn|qq1|une personne|un vrai|une vraie|quelqu'un de la banque|la banque|vous)\b/.test(t)
    || /\b(?:vraie?|vrai) personne\b/.test(t)
    || /\b(?:service client|appelez[- ]moi|rappelez[- ]moi|me rappeler)\b/.test(t);
}
