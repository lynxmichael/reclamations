/**
 * Attribution automatique ou suggérée (étape 16) : charge des agents, disponibilité, groupes de la
 * catégorie et de l'agence. Les règles de choix sont pures, dans domaine/attribution.ts.
 *
 * Le jour de traitement est aujourd'hui pendant les heures ouvrées de la banque, sinon le prochain
 * jour ouvré : un agent absent ce jour-là n'est pas proposé. En mode automatique, rien n'est
 * attribué tant que la banque est fermée ; le worker distribue les réclamations en attente à
 * l'ouverture (taches-sla.ts), au plus disponible à ce moment-là.
 */
import { choisirAgent, type AgentDisponible, type Choix, type ContexteRepartition, type Groupe } from '../../domaine/attribution.js';
import { dateLocale, prochainInstantOuvre, type CalendrierNormalise } from '../../domaine/temps-ouvre/calendrier.js';
import { enSerie, type ClientTransaction } from '../../infrastructure/base-de-donnees/index.js';
import { agent, superviseurs, type Destinataire } from './notifications.js';
import type { ParametresBanque } from './parametres.js';

export interface ContexteAttribution {
  readonly groupes: ReadonlyMap<string, Groupe>;
  readonly groupeDeCategorie: ReadonlyMap<string, string>;
  readonly groupeDAgence: ReadonlyMap<string, string>;
  /** Agents actifs des groupes, présents le jour de traitement, avec leur charge */
  readonly disponibles: ReadonlyMap<string, AgentDisponible>;
}

/** La banque est ouverte à cet instant (horaires, jours fériés) ; sans horaires, toujours. */
export const banqueOuverte = (maintenant: Date, cal: CalendrierNormalise): boolean =>
  prochainInstantOuvre(maintenant, cal).getTime() === maintenant.getTime();

/** Jour de traitement (AAAA-MM-JJ, fuseau de la banque) : aujourd'hui si elle est ouverte, sinon le prochain jour ouvré. */
export const jourDeTraitement = (maintenant: Date, cal: CalendrierNormalise): string =>
  dateLocale(prochainInstantOuvre(maintenant, cal), cal);

const date = (jour: string) => new Date(`${jour}T00:00:00Z`);

/** Charge « à traiter » de chaque agent : réclamations ouvertes ou en cours qui lui sont assignées. */
export async function charges(tx: ClientTransaction, agentIds: readonly string[]): Promise<Map<string, number>> {
  if (agentIds.length === 0) return new Map();
  const lignes = await tx.reclamation.groupBy({
    by: ['agentId'], where: { agentId: { in: [...agentIds] }, statut: { in: ['OUVERTE', 'EN_COURS'] } }, _count: { _all: true },
  });
  return new Map(lignes.map((l) => [l.agentId!, l._count._all]));
}

/** Agents absents ce jour-là, parmi ceux donnés. */
export async function absentsLe(tx: ClientTransaction, jour: string, agentIds?: readonly string[]): Promise<Set<string>> {
  const lignes = await tx.absenceAgent.findMany({
    where: { du: { lte: date(jour) }, au: { gte: date(jour) }, ...(agentIds ? { utilisateurId: { in: [...agentIds] } } : {}) },
    select: { utilisateurId: true },
  });
  return new Set(lignes.map((l) => l.utilisateurId));
}

export async function chargerContexte(tx: ClientTransaction, p: ParametresBanque, maintenant: Date): Promise<ContexteAttribution> {
  const [groupes, categories, agences] = await enSerie([
    () => tx.groupeAgents.findMany({ select: { id: true, nom: true, membres: { select: { utilisateurId: true } } } }),
    () => tx.categorie.findMany({ where: { groupeId: { not: null } }, select: { id: true, groupeId: true } }),
    () => tx.agence.findMany({ where: { groupeId: { not: null } }, select: { id: true, groupeId: true } }),
  ]);
  const membres = [...new Set(groupes.flatMap((g) => g.membres.map((m) => m.utilisateurId)))];
  const jour = jourDeTraitement(maintenant, p.sla.calendrier);
  const [agents, absents, aTraiter] = await enSerie([
    () => tx.utilisateur.findMany({
      where: { id: { in: membres }, role: 'AGENT', statut: 'ACTIF' },
      select: { id: true, prenom: true, nom: true, derniereAttributionLe: true },
    }),
    () => absentsLe(tx, jour, membres),
    () => charges(tx, membres),
  ]);
  return {
    groupes: new Map(groupes.map((g) => [g.id, { id: g.id, nom: g.nom, membres: g.membres.map((m) => m.utilisateurId) }])),
    groupeDeCategorie: new Map(categories.map((c) => [c.id, c.groupeId!])),
    groupeDAgence: new Map(agences.map((a) => [a.id, a.groupeId!])),
    disponibles: new Map(agents.filter((a) => !absents.has(a.id)).map((a) => [a.id, {
      id: a.id, nom: `${a.prenom} ${a.nom}`, aTraiter: aTraiter.get(a.id) ?? 0, derniereAttributionLe: a.derniereAttributionLe,
    }])),
  };
}

