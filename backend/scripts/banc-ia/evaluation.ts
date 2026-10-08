import type {
  CodeMessage,
  Decision,
  Intention,
} from "../../src/domaine/ia/assistant.js";
import type { Brouillon } from "../../src/domaine/ia/consignes.js";
import {
  LIBELLE_INTERDIT,
  verifierInterdits,
  type CodeInterdit,
} from "../../src/domaine/ia/interdits.js";

// ---- Corpus --------------------------------------------------------------------------------

export interface AttenduTri {
  readonly intention: Intention;
  readonly faqId?: string;
  /** Catégories acceptées ; null : aucune catégorie (le client n'a encore rien dit de précis) */
  readonly categories?: readonly (string | null)[];
  readonly complet?: boolean;
}

export interface CasTri {
  readonly id: string;
  readonly type: "tri";
  readonly echanges: readonly {
    auteur: "CLIENT" | "ASSISTANT";
    texte?: string;
    code?: CodeMessage;
  }[];
  readonly attendu: AttenduTri;
  /** Autres réponses justes (un cas ambigu) */
  readonly alternatives?: readonly AttenduTri[];
  readonly theme?: string;
}

export interface CasBrouillon {
  readonly id: string;
  readonly type: "brouillon";
  readonly categorie: string;
  readonly statut: string;
  readonly description: string;
  readonly messages: readonly { auteur: "CLIENT" | "BANQUE"; texte: string }[];
  readonly attendu: {
    readonly urgente: boolean;
    readonly categories: readonly (string | null)[];
    readonly question?: boolean;
  };
  readonly piege?: string;
}

export type Cas = CasTri | CasBrouillon;

export interface Corpus {
  readonly description: string;
  readonly banque: string;
  readonly cas: readonly Cas[];
  /** Messages neufs, jamais utilisés pour mettre au point les règles : mesurés à part, hors notes */
  readonly controle: {
    readonly description: string;
    readonly cas: readonly CasTri[];
  };
}

// ---- Fournisseurs ---------------------------------------------------------------------------

export type CritereDonnees =
  | "entrainement"
  | "conservation"
  | "lieu"
  | "contrat"
  | "certifications";
export const CRITERES_DONNEES: readonly CritereDonnees[] = [
  "entrainement",
  "conservation",
  "lieu",
  "contrat",
  "certifications",
];

export interface Candidat {
  readonly fournisseur: "anthropic" | "openai" | "mistral";
  readonly nom: string;
  readonly modele: string;
  readonly libelleModele: string;
  readonly prixEntree: number;
  readonly prixSortie: number;
  readonly remarqueTarif?: string;
  readonly sourcesTarif: readonly string[];
  readonly donnees: Readonly<
    Record<CritereDonnees, { readonly note: number; readonly constat: string }>
  >;
  readonly sourcesDonnees: readonly string[];
}

export interface FichierFournisseurs {
  readonly hypotheseMensuelle: {
    readonly tours: number;
    readonly brouillons: number;
  };
  readonly ponderation: Readonly<
    Record<"donnees" | "interdits" | "qualite" | "cout" | "temps", number>
  >;
  readonly grilleDonnees: {
    readonly criteres: Readonly<Record<CritereDonnees, string>>;
  };
  readonly candidats: readonly Candidat[];
}

// ---- Résultats bruts --------------------------------------------------------------------------

export interface Mesure {
  readonly dureeMs: number;
  readonly jetonsEntree: number;
  readonly jetonsSortie: number;
  /** Réponse inexploitable (erreur, délai, hors format) */
  readonly echec: string | null;
}

export interface ResultatTri extends Mesure {
  readonly cas: CasTri;
  readonly decision: Decision | null;
}

export interface ResultatBrouillon extends Mesure {
  readonly cas: CasBrouillon;
  readonly brouillon: Brouillon | null;
}

// ---- Correction -----------------------------------------------------------------------------

export interface CorrectionTri {
  readonly exact: boolean;
  readonly intention: boolean;
  readonly detail: string;
}

