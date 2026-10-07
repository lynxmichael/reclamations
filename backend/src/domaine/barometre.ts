/**
 * Baromètre mensuel de l'expérience client (étape 23) : règles pures, partagées par l'API, le worker,
 * les écrans et la démo.
 *
 * Un baromètre par banque et par mois, publié le 1er du mois suivant et figé ensuite :
 * - les indicateurs du mois, comparés au mois précédent, et leur évolution sur 6 mois ;
 * - les irritants : catégories et agences où les clients rencontrent le plus de difficultés, selon un
 *   score qui s'explique en une phrase (une réclamation compte 1, plus 1 si elle a été traitée hors
 *   délai, plus 1 si le client l'a contestée, plus 1 s'il s'est dit insatisfait) ;
 * - ce que disent les clients : les thèmes de leurs commentaires ;
 * - les faits marquants du mois ;
 * - des recommandations, que l'Admin Entreprise retient ou écarte.
 *
 * Définitions sur le mois (dans le fuseau de la banque) :
 * - volumes : réclamations déposées pendant le mois ;
 * - délais, premier contact : réclamations résolues pendant le mois ;
 * - contestations : réclamations contestées pendant le mois (rouvertes par le client) ;
 * - satisfaction : réponses reçues pendant le mois ; taux de réponse : enquêtes terminées pendant le
 *   mois (7 jours après la clôture) et leurs réponses. Le baromètre est donc complet dès le 1er.
 */
import { aplatir } from './ia/texte.js';

export const MOIS_TENDANCE = 6;
/** En dessous, satisfaction et NPS sont signalés « peu de réponses » */
export const REPONSES_MIN = 30;
/** Une catégorie ou une agence compte comme irritant à partir de ce nombre de réclamations */
export const RECLAMATIONS_MIN_IRRITANT = 3;
export const IRRITANTS_MAX = 5;
export const AGENCES_MAX = 3;
export const RECOMMANDATIONS_MAX = 5;
export const THEMES_MAX = 6;
export const EXEMPLES_PAR_THEME = 2;
export const LONGUEUR_EXEMPLE = 240;

// ---------------------------------------------------------------------------
//  Mois
// ---------------------------------------------------------------------------

const NOMS_MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
export const FORMAT_MOIS = /^\d{4}-(0[1-9]|1[0-2])$/;

/** « 2026-09 » → « septembre 2026 » */
export function libelleMois(mois: string): string {
  const [a, m] = mois.split('-').map(Number);
  return `${NOMS_MOIS[m! - 1]} ${a}`;
}

/** « de septembre 2026 », « d'août 2026 », « d'octobre 2026 » */
export function deMois(mois: string): string {
  const l = libelleMois(mois);
  return /^[aeiouéèêâ]/i.test(l) ? `d'${l}` : `de ${l}`;
}

/** Le mois qui précède (ou suit, avec un décalage positif) : « 2026-01 », -1 → « 2025-12 » */
export function decalerMois(mois: string, decalage: number): string {
  const [a, m] = mois.split('-').map(Number);
  const n = a! * 12 + (m! - 1) + decalage;
  return `${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, '0')}`;
}

/** Les `n` mois qui finissent par `mois`, du plus ancien au plus récent */
export function moisJusqua(mois: string, n = MOIS_TENDANCE): string[] {
  return Array.from({ length: n }, (_, i) => decalerMois(mois, i - n + 1));
}

// ---------------------------------------------------------------------------
//  Indicateurs
// ---------------------------------------------------------------------------

export interface MesuresMois {
  /** Déposées pendant le mois */
  readonly reclamations: number;
  readonly urgentes: number;
  /** Résolues pendant le mois */
  readonly resolues: number;
  readonly tauxRespectSla: number | null;
  readonly tauxPremierContact: number | null;
  readonly delaiResolutionMoyenMinutes: number | null;
  /** Contestées par le client pendant le mois */
  readonly contestees: number;
  /** Enquêtes terminées pendant le mois, et leurs réponses */
  readonly enquetes: number;
  readonly tauxReponse: number | null;
  /** Réponses reçues pendant le mois */
  readonly reponses: number;
  readonly tauxSatisfaits: number | null;
  readonly noteMoyenne: number | null;
  readonly nps: number | null;
}

export interface PointTendance {
  readonly mois: string;
  readonly reclamations: number;
  readonly tauxRespectSla: number | null;
  readonly reponses: number;
  readonly tauxSatisfaits: number | null;
  readonly nps: number | null;
}

