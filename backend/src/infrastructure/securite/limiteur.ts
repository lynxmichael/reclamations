/**
 * Limites de débit (Redis, fenêtre fixe) : dépôt 5/h par adresse IP et 3/h par téléphone,
 * code OTP 3/h par réclamation, 10 échecs de connexion par quart d'heure et par adresse IP, pages publiques,
 * 30 messages du client par réclamation et par 10 minutes (chat, étape 17).
 * Si Redis ne répond pas, la requête passe (le service reste disponible) et l'incident est journalisé.
 */
import { createHash } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { tropDeRequetes } from '../contrat/probleme.js';
import type { ServiceRedis } from '../redis/redis.service.js';

export interface Limite {
  readonly nom: string;
  readonly max: number;
  readonly fenetreSecondes: number;
}

export const LIMITES = {
  depotParIp: { nom: 'depot-ip', max: 5, fenetreSecondes: 3600 },
  depotParTelephone: { nom: 'depot-tel', max: 3, fenetreSecondes: 3600 },
  otpParReclamation: { nom: 'otp', max: 3, fenetreSecondes: 3600 },
  /** Échecs seulement : le personnel d'une agence partage souvent la même adresse IP publique */
  echecsConnexionParIp: { nom: 'connexion-ip', max: 10, fenetreSecondes: 900 },
  motDePasseOublieParIp: { nom: 'oubli-ip', max: 5, fenetreSecondes: 3600 },
  publicParIp: { nom: 'public-ip', max: 120, fenetreSecondes: 60 },
  messagesClient: { nom: 'message-client', max: 30, fenetreSecondes: 600 },
} as const satisfies Record<string, Limite>;

export class Limiteur {
  private readonly journal = new Logger('Limiteur');

  constructor(private readonly redis: ServiceRedis) {}

  /** Compte une occurrence ; au-delà du maximum, 429 TROP_DE_REQUETES avec Retry-After. */
  async consommer(limite: Limite, cle: string, message?: string): Promise<void> {
    const k = `limite:${limite.nom}:${createHash('sha256').update(cle).digest('hex').slice(0, 32)}`;
    let n: number;
    let ttl: number;
    try {
      const r = await this.redis.client.multi().incr(k).expire(k, limite.fenetreSecondes, 'NX').ttl(k).exec();
      n = Number(r?.[0]?.[1] ?? 0);
      ttl = Number(r?.[2]?.[1] ?? limite.fenetreSecondes);
    } catch (e) {
      this.journal.warn(`Limite ${limite.nom} non appliquée (Redis) : ${(e as Error).message}`);
      return;
    }
    if (n > limite.max) throw tropDeRequetes(ttl > 0 ? ttl : limite.fenetreSecondes, message);
  }

  /** Refuse si le compteur a déjà atteint le maximum, sans le faire avancer. */
  async exigerSousLimite(limite: Limite, cle: string, message?: string): Promise<void> {
    const k = `limite:${limite.nom}:${createHash('sha256').update(cle).digest('hex').slice(0, 32)}`;
    try {
      const [n, ttl] = await Promise.all([this.redis.client.get(k), this.redis.client.ttl(k)]);
      if (Number(n ?? 0) >= limite.max) throw tropDeRequetes(ttl > 0 ? ttl : limite.fenetreSecondes, message);
    } catch (e) {
      if ((e as { status?: number }).status === 429) throw e;
      this.journal.warn(`Limite ${limite.nom} non vérifiée (Redis) : ${(e as Error).message}`);
    }
  }

  /** Compte une occurrence sans refuser (les échecs de connexion, par exemple). */
  async compter(limite: Limite, cle: string): Promise<void> {
    const k = `limite:${limite.nom}:${createHash('sha256').update(cle).digest('hex').slice(0, 32)}`;
    await this.redis.client.multi().incr(k).expire(k, limite.fenetreSecondes, 'NX').exec().catch(() => undefined);
  }

  /** Remet un compteur à zéro (connexion réussie, par exemple). */
  async effacer(limite: Limite, cle: string): Promise<void> {
    const k = `limite:${limite.nom}:${createHash('sha256').update(cle).digest('hex').slice(0, 32)}`;
    await this.redis.client.del(k).catch(() => undefined);
  }
}
