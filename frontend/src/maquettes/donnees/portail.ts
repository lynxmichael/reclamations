/** Portail client : le parcours de Yao Kouassi, client de la Banque Alpha (fictifs). */
import type { S } from '../../api/types';
import { DOMAINE, id, t } from './commun';
import { CATEGORIES, agence } from './parametrage';
import { CHAT_42, DESCRIPTION_42, FICHE_42, PHOTO_TICKET } from './reclamations';

/** Ce que renvoie GET /public/points-depot/7K3QX9P2MA : le QR code du hall de l'agence Plateau. */
export function formulaire(banque: S<'BanquePublique'>): S<'FormulaireDepot'> {
  return {
    banque,
    canal: 'QR_CODE',
    agence: agence(1),
    agences: [],
    categories: CATEGORIES.filter((c) => c.active).map(({ id, nom, description }) => ({ id, nom, description })),
    politiqueDonnees: { version: '2026-09', url: '/politique-donnees' },
    fichiers: { maxFichiers: 5, maxOctets: 5_242_880, types: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] },
  };
}

/** Réponse 400 du dépôt quand des champs sont invalides (RFC 9457). */
export const ERREUR_DEPOT: S<'Probleme'> = {
  type: '/erreurs/validation',
  title: 'Formulaire incomplet',
  status: 400,
  code: 'VALIDATION',
  detail: '2 champs à corriger',
  instance: '/api/v1/public/points-depot/7K3QX9P2MA/reclamations',
  erreurs: [
    { champ: 'description', message: 'Décrivez votre réclamation en quelques mots (10 caractères au moins).' },
    { champ: 'telephone', message: 'Ce numéro a 8 chiffres ; un numéro ivoirien en compte 10, par exemple 07 08 09 10 11.' },
  ],
};

const JETON_SUIVI = 'Qm9uam91ckJhbnF1ZUFscGhhNDI';

export function accuse(banque: S<'BanquePublique'>): S<'AccuseDepot'> {
  return {
    numero: `${banque.slug === 'alpha' ? 'ALP' : 'HZN'}-2026-002442`,
    lienSuivi: `https://${banque.slug}.${DOMAINE}/suivi/${JETON_SUIVI}`,
    jetonSuivi: JETON_SUIVI,
  };
}

const etapes42: S<'EtapeSuivi'>[] = FICHE_42.AGENT.chronologie
  .filter((e) => e.visibleClient && e.statutApres)
  .map((e) => ({ type: e.type, statut: e.statutApres!, date: e.date }));

export function suivi(banque: S<'BanquePublique'>): S<'SuiviPublic'> {
  return {
    numero: accuse(banque).numero,
    statut: 'EN_COURS',
    categorie: 'Carte bancaire',
    creeLe: t('24/09 09:12'),
    banque,
    etapes: etapes42,
    avis: null,
  };
}

/** ALP-2026-002180 close par le client le 24/09 : l'enquête de satisfaction l'attend (étape 15). */
export function suiviClos(banque: S<'BanquePublique'>): S<'SuiviPublic'> {
  return {
    numero: `${banque.slug === 'alpha' ? 'ALP' : 'HZN'}-2026-002180`,
    statut: 'CLOTUREE',
    categorie: 'Virement et transfert',
    creeLe: t('02/09 16:15'),
    banque,
    etapes: [
      { type: 'CREATION', statut: 'OUVERTE', date: t('02/09 16:15') },
      { type: 'PRISE_EN_CHARGE', statut: 'EN_COURS', date: t('03/09 08:40') },
      { type: 'RESOLUTION', statut: 'RESOLUE', date: t('23/09 11:20') },
      { type: 'CONFIRMATION', statut: 'CLOTUREE', date: t('24/09 10:05') },
    ],
    avis: { etat: 'A_DONNER', expireLe: t('01/10 10:05') },
  };
}

/** L'enquête de ALP-2026-002180 : à donner, donnée, ou terminée sans réponse (7 jours passés). */
export function avis(banque: S<'BanquePublique'>, etat: S<'EtatAvis'>): S<'Avis'> {
  return {
    numero: `${banque.slug === 'alpha' ? 'ALP' : 'HZN'}-2026-002180`,
    categorie: 'Virement et transfert',
    banque,
    etat,
    expireLe: etat === 'TERMINE' ? t('17/09 11:20') : t('01/10 10:05'),
    reponse: etat === 'DONNE'
      ? { note: 4, recommandation: 9, commentaire: 'Le virement est bien arrivé. Un peu long, mais on m\'a tenu informé à chaque étape.', reponduLe: t('25/09 14:48') }
      : null,
  };
}

export const OTP_ENVOYE: S<'OtpEnvoye'> = {
  canal: 'SMS',
  destinationMasquee: '+225 07 •• •• •• 11',
  expireDans: 600,
};

