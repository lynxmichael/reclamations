/**
 * Point d'entrée du worker (décision A8) : même code que l'API, sans serveur HTTP.
 * Tâches SLA, envois des notifications et purge, planifiés par BullMQ.
 */
import 'reflect-metadata';
import { Inject, Injectable, Logger, Module, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { CycleDeVie } from './application/reclamations/cycle-de-vie.js';
import { TachesSla } from './application/reclamations/taches-sla.js';
import { CONFIGURATION, lireConfiguration, urlPortail, type Configuration } from './configuration/configuration.js';
import { BaseDonnees } from './infrastructure/base-de-donnees/base-de-donnees.service.js';
import { EmailSmtp, SmsJournal } from './infrastructure/envois/adaptateurs.js';
import { BoiteEnvoi } from './infrastructure/envois/boite-envoi.js';
import { Planificateur } from './worker/planification.js';

@Injectable()
class ServiceWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly bd: BaseDonnees;
  private readonly email: EmailSmtp;
  private readonly planificateur: Planificateur;

  constructor(@Inject(CONFIGURATION) config: Configuration) {
    this.bd = new BaseDonnees(config.baseDeDonneesUrl);
    const cycle = new CycleDeVie(this.bd.base, { lienSuivi: (slug, jeton) => `${urlPortail(config, slug)}/suivi/${jeton}` });
    this.email = new EmailSmtp(config.smtpUrl, config.emailExpediteur);
    this.planificateur = new Planificateur(config.redisUrl, {
      taches: new TachesSla(this.bd.base, cycle),
      boite: new BoiteEnvoi(this.bd, this.email, new SmsJournal()),
      bd: this.bd,
    });
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.planificateur.demarrer();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.planificateur.arreter();
    await this.email.fermer();
    await this.bd.fermer();
  }
}

@Module({})
class WorkerModule {
  static pour(config: Configuration) {
    return { module: WorkerModule, providers: [{ provide: CONFIGURATION, useValue: config }, ServiceWorker] };
  }
}

async function demarrer() {
  const config = lireConfiguration();
  const app = await NestFactory.createApplicationContext(WorkerModule.pour(config), { logger: ['error', 'warn', 'log'] });
  app.enableShutdownHooks();
  new Logger('Worker').log(`Worker ${config.version} démarré`);
}

demarrer().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
