/**
 * Indicateurs du §6.6 (étape 9), calculés en SQL sur les colonnes que le cycle de vie de
 * l'étape 4 tient à jour : délais en minutes ouvrées figés à la première réponse et à la
 * résolution, SLA respecté, passage en attente du client, escalade, réouvertures.
 *
 * - Période : réclamations déposées entre `du` (inclus) et `au` (exclu).
 * - « Résolues » : `sla_respecte` renseigné, c'est-à-dire résolues et non rouvertes depuis
 *   (une contestation l'efface) ; une clôture forcée sans résolution n'en fait pas partie.
 * - Résolution au premier contact (critère 8) : résolue sans attente du client, sans escalade,
 *   sans réouverture, parmi les résolues.
 */
import { DateTime } from 'luxon';
import { Prisma } from '../../generated/prisma/client.js';
import { enSerie, type ClientTransaction } from '../../infrastructure/base-de-donnees/index.js';
import { invalideChamp } from '../../infrastructure/contrat/probleme.js';
import type { S } from '../commun.js';

export type Regroupement = S<'Regroupement'>;

export const STATUTS = { OUVERTE: 'Ouverte', EN_COURS: 'En cours', EN_ATTENTE_CLIENT: 'En attente client', RESOLUE: 'Résolue', CLOTUREE: 'Clôturée' } as const;
export const CANAUX = { QR_CODE: 'QR code en agence', LIEN_WEB: 'Lien web' } as const;
export const PRIORITES = { NORMALE: 'Normale', URGENTE: 'Urgente' } as const;
export const MODES_CLOTURE = { CONFIRMATION_CLIENT: 'Confirmée par le client', AUTOMATIQUE: 'Automatique', FORCEE: 'Forcée' } as const;
export const MOTIFS_CLOTURE = { DOUBLON: 'Doublon', HORS_PERIMETRE: 'Hors périmètre', ABUS: 'Abus', AUTRE: 'Autre' } as const;
export const SANS_AGENCE = { cle: 'aucune', libelle: 'Sans agence (lien web)' } as const;

/** Nombre de points d'une courbe (contrat : Evolution.points, 400 au plus) */
export const POINTS_MAX = 400;

export interface Periode {
  readonly du: Date;
  readonly au: Date;
}

export interface FiltresIndicateurs extends Periode {
  readonly categorieId?: string;
  readonly agenceId?: string;
  readonly canal?: 'QR_CODE' | 'LIEN_WEB';
}

/** Période demandée ; par défaut, du début du mois courant (dans le fuseau donné) à maintenant. */
export function periodeDe(q: Record<string, unknown>, fuseau: string, maintenant: Date): Periode {
  const du = q.du ? new Date(String(q.du)) : DateTime.fromJSDate(maintenant, { zone: fuseau }).startOf('month').toJSDate();
  const au = q.au ? new Date(String(q.au)) : maintenant;
  if (au.getTime() <= du.getTime()) throw invalideChamp('au', 'La fin de la période doit suivre son début');
  return { du, au };
}

export function filtresDe(q: Record<string, unknown>, p: Periode): FiltresIndicateurs {
  return {
    ...p,
    ...(q.categorieId ? { categorieId: String(q.categorieId) } : {}),
    ...(q.agenceId ? { agenceId: String(q.agenceId) } : {}),
    ...(q.canal ? { canal: q.canal as 'QR_CODE' | 'LIEN_WEB' } : {}),
  };
}

/** Pas demandé, sinon : jour jusqu'à 62 jours, semaine jusqu'à 26 semaines, mois au-delà. */
export function regroupementDe(p: Periode, demande: unknown): Regroupement {
  if (demande === 'JOUR' || demande === 'SEMAINE' || demande === 'MOIS') return demande;
  const jours = (p.au.getTime() - p.du.getTime()) / 86_400_000;
  return jours <= 62 ? 'JOUR' : jours <= 26 * 7 ? 'SEMAINE' : 'MOIS';
}

const UNITE = { JOUR: 'day', SEMAINE: 'week', MOIS: 'month' } as const;
const FORMAT_LOCAL = "yyyy-MM-dd'T'HH:mm:ss";

/** Débuts des pas qui couvrent la période, dans le fuseau de la banque (semaines du lundi). */
export function debutsDesPas(p: Periode, r: Regroupement, fuseau: string): DateTime[] {
  const unite = UNITE[r];
  const fin = DateTime.fromJSDate(p.au, { zone: fuseau });
  const debuts: DateTime[] = [];
  for (let d = DateTime.fromJSDate(p.du, { zone: fuseau }).startOf(unite); d < fin; d = d.plus({ [unite]: 1 })) {
    debuts.push(d);
    if (debuts.length > POINTS_MAX) {
      throw invalideChamp('regroupement', `Plus de ${POINTS_MAX} points : choisissez un pas plus long ou une période plus courte`);
    }
  }
  return debuts;
}

