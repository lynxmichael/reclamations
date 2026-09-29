/**
 * Application HTTP : l'API du contrat sous /api/v1, la documentation Swagger sous /api/docs.
 */
import 'reflect-metadata';
import { Module, type DynamicModule, type INestApplication } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Configuration } from './configuration/configuration.js';
import { InterceptionContrat } from './infrastructure/contrat/contrat.interceptor.js';
import { FiltreErreurs } from './infrastructure/contrat/filtre-erreurs.js';
import { monterDocumentation } from './infrastructure/contrat/documentation.js';
import { monterVerificationTls } from './infrastructure/tls.js';
import { AuditModule } from './modules/audit/audit.controller.js';
import { AuthModule } from './modules/auth/auth.controller.js';
import { ClientModule } from './modules/client/client.controller.js';
import { NotificationsModule } from './modules/notifications/notifications.controller.js';
import { ParametrageModule } from './modules/parametrage/parametrage.controller.js';
import { PersonnelModule } from './modules/personnel/personnel.controller.js';
import { PlateformeModule } from './modules/plateforme/plateforme.controller.js';
import { PublicModule } from './modules/public/public.controller.js';
import { ReclamationsModule } from './modules/reclamations/reclamations.controller.js';
import { SanteModule } from './modules/sante/sante.controller.js';
import { NoyauModule, type OptionsNoyau } from './noyau/noyau.module.js';

export const PREFIXE_API = 'api/v1';

@Module({})
export class AppModule {
  static pour(options: OptionsNoyau): DynamicModule {
    return {
      module: AppModule,
      imports: [
        NoyauModule.pour(options),
        SanteModule,
        PublicModule,
        ClientModule,
        AuthModule,
        ReclamationsModule,
        NotificationsModule,
        ParametrageModule,
        PersonnelModule,
        AuditModule,
        PlateformeModule,
      ],
      providers: [
        { provide: APP_INTERCEPTOR, useClass: InterceptionContrat },
        { provide: APP_FILTER, useClass: FiltreErreurs },
      ],
    };
  }
}

/** Crée l'application (utilisé par main.ts et par les tests de bout en bout). */
export async function creerApplication(options: OptionsNoyau & { journaux?: boolean }): Promise<INestApplication> {
  const config: Configuration = options.configuration;
  const app = await NestFactory.create<NestExpressApplication>(AppModule.pour(options), {
    logger: options.journaux === false ? false : ['error', 'warn', 'log'],
    bodyParser: false,
  });
  app.set('trust proxy', config.trustProxy);
  app.disable('x-powered-by');
  app.useBodyParser('json', { limit: '100kb' });
  app.setGlobalPrefix(PREFIXE_API);
  app.use((_req: unknown, res: { setHeader(n: string, v: string): void }, suite: () => void) => {
    // En-têtes de sécurité de base ; Caddy ajoute HSTS en production
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Cache-Control', 'no-store');
    suite();
  });
  monterDocumentation(app, config);
  monterVerificationTls(app, config);
  app.enableShutdownHooks();
  return app;
}
