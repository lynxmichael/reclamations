/**
 * Espace client (après code OTP) : ses réclamations dans cette banque, messages, confirmation,
 * contestation, pièces jointes. Une réclamation d'un autre client répond 404.
 */
import { Controller, Inject, Injectable, Module, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CycleDeVie } from '../../application/reclamations/cycle-de-vie.js';
import { BaseDonnees } from '../../infrastructure/base-de-donnees/base-de-donnees.service.js';
import { acteurDe, AppelCourant, clientDe, EntreesValidees, traceDe, type Appel, type Entrees } from '../../infrastructure/contrat/appel.js';
import { Operation } from '../../infrastructure/contrat/operation.decorator.js';
import { introuvable } from '../../infrastructure/contrat/probleme.js';
import { STOCKAGE, type Stockage } from '../../infrastructure/stockage/stockage.js';
import { HORLOGE, type Horloge } from '../../noyau/noyau.module.js';
import { avecFichiers, envoyerFichier, stockerPiecesJointes, telechargement, type S } from '../commun.js';
import { lireVueClient } from '../reclamations/lecture.js';

@Injectable()
export class ServiceClient {
  constructor(
    @Inject(BaseDonnees) private readonly bd: BaseDonnees,
    @Inject(CycleDeVie) private readonly cycle: CycleDeVie,
    @Inject(STOCKAGE) private readonly stockage: Stockage,
    @Inject(HORLOGE) private readonly horloge: Horloge,
  ) {}

  async mesReclamations(appel: Appel): Promise<{ donnees: S<'ReclamationClientResume'>[] }> {
    const c = clientDe(appel);
    const liste = await this.bd.enBanque(c.tenantId, (tx) => tx.reclamation.findMany({
      where: { clientId: c.id },
      orderBy: { creeLe: 'desc' },
      select: { id: true, numero: true, statut: true, creeLe: true, categorie: { select: { nom: true } } },
    }));
    return { donnees: liste.map((t) => ({ id: t.id, numero: t.numero, statut: t.statut, categorie: t.categorie.nom, creeLe: t.creeLe.toISOString() })) };
  }

  lire(appel: Appel, id: string) {
    const c = clientDe(appel);
    return this.bd.enBanque(c.tenantId, (tx) => lireVueClient(tx, id, c.id, this.horloge()));
  }

  /** La réclamation doit être celle du client connecté (sinon 404, jamais 403). */
  private async exigerSienne(appel: Appel, id: string) {
    const c = clientDe(appel);
    const t = await this.bd.enBanque(c.tenantId, (tx) => tx.reclamation.findFirst({ where: { id, clientId: c.id }, select: { id: true } }));
    if (!t) throw introuvable('Réclamation introuvable');
    return c;
  }

  async message(appel: Appel, id: string, e: Entrees) {
    const c = await this.exigerSienne(appel, id);
    const { fichiers, annuler } = await stockerPiecesJointes(this.stockage, c.tenantId, e.fichiers, this.horloge());
    await avecFichiers(annuler, () => this.cycle.messageDuClient(c.tenantId, id, acteurDe(appel), String(e.corps.contenu), traceDe(appel), fichiers));
    return this.lire(appel, id);
  }

  async confirmer(appel: Appel, id: string) {
    const c = await this.exigerSienne(appel, id);
    await this.cycle.confirmer(c.tenantId, id, acteurDe(appel), traceDe(appel));
    return this.lire(appel, id);
  }

  async contester(appel: Appel, id: string, motif: string) {
    const c = await this.exigerSienne(appel, id);
    await this.cycle.contester(c.tenantId, id, acteurDe(appel), motif, traceDe(appel));
    return this.lire(appel, id);
  }

  /** Pièce jointe du dépôt ou d'un message visible ; jamais celle d'une note interne. */
  async piece(appel: Appel, id: string, pieceId: string) {
    const c = clientDe(appel);
    const p = await this.bd.enBanque(c.tenantId, (tx) => tx.pieceJointe.findFirst({
      where: {
        id: pieceId, reclamationId: id, reclamation: { clientId: c.id },
        OR: [{ commentaireId: null }, { commentaire: { type: { not: 'NOTE_INTERNE' } } }],
      },
      select: { cleStockage: true, nomFichier: true },
    }));
    const contenu = p ? await this.stockage.lire(p.cleStockage) : null;
    if (!p || !contenu) throw introuvable('Pièce jointe introuvable');
    return telechargement(contenu, p.nomFichier);
  }
}

@Controller()
export class ClientControleur {
  constructor(@Inject(ServiceClient) private readonly service: ServiceClient) {}

  @Operation('listerMesReclamations')
  lister(@AppelCourant() appel: Appel) {
    return this.service.mesReclamations(appel);
  }

  @Operation('lireMaReclamation')
  lire(@AppelCourant() appel: Appel, @EntreesValidees() e: Entrees) {
    return this.service.lire(appel, e.chemin.id);
  }

  @Operation('envoyerMessageClient')
  message(@AppelCourant() appel: Appel, @EntreesValidees() e: Entrees) {
    return this.service.message(appel, e.chemin.id, e);
  }

  @Operation('confirmerResolution')
  confirmer(@AppelCourant() appel: Appel, @EntreesValidees() e: Entrees) {
    return this.service.confirmer(appel, e.chemin.id);
  }

  @Operation('contesterResolution')
  contester(@AppelCourant() appel: Appel, @EntreesValidees() e: Entrees) {
    return this.service.contester(appel, e.chemin.id, String(e.corps.motif));
  }

  @Operation('telechargerPieceJointeClient')
  async piece(@AppelCourant() appel: Appel, @EntreesValidees() e: Entrees, @Res() res: Response) {
    envoyerFichier(res, await this.service.piece(appel, e.chemin.id, e.chemin.pieceId));
  }
}

@Module({ controllers: [ClientControleur], providers: [ServiceClient] })
export class ClientModule {}
