import { Logger } from "@nestjs/common";
import { DateTime } from "luxon";
import { Prisma } from "../../generated/prisma/client.js";
import {
  AGENCES_MAX,
  decalerMois,
  deMois,
  faitsMarquants,
  irritants,
  MOIS_TENDANCE,
  moisJusqua,
  recommandationsParRegles,
  taux,
  themesParRegles,
  type CommentaireMois,
  type ComptesIrritant,
  type EntreeAnalyse,
  type FaitMarquant,
  type Irritant,
  type MesuresMois,
  type PointTendance,
  type RecommandationProposee,
  type Theme,
} from "../../domaine/barometre.js";
import {
  consignesBarometre,
  type AnalyseIa,
} from "../../domaine/ia/barometre.js";
import { masquer } from "../../domaine/ia/masquage.js";
import { nps } from "../../domaine/satisfaction.js";
import { journaliser } from "../../infrastructure/audit/journal.js";
import type {
  BaseDonnees,
  ClientTransaction,
} from "../../infrastructure/base-de-donnees/base-de-donnees.service.js";
import { enSerie } from "../../infrastructure/base-de-donnees/index.js";
import type { MoteurIa } from "../ia/moteur.js";

export const MODELE_BAROMETRE_PRET = "barometre.pret";
/** Commentaires du mois lus au plus (l'IA en reçoit 60, les règles les lisent tous) */
const COMMENTAIRES_LUS = 200;

/** Ce qui est figé dans barometre.contenu */
export interface ContenuBarometre {
  readonly version: 1;
  readonly mois: string;
  readonly du: string;
  readonly au: string;
  readonly mesures: MesuresMois;
  readonly precedent: MesuresMois | null;
  readonly tendance: readonly PointTendance[];
  readonly irritants: readonly Irritant[];
  readonly agences: readonly Irritant[];
  readonly themes: readonly Theme[];
  readonly commentaires: number;
  readonly faitsMarquants: readonly FaitMarquant[];
}

interface DonneesMois {
  readonly banque: {
    nom: string;
    fuseau: string;
    enqueteActive: boolean;
    smsChaqueChangementStatut: boolean;
    iaAutorisee: boolean;
  };
  readonly du: Date;
  readonly au: Date;
  readonly mesures: MesuresMois;
  readonly precedent: MesuresMois | null;
  readonly tendance: PointTendance[];
  readonly categories: ComptesIrritant[];
  readonly agences: ComptesIrritant[];
  readonly commentaires: (CommentaireMois & { readonly client: string })[];
  readonly noms: string[];
}

/** Début du mois `mois` (« 2026-09 ») dans le fuseau de la banque */
export const debutDuMois = (mois: string, fuseau: string) =>
  DateTime.fromISO(`${mois}-01T00:00:00`, { zone: fuseau });

/** Le dernier mois écoulé à cet instant, dans le fuseau de la banque */
export const moisEcoule = (maintenant: Date, fuseau: string) =>
  DateTime.fromJSDate(maintenant, { zone: fuseau })
    .startOf("month")
    .minus({ months: 1 })
    .toFormat("yyyy-MM");

const MOIS = (colonne: string, fuseau: string) =>
  Prisma.sql`to_char(date_trunc('month', ${Prisma.raw(colonne)} AT TIME ZONE ${fuseau}), 'YYYY-MM')`;

