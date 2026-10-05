import { Controller, Inject, Module, Res } from '@nestjs/common';
import type { Response } from 'express';
import { envoyerFichier, telechargement } from '../commun.js';
import { AppelCourant, EntreesValidees, type Appel, type Entrees } from '../../infrastructure/contrat/appel.js';
import { Operation } from '../../infrastructure/contrat/operation.decorator.js';
import { ServiceParametrage } from './parametrage.service.js';

type Corps<T> = T & Record<string, unknown>;

@Controller()
export class ParametrageControleur {
  constructor(@Inject(ServiceParametrage) private readonly service: ServiceParametrage) {}

  @Operation('lireParametresBanque')
  lire(@AppelCourant() a: Appel) {
    return this.service.lireParametres(a);
  }

  @Operation('modifierApparence')
  apparence(@AppelCourant() a: Appel, @EntreesValidees() e: Entrees) {
    return this.service.modifierApparence(a, e.corps);
  }

  @Operation('modifierSecuriteBanque')
  securite(@AppelCourant() a: Appel, @EntreesValidees() e: Entrees) {
    return this.service.modifierSecurite(a, e.corps as { doubleAuthentificationObligatoire: boolean });
  }

  @Operation('televerserLogo')
  logo(@AppelCourant() a: Appel, @EntreesValidees() e: Entrees) {
    return this.service.televerserLogo(a, e.fichiers);
  }

  @Operation('listerCategories')
  categories(@AppelCourant() a: Appel) {
    return this.service.listerCategories(a);
  }

  @Operation('creerCategorie')
  creerCategorie(@AppelCourant() a: Appel, @EntreesValidees() e: Entrees) {
    return this.service.creerCategorie(a, e.corps as Corps<{ nom: string; delaiCibleMinutes: number }>);
  }

  @Operation('modifierCategorie')
  modifierCategorie(@AppelCourant() a: Appel, @EntreesValidees() e: Entrees) {
    return this.service.modifierCategorie(a, e.chemin.id, e.corps);
  }

  @Operation('listerAgences')
  agences(@AppelCourant() a: Appel) {
    return this.service.listerAgences(a);
  }

  @Operation('creerAgence')
  creerAgence(@AppelCourant() a: Appel, @EntreesValidees() e: Entrees) {
    return this.service.creerAgence(a, e.corps as Corps<{ code: string; nom: string }>);
  }

  @Operation('modifierAgence')
  modifierAgence(@AppelCourant() a: Appel, @EntreesValidees() e: Entrees) {
    return this.service.modifierAgence(a, e.chemin.id, e.corps);
  }

  @Operation('listerPointsDepot')
  points(@AppelCourant() a: Appel) {
    return this.service.listerPoints(a);
  }

  @Operation('creerPointDepot')
  creerPoint(@AppelCourant() a: Appel, @EntreesValidees() e: Entrees) {
    return this.service.creerPoint(a, e.corps as Corps<{ canal: 'QR_CODE' | 'LIEN_WEB'; libelle: string }>);
  }

  @Operation('modifierPointDepot')
  modifierPoint(@AppelCourant() a: Appel, @EntreesValidees() e: Entrees) {
    return this.service.modifierPoint(a, e.chemin.id, e.corps);
  }

  @Operation('telechargerQrCode')
  async qrCode(@AppelCourant() a: Appel, @EntreesValidees() e: Entrees, @Res() res: Response) {
    const format = (e.requete.format ?? 'png') as 'png' | 'svg';
    const { contenu, type, nom } = await this.service.qrCode(a, e.chemin.id, format, Number(e.requete.taille ?? 512));
    envoyerFichier(res, telechargement(contenu, nom, type));
  }

  @Operation('lireHoraires')
  horaires(@AppelCourant() a: Appel) {
    return this.service.lireHoraires(a);
  }

  @Operation('remplacerHoraires')
  remplacerHoraires(@AppelCourant() a: Appel, @EntreesValidees() e: Entrees) {
    return this.service.remplacerHoraires(a, e.corps.plages as { jourSemaine: number; debut: string; fin: string }[]);
  }

  @Operation('listerJoursFeries')
  joursFeries(@AppelCourant() a: Appel, @EntreesValidees() e: Entrees) {
    return this.service.listerJoursFeries(a, e.requete.annee as number | undefined);
  }

  @Operation('ajouterJourFerie')
  ajouterJourFerie(@AppelCourant() a: Appel, @EntreesValidees() e: Entrees) {
    return this.service.ajouterJourFerie(a, e.corps as Corps<{ date: string; libelle: string }>);
  }

  @Operation('supprimerJourFerie')
  async supprimerJourFerie(@AppelCourant() a: Appel, @EntreesValidees() e: Entrees): Promise<void> {
    await this.service.supprimerJourFerie(a, e.chemin.id);
  }
}

@Module({ controllers: [ParametrageControleur], providers: [ServiceParametrage] })
export class ParametrageModule {}
