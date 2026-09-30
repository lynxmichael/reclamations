/**
 * Anti-robot du portail public (étape 11) : une preuve de travail, sans service tiers, sans cookie
 * et sans image à déchiffrer.
 *
 * L'API tire un nombre secret n entre 0 et `maximum` et donne au navigateur le sel (qui porte
 * l'heure d'expiration), defi = SHA-256(sel + n) et la signature HMAC du défi. Le navigateur essaie
 * 0, 1, 2… jusqu'à retrouver n : une fraction de seconde pour un visiteur, pendant qu'il remplit le
 * formulaire ; un vrai coût pour qui envoie des milliers de formulaires. Le jeton (sel, nombre,
 * signature) se vérifie sans rien stocker ; il est ensuite marqué utilisé dans Redis, pour qu'il ne
 * serve qu'une fois. C'est le principe d'ALTCHA (mêmes champs : algorithme, défi, sel, signature).
 *
 * La difficulté double par tranche de 10 défis demandés par une même adresse IP en 10 minutes,
 * jusqu'à 16 fois la difficulté de base (ANTI_ROBOT_MAXIMUM, 100 000 par défaut).
 * Si Redis ne répond pas, la difficulté reste celle de base et le jeton n'est pas marqué utilisé :
 * le portail reste ouvert (comme pour les limites de débit).
 */
