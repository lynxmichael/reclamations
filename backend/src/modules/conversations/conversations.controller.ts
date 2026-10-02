/** Boîte de réception des agents (étape 17) : voir conversations.service.ts. */
import { Controller, Inject, Module } from '@nestjs/common';
import { AppelCourant, EntreesValidees, type Appel, type Entrees } from '../../infrastructure/contrat/appel.js';
import { Operation } from '../../infrastructure/contrat/operation.decorator.js';
import { ServiceConversations } from './conversations.service.js';

@Controller()
export class ConversationsControleur {
  constructor(@Inject(ServiceConversations) private readonly service: ServiceConversations) {}

  @Operation('listerConversations')
  lister(@AppelCourant() a: Appel, @EntreesValidees() e: Entrees) {
    return this.service.lister(a, e.requete);
  }

  @Operation('lireConversation')
  lire(@AppelCourant() a: Appel, @EntreesValidees() e: Entrees) {
    return this.service.lire(a, e.chemin.id);
  }

  @Operation('marquerConversationLue')
  async lue(@AppelCourant() a: Appel, @EntreesValidees() e: Entrees): Promise<void> {
    await this.service.marquerLue(a, e.chemin.id);
  }
}

@Module({ controllers: [ConversationsControleur], providers: [ServiceConversations] })
export class ConversationsModule {}