function conforme(d: Decision, a: AttenduTri): boolean {
  if (d.intention !== a.intention) return false;
  if (a.intention === "FAQ" && d.faqId !== a.faqId) return false;
  if (a.categories && !a.categories.includes(d.categorieId)) return false;
  if (a.complet !== undefined && d.complet !== a.complet) return false;
  return true;
}

export function corrigerTri(r: ResultatTri): CorrectionTri {
  if (!r.decision)
    return {
      exact: false,
      intention: false,
      detail: `réponse inexploitable (${r.echec ?? "?"})`,
    };
  const d = r.decision;
  const attendus = [r.cas.attendu, ...(r.cas.alternatives ?? [])];
  const exact = attendus.some((a) => conforme(d, a));
  const intention = attendus.some((a) => a.intention === d.intention);
  const lu = `${d.intention}${d.faqId ? ` ${d.faqId}` : ""}${d.categorieId ? ` ${d.categorieId}` : ""}${d.intention === "RECLAMATION" ? (d.complet ? " complet" : " incomplet") : ""}`;
  return { exact, intention, detail: lu };
}

export interface CorrectionBrouillon {
  readonly alertes: readonly CodeInterdit[];
  /** Part des contrôles réussis (forme, catégorie, urgence, question) */
  readonly qualite: number;
  readonly controles: Readonly<Record<string, boolean>>;
}

const PHRASES = /[^.!?]+[.!?]+/g;

export function corrigerBrouillon(r: ResultatBrouillon): CorrectionBrouillon {
  if (!r.brouillon)
    return { alertes: [], qualite: 0, controles: { exploitable: false } };
  const b = r.brouillon;
  const texte = b.brouillon.trim();
  const phrases = (texte.match(PHRASES) ?? []).length;
  const controles: Record<string, boolean> = {
    forme:
      /^bonjour\b/i.test(texte) &&
      phrases >= 2 &&
      phrases <= 8 &&
      texte.length <= 1200,
    categorie: r.cas.attendu.categories.includes(b.categorieId),
    urgence: b.urgente === r.cas.attendu.urgente,
  };
  if (r.cas.attendu.question !== undefined)
    controles.question = texte.includes("?") === r.cas.attendu.question;
  const valeurs = Object.values(controles);
  return {
    alertes: verifierInterdits(texte).map((a) => a.code),
    qualite: valeurs.filter(Boolean).length / valeurs.length,
    controles,
  };
}

// ---- Notes ----------------------------------------------------------------------------------

export interface Notes {
  readonly donnees: number | null;
  readonly interdits: number;
  readonly qualite: number;
  readonly cout: number | null;
  readonly temps: number | null;
  readonly total: number | null;
}

export interface Synthese {
  readonly nom: string;
  readonly modele: string;
  readonly triExact: number;
  readonly triIntention: number;
  /** Tri exact sur les messages neufs du contrôle */
  readonly triNeufs: number;
  readonly brouillonQualite: number;
  readonly brouillonsSansAlerte: number;
  readonly echecs: number;
  readonly dureeP50: number;
  readonly dureeP95: number;
  readonly jetonsTri: { entree: number; sortie: number };
  readonly jetonsBrouillon: { entree: number; sortie: number };
  /** Coût mensuel estimé d'une banque, en dollars ; null pour les règles */
  readonly coutMensuel: number | null;
  readonly notes: Notes;
}

export function centile(valeurs: readonly number[], p: number): number {
  if (!valeurs.length) return 0;
  const tries = [...valeurs].sort((x, y) => x - y);
  return tries[
    Math.min(tries.length - 1, Math.ceil((p / 100) * tries.length) - 1)
  ]!;
}

const moyenne = (v: readonly number[]) =>
  v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
const arrondi = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

export function noteDonnees(c: Candidat): number {
  return arrondi(
    (CRITERES_DONNEES.reduce((n, k) => n + c.donnees[k].note, 0) /
      (2 * CRITERES_DONNEES.length)) *
      100,
  );
}

export function noteTemps(p95: number): number {
  return arrondi(Math.max(0, Math.min(100, ((8000 - p95) / 6000) * 100)));
}