export const MES_RECLAMATIONS: S<'ReclamationClientResume'>[] = [
  { id: id('reclamation', 2442), numero: 'ALP-2026-002442', statut: 'EN_COURS', categorie: 'Carte bancaire', creeLe: t('24/09 09:12') },
  { id: id('reclamation', 2370), numero: 'ALP-2026-002370', statut: 'RESOLUE', categorie: 'Frais et prélèvements', creeLe: t('18/09 10:47') },
  { id: id('reclamation', 2180), numero: 'ALP-2026-002180', statut: 'CLOTUREE', categorie: 'Virement et transfert', creeLe: t('02/09 16:15') },
];

/** Le client ne voit jamais les notes internes ni le nom de l'agent. */
const visibles = (messages: S<'Message'>[]): S<'MessageVisible'>[] => messages
  .filter((m) => m.type !== 'NOTE_INTERNE')
  .map((m) => ({
    id: m.id,
    type: m.type as 'REPONSE_AU_CLIENT' | 'MESSAGE_DU_CLIENT',
    contenu: m.contenu,
    auteur: m.type === 'MESSAGE_DU_CLIENT' ? 'CLIENT' : 'BANQUE',
    creeLe: m.creeLe,
    piecesJointes: m.piecesJointes,
  }));
const chat42 = new Set(CHAT_42.map((m) => m.id));
/** Banque sans chat : les échanges d'avant le chat */
const messagesVisibles42 = visibles(FICHE_42.AGENT.messages.filter((m) => !chat42.has(m.id)));

/** ALP-2026-002442 en cours : le client peut encore écrire. */
export const MA_RECLAMATION_EN_COURS: S<'ReclamationClient'> = {
  id: id('reclamation', 2442),
  numero: 'ALP-2026-002442',
  statut: 'EN_COURS',
  categorie: 'Carte bancaire',
  description: DESCRIPTION_42,
  creeLe: t('24/09 09:12'),
  clotureAutoPrevueLe: null,
  messages: messagesVisibles42,
  piecesJointes: [],
  etapes: etapes42,
  actionsPossibles: [],
  operationsPossibles: ['CONSULTER', 'MESSAGE_DU_CLIENT'],
  avis: null,
  chat: null,
};

/**
 * La même réclamation dans une banque qui a le chat web (étape 17), au 25/09 15:10 : le client a
 * relancé, Aya a répondu, son dernier message n'est pas encore lu. Variante « fermé » : le soir.
 */
export function maReclamationChat(ouvert: boolean): S<'ReclamationClient'> {
  return {
    ...MA_RECLAMATION_EN_COURS,
    messages: visibles(FICHE_42.AGENT.messages),
    chat: ouvert
      ? { ouvert: true, repriseLe: null, luParLaBanqueLe: t('25/09 15:04') }
      : { ouvert: false, repriseLe: t('28/09 08:00'), luParLaBanqueLe: t('25/09 15:04') },
  };
}

/** ALP-2026-002370 résolue : le client confirme ou conteste avant la clôture automatique. */
export const MA_RECLAMATION_RESOLUE: S<'ReclamationClient'> = {
  id: id('reclamation', 2370),
  numero: 'ALP-2026-002370',
  statut: 'RESOLUE',
  categorie: 'Frais et prélèvements',
  description: 'Les frais de tenue de compte du mois d\'août ont été prélevés deux fois, le 31/08 et le 01/09 (2 500 FCFA chaque fois).',
  creeLe: t('18/09 10:47'),
  clotureAutoPrevueLe: t('29/09 15:30'),
  messages: [
    {
      id: id('message', 20), type: 'REPONSE_AU_CLIENT', auteur: 'BANQUE', creeLe: t('24/09 15:30'),
      contenu: 'Bonjour M. Kouassi, le second prélèvement était une erreur de traitement. Les 2 500 FCFA ont été reversés sur votre compte ce jour ; vous trouverez l\'avis de régularisation ci-joint.',
      piecesJointes: [{ id: id('piece', 20), nomFichier: 'avis-regularisation.pdf', typeMime: 'application/pdf', tailleOctets: 184_320, creeLe: t('24/09 15:30') }],
    },
  ],
  piecesJointes: [{ ...PHOTO_TICKET, id: id('piece', 19), nomFichier: 'releve-septembre.pdf', typeMime: 'application/pdf', tailleOctets: 402_113, creeLe: t('18/09 10:47') }],
  etapes: [
    { type: 'CREATION', statut: 'OUVERTE', date: t('18/09 10:47') },
    { type: 'PRISE_EN_CHARGE', statut: 'EN_COURS', date: t('18/09 14:32') },
    { type: 'RESOLUTION', statut: 'RESOLUE', date: t('24/09 15:30') },
  ],
  actionsPossibles: ['CONFIRMER', 'CONTESTER'],
  operationsPossibles: ['CONSULTER'],
  avis: null,
  chat: null,
};
