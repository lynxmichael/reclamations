/**
 * Dépôt idempotent (décision C9) : la même clé Idempotency-Key, avec la même requête, renvoie le
 * même accusé pendant 24 h sans créer de doublon. La même clé avec une autre requête, ou une
 * requête encore en cours, donne 409 CONFLIT_IDEMPOTENCE.
 */
import { Logger } from '@nestjs/common';
import { Probleme } from '../contrat/probleme.js';
import type { ServiceRedis } from '../redis/redis.service.js';

const DUREE_RESULTAT = 24 * 3600;
const DUREE_EN_COURS = 120;

interface Enregistrement {
  readonly empreinte: string;
  readonly etat: 'en-cours' | 'fait';
  readonly statut?: number;
  readonly corps?: unknown;
}

export class Idempotence {
  private readonly journal = new Logger('Idempotence');

  constructor(private readonly redis: ServiceRedis) {}

  /**
   * Exécute `travail` une seule fois par clé. `empreinte` résume la requête (champs et fichiers) :
   * une clé réutilisée pour une autre requête est refusée.
   */
  async executer<T>(portee: string, cle: string | undefined, empreinte: string, travail: () => Promise<T>): Promise<{ resultat: T; rejoue: boolean }> {
    if (!cle) return { resultat: await travail(), rejoue: false };
    const k = `idempotence:${portee}:${cle}`;
    let pose: string | null;
    try {
      const marque: Enregistrement = { empreinte, etat: 'en-cours' };
      pose = await this.redis.client.set(k, JSON.stringify(marque), 'EX', DUREE_EN_COURS, 'NX');
    } catch (e) {
      this.journal.warn(`Idempotence non appliquée (Redis) : ${(e as Error).message}`);
      return { resultat: await travail(), rejoue: false };
    }
    if (!pose) {
      const brut = await this.redis.client.get(k).catch(() => null);
      const existant = brut ? (JSON.parse(brut) as Enregistrement) : null;
      if (existant && existant.empreinte === empreinte && existant.etat === 'fait') {
        return { resultat: existant.corps as T, rejoue: true };
      }
      throw new Probleme(409, 'CONFLIT_IDEMPOTENCE', existant?.empreinte === empreinte
        ? 'Cette réclamation est déjà en cours d\'envoi'
        : 'Cette clé d\'idempotence a déjà servi pour une autre réclamation');
    }
    try {
      const resultat = await travail();
      const fait: Enregistrement = { empreinte, etat: 'fait', corps: resultat };
      await this.redis.client.set(k, JSON.stringify(fait), 'EX', DUREE_RESULTAT).catch(() => undefined);
      return { resultat, rejoue: false };
    } catch (e) {
      await this.redis.client.del(k).catch(() => undefined);
      throw e;
    }
  }
}
