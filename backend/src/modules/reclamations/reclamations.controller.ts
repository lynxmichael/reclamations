/**
 * Back-office : files de traitement (§6.2), fiche d'une réclamation et ses actions.
 * Un agent ne voit que les tickets qui lui sont assignés (décision A5) ; un ticket qu'il ne peut
 * pas consulter lui répond 404, y compris pour une action (décision C5).
 */
import { Controller, Inject, Injectable, Module, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { Prisma } from '../../generated/prisma/client.js';
import { CycleDeVie, etat } from '../../application/reclamations/cycle-de-vie.js';
import { chargerParametres } from '../../application/reclamations/parametres.js';
import { verifierOperation } from '../../domaine/reclamation/machine.js';
import { BaseDonnees } from '../../infrastructure/base-de-donnees/base-de-donnees.service.js';
import { enSerie } from '../../infrastructure/base-de-donnees/index.js';
import { acteurDe, AppelCourant, EntreesValidees, personnelBanque, traceDe, type Appel, type Entrees } from '../../infrastructure/contrat/appel.js';
import { Operation } from '../../infrastructure/contrat/operation.decorator.js';
import { introuvable } from '../../infrastructure/contrat/probleme.js';
import { STOCKAGE, type Stockage } from '../../infrastructure/stockage/stockage.js';
import { HORLOGE, type Horloge } from '../../noyau/noyau.module.js';
import { avecFichiers, envoyerFichier, pageDe, pagination, stockerPiecesJointes, telechargement, type S } from '../commun.js';
import { INCLUSION_RESUME, lireFiche, resume } from './lecture.js';

type Where = Prisma.ReclamationWhereInput;

const NON_CLOTUREE: Where = { statut: { not: 'CLOTUREE' } };

/** File « en retard » : échéance passée, ou temps restant épuisé pendant une pause. */
const enRetard = (maintenant: Date): Where => ({
  statut: { in: ['OUVERTE', 'EN_COURS', 'EN_ATTENTE_CLIENT'] },
  OR: [{ echeanceSlaLe: { lt: maintenant } }, { slaSuspenduLe: { not: null }, slaMinutesRestantes: 0 }],
});

const TRIS: Record<string, Prisma.ReclamationOrderByWithRelationInput[]> = {
  '-creeLe': [{ creeLe: 'desc' }, { id: 'desc' }],
  creeLe: [{ creeLe: 'asc' }, { id: 'asc' }],
  echeanceSlaLe: [{ echeanceSlaLe: { sort: 'asc', nulls: 'last' } }, { creeLe: 'asc' }],
  '-echeanceSlaLe': [{ echeanceSlaLe: { sort: 'desc', nulls: 'last' } }, { creeLe: 'desc' }],
  '-priorite': [{ priorite: 'desc' }, { creeLe: 'desc' }],
};

@Injectable()
export class ServiceReclamations {
  constructor(
    @Inject(BaseDonnees) private readonly bd: BaseDonnees,
    @Inject(CycleDeVie) private readonly cycle: CycleDeVie,
    @Inject(STOCKAGE) private readonly stockage: Stockage,
    @Inject(HORLOGE) private readonly horloge: Horloge,
  ) {}

  async lister(appel: Appel, q: Record<string, unknown>): Promise<S<'PageReclamations'>> {
    const moi = personnelBanque(appel);
    const maintenant = this.horloge();
    const agent = moi.role === 'AGENT';
    const visibles: Where = agent ? { agentId: moi.id } : {};
    const file = String(q.file ?? 'toutes');
    const parFile: Record<string, Where> = {
      toutes: {},
      recues: agent ? { id: { in: [] } } : { agentId: null, ...NON_CLOTUREE },
      assignees: { agentId: moi.id, ...NON_CLOTUREE },
      urgentes: { priorite: 'URGENTE', ...NON_CLOTUREE },
      'en-retard': enRetard(maintenant),
      escaladees: { escaladeeLe: { not: null }, ...NON_CLOTUREE },
    };
    const filtres: Where[] = [visibles, parFile[file] ?? {}];
    if (Array.isArray(q.statut) && q.statut.length) filtres.push({ statut: { in: q.statut as never[] } });
    if (q.priorite) filtres.push({ priorite: q.priorite as never });
    if (q.categorieId) filtres.push({ categorieId: String(q.categorieId) });
    if (q.agenceId) filtres.push({ agenceId: String(q.agenceId) });
    if (q.canal) filtres.push({ canal: q.canal as never });
    if (q.agentId) filtres.push({ agentId: String(q.agentId) });
    if (q.du) filtres.push({ creeLe: { gte: new Date(String(q.du)) } });
    if (q.au) filtres.push({ creeLe: { lt: new Date(String(q.au)) } });
    if (q.recherche) filtres.push(recherche(String(q.recherche)));
    const where: Where = { AND: filtres };
    const { page, parPage, skip, take } = pagination(q);

    return this.bd.enBanque(moi.tenantId, async (tx) => {
      const p = await chargerParametres(tx, moi.tenantId);
      const [total, lignes, recues, assignees, urgentes, retard, escaladees] = await enSerie([
        () => tx.reclamation.count({ where }),
        () => tx.reclamation.findMany({ where, include: INCLUSION_RESUME, orderBy: TRIS[String(q.tri ?? '-creeLe')], skip, take }),
        () => (agent ? Promise.resolve(0) : tx.reclamation.count({ where: parFile.recues })),
        () => tx.reclamation.count({ where: parFile.assignees }),
        () => tx.reclamation.count({ where: { AND: [visibles, parFile.urgentes] } }),
        () => tx.reclamation.count({ where: { AND: [visibles, parFile['en-retard']] } }),
        () => tx.reclamation.count({ where: { AND: [visibles, parFile.escaladees] } }),
      ]);
      return {
        ...pageDe(lignes.map((t) => resume(t, maintenant, p.sla.calendrier)), page, parPage, total),
        compteurs: { recues, assignees, urgentes, enRetard: retard, escaladees },
      };
    });
  }

  async fiche(appel: Appel, id: string): Promise<S<'ReclamationDetail'>> {
    const moi = personnelBanque(appel);
    return this.bd.enBanque(moi.tenantId, async (tx) => {
      const p = await chargerParametres(tx, moi.tenantId);
      return lireFiche(tx, id, acteurDe(appel), this.horloge(), p.sla.calendrier);
    });
  }

  /** Avant une action : le ticket doit être consultable par l'appelant (sinon 404). */
  private async exigerVisible(appel: Appel, id: string): Promise<string> {
    const moi = personnelBanque(appel);
    const t = await this.bd.enBanque(moi.tenantId, (tx) => tx.reclamation.findUnique({
      where: { id }, select: { statut: true, agentId: true, clientId: true, clotureAutoPrevueLe: true },
    }));
    if (!t || !verifierOperation('CONSULTER', etat(t), acteurDe(appel)).ok) throw introuvable('Réclamation introuvable');
    return moi.tenantId;
  }

  async prendreEnCharge(appel: Appel, id: string) {
    const tenantId = await this.exigerVisible(appel, id);
    await this.cycle.prendreEnCharge(tenantId, id, acteurDe(appel), traceDe(appel));
    return this.fiche(appel, id);
  }

  async assigner(appel: Appel, id: string, agentId: string) {
    const tenantId = await this.exigerVisible(appel, id);
    await this.cycle.assigner(tenantId, id, acteurDe(appel), agentId, traceDe(appel));
    return this.fiche(appel, id);
  }

  async repondre(appel: Appel, id: string, e: Entrees) {
    const tenantId = await this.exigerVisible(appel, id);
    const { fichiers, annuler } = await stockerPiecesJointes(this.stockage, tenantId, e.fichiers, this.horloge());
    await avecFichiers(annuler, () => this.cycle.repondreAuClient(
      tenantId, id, acteurDe(appel), String(e.corps.contenu), { attendreReponse: e.corps.attendreReponse === true, fichiers }, traceDe(appel),
    ));
    return this.fiche(appel, id);
  }

  async note(appel: Appel, id: string, e: Entrees) {
    const tenantId = await this.exigerVisible(appel, id);
    const { fichiers, annuler } = await stockerPiecesJointes(this.stockage, tenantId, e.fichiers, this.horloge());
    await avecFichiers(annuler, () => this.cycle.noteInterne(tenantId, id, acteurDe(appel), String(e.corps.contenu), traceDe(appel), fichiers));
    return this.fiche(appel, id);
  }

  async resoudre(appel: Appel, id: string, reponseFinale: string) {
    const tenantId = await this.exigerVisible(appel, id);
    await this.cycle.resoudre(tenantId, id, acteurDe(appel), reponseFinale, traceDe(appel));
    return this.fiche(appel, id);
  }

  async changerPriorite(appel: Appel, id: string, priorite: 'NORMALE' | 'URGENTE') {
    const tenantId = await this.exigerVisible(appel, id);
    await this.cycle.changerPriorite(tenantId, id, acteurDe(appel), priorite, traceDe(appel));
    return this.fiche(appel, id);
  }

  async escalader(appel: Appel, id: string, motif?: string) {
    const tenantId = await this.exigerVisible(appel, id);
    await this.cycle.escalader(tenantId, id, acteurDe(appel), motif, traceDe(appel));
    return this.fiche(appel, id);
  }

  async cloturerDeForce(appel: Appel, id: string, motif: 'DOUBLON' | 'HORS_PERIMETRE' | 'ABUS' | 'AUTRE', precision: string) {
    const tenantId = await this.exigerVisible(appel, id);
    await this.cycle.cloturerDeForce(tenantId, id, acteurDe(appel), motif, precision, traceDe(appel));
    return this.fiche(appel, id);
  }

  async piece(appel: Appel, id: string, pieceId: string) {
    const tenantId = await this.exigerVisible(appel, id);
    const p = await this.bd.enBanque(tenantId, (tx) => tx.pieceJointe.findFirst({ where: { id: pieceId, reclamationId: id }, select: { cleStockage: true, nomFichier: true } }));
    const contenu = p ? await this.stockage.lire(p.cleStockage) : null;
    if (!p || !contenu) throw introuvable('Pièce jointe introuvable');
    return telechargement(contenu, p.nomFichier);
  }
}

/** Numéro, nom, e-mail ou téléphone du client. */
function recherche(texte: string): Where {
  const t = texte.trim();
  const chiffres = t.replace(/\D/g, '');
  const ou: Where[] = [
    { numero: { contains: t.toUpperCase() } },
    { client: { nom: { contains: t, mode: 'insensitive' } } },
    { client: { email: { contains: t.toLowerCase() } } },
  ];
  if (chiffres.length >= 4) ou.push({ client: { telephone: { contains: chiffres.replace(/^0/, '') } } });
  return { OR: ou };
}

@Controller()
export class ReclamationsControleur {
  constructor(@Inject(ServiceReclamations) private readonly service: ServiceReclamations) {}

  @Operation('listerReclamations')
  lister(@AppelCourant() a: Appel, @EntreesValidees() e: Entrees) {
    return this.service.lister(a, e.requete);
  }

  @Operation('lireReclamation')
  lire(@AppelCourant() a: Appel, @EntreesValidees() e: Entrees) {
    return this.service.fiche(a, e.chemin.id);
  }

  @Operation('prendreEnCharge')
  prendreEnCharge(@AppelCourant() a: Appel, @EntreesValidees() e: Entrees) {
    return this.service.prendreEnCharge(a, e.chemin.id);
  }

  @Operation('assignerReclamation')
  assigner(@AppelCourant() a: Appel, @EntreesValidees() e: Entrees) {
    return this.service.assigner(a, e.chemin.id, String(e.corps.agentId));
  }

  @Operation('repondreAuClient')
  repondre(@AppelCourant() a: Appel, @EntreesValidees() e: Entrees) {
    return this.service.repondre(a, e.chemin.id, e);
  }

  @Operation('ajouterNoteInterne')
  note(@AppelCourant() a: Appel, @EntreesValidees() e: Entrees) {
    return this.service.note(a, e.chemin.id, e);
  }

  @Operation('resoudreReclamation')
  resoudre(@AppelCourant() a: Appel, @EntreesValidees() e: Entrees) {
    return this.service.resoudre(a, e.chemin.id, String(e.corps.reponseFinale));
  }

  @Operation('changerPriorite')
  priorite(@AppelCourant() a: Appel, @EntreesValidees() e: Entrees) {
    return this.service.changerPriorite(a, e.chemin.id, e.corps.priorite as 'NORMALE' | 'URGENTE');
  }

  @Operation('escaladerReclamation')
  escalader(@AppelCourant() a: Appel, @EntreesValidees() e: Entrees) {
    return this.service.escalader(a, e.chemin.id, e.corps.motif as string | undefined);
  }

  @Operation('cloturerDeForce')
  cloturer(@AppelCourant() a: Appel, @EntreesValidees() e: Entrees) {
    return this.service.cloturerDeForce(a, e.chemin.id, e.corps.motif as 'DOUBLON', String(e.corps.precision));
  }

  @Operation('telechargerPieceJointe')
  async piece(@AppelCourant() a: Appel, @EntreesValidees() e: Entrees, @Res() res: Response) {
    envoyerFichier(res, await this.service.piece(a, e.chemin.id, e.chemin.pieceId));
  }
}

@Module({ controllers: [ReclamationsControleur], providers: [ServiceReclamations] })
export class ReclamationsModule {}
