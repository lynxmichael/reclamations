import { Controller, Inject, Module, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { CONFIGURATION, type Configuration } from '../../configuration/configuration.js';
import { AppelCourant, EntreesValidees, personnelDe, type Appel, type Entrees } from '../../infrastructure/contrat/appel.js';
import { Operation } from '../../infrastructure/contrat/operation.decorator.js';
import { Probleme } from '../../infrastructure/contrat/probleme.js';
import { ServiceAuth, type SessionOuverte } from './auth.service.js';

export const COOKIE_RAFRAICHISSEMENT = 'rt';
export const CHEMIN_COOKIE = '/api/v1/auth';

/** Lit un cookie sans dépendance : « a=1; rt=xyz » → xyz. */
export function lireCookie(req: Request, nom: string): string | undefined {
  for (const morceau of (req.headers.cookie ?? '').split(';')) {
    const [cle, ...valeur] = morceau.trim().split('=');
    if (cle === nom) return decodeURIComponent(valeur.join('='));
  }
  return undefined;
}

@Controller()
export class AuthControleur {
  constructor(
    @Inject(ServiceAuth) private readonly auth: ServiceAuth,
    @Inject(CONFIGURATION) private readonly config: Configuration,
  ) {}

  private poserCookie(res: Response, s: SessionOuverte) {
    res.cookie(COOKIE_RAFRAICHISSEMENT, s.refreshToken, {
      httpOnly: true, secure: this.config.cookieSecure, sameSite: 'strict', path: CHEMIN_COOKIE, expires: s.expireLe,
    });
    return s.corps;
  }

  private effacerCookie(res: Response) {
    res.clearCookie(COOKIE_RAFRAICHISSEMENT, { httpOnly: true, secure: this.config.cookieSecure, sameSite: 'strict', path: CHEMIN_COOKIE });
  }

  @Operation('connexion')
  connexion(@EntreesValidees() e: Entrees, @AppelCourant() appel: Appel) {
    return this.auth.connexion(e.corps as { email: string; motDePasse: string }, appel);
  }

  @Operation('validerCodeTotp')
  async validerCodeTotp(@EntreesValidees() e: Entrees, @AppelCourant() appel: Appel, @Res({ passthrough: true }) res: Response) {
    return this.poserCookie(res, await this.auth.validerCodeTotp(e.corps as { jetonIntermediaire: string; code: string }, appel));
  }

  @Operation('accepterInvitation')
  accepterInvitation(@EntreesValidees() e: Entrees, @AppelCourant() appel: Appel) {
    return this.auth.accepterInvitation(e.corps as { jeton: string; motDePasse: string }, appel);
  }

  @Operation('activerTotp')
  async activerTotp(@EntreesValidees() e: Entrees, @AppelCourant() appel: Appel, @Res({ passthrough: true }) res: Response) {
    return this.poserCookie(res, await this.auth.activerTotp(e.corps as { jetonIntermediaire: string; code: string }, appel));
  }

  @Operation('rafraichirSession')
  async rafraichir(@Req() req: Request, @AppelCourant() appel: Appel, @Res({ passthrough: true }) res: Response) {
    try {
      return this.poserCookie(res, await this.auth.rafraichir(lireCookie(req, COOKIE_RAFRAICHISSEMENT), appel));
    } catch (e) {
      if (e instanceof Probleme && e.status === 401) this.effacerCookie(res);
      throw e;
    }
  }

  @Operation('deconnexion')
  async deconnexion(@AppelCourant() appel: Appel, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.deconnexion(personnelDe(appel), appel);
    this.effacerCookie(res);
  }

  @Operation('demanderReinitialisation')
  async demanderReinitialisation(@EntreesValidees() e: Entrees, @AppelCourant() appel: Appel): Promise<void> {
    await this.auth.demanderReinitialisation((e.corps as { email: string }).email, appel);
  }

  @Operation('reinitialiserMotDePasse')
  async reinitialiserMotDePasse(@EntreesValidees() e: Entrees, @AppelCourant() appel: Appel): Promise<void> {
    await this.auth.reinitialiserMotDePasse(e.corps as { jeton: string; motDePasse: string }, appel);
  }

  @Operation('lireMoi')
  lireMoi(@AppelCourant() appel: Appel) {
    return this.auth.moi(personnelDe(appel));
  }
}

@Module({ controllers: [AuthControleur], providers: [ServiceAuth], exports: [ServiceAuth] })
export class AuthModule {}