/** Chiffres du mois et des 5 précédents, en contexte banque. */
export async function lireDonnees(
  tx: ClientTransaction,
  tenantId: string,
  mois: string,
): Promise<DonneesMois> {
  const b = await tx.banque.findUniqueOrThrow({
    where: { id: tenantId },
    select: {
      nom: true,
      fuseauHoraire: true,
      enqueteSatisfaction: true,
      smsChaqueChangementStatut: true,
      assistantIa: true,
      chatWeb: true,
    },
  });
  const fuseau = b.fuseauHoraire;
  const du = debutDuMois(mois, fuseau).toJSDate();
  const au = debutDuMois(decalerMois(mois, 1), fuseau).toJSDate();
  const debutTendance = debutDuMois(
    decalerMois(mois, 1 - MOIS_TENDANCE),
    fuseau,
  ).toJSDate();
  const duPrecedent = debutDuMois(decalerMois(mois, -1), fuseau).toJSDate();

  const [
    volumes,
    resolues,
    contestees,
    reponses,
    enquetes,
    cats,
    agences,
    commentaires,
    personnel,
  ] = await enSerie([
    () => tx.$queryRaw<{ mois: string; n: number; urgentes: number }[]>`
      SELECT ${MOIS("cree_le", fuseau)} AS mois, count(*)::int AS n, count(*) FILTER (WHERE priorite = 'URGENTE')::int AS urgentes
      FROM reclamation WHERE cree_le >= ${debutTendance} AND cree_le < ${au} GROUP BY 1`,
    () => tx.$queryRaw<
      {
        mois: string;
        n: number;
        dans_les_delais: number;
        premier_contact: number;
        delai: number | null;
      }[]
    >`
      SELECT ${MOIS("resolue_le", fuseau)} AS mois, count(*)::int AS n, count(*) FILTER (WHERE sla_respecte)::int AS dans_les_delais,
             count(*) FILTER (WHERE NOT passe_en_attente_client AND escaladee_le IS NULL AND nb_reouvertures = 0)::int AS premier_contact,
             avg(delai_resolution_minutes)::float8 AS delai
      FROM reclamation WHERE resolue_le >= ${debutTendance} AND resolue_le < ${au} AND sla_respecte IS NOT NULL GROUP BY 1`,
    () => tx.$queryRaw<{ mois: string; n: number }[]>`
      SELECT ${MOIS("cree_le", fuseau)} AS mois, count(DISTINCT reclamation_id)::int AS n
      FROM reclamation_evenement WHERE type = 'CONTESTATION' AND cree_le >= ${debutTendance} AND cree_le < ${au} GROUP BY 1`,
    () => tx.$queryRaw<
      {
        mois: string;
        n: number;
        satisfaits: number;
        promoteurs: number;
        detracteurs: number;
        note: number | null;
      }[]
    >`
      SELECT ${MOIS("repondu_le", fuseau)} AS mois, count(*)::int AS n, count(*) FILTER (WHERE note >= 4)::int AS satisfaits,
             count(*) FILTER (WHERE recommandation >= 9)::int AS promoteurs, count(*) FILTER (WHERE recommandation <= 6)::int AS detracteurs,
             avg(note)::float8 AS note
      FROM enquete_satisfaction WHERE repondu_le >= ${debutTendance} AND repondu_le < ${au} GROUP BY 1`,
    () => tx.$queryRaw<{ mois: string; n: number; repondues: number }[]>`
      SELECT ${MOIS("expire_le", fuseau)} AS mois, count(*)::int AS n, count(*) FILTER (WHERE repondu_le IS NOT NULL)::int AS repondues
      FROM enquete_satisfaction WHERE expire_le >= ${duPrecedent} AND expire_le < ${au} GROUP BY 1`,
    () => comptesPar(tx, "categorie_id", du, au, duPrecedent),
    () => comptesPar(tx, "agence_id", du, au, duPrecedent),
    () => tx.$queryRaw<
      {
        numero: string;
        note: number;
        recommandation: number;
        commentaire: string;
        client: string;
      }[]
    >`
      SELECT r.numero, e.note::int AS note, e.recommandation::int AS recommandation, e.commentaire, c.nom AS client
      FROM enquete_satisfaction e JOIN reclamation r ON r.id = e.reclamation_id JOIN client_final c ON c.id = r.client_id
      WHERE e.repondu_le >= ${du} AND e.repondu_le < ${au} AND e.commentaire IS NOT NULL AND btrim(e.commentaire) <> ''
      ORDER BY e.repondu_le DESC, e.id DESC LIMIT ${COMMENTAIRES_LUS}`,
    () =>
      tx.utilisateur.findMany({
        where: { tenantId },
        select: { prenom: true, nom: true },
      }),
  ]);
  const [noms, nomsAgences] = await enSerie([
    () => tx.categorie.findMany({ select: { id: true, nom: true } }),
    () => tx.agence.findMany({ select: { id: true, nom: true } }),
  ]);

  const mesuresDe = (m: string): MesuresMois => {
    const v = volumes.find((l) => l.mois === m);
    const r = resolues.find((l) => l.mois === m);
    const c = contestees.find((l) => l.mois === m);
    const a = reponses.find((l) => l.mois === m);
    const e = enquetes.find((l) => l.mois === m);
    return {
      reclamations: v?.n ?? 0,
      urgentes: v?.urgentes ?? 0,
      resolues: r?.n ?? 0,
      tauxRespectSla: taux(r?.dans_les_delais ?? 0, r?.n ?? 0),
      tauxPremierContact: taux(r?.premier_contact ?? 0, r?.n ?? 0),
      delaiResolutionMoyenMinutes:
        r?.delai == null ? null : Math.round(r.delai),
      contestees: c?.n ?? 0,
      enquetes: e?.n ?? 0,
      tauxReponse: taux(e?.repondues ?? 0, e?.n ?? 0),
      reponses: a?.n ?? 0,
      tauxSatisfaits: taux(a?.satisfaits ?? 0, a?.n ?? 0),
      noteMoyenne: a?.note == null ? null : Math.round(a.note * 10) / 10,
      nps: nps(a?.promoteurs ?? 0, a?.detracteurs ?? 0, a?.n ?? 0),
    };
  };
  const precedent = decalerMois(mois, -1);
  // Le mois précédent compte s'il a eu de l'activité
  const avaitActivite =
    volumes.some((l) => l.mois === precedent) ||
    resolues.some((l) => l.mois === precedent) ||
    reponses.some((l) => l.mois === precedent);
  const libelles = (
    lignes: Omit<ComptesIrritant, "libelle">[],
    table: { id: string; nom: string }[],
  ) =>
    lignes
      .map((l) => ({
        ...l,
        libelle: table.find((t) => t.id === l.cle)?.nom ?? "",
      }))
      .filter((l) => l.libelle);
  return {
    banque: {
      nom: b.nom,
      fuseau,
      enqueteActive: b.enqueteSatisfaction,
      smsChaqueChangementStatut: b.smsChaqueChangementStatut,
      iaAutorisee: b.assistantIa && b.chatWeb,
    },
    du,
    au,
    mesures: mesuresDe(mois),
    precedent: avaitActivite ? mesuresDe(precedent) : null,
    tendance: moisJusqua(mois).map((m) => {
      const x = mesuresDe(m);
      return {
        mois: m,
        reclamations: x.reclamations,
        tauxRespectSla: x.tauxRespectSla,
        reponses: x.reponses,
        tauxSatisfaits: x.tauxSatisfaits,
        nps: x.nps,
      };
    }),
    categories: libelles(cats, noms),
    agences: libelles(agences, nomsAgences),
    commentaires: commentaires.map((c) => ({
      numero: c.numero,
      note: c.note,
      recommandation: c.recommandation,
      texte: c.commentaire,
      client: c.client,
    })),
    noms: personnel.flatMap((p) => [p.prenom, p.nom]),
  };
}

