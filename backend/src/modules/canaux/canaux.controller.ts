/** WhatsApp et SMS entrant (étape 20) : webhooks de Meta et de la passerelle SMS (et ses accusés de remise, étape 22), voir canaux.service.ts. */
import { Controller, Inject, Module, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CONFIGURATION, type Configuration } from '../../configuration/configuration.js';
import { adaptateurWhatsapp } from '../../infrastructure/canaux/whatsapp.js';
import { EntreesValidees, type Entrees, type RequeteApi } from '../../infrastructure/contrat/appel.js';
import { Operation } from '../../infrastructure/contrat/operation.decorator.js';
import { ADAPTATEUR_WHATSAPP, ServiceCanaux } from './canaux.service.js';

/** Corps brut gardé par l'analyseur JSON des webhooks (app.module.ts) : la signature porte sur lui. */
type RequeteSignee = RequeteApi & { corpsBrut?: Buffer };

@Controller()
export class CanauxControleur {
  constructor(@Inject(ServiceCanaux) private readonly service: ServiceCanaux) {}

  @Operation('verifierWebhookWhatsapp')
  verifier(@EntreesValidees() e: Entrees, @Res() res: Response): void {
    const defi = this.service.verifierWebhook(e.requete);
    res.status(200).type('text/plain').send(defi);
  }

  @Operation('recevoirWebhookWhatsapp')
  whatsapp(@Req() req: RequeteSignee, @EntreesValidees() e: Entrees) {
    return this.service.webhookWhatsapp(req.corpsBrut, e.entetes['x-hub-signature-256'], e.corps);
  }

  @Operation('recevoirSmsEntrant')
  sms(@Req() req: RequeteSignee, @EntreesValidees() e: Entrees) {
    return this.service.webhookSms(req.corpsBrut, e.entetes['x-signature'], e.corps);
  }

  /** Étape 22 : accusés de remise des SMS envoyés */
  @Operation('recevoirRemiseSms')
  remise(@Req() req: RequeteSignee, @EntreesValidees() e: Entrees) {
    return this.service.webhookRemiseSms(req.corpsBrut, e.entetes['x-signature'], e.corps);
  }
}

@Module({
  controllers: [CanauxControleur],
  providers: [
    ServiceCanaux,
    {
      provide: ADAPTATEUR_WHATSAPP,
      useFactory: (config: Configuration) => adaptateurWhatsapp(config.whatsapp, config.production),
      inject: [CONFIGURATION],
    },
  ],
})
export class CanauxModule {}
