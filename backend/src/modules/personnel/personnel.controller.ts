import { Controller, Inject, Module } from '@nestjs/common';
import { AppelCourant, EntreesValidees, type Appel, type Entrees } from '../../infrastructure/contrat/appel.js';
import { Operation } from '../../infrastructure/contrat/operation.decorator.js';
import { ServicePersonnel } from './personnel.service.js';

@Controller()
export class PersonnelControleur {
  constructor(@Inject(ServicePersonnel) private readonly service: ServicePersonnel) {}

  @Operation('listerUtilisateurs')
  lister(@AppelCourant() a: Appel, @EntreesValidees() e: Entrees) {
    return this.service.lister(a, e.requete);
  }

  @Operation('inviterUtilisateur')
  inviter(@AppelCourant() a: Appel, @EntreesValidees() e: Entrees) {
    return this.service.inviter(a, e.corps as Parameters<ServicePersonnel['inviter']>[1]);
  }

  @Operation('lireUtilisateur')
  lire(@AppelCourant() a: Appel, @EntreesValidees() e: Entrees) {
    return this.service.lire(a, e.chemin.id);
  }

  @Operation('modifierUtilisateur')
  modifier(@AppelCourant() a: Appel, @EntreesValidees() e: Entrees) {
    return this.service.modifier(a, e.chemin.id, e.corps);
  }

  @Operation('desactiverUtilisateur')
  desactiver(@AppelCourant() a: Appel, @EntreesValidees() e: Entrees) {
    return this.service.desactiver(a, e.chemin.id);
  }

  @Operation('reactiverUtilisateur')
  reactiver(@AppelCourant() a: Appel, @EntreesValidees() e: Entrees) {
    return this.service.reactiver(a, e.chemin.id);
  }

  @Operation('renvoyerInvitation')
  async renvoyer(@AppelCourant() a: Appel, @EntreesValidees() e: Entrees): Promise<void> {
    await this.service.renvoyerInvitation(a, e.chemin.id);
  }

  @Operation('reinitialiserTotp')
  reinitialiserTotp(@AppelCourant() a: Appel, @EntreesValidees() e: Entrees) {
    return this.service.reinitialiserTotp(a, e.chemin.id);
  }
}

@Module({ controllers: [PersonnelControleur], providers: [ServicePersonnel], exports: [ServicePersonnel] })
export class PersonnelModule {}
