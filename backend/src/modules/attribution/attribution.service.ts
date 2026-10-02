/**
 * Attribution et escalade automatiques (phase 2, étape 16) : règles de traitement, groupes d'agents
 * et absences. Fonction ouverte banque par banque par Makor (décision I2) : fermée, ces opérations
 * répondent 403 FONCTION_NON_OUVERTE. Chaque modification est inscrite au journal d'audit.
 */
import { Inject, Injectable } from '@nestjs/common';
import { DateTime } from 'luxon';
import type { ModeAttribution } from '../../domaine/attribution.js';
import { dateLocale } from '../../domaine/temps-ouvre/calendrier.js';
import { absentsLe, charges } from '../../application/reclamations/attribution.js';
import { chargerParametres } from '../../application/reclamations/parametres.js';
import { journaliser } from '../../infrastructure/audit/journal.js';
import { BaseDonnees, type ClientTransaction } from '../../infrastructure/base-de-donnees/base-de-donnees.service.js';
import { enSerie } from '../../infrastructure/base-de-donnees/index.js';
import { personnelBanque, traceDe, type Appel, type Personnel } from '../../infrastructure/contrat/appel.js';
import { introuvable, Probleme } from '../../infrastructure/contrat/probleme.js';
import { HORLOGE, type Horloge } from '../../noyau/noyau.module.js';
import { unique } from '../parametrage/parametrage.service.js';
import type { S } from '../commun.js';

type Moi = Personnel & { tenantId: string };
type Seuil = number | null;

export interface ModificationRegles {
  mode?: ModeAttribution;
  seuilEscaladeAdminPourcent?: Seuil;
  seuilEscaladeAdminUrgentPourcent?: Seuil;
  categories?: { id: string; groupeId: string | null; seuilEscaladeAdminPourcent: Seuil; seuilEscaladeAdminUrgentPourcent: Seuil }[];
  agences?: { id: string; groupeId: string | null }[];
}

const DUREE_MAX_ABSENCE_JOURS = 366;
const nom = (u: { prenom: string; nom: string }) => `${u.prenom} ${u.nom}`;
const jourIso = (d: Date) => d.toISOString().slice(0, 10);
const reference = (o: { id: string; nom: string }) => ({ id: o.id, nom: o.nom });

@Injectable()
export class ServiceAttribution {
  constructor(
    @Inject(BaseDonnees) private readonly bd: BaseDonnees,
    @Inject(HORLOGE) private readonly horloge: Horloge,
  ) {}

  /** Transaction de la banque de l'appelant, la fonction devant être ouverte par Makor. */
  private dans<T>(appel: Appel, travail: (tx: ClientTransaction, moi: Moi) => Promise<T>): Promise<T> {
    const moi = personnelBanque(appel);
    return this.bd.enBanque(moi.tenantId, async (tx) => {
      const b = await tx.banque.findUniqueOrThrow({ where: { id: moi.tenantId }, select: { attributionAutomatique: true } });
      if (!b.attributionAutomatique) {
        throw new Probleme(403, 'FONCTION_NON_OUVERTE', 'L\'attribution automatique n\'est pas ouverte à votre banque : adressez-vous à Makor');
      }
      return travail(tx, moi);
    });
  }

  private audit(tx: ClientTransaction, moi: Moi, appel: Appel, action: string, entite: string, entiteId: string | null, donnees?: Record<string, unknown>) {
    return journaliser(tx, { tenantId: moi.tenantId, acteur: moi, action, entite, entiteId, donnees, trace: traceDe(appel) });
  }

  /** Aujourd'hui dans le fuseau de la banque (AAAA-MM-JJ). */
  private async aujourdhui(tx: ClientTransaction, tenantId: string): Promise<string> {
    const p = await chargerParametres(tx, tenantId);
    return dateLocale(this.horloge(), p.sla.calendrier);
  }

  // ---- Règles de traitement -----------------------------------------------------------