const taux = (n: number, sur: number) => (sur ? Math.round((n / sur) * 10_000) / 10_000 : null);
const moyenne = (v: number | null) => (v === null ? null : Math.round(v));

/** Filtres en SQL, sur la date de dépôt ou de résolution. */
function conditionsSql(f: FiltresIndicateurs, date: 'cree_le' | 'resolue_le' = 'cree_le'): Prisma.Sql {
  const colonne = Prisma.raw(date);
  const c = [Prisma.sql`${colonne} >= ${f.du} AND ${colonne} < ${f.au}`];
  if (f.categorieId) c.push(Prisma.sql`categorie_id = ${f.categorieId}::uuid`);
  if (f.agenceId) c.push(Prisma.sql`agence_id = ${f.agenceId}::uuid`);
  if (f.canal) c.push(Prisma.sql`canal = ${f.canal}::canal_depot`);
  return Prisma.join(c, ' AND ');
}

/** Totaux d'un ensemble de réclamations (les mêmes pour une banque et pour la plateforme). */
const TOTAUX = Prisma.sql`
  count(*)::int AS total,
  count(*) FILTER (WHERE priorite = 'URGENTE')::int AS urgentes,
  count(*) FILTER (WHERE sla_respecte IS NOT NULL)::int AS resolues,
  count(*) FILTER (WHERE sla_respecte)::int AS dans_les_delais,
  count(*) FILTER (WHERE sla_respecte IS NOT NULL AND NOT passe_en_attente_client
                     AND escaladee_le IS NULL AND nb_reouvertures = 0)::int AS premier_contact`;

interface Totaux {
  total: number;
  urgentes: number;
  resolues: number;
  dans_les_delais: number;
  premier_contact: number;
}

interface Compte {
  cle: string | null;
  n: number;
}

/** Tableau de bord d'une banque (contexte banque : la RLS limite à ses réclamations). */
export async function indicateursBanque(tx: ClientTransaction, f: FiltresIndicateurs, fuseau: string, r: Regroupement): Promise<S<'Indicateurs'>> {
  const debuts = debutsDesPas(f, r, fuseau);
  const quand = conditionsSql(f);
  // Début local du pas (texte « AAAA-MM-JJTHH:MM:SS »), dans le fuseau de la banque
  const pas = (date: 'cree_le' | 'resolue_le') =>
    Prisma.sql`to_char(date_trunc(${UNITE[r]}, ${Prisma.raw(date)} AT TIME ZONE ${fuseau}), 'YYYY-MM-DD"T"HH24:MI:SS')`;
  const volumes = (colonne: string) =>
    tx.$queryRaw<Compte[]>`SELECT ${Prisma.raw(colonne)}::text AS cle, count(*)::int AS n FROM reclamation WHERE ${quand} GROUP BY 1`;

  const [[totaux], [delais], parStatut, parCategorie, parCanal, parAgence, categories, agences, deposees, resolues] = await enSerie([
    () => tx.$queryRaw<Totaux[]>`SELECT ${TOTAUX} FROM reclamation WHERE ${quand}`,
    () => tx.$queryRaw<{ premiere: number | null; resolution: number | null }[]>`
      SELECT avg(delai_premiere_reponse_minutes)::float8 AS premiere,
             avg(delai_resolution_minutes) FILTER (WHERE sla_respecte IS NOT NULL)::float8 AS resolution
      FROM reclamation WHERE ${quand}`,
    () => volumes('statut'),
    () => volumes('categorie_id'),
    () => volumes('canal'),
    () => volumes('agence_id'),
    () => tx.categorie.findMany({ select: { id: true, nom: true } }),
    () => tx.agence.findMany({ select: { id: true, nom: true } }),
    () => tx.$queryRaw<{ pas: string; n: number }[]>`
      SELECT ${pas('cree_le')} AS pas, count(*)::int AS n FROM reclamation WHERE ${quand} GROUP BY 1`,
    () => tx.$queryRaw<{ pas: string; n: number }[]>`
      SELECT ${pas('resolue_le')} AS pas, count(*)::int AS n FROM reclamation
      WHERE ${conditionsSql(f, 'resolue_le')} AND sla_respecte IS NOT NULL GROUP BY 1`,
  ]);

  const nomCategorie = new Map(categories.map((c) => [c.id, c.nom]));
  const nomAgence = new Map(agences.map((a) => [a.id, a.nom]));
  const tri = (a: S<'Volume'>, b: S<'Volume'>) => b.total - a.total || a.libelle.localeCompare(b.libelle, 'fr');
  const compte = (lignes: Compte[], cle: string | null) => lignes.find((l) => l.cle === cle)?.n ?? 0;
  const parPas = (lignes: { pas: string; n: number }[]) => new Map(lignes.map((l) => [l.pas, l.n]));
  const dep = parPas(deposees);
  const res = parPas(resolues);

  return {
    du: f.du.toISOString(),
    au: f.au.toISOString(),
    total: totaux!.total,
    parStatut: (Object.keys(STATUTS) as (keyof typeof STATUTS)[]).map((s) => ({ cle: s, libelle: STATUTS[s], total: compte(parStatut, s) })),
    parCategorie: parCategorie.map((l) => ({ cle: l.cle!, libelle: nomCategorie.get(l.cle!) ?? 'Catégorie', total: l.n })).sort(tri),
    parCanal: (Object.keys(CANAUX) as (keyof typeof CANAUX)[]).map((c) => ({ cle: c, libelle: CANAUX[c], total: compte(parCanal, c) })),
    parAgence: parAgence.map((l) => (l.cle
      ? { cle: l.cle, libelle: nomAgence.get(l.cle) ?? 'Agence', total: l.n }
      : { ...SANS_AGENCE, total: l.n })).sort(tri),
    delaiPremiereReponseMoyenMinutes: moyenne(delais!.premiere),
    delaiResolutionMoyenMinutes: moyenne(delais!.resolution),
    tauxRespectSla: taux(totaux!.dans_les_delais, totaux!.resolues),
    tauxResolutionPremierContact: taux(totaux!.premier_contact, totaux!.resolues),
    evolution: {
      regroupement: r,
      points: debuts.map((d) => {
        const cle = d.toFormat(FORMAT_LOCAL);
        return { debut: d.toUTC().toISO({ suppressMilliseconds: true })!, deposees: dep.get(cle) ?? 0, resolues: res.get(cle) ?? 0 };
      }),
    },
  };
}