export const taux = (n: number, sur: number): number | null => (sur ? Math.round((n / sur) * 10_000) / 10_000 : null);

/** Peu de réponses : satisfaction et NPS à lire avec prudence */
export const peuDeReponses = (m: Pick<MesuresMois, 'reponses'>) => m.reponses < REPONSES_MIN;

// ---------------------------------------------------------------------------
//  Irritants
// ---------------------------------------------------------------------------

export interface ComptesIrritant {
  /** Identifiant de la catégorie ou de l'agence */
  readonly cle: string;
  readonly libelle: string;
  readonly reclamations: number;
  /** Réclamations du mois précédent */
  readonly precedent: number;
  readonly resolues: number;
  readonly horsDelai: number;
  readonly contestees: number;
  readonly reponses: number;
  /** Notes de 1 à 3 */
  readonly insatisfaits: number;
}

export interface Irritant extends ComptesIrritant {
  readonly score: number;
}

/** Une réclamation compte 1, plus 1 traitée hors délai, plus 1 contestée, plus 1 client insatisfait. */
export const scoreIrritant = (c: ComptesIrritant) => c.reclamations + c.horsDelai + c.contestees + c.insatisfaits;

/** Les irritants du mois, du plus fort au plus faible, à partir de 3 réclamations. */
export function irritants(lignes: readonly ComptesIrritant[], max = IRRITANTS_MAX): Irritant[] {
  return lignes
    .filter((l) => l.reclamations >= RECLAMATIONS_MIN_IRRITANT)
    .map((l) => ({ ...l, score: scoreIrritant(l) }))
    .sort((a, b) => b.score - a.score || b.reclamations - a.reclamations || a.libelle.localeCompare(b.libelle, 'fr'))
    .slice(0, max);
}

// ---------------------------------------------------------------------------
//  Ce que disent les clients
// ---------------------------------------------------------------------------

export interface CommentaireMois {
  readonly numero: string;
  /** Satisfaction, de 1 à 5 */
  readonly note: number;
  /** Recommandation, de 0 à 10 */
  readonly recommandation: number;
  readonly texte: string;
}

export interface Exemple {
  readonly numero: string;
  readonly note: number;
  readonly texte: string;
}

export interface Theme {
  readonly libelle: string;
  /** Commentaires qui en parlent */
  readonly mentions: number;
  /** Parmi eux, notes de 1 à 3 et de 4 à 5 */
  readonly negatifs: number;
  readonly positifs: number;
  readonly exemples: readonly Exemple[];
}

/** Thèmes reconnus par mots-clés (texte mis à plat : minuscules, sans accents). */
export const THEMES: readonly { readonly cle: string; readonly libelle: string; readonly motif: RegExp }[] = [
  { cle: 'DELAI', libelle: 'Délais de traitement', motif: /\b(delai|lent|lenteur|long|longtemps|attend\w*|attente|toujours pas|relance\w*|semaines?|des jours|trop de temps|rapide\w*|vite)\b/ },
  { cle: 'INFORMATION', libelle: 'Information et suivi du dossier', motif: /\b(informe\w*|information|nouvelles?|sms|suivi|rappel\w*|explication\w*|explique\w*|personne ne|sans reponse|pas de reponse|tenu au courant)\b/ },
  { cle: 'FRAIS', libelle: 'Frais et prélèvements', motif: /\b(frais|preleve\w*|prelevement\w*|commissions?|agios|facture\w*|debite\w*|tenue de compte)\b/ },
  { cle: 'ACCUEIL', libelle: 'Accueil et écoute', motif: /\b(accueil\w*|poli\w*|impoli\w*|aimable|gentil\w*|ecoute\w*|respect\w*|courtois\w*|mepris\w*|conseill\w*|agent)\b/ },
  { cle: 'DISTRIBUTEURS', libelle: 'Distributeurs et cartes', motif: /\b(gab|dab|distributeur\w*|carte\w*|retrait\w*|avale\w*|billets?)\b/ },
  { cle: 'MOBILE', libelle: 'Application et paiements mobiles', motif: /\b(application|appli|mobile|connexion|connecter|mot de passe|wave|orange money|momo|moov|virement\w*)\b/ },
  { cle: 'SOLUTION', libelle: 'Solution apportée', motif: /\b(rembourse\w*|recredite\w*|regle\w*|resolu\w*|solution|regularise\w*|corrige\w*)\b/ },
];

