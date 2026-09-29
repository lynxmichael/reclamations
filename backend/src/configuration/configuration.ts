/**
 * Configuration de l'API et du worker, lue une fois au démarrage dans les variables d'environnement.
 *
 * Une variable manquante ou invalide arrête le démarrage avec un message clair. En production,
 * les secrets de développement (valeurs de .env.example) sont refusés.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface Configuration {
  readonly production: boolean;
  readonly version: string;
  readonly port: number;
  /** Adresses des proxys de confiance (Caddy) pour lire la vraie adresse IP du client */
  readonly trustProxy: string;
  readonly baseDeDonneesUrl: string;
  readonly redisUrl: string;
  /** Secret de signature des jetons d'accès (HS256) */
  readonly secretJwt: Uint8Array;
  /** Clé AES-256-GCM des secrets TOTP (32 octets) */
  readonly cleTotp: Buffer;
  /** Clé HMAC des codes OTP */
  readonly cleOtp: Buffer;
  readonly domaine: string;
  /** Modèle d'adresse d'un portail, {slug} remplacé : https://{slug}.reclamations.example */
  readonly modeleUrlPortail: string;
  /** Adresse de la console du personnel : https://console.reclamations.example */
  readonly urlConsole: string;
  /** Cookie du refresh token marqué Secure (désactivable en développement HTTP seulement) */
  readonly cookieSecure: boolean;
  readonly stockageDossier: string;
  readonly contratChemin: string;
  readonly smtpUrl: string;
  readonly emailExpediteur: string;
  readonly smsMode: 'journal';
  /** Valide chaque réponse contre le contrat et journalise les écarts (développement) */
  readonly validerReponses: boolean;
}

const SECRETS_DE_DEVELOPPEMENT = [
  'developpement-uniquement-changer-en-production-0123456789',
  'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=',
  'developpement-uniquement-cle-otp-0123456789abcdef',
];

class ErreurConfiguration extends Error {
  constructor(erreurs: string[]) {
    super(`Configuration invalide :\n  - ${erreurs.join('\n  - ')}`);
    this.name = 'ErreurConfiguration';
  }
}

export function lireConfiguration(env: NodeJS.ProcessEnv = process.env): Configuration {
  const erreurs: string[] = [];
  const production = env.NODE_ENV === 'production';

  const requise = (nom: string): string => {
    const v = env[nom]?.trim();
    if (!v) erreurs.push(`${nom} est obligatoire`);
    return v ?? '';
  };
  const secret = (nom: string, longueurMin: number): string => {
    const v = requise(nom);
    if (v && v.length < longueurMin) erreurs.push(`${nom} doit faire au moins ${longueurMin} caractères`);
    if (v && production && SECRETS_DE_DEVELOPPEMENT.includes(v)) erreurs.push(`${nom} a la valeur de développement : interdit en production`);
    return v;
  };
  const booleen = (nom: string, defaut: boolean): boolean => {
    const v = env[nom]?.trim().toLowerCase();
    if (!v) return defaut;
    if (['1', 'true', 'oui'].includes(v)) return true;
    if (['0', 'false', 'non'].includes(v)) return false;
    erreurs.push(`${nom} doit valoir true ou false`);
    return defaut;
  };

  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) erreurs.push('PORT invalide');

  const cleTotpTexte = secret('CLE_CHIFFREMENT_TOTP', 32);
  let cleTotp = Buffer.alloc(0);
  if (cleTotpTexte) {
    cleTotp = /^[0-9a-f]{64}$/i.test(cleTotpTexte) ? Buffer.from(cleTotpTexte, 'hex') : Buffer.from(cleTotpTexte, 'base64');
    if (cleTotp.length !== 32) erreurs.push('CLE_CHIFFREMENT_TOTP doit faire 32 octets (64 caractères hexadécimaux ou base64)');
  }

  const domaine = env.DOMAINE_PLATEFORME?.trim() || 'reclamations.example';
  const modeleUrlPortail = env.URL_PORTAIL?.trim() || `https://{slug}.${domaine}`;
  if (!modeleUrlPortail.includes('{slug}')) erreurs.push('URL_PORTAIL doit contenir {slug}');
  const urlConsole = (env.URL_CONSOLE?.trim() || `https://console.${domaine}`).replace(/\/+$/, '');
  const cookieSecure = booleen('COOKIE_SECURE', true);
  if (production && !cookieSecure) erreurs.push('COOKIE_SECURE=false est interdit en production');

  const contratChemin = resolve(env.CONTRAT_CHEMIN?.trim() || resolve(process.cwd(), '../contrat/openapi.yaml'));

  const config: Configuration = {
    production,
    version: lireVersion(),
    port,
    trustProxy: env.TRUST_PROXY?.trim() || 'loopback, linklocal, uniquelocal',
    baseDeDonneesUrl: requise('APP_DATABASE_URL'),
    redisUrl: requise('REDIS_URL'),
    secretJwt: new TextEncoder().encode(secret('JWT_SECRET', 32)),
    cleTotp,
    cleOtp: Buffer.from(secret('CLE_OTP', 32)),
    domaine,
    modeleUrlPortail: modeleUrlPortail.replace(/\/+$/, ''),
    urlConsole,
    cookieSecure,
    stockageDossier: resolve(env.STOCKAGE_DOSSIER?.trim() || resolve(process.cwd(), 'var/fichiers')),
    contratChemin,
    smtpUrl: env.SMTP_URL?.trim() || 'smtp://localhost:1025',
    emailExpediteur: env.EMAIL_EXPEDITEUR?.trim() || `Réclamations <no-reply@${domaine}>`,
    smsMode: 'journal',
    validerReponses: booleen('VALIDER_REPONSES', !production),
  };
  if (env.SMS_MODE && env.SMS_MODE !== 'journal') {
    erreurs.push('SMS_MODE : seul « journal » existe à l\'étape 7 (la passerelle Makor arrive à l\'étape 9)');
  }
  if (erreurs.length) throw new ErreurConfiguration(erreurs);
  return config;
}

function lireVersion(): string {
  try {
    const paquet = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf8')) as { version?: string };
    if (paquet.version) return paquet.version;
  } catch {
    // dist/src/configuration : un niveau de plus
  }
  try {
    return (JSON.parse(readFileSync(resolve(__dirname, '../../../package.json'), 'utf8')) as { version: string }).version;
  } catch {
    return '0.0.0';
  }
}

/** Adresse publique d'un portail de banque. */
export function urlPortail(config: Configuration, slug: string): string {
  return config.modeleUrlPortail.replace('{slug}', slug);
}

export const CONFIGURATION = Symbol('CONFIGURATION');
