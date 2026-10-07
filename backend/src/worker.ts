/**
 * Point d'entrée du worker (décision A8) : même code que l'API, sans serveur HTTP.
 * Tâches SLA, envois des notifications, analyse antivirus, baromètres mensuels et purge, planifiés par BullMQ.
 */
import 'reflect-metadata';
import { Inject, Injectable, Logger, Module, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { BarometresMensuels } from './application/barometre/barometres.js';
import { AnalyseAntivirus } from './application/fichiers/analyse.js';
import { MoteurIa } from './application/ia/moteur.js';
import { CycleDeVie } from './application/reclamations/cycle-de-vie.js';
import { signalerNonRemis } from './application/reclamations/envois.js';
import { TachesSla } from './application/reclamations/taches-sla.js';
import { CONFIGURATION, lireConfiguration, urlPortail, type Configuration } from './configuration/configuration.js';
import { BaseDonnees } from './infrastructure/base-de-donnees/base-de-donnees.service.js';
import { EmailSmtp, SmsHttp, SmsJournal, type AdaptateurSms } from './infrastructure/envois/adaptateurs.js';
import { BoiteEnvoi } from './infrastructure/envois/boite-envoi.js';
import { adaptateurWhatsapp } from './infrastructure/canaux/whatsapp.js';
import { antivirusDe } from './infrastructure/fichiers/antivirus.js';
import { creerFournisseur } from './infrastructure/ia/fournisseurs.js';
import { StockageDisque } from './infrastructure/stockage/stockage.js';
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
      boite: new BoiteEnvoi(
        this.bd, this.email, adaptateurSms(config), undefined, { whatsapp: adaptateurWhatsapp(config.whatsapp, config.production), cle: config.cleCanaux },
        // Étape 22 : un message au client non remis est signalé à l'agent
        (n) => signalerNonRemis(this.bd, n, new Date()).then(() => undefined),
      ),
      bd: this.bd,
      antivirus: new AnalyseAntivirus(this.bd, new StockageDisque(config.stockageDossier), antivirusDe(config.antivirus)),
      // Étape 23 : même moteur d'IA que l'API (plafond, journal appel_ia, repli sur les règles)
      barometres: new BarometresMensuels(this.bd, new MoteurIa(this.bd, config.ia, config.ia.fournisseur === 'regles' ? null : creerFournisseur(config.ia), () => new Date())),
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

/** SMS : passerelle HTTP, ou journal du worker ; en production, le journal est signalé à chaque démarrage. */
function adaptateurSms(config: Configuration): AdaptateurSms {
  const journal = new Logger('SMS');
  if (config.sms.mode === 'http') {
    journal.log(`Passerelle SMS : ${new URL(config.sms.url).host}, expéditeur « ${config.sms.expediteur} »`);
    return new SmsHttp(config.sms);
  }
  if (config.production) journal.warn('SMS_MODE=journal : aucun SMS n\'est envoyé aux clients (écrits dans ce journal seulement)');
  return new SmsJournal();
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
  if (config.antivirus.mode === 'aucun') new Logger('Antivirus').warn('ANTIVIRUS=aucun : pièces jointes non analysées (développement seulement)');
}

demarrer().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
