/**
 * Normalisation des coordonnées d'un client final : c'est ce qui permet de le reconnaître
 * d'un dépôt à l'autre dans sa banque (décision D3), et ce que la base exige (CHECK).
 */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const E164 = /^\+[1-9][0-9]{7,14}$/;

export function normaliserEmail(brut: string | null | undefined): string | null {
  const email = brut?.trim().toLowerCase();
  if (!email) return null;
  if (!EMAIL.test(email)) throw new Error(`Adresse e-mail invalide : ${brut}`);
  return email;
}

/**
 * Numéro au format E.164. Un numéro ivoirien à 10 chiffres (07 00 00 00 01) reçoit
 * l'indicatif +225 ; les séparateurs (espaces, points, tirets) sont retirés.
 */
export function normaliserTelephone(brut: string | null | undefined, indicatifParDefaut = '+225'): string | null {
  const nettoye = brut?.replace(/[\s.\-()]/g, '');
  if (!nettoye) return null;
  let numero = nettoye.startsWith('00') ? `+${nettoye.slice(2)}` : nettoye;
  if (!numero.startsWith('+') && /^0[0-9]{9}$/.test(numero)) numero = `${indicatifParDefaut}${numero}`;
  if (!E164.test(numero)) throw new Error(`Numéro de téléphone invalide : ${brut}`);
  return numero;
}