/** Exemples d'un thème : les plus parlants (notes les plus basses s'il est surtout négatif), différents, raccourcis. */
export function exemplesDe(liste: readonly CommentaireMois[], negatif: boolean): Exemple[] {
  const vus = new Set<string>();
  return [...liste]
    .sort((a, b) => (negatif ? a.note - b.note : b.note - a.note) || a.texte.length - b.texte.length)
    .filter((c) => {
      const cle = aplatir(c.texte);
      if (vus.has(cle)) return false;
      vus.add(cle);
      return true;
    })
    .slice(0, EXEMPLES_PAR_THEME)
    .map((c) => ({ numero: c.numero, note: c.note, texte: c.texte.length > LONGUEUR_EXEMPLE ? `${c.texte.slice(0, LONGUEUR_EXEMPLE - 1).trimEnd()}…` : c.texte }));
}

/** Un thème à partir des commentaires qui en parlent (les nombres sont comptés, jamais repris de l'IA). */
export function theme(libelle: string, liste: readonly CommentaireMois[]): Theme {
  const negatifs = liste.filter((c) => c.note <= 3).length;
  return { libelle, mentions: liste.length, negatifs, positifs: liste.length - negatifs, exemples: exemplesDe(liste, negatifs * 2 >= liste.length) };
}

export function themesParRegles(commentaires: readonly CommentaireMois[]): Theme[] {
  return THEMES
    .map((t) => theme(t.libelle, commentaires.filter((c) => t.motif.test(aplatir(c.texte)))))
    .filter((t) => t.mentions > 0)
    .sort((a, b) => b.mentions - a.mentions || b.negatifs - a.negatifs)
    .slice(0, THEMES_MAX);
}

// ---------------------------------------------------------------------------
//  Faits marquants
// ---------------------------------------------------------------------------

export interface FaitMarquant {
  readonly sens: 'MIEUX' | 'MOINS_BIEN';
  readonly texte: string;
}

const pct = (t: number) => `${Math.round(t * 100)} %`;
/** « 1 réclamation », « 4 réclamations » */
const nb = (n: number, mot: string) => `${n} ${mot}${n > 1 ? 's' : ''}`;
const points = (d: number) => `${d > 0 ? '+' : ''}${Math.round(d * 100)} point${Math.abs(Math.round(d * 100)) > 1 ? 's' : ''}`;
const variation = (n: number, p: number) => `${n >= p ? '+' : ''}${Math.round(((n - p) / p) * 100)} %`;
const nombre = (n: number) => n.toLocaleString('fr-FR').replace(/ /g, ' ');

/** Ce qui a bougé nettement depuis le mois précédent (6 au plus). */
export function faitsMarquants(m: MesuresMois, p: MesuresMois | null, cats: readonly Irritant[]): FaitMarquant[] {
  if (!p) return [];
  const faits: FaitMarquant[] = [];
  const ecartTaux = (nom: string, a: number | null, b: number | null, base: number, seuil = 0.05) => {
    if (a === null || b === null || base < 10 || Math.abs(a - b) < seuil) return;
    faits.push({ sens: a > b ? 'MIEUX' : 'MOINS_BIEN', texte: `${nom} : ${pct(a)} (${points(a - b)} sur le mois précédent)` });
  };
  if (p.reclamations >= 10 && Math.abs(m.reclamations - p.reclamations) >= Math.max(10, p.reclamations * 0.2)) {
    faits.push({ sens: m.reclamations < p.reclamations ? 'MIEUX' : 'MOINS_BIEN', texte: `Réclamations reçues : ${nombre(m.reclamations)} (${variation(m.reclamations, p.reclamations)})` });
  }
  ecartTaux('Délais respectés', m.tauxRespectSla, p.tauxRespectSla, Math.min(m.resolues, p.resolues));
  ecartTaux('Résolues au premier contact', m.tauxPremierContact, p.tauxPremierContact, Math.min(m.resolues, p.resolues));
  ecartTaux('Clients satisfaits', m.tauxSatisfaits, p.tauxSatisfaits, Math.min(m.reponses, p.reponses));
  if (m.nps !== null && p.nps !== null && Math.min(m.reponses, p.reponses) >= 10 && Math.abs(m.nps - p.nps) >= 10) {
    faits.push({ sens: m.nps > p.nps ? 'MIEUX' : 'MOINS_BIEN', texte: `NPS : ${m.nps > 0 ? '+' : ''}${m.nps} (${m.nps - p.nps > 0 ? '+' : ''}${m.nps - p.nps} sur le mois précédent)` });
  }
  if (m.delaiResolutionMoyenMinutes && p.delaiResolutionMoyenMinutes && Math.min(m.resolues, p.resolues) >= 10 && Math.abs(m.delaiResolutionMoyenMinutes - p.delaiResolutionMoyenMinutes) >= p.delaiResolutionMoyenMinutes * 0.2) {
    faits.push({
      sens: m.delaiResolutionMoyenMinutes < p.delaiResolutionMoyenMinutes ? 'MIEUX' : 'MOINS_BIEN',
      texte: `Délai moyen de résolution : ${variation(m.delaiResolutionMoyenMinutes, p.delaiResolutionMoyenMinutes)} (en heures ouvrées)`,
    });
  }
  for (const c of cats) {
    if (c.precedent >= 5 && c.reclamations >= c.precedent * 1.5) {
      faits.push({ sens: 'MOINS_BIEN', texte: `« ${c.libelle} » : ${nombre(c.reclamations)} réclamations, contre ${nombre(c.precedent)} le mois précédent` });
    }
  }
  return faits.slice(0, 6);
}

