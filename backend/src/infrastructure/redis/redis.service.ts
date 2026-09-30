/**
 * Connexion Redis de l'API : limites de débit, idempotence du dépôt, anti-rejeu des codes TOTP.
 * Les commandes échouent vite (500 ms) si Redis ne répond pas ; les appelants décident alors
 * de laisser passer (limites de débit) plutôt que de bloquer le service.
 */
import { Logger } from '@nestjs/common';
import { Redis } from 'ioredis';

/**
 * Battement du worker : écrit après chaque travail terminé (au moins toutes les 5 s), expire après
 * 2 minutes. Son absence signale un worker arrêté ou bloqué (lireSante, supervision).
 */
export const CLE_BATTEMENT_WORKER = 'reclamations:worker:battement';
export const DUREE_BATTEMENT_S = 120;

export class ServiceRedis {
  private readonly journal = new Logger('Redis');
  readonly client: Redis;

  constructor(url: string, nom = 'api') {
    this.client = new Redis(url, {
      connectionName: `reclamations-${nom}`,
      commandTimeout: 500,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: true,
      lazyConnect: false,
    });
    this.client.on('error', (e: Error) => this.journal.warn(`Redis indisponible : ${e.message}`));
  }

  async disponible(): Promise<boolean> {
    try {
      return (await this.client.ping()) === 'PONG';
    } catch {
      return false;
    }
  }

  async fermer(): Promise<void> {
    await this.client.quit().catch(() => this.client.disconnect());
  }
}