/**
 * Statistiques de toutes les banques (contexte plateforme) : le rôle PostgreSQL de la plateforme
 * ne lit que les colonnes de métadonnées (arbitrage 7), ce que ces requêtes suffisent à servir.
 */
export async function indicateursPlateforme(tx: ClientTransaction, p: Periode, banqueId?: string): Promise<S<'IndicateursPlateforme'>> {
  const quand = Prisma.sql`cree_le >= ${p.du} AND cree_le < ${p.au}${banqueId ? Prisma.sql` AND tenant_id = ${banqueId}::uuid` : Prisma.empty}`;
  const [banques, totaux, parStatut] = await enSerie([
    () => tx.banque.findMany({ where: banqueId ? { id: banqueId } : {}, select: { id: true, nom: true }, orderBy: { nom: 'asc' } }),
    () => tx.$queryRaw<(Totaux & { tenant_id: string })[]>`SELECT tenant_id, ${TOTAUX} FROM reclamation WHERE ${quand} GROUP BY tenant_id`,
    () => tx.$queryRaw<{ tenant_id: string; statut: string; n: number }[]>`
      SELECT tenant_id, statut::text AS statut, count(*)::int AS n FROM reclamation WHERE ${quand} GROUP BY 1, 2`,
  ]);
  return {
    du: p.du.toISOString(),
    au: p.au.toISOString(),
    banques: banques.map((b) => {
      const t = totaux.find((l) => l.tenant_id === b.id);
      return {
        banque: { id: b.id, nom: b.nom },
        total: t?.total ?? 0,
        parStatut: (Object.keys(STATUTS) as (keyof typeof STATUTS)[]).map((s) => ({
          cle: s, libelle: STATUTS[s], total: parStatut.find((l) => l.tenant_id === b.id && l.statut === s)?.n ?? 0,
        })),
        urgentes: t?.urgentes ?? 0,
        tauxRespectSla: t ? taux(t.dans_les_delais, t.resolues) : null,
        tauxResolutionPremierContact: t ? taux(t.premier_contact, t.resolues) : null,
      };
    }),
  };
}

/**
 * Facturation des SMS d'un mois civil (temps universel). Le rôle de la plateforme ne lit pas
 * les notifications des banques (numéros, contenus) : la fonction SQL facturation_sms (étape 9)
 * ne lui rend que des totaux par banque.
 */
export async function facturationSms(tx: ClientTransaction, mois: string): Promise<S<'FacturationSms'>> {
  const debut = DateTime.fromISO(`${mois}-01T00:00:00`, { zone: 'utc' });
  const fin = debut.plus({ months: 1 });
  const [banques, lignes] = await enSerie([
    () => tx.banque.findMany({ where: { creeLe: { lt: fin.toJSDate() } }, select: { id: true, nom: true }, orderBy: { nom: 'asc' } }),
    () => tx.$queryRaw<{ tenant_id: string; sms: bigint; segments: bigint; echecs: bigint }[]>`
      SELECT tenant_id, sms, segments, echecs FROM facturation_sms(${debut.toJSDate()}, ${fin.toJSDate()})`,
  ]);
  const parBanque = new Map(lignes.map((l) => [l.tenant_id, l]));
  return {
    mois,
    banques: banques.map((b) => {
      const l = parBanque.get(b.id);
      return { banque: { id: b.id, nom: b.nom }, sms: Number(l?.sms ?? 0), segments: Number(l?.segments ?? 0), echecs: Number(l?.echecs ?? 0) };
    }),
  };
}