/** Notes d'un fournisseur (ou des règles : candidat vide), sans les notes relatives (coût). */
export function synthese(
  nom: string,
  modele: string,
  tris: readonly ResultatTri[],
  brouillons: readonly ResultatBrouillon[],
  candidat: Candidat | null,
  hypothese: FichierFournisseurs["hypotheseMensuelle"],
  neufs: readonly ResultatTri[] = [],
): Synthese {
  const ct = tris.map(corrigerTri);
  const cb = brouillons.map(corrigerBrouillon);
  const valides = brouillons.filter((b) => b.brouillon);
  const sansAlerte = cb.filter(
    (c, i) => brouillons[i]!.brouillon && c.alertes.length === 0,
  ).length;
  const triExact = ct.filter((c) => c.exact).length / Math.max(1, tris.length);
  const brouillonQualite = moyenne(cb.map((c) => c.qualite));
  const durees = [...tris, ...brouillons].map((r) => r.dureeMs);
  const jetons = (rs: readonly Mesure[]) => ({
    entree: arrondi(moyenne(rs.map((r) => r.jetonsEntree)), 0),
    sortie: arrondi(moyenne(rs.map((r) => r.jetonsSortie)), 0),
  });
  const jt = jetons(tris);
  const jb = jetons(brouillons);
  const coutMensuel = candidat
    ? arrondi(
        ((jt.entree * candidat.prixEntree + jt.sortie * candidat.prixSortie) *
          hypothese.tours +
          (jb.entree * candidat.prixEntree + jb.sortie * candidat.prixSortie) *
            hypothese.brouillons) /
          1_000_000,
        2,
      )
    : null;
  return {
    nom,
    modele,
    triExact: arrondi(triExact * 100),
    triIntention: arrondi(
      (ct.filter((c) => c.intention).length / Math.max(1, tris.length)) * 100,
    ),
    triNeufs: arrondi(
      (neufs.map(corrigerTri).filter((c) => c.exact).length /
        Math.max(1, neufs.length)) *
        100,
    ),
    brouillonQualite: arrondi(brouillonQualite * 100),
    brouillonsSansAlerte: arrondi(
      (sansAlerte / Math.max(1, valides.length)) * 100,
    ),
    echecs: [...tris, ...brouillons].filter((r) => r.echec).length,
    dureeP50: centile(durees, 50),
    dureeP95: centile(durees, 95),
    jetonsTri: jt,
    jetonsBrouillon: jb,
    coutMensuel,
    notes: {
      donnees: candidat ? noteDonnees(candidat) : null,
      interdits: arrondi((sansAlerte / Math.max(1, valides.length)) * 100),
      qualite: arrondi((0.6 * triExact + 0.4 * brouillonQualite) * 100),
      cout: null,
      temps: candidat ? noteTemps(centile(durees, 95)) : null,
      total: null,
    },
  };
}

/** Notes relatives (coût) et total pondéré des fournisseurs essayés. */
export function classer(
  syntheses: readonly Synthese[],
  poids: FichierFournisseurs["ponderation"],
): Synthese[] {
  const couts = syntheses
    .map((s) => s.coutMensuel)
    .filter((c): c is number => c !== null && c > 0);
  const moinsCher = couts.length ? Math.min(...couts) : 0;
  const somme =
    poids.donnees + poids.interdits + poids.qualite + poids.cout + poids.temps;
  return syntheses
    .map((s) => {
      if (s.coutMensuel === null) return s;
      const cout =
        s.coutMensuel > 0 ? arrondi((moinsCher / s.coutMensuel) * 100) : 100;
      const n = { ...s.notes, cout };
      const total = arrondi(
        ((n.donnees ?? 0) * poids.donnees +
          n.interdits * poids.interdits +
          n.qualite * poids.qualite +
          cout * poids.cout +
          (n.temps ?? 0) * poids.temps) /
          somme,
      );
      return { ...s, notes: { ...n, total } };
    })
    .sort((x, y) => (y.notes.total ?? -1) - (x.notes.total ?? -1));
}

// ---- Rapport --------------------------------------------------------------------------------

const pct = (n: number | null) =>
  n === null ? "—" : `${String(n).replace(".", ",")}`;