/** Comptes d'irritants par catégorie ou par agence (réclamations sans agence exclues). */
async function comptesPar(
  tx: ClientTransaction,
  colonne: "categorie_id" | "agence_id",
  du: Date,
  au: Date,
  duPrecedent: Date,
): Promise<Omit<ComptesIrritant, "libelle">[]> {
  const c = Prisma.raw(colonne);
  const lignes = await tx.$queryRaw<
    {
      cle: string;
      reclamations: number;
      precedent: number;
      resolues: number;
      hors_delai: number;
      contestees: number;
      reponses: number;
      insatisfaits: number;
    }[]
  >`
    WITH deposees AS (
      SELECT ${c} AS cle, count(*) FILTER (WHERE cree_le >= ${du})::int AS reclamations, count(*) FILTER (WHERE cree_le < ${du})::int AS precedent
      FROM reclamation WHERE cree_le >= ${duPrecedent} AND cree_le < ${au} AND ${c} IS NOT NULL GROUP BY 1
    ), resolues AS (
      SELECT ${c} AS cle, count(*)::int AS resolues, count(*) FILTER (WHERE NOT sla_respecte)::int AS hors_delai
      FROM reclamation WHERE resolue_le >= ${du} AND resolue_le < ${au} AND sla_respecte IS NOT NULL AND ${c} IS NOT NULL GROUP BY 1
    ), contestees AS (
      SELECT r.${c} AS cle, count(DISTINCT e.reclamation_id)::int AS contestees
      FROM reclamation_evenement e JOIN reclamation r ON r.id = e.reclamation_id
      WHERE e.type = 'CONTESTATION' AND e.cree_le >= ${du} AND e.cree_le < ${au} AND r.${c} IS NOT NULL GROUP BY 1
    ), avis AS (
      SELECT r.${c} AS cle, count(*)::int AS reponses, count(*) FILTER (WHERE e.note <= 3)::int AS insatisfaits
      FROM enquete_satisfaction e JOIN reclamation r ON r.id = e.reclamation_id
      WHERE e.repondu_le >= ${du} AND e.repondu_le < ${au} AND r.${c} IS NOT NULL GROUP BY 1
    )
    SELECT k.cle::text AS cle, coalesce(d.reclamations, 0) AS reclamations, coalesce(d.precedent, 0) AS precedent,
           coalesce(r.resolues, 0) AS resolues, coalesce(r.hors_delai, 0) AS hors_delai, coalesce(x.contestees, 0) AS contestees,
           coalesce(a.reponses, 0) AS reponses, coalesce(a.insatisfaits, 0) AS insatisfaits
    FROM (SELECT cle FROM deposees UNION SELECT cle FROM resolues UNION SELECT cle FROM contestees UNION SELECT cle FROM avis) k
    LEFT JOIN deposees d ON d.cle = k.cle LEFT JOIN resolues r ON r.cle = k.cle
    LEFT JOIN contestees x ON x.cle = k.cle LEFT JOIN avis a ON a.cle = k.cle`;
  return lignes.map((l) => ({
    cle: l.cle,
    reclamations: l.reclamations,
    precedent: l.precedent,
    resolues: l.resolues,
    horsDelai: l.hors_delai,
    contestees: l.contestees,
    reponses: l.reponses,
    insatisfaits: l.insatisfaits,
  }));
}

