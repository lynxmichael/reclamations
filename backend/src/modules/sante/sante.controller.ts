import { Controller, Inject, Module, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { components } from '../../contrat/api.js';
import { CONFIGURATION, type Configuration } from '../../configuration/configuration.js';
import { BaseDonnees } from '../../infrastructure/base-de-donnees/base-de-donnees.service.js';
import { Operation } from '../../infrastructure/contrat/operation.decorator.js';
import { ServiceRedis } from '../../infrastructure/redis/redis.service.js';

@Controller()
export class SanteControleur {
  constructor(
    @Inject(BaseDonnees) private readonly bd: BaseDonnees,
    @Inject(ServiceRedis) private readonly redis: ServiceRedis,
    @Inject(CONFIGURATION) private readonly config: Configuration,
  ) {}

  /** État de l'API et de ses dépendances ; 503 si l'une ne répond pas (supervision, Docker). */
  @Operation('lireSante')
  async lire(@Res({ passthrough: true }) res: Response): Promise<components['schemas']['Sante']> {
    const [base, redis] = await Promise.all([
      this.bd.enSysteme((tx) => tx.$queryRaw`SELECT 1`).then(() => true, () => false),
      this.redis.disponible(),
    ]);
    const ok = base && redis;
    if (!ok) res.status(503);
    return { statut: ok ? 'ok' : 'degrade', base: base ? 'ok' : 'indisponible', redis: redis ? 'ok' : 'indisponible', version: this.config.version };
  }
}

@Module({ controllers: [SanteControleur] })
export class SanteModule {}