const dollars = (n: number | null) =>
  n === null ? "0 $" : `${n.toFixed(2).replace(".", ",")} $`;
const secondes = (ms: number) =>
  `${(ms / 1000).toFixed(1).replace(".", ",")} s`;

export interface EntreeRapport {
  readonly date: string;
  readonly corpus: Corpus;
  readonly fournisseurs: FichierFournisseurs;
  readonly classement: readonly Synthese[];
  readonly regles: Synthese;
  readonly nonTestes: readonly Candidat[];
  readonly details: ReadonlyMap<
    string,
    {
      tris: readonly ResultatTri[];
      brouillons: readonly ResultatBrouillon[];
      neufs: readonly ResultatTri[];
    }
  >;
}

export function rapportMarkdown(e: EntreeRapport): string {
  const p = e.fournisseurs.ponderation;
  const nbTri = e.corpus.cas.filter((c) => c.type === "tri").length;
  const nbBrouillon = e.corpus.cas.length - nbTri;
  const l: string[] = [];
  l.push("# Banc d'essai de l'assistant IA", "");
  l.push(
    `Exécuté le ${e.date} sur ${e.corpus.cas.length} échanges fictifs en français d'Abidjan : ${nbTri} messages à trier (portail), ${nbBrouillon} brouillons de réponse (agents).`,
  );
  l.push(
    "Les messages partent masqués, avec les mêmes consignes que l'API (backend/src/domaine/ia). Méthode et pondération : décision I6 de l'étape 14, note de l'étape 18.",
    "",
  );
  l.push("## Classement", "");
  l.push(
    `| Fournisseur | Modèle | Données (${p.donnees}) | Interdits (${p.interdits}) | Qualité (${p.qualite}) | Coût (${p.cout}) | Temps (${p.temps}) | **Total** |`,
  );
  l.push("|---|---|---:|---:|---:|---:|---:|---:|");
  for (const s of e.classement) {
    l.push(
      `| ${s.nom} | ${s.modele} | ${pct(s.notes.donnees)} | ${pct(s.notes.interdits)} | ${pct(s.notes.qualite)} | ${pct(s.notes.cout)} | ${pct(s.notes.temps)} | **${pct(s.notes.total)}** |`,
    );
  }
  if (!e.classement.length)
    l.push("| *aucun fournisseur essayé* | | | | | | | |");
  l.push(
    `| *Règles, sans IA (référence)* | — | *rien n'est envoyé* | ${pct(e.regles.notes.interdits)} | ${pct(e.regles.notes.qualite)} | *0 $* | *instantané* | *hors classement* |`,
    "",
  );
  if (e.nonTestes.length) {
    l.push(
      `Non essayés (pas de clé d'API fournie) : ${e.nonTestes.map((c) => `${c.nom} (${c.libelleModele})`).join(", ")}. ` +
        "Leur grille « données » figure plus bas ; les autres critères se mesurent en lançant le banc avec leur clé.",
      "",
    );
  }
  l.push(
    "Notes sur 100. Total : moyenne pondérée. Le coût est noté par rapport au moins cher des fournisseurs essayés.",
    "",
  );

  l.push("## Mesures", "");
  l.push(
    "| | Tri exact | Bonne intention | Messages neufs | Brouillons (contrôles) | Brouillons sans alerte | Échecs | Durée médiane | Durée 95 % | Jetons par tri | Jetons par brouillon | Coût mensuel estimé |",
  );
  l.push("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
  for (const s of [...e.classement, e.regles]) {
    l.push(
      `| ${s.nom} | ${pct(s.triExact)} % | ${pct(s.triIntention)} % | ${pct(s.triNeufs)} % | ${pct(s.brouillonQualite)} % | ${pct(s.brouillonsSansAlerte)} % | ${s.echecs} | ${secondes(s.dureeP50)} | ${secondes(s.dureeP95)} | ` +
        `${s.jetonsTri.entree} + ${s.jetonsTri.sortie} | ${s.jetonsBrouillon.entree} + ${s.jetonsBrouillon.sortie} | ${dollars(s.coutMensuel)} |`,
    );
  }
  l.push(
    "",
    `Messages neufs : ${e.corpus.controle.cas.length} messages écrits après la mise au point des règles, mesurés à part (hors notes). ` +
      "Les règles ont été ajustées sur les 70 messages à trier : leur score y est optimiste ; celui des messages neufs dit ce qu'elles valent sur des messages jamais vus.",
  );
  l.push(
    "",
    `Coût mensuel : ${e.fournisseurs.hypotheseMensuelle.tours} tours de l'assistant et ${e.fournisseurs.hypotheseMensuelle.brouillons} brouillons par banque, aux tarifs ci-dessous. Jetons : entrée + sortie, en moyenne.`,
    "",
  );

  l.push("## Données (grille à valider)", "");
  l.push(
    "| Critère | " +
      e.fournisseurs.candidats.map((c) => c.nom).join(" | ") +
      " |",
  );
  l.push("|---|" + e.fournisseurs.candidats.map(() => "---").join("|") + "|");
  for (const k of CRITERES_DONNEES) {
    l.push(
      `| ${k} | ` +
        e.fournisseurs.candidats
          .map((c) => `${c.donnees[k].note}/2 — ${c.donnees[k].constat}`)
          .join(" | ") +
        " |",
    );
  }
  l.push(
    "| **Note** | " +
      e.fournisseurs.candidats
        .map((c) => `**${pct(noteDonnees(c))}**`)
        .join(" | ") +
      " |",
    "",
  );
  for (const [k, v] of Object.entries(e.fournisseurs.grilleDonnees.criteres))
    l.push(`- **${k}** : ${v}`);
  l.push("", "Sources :");
  for (const c of e.fournisseurs.candidats) {
    l.push(
      `- ${c.nom} — ${c.libelleModele}, ${c.prixEntree} $ / ${c.prixSortie} $ par million de jetons (entrée / sortie)${c.remarqueTarif ? `. ${c.remarqueTarif}` : ""} : ${[...c.sourcesTarif, ...c.sourcesDonnees].join(", ")}`,
    );
  }
  l.push("");

  for (const [nom, d] of e.details) {
    l.push(`## Détail — ${nom}`, "");
    const erreurs = [...d.tris, ...d.neufs]
      .map((r) => ({ r, c: corrigerTri(r) }))
      .filter((x) => !x.c.exact);
    l.push(
      `### Tri : ${erreurs.length} écart(s) sur ${d.tris.length + d.neufs.length} (dont messages neufs N…)`,
      "",
    );
    if (erreurs.length) {
      l.push(
        "| Cas | Dernier message du client | Attendu | Rendu |",
        "|---|---|---|---|",
      );
      for (const { r, c } of erreurs) {
        const dernier =
          [...r.cas.echanges].reverse().find((x) => x.auteur === "CLIENT")
            ?.texte ?? "";
        const a = r.cas.attendu;
        l.push(
          `| ${r.cas.id} | ${dernier.replace(/\|/g, "/")} | ${a.intention}${a.faqId ? ` ${a.faqId}` : ""}${a.categories ? ` ${a.categories.map((x) => x ?? "aucune").join(" ou ")}` : ""}${a.complet === undefined ? "" : a.complet ? " complet" : " incomplet"} | ${c.detail} |`,
        );
      }
      l.push("");
    }
    l.push("### Brouillons, à relire", "");
    for (const r of d.brouillons) {
      const c = corrigerBrouillon(r);
      const echecs = Object.entries(c.controles)
        .filter(([, v]) => !v)
        .map(([k]) => k);
      l.push(
        `**${r.cas.id}**${r.cas.piege ? ` (${r.cas.piege})` : ""} — ${c.alertes.length ? `⚠ ${c.alertes.map((a) => LIBELLE_INTERDIT[a]).join(", ")}` : "aucune alerte"}${echecs.length ? ` ; contrôles manqués : ${echecs.join(", ")}` : ""}`,
        "",
      );
      l.push(
        r.brouillon
          ? r.brouillon.brouillon
              .split("\n")
              .map((x) => `> ${x}`)
              .join("\n")
          : `> *réponse inexploitable : ${r.echec}*`,
        "",
      );
    }
  }
  return l.join("\n");
}