import { createHash, createHmac, hkdfSync, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { Probleme } from '../contrat/probleme.js';
import type { ServiceRedis } from '../redis/redis.service.js';

export const ALGORITHME = 'SHA-256';
export const DUREE_DEFI_SECONDES = 600;
export const MAXIMUM_PAR_DEFAUT = 100_000;
/** Défis par adresse IP et par fenêtre avant que la difficulté double */
export const DEFIS_PAR_PALIER = 10;
export const FENETRE_SECONDES = 600;
export const MULTIPLICATEUR_MAX = 16;
/** Nombre le plus grand accepté dans un jeton (le maximum de base est borné à 10 millions) */
const NOMBRE_MAX = 10_000_000 * MULTIPLICATEUR_MAX;

export interface Defi {
  readonly algorithme: typeof ALGORITHME;
  readonly defi: string;
  readonly sel: string;
  readonly maximum: number;
  readonly signature: string;
  readonly expireLe: string;
}

export type Verdict =
  | { readonly valide: true; readonly defi: string; readonly expire: number }
  | { readonly valide: false; readonly raison: 'illisible' | 'signature' | 'expire' };

const sha256 = (texte: string): string => createHash('sha256').update(texte).digest('hex');
const signer = (cle: Buffer, defi: string): string => createHmac('sha256', cle).update(defi).digest('hex');
const empreinte = (texte: string): string => createHash('sha256').update(texte).digest('hex').slice(0, 32);

/** Clé HMAC des défis, dérivée du secret des jetons (JWT_SECRET) : aucune variable de plus. */
export function cleAntiRobot(secret: Uint8Array): Buffer {
  return Buffer.from(hkdfSync('sha256', secret, new Uint8Array(0), 'reclamations/anti-robot/v1', 32));
}

/** Difficulté après `n` défis demandés dans la fenêtre : ×1 jusqu'à 10, ×2 jusqu'à 20… ×16 au-delà de 40. */
export function maximumPour(base: number, n: number): number {
  const palier = Math.min(Math.log2(MULTIPLICATEUR_MAX), Math.floor(Math.max(0, n - 1) / DEFIS_PAR_PALIER));
  return base * 2 ** palier;
}

export function creerDefi(cle: Buffer, maximum: number, maintenant: Date): Defi {
  const expire = Math.floor(maintenant.getTime() / 1000) + DUREE_DEFI_SECONDES;
  const sel = `${randomBytes(12).toString('hex')}?expire=${expire}`;
  const defi = sha256(sel + randomInt(0, maximum + 1));
  return { algorithme: ALGORITHME, defi, sel, maximum, signature: signer(cle, defi), expireLe: new Date(expire * 1000).toISOString() };
}

/** Recherche du nombre, comme le fait le navigateur (tests et scripts). */
export function resoudreDefi(d: Pick<Defi, 'defi' | 'sel' | 'maximum'>): number | null {
  for (let n = 0; n <= d.maximum; n++) if (sha256(d.sel + n) === d.defi) return n;
  return null;
}

/** Jeton à envoyer avec le formulaire : base64url du JSON {sel, nombre, signature}. */
export function encoderJeton(d: Pick<Defi, 'sel' | 'signature'>, nombre: number): string {
  return Buffer.from(JSON.stringify({ sel: d.sel, nombre, signature: d.signature })).toString('base64url');
}

/** Vérification sans état : forme, signature, expiration. */
export function verifierJeton(cle: Buffer, jeton: string, maintenant: Date): Verdict {
  let brut: unknown;
  try {
    brut = JSON.parse(Buffer.from(jeton, 'base64url').toString('utf8'));
  } catch {
    return { valide: false, raison: 'illisible' };
  }
  const { sel, nombre, signature } = (brut && typeof brut === 'object' ? brut : {}) as Record<string, unknown>;
  const forme = typeof sel === 'string' ? /^[0-9a-f]{24}\?expire=(\d{10})$/.exec(sel) : null;
  if (!forme || typeof signature !== 'string' || !/^[0-9a-f]{64}$/.test(signature)
    || typeof nombre !== 'number' || !Number.isSafeInteger(nombre) || nombre < 0 || nombre > NOMBRE_MAX) {
    return { valide: false, raison: 'illisible' };
  }
  const defi = sha256(`${sel as string}${nombre}`);
  if (!timingSafeEqual(Buffer.from(signer(cle, defi), 'hex'), Buffer.from(signature, 'hex'))) return { valide: false, raison: 'signature' };
  const expire = Number(forme[1]);
  if (expire * 1000 < maintenant.getTime()) return { valide: false, raison: 'expire' };
  return { valide: true, defi, expire };
}

const MESSAGES = {
  illisible: 'La vérification anti-robot a échoué : rechargez la page, puis réessayez',
  signature: 'La vérification anti-robot a échoué : rechargez la page, puis réessayez',
  expire: 'La vérification anti-robot a expiré : réessayez',
  utilise: 'Cette vérification anti-robot a déjà servi : réessayez',
} as const;

const refus = (raison: keyof typeof MESSAGES) => new Probleme(422, 'ANTI_ROBOT_REFUSE', MESSAGES[raison]);

export class AntiRobot {
  private readonly journal = new Logger('AntiRobot');
  private readonly cle: Buffer;

  constructor(
    private readonly redis: ServiceRedis,
    secret: Uint8Array,
    private readonly maximumBase: number,
    private readonly horloge: () => Date = () => new Date(),
  ) {
    this.cle = cleAntiRobot(secret);
  }

  /** Nouveau défi, plus difficile si cette adresse IP en demande beaucoup. */
  async defi(ip: string): Promise<Defi> {
    let n = 0;
    try {
      const k = `anti-robot:defis:${empreinte(ip)}`;
      const r = await this.redis.client.multi().incr(k).expire(k, FENETRE_SECONDES, 'NX').exec();
      n = Number(r?.[0]?.[1] ?? 0);
    } catch (e) {
      this.journal.warn(`Difficulté de base (Redis) : ${(e as Error).message}`);
    }
    return creerDefi(this.cle, maximumPour(this.maximumBase, n), this.horloge());
  }

  /** Vérifie le jeton sans le consommer ; 422 ANTI_ROBOT_REFUSE s'il est faux ou expiré. Rend le défi. */
  verifier(jeton: string | undefined): string {
    const v = verifierJeton(this.cle, jeton ?? '', this.horloge());
    if (!v.valide) throw refus(v.raison);
    return v.defi;
  }

  /** Marque le défi comme utilisé ; 422 s'il l'était déjà. */
  async consommer(defi: string): Promise<void> {
    let pose: string | null;
    try {
      pose = await this.redis.client.set(`anti-robot:utilise:${defi}`, '1', 'EX', DUREE_DEFI_SECONDES + 60, 'NX');
    } catch (e) {
      this.journal.warn(`Usage unique non vérifié (Redis) : ${(e as Error).message}`);
      return;
    }
    if (!pose) throw refus('utilise');
  }

  /** Vérifie puis consomme (demande de code, par exemple). */
  async exiger(jeton: string | undefined): Promise<void> {
    await this.consommer(this.verifier(jeton));
  }
}