  private async regles(tx: ClientTransaction, tenantId: string): Promise<S<'ReglesTraitement'>> {
    const [b, categories, agences] = await enSerie([
      () => tx.banque.findUniqueOrThrow({
        where: { id: tenantId }, select: { modeAttribution: true, seuilEscaladeAdminPourcent: true, seuilEscaladeAdminUrgentPourcent: true },
      }),
      () => tx.categorie.findMany({ orderBy: [{ ordre: 'asc' }, { nom: 'asc' }], include: { groupe: { select: { id: true, nom: true } } } }),
      () => tx.agence.findMany({ orderBy: [{ code: 'asc' }], include: { groupe: { select: { id: true, nom: true } } } }),
    ]);
    return {
      mode: b.modeAttribution,
      seuilEscaladeAdminPourcent: b.seuilEscaladeAdminPourcent,
      seuilEscaladeAdminUrgentPourcent: b.seuilEscaladeAdminUrgentPourcent,
      categories: categories.map((c) => ({
        categorie: reference(c), active: c.active, groupe: c.groupe ? reference(c.groupe) : null,
        seuilEscaladeAdminPourcent: c.seuilEscaladeAdminPourcent, seuilEscaladeAdminUrgentPourcent: c.seuilEscaladeAdminUrgentPourcent,
      })),
      agences: agences.map((a) => ({ agence: reference(a), active: a.active, groupe: a.groupe ? reference(a.groupe) : null })),
    };
  }

  lireRegles(appel: Appel) {
    return this.dans(appel, (tx, moi) => this.regles(tx, moi.tenantId));
  }

  modifierRegles(appel: Appel, m: ModificationRegles) {
    return this.dans(appel, async (tx, moi) => {
      const groupes = new Set((await tx.groupeAgents.findMany({ select: { id: true } })).map((g) => g.id));
      const cites = [...(m.categories ?? []), ...(m.agences ?? [])].map((x) => x.groupeId).filter((g): g is string => g !== null);
      const inconnu = cites.find((g) => !groupes.has(g));
      if (inconnu) throw new Probleme(422, 'GROUPE_INVALIDE', 'Groupe d\'agents inconnu : rechargez la page');
      if (m.categories?.length) {
        const ids = new Set(m.categories.map((c) => c.id));
        if ((await tx.categorie.count({ where: { id: { in: [...ids] } } })) !== ids.size) throw introuvable('Catégorie introuvable');
      }
      if (m.agences?.length) {
        const ids = new Set(m.agences.map((a) => a.id));
        if ((await tx.agence.count({ where: { id: { in: [...ids] } } })) !== ids.size) throw introuvable('Agence introuvable');
      }

      const banque = {
        ...(m.mode !== undefined ? { modeAttribution: m.mode } : {}),
        ...(m.seuilEscaladeAdminPourcent !== undefined ? { seuilEscaladeAdminPourcent: m.seuilEscaladeAdminPourcent } : {}),
        ...(m.seuilEscaladeAdminUrgentPourcent !== undefined ? { seuilEscaladeAdminUrgentPourcent: m.seuilEscaladeAdminUrgentPourcent } : {}),
      };
      if (Object.keys(banque).length) await tx.banque.update({ where: { id: moi.tenantId }, data: banque });
      for (const c of m.categories ?? []) {
        await tx.categorie.update({
          where: { id: c.id },
          data: { groupeId: c.groupeId, seuilEscaladeAdminPourcent: c.seuilEscaladeAdminPourcent, seuilEscaladeAdminUrgentPourcent: c.seuilEscaladeAdminUrgentPourcent },
        });
      }
      for (const a of m.agences ?? []) await tx.agence.update({ where: { id: a.id }, data: { groupeId: a.groupeId } });

      await this.audit(tx, moi, appel, 'parametrage.regles_traitement', 'banque', moi.tenantId, {
        champs: Object.keys(banque), ...(m.mode ? { mode: m.mode } : {}),
        categories: m.categories?.length ?? 0, agences: m.agences?.length ?? 0,
      });
      return this.regles(tx, moi.tenantId);
    });
  }

  // ---- Groupes d'agents ------------------------------------------------------------------

