/**
 * WhatsApp et SMS entrant (étape 20, décisions I1, I2 et I7 de l'étape 14) : règles pures, partagées par
 * l'API et la démo cliquable.
 *
 * Le client écrit au numéro de sa banque. Il est reconnu à son numéro de téléphone :
 * - une réclamation en cours : son message y entre, dans la conversation commune à tous les canaux
 *   (étape 17), et l'agent lui répond depuis la boîte de réception ;
 * - plusieurs : il choisit par son numéro, et ce choix vaut pour ses messages suivants ;
 * - une réclamation résolue : OUI la clôture, tout autre message la conteste et la rouvre ;
 * - aucune : on prépare avec lui une réclamation (description, catégorie), qu'il envoie en répondant
 *   OUI, après avoir lu le lien de la politique de données de la banque. Avec l'assistant IA ouvert
 *   (étape 18), il répond d'abord aux questions fréquentes, avec les réponses écrites par la banque.
 *
 * Comme sur le portail, l'IA ne fait que trier : ce que lit le client vient des textes ci-dessous et
 * de la base de réponses de la banque.
 */
import {
  categorieParRegles, descriptionPourDepot, retirerCodesSecrets, TEXTES,
  type CategorieAssistant, type Decision, type Echange, type QuestionFrequente,
} from './ia/assistant.js';
import { aplatir } from './ia/texte.js';

export type CanalMessagerie = 'WHATSAPP' | 'SMS';
export type EtapeSession = 'LIBRE' | 'CHOIX' | 'DESCRIPTION' | 'CATEGORIE' | 'CONFIRMATION' | 'NOM';

/** WhatsApp : la banque peut écrire librement 24 h après le dernier message du client. */
export const FENETRE_WHATSAPP_MS = 24 * 3_600_000;
/** Marge : au-delà de 23 h 55, la réponse ne part plus sur WhatsApp, que Meta pourrait refuser. */
export const MARGE_FENETRE_MS = 5 * 60_000;
/** Une session (choix, dépôt en préparation) est effacée 24 h après le dernier message du client. */
export const DUREE_SESSION_MS = 24 * 3_600_000;
/** Réponses automatiques par client et par jour : chacune peut coûter un message facturé. */
export const REPONSES_AUTO_PAR_JOUR = 20;
/** Pièces jointes gardées pour un dépôt en préparation, comme au dépôt sur le portail. */
export const MEDIAS_MAX = 5;
/** En deçà, une description ne suffit pas pour traiter la réclamation. */
export const DESCRIPTION_MIN = 20;
/** Un SMS de conversation au-delà de 4 segments est coupé, la suite renvoyée au suivi. */
export const SEGMENTS_SMS_MAX = 4;
/** Au-delà, la description proposée au client est montrée tronquée (elle est envoyée en entier). */
const APERCU = 280;

export interface MediaRecu {
  /** Identifiant du média chez Meta */
  readonly id: string;
  readonly typeMime: string;
  readonly nom: string | null;
}

export interface ReclamationDuClient {
  readonly id: string;
  readonly numero: string;
  readonly categorie: string;
  readonly statut: 'OUVERTE' | 'EN_COURS' | 'EN_ATTENTE_CLIENT' | 'RESOLUE';
}

export interface DonneesSession {
  /** Réclamations proposées au choix, dans l'ordre des numéros */
  readonly choix?: readonly string[];
  /** Message à rattacher une fois la réclamation choisie */
  readonly enAttente?: { readonly texte: string; readonly medias: readonly MediaRecu[] };
  /** Dépôt en préparation */
  readonly description?: string;
  readonly categorieId?: string | null;
  readonly medias?: readonly MediaRecu[];
  /** Échanges avec l'assistant, pour son tri (12 au plus) */
  readonly echanges?: readonly Echange[];
  /** Réclamation pour laquelle le message d'accueil est parti */
  readonly accueilli?: string;
}

