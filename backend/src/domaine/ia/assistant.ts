/**
 * L'assistant du portail (étape 18, décisions I3 et I4 de l'étape 14) : règles pures, partagées par
 * l'API, le banc d'essai et la démo cliquable.
 *
 * L'IA ne fait qu'une chose côté client : elle **décide** (intention, question fréquente, catégorie)
 * à partir du message du client, masqué. Elle n'écrit jamais au client : ce qu'il lit vient des
 * textes ci-dessous et des réponses écrites et validées par la banque. Elle ne peut donc ni promettre,
 * ni changer un statut, ni conseiller. Le dépôt part quand le client l'envoie lui-même, avec son
 * consentement, après avoir relu la catégorie et la description proposées.
 *
 * Sans fournisseur d'IA (ou s'il ne répond pas), les mêmes décisions sont prises par des règles de
 * mots-clés (`decisionParRegles`) : moins fines, mais sans coût ni envoi de données.
 */
import { demandeHumain } from './interdits.js';
import { aplatir, estQuestion, motsSignificatifs } from './texte.js';

export type Intention = 'SALUTATION' | 'FAQ' | 'RECLAMATION' | 'CONSEILLER' | 'FIN' | 'HORS_SUJET' | 'INCOMPRIS';
export const INTENTIONS: readonly Intention[] = ['SALUTATION', 'FAQ', 'RECLAMATION', 'CONSEILLER', 'FIN', 'HORS_SUJET', 'INCOMPRIS'];

/** Ce que décide l'IA (ou les règles) pour le dernier message du client. */
export interface Decision {
  readonly intention: Intention;
  /** Question fréquente qui répond au client (intention FAQ) */
  readonly faqId: string | null;
  /** Catégorie de la banque qui correspond au problème (intention RECLAMATION) */
  readonly categorieId: string | null;
  /** Le client a assez décrit son problème pour déposer */
  readonly complet: boolean;
}

export interface QuestionFrequente {
  readonly id: string;
  readonly question: string;
  readonly reponse: string;
}

export interface CategorieAssistant {
  readonly id: string;
  readonly nom: string;
  readonly description: string | null;
}

export interface ContexteAssistant {
  readonly banque: string;
  readonly faq: readonly QuestionFrequente[];
  readonly categories: readonly CategorieAssistant[];
  /** La banque est-elle ouverte, et sinon quand reprend-elle (texte déjà mis en forme) */
  readonly ouverte: boolean;
  readonly reprise: string | null;
}

export type CodeMessage =
  | 'PRESENTATION' | 'SALUTATION' | 'FAQ' | 'FAQ_SUITE' | 'PRECISER' | 'PROPOSER_DEPOT' | 'TRANSFERT' | 'FIN' | 'HORS_SUJET' | 'INCOMPRIS' | 'CODE_SECRET';

export interface Echange {
  readonly auteur: 'CLIENT' | 'ASSISTANT';
  readonly texte: string;
  /** Pour l'assistant : le texte qu'il a dit (renvoyé par le portail à chaque tour) */
  readonly code?: CodeMessage;
}

export interface MessageAssistant {
  readonly texte: string;
  readonly code: CodeMessage;
}

export interface Proposition {
  readonly motif: 'DEPOT' | 'TRANSFERT';
  readonly categorieId: string | null;
  /** Les mots du client, à relire et compléter avant l'envoi */
  readonly description: string;
}

export interface ReponseAssistant {
  readonly messages: readonly MessageAssistant[];
  readonly proposition: Proposition | null;
  /** Réponses en un toucher */
  readonly suggestions: readonly string[];
}

// ---------------------------------------------------------------------------
//  Ce que dit l'assistant : des textes fixes, et les réponses de la banque
// ---------------------------------------------------------------------------

export const SUGGESTION_DEPOT = 'Déposer une réclamation';
export const SUGGESTION_CONSEILLER = 'Parler à un conseiller';
export const SUGGESTION_MERCI = 'Merci, c\'est clair';