  private async groupes(tx: ClientTransaction, tenantId: string, id?: string): Promise<S<'GroupeAgents'>[]> {
    const groupes = await tx.groupeAgents.findMany({
      where: id ? { id } : {},
      orderBy: { nom: 'asc' },
      include: {
        membres: { include: { utilisateur: { select: { id: true, prenom: true, nom: true, statut: true } } } },
        categories: { select: { id: true, nom: true }, orderBy: [{ ordre: 'asc' }, { nom: 'asc' }] },
        agences: { select: { id: true, nom: true }, orderBy: { code: 'asc' } },
      },
    });
    const membres = [...new Set(groupes.flatMap((g) => g.membres.map((m) => m.utilisateurId)))];
    const jour = await this.aujourdhui(tx, tenantId);
    const [absents, aTraiter] = await enSerie([() => absentsLe(tx, jour, membres), () => charges(tx, membres)]);
    return groupes.map((g) => ({
      id: g.id,
      nom: g.nom,
      membres: g.membres
        .map((m) => ({ id: m.utilisateur.id, nom: nom(m.utilisateur), statut: m.utilisateur.statut, absent: absents.has(m.utilisateurId), aTraiter: aTraiter.get(m.utilisateurId) ?? 0 }))
        .sort((a, b) => a.nom.localeCompare(b.nom, 'fr')),
      categories: g.categories.map(reference),
      agences: g.agences.map(reference),
    }));
  }

  /** Les membres d'un groupe sont des agents de la banque dont le compte n'est pas désactivé. */
  private async verifierMembres(tx: ClientTransaction, membres: readonly string[]) {
    if (membres.length === 0) return;
    const agents = await tx.utilisateur.count({ where: { id: { in: [...membres] }, role: 'AGENT', statut: { not: 'DESACTIVE' } } });
    if (agents !== new Set(membres).size) throw new Probleme(422, 'AGENT_INVALIDE', 'Un membre n\'est pas un agent actif ou invité de la banque');
  }

  private nomPris = (n: string) => () => new Probleme(409, 'NOM_DEJA_UTILISE', `Le groupe « ${n} » existe déjà`);

  listerGroupes(appel: Appel) {
    return this.dans(appel, (tx, moi) => this.groupes(tx, moi.tenantId));
  }

  creerGroupe(appel: Appel, g: { nom: string; membres: string[] }) {
    return this.dans(appel, async (tx, moi) => {
      await this.verifierMembres(tx, g.membres);
      const n = g.nom.trim();
      const cree = await unique(() => tx.groupeAgents.create({ data: { tenantId: moi.tenantId, nom: n } }), this.nomPris(n));
      await tx.groupeAgentsMembre.createMany({ data: g.membres.map((utilisateurId) => ({ tenantId: moi.tenantId, groupeId: cree.id, utilisateurId })) });
      await this.audit(tx, moi, appel, 'parametrage.groupe_cree', 'groupe_agents', cree.id, { membres: g.membres.length });
      return (await this.groupes(tx, moi.tenantId, cree.id))[0]!;
    });
  }

  modifierGroupe(appel: Appel, id: string, m: { nom?: string; membres?: string[] }) {
    return this.dans(appel, async (tx, moi) => {
      if (!(await tx.groupeAgents.findUnique({ where: { id }, select: { id: true } }))) throw introuvable('Groupe introuvable');
      if (m.nom !== undefined) {
        const n = m.nom.trim();
        await unique(() => tx.groupeAgents.update({ where: { id }, data: { nom: n } }), this.nomPris(n));
      }
      if (m.membres) {
        await this.verifierMembres(tx, m.membres);
        await tx.groupeAgentsMembre.deleteMany({ where: { groupeId: id } });
        await tx.groupeAgentsMembre.createMany({ data: m.membres.map((utilisateurId) => ({ tenantId: moi.tenantId, groupeId: id, utilisateurId })) });
      }
      await this.audit(tx, moi, appel, 'parametrage.groupe_modifie', 'groupe_agents', id, {
        champs: Object.keys(m), ...(m.membres ? { membres: m.membres.length } : {}),
      });
      return (await this.groupes(tx, moi.tenantId, id))[0]!;
    });
  }

