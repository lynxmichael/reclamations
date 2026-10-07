/** Baromètre mensuel et recommandations (étape 23) : voir barometre.service.ts. */
import { Controller, Inject, Module } from '@nestjs/common';
import { AppelCourant, EntreesValidees, type Appel, type Entrees } from '../../infrastructure/contrat/appel.js';
import { Operation } from '../../infrastructure/contrat/operation.decorator.js';
import type { S } from '../commun.js';
import { ServiceBarometre } from './barometre.service.js';

@Controller()
export class BarometreControleur {
  constructor(@Inject(ServiceBarometre) private readonly service: ServiceBarometre) {}

  @Operation('listerBarometres')
  lister(@AppelCourant() a: Appel) {
    return this.service.lister(a);
  }

  @Operation('lireBarometre')
  lire(@AppelCourant() a: Appel, @EntreesValidees() e: Entrees) {
    return this.service.lire(a, e.chemin.mois);
  }

  @Operation('deciderRecommandation')
  decider(@AppelCourant() a: Appel, @EntreesValidees() e: Entrees) {
    return this.service.decider(a, e.chemin.mois, e.chemin.id, e.corps as S<'DecisionRecommandation'>);
  }
}

@Module({ controllers: [BarometreControleur], providers: [ServiceBarometre] })
export class BarometreModule {}
