/**
 * Outils des tests navigateur : comptes du jeu de démonstration, codes TOTP, lecture des messages
 * envoyés (boîte d'envoi de la base jetable), connexion à la console, captures pour la note.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, type Page } from '@playwright/test';
import { Secret, TOTP } from 'otpauth';
import pg from 'pg';

export const CONSOLE = 'http://localhost:4273';
export const portail = (slug = 'alpha') => `http://${slug}.localhost:4274`;
export const MOT_DE_PASSE = 'Makor-Demo-2026';
export const QR_ALPHA = '7K3QX9P2MA';

/** Logo de démonstration (SVG sans script ni lien externe) : un « A » blanc sur fond prune. */
export const LOGO_SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">' +
    '<rect width="96" height="96" rx="22" fill="#7A1F5C"/>' +
    '<path d="M28 72 48 24l20 48M35 56h26" fill="none" stroke="#fff" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>' +
    '</svg>',
);

/** Une petite image PNG valide (1 × 1 pixel) : l'API reconnaît le type au contenu. */
export const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

export const COMPTES = {
  superAdmin: 'koffi.admin@makortelecoms.example',
  admin: 'fatou.diabate@banque-alpha.example',
  superviseur: 'serge.kouadio@banque-alpha.example',
  superviseur2: 'mariam.ouattara@banque-alpha.example',
  agent: 'aya.konan@banque-alpha.example',
  agent2: 'mamadou.traore@banque-alpha.example',
  invitee: 'estelle.gnahore@banque-alpha.example',
} as const;

/* ------------------------------------------------------------------ TOTP */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32(octets: Uint8Array): string {
  let bits = 0;
  let valeur = 0;
  let sortie = '';
  for (const o of octets) {
    valeur = (valeur << 8) | o;
    bits += 8;
    while (bits >= 5) {
      sortie += ALPHABET[(valeur >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) sortie += ALPHABET[(valeur << (5 - bits)) & 31];
  return sortie;
}

/** Secret TOTP d'un compte de démonstration (backend : secretTotpDemo). */
export const secretDemo = (email: string) => base32(createHash('sha256').update(`totp-demo:${email}`).digest().subarray(0, 20));

/**
 * Pas TOTP déjà présentés, gardés dans un fichier : Playwright relance son processus après un test
 * en échec, et un code déjà accepté serait refusé (anti-rejeu). Vidé au début de chaque lancement.
 */
export const FICHIER_PAS = join(tmpdir(), 'reclamations-navigateur-totp.json');
function pasUtilises(): Record<string, number> {
  try {
    return JSON.parse(readFileSync(FICHIER_PAS, 'utf8')) as Record<string, number>;
  } catch {
    return {};
  }
}

/**
 * Code TOTP du moment. L'API refuse un code déjà utilisé (anti-rejeu) : pour un même secret, on
 * attend au besoin le pas de 30 secondes suivant.
 */
export async function codeTotp(secret: string): Promise<string> {
  const pas = () => Math.floor(Date.now() / 30_000);
  const dernier = pasUtilises()[secret];
  if (dernier !== undefined && pas() <= dernier) await new Promise((r) => setTimeout(r, (dernier + 1) * 30_000 - Date.now() + 300));
  writeFileSync(FICHIER_PAS, JSON.stringify({ ...pasUtilises(), [secret]: pas() }));
  return new TOTP({ secret: Secret.fromBase32(secret), digits: 6, period: 30, algorithm: 'SHA1' }).generate();
}

/* ------------------------------------------------------------------ Boîte d'envoi */

function urlBase(): string {
  const brute = process.env.DATABASE_URL;
  if (!brute) throw new Error('DATABASE_URL est nécessaire aux tests navigateur');
  const u = new URL(brute);
  u.pathname = '/reclamations_navigateur';
  u.search = '';
  return u.toString();
}

export async function sql<T extends Record<string, unknown>>(requete: string, valeurs: unknown[] = []): Promise<T[]> {
  const c = new pg.Client({ connectionString: urlBase() });
  await c.connect();
  try {
    return (await c.query<T>(requete, valeurs)).rows;
  } finally {
    await c.end();
  }
}

/** Dernier message envoyé à une adresse ou un numéro, dont le contenu contient `motif`. */
export async function dernierMessage(destination: string, motif: string): Promise<string> {
  for (let essai = 0; essai < 20; essai++) {
    const [ligne] = await sql<{ contenu: string }>(
      'SELECT contenu FROM notification WHERE destination = $1 AND contenu LIKE $2 ORDER BY cree_le DESC LIMIT 1',
      [destination, `%${motif}%`],
    );
    if (ligne) return ligne.contenu;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Aucun message « ${motif} » pour ${destination}`);
}

export async function codeOtpRecu(telephone: string): Promise<string> {
  const texte = await dernierMessage(telephone, 'votre code est');
  return texte.match(/code est (\d{6})/)![1]!;
}

export async function lienRecu(email: string, chemin: '/invitation#jeton=' | '/mot-de-passe#jeton='): Promise<string> {
  const texte = await dernierMessage(email, chemin);
  return texte.match(/https?:\/\/\S+#jeton=[A-Za-z0-9_-]+/)![0]!;
}

/* ------------------------------------------------------------------ Console */

/** Connexion complète : e-mail, mot de passe, code TOTP ; attend la page d'arrivée. */
export async function connecter(page: Page, email: string, secret = secretDemo(email)) {
  await page.goto(`${CONSOLE}/connexion`);
  await page.getByLabel('E-mail professionnel').fill(email);
  await page.getByLabel('Mot de passe', { exact: true }).fill(MOT_DE_PASSE);
  await page.getByRole('button', { name: 'Continuer' }).click();
  await expect(page.getByRole('heading', { name: 'Code de vérification' })).toBeVisible();
  await saisirCode(page, await codeTotp(secret));
  await expect(page).not.toHaveURL(/\/connexion/);
}

export async function saisirCode(page: Page, code: string) {
  await page.getByLabel('Chiffre 1').fill(code);
}

/* ------------------------------------------------------------------ Captures */

const DOSSIER_CAPTURES = resolve(import.meta.dirname, '../../../docs/etape-8-captures');

/** Capture pour la note d'étape, seulement avec CAPTURES=1. */
export async function capture(page: Page, nom: string) {
  if (process.env.CAPTURES !== '1') return;
  mkdirSync(DOSSIER_CAPTURES, { recursive: true });
  await page.waitForLoadState('networkidle').catch(() => undefined);
  // Seul le dernier message affiché reste visible sur la capture. Masqués par le DOM, pas par une
  // feuille de style injectée : la CSP de production (style-src 'self') la refuserait.
  const anciens = (masquer: boolean) =>
    page.evaluate((m) => {
      const messages = [...document.querySelectorAll<HTMLElement>('[data-annonces] > *')].slice(0, -1);
      for (const e of messages) e.style.display = m ? 'none' : '';
    }, masquer);
  await anciens(true);
  await page.screenshot({ path: resolve(DOSSIER_CAPTURES, `${nom}.png`) });
  await anciens(false);
}
