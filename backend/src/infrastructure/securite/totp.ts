/**
 * Double authentification du personnel (TOTP, RFC 6238 : 6 chiffres, 30 s, SHA-1 — le réglage lu
 * par toutes les applications d'authentification). Le secret est chiffré en AES-256-GCM avec une
 * clé hors base (CLE_CHIFFREMENT_TOTP) ; un même code ne sert qu'une fois.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { Secret, TOTP } from 'otpauth';
import { toDataURL } from 'qrcode';

const EMETTEUR = 'Réclamations Makor';
const VERSION = 'v1';

export function chiffrer(cle: Buffer, texte: string): string {
  const iv = randomBytes(12);
  const chiffreur = createCipheriv('aes-256-gcm', cle, iv);
  const chiffre = Buffer.concat([chiffreur.update(texte, 'utf8'), chiffreur.final()]);
  return [VERSION, iv.toString('base64url'), chiffreur.getAuthTag().toString('base64url'), chiffre.toString('base64url')].join(':');
}

export function dechiffrer(cle: Buffer, valeur: string): string {
  const [version, iv, tag, chiffre] = valeur.split(':');
  if (version !== VERSION || !iv || !tag || !chiffre) throw new Error('Secret TOTP illisible');
  const d = createDecipheriv('aes-256-gcm', cle, Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(chiffre, 'base64url')), d.final()]).toString('utf8');
}

function totp(secretBase32: string, compte: string) {
  return new TOTP({ issuer: EMETTEUR, label: compte, algorithm: 'SHA1', digits: 6, period: 30, secret: Secret.fromBase32(secretBase32) });
}

export function nouveauSecret(): string {
  return new Secret({ size: 20 }).base32;
}

export async function enrolement(secretBase32: string, compte: string) {
  const otpauthUrl = totp(secretBase32, compte).toString();
  return { otpauthUrl, secret: secretBase32, qrCodeDataUrl: await toDataURL(otpauthUrl, { errorCorrectionLevel: 'M', margin: 2, width: 240 }) };
}

/**
 * Pas de temps du code s'il est valide (fenêtre d'un pas avant et après, pour la dérive des
 * horloges), sinon null. Le pas sert à refuser qu'un même code soit rejoué.
 */
export function pasDuCode(secretBase32: string, code: string, maintenant: Date): number | null {
  const t = totp(secretBase32, 'verification');
  const delta = t.validate({ token: code, timestamp: maintenant.getTime(), window: 1 });
  if (delta === null) return null;
  return Math.floor(maintenant.getTime() / 1000 / 30) + delta;
}

/** Code courant (outil de développement et tests). */
export function codeCourant(secretBase32: string, maintenant = new Date()): string {
  return totp(secretBase32, 'outil').generate({ timestamp: maintenant.getTime() });
}

/** Clé Redis de l'anti-rejeu : un code (pas de temps) déjà accepté pour ce secret. */
export function cleAntiRejeu(utilisateurId: string, secretBase32: string, pas: number): string {
  return `totp:${utilisateurId}:${createHash('sha256').update(secretBase32).digest('hex').slice(0, 8)}:${pas}`;
}
