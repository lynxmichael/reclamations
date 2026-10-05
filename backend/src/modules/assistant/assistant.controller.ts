/** Assistant IA (étape 18) : voir assistant.service.ts. */
import { Controller, Inject, Module } from '@nestjs/common';
import type { CodeMessage } from '../../domaine/ia/assistant.js';
import { AppelCourant, EntreesValidees, type Appel, type Entrees } from '../../infrastructure/contrat/appel.js';
import { Operation } from '../../infrastructure/contrat/operation.decorator.js';
import { ServiceAssistant } from './assistant.service.js';

@Controller()
export class AssistantControleur {
  constructor(@Inject(ServiceAssistant) private readonly service: ServiceAssistant) {}

  @Operation('converserAvecAssistant')
  converser(@AppelCourant() a: Appel, @EntreesValidees() e: Entrees) {
    return this.service.converser(e.chemin.code, e.corps as { echanges: { auteur: 'CLIENT' | 'ASSISTANT'; texte?: string; code?: CodeMessage }[] }, a);
  }

  @Operation('listerReponsesAssistant')
  lister(@AppelCourant() a: Appel) {
    return this.service.listerReponses(a);
  }

  @Operation('creerReponseAssistant')
  creer(@AppelCourant() a: Appel, @EntreesValidees() e: Entrees) {
    return this.service.creerReponse(a, e.corps as { question: string; reponse: string; active?: boolean; ordre?: number });
  }

  @Operation('modifierReponseAssistant')
  modifier(@AppelCourant() a: Appel, @EntreesValidees() e: Entrees) {
    return this.service.modifierReponse(a, e.chemin.id, e.corps as Partial<{ question: string; reponse: string; active: boolean; ordre: number }>);
  }

  @Operation('supprimerReponseAssistant')
  async supprimer(@AppelCourant() a: Appel, @EntreesValidees() e: Entrees): Promise<void> {
    await this.service.supprimerReponse(a, e.chemin.id);
  }

  @Operation('suggererReponse')
  suggerer(@AppelCourant() a: Appel, @EntreesValidees() e: Entrees) {
    return this.service.suggerer(a, e.chemin.id);
  }

  @Operation('lireConsommationIa')
  consommation(@EntreesValidees() e: Entrees) {
    return this.service.consommation(String(e.requete.mois));
  }
}

@Module({ controllers: [AssistantControleur], providers: [ServiceAssistant] })
export class AssistantModule {}