/** L'agent à qui confier une réclamation de cette catégorie et de cette agence ; null : file du superviseur. */
export function choisir(ctx: ContexteAttribution, categorieId: string, agenceId: string | null): Choix | null {
  const groupe = (id: string | undefined) => (id ? ctx.groupes.get(id) ?? null : null);
  return choisirAgent(groupe(ctx.groupeDeCategorie.get(categorieId)), groupe(agenceId ? ctx.groupeDAgence.get(agenceId) : undefined), ctx.disponibles);
}

/** Suggestion pour une réclamation non assignée, en mode suggestion ; null sinon. */
export function suggestion(
  ctx: ContexteAttribution | null, t: { statut: string; agentId: string | null; categorieId: string; agenceId: string | null },
): Choix | null {
  if (!ctx || t.agentId || t.statut !== 'OUVERTE') return null;
  return choisir(ctx, t.categorieId, t.agenceId);
}

// ---------------------------------------------------------------------------
//  Étape 21 : dossiers d'un agent absent ou désactivé
// ---------------------------------------------------------------------------

/**
 * Agents dont les réclamations sont à réassigner : comptes désactivés, et absents le jour de
 * traitement quand l'attribution automatique est ouverte (les absences n'existent qu'avec elle).
 */
export async function agentsIndisponibles(tx: ClientTransaction, p: ParametresBanque, maintenant: Date): Promise<string[]> {
  const desactives = await tx.utilisateur.findMany({ where: { role: 'AGENT', statut: 'DESACTIVE' }, select: { id: true } });
  const absents = p.banque.attributionOuverte ? await absentsLe(tx, jourDeTraitement(maintenant, p.sla.calendrier)) : new Set<string>();
  return [...new Set([...desactives.map((u) => u.id), ...absents])];
}

/**
 * Qui prévenir pour une réclamation (message du client, contestation, alerte du SLA) : l'agent
 * assigné s'il est là ; absent ou désactivé, son superviseur (à défaut, tous les superviseurs).
 */
export async function responsables(tx: ClientTransaction, p: ParametresBanque, maintenant: Date, agentId: string | null): Promise<Destinataire[]> {
  if (!agentId) return superviseurs(tx, null);
  const lui = await agent(tx, agentId);
  if (lui.length && !(p.banque.attributionOuverte && (await absentsLe(tx, jourDeTraitement(maintenant, p.sla.calendrier), [agentId])).has(agentId))) return lui;
  return superviseurs(tx, agentId);
}

/** Agents actifs et présents de toute la banque, et les groupes si l'attribution est ouverte. */
export async function chargerContexteRepartition(tx: ClientTransaction, p: ParametresBanque, maintenant: Date): Promise<ContexteRepartition> {
  const jour = jourDeTraitement(maintenant, p.sla.calendrier);
  const agents = await tx.utilisateur.findMany({
    where: { role: 'AGENT', statut: 'ACTIF' }, select: { id: true, prenom: true, nom: true, derniereAttributionLe: true },
  });
  const ids = agents.map((a) => a.id);
  const [absents, aTraiter] = await enSerie([
    () => (p.banque.attributionOuverte ? absentsLe(tx, jour, ids) : Promise.resolve(new Set<string>())),
    () => charges(tx, ids),
  ]);
  const disponibles = new Map(agents.filter((a) => !absents.has(a.id)).map((a) => [a.id, {
    id: a.id, nom: `${a.prenom} ${a.nom}`, aTraiter: aTraiter.get(a.id) ?? 0, derniereAttributionLe: a.derniereAttributionLe,
  }]));
  if (!p.banque.attributionOuverte) return { groupes: null, groupeDeCategorie: new Map(), groupeDAgence: new Map(), disponibles };
  const ctx = await chargerContexte(tx, p, maintenant);
  return { groupes: ctx.groupes, groupeDeCategorie: ctx.groupeDeCategorie, groupeDAgence: ctx.groupeDAgence, disponibles };
}
