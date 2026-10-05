/**
 * Masquage avant tout envoi à un fournisseur d'IA (étape 18, décision I5 de l'étape 14).
 *
 * Remplacés par une étiquette : e-mails, IBAN et RIB, numéros de carte (entiers ou déjà masqués),
 * téléphones, tout autre numéro de 8 chiffres ou plus (compte, contrat) et un code secret écrit
 * après « code », « PIN », « mot de passe », « CVV » ou « OTP ». Les montants (« 15 000 000 FCFA »),
 * les dates et les numéros de réclamation (« ALP-2026-000042 ») restent : ils aident à comprendre.
 * Le nom du client n'est jamais transmis : quand on le connaît (brouillon pour un agent), chacun de
 * ses mots écrits dans un message est remplacé par [NOM].
 */

export type Masque = 'EMAIL' | 'IBAN' | 'CARTE' | 'TELEPHONE' | 'NUMERO' | 'CODE' | 'NOM';

export interface Masquage {
  readonly texte: string;
  readonly masques: Readonly<Partial<Record<Masque, number>>>;
  /** Le client a écrit un code secret : l'assistant lui rappelle de ne jamais le communiquer */
  readonly codeSecret: boolean;
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
/** IBAN (CI93 CI00 8011 1234 …) : 2 lettres, 2 chiffres, puis des groupes de 4 qui ont chacun un chiffre ; 8 chiffres au moins */
const IBAN = /\b[A-Za-z]{2}\d{2}(?:[ -]?(?=[A-Za-z0-9]{0,3}\d)[A-Za-z0-9]{4}){2,7}(?:[ -]?(?=[A-Za-z]{0,3}\d)[A-Za-z0-9]{1,4})?\b/g;
/** Code écrit après son nom : « code secret 1234 », « mon pin c'est 0000 », « mdp : azerty12 » */
const CODE = /\b(code(?:\s+(?:secret|pin|confidentiel|de validation|otp|re[çc]u(?: par sms)?|de (?:la|ma) carte))?|pin|mot de passe|mdp|cvv|cvc|cryptogramme|otp)((?:\s*(?:est|:|=|c'est|cest|c est|->|=>))?\s*)([A-Za-z0-9]{3,12})\b/gi;
/** Carte : 13 à 19 chiffres, groupés ou non ; ou une carte déjà masquée (4123 45XX XXXX 1234) */
const CARTE = /\b(?:\d[ -]?){12,18}\d\b|\b\d{4}[ -]?(?:[\dXx*]{4}[ -]?){2}\d{4}\b/g;
/** Téléphone avec indicatif : +225 suivi de 10 chiffres, ou tout autre numéro international */
const TELEPHONE_INTERNATIONAL = /(?:\+|\b00)(?:225[\s.-]?(?:\d[\s.-]?){9}\d|\d{1,3}(?:[\s.-]?\d){7,12})\b/g;
/** Téléphone ivoirien à 10 chiffres : 01, 05, 07 (mobiles), 21, 25, 27 (fixes) */
const TELEPHONE = /\b(?:0[157]|2[157])(?:[\s.-]?\d{2}){4}\b/g;
/** Tout autre numéro de 8 chiffres ou plus, sauf un montant ou un numéro de réclamation */
const NUMERO = /(?<![A-Za-z]{2,10}-)\b\d(?:[ .-]?\d){7,}\b(?!\s*(?:f\b|fcfa|f cfa|cfa|xof|francs?\b|%))/gi;

const echapper = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const sansAccents = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/** Mots d'un nom de 3 lettres au moins, avec et sans accents (« Gnahoré », « Gnahore »). */
function motifNoms(noms: readonly string[]): RegExp | null {
  const mots = new Set<string>();
  for (const n of noms) {
    for (const m of n.split(/[\s'’-]+/)) {
      if (m.length < 3) continue;
      mots.add(echapper(m));
      mots.add(echapper(sansAccents(m)));
    }
  }
  return mots.size ? new RegExp(`(?<![\\p{L}\\d])(?:${[...mots].sort((a, b) => b.length - a.length).join('|')})(?![\\p{L}\\d])`, 'giu') : null;
}

export function masquer(brut: string, o: { noms?: readonly string[] } = {}): Masquage {
  const masques: Partial<Record<Masque, number>> = {};
  const compter = (m: Masque) => {
    masques[m] = (masques[m] ?? 0) + 1;
    return `[${m}]`;
  };
  let codeSecret = false;
  let texte = brut.replace(EMAIL, () => compter('EMAIL'));
  texte = texte.replace(IBAN, (m) => ((m.match(/\d/g) ?? []).length >= 8 ? compter('IBAN') : m));
  texte = texte.replace(CODE, (m, nom: string, liaison: string, valeur: string) => {
    if (!/\d/.test(valeur)) return m;
    codeSecret = true;
    return `${nom}${liaison}${compter('CODE')}`;
  });
  texte = texte.replace(TELEPHONE_INTERNATIONAL, () => compter('TELEPHONE'));
  texte = texte.replace(CARTE, () => compter('CARTE'));
  texte = texte.replace(TELEPHONE, () => compter('TELEPHONE'));
  texte = texte.replace(NUMERO, () => compter('NUMERO'));
  const noms = motifNoms(o.noms ?? []);
  if (noms) texte = texte.replace(noms, () => compter('NOM'));
  return { texte, masques, codeSecret };
}

/** Le client semble confier un code secret, même sans chiffres reconnus (« je vous donne mon code »). */
export function mentionneCodeSecret(texte: string): boolean {
  return /\b(code (secret|pin|confidentiel)|mon pin|mot de passe|mdp|cvv|cryptogramme)\b/i.test(texte)
    && /\b(voici|c'?est|est|donne|envoie|:)\b/i.test(texte);
}
