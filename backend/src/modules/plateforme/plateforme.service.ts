/**
 * Console de la plateforme (Super Admin, §6.7, décisions C12 et C13) : banques, plans, journal
 * d'audit de toutes les banques, alertes, comptes Super Admin. Métadonnées seulement : le rôle
 * PostgreSQL de la plateforme ne peut pas lire le contenu d'une réclamation (arbitrage 7).
 */
import { Inject, Injectable } from '@nestjs/common';
import { DateTime } from 'luxon';
import type { Prisma } from '../../generated/prisma/client.js';
import { CONFIGURATION, type Configuration } from '../../configuration/configuration.js';
import { journaliser } from '../../infrastructure/audit/journal.js';
import { BaseDonnees, type ClientTransaction } from '../../infrastructure/base-de-donnees/base-de-donnees.service.js';
import { enSerie } from '../../infrastructure/base-de-donnees/index.js';
import { personnelDe, traceDe, type Appel } from '../../infrastructure/contrat/appel.js';
import { introuvable, invalideChamp, Probleme } from '../../infrastructure/contrat/probleme.js';
import { HORLOGE, type Horloge } from '../../noyau/noyau.module.js';
import { verifierChaine, pageAudit } from '../audit/audit.controller.js';
import { envoyerInvitation, nouveauJeton } from '../auth/liens.js';
import { pageDe, pagination, type S } from '../commun.js';
import { marquerLue, pageNotifications } from '../notifications/notifications.controller.js';
import { unique } from '../parametrage/parametrage.service.js';
import { SELECTION_UTILISATEUR, telephoneValide, vueUtilisateur } from '../personnel/personnel.service.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Horaires par défaut d'une nouvelle banque : lundi–vendredi 08:00–17:00 (décision C13) */
const HORAIRES_PAR_DEFAUT = [1, 2, 3, 4, 5].map((jourSemaine) => ({ jourSemaine, debutMinute: 8 * 60, finMinute: 17 * 60 }));

const SELECTION_BANQUE = {
  id: true, nom: true, slug: true, prefixeTickets: true, fuseauHoraire: true, seuilAlerteSlaPourcent: true, delaiClotureAutoJours: true,
  smsChaqueChangementStatut: true, suspendueLe: true, motifSuspension: true, creeLe: true, plan: { select: { id: true, nom: true } },
} as const satisfies Prisma.BanqueSelect;

type BanqueLue = Prisma.BanqueGetPayload<{ select: typeof SELECTION_BANQUE }>;

const fuseauValide = (fuseau: string) => DateTime.now().setZone(fuseau).isValid;

@Injectable()
export class ServicePlateforme {
  constructor(
    @Inject(BaseDonnees) private readonly bd: BaseDonnees,
    @Inject(CONFIGURATION) private readonly config: Configuration,
    @Inject(HORLOGE) private readonly horloge: Horloge,
  ) {}

  private audit(tx: ClientTransaction, appel: Appel, action: string, entite: string, entiteId: string | null, donnees?: Record<string, unknown>) {
    return journaliser(tx, { tenantId: null, acteur: personnelDe(appel), action, entite, entiteId, donnees, trace: traceDe(appel) });
  }

  // ---- Banques --------------------------------------------------------------------

  private async vueBanque(tx: ClientTransaction, b: BanqueLue): Promise<S<'BanquePlateforme'>> {
    const debutMois = DateTime.fromJSDate(this.horloge(), { zone: b.fuseauHoraire }).startOf('month').toJSDate();
    const [agents, ticketsCeMois] = await enSerie([
      () => tx.utilisateur.count({ where: { tenantId: b.id, role: { in: ['AGENT', 'SUPERVISEUR'] }, statut: { not: 'DESACTIVE' } } }),
      () => tx.reclamation.count({ where: { tenantId: b.id, creeLe: { gte: debutMois } } }),
    ]);
    return {
      id: b.id, nom: b.nom, slug: b.slug, prefixeTickets: b.prefixeTickets, plan: { id: b.plan.id, nom: b.plan.nom },
      fuseauHoraire: b.fuseauHoraire, seuilAlerteSlaPourcent: b.seuilAlerteSlaPourcent, delaiClotureAutoJours: b.delaiClotureAutoJours,
      smsChaqueChangementStatut: b.smsChaqueChangementStatut, suspendueLe: b.suspendueLe?.toISOString() ?? null,
      motifSuspension: b.motifSuspension, creeLe: b.creeLe.toISOString(), consommation: { agents, ticketsCeMois },
    };
  }