/** Premier message, affiché à l'ouverture : l'assistant se présente comme tel (décision I3). */
export function presentation(banque: string): MessageAssistant {
  return {
    code: 'PRESENTATION',
    texte: `Bonjour, je suis l'assistant automatique de ${banque}. Je réponds aux questions fréquentes et je vous aide à déposer une réclamation. `
      + 'À tout moment, écrivez « conseiller » pour qu\'une personne de la banque prenne le relais.',
  };
}

export const TEXTES = {
  SALUTATION: 'Bonjour ! Dites-moi ce qui se passe, ou posez votre question.',
  FAQ_SUITE: 'Cela répond-il à votre question ? Sinon, décrivez votre problème, ou écrivez « conseiller ».',
  FIN: 'Avec plaisir. Si vous avez une autre question, je suis là.',
  HORS_SUJET: 'Je suis l\'assistant du service réclamations : je ne réponds qu\'aux questions sur vos réclamations et sur les services de la banque. '
    + 'Voulez-vous déposer une réclamation, ou parler à un conseiller ?',
  INCOMPRIS: 'Je n\'ai pas bien compris. Pouvez-vous le dire autrement, en quelques mots ? Vous pouvez aussi écrire « conseiller ».',
  CODE_SECRET: 'Attention : ne communiquez jamais votre code secret, votre mot de passe ni un code reçu par SMS, même à la banque. '
    + 'Je l\'ai retiré de votre message.',
} as const;

/**
 * Réouverture de la banque, en toutes lettres, dans son fuseau : « aujourd'hui à 14 h »,
 * « demain à 8 h », « lundi à 8 h 30 », au-delà d'une semaine « le 05/10 à 8 h ».
 */
export function texteReprise(reprise: Date, maintenant: Date, fuseau: string): string {
  const parties = (d: Date) => Object.fromEntries(
    new Intl.DateTimeFormat('fr-FR', { timeZone: fuseau, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'long', hourCycle: 'h23' })
      .formatToParts(d).map((p) => [p.type, p.value]),
  ) as Record<'year' | 'month' | 'day' | 'hour' | 'minute' | 'weekday', string>;
  const r = parties(reprise);
  const m = parties(maintenant);
  const jours = Math.round((Date.UTC(+r.year, +r.month - 1, +r.day) - Date.UTC(+m.year, +m.month - 1, +m.day)) / 86_400_000);
  const heure = `${Number(r.hour)} h${r.minute === '00' ? '' : ` ${r.minute}`}`;
  const jour = jours <= 0 ? 'aujourd\'hui' : jours === 1 ? 'demain' : jours < 7 ? r.weekday : `le ${r.day}/${r.month}`;
  return `${jour} à ${heure}`;
}

const quand = (ctx: ContexteAssistant) => (ctx.ouverte || !ctx.reprise ? '' : ` La banque est fermée : un conseiller vous répondra dès la réouverture, ${ctx.reprise}.`);
const dansCategorie = (c: CategorieAssistant | undefined) => (c ? ` dans la catégorie « ${c.nom} »` : '');

// ---------------------------------------------------------------------------
//  Réponse au client, à partir de la décision
// ---------------------------------------------------------------------------

/**
 * Réponses de l'assistant après lesquelles le client passe à autre chose : une question fréquente
 * réglée, une salutation, une incompréhension. La description ne reprend que ce qui suit.
 */
const NOUVEAU_SUJET: ReadonlySet<CodeMessage> = new Set(['PRESENTATION', 'SALUTATION', 'FAQ', 'FAQ_SUITE', 'FIN', 'HORS_SUJET', 'INCOMPRIS']);

/**
 * Description proposée pour le dépôt : les messages du client sur son problème (depuis la dernière
 * question fréquente ou salutation), sans formules de politesse, codes secrets retirés.
 */