// ---------------------------------------------------------------------------
//  Recommandations
// ---------------------------------------------------------------------------

export type Priorite = 'HAUTE' | 'MOYENNE';

export interface RecommandationProposee {
  readonly titre: string;
  readonly constat: string;
  readonly action: string;
  /** La catégorie concernée, s'il y en a une */
  readonly categorieId: string | null;
  readonly priorite: Priorite;
}

export interface EntreeAnalyse {
  readonly banque: string;
  readonly mois: string;
  readonly mesures: MesuresMois;
  readonly precedent: MesuresMois | null;
  readonly categories: readonly Irritant[];
  readonly agences: readonly Irritant[];
  readonly themes: readonly Theme[];
  /** Réglages utiles aux recommandations */
  readonly enqueteActive: boolean;
  readonly smsChaqueChangementStatut: boolean;
}

/**
 * Recommandations sans IA : des règles simples sur les chiffres du mois, chacune appuyée sur un
 * constat chiffré. 5 au plus, les plus urgentes d'abord, 2 au plus par catégorie.
 */
export function recommandationsParRegles(e: EntreeAnalyse): RecommandationProposee[] {
  const r: RecommandationProposee[] = [];
  const m = e.mesures;
  const themeDe = (cle: string) => {
    const libelle = THEMES.find((t) => t.cle === cle)!.libelle;
    return e.themes.find((t) => t.libelle === libelle);
  };
  for (const c of e.categories) {
    if (c.resolues >= 5 && c.horsDelai / c.resolues >= 0.15) {
      r.push({
        titre: `Traiter plus vite les réclamations « ${c.libelle} »`,
        constat: `${nb(c.horsDelai, 'réclamation')} sur ${c.resolues} résolues ce mois-ci ${c.horsDelai > 1 ? 'l\'ont' : 'l\'a'} été hors délai (${pct(1 - c.horsDelai / c.resolues)} dans les délais).`,
        action: 'Vérifier le délai cible de la catégorie et l\'équipe qui la traite (groupe d\'agents, attribution automatique) ; suivre chaque jour la file « En retard ».',
        categorieId: c.cle, priorite: 'HAUTE',
      });
    }
    if (c.contestees >= 3 && c.contestees / Math.max(c.resolues, 1) >= 0.1) {
      r.push({
        titre: `Répondre du premier coup sur « ${c.libelle} »`,
        constat: `${c.contestees} réclamations « ${c.libelle} » ont été contestées par le client après leur résolution.`,
        action: 'Relire en équipe les contestations du mois ; compléter les réponses types et la base de réponses de l\'assistant sur ce sujet.',
        categorieId: c.cle, priorite: 'HAUTE',
      });
    }
  }
  for (const c of e.categories) {
    if (c.reponses >= 5 && c.insatisfaits / c.reponses >= 0.4) {
      r.push({
        titre: `Comprendre l'insatisfaction sur « ${c.libelle} »`,
        constat: `${c.insatisfaits} clients sur ${c.reponses} ont donné une note de 1 à 3 à leur réclamation « ${c.libelle} ».`,
        action: 'Rappeler les clients insatisfaits du mois, noter ce qui les a déçus et en tirer une consigne pour l\'équipe.',
        categorieId: c.cle, priorite: 'MOYENNE',
      });
    }
    if (c.precedent >= 5 && c.reclamations >= c.precedent * 1.5 && c.reclamations >= 10) {
      r.push({
        titre: `Chercher la cause de la hausse « ${c.libelle} »`,
        constat: `${c.reclamations} réclamations « ${c.libelle} », contre ${c.precedent} le mois précédent.`,
        action: 'Vérifier avec le service concerné un incident ou un changement (frais, application, distributeurs) ; préparer une réponse type et, si besoin, une question fréquente pour l\'assistant.',
        categorieId: c.cle, priorite: 'MOYENNE',
      });
    }
  }
  const information = themeDe('INFORMATION');
  if (information && information.negatifs >= 3) {
    r.push({
      titre: 'Informer les clients à chaque étape',
      constat: `${information.negatifs} clients insatisfaits parlent du manque d'information ou de suivi dans leur commentaire.`,
      action: e.smsChaqueChangementStatut
        ? 'Sur les dossiers longs, envoyer au client un point d\'étape au moins une fois par semaine, même sans nouvelle.'
        : 'Activer « SMS à chaque changement de statut » dans le paramétrage ; sur les dossiers longs, envoyer un point d\'étape chaque semaine.',
      categorieId: null, priorite: 'MOYENNE',
    });
  }
  const accueil = themeDe('ACCUEIL');
  if (accueil && accueil.negatifs >= 3) {
    r.push({
      titre: 'Travailler l\'accueil et l\'écoute',
      constat: `${accueil.negatifs} clients insatisfaits parlent de l'accueil ou de l'écoute dans leur commentaire.`,
      action: 'Partager ces commentaires avec les équipes concernées et rappeler les règles d\'accueil en réunion.',
      categorieId: null, priorite: 'MOYENNE',
    });
  }
  const agence = [...e.agences].filter((a) => a.resolues >= 5 && a.horsDelai / a.resolues >= 0.2)
    .sort((a, b) => b.horsDelai / b.resolues - a.horsDelai / a.resolues)[0];
  if (agence) {
    r.push({
      titre: `Soutenir l'agence ${agence.libelle}`,
      constat: `${nb(agence.horsDelai, 'réclamation')} sur ${agence.resolues} résolues à l'agence ${agence.libelle} ${agence.horsDelai > 1 ? 'l\'ont' : 'l\'a'} été hors délai.`,
      action: 'Regarder avec son équipe la charge et les absences (Activité des agences), et répartir ses dossiers en retard.',
      categorieId: null, priorite: 'MOYENNE',
    });
  }
  if (!e.enqueteActive) {
    r.push({
      titre: 'Mesurer la satisfaction des clients',
      constat: 'Sans enquête de satisfaction, ce baromètre ne dit pas ce que les clients pensent du traitement de leur réclamation.',
      action: 'Demander à Makor d\'ouvrir l\'enquête de satisfaction à la clôture (deux questions, une seule fois par réclamation).',
      categorieId: null, priorite: 'MOYENNE',
    });
  } else if (m.enquetes >= 20 && m.tauxReponse !== null && m.tauxReponse < 0.2) {
    r.push({
      titre: 'Faire répondre plus de clients à l\'enquête',
      constat: `${pct(m.tauxReponse)} des clients ont répondu à l'enquête de satisfaction terminée ce mois-ci.`,
      action: 'Dans la réponse finale, rappeler au client que son avis compte ; vérifier que son téléphone et son e-mail sont à jour.',
      categorieId: null, priorite: 'MOYENNE',
    });
  }
  // Les plus urgentes d'abord, 2 au plus par catégorie, 5 au plus
  const parCategorie = new Map<string, number>();
  return r
    .map((x, i) => ({ x, i }))
    .sort((a, b) => (a.x.priorite === b.x.priorite ? a.i - b.i : a.x.priorite === 'HAUTE' ? -1 : 1))
    .map(({ x }) => x)
    .filter((x) => {
      if (!x.categorieId) return true;
      const n = parCategorie.get(x.categorieId) ?? 0;
      parCategorie.set(x.categorieId, n + 1);
      return n < 2;
    })
    .slice(0, RECOMMANDATIONS_MAX);
}

/** Nombres écrits dans un texte (« 87 % », « 1 200 », « 3,5 ») : ce qu'une recommandation de l'IA cite. */
export function nombresCites(texte: string): string[] {
  return (texte.replace(/(\d)[\s  ](?=\d{3}\b)/g, '$1').match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => n.replace(',', '.'));
}