  private async banque(tx: ClientTransaction, id: string): Promise<S<'BanquePlateforme'>> {
    const b = await tx.banque.findUnique({ where: { id }, select: SELECTION_BANQUE });
    if (!b) throw introuvable('Banque introuvable');
    return this.vueBanque(tx, b);
  }

  listerBanques(q: Record<string, unknown>): Promise<S<'PageBanques'>> {
    const { page, parPage, skip, take } = pagination(q);
    const r = q.recherche ? String(q.recherche).trim() : '';
    const where: Prisma.BanqueWhereInput = r
      ? { OR: [{ nom: { contains: r, mode: 'insensitive' } }, { slug: { contains: r.toLowerCase() } }, { prefixeTickets: { contains: r.toUpperCase() } }] }
      : {};
    return this.bd.enPlateforme(async (tx) => {
      const [total, lignes] = await enSerie([
        () => tx.banque.count({ where }),
        () => tx.banque.findMany({ where, select: SELECTION_BANQUE, orderBy: [{ nom: 'asc' }], skip, take }),
      ]);
      const vues: S<'BanquePlateforme'>[] = [];
      for (const b of lignes) vues.push(await this.vueBanque(tx, b));
      return pageDe(vues, page, parPage, total);
    });
  }

  lireBanque(id: string) {
    return this.bd.enPlateforme((tx) => this.banque(tx, id));
  }

  /** Crée la banque, ses horaires par défaut et invite son premier Admin Entreprise, en une transaction. */
  creerBanque(appel: Appel, c: { nom: string; slug: string; prefixeTickets: string; planId: string; fuseauHoraire?: string; administrateur: { email: string; nom: string; prenom: string; telephone?: string | null } }) {
    const fuseau = c.fuseauHoraire ?? 'Africa/Abidjan';
    if (!fuseauValide(fuseau)) throw invalideChamp('fuseauHoraire', 'Fuseau horaire inconnu (ex. Africa/Abidjan)');
    const email = c.administrateur.email.trim().toLowerCase();
    const telephone = telephoneValide(c.administrateur.telephone);
    const maintenant = this.horloge();
    return this.bd.enSysteme(async (tx) => {
      const plan = await tx.plan.findFirst({ where: { id: c.planId, actif: true }, select: { id: true } });
      if (!plan) throw invalideChamp('planId', 'Plan inconnu ou retiré');
      if (await tx.banque.findUnique({ where: { slug: c.slug }, select: { id: true } })) throw new Probleme(409, 'SLUG_DEJA_UTILISE', `L'adresse « ${c.slug} » est déjà prise`);
      if (await tx.banque.findUnique({ where: { prefixeTickets: c.prefixeTickets }, select: { id: true } })) throw new Probleme(409, 'PREFIXE_DEJA_UTILISE', `Le préfixe « ${c.prefixeTickets} » est déjà pris`);
      if (await tx.utilisateur.findUnique({ where: { email }, select: { id: true } })) throw new Probleme(409, 'EMAIL_DEJA_UTILISE', `L'adresse ${email} a déjà un compte`);
      const b = await tx.banque.create({ data: { nom: c.nom.trim(), slug: c.slug, prefixeTickets: c.prefixeTickets, planId: plan.id, fuseauHoraire: fuseau }, select: { id: true, nom: true } });
      await tx.horaireOuvre.createMany({ data: HORAIRES_PAR_DEFAUT.map((h) => ({ ...h, tenantId: b.id })) });
      const admin = await tx.utilisateur.create({
        data: { tenantId: b.id, role: 'ADMIN_ENTREPRISE', statut: 'INVITE', email, nom: c.administrateur.nom.trim(), prenom: c.administrateur.prenom.trim(), telephone },
        select: { id: true, tenantId: true, email: true, prenom: true },
      });
      await envoyerInvitation(tx, this.config, admin, b.nom, await nouveauJeton(tx, admin.id, 'INVITATION', maintenant));
      await this.audit(tx, appel, 'plateforme.banque_creee', 'banque', b.id, { slug: c.slug, prefixe: c.prefixeTickets, planId: plan.id, administrateurId: admin.id });
      return this.banque(tx, b.id);
    });
  }