export interface Session {
  readonly etape: EtapeSession;
  readonly reclamationId: string | null;
  readonly donnees: DonneesSession;
}

export const SESSION_VIDE: Session = { etape: 'LIBRE', reclamationId: null, donnees: {} };

export interface EntreeCanal {
  readonly canal: CanalMessagerie;
  /** Texte du client (légende d'une photo comprise) ; vide pour une photo seule */
  readonly texte: string;
  readonly medias: readonly MediaRecu[];
  readonly session: Session;
  /** Réclamations du client où il peut encore écrire ou réagir, les plus récentes d'abord */
  readonly reclamations: readonly ReclamationDuClient[];
  readonly categories: readonly CategorieAssistant[];
  readonly faq: readonly QuestionFrequente[];
  /** Assistant IA ouvert à la banque (étape 18) */
  readonly assistant: boolean;
  /** Nom connu : client déjà enregistré, ou nom du profil WhatsApp */
  readonly nomConnu: boolean;
  readonly banque: string;
  readonly lienPolitique: string;
  /** Banque fermée : quand elle rouvre, en toutes lettres (« demain à 8 h ») */
  readonly reprise: string | null;
}

export type Action =
  | { readonly type: 'RATTACHER'; readonly reclamationId: string; readonly texte: string; readonly medias: readonly MediaRecu[] }
  | { readonly type: 'CONFIRMER'; readonly reclamationId: string }
  | { readonly type: 'CONTESTER'; readonly reclamationId: string; readonly motif: string }
  | { readonly type: 'DEPOSER'; readonly categorieId: string; readonly description: string; readonly medias: readonly MediaRecu[]; readonly nom: string | null }
  | { readonly type: 'AUCUNE' };

export type IssueMessage = 'RATTACHE' | 'DEPOT' | 'ASSISTANT' | 'CHOIX' | 'CONFIRMATION';

export interface Issue {
  readonly decisionRequise?: false;
  readonly action: Action;
  /** Réponses automatiques, dans l'ordre ; l'accusé d'un dépôt est ajouté après la création */
  readonly reponses: readonly string[];
  readonly session: Session;
  readonly issue: IssueMessage;
}

/** Le tri de l'assistant est nécessaire : l'appelant le demande (IA ou règles), puis rappelle `traiter`. */
export interface DecisionRequise {
  readonly decisionRequise: true;
  readonly echanges: readonly Echange[];
}

// ---------------------------------------------------------------------------
//  Textes : courts (un SMS coûte un segment tous les 153 caractères), sans caractère hors GSM
// ---------------------------------------------------------------------------

const NOUVELLE = 'NOUVELLE';

export const TEXTES_CANAL = {
  ACCUEIL: (banque: string) => `Bonjour, ici le service reclamations de ${banque}. Decrivez votre probleme en un message : `
    + 'je l\'enregistre et un conseiller vous repond ici. N\'ecrivez jamais votre code secret.',
  PRESENTATION: (banque: string) => `Bonjour, je suis l'assistant automatique de ${banque}. Je reponds aux questions frequentes et je vous aide `
    + 'a deposer une reclamation. Ecrivez "conseiller" pour qu\'une personne de la banque prenne le relais.',
  DESCRIPTION: 'D\'accord. Decrivez votre probleme en un message : que s\'est-il passe, quand, ou, et pour quel montant ? '
    + 'N\'ecrivez jamais votre code secret.',
  PRECISER: 'Pouvez-vous preciser ce qui s\'est passe : quand, ou, et pour quel montant ?',
  NOUVELLE: 'D\'accord, une nouvelle reclamation. Decrivez votre probleme en un message.',
  FAQ_SUITE: 'Pour deposer une reclamation, decrivez votre probleme en un message, ou ecrivez "conseiller".',
  ANNULE: 'D\'accord, rien n\'est envoye. Ecrivez-nous quand vous voulez.',
  NOM: 'Pour finir, quel est votre nom et prenom ?',
  NOM_INVALIDE: 'Indiquez votre nom et prenom, en toutes lettres.',
  NON_PRIS_EN_CHARGE: 'Je ne peux lire que du texte, des photos et des documents PDF. Ecrivez votre message, s\'il vous plait.',
  FICHIER_REFUSE: 'Ce fichier n\'a pas pu etre joint : photos (JPEG, PNG, WebP) et PDF de 5 Mo au plus.',
  ERREUR: 'Votre message n\'a pas pu etre pris en compte. Ecrivez-nous a nouveau, s\'il vous plait.',
} as const;

