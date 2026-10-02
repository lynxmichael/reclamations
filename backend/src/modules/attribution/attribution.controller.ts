import { Controller, Inject, Module } from '@nestjs/common';
import { AppelCourant, EntreesValidees, type Appel, type Entrees } from '../../infrastructure/contrat/appel.js';
import { Operation } from '../../infrastructure/contrat/operation.decorator.js';
import { ServiceAttribution, type ModificationRegles } from './attribution.service.js';

/** Attribution et escalade automatiques (phase 2, étape 16). */
@Controller()
export class AttributionControleur {
  constructor(@Inject(ServiceAttribution) private readonly service: ServiceAttribution) {}

  @Operation('lireReglesTraitement')
  regles(@AppelCourant() a: Appel) {
    return this.service.lireRegles(a);
  }

  @Operation('modifierReglesTraitement')
  modifierRegles(@AppelCourant() a: Appel, @EntreesValidees() e: Entrees) {
    return this.service.modifierRegles(a, e.corps as ModificationRegles);
  }

  @Operation('listerGroupes')
  groupes(@AppelCourant() a: Appel) {
    return this.service.listerGroupes(a);
  }

  @Operation('creerGroupe')
  creerGroupe(@AppelCourant() a: Appel, @EntreesValidees() e: Entrees) {
    return this.service.creerGroupe(a, e.corps as { nom: string; membres: string[] });
  }

  @Operation('modifierGroupe')
  modifierGroupe(@AppelCourant() a: Appel, @EntreesValidees() e: Entrees) {
    return this.service.modifierGroupe(a, e.chemin.id, e.corps as { nom?: string; membres?: string[] });
  }

  @Operation('supprimerGroupe')
  async supprimerGroupe(@AppelCourant() a: Appel, @EntreesValidees() e: Entrees): Promise<void> {
    await this.service.supprimerGroupe(a, e.chemin.id);
  }

  @Operation('listerAbsences')
  absences(@AppelCourant() a: Appel) {
    return this.service.listerAbsences(a);
  }

  @Operation('ajouterAbsence')
  ajouterAbsence(@AppelCourant() a: Appel, @EntreesValidees() e: Entrees) {
    return this.service.ajouterAbsence(a, e.corps as { agentId: string; du: string; au: string });
  }

  @Operation('supprimerAbsence')
  async supprimerAbsence(@AppelCourant() a: Appel, @EntreesValidees() e: Entrees): Promise<void> {
    await this.service.supprimerAbsence(a, e.chemin.id);
  }
}

@Module({ controllers: [AttributionControleur], providers: [ServiceAttribution] })
export class AttributionModule {}