  modifierBanque(appel: Appel, id: string, m: { nom?: string; planId?: string; fuseauHoraire?: string; seuilAlerteSlaPourcent?: number; delaiClotureAutoJours?: number; smsChaqueChangementStatut?: boolean }) {
    if (m.fuseauHoraire && !fuseauValide(m.fuseauHoraire)) throw invalideChamp('fuseauHoraire', 'Fuseau horaire inconnu (ex. Africa/Abidjan)');
    return this.bd.enPlateforme(async (tx) => {
      const avant = await tx.banque.findUnique({ where: { id }, select: SELECTION_BANQUE });
      if (!avant) throw introuvable('Banque introuvable');
      if (m.planId && !(await tx.plan.findFirst({ where: { id: m.planId, actif: true }, select: { id: true } }))) throw invalideChamp('planId', 'Plan inconnu ou retiré');
      await tx.banque.update({ where: { id }, data: { ...m, ...(m.nom ? { nom: m.nom.trim() } : {}) } });
      await this.audit(tx, appel, 'plateforme.banque_modifiee', 'banque', id, {
        champs: Object.keys(m), ...(m.planId && m.planId !== avant.plan.id ? { planAvant: avant.plan.id, planApres: m.planId } : {}),
      });
      return this.banque(tx, id);
    });
  }

  suspendre(appel: Appel, id: string, motif: string) {
    return this.bd.enPlateforme(async (tx) => {
      const b = await tx.banque.findUnique({ where: { id }, select: { suspendueLe: true } });
      if (!b) throw introuvable('Banque introuvable');
      await tx.banque.update({ where: { id }, data: { suspendueLe: b.suspendueLe ?? this.horloge(), motifSuspension: motif.trim() } });
      await this.audit(tx, appel, 'plateforme.banque_suspendue', 'banque', id);
      return this.banque(tx, id);
    });
  }

  reactiver(appel: Appel, id: string) {
    return this.bd.enPlateforme(async (tx) => {
      if (!(await tx.banque.findUnique({ where: { id }, select: { id: true } }))) throw introuvable('Banque introuvable');
      await tx.banque.update({ where: { id }, data: { suspendueLe: null, motifSuspension: null } });
      await this.audit(tx, appel, 'plateforme.banque_reactivee', 'banque', id);
      return this.banque(tx, id);
    });
  }

  // ---- Plans ------------------------------------------------------------------------

  private plan = (p: { id: string; code: string; nom: string; description: string | null; plafondAgents: number | null; plafondTicketsMois: number | null; actif: boolean }): S<'Plan'> =>
    ({ id: p.id, code: p.code, nom: p.nom, description: p.description, plafondAgents: p.plafondAgents, plafondTicketsMois: p.plafondTicketsMois, actif: p.actif });

  listerPlans() {
    return this.bd.enPlateforme(async (tx) => (await tx.plan.findMany({ orderBy: [{ actif: 'desc' }, { nom: 'asc' }] })).map(this.plan));
  }

  creerPlan(appel: Appel, p: { code: string; nom: string; description?: string | null; plafondAgents?: number | null; plafondTicketsMois?: number | null }) {
    return this.bd.enPlateforme(async (tx) => {
      const cree = await unique(() => tx.plan.create({
        data: { code: p.code, nom: p.nom.trim(), description: p.description ?? null, plafondAgents: p.plafondAgents ?? null, plafondTicketsMois: p.plafondTicketsMois ?? null },
      }), () => new Probleme(409, 'CODE_DEJA_UTILISE', `Le plan « ${p.code} » existe déjà`));
      await this.audit(tx, appel, 'plateforme.plan_cree', 'plan', cree.id, { code: cree.code, plafondAgents: cree.plafondAgents, plafondTicketsMois: cree.plafondTicketsMois });
      return this.plan(cree);
    });
  }