const quand = (reprise: string | null) => (reprise ? ` La banque est fermee : un conseiller vous repondra des la reouverture, ${reprise}.` : '');

export function texteChoix(reclamations: readonly ReclamationDuClient[]): string {
  return [
    'Votre message concerne quelle reclamation ? Repondez par son numero :',
    ...reclamations.map((r, i) => `${i + 1}. ${r.numero} - ${r.categorie}`),
    '0. Une nouvelle reclamation',
  ].join('\n');
}

export function texteCategories(categories: readonly CategorieAssistant[]): string {
  return ['Quel est le sujet ? Repondez par son numero :', ...categories.map((c, i) => `${i + 1}. ${c.nom}`)].join('\n');
}

export function texteProposition(categorie: CategorieAssistant, description: string, banque: string, lienPolitique: string): string {
  const apercu = description.length > APERCU ? `${description.slice(0, APERCU - 3).trimEnd()}...` : description;
  return `Je vais transmettre votre reclamation a ${banque} :\n- Sujet : ${categorie.nom}\n- "${apercu}"\n`
    + `Repondez OUI pour l'envoyer, NON pour annuler, ou ecrivez pour la completer. En l'envoyant, vous acceptez la politique de donnees de la banque : ${lienPolitique}`;
}

export function texteAccueilReclamation(r: ReclamationDuClient, reprise: string | null): string {
  return `Message ajoute a votre reclamation ${r.numero} (${r.categorie}). Un conseiller vous repond ici.${quand(reprise)} `
    + `Pour une autre reclamation, ecrivez ${NOUVELLE}.`;
}

export function texteAccuse(numero: string, lienSuivi: string, reprise: string | null): string {
  return `Votre reclamation ${numero} est enregistree. Un conseiller vous repond ici.${quand(reprise)} Suivi : ${lienSuivi}`;
}

export const texteCloture = (numero: string) => `Merci ! Votre reclamation ${numero} est cloturee.`;
export const texteContestation = (numero: string) => `Votre reclamation ${numero} est rouverte : un conseiller reprend votre dossier et vous repond ici.`;

/** Fin d'un message de résolution envoyé sur WhatsApp ou par SMS : le client répond là où il est. */
export const SUITE_RESOLUTION = 'Repondez OUI si c\'est regle, ou dites-nous ce qui ne va pas pour rouvrir votre reclamation.';

// ---------------------------------------------------------------------------
//  Lecture des réponses du client
// ---------------------------------------------------------------------------

const plat = (texte: string) => aplatir(texte).replace(/[!.?,;:]+$/g, '').trim();

