/**
 * Services partagés par tous les modules de l'API : configuration, base, Redis, stockage,
 * jetons, limites de débit, idempotence, anti-robot (étape 11), horloge, service du cycle de vie (étape 4),
 * appels à l'IA (étape 18) et antivirus des pièces jointes (étape 22).
 */
import { Global, Inject, Injectable, Module, type DynamicModule, type OnApplicationShutdown } from '@nestjs/common';
import { MoteurIa } from '../application/ia/moteur.js';
import { CycleDeVie } from '../application/reclamations/cycle-de-vie.js';
import { CONFIGURATION, urlPortail, type Configuration } from '../configuration/configuration.js';
import { BaseDonnees } from '../infrastructure/base-de-donnees/base-de-donnees.service.js';
import { ANTIVIRUS, antivirusDe, type Antivirus } from '../infrastructure/fichiers/antivirus.js';
import { creerFournisseur } from '../infrastructure/ia/fournisseurs.js';
import { ServiceRedis } from '../infrastructure/redis/redis.service.js';
import { AntiRobot } from '../infrastructure/securite/anti-robot.js';
import { Idempotence } from '../infrastructure/securite/idempotence.js';
import { Jetons } from '../infrastructure/securite/jetons.js';
import { Limiteur } from '../infrastructure/securite/limiteur.js';
import { STOCKAGE, StockageDisque, type Stockage } from '../infrastructure/stockage/stockage.js';

export const HORLOGE = Symbol('HORLOGE');
export type Horloge = () => Date;

export interface OptionsNoyau {
  readonly configuration: Configuration;
  /** Horloge injectée (tests du SLA) ; l'heure réelle par défaut */
  readonly horloge?: Horloge;
  readonly stockage?: Stockage;
  /** Antivirus injecté (tests) ; sinon celui de la configuration */
  readonly antivirus?: Antivirus;
}

@Injectable()
class Fermeture implements OnApplicationShutdown {
  constructor(
    @Inject(BaseDonnees) private readonly bd: BaseDonnees,
    @Inject(ServiceRedis) private readonly redis: ServiceRedis,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await Promise.allSettled([this.bd.fermer(), this.redis.fermer()]);
  }
}

@Global()
@Module({})
export class NoyauModule {
  static pour(options: OptionsNoyau): DynamicModule {
    const config = options.configuration;
    const horloge: Horloge = options.horloge ?? (() => new Date());
    const fournisseurs = [
      { provide: CONFIGURATION, useValue: config },
      { provide: HORLOGE, useValue: horloge },
      { provide: BaseDonnees, useFactory: () => new BaseDonnees(config.baseDeDonneesUrl) },
      { provide: ServiceRedis, useFactory: () => new ServiceRedis(config.redisUrl) },
      { provide: STOCKAGE, useValue: options.stockage ?? new StockageDisque(config.stockageDossier) },
      { provide: ANTIVIRUS, useValue: options.antivirus ?? antivirusDe(config.antivirus) },
      { provide: Jetons, useFactory: () => new Jetons(config.secretJwt, horloge) },
      { provide: Limiteur, useFactory: (r: ServiceRedis) => new Limiteur(r), inject: [ServiceRedis] },
      { provide: Idempotence, useFactory: (r: ServiceRedis) => new Idempotence(r), inject: [ServiceRedis] },
      { provide: AntiRobot, useFactory: (r: ServiceRedis) => new AntiRobot(r, config.secretJwt, config.antiRobotMaximum, horloge), inject: [ServiceRedis] },
      {
        provide: CycleDeVie,
        useFactory: (bd: BaseDonnees) => new CycleDeVie(bd.base, {
          horloge,
          lienSuivi: (slug, jeton) => `${urlPortail(config, slug)}/suivi/${jeton}`,
        }),
        inject: [BaseDonnees],
      },
      {
        // Assistant IA (étape 18) : fournisseur choisi par la configuration, règles sinon
        provide: MoteurIa,
        useFactory: (bd: BaseDonnees) => new MoteurIa(bd, config.ia, config.ia.fournisseur === 'regles' ? null : creerFournisseur(config.ia), horloge),
        inject: [BaseDonnees],
      },
      Fermeture,
    ];
    return {
      module: NoyauModule,
      providers: fournisseurs,
      exports: fournisseurs.filter((f) => f !== Fermeture).map((f) => (typeof f === 'function' ? f : f.provide)),
    };
  }
}
