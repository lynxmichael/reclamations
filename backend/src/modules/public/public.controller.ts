import { Controller, Inject, Module, Res } from '@nestjs/common';
import { envoyerFichier } from '../commun.js';
import type { Response } from 'express';
import { AppelCourant, EntreesValidees, type Appel, type Entrees } from '../../infrastructure/contrat/appel.js';
import { Operation } from '../../infrastructure/contrat/operation.decorator.js';
import { ServicePublic } from './public.service.js';

@Controller()
export class PublicControleur {
  constructor(@Inject(ServicePublic) private readonly service: ServicePublic) {}

  @Operation('lireFormulaireDepot')
  formulaire(@EntreesValidees() e: Entrees) {
    return this.service.formulaire(e.chemin.code);
  }

  @Operation('lireDefiAntiRobot')
  defiAntiRobot(@AppelCourant() appel: Appel) {
    return this.service.defiAntiRobot(appel);
  }

  @Operation('deposerReclamation')
  deposer(@EntreesValidees() e: Entrees, @AppelCourant() appel: Appel) {
    return this.service.deposer(e.chemin.code, e.corps, e.fichiers, e.entetes['idempotency-key'], appel);
  }

  @Operation('lireSuivi')
  suivi(@EntreesValidees() e: Entrees) {
    return this.service.suivi(e.chemin.jetonSuivi);
  }

  @Operation('demanderCodeOtp')
  demanderCode(@EntreesValidees() e: Entrees, @AppelCourant() appel: Appel) {
    const corps = e.corps as { canal?: 'SMS' | 'EMAIL'; jetonAntiRobot: string };
    return this.service.demanderCode(e.chemin.jetonSuivi, corps.canal, corps.jetonAntiRobot, appel);
  }

  @Operation('verifierCodeOtp')
  verifierCode(@EntreesValidees() e: Entrees, @AppelCourant() appel: Appel) {
    return this.service.verifierCode(e.chemin.jetonSuivi, (e.corps as { code: string }).code, appel);
  }

  @Operation('lireLogo')
  async logo(@EntreesValidees() e: Entrees, @Res() res: Response) {
    const { contenu, type } = await this.service.logo(e.chemin.fichier);
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    // Nom aléatoire changé à chaque nouveau logo : cache d'un an sans risque
    envoyerFichier(res, { contenu, type, cache: 'public, max-age=31536000, immutable' });
  }
}

@Module({ controllers: [PublicControleur], providers: [ServicePublic] })
export class PublicModule {}
