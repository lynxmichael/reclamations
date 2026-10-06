/**
 * Back-office : files de traitement (§6.2), fiche d'une réclamation et ses actions.
 * Un agent ne voit que les tickets qui lui sont assignés (décision A5) ; un ticket qu'il ne peut
 * pas consulter lui répond 404, y compris pour une action (décision C5).
 */
import { createHash } from 'node:crypto';
import { Controller, Inject, Injectable, Module, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { Prisma } from '../../generated/prisma/client.js';
import { agentsIndisponibles, chargerContexteRepartition } from '../../application/reclamations/attribution.js';
import { CycleDeVie, etat } from '../../application/reclamations/cycle-de-vie.js';
import { ErreurMetier } from '../../application/reclamations/erreurs.js';
import { chargerParametres, type ParametresBanque } from '../../application/reclamations/parametres.js';
import { repartir } from '../../domaine/attribution.js';
import { normaliserEmail, normaliserTelephone } from '../../domaine/contact.js';
import { verifierOperation, type Acteur } from '../../domaine/reclamation/machine.js';
import { BaseDonnees } from '../../infrastructure/base-de-donnees/base-de-donnees.service.js';
import { enSerie } from '../../infrastructure/base-de-donnees/index.js';
import { acteurDe, AppelCourant, EntreesValidees, personnelBanque, traceDe, type Appel, type Entrees, type Personnel } from '../../infrastructure/contrat/appel.js';
import { Operation } from '../../infrastructure/contrat/operation.decorator.js';
import { introuvable, invalide, type ErreurChamp } from '../../infrastructure/contrat/probleme.js';
import { Idempotence } from '../../infrastructure/securite/idempotence.js';
import { LIMITES, Limiteur } from '../../infrastructure/securite/limiteur.js';
import { ANTIVIRUS, type Antivirus } from '../../infrastructure/fichiers/antivirus.js';
import { STOCKAGE, type Stockage } from '../../infrastructure/stockage/stockage.js';
import { HORLOGE, type Horloge } from '../../noyau/noyau.module.js';
import { avecFichiers, envoyerFichier, pageDe, pagination, stockerPiecesJointes, telechargement, type S, exigerSaine } from '../commun.js';
import { masquer, VERSION_POLITIQUE } from '../public/public.service.js';
import { nouveauCodePoint } from '../parametrage/parametrage.service.js';
import { contexteSuggestions, doublonsDeLaPage, nonRemisDeLaPage, INCLUSION_RESUME, lireFiche, nomComplet, resume } from './lecture.js';

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
    @Inject(ANTIVIRUS) private readonly antivirus: Antivirus,
    @Inject(Idempotence) private readonly idempotence: Idempotence,
    @Inject(Limiteur) private readonly limiteur: Limiteur,
    @Inject(HORLOGE) private readonly horloge: Horloge,
  ) {}

  async lister(appel: Appel, q: Record<string, unknown>): Promise<S<'PageReclamations'>> {
    const moi = personnelBanque(appel);
    const maintenant = this.horloge();
    const { page, parPage, skip, take } = pagination(q);

    return this.bd.enBanque(moi.tenantId, async (tx) => {
      const p = await chargerParametres(tx, moi.tenantId);
      // Étape 21 : agents désactivés ou absents aujourd'hui, dont les dossiers sont « à réassigner »
      const indisponibles = moi.role === 'AGENT' ? [] : await agentsIndisponibles(tx, p, maintenant);
      const { where, visibles, parFile, agent } = filtresReclamations(moi, q, maintenant, indisponibles);
      const [total, lignes, recues, assignees, urgentes, retard, escaladees, aReassigner] = await enSerie([
        () => tx.reclamation.count({ where }),
        () => tx.reclamation.findMany({ where, include: INCLUSION_RESUME, orderBy: TRIS[String(q.tri ?? '-creeLe')], skip, take }),
        () => (agent ? Promise.resolve(0) : tx.reclamation.count({ where: parFile.recues })),
        () => tx.reclamation.count({ where: parFile.assignees }),
        () => tx.reclamation.count({ where: { AND: [visibles, parFile.urgentes] } }),
        () => tx.reclamation.count({ where: { AND: [visibles, parFile['en-retard']] } }),
        () => tx.reclamation.count({ where: { AND: [visibles, parFile.escaladees] } }),
        () => (agent || !indisponibles.length ? Promise.resolve(0) : tx.reclamation.count({ where: parFile['a-reassigner'] })),
      ]);
      // Mode suggestion (étape 16) : l'agent proposé pour chaque réclamation non assignée
      const ctx = lignes.some((t) => !t.agentId && t.statut === 'OUVERTE') ? await contexteSuggestions(tx, p, acteurDe(appel), maintenant) : null;
      const doublons = await doublonsDeLaPage(tx, lignes);
      const nonRemis = await nonRemisDeLaPage(tx, lignes.map((l) => l.id));
      return {
        ...pageDe(lignes.map((t) => resume(t, maintenant, p.sla.calendrier, ctx, doublons.has(t.id), nonRemis.has(t.id))), page, parPage, total),
        compteurs: { recues, assignees, urgentes, enRetard: retard, escaladees, aReassigner },
      };
    });
  }

  // ---- Étape 21 : saisie au guichet et au téléphone -------------------------------------

  /** Le point « Guichet » de l'agence, ou « Téléphone » de la banque, créé à la première saisie. */
  private async pointDeSaisie(tenantId: string, canal: 'GUICHET' | 'TELEPHONE', agenceId: string | null): Promise<string> {
    return this.bd.enBanque(tenantId, async (tx) => {
      const ou = { canal, agenceId: canal === 'GUICHET' ? agenceId : null } as const;
      const existant = await tx.pointDepot.findFirst({ where: ou, select: { id: true } });
      if (existant) return existant.id;
      // Deux saisies simultanées : l'index unique n'en garde qu'un
      await tx.pointDepot.createMany({
        data: [{ tenantId, code: nouveauCodePoint(), canal, libelle: canal === 'GUICHET' ? 'Guichet' : 'Téléphone', agenceId: ou.agenceId }],
        skipDuplicates: true,
      });
      return (await tx.pointDepot.findFirstOrThrow({ where: ou, select: { id: true } })).id;
    });
  }

  async saisir(appel: Appel, e: Entrees): Promise<S<'AccuseSaisie'>> {
    const moi = personnelBanque(appel);
    const d = e.corps as {
      canal: 'GUICHET' | 'TELEPHONE'; agenceId?: string; categorieId: string; description: string; nom: string;
      email?: string; telephone?: string; urgente?: boolean; meLAssigner?: boolean;
    };
    // Coordonnées et agence : les erreurs rejoignent celles du formulaire, champ par champ
    const erreurs: ErreurChamp[] = [];
    let email: string | null = null;
    let telephone: string | null = null;
    try { email = normaliserEmail(d.email); } catch { erreurs.push({ champ: 'email', message: 'Adresse e-mail invalide, par exemple nom@exemple.ci' }); }
    try {
      telephone = normaliserTelephone(d.telephone);
    } catch {
      const chiffres = (d.telephone ?? '').replace(/\D/g, '').length;
      erreurs.push({ champ: 'telephone', message: `Ce numéro a ${chiffres} chiffres ; un numéro ivoirien en compte 10, par exemple 07 08 09 10 11` });
    }
    if (!d.description.trim()) erreurs.push({ champ: 'description', message: 'Décrivez la réclamation du client' });
    if (!d.nom.trim()) erreurs.push({ champ: 'nom', message: 'Indiquez le nom du client' });
    if (!email && !telephone && !erreurs.some((x) => x.champ === 'email' || x.champ === 'telephone')) {
      erreurs.push({ champ: 'telephone', message: 'Un téléphone ou un e-mail au moins, pour que le client reçoive son numéro et son suivi' });
    }
    const agenceId = d.agenceId ?? null;
    if (d.canal === 'GUICHET' && !agenceId) erreurs.push({ champ: 'agenceId', message: 'Choisissez l\'agence du guichet' });
    if (agenceId) {
      const agence = await this.bd.enBanque(moi.tenantId, (tx) => tx.agence.findFirst({ where: { id: agenceId, active: true }, select: { id: true } }));
      if (!agence) erreurs.push({ champ: 'agenceId', message: 'Agence inconnue ou désactivée' });
    }
    if (erreurs.length) throw invalide(erreurs, `${erreurs.length} champ${erreurs.length > 1 ? 's' : ''} à corriger`);

    const maintenant = this.horloge();
    const empreinte = createHash('sha256')
      .update(JSON.stringify([d.canal, agenceId, d.categorieId, d.description, d.nom, email, telephone, d.urgente === true, d.meLAssigner !== false]))
      .update(e.fichiers.map((f) => createHash('sha256').update(f.contenu).digest('hex')).join(','))
      .digest('hex');
    const { resultat } = await this.idempotence.executer(`saisie:${moi.id}`, e.entetes['idempotency-key'], empreinte, async () => {
      await this.limiteur.consommer(LIMITES.saisieParPersonne, moi.id, 'Trop de réclamations saisies en une heure : réessayez plus tard');
      const pointDepotId = await this.pointDeSaisie(moi.tenantId, d.canal, agenceId);
      const { fichiers, annuler } = await stockerPiecesJointes(this.stockage, this.antivirus, moi.tenantId, e.fichiers, maintenant);
      const a = await avecFichiers(annuler, () => this.cycle.saisir({
        tenantId: moi.tenantId, pointDepotId, categorieId: d.categorieId, description: d.description,
        agenceId: d.canal === 'TELEPHONE' ? agenceId : null,
        client: { nom: d.nom, email, telephone }, consentementVersion: VERSION_POLITIQUE, fichiers,
      }, { par: acteurDe(appel) as Extract<Acteur, { type: 'UTILISATEUR' }>, urgente: d.urgente === true, meLAssigner: d.meLAssigner !== false }, traceDe(appel)));
      const agent = a.agentId
        ? await this.bd.enBanque(moi.tenantId, (tx) => tx.utilisateur.findUnique({ where: { id: a.agentId! }, select: { id: true, nom: true, prenom: true } }))
        : null;
      return {
        id: a.id, numero: a.numero, lienSuivi: a.lienSuivi, creeLe: a.creeLe.toISOString(),
        envoiPar: a.accusePar.filter((c): c is 'SMS' | 'EMAIL' => c === 'SMS' || c === 'EMAIL'),
        agent: agent ? { id: agent.id, nom: nomComplet(agent) } : null,
      } satisfies S<'AccuseSaisie'>;
    });
    return resultat;
  }

  // ---- Étape 21 : doublons, lien de suivi, réaffectation ---------------------------------

  async rattacher(appel: Appel, id: string, principaleId: string) {
    const tenantId = await this.exigerVisible(appel, id);
    await this.cycle.rattacher(tenantId, id, acteurDe(appel), principaleId, traceDe(appel));
    return this.fiche(appel, id);
  }

  async renvoyerLienSuivi(appel: Appel, id: string): Promise<S<'LienSuiviRenvoye'>> {
    const tenantId = await this.exigerVisible(appel, id);
    await this.limiteur.consommer(LIMITES.lienSuiviParReclamation, id, 'Lien déjà renvoyé trois fois en une heure : réessayez plus tard');
    const envois = (await this.cycle.renvoyerLienSuivi(tenantId, id, acteurDe(appel), traceDe(appel)))!;
    return {
      envois: envois.map((x) => ({
        canal: x.canal as 'SMS' | 'EMAIL' | 'WHATSAPP',
        destinationMasquee: masquer(x.canal === 'EMAIL' ? 'EMAIL' : 'SMS', x.destination),
      })),
    };
  }

  /** Étape 22 : un message au client non remis, renvoyé tel quel, 3 fois par heure et par réclamation. */
  async renvoyerMessage(appel: Appel, id: string, envoiId: string): Promise<S<'ReclamationDetail'>> {
    const tenantId = await this.exigerVisible(appel, id);
    await this.limiteur.consommer(LIMITES.renvoiParReclamation, id, 'Trois messages déjà renvoyés en une heure : réessayez plus tard');
    await this.cycle.renvoyerMessage(tenantId, id, acteurDe(appel), envoiId, traceDe(appel));
    return this.fiche(appel, id);
  }

  /**
   * Étape 21 : plusieurs réclamations à un agent, ou réparties entre les agents disponibles les moins
   * chargés. Chacune comme une assignation (machine d'états, chronologie, journal, notification) ;
   * celles qui ne peuvent pas l'être sont laissées, avec la raison.
   */
  async assignerEnLot(appel: Appel, corps: { reclamationIds: string[]; agentId?: string; repartir?: boolean }): Promise<S<'ResultatAssignationEnLot'>> {
    const moi = personnelBanque(appel);
    if (!!corps.agentId === (corps.repartir === true)) {
      throw invalide([{ champ: 'agentId', message: 'Choisissez un agent, ou de répartir entre les agents disponibles' }]);
    }
    const acteur = acteurDe(appel);
    const maintenant = this.horloge();
    const tickets = await this.bd.enBanque(moi.tenantId, (tx) => tx.reclamation.findMany({
      where: { id: { in: corps.reclamationIds } },
      select: { id: true, numero: true, statut: true, agentId: true, clientId: true, categorieId: true, agenceId: true, clotureAutoPrevueLe: true },
      orderBy: [{ creeLe: 'asc' }, { id: 'asc' }],
    }));
    const laissees: S<'ResultatAssignationEnLot'>['laissees'] = corps.reclamationIds
      .filter((id) => !tickets.some((t) => t.id === id)).map((id) => ({ id, numero: null, raison: 'Réclamation introuvable' }));
    const assignees: S<'ResultatAssignationEnLot'>['assignees'] = [];
    let cible: Map<string, { id: string; nom: string } | null>;
    if (corps.agentId) {
      const a = await this.bd.enBanque(moi.tenantId, (tx) => tx.utilisateur.findFirst({ where: { id: corps.agentId, role: 'AGENT', statut: 'ACTIF' }, select: { id: true, nom: true, prenom: true } }));
      if (!a) throw new ErreurMetier('AGENT_INVALIDE', 'L\'agent doit être un agent actif de la banque', 422);
      cible = new Map(tickets.map((t) => [t.id, { id: a.id, nom: nomComplet(a) }]));
    } else {
      const ctx = await this.bd.enBanque(moi.tenantId, async (tx) => chargerContexteRepartition(tx, await chargerParametres(tx, moi.tenantId), maintenant));
      cible = repartir(tickets.filter((t) => t.statut !== 'CLOTUREE'), ctx);
    }
    for (const t of tickets) {
      const a = cible.get(t.id) ?? null;
      if (t.statut === 'CLOTUREE') laissees.push({ id: t.id, numero: t.numero, raison: 'Réclamation clôturée' });
      else if (!a) laissees.push({ id: t.id, numero: t.numero, raison: 'Aucun agent disponible' });
      else if (a.id === t.agentId) laissees.push({ id: t.id, numero: t.numero, raison: 'Déjà assignée à cet agent' });
      else {
        try {
          await this.cycle.assigner(moi.tenantId, t.id, acteur, a.id, traceDe(appel));
          assignees.push({ id: t.id, numero: t.numero, agent: { id: a.id, nom: a.nom } });
        } catch (err) {
          if (!(err instanceof ErreurMetier)) throw err;
          laissees.push({ id: t.id, numero: t.numero, raison: err.message });
        }
      }
    }
    return { assignees, laissees };
  }

  async fiche(appel: Appel, id: string): Promise<S<'ReclamationDetail'>> {
    const moi = personnelBanque(appel);
    return this.bd.enBanque(moi.tenantId, async (tx) => {
      const p = await chargerParametres(tx, moi.tenantId);
      return lireFiche(tx, id, acteurDe(appel), this.horloge(), p);
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
    const { fichiers, annuler } = await stockerPiecesJointes(this.stockage, this.antivirus, tenantId, e.fichiers, this.horloge());
    await avecFichiers(annuler, () => this.cycle.repondreAuClient(
      tenantId, id, acteurDe(appel), String(e.corps.contenu), { attendreReponse: e.corps.attendreReponse === true, fichiers }, traceDe(appel),
    ));
    return this.fiche(appel, id);
  }

  async note(appel: Appel, id: string, e: Entrees) {
    const tenantId = await this.exigerVisible(appel, id);
    const { fichiers, annuler } = await stockerPiecesJointes(this.stockage, this.antivirus, tenantId, e.fichiers, this.horloge());
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
    const p = await this.bd.enBanque(tenantId, (tx) => tx.pieceJointe.findFirst({ where: { id: pieceId, reclamationId: id }, select: { cleStockage: true, nomFichier: true, antivirus: true } }));
    if (p) exigerSaine(p);
    const contenu = p ? await this.stockage.lire(p.cleStockage) : null;
    if (!p || !contenu) throw introuvable('Pièce jointe introuvable');
    return telechargement(contenu, p.nomFichier);
  }
}

/**
 * Filtres d'une file (§6.2) : ceux de la liste, repris tels quels par l'export CSV (étape 9).
 * Un agent ne voit que ses tickets.
 */
export function filtresReclamations(moi: Personnel & { tenantId: string }, q: Record<string, unknown>, maintenant: Date, indisponibles: readonly string[] = []) {
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
    // Étape 21 : dossiers d'un agent désactivé ou absent aujourd'hui (vide pour un agent)
    'a-reassigner': agent ? { id: { in: [] } } : { agentId: { in: [...indisponibles] }, ...NON_CLOTUREE },
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
  return { where: { AND: filtres } as Where, visibles, parFile, agent };
}

/** Étape 21 : les agents désactivés ou absents, pour la file « à réassigner » (aussi pour l'export). */
export async function indisponiblesPour(tx: Parameters<typeof agentsIndisponibles>[0], p: ParametresBanque, moi: Personnel, maintenant: Date) {
  return moi.role === 'AGENT' ? [] : agentsIndisponibles(tx, p, maintenant);
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

  @Operation('saisirReclamation')
  saisir(@AppelCourant() a: Appel, @EntreesValidees() e: Entrees) {
    return this.service.saisir(a, e);
  }

  @Operation('rattacherReclamation')
  rattacher(@AppelCourant() a: Appel, @EntreesValidees() e: Entrees) {
    return this.service.rattacher(a, e.chemin.id, String(e.corps.principaleId));
  }

  @Operation('renvoyerLienSuivi')
  renvoyerLienSuivi(@AppelCourant() a: Appel, @EntreesValidees() e: Entrees) {
    return this.service.renvoyerLienSuivi(a, e.chemin.id);
  }

  @Operation('renvoyerMessage')
  renvoyerMessage(@AppelCourant() a: Appel, @EntreesValidees() e: Entrees) {
    return this.service.renvoyerMessage(a, e.chemin.id, e.chemin.envoiId);
  }

  @Operation('assignerEnLot')
  assignerEnLot(@AppelCourant() a: Appel, @EntreesValidees() e: Entrees) {
    return this.service.assignerEnLot(a, e.corps as { reclamationIds: string[]; agentId?: string; repartir?: boolean });
  }

  @Operation('telechargerPieceJointe')
  async piece(@AppelCourant() a: Appel, @EntreesValidees() e: Entrees, @Res() res: Response) {
    envoyerFichier(res, await this.service.piece(a, e.chemin.id, e.chemin.pieceId));
  }
}

@Module({ controllers: [ReclamationsControleur], providers: [ServiceReclamations] })
export class ReclamationsModule {}
