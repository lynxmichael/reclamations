/**
 * Assistant IA (étape 18) : base de réponses de la Banque Alpha (celle du jeu de démonstration),
 * conversations du portail, brouillon proposé à l'agent et consommation par banque (fictifs).
 * Les textes de l'assistant viennent des règles pures du backend (@domaine/ia), comme dans l'API.
 */
import { decisionParRegles, presentation, repondre, type ContexteAssistant, type Echange } from '@domaine/ia/assistant';
import { FAQ_EXEMPLE } from '@domaine/ia/exemples';
import { LIBELLE_INTERDIT, verifierInterdits } from '@domaine/ia/interdits';
import { masquer, mentionneCodeSecret } from '@domaine/ia/masquage';
import type { S } from '../../api/types';
import type { EchangeVu } from '../../ecrans/portail/Assistant';
import { id, t } from './commun';
import { CATEGORIES } from './parametrage';

export const alertesDe = (texte: string): S<'AlerteInterdit'>[] =>
  verifierInterdits(texte).map((a) => ({ code: a.code, libelle: LIBELLE_INTERDIT[a.code], extrait: a.extrait }));

/** Base de réponses : celle du jeu de démonstration, plus une réponse retirée qui promettait un délai. */
export const REPONSES_BANQUE: S<'ReponseBanque'>[] = [
  ...FAQ_EXEMPLE.map((f, i) => ({
    id: id('reponse', i + 1), question: f.question, reponse: f.reponse, active: true, ordre: (i + 1) * 10, alertes: alertesDe(f.reponse), modifieLe: t('22/09 10:30'),
  })),
  {
    id: id('reponse', 10), question: 'Quand serai-je remboursé ?', reponse: 'Vous serez remboursé sous 48 heures après la validation de votre réclamation.',
    active: false, ordre: 100, alertes: alertesDe('Vous serez remboursé sous 48 heures après la validation de votre réclamation.'), modifieLe: t('24/09 16:12'),
  },
];

const categoriesAssistant = CATEGORIES.filter((c) => c.active).map(({ id: cid, nom, description }) => ({ id: cid, nom, description }));

export function contexteAssistant(banque: string, ouverte = true, reprise: string | null = null): ContexteAssistant {
  return {
    banque,
    faq: REPONSES_BANQUE.filter((r) => r.active).map((r) => ({ id: r.id, question: r.question, reponse: r.reponse })),
    categories: categoriesAssistant,
    ouverte,
    reprise,
  };
}

/** Un tour de l'assistant, par les règles (démo, maquettes) : ce que renverrait converserAvecAssistant. */
export function tourAssistant(ctx: ContexteAssistant, fil: readonly EchangeVu[]): S<'ReponseAssistant'> {
  const echanges: Echange[] = fil.slice(-12).map((e) => (e.auteur === 'CLIENT' ? { auteur: 'CLIENT', texte: e.texte } : { auteur: 'ASSISTANT', texte: '', code: e.code }));
  if (echanges.at(-1)?.auteur !== 'CLIENT') {
    return { messages: [presentation(ctx.banque)], proposition: null, suggestions: ['Déposer une réclamation', 'Parler à un conseiller'] };
  }
  const dernier = echanges.at(-1)!.texte;
  const r = repondre(decisionParRegles(echanges, ctx), echanges, ctx, masquer(dernier).codeSecret || mentionneCodeSecret(dernier));
  return { messages: r.messages.map((m) => ({ code: m.code, texte: m.texte })), proposition: r.proposition ? { ...r.proposition } : null, suggestions: [...r.suggestions] };
}

/** Rejoue une conversation : les messages du client, et après chacun la réponse de l'assistant. */
export function conversationAssistant(banque: string, messages: readonly string[], ouverte = true, reprise: string | null = null) {
  const ctx = contexteAssistant(banque, ouverte, reprise);
  let fil: EchangeVu[] = [];
  let dernier = tourAssistant(ctx, fil);
  fil = dernier.messages.map((m) => ({ auteur: 'ASSISTANT', texte: m.texte, code: m.code }));
  for (const texte of messages) {
    fil = [...fil, { auteur: 'CLIENT', texte }];
    dernier = tourAssistant(ctx, fil);
    fil = [...fil, ...dernier.messages.map((m) => ({ auteur: 'ASSISTANT' as const, texte: m.texte, code: m.code }))];
  }
  return { fil, dernier };
}

/** Brouillon proposé à l'agent sur la réclamation de la maquette (carte avalée, non servie) : une promesse à corriger. */
export const SUGGESTION_42: S<'SuggestionReponse'> = {
  brouillon: 'Bonjour M. Kouassi,\n\nMerci pour ces précisions et pour le ticket du distributeur. Nous avons transmis votre dossier au service monétique, '
    + 'qui vérifie le journal du distributeur du Plateau. Vous serez remboursé sous 48 heures.\n\nCordialement,\nLe service réclamations de Banque Alpha',
  alertes: alertesDe('Vous serez remboursé sous 48 heures.'),
  categorie: null,
  urgente: false,
  source: 'IA',
};

/** Consommation de septembre (Super Admin) : seule la Banque Alpha a l'assistant. */
export const CONSOMMATION_IA: S<'ConsommationIa'> = {
  mois: '2026-09',
  fournisseur: { nom: 'mistral', modele: 'mistral-small-latest' },
  banques: [
    { banque: { id: id('banque', 1), nom: 'Banque Alpha' }, assistantIa: true, tours: 2864, suggestions: 341, barometres: 1, parIa: 3130, regles: 76, jetonsEntree: 3_402_118, jetonsSortie: 141_903, coutUsd: 0.5955 },
    { banque: { id: id('banque', 2), nom: 'Banque Horizon' }, assistantIa: false, tours: 0, suggestions: 0, barometres: 0, parIa: 0, regles: 0, jetonsEntree: 0, jetonsSortie: 0, coutUsd: 0 },
    { banque: { id: id('banque', 3), nom: 'Caisse Lagune' }, assistantIa: false, tours: 0, suggestions: 0, barometres: 0, parIa: 0, regles: 0, jetonsEntree: 0, jetonsSortie: 0, coutUsd: 0 },
    { banque: { id: id('banque', 4), nom: 'Banque Savane' }, assistantIa: false, tours: 0, suggestions: 0, barometres: 0, parIa: 0, regles: 0, jetonsEntree: 0, jetonsSortie: 0, coutUsd: 0 },
  ],
};