export interface BilanPublication {
  publies: number;
}

export class BarometresMensuels {
  private readonly journal = new Logger("Baromètre");

  constructor(
    private readonly bd: BaseDonnees,
    private readonly moteur: MoteurIa,
    private readonly horloge: () => Date = () => new Date(),
  ) {}

  /** Travail du worker : le mois écoulé de chaque banque qui a le baromètre, s'il manque. */
  async publier(): Promise<BilanPublication> {
    const maintenant = this.horloge();
    const banques = await this.bd.enSysteme((tx) =>
      tx.banque.findMany({
        where: { barometre: true, suspendueLe: null },
        select: { id: true, fuseauHoraire: true, creeLe: true },
      }),
    );
    let publies = 0;
    for (const b of banques) {
      const mois = moisEcoule(maintenant, b.fuseauHoraire);
      // Une banque créée après la fin du mois n'a rien à en dire
      if (
        b.creeLe >=
        debutDuMois(decalerMois(mois, 1), b.fuseauHoraire).toJSDate()
      )
        continue;
      if (await this.existe(b.id, mois)) continue;
      try {
        if (await this.generer(b.id, mois)) publies++;
      } catch (e) {
        // Une banque en erreur n'empêche pas les autres ; le passage suivant réessaie
        this.journal.error(
          `Baromètre de ${mois} pour la banque ${b.id} : ${(e as Error).message}`,
        );
      }
    }
    return { publies };
  }

