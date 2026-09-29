import { Controller, Inject, Module } from '@nestjs/common';
import { AppelCourant, EntreesValidees, type Appel, type Entrees } from '../../infrastructure/contrat/appel.js';
import { Operation } from '../../infrastructure/contrat/operation.decorator.js';
import { ServicePlateforme } from './plateforme.service.js';

@Controller()
export class PlateformeControleur {
  constructor(@Inject(ServicePlateforme) private readonly service: ServicePlateforme) {}

  @Operation('listerBanques')
  banques(@EntreesValidees() e: Entrees) {
    return this.service.listerBanques(e.requete);
  }

  @Operation('creerBanque')
  creerBanque(@AppelCourant() a: Appel, @EntreesValidees() e: Entrees) {
    return this.service.creerBanque(a, e.corps as Parameters<ServicePlateforme['creerBanque']>[1]);
  }

  @Operation('lireBanque')
  lireBanque(@EntreesValidees() e: Entrees) {
    return this.service.lireBanque(e.chemin.id);
  }

  @Operation('modifierBanque')
  modifierBanque(@AppelCourant() a: Appel, @EntreesValidees() e: Entrees) {
    return this.service.modifierBanque(a, e.chemin.id, e.corps);
  }

  @Operation('suspendreBanque')
  suspendre(@AppelCourant() a: Appel, @EntreesValidees() e: Entrees) {
    return this.service.suspendre(a, e.chemin.id, String(e.corps.motif));
  }

  @Operation('reactiverBanque')
  reactiver(@AppelCourant() a: Appel, @EntreesValidees() e: Entrees) {
    return this.service.reactiver(a, e.chemin.id);
  }

  @Operation('listerPlans')
  plans() {
    return this.service.listerPlans();
  }

  @Operation('creerPlan')
  creerPlan(@AppelCourant() a: Appel, @EntreesValidees() e: Entrees) {
    return this.service.creerPlan(a, e.corps as Parameters<ServicePlateforme['creerPlan']>[1]);
  }

  @Operation('modifierPlan')
  modifierPlan(@AppelCourant() a: Appel, @EntreesValidees() e: Entrees) {
    return this.service.modifierPlan(a, e.chemin.id, e.corps);
  }

  @Operation('listerJournalPlateforme')
  journal(@EntreesValidees() e: Entrees) {
    return this.service.listerJournal(e.requete);
  }

  @Operation('verifierJournalPlateforme')
  verifier(@EntreesValidees() e: Entrees) {
    return this.service.verifierJournal(String(e.requete.chaine));
  }

  @Operation('listerNotificationsPlateforme')
  notifications(@AppelCourant() a: Appel, @EntreesValidees() e: Entrees) {
    return this.service.notifications(a, e.requete);
  }

  @Operation('marquerNotificationPlateformeLue')
  async lue(@AppelCourant() a: Appel, @EntreesValidees() e: Entrees): Promise<void> {
    await this.service.notificationLue(a, e.chemin.id);
  }

  @Operation('listerSuperAdmins')
  superAdmins() {
    return this.service.listerSuperAdmins();
  }

  @Operation('inviterSuperAdmin')
  inviterSuperAdmin(@AppelCourant() a: Appel, @EntreesValidees() e: Entrees) {
    return this.service.inviterSuperAdmin(a, e.corps as Parameters<ServicePlateforme['inviterSuperAdmin']>[1]);
  }
}

@Module({ controllers: [PlateformeControleur], providers: [ServicePlateforme] })
export class PlateformeModule {}