  modifierPlan(appel: Appel, id: string, m: { nom?: string; description?: string | null; plafondAgents?: number | null; plafondTicketsMois?: number | null; actif?: boolean }) {
    return this.bd.enPlateforme(async (tx) => {
      if (!(await tx.plan.findUnique({ where: { id }, select: { id: true } }))) throw introuvable('Plan introuvable');
      const modifie = await tx.plan.update({ where: { id }, data: { ...m, ...(m.nom ? { nom: m.nom.trim() } : {}) } });
      await this.audit(tx, appel, 'plateforme.plan_modifie', 'plan', id, { champs: Object.keys(m) });
      return this.plan(modifie);
    });
  }

  // ---- Journal d'audit ------------------------------------------------------------------

  listerJournal(q: Record<string, unknown>) {
    const banqueId = q.banqueId ? String(q.banqueId) : null;
    if (banqueId && banqueId !== 'plateforme' && !UUID.test(banqueId)) throw invalideChamp('banqueId', '« plateforme » ou identifiant de banque attendu');
    const base: Prisma.JournalAuditWhereInput = !banqueId ? {} : { chaine: banqueId === 'plateforme' ? 'plateforme' : `banque:${banqueId.toLowerCase()}` };
    return this.bd.enPlateforme((tx) => pageAudit(tx, base, q));
  }

  verifierJournal(chaine: string) {
    if (!/^(plateforme|banque:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.test(chaine)) {
      throw invalideChamp('chaine', '« plateforme » ou « banque:<identifiant> » attendu');
    }
    return this.bd.enPlateforme((tx) => verifierChaine(tx, chaine));
  }

  // ---- Alertes (métadonnées) et Super Admins ------------------------------------------------

  notifications(appel: Appel, q: Record<string, unknown>) {
    const moi = personnelDe(appel);
    return this.bd.enPlateforme((tx) => pageNotifications(tx, moi.id, q));
  }

  async notificationLue(appel: Appel, id: string) {
    const moi = personnelDe(appel);
    await this.bd.enPlateforme((tx) => marquerLue(tx, moi.id, id, this.horloge()));
  }

  listerSuperAdmins() {
    return this.bd.enPlateforme(async (tx) =>
      (await tx.utilisateur.findMany({ where: { role: 'SUPER_ADMIN' }, select: SELECTION_UTILISATEUR, orderBy: [{ nom: 'asc' }] })).map(vueUtilisateur));
  }

  inviterSuperAdmin(appel: Appel, p: { email: string; nom: string; prenom: string; telephone?: string | null }) {
    const email = p.email.trim().toLowerCase();
    const telephone = telephoneValide(p.telephone);
    const maintenant = this.horloge();
    return this.bd.enSysteme(async (tx) => {
      if (await tx.utilisateur.findUnique({ where: { email }, select: { id: true } })) throw new Probleme(409, 'EMAIL_DEJA_UTILISE', `L'adresse ${email} a déjà un compte`);
      const u = await tx.utilisateur.create({
        data: { tenantId: null, role: 'SUPER_ADMIN', statut: 'INVITE', email, nom: p.nom.trim(), prenom: p.prenom.trim(), telephone },
        select: { id: true, tenantId: true, email: true, prenom: true },
      });
      await envoyerInvitation(tx, this.config, u, null, await nouveauJeton(tx, u.id, 'INVITATION', maintenant));
      await this.audit(tx, appel, 'plateforme.super_admin_invite', 'utilisateur', u.id);
      return vueUtilisateur(await tx.utilisateur.findUniqueOrThrow({ where: { id: u.id }, select: SELECTION_UTILISATEUR }));
    });
  }
}