  /** Calcule, analyse et publie le baromètre d'un mois ; false s'il existait déjà. */
  async generer(tenantId: string, mois: string): Promise<boolean> {
    // Déjà publié : rien ne part chez le fournisseur d'IA (la base refuserait de toute façon le second)
    if (await this.existe(tenantId, mois)) return false;
    const d = await this.bd.enBanque(tenantId, (tx) =>
      lireDonnees(tx, tenantId, mois),
    );
    const categories = irritants(d.categories);
    const agences = irritants(d.agences, AGENCES_MAX);
    const themesRegles = themesParRegles(d.commentaires);
    const entree: EntreeAnalyse = {
      banque: d.banque.nom,
      mois,
      mesures: d.mesures,
      precedent: d.precedent,
      categories,
      agences,
      themes: themesRegles,
      enqueteActive: d.banque.enqueteActive,
      smsChaqueChangementStatut: d.banque.smsChaqueChangementStatut,
    };
    const parRegles = (): AnalyseIa => ({
      themes: themesRegles,
      recommandations: recommandationsParRegles(entree),
    });
    // L'IA seulement avec l'accord de la banque (assistant ouvert) et des chiffres à lire
    const avecIa =
      d.banque.iaAutorisee &&
      (d.mesures.reclamations > 0 || d.commentaires.length > 0);
    const masques = d.commentaires.map((c) => ({
      ...c,
      texte: masquer(c.texte, { noms: [c.client, ...d.noms] }).texte,
    }));
    const analyse = await this.moteur.demander(
      tenantId,
      "BAROMETRE",
      avecIa ? consignesBarometre(entree, masques, d.commentaires) : null,
      parRegles,
    );
    const contenu: ContenuBarometre = {
      version: 1,
      mois,
      du: d.du.toISOString(),
      au: d.au.toISOString(),
      mesures: d.mesures,
      precedent: d.precedent,
      tendance: d.tendance,
      irritants: categories,
      agences,
      themes: analyse.resultat.themes,
      commentaires: d.commentaires.length,
      faitsMarquants: faitsMarquants(d.mesures, d.precedent, categories),
    };
    return this.publierContenu(
      tenantId,
      mois,
      contenu,
      analyse.resultat.recommandations,
      analyse.source,
    );
  }

  private async existe(tenantId: string, mois: string): Promise<boolean> {
    return !!(await this.bd.enSysteme((tx) =>
      tx.barometre.findUnique({
        where: { tenantId_mois: { tenantId, mois: dateDuMois(mois) } },
        select: { id: true },
      }),
    ));
  }

  private async publierContenu(
    tenantId: string,
    mois: string,
    contenu: ContenuBarometre,
    recos: readonly RecommandationProposee[],
    source: "IA" | "REGLES",
  ): Promise<boolean> {
    try {
      await this.bd.enSysteme(async (tx) => {
        const b = await tx.barometre.create({
          data: {
            tenantId,
            mois: dateDuMois(mois),
            source,
            contenu: contenu as unknown as Prisma.InputJsonValue,
            genereLe: this.horloge(),
          },
          select: { id: true },
        });
        if (recos.length) {
          await tx.recommandationBarometre.createMany({
            data: recos.map((r, i) => ({
              tenantId,
              barometreId: b.id,
              ordre: i + 1,
              titre: r.titre.slice(0, 160),
              constat: r.constat.slice(0, 600),
              action: r.action.slice(0, 600),
              categorieId: r.categorieId,
              priorite: r.priorite,
              source,
            })),
          });
        }
        await journaliser(tx, {
          tenantId,
          acteur: "SYSTEME",
          action: "barometre.publie",
          entite: "barometre",
          entiteId: b.id,
          donnees: { mois, analyse: source, recommandations: recos.length },
        });
        const destinataires = await tx.utilisateur.findMany({
          where: {
            tenantId,
            role: { in: ["ADMIN_ENTREPRISE", "SUPERVISEUR"] },
            statut: "ACTIF",
          },
          select: { id: true },
        });
        const premier = contenu.irritants[0];
        await tx.notification.createMany({
          data: destinataires.map((u) => ({
            tenantId,
            canal: "IN_APP" as const,
            modele: MODELE_BAROMETRE_PRET,
            destinataireUtilisateurId: u.id,
            sujet: `Baromètre ${deMois(mois)}`,
            contenu:
              `Le baromètre ${deMois(mois)} est prêt : ` +
              (recos.length
                ? `${recos.length} recommandation${recos.length > 1 ? "s" : ""} à étudier`
                : "aucune recommandation ce mois-ci") +
              `${premier ? `, irritant principal « ${premier.libelle} »` : ""}.`,
            cleDeduplication: `barometre:${mois}:${u.id}`,
          })),
          skipDuplicates: true,
        });
      });
      return true;
    } catch (e) {
      // Déjà publié (un autre passage du worker) : rien à faire
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2002"
      )
        return false;
      throw e;
    }
  }
}

/** Le mois en date (premier jour, colonne DATE) */
export const dateDuMois = (mois: string) => new Date(`${mois}-01T00:00:00Z`);