  supprimerGroupe(appel: Appel, id: string) {
    return this.dans(appel, async (tx, moi) => {
      if (!(await tx.groupeAgents.findUnique({ where: { id }, select: { id: true } }))) throw introuvable('Groupe introuvable');
      const [categories, agences] = await enSerie([
        () => tx.categorie.updateMany({ where: { groupeId: id }, data: { groupeId: null } }),
        () => tx.agence.updateMany({ where: { groupeId: id }, data: { groupeId: null } }),
      ]);
      await tx.groupeAgentsMembre.deleteMany({ where: { groupeId: id } });
      await tx.groupeAgents.delete({ where: { id } });
      await this.audit(tx, moi, appel, 'parametrage.groupe_supprime', 'groupe_agents', id, { categories: categories.count, agences: agences.count });
    });
  }

  // ---- Absences ------------------------------------------------------------------------------

  private vueAbsence = (a: { id: string; du: Date; au: Date; creeLe: Date; utilisateur: { id: string; prenom: string; nom: string } }): S<'Absence'> =>
    ({ id: a.id, agent: { id: a.utilisateur.id, nom: nom(a.utilisateur) }, du: jourIso(a.du), au: jourIso(a.au), creeLe: a.creeLe.toISOString() });

  private static readonly AGENT = { select: { id: true, prenom: true, nom: true } } as const;

  listerAbsences(appel: Appel) {
    return this.dans(appel, async (tx, moi) => {
      const jour = await this.aujourdhui(tx, moi.tenantId);
      const absences = await tx.absenceAgent.findMany({
        where: { au: { gte: new Date(`${jour}T00:00:00Z`) } },
        include: { utilisateur: ServiceAttribution.AGENT },
        orderBy: [{ du: 'asc' }, { au: 'asc' }, { id: 'asc' }],
      });
      return absences.map(this.vueAbsence);
    });
  }

  ajouterAbsence(appel: Appel, a: { agentId: string; du: string; au: string }) {
    return this.dans(appel, async (tx, moi) => {
      const agent = await tx.utilisateur.findFirst({ where: { id: a.agentId, role: 'AGENT', statut: { not: 'DESACTIVE' } }, select: { id: true } });
      if (!agent) throw new Probleme(422, 'AGENT_INVALIDE', 'Seul un agent de la banque peut être déclaré absent');
      const jour = await this.aujourdhui(tx, moi.tenantId);
      const du = DateTime.fromISO(a.du, { zone: 'utc' });
      const au = DateTime.fromISO(a.au, { zone: 'utc' });
      if (au < du) throw new Probleme(422, 'ABSENCE_INVALIDE', 'Le dernier jour précède le premier');
      if (a.au < jour) throw new Probleme(422, 'ABSENCE_INVALIDE', 'Cette absence est déjà passée');
      if (au.diff(du, 'days').days > DUREE_MAX_ABSENCE_JOURS) throw new Probleme(422, 'ABSENCE_INVALIDE', 'Une absence dure au plus un an');
      const creee = await tx.absenceAgent.create({
        data: { tenantId: moi.tenantId, utilisateurId: agent.id, du: du.toJSDate(), au: au.toJSDate() },
        include: { utilisateur: ServiceAttribution.AGENT },
      });
      await this.audit(tx, moi, appel, 'personnel.absence_ajoutee', 'absence_agent', creee.id, { agentId: agent.id, du: a.du, au: a.au });
      return this.vueAbsence(creee);
    });
  }

  supprimerAbsence(appel: Appel, id: string) {
    return this.dans(appel, async (tx, moi) => {
      const a = await tx.absenceAgent.findUnique({ where: { id } });
      if (!a) throw introuvable('Absence introuvable');
      await tx.absenceAgent.delete({ where: { id } });
      await this.audit(tx, moi, appel, 'personnel.absence_retiree', 'absence_agent', id, { agentId: a.utilisateurId, du: jourIso(a.du), au: jourIso(a.au) });
    });
  }
}
