/**
 * Attribution automatique (étape 16, décision I10 de l'étape 14) : règles pures, partagées par
 * l'API, le worker et la démo cliquable.
 *
 * - L'Admin Entreprise confie chaque catégorie et chaque agence à un groupe d'agents (facultatif).
 * - Agents candidats, dans cet ordre : ceux du groupe de la catégorie qui sont aussi dans le groupe
 *   de l'agence ; à défaut, le groupe de la catégorie (la spécialité d'abord) ; à défaut, le groupe
 *   de l'agence. Sans groupe, ou sans agent disponible, la réclamation reste dans la file
 *   « Reçues » du superviseur, comme aujourd'hui.
 * - Disponible : agent actif, pas absent le jour où la réclamation sera traitée (aujourd'hui pendant
 *   les heures ouvrées, sinon le prochain jour ouvré).
 * - Le moins chargé : le moins de réclamations « à traiter » (ouvertes ou en cours) ; à égalité,
 *   celui qui en a reçu une le moins récemment ; puis l'ordre alphabétique.
 */

export const MODES_ATTRIBUTION = ['MANUELLE', 'SUGGESTION', 'AUTOMATIQUE'] as const;
export type ModeAttribution = (typeof MODES_ATTRIBUTION)[number];

export interface AgentDisponible {
  readonly id: string;
  /** Prénom et nom, pour départager deux agents à égalité */
  readonly nom: string;
  /** Réclamations ouvertes ou en cours qui lui sont assignées */
  readonly aTraiter: number;
  readonly derniereAttributionLe: Date | null;
}

export interface Groupe {
  readonly id: string;
  readonly nom: string;
  readonly membres: readonly string[];
}

export interface Candidats {
  readonly groupe: Groupe;
  readonly agents: readonly string[];
}

/**
 * Ensembles d'agents à essayer, dans l'ordre : intersection des deux groupes, groupe de la
 * catégorie, groupe de l'agence. Vide quand ni la catégorie ni l'agence n'ont de groupe.
 */
export function ensemblesCandidats(groupeCategorie: Groupe | null, groupeAgence: Groupe | null): Candidats[] {
  const ensembles: Candidats[] = [];
  if (groupeCategorie && groupeAgence && groupeCategorie.id !== groupeAgence.id) {
    const deLAgence = new Set(groupeAgence.membres);
    const communs = groupeCategorie.membres.filter((id) => deLAgence.has(id));
    if (communs.length) ensembles.push({ groupe: groupeCategorie, agents: communs });
  }
  if (groupeCategorie) ensembles.push({ groupe: groupeCategorie, agents: groupeCategorie.membres });
  if (groupeAgence && groupeAgence.id !== groupeCategorie?.id) ensembles.push({ groupe: groupeAgence, agents: groupeAgence.membres });
  return ensembles;
}

/** Le moins chargé ; à égalité, celui qui attend une réclamation depuis le plus longtemps. */
export function plusDisponible(agents: readonly AgentDisponible[]): AgentDisponible | null {
  let meilleur: AgentDisponible | null = null;
  for (const a of agents) {
    if (!meilleur || comparer(a, meilleur) < 0) meilleur = a;
  }
  return meilleur;
}

function comparer(a: AgentDisponible, b: AgentDisponible): number {
  if (a.aTraiter !== b.aTraiter) return a.aTraiter - b.aTraiter;
  const da = a.derniereAttributionLe?.getTime() ?? -Infinity;
  const db = b.derniereAttributionLe?.getTime() ?? -Infinity;
  if (da !== db) return da < db ? -1 : 1;
  return a.nom.localeCompare(b.nom, 'fr') || a.id.localeCompare(b.id);
}

export interface Choix {
  readonly agent: AgentDisponible;
  readonly groupe: Groupe;
}

/** L'agent à qui confier la réclamation, ou null : elle reste dans la file du superviseur. */
export function choisirAgent(
  groupeCategorie: Groupe | null,
  groupeAgence: Groupe | null,
  disponibles: ReadonlyMap<string, AgentDisponible>,
): Choix | null {
  for (const { groupe, agents } of ensemblesCandidats(groupeCategorie, groupeAgence)) {
    const agent = plusDisponible(agents.flatMap((id) => disponibles.get(id) ?? []));
    if (agent) return { agent, groupe };
  }
  return null;
}

/** Absent ce jour-là (dates AAAA-MM-JJ, fin incluse). */
export function estAbsent(absences: readonly { du: string; au: string }[], jour: string): boolean {
  return absences.some((a) => a.du <= jour && jour <= a.au);
}

// ---------------------------------------------------------------------------
//  Réassignation en lot (étape 21)
// ---------------------------------------------------------------------------

export interface AReassigner {
  readonly id: string;
  readonly categorieId: string;
  readonly agenceId: string | null;
  /** Agent actuel (absent, désactivé) : jamais choisi de nouveau */
  readonly agentId: string | null;
}

export interface ContexteRepartition {
  /** Groupes de la catégorie et de l'agence : seulement si l'attribution automatique est ouverte */
  readonly groupes: ReadonlyMap<string, Groupe> | null;
  readonly groupeDeCategorie: ReadonlyMap<string, string>;
  readonly groupeDAgence: ReadonlyMap<string, string>;
  /** Agents actifs et présents de toute la banque, avec leur charge */
  readonly disponibles: ReadonlyMap<string, AgentDisponible>;
}

/**
 * Chaque réclamation à l'agent disponible le moins chargé : celui des groupes de sa catégorie et de son
 * agence quand ils en ont un (et qu'un de leurs agents est là), sinon de toute la banque. La charge
 * augmente à chaque choix : un lot se répartit entre plusieurs agents. null : personne de disponible.
 */
export function repartir(lot: readonly AReassigner[], ctx: ContexteRepartition): Map<string, AgentDisponible | null> {
  const charge = new Map([...ctx.disponibles].map(([id, a]) => [id, { ...a }]));
  const resultat = new Map<string, AgentDisponible | null>();
  for (const r of lot) {
    const sauf = (m: ReadonlyMap<string, AgentDisponible>) => new Map([...m].filter(([id]) => id !== r.agentId));
    const libres = sauf(charge);
    let choix: AgentDisponible | null = null;
    if (ctx.groupes) {
      const groupe = (id: string | undefined) => (id ? ctx.groupes!.get(id) ?? null : null);
      choix = choisirAgent(groupe(ctx.groupeDeCategorie.get(r.categorieId)), groupe(r.agenceId ? ctx.groupeDAgence.get(r.agenceId) : undefined), libres)?.agent ?? null;
    }
    choix ??= plusDisponible([...libres.values()]);
    resultat.set(r.id, choix);
    if (choix) charge.set(choix.id, { ...charge.get(choix.id)!, aTraiter: charge.get(choix.id)!.aTraiter + 1 });
  }
  return resultat;
}
