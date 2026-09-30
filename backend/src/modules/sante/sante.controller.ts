import { statfs } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Controller, Inject, Module, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { components } from '../../contrat/api.js';
import { CONFIGURATION, type Configuration } from '../../configuration/configuration.js';
import { BaseDonnees } from '../../infrastructure/base-de-donnees/base-de-donnees.service.js';
import { Operation } from '../../infrastructure/contrat/operation.decorator.js';
import { CLE_BATTEMENT_WORKER, ServiceRedis } from '../../infrastructure/redis/redis.service.js';

type Sante = components['schemas']['Sante'];

/** Un e-mail ou un SMS en attente depuis plus longtemps signale un worker ou un prestataire en panne. */
export const RETARD_ENVOIS_MIN = 10;
/** Disque presque plein : moins de 5 % ou moins de 2 Gio libres sur le volume des fichiers. */
export const DISQUE_PART_MINIMALE = 0.05;
export const DISQUE_OCTETS_MINIMUM = 2 * 1024 ** 3;

export interface Mesures {
  base: boolean;
  redis: boolean;
  /** null si Redis ne répond pas : le battement est alors inconnu */
  battement: boolean | null;
  /** null si la base ne répond pas */
  envoisEnRetard: boolean | null;
  disque: { libres: number; total: number } | null;
}

/**
 * État publié par lireSante (étape 10). HTTP 503 seulement si l'API ne peut pas servir (base ou
 * Redis) : c'est ce que regarde le contrôle de santé Docker. Tout autre défaut (worker arrêté,
 * envois en retard, disque presque plein) passe le statut à « degrade » avec HTTP 200 : la
 * supervision externe surveille le mot « "statut":"ok" » et alerte, sans que Docker ne coupe le site.
 */
export function etatSante(m: Mesures, version: string): { http: 200 | 503; corps: Sante } {
  const disquePlein = !!m.disque && (m.disque.libres < DISQUE_OCTETS_MINIMUM || m.disque.libres / Math.max(1, m.disque.total) < DISQUE_PART_MINIMALE);
  const corps: Sante = {
    statut: 'ok',
    base: m.base ? 'ok' : 'indisponible',
    redis: m.redis ? 'ok' : 'indisponible',
    worker: m.battement === null ? 'inconnu' : m.battement ? 'ok' : 'absent',
    envois: m.envoisEnRetard === null ? 'inconnu' : m.envoisEnRetard ? 'en_retard' : 'ok',
    disque: m.disque === null ? 'inconnu' : disquePlein ? 'presque_plein' : 'ok',
    version,
  };
  corps.statut = corps.base === 'ok' && corps.redis === 'ok' && corps.worker === 'ok' && corps.envois === 'ok' && corps.disque === 'ok' ? 'ok' : 'degrade';
  return { http: m.base && m.redis ? 200 : 503, corps };
}

/** Espace libre du système de fichiers qui porte `dossier` (ou son plus proche parent existant). */
export async function espaceDisque(dossier: string): Promise<{ libres: number; total: number } | null> {
  for (let d = dossier; ; d = dirname(d)) {
    try {
      const s = await statfs(d);
      return { libres: Number(s.bavail) * Number(s.bsize), total: Number(s.blocks) * Number(s.bsize) };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT' || dirname(d) === d) return null;
    }
  }
}

@Controller()
export class SanteControleur {
  constructor(
    @Inject(BaseDonnees) private readonly bd: BaseDonnees,
    @Inject(ServiceRedis) private readonly redis: ServiceRedis,
    @Inject(CONFIGURATION) private readonly config: Configuration,
  ) {}

  /** État de l'API, de ses dépendances, du worker, des envois et du disque (supervision, Docker). */
  @Operation('lireSante')
  async lire(@Res({ passthrough: true }) res: Response): Promise<Sante> {
    const [envoisEnRetard, redis, disque] = await Promise.all([
      this.bd.enSysteme((tx) => tx.$queryRaw<{ retard: boolean }[]>`
        SELECT EXISTS (
          SELECT 1 FROM notification
           WHERE statut = 'EN_ATTENTE' AND canal IN ('EMAIL', 'SMS')
             AND cree_le < now() - make_interval(mins => ${RETARD_ENVOIS_MIN})
        ) AS retard`).then(([r]) => r!.retard, () => null),
      this.redis.disponible(),
      espaceDisque(this.config.stockageDossier),
    ]);
    const battement = redis ? await this.redis.client.exists(CLE_BATTEMENT_WORKER).then((n) => n === 1, () => null) : null;
    const { http, corps } = etatSante({ base: envoisEnRetard !== null, redis, battement, envoisEnRetard, disque }, this.config.version);
    res.status(http);
    return corps;
  }
}

@Module({ controllers: [SanteControleur] })
export class SanteModule {}