/** Formule de politesse en fin de réponse : « oui merci », « ok merci beaucoup » */
const POLITESSE = /[\s,]+(merci( beaucoup| bien| infiniment)?|svp|s'il vous plait)$/;

export function estOui(texte: string): boolean {
  return /^(oui|o|ok|okay|yes|ouais|d'accord|dac|daccord|envoyer|envoie|envoyez|c'est bon|cest bon|c'est regle|cest regle|valider|je confirme|confirme)$/
    .test(plat(texte).replace(POLITESSE, ''));
}

/** Réponse à une résolution : OUI, ou un remerciement seul, la confirment ; tout autre message la conteste. */
export function estSatisfait(texte: string): boolean {
  return estOui(texte) || /^(merci( beaucoup| bien| infiniment)?|parfait|super|top|c'est parfait|resolu|regle|c'est resolu|probleme regle)$/.test(plat(texte));
}

export function estNon(texte: string): boolean {
  return /^(non|n|no|annuler|annule|stop|laisse tomber|pas maintenant)$/.test(plat(texte));
}

export function estNouvelle(texte: string): boolean {
  return /^(nouvelle|nouveau|nouvelle reclamation|nouvelle demande|autre reclamation|une nouvelle reclamation)$/.test(plat(texte));
}

/** Un numéro de choix (« 2 », « n°2 », « le 2 »), sinon null. */
export function numeroChoisi(texte: string): number | null {
  const m = /^(?:n[o°]?\s*|le\s+|la\s+|numero\s+)?(\d{1,2})$/.exec(plat(texte));
  return m ? Number(m[1]) : null;
}

/** Nom et prénom plausibles : 2 à 160 caractères, des lettres, pas un chiffre. */
export function nomValide(texte: string): string | null {
  const nom = texte.replace(/\s+/g, ' ').trim();
  if (nom.length < 2 || nom.length > 160 || /\d/.test(nom) || !/\p{L}/u.test(nom)) return null;
  return nom;
}

/** La fenêtre de 24 h de WhatsApp est-elle encore ouverte (avec la marge) ? */
export function fenetreOuverte(dernierMessageClientLe: Date | null, maintenant: Date): boolean {
  return dernierMessageClientLe !== null && maintenant.getTime() < dernierMessageClientLe.getTime() + FENETRE_WHATSAPP_MS - MARGE_FENETRE_MS;
}

export function finFenetre(dernierMessageClientLe: Date): Date {
  return new Date(dernierMessageClientLe.getTime() + FENETRE_WHATSAPP_MS);
}

/**
 * Par où part la prochaine réponse de la banque : là où le client a écrit en dernier — WhatsApp tant
 * que la fenêtre de 24 h est ouverte, SMS, sinon le portail (WEB). Un canal fermé depuis par Makor
 * revient au portail.
 */
export function canalDuFil(
  c: { readonly canal: 'WEB' | CanalMessagerie; readonly dernierMessageClientLe: Date | null } | null,
  ouverts: { readonly whatsapp: boolean; readonly smsEntrant: boolean },
  maintenant: Date,
): { canal: 'WEB' | CanalMessagerie; finFenetreLe: Date | null } {
  if (c?.canal === 'WHATSAPP' && ouverts.whatsapp && fenetreOuverte(c.dernierMessageClientLe, maintenant)) {
    return { canal: 'WHATSAPP', finFenetreLe: finFenetre(c.dernierMessageClientLe!) };
  }
  if (c?.canal === 'SMS' && ouverts.smsEntrant) return { canal: 'SMS', finFenetreLe: null };
  return { canal: 'WEB', finFenetreLe: null };
}

// ---------------------------------------------------------------------------
//  Décision
// ---------------------------------------------------------------------------

const issue = (action: Action, reponses: readonly string[], session: Session, i: IssueMessage): Issue => ({ action, reponses, session, issue: i });
const AUCUNE: Action = { type: 'AUCUNE' };

function ajouterMedias(avant: readonly MediaRecu[] | undefined, nouveaux: readonly MediaRecu[]): MediaRecu[] {
  return [...(avant ?? []), ...nouveaux].slice(0, MEDIAS_MAX);
}

function ajouterEchange(echanges: readonly Echange[] | undefined, e: Echange): Echange[] {
  return [...(echanges ?? []), e].slice(-12);
}

/** Proposition de dépôt, ou liste des catégories si aucune ne s'impose. */
function proposer(e: EntreeCanal, donnees: DonneesSession, categorieId: string | null, prefixe: readonly string[] = []): Issue {
  const description = donnees.description ?? '';
  const categorie = e.categories.find((c) => c.id === categorieId) ?? (e.categories.length === 1 ? e.categories[0] : undefined);
  if (!categorie) {
    return issue(AUCUNE, [...prefixe, texteCategories(e.categories)], { etape: 'CATEGORIE', reclamationId: null, donnees: { ...donnees, categorieId: null } }, 'DEPOT');
  }
  return issue(
    AUCUNE,
    [...prefixe, texteProposition(categorie, description, e.banque, e.lienPolitique)],
    { etape: 'CONFIRMATION', reclamationId: null, donnees: { ...donnees, categorieId: categorie.id } },
    'DEPOT',
  );
}

/** Une description reçue : trop courte, on demande des précisions ; sinon, la catégorie (assistant ou règles). */
function decrire(e: EntreeCanal, donnees: DonneesSession, decision?: Decision): Issue | DecisionRequise {
  const description = donnees.description ?? '';
  if (description.length < DESCRIPTION_MIN) {
    return issue(AUCUNE, [TEXTES_CANAL.PRECISER], { etape: 'DESCRIPTION', reclamationId: null, donnees }, 'DEPOT');
  }
  if (e.categories.length === 1) return proposer(e, donnees, e.categories[0]!.id);
  if (e.assistant && !decision) return { decisionRequise: true, echanges: [{ auteur: 'CLIENT', texte: description }] };
  const categorieId = decision?.categorieId ?? categorieParRegles(description, e.categories);
  return proposer(e, donnees, categorieId);
}

/** Ce qu'un message apporte à une description : rien pour une formule (« bonjour », « merci »). */
const utile = (texte: string) => descriptionPourDepot([{ auteur: 'CLIENT', texte }]);

const completer = (description: string | undefined, texte: string) => [description, utile(texte)].filter(Boolean).join('\n').slice(0, 5000);

/** Début d'un dépôt : le message en cours sert de description s'il en est une. */
function debutDepot(e: EntreeCanal, texte: string, medias: readonly MediaRecu[], intro: readonly string[], decision?: Decision): Issue | DecisionRequise {
  const description = utile(texte);
  const donnees: DonneesSession = { description, medias: ajouterMedias(undefined, medias) };
  if (description.length >= DESCRIPTION_MIN) {
    const r = decrire(e, donnees, decision);
    if ('decisionRequise' in r && r.decisionRequise) return r;
    return { ...(r as Issue), reponses: [...intro, ...(r as Issue).reponses] };
  }
  return issue(AUCUNE, intro.length ? intro : [TEXTES_CANAL.DESCRIPTION], { etape: 'DESCRIPTION', reclamationId: null, donnees }, 'DEPOT');
}

/** Message d'un client sans réclamation en cours, avec l'assistant : son tri décide de la suite. */
function avecAssistant(e: EntreeCanal, texte: string, decision: Decision | undefined): Issue | DecisionRequise {
  const echanges = ajouterEchange(e.session.donnees.echanges, { auteur: 'CLIENT', texte });
  if (!decision) return { decisionRequise: true, echanges };
  const premier = !e.session.donnees.echanges?.length;
  const medias = ajouterMedias(e.session.donnees.medias, e.medias);
  const suivre = (reponses: string[], code: Echange['code']) => issue(AUCUNE, reponses, {
    etape: 'LIBRE', reclamationId: null, donnees: { echanges: ajouterEchange(echanges, { auteur: 'ASSISTANT', texte: '', code }), medias },
  }, 'ASSISTANT');
  const incompris = (e.session.donnees.echanges ?? []).slice(-4).filter((x) => x.code === 'INCOMPRIS' || x.code === 'HORS_SUJET').length;
  const faq = e.faq.find((f) => f.id === decision.faqId);
  switch (decision.intention) {
    case 'FAQ':
      if (faq) return suivre([faq.reponse, TEXTES_CANAL.FAQ_SUITE], 'FAQ_SUITE');
      break;
    case 'SALUTATION':
      return suivre([premier ? TEXTES_CANAL.PRESENTATION(e.banque) : TEXTES.SALUTATION], 'SALUTATION');
    case 'FIN':
      return suivre([TEXTES.FIN], 'FIN');
    case 'RECLAMATION':
    case 'CONSEILLER': {
      const description = descriptionPourDepot(echanges);
      const donnees: DonneesSession = { description, medias };
      if (!decision.complet || description.length < DESCRIPTION_MIN) {
        const texteDemande = decision.intention === 'CONSEILLER' && description.length < DESCRIPTION_MIN
          ? 'D\'accord, un conseiller va vous repondre. Decrivez d\'abord votre demande en un message, je la lui transmets.'
          : TEXTES_CANAL.PRECISER;
        return issue(AUCUNE, [texteDemande], { etape: 'DESCRIPTION', reclamationId: null, donnees }, 'DEPOT');
      }
      return proposer(e, donnees, decision.categorieId ?? categorieParRegles(description, e.categories));
    }
    default:
      break;
  }
  // Incompris ou hors sujet : après deux, on passe à un dépôt (un conseiller lira)
  if (incompris >= 1) return issue(AUCUNE, [TEXTES_CANAL.DESCRIPTION], { etape: 'DESCRIPTION', reclamationId: null, donnees: { description: '', medias } }, 'DEPOT');
  return suivre([decision.intention === 'HORS_SUJET' ? TEXTES.HORS_SUJET : TEXTES.INCOMPRIS], decision.intention === 'HORS_SUJET' ? 'HORS_SUJET' : 'INCOMPRIS');
}

/**
 * Ce que devient un message reçu sur WhatsApp ou par SMS. `decision` : le tri de l'assistant, quand un
 * premier appel l'a demandé (DecisionRequise).
 */
export function traiter(e: EntreeCanal, decision?: Decision): Issue | DecisionRequise {
  const texte = retirerCodesSecrets(e.texte.trim());
  const s = e.session;
  const reclamation = (id: string | null | undefined) => (id ? e.reclamations.find((r) => r.id === id) : undefined);

  if (estNouvelle(texte)) {
    return issue(AUCUNE, [TEXTES_CANAL.NOUVELLE], { etape: 'DESCRIPTION', reclamationId: null, donnees: {} }, 'DEPOT');
  }

  switch (s.etape) {
    case 'CHOIX': {
      const n = numeroChoisi(texte);
      const choix = s.donnees.choix ?? [];
      const attente = s.donnees.enAttente ?? { texte: '', medias: [] };
      if (n === 0) return debutDepot(e, attente.texte, attente.medias, [], decision);
      const r = n !== null ? reclamation(choix[n - 1]) : undefined;
      if (r) {
        if (r.statut === 'RESOLUE') {
          return issue(AUCUNE, [`C'est note : vos messages vont a la reclamation ${r.numero}. ${SUITE_RESOLUTION}`],
            { etape: 'LIBRE', reclamationId: r.id, donnees: { accueilli: r.id } }, 'CHOIX');
        }
        const reponses = [`C'est note : vos messages vont a la reclamation ${r.numero}. Un conseiller vous repond ici.${quand(e.reprise)}`];
        const session: Session = { etape: 'LIBRE', reclamationId: r.id, donnees: { accueilli: r.id } };
        if (!attente.texte && !attente.medias.length) return issue(AUCUNE, reponses, session, 'CHOIX');
        return issue({ type: 'RATTACHER', reclamationId: r.id, texte: attente.texte, medias: attente.medias }, reponses, session, 'RATTACHE');
      }
      // Toujours pas de numéro : la question revient, la liste à jour
      const encore = e.reclamations;
      return issue(AUCUNE, [texteChoix(encore)], { etape: 'CHOIX', reclamationId: null, donnees: { ...s.donnees, choix: encore.map((x) => x.id) } }, 'CHOIX');
    }

    case 'CONFIRMATION': {
      const donnees = s.donnees;
      if (estOui(texte)) {
        if (!e.nomConnu) return issue(AUCUNE, [TEXTES_CANAL.NOM], { etape: 'NOM', reclamationId: null, donnees }, 'DEPOT');
        return issue({ type: 'DEPOSER', categorieId: donnees.categorieId!, description: donnees.description ?? '', medias: donnees.medias ?? [], nom: null },
          [], SESSION_VIDE, 'DEPOT');
      }
      if (estNon(texte)) return issue(AUCUNE, [TEXTES_CANAL.ANNULE], SESSION_VIDE, 'DEPOT');
      if (/^(sujet|categorie|changer)$/.test(plat(texte))) {
        return issue(AUCUNE, [texteCategories(e.categories)], { etape: 'CATEGORIE', reclamationId: null, donnees }, 'DEPOT');
      }
      // Un complément : il s'ajoute à la description, et la proposition revient
      const complete: DonneesSession = {
        ...donnees,
        description: completer(donnees.description, texte),
        medias: ajouterMedias(donnees.medias, e.medias),
      };
      return proposer(e, complete, donnees.categorieId ?? null);
    }

    case 'NOM': {
      const nom = nomValide(texte);
      if (!nom) return issue(AUCUNE, [TEXTES_CANAL.NOM_INVALIDE], s, 'DEPOT');
      const d = s.donnees;
      return issue({ type: 'DEPOSER', categorieId: d.categorieId!, description: d.description ?? '', medias: d.medias ?? [], nom }, [], SESSION_VIDE, 'DEPOT');
    }

    case 'CATEGORIE': {
      const n = numeroChoisi(texte);
      const categorie = n !== null && n >= 1 ? e.categories[n - 1] : undefined;
      if (!categorie) return issue(AUCUNE, [texteCategories(e.categories)], s, 'DEPOT');
      return proposer(e, s.donnees, categorie.id);
    }

    case 'DESCRIPTION': {
      const donnees: DonneesSession = {
        ...s.donnees,
        description: completer(s.donnees.description, texte),
        medias: ajouterMedias(s.donnees.medias, e.medias),
      };
      return decrire(e, donnees, decision);
    }

    case 'LIBRE':
    default: {
      const cible = reclamation(s.reclamationId) ?? (e.reclamations.length === 1 ? e.reclamations[0] : undefined);
      if (cible) {
        if (cible.statut === 'RESOLUE') {
          if (!texte && e.medias.length) return issue(AUCUNE, [SUITE_RESOLUTION], { ...s, reclamationId: cible.id }, 'RATTACHE');
          // Pas de réponse automatique : le message de clôture (avec le lien de l'enquête) part dans le fil
          if (estSatisfait(texte)) return issue({ type: 'CONFIRMER', reclamationId: cible.id }, [], SESSION_VIDE, 'CONFIRMATION');
          return issue({ type: 'CONTESTER', reclamationId: cible.id, motif: texte || '(sans texte)' }, [texteContestation(cible.numero)],
            { etape: 'LIBRE', reclamationId: cible.id, donnees: { accueilli: cible.id } }, 'RATTACHE');
        }
        const accueil = s.donnees.accueilli === cible.id ? [] : [texteAccueilReclamation(cible, e.reprise)];
        return issue({ type: 'RATTACHER', reclamationId: cible.id, texte, medias: e.medias }, accueil,
          { etape: 'LIBRE', reclamationId: cible.id, donnees: { accueilli: cible.id } }, 'RATTACHE');
      }
      if (e.reclamations.length > 1) {
        return issue(AUCUNE, [texteChoix(e.reclamations)],
          { etape: 'CHOIX', reclamationId: null, donnees: { choix: e.reclamations.map((r) => r.id), enAttente: { texte, medias: e.medias } } }, 'CHOIX');
      }
      // Aucune réclamation : l'assistant, ou un dépôt
      if (e.assistant) return avecAssistant(e, texte, decision);
      return debutDepot(e, texte, e.medias, utile(texte).length >= DESCRIPTION_MIN ? [] : [TEXTES_CANAL.ACCUEIL(e.banque)], decision);
    }
  }
}