export function descriptionPourDepot(echanges: readonly Echange[]): string {
  let debut = 0;
  echanges.forEach((e, i) => {
    if (e.auteur === 'ASSISTANT' && e.code && NOUVEAU_SUJET.has(e.code)) debut = i + 1;
  });
  return echanges
    .slice(debut)
    .filter((e) => e.auteur === 'CLIENT')
    .map((e) => retirerCodesSecrets(e.texte.trim()))
    .filter((t) => t && !estFormule(t))
    .join('\n')
    .slice(0, 5000);
}

/** Salutation, remerciement, demande d'un conseiller ou réponse en un toucher : rien à décrire. */
function estFormule(texte: string): boolean {
  const t = aplatir(texte).replace(/[!.?,]/g, '').trim();
  if ([SUGGESTION_DEPOT, SUGGESTION_CONSEILLER, SUGGESTION_MERCI].some((s) => aplatir(s) === t)) return true;
  if (/^(bonjour|bonsoir|salut|slt|bjr|bsr|cc|coucou|allo|hello|bonne (journee|soiree)|merci( beaucoup| bien)?|ok|d'accord|dac|super|parfait)( (a vous|madame|monsieur|la banque))?$/.test(t)) return true;
  return demandeHumain(texte) && motsSignificatifs(texte).size <= 3;
}

const CODE_SECRET = /\b(code(?:\s+(?:secret|pin|confidentiel|de validation|otp|re[çc]u(?: par sms)?))?|pin|mot de passe|mdp|cvv|cvc|cryptogramme|otp)((?:\s*(?:est|:|=|c'est))?\s*)([A-Za-z0-9]{3,12})\b/gi;

export function retirerCodesSecrets(texte: string): string {
  return texte.replace(CODE_SECRET, (m, nom: string, liaison: string, valeur: string) => (/\d/.test(valeur) ? `${nom}${liaison}[code retiré]` : m));
}

/** Nombre d'incompréhensions de suite, juste avant ce message. */
function incomprisDeSuite(echanges: readonly Echange[]): number {
  let n = 0;
  for (let i = echanges.length - 1; i >= 0; i--) {
    const e = echanges[i]!;
    if (e.auteur === 'CLIENT') continue;
    if (e.code === 'INCOMPRIS' || e.code === 'HORS_SUJET') n++;
    else break;
  }
  return n;
}

/**
 * Ce que l'assistant répond, à partir de la décision sur le dernier message du client. Après deux
 * incompréhensions de suite, il passe la main à un conseiller (décision I3).
 */
export function repondre(decision: Decision, echanges: readonly Echange[], ctx: ContexteAssistant, codeSecret = false): ReponseAssistant {
  const messages: MessageAssistant[] = codeSecret ? [{ code: 'CODE_SECRET', texte: TEXTES.CODE_SECRET }] : [];
  const categorie = ctx.categories.find((c) => c.id === decision.categorieId);
  const proposition = (motif: Proposition['motif']): Proposition => ({ motif, categorieId: categorie?.id ?? null, description: descriptionPourDepot(echanges) });
  const transfert = (): ReponseAssistant => ({
    messages: [...messages, {
      code: 'TRANSFERT',
      texte: 'D\'accord, je passe la main à un conseiller. Pour qu\'il vous réponde, envoyez votre demande ci-dessous : elle lui parvient aussitôt, '
        + `et vous continuerez la discussion avec lui.${quand(ctx)}`,
    }],
    proposition: proposition('TRANSFERT'),
    suggestions: [],
  });

  let intention = decision.intention;
  const faq = ctx.faq.find((f) => f.id === decision.faqId);
  if (intention === 'FAQ' && !faq) intention = 'INCOMPRIS';
  if ((intention === 'INCOMPRIS' || intention === 'HORS_SUJET') && incomprisDeSuite(echanges) >= 2) return transfert();

  switch (intention) {
    case 'CONSEILLER':
      return transfert();
    case 'SALUTATION':
      return { messages: [...messages, { code: 'SALUTATION', texte: TEXTES.SALUTATION }], proposition: null, suggestions: [SUGGESTION_DEPOT, SUGGESTION_CONSEILLER] };
    case 'FIN':
      return { messages: [...messages, { code: 'FIN', texte: TEXTES.FIN }], proposition: null, suggestions: [SUGGESTION_DEPOT] };
    case 'FAQ':
      return {
        messages: [...messages, { code: 'FAQ', texte: faq!.reponse }, { code: 'FAQ_SUITE', texte: TEXTES.FAQ_SUITE }],
        proposition: null,
        suggestions: [SUGGESTION_MERCI, SUGGESTION_DEPOT, SUGGESTION_CONSEILLER],
      };
    case 'RECLAMATION':
      if (!decision.complet) {
        return {
          messages: [...messages, {
            code: 'PRECISER',
            texte: `Je vais vous aider à déposer une réclamation${dansCategorie(categorie)}. Pouvez-vous préciser ce qui s'est passé : quand, où, et pour quel montant ? `
              + 'N\'écrivez ni votre code secret ni votre mot de passe.',
          }],
          proposition: null,
          suggestions: [SUGGESTION_CONSEILLER],
        };
      }
      return {
        messages: [...messages, {
          code: 'PROPOSER_DEPOT',
          texte: `Voici votre réclamation, prête à être envoyée${dansCategorie(categorie)}. Vérifiez-la, ajoutez vos coordonnées, puis envoyez-la : `
            + `un conseiller la prend en charge.${quand(ctx)}`,
        }],
        proposition: proposition('DEPOT'),
        suggestions: [],
      };
    case 'HORS_SUJET':
      return { messages: [...messages, { code: 'HORS_SUJET', texte: TEXTES.HORS_SUJET }], proposition: null, suggestions: [SUGGESTION_DEPOT, SUGGESTION_CONSEILLER] };
    case 'INCOMPRIS':
    default:
      return { messages: [...messages, { code: 'INCOMPRIS', texte: TEXTES.INCOMPRIS }], proposition: null, suggestions: [SUGGESTION_DEPOT, SUGGESTION_CONSEILLER] };
  }
}

// ---------------------------------------------------------------------------
//  Décision de l'IA : vérifiée avant usage
// ---------------------------------------------------------------------------

/** Une décision venue d'un fournisseur d'IA, ramenée à ce que la banque connaît ; sinon null. */
export function validerDecision(brute: unknown, ctx: Pick<ContexteAssistant, 'faq' | 'categories'>): Decision | null {
  if (!brute || typeof brute !== 'object') return null;
  const d = brute as Record<string, unknown>;
  if (!INTENTIONS.includes(d.intention as Intention)) return null;
  const faqId = typeof d.faqId === 'string' && ctx.faq.some((f) => f.id === d.faqId) ? d.faqId : null;
  const categorieId = typeof d.categorieId === 'string' && ctx.categories.some((c) => c.id === d.categorieId) ? d.categorieId : null;
  return { intention: d.intention as Intention, faqId, categorieId, complet: d.complet === true };
}

// ---------------------------------------------------------------------------
//  Décision par règles (sans fournisseur d'IA) : mots-clés
// ---------------------------------------------------------------------------

/** Thèmes bancaires courants et leurs mots, en français de Côte d'Ivoire. Rattachés aux catégories par leur nom. */
const THEMES: readonly { racines: RegExp; mots: readonly string[] }[] = [
  { racines: /carte|gab|distributeur/, mots: ['carte', 'gab', 'distributeur', 'guichet automatique', 'retrait', 'retirer', 'avale', 'visa', 'mastercard', 'billet', 'pas sorti', 'sorti', 'tpe', 'cash', 'plafond'] },
  { racines: /virement|transfert/, mots: ['virement', 'vire', 'transfert', 'transferer', 'salaire', 'beneficiaire', 'swift', 'pas recu', 'pas arrive', 'pas tombe', 'envoye', 'western', 'moneygram', 'rib'] },
  { racines: /mobile|application|digital|en ligne|internet/, mots: ['appli', 'application', 'mobile', 'connexion', 'connecter', 'identifiant', 'wave', 'orange money', 'momo', 'mtn', 'moov', 'otp', 'mise a jour', 'bug', 'mot de passe', 'code de validation', 'sms de validation'] },
  { racines: /frais|prelev|tarif|commission/, mots: ['frais', 'prelev', 'agios', 'commission', 'tenue de compte', 'facture', 'deux fois', 'double', 'coupe', 'cotisation', 'taxe', 'debite plusieurs'] },
  { racines: /fraude|suspect|securite/, mots: ['fraude', 'pirat', 'arnaq', 'escroc', 'pas moi', "n'ai pas fait", 'pas fait', 'inconnu', 'vole', 'usurp', 'hack', 'suspect', 'brouteur', 'je ne reconnais pas', 'pas autorise',
    "m'a appele", 'demander mon code', 'demande mon code', 'demande mon mot de passe', 'faux conseiller', 'faux agent', 'lien', 'bizarre', 'louche'] },
  { racines: /accueil|agence|service|guichet/, mots: ['accueil', 'attente', 'attendu', 'guichetier', 'caissier', 'caissiere', 'personnel', 'impoli', 'mal recu', 'mal accueilli', 'file', 'rang', 'comportement', 'mal parle', 'insulte', 'agence', 'seul guichet', 'heures'] },
  { racines: /credit|pret|emprunt/, mots: ['credit', 'pret', 'echeance', 'emprunt', 'remboursement anticipe', 'mensualite', 'decouvert', 'taux', 'tableau d\'amortissement'] },
];

const PLAINTE = ['debit', 'bizarre', 'louche', 'pas recu', 'pas arrive', 'pas tombe', 'bloque', 'probleme', 'erreur', 'reclam', 'plainte', 'pas normal', "on m'a", 'avale', 'vole', 'perdu',
  'refuse', 'marche pas', 'fonctionne pas', 'impossible', 'toujours pas', 'pas sorti', 'deux fois', 'inconnu', 'arnaq', 'escroc', 'preleve', 'facture', 'retenu', 'disparu',
  'pas fait', 'aidez', 'aide moi', 'au secours', 'urgent', 'mal recu', 'mal parle', 'attendu', 'plaindre'];

const QUESTION_GENERALE_HORS_SUJET = /\b(meteo|match|football|politique|election|recette|blague|chanson|film|devoir|traduis|ecris moi|poeme|bitcoin|crypto|bourse|investir|placement|quel temps|ignore tes|oublie tes|tes instructions|tes regles|tu es maintenant)\b/;

function scoreTheme(texte: string, mots: readonly string[]): number {
  return mots.reduce((n, m) => (texte.includes(m) ? n + 1 : n), 0);
}

/** La catégorie de la banque la plus proche du texte, par ses thèmes, son nom et sa description. */
export function categorieParRegles(texte: string, categories: readonly CategorieAssistant[]): string | null {
  const t = aplatir(texte);
  const mots = motsSignificatifs(texte);
  let meilleure: { id: string; score: number } | null = null;
  for (const c of categories) {
    const nom = aplatir(`${c.nom} ${c.description ?? ''}`);
    let score = 0;
    for (const theme of THEMES) if (theme.racines.test(aplatir(c.nom))) score += 2 * scoreTheme(t, theme.mots);
    // Une opération que le client n'a pas faite est d'abord une fraude, quel que soit le moyen (carte, application)
    if (/fraude|suspect/.test(aplatir(c.nom)) && URGENCE.test(t)) score += 10;
    for (const m of motsSignificatifs(nom)) if (mots.has(m)) score += 1;
    if (score >= 2 && (!meilleure || score > meilleure.score)) meilleure = { id: c.id, score };
  }
  return meilleure?.id ?? null;
}

/** La question fréquente la plus proche, si elle partage assez de mots avec le message. */
export function faqParRegles(texte: string, faq: readonly QuestionFrequente[]): { id: string; score: number } | null {
  const mots = motsSignificatifs(texte);
  let meilleure: { id: string; score: number } | null = null;
  for (const f of faq) {
    const q = motsSignificatifs(f.question);
    let commun = 0;
    for (const m of q) if (mots.has(m)) commun++;
    // Part des mots communs, rapportée au plus court des deux textes : « vos horaires ? » répond à « quels sont les horaires d'ouverture ? »
    const score = q.size && mots.size ? commun / Math.min(q.size, mots.size, 4) : 0;
    if ((commun >= 2 || (commun === 1 && mots.size <= 2)) && (!meilleure || score > meilleure.score)) meilleure = { id: f.id, score };
  }
  return meilleure && meilleure.score >= 0.5 ? meilleure : null;
}

const DETAIL = /\d|\b(?:hier|avant-hier|aujourd'hui|ce matin|ce soir|cette nuit|matin|soir|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|semaine|mois|gab|distributeur)\b/;

const URGENCE = /\b(fraude|frauduleu\w*|pirat\w*|arnaq\w*|escroc\w*|vol(?:e|ee|es|ees)?|usurp\w*|hack\w*|brouteur\w*|je n'ai (?:jamais|pas) (?:fait|autorise)\w*|pas moi|je ne reconnais pas|inconnu\w*|faux (?:conseiller|agent)|j'ai donne mon code)\b/;

/** La réclamation paraît urgente (fraude, vol, opération inconnue) : signalé à l'agent, à titre indicatif. */
export function urgenceParRegles(texte: string): boolean {
  return URGENCE.test(aplatir(texte));
}

/** Assez de détails pour déposer : 12 mots, ou 6 avec un montant, une date, un moment ou un lieu. */
export function descriptionComplete(description: string): boolean {
  const t = aplatir(description);
  const mots = t.split(/\s+/).filter((m) => m.length >= 2);
  return mots.length >= 12 || (mots.length >= 6 && DETAIL.test(t));
}

/** Décision sans IA : mots-clés, sur le dernier message du client et ce qu'il a déjà décrit. */
export function decisionParRegles(echanges: readonly Echange[], ctx: Pick<ContexteAssistant, 'faq' | 'categories'>): Decision {
  const clients = echanges.filter((e) => e.auteur === 'CLIENT');
  const dernier = clients.at(-1)?.texte ?? '';
  const t = aplatir(dernier).replace(/[!.,]/g, ' ').replace(/\s+/g, ' ').trim();
  const rien: Decision = { intention: 'INCOMPRIS', faqId: null, categorieId: null, complet: false };
  if (!t) return rien;
  if (demandeHumain(dernier)) return { ...rien, intention: 'CONSEILLER' };
  if (/^(merci|ok|d'accord|dac|super|parfait|c'est clair|c'?est bon|top|cool)( (merci|beaucoup|bien|a vous|bcp|c'est clair|c'est bon))*$/.test(t)) return { ...rien, intention: 'FIN' };
  if (/^(bonjour|bonsoir|salut|slt|bjr|bsr|cc|coucou|allo|hello|hi|yo)( (madame|monsieur|la banque|svp|stp|a vous|tout le monde))*$/.test(t)) return { ...rien, intention: 'SALUTATION' };

  const description = descriptionPourDepot(echanges);
  const plainte = PLAINTE.some((p) => t.includes(p)) || aplatir(dernier) === aplatir(SUGGESTION_DEPOT);
  const categorieId = categorieParRegles(description || dernier, ctx.categories);
  const faq = faqParRegles(dernier, ctx.faq);

  if (faq && estQuestion(dernier) && !(plainte && faq.score < 1)) return { ...rien, intention: 'FAQ', faqId: faq.id };
  if (plainte || (categorieId && !estQuestion(dernier))) {
    return { intention: 'RECLAMATION', faqId: null, categorieId, complet: descriptionComplete(description) };
  }
  if (QUESTION_GENERALE_HORS_SUJET.test(t)) return { ...rien, intention: 'HORS_SUJET' };
  if (faq) return { ...rien, intention: 'FAQ', faqId: faq.id };
  if (categorieId) return { intention: 'RECLAMATION', faqId: null, categorieId, complet: descriptionComplete(description) };
  return rien;
}
