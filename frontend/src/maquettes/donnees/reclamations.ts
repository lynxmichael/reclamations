/**
 * Réclamations de la Banque Alpha au vendredi 25/09/2026 15:10.
 * Horaires : lun–ven 08:00–12:00 et 14:00–17:30. Les minutes restantes et les échéances sont
 * calculées à la main avec ces horaires (même méthode que l'exemple vérifié de l'étape 4).
 */
import type { S } from '../../api/types';
import { ALPHA, DOMAINE, id, t } from './commun';
import { ADJOUA, AYA, FATOU, IBRAHIM, MAMADOU, SERGE, agence, categorie, ref } from './parametrage';

type Resume = S<'ReclamationResume'>;

function resume(
  n: number,
  r: Omit<Resume, 'id' | 'numero' | 'enRetard' | 'escaladee' | 'echeanceSlaLe' | 'agentSuggere' | 'doublonPossible' | 'envoiNonRemis'> & {
    echeanceSlaLe?: string | null; escaladee?: boolean; agentSuggere?: Resume['agentSuggere']; doublonPossible?: boolean; envoiNonRemis?: boolean;
  },
): Resume {
  return {
    id: id('reclamation', n),
    numero: `ALP-2026-${String(n).padStart(6, '0')}`,
    ...r,
    // Mode suggestion (étape 16) : l'agent proposé au superviseur pour une réclamation non assignée
    agentSuggere: r.agentSuggere ?? null,
    echeanceSlaLe: r.echeanceSlaLe ?? null,
    enRetard: r.sla.etat === 'DEPASSE',
    escaladee: r.escaladee ?? false,
    // Étape 21 : le même client a une autre réclamation de la même catégorie en cours
    doublonPossible: r.doublonPossible ?? false,
    // Étape 22 : un message au client n'a pas été remis, et rien ne l'a remplacé
    envoiNonRemis: r.envoiNonRemis ?? false,
  };
}

export const FILE: Resume[] = [
  // Étape 21 : saisie par Aya au guichet du Plateau, pour une cliente sans smartphone
  resume(2454, {
    statut: 'OUVERTE', priorite: 'NORMALE', canal: 'GUICHET', categorie: categorie(4), agence: agence(1), agent: ref(AYA),
    client: { nom: 'Ahou Kouamé' }, creeLe: t('25/09 15:02'), echeanceSlaLe: t('05/10 08:02'), envoiNonRemis: true,
    sla: { etat: 'DANS_LES_DELAIS', delaiCibleMinutes: 2400, minutesRestantes: 2392 },
  }),
  // Étape 21 : Yao Kouassi, sans nouvelles, redépose sa réclamation de mercredi (ALP-2026-002442)
  resume(2453, {
    statut: 'OUVERTE', priorite: 'NORMALE', canal: 'QR_CODE', categorie: categorie(1), agence: agence(1), agent: null, agentSuggere: ref(MAMADOU),
    client: { nom: 'Yao Kouassi' }, creeLe: t('25/09 14:50'), echeanceSlaLe: t('29/09 15:50'), doublonPossible: true,
    sla: { etat: 'DANS_LES_DELAIS', delaiCibleMinutes: 960, minutesRestantes: 940 },
  }),
  resume(2452, {
    statut: 'OUVERTE', priorite: 'URGENTE', canal: 'QR_CODE', categorie: categorie(5), agence: agence(1), agent: null, agentSuggere: ref(MAMADOU),
    client: { nom: 'Adama Sanogo' }, creeLe: t('25/09 14:32'), echeanceSlaLe: t('28/09 09:02'),
    sla: { etat: 'DANS_LES_DELAIS', delaiCibleMinutes: 240, minutesRestantes: 202 },
  }),
  resume(2451, {
    statut: 'OUVERTE', priorite: 'NORMALE', canal: 'LIEN_WEB', categorie: categorie(3), agence: null, agent: null, agentSuggere: ref(MAMADOU),
    client: { nom: 'Marie-Laure Yapi' }, creeLe: t('25/09 11:05'), echeanceSlaLe: t('28/09 11:35'),
    sla: { etat: 'DANS_LES_DELAIS', delaiCibleMinutes: 480, minutesRestantes: 355 },
  }),
  resume(2450, {
    statut: 'OUVERTE', priorite: 'NORMALE', canal: 'QR_CODE', categorie: categorie(2), agence: agence(2), agent: null, agentSuggere: ref(IBRAHIM),
    client: { nom: 'Seydou Koné' }, creeLe: t('24/09 16:40'), echeanceSlaLe: t('30/09 09:50'),
    sla: { etat: 'DANS_LES_DELAIS', delaiCibleMinutes: 1440, minutesRestantes: 1080 },
  }),
  resume(2449, {
    statut: 'EN_COURS', priorite: 'NORMALE', canal: 'QR_CODE', categorie: categorie(1), agence: agence(3), agent: ref(MAMADOU),
    client: { nom: 'Awa Bamba' }, creeLe: t('23/09 09:00'), echeanceSlaLe: t('25/09 10:00'), escaladee: true,
    sla: { etat: 'DEPASSE', delaiCibleMinutes: 960, minutesRestantes: -190 },
  }),
  resume(2448, {
    statut: 'EN_COURS', priorite: 'URGENTE', canal: 'QR_CODE', categorie: categorie(5), agence: agence(1), agent: ref(AYA),
    client: { nom: 'Jean-Baptiste Kacou' }, creeLe: t('25/09 10:00'), echeanceSlaLe: t('25/09 16:00'),
    sla: { etat: 'ALERTE', delaiCibleMinutes: 240, minutesRestantes: 50 },
  }),
  resume(2447, {
    statut: 'EN_ATTENTE_CLIENT', priorite: 'NORMALE', canal: 'QR_CODE', categorie: categorie(4), agence: agence(1), agent: ref(ADJOUA),
    client: { nom: 'Rokia Diallo' }, creeLe: t('22/09 10:30'),
    sla: { etat: 'EN_PAUSE', delaiCibleMinutes: 2400, minutesRestantes: 1470 },
  }),
  resume(2446, {
    statut: 'EN_COURS', priorite: 'NORMALE', canal: 'QR_CODE', categorie: categorie(6), agence: agence(2), agent: ref(IBRAHIM),
    client: { nom: 'Christelle Amani' }, creeLe: t('21/09 15:00'), echeanceSlaLe: t('28/09 17:30'),
    sla: { etat: 'ALERTE', delaiCibleMinutes: 2400, minutesRestantes: 590 },
  }),
  resume(2445, {
    statut: 'RESOLUE', priorite: 'NORMALE', canal: 'LIEN_WEB', categorie: categorie(2), agence: null, agent: ref(MAMADOU),
    client: { nom: 'Fabrice Ehui' }, creeLe: t('18/09 09:40'),
    sla: { etat: 'ARRETE', delaiCibleMinutes: 1440, minutesRestantes: null },
  }),
  resume(2444, {
    statut: 'EN_COURS', priorite: 'NORMALE', canal: 'QR_CODE', categorie: categorie(7), agence: agence(5), agent: ref(IBRAHIM),
    client: { nom: 'Nadège Kouamé' }, creeLe: t('24/09 14:20'), echeanceSlaLe: '2026-10-06T14:20:00Z',
    sla: { etat: 'DANS_LES_DELAIS', delaiCibleMinutes: 3600, minutesRestantes: 3100 },
  }),
  resume(2443, {
    statut: 'OUVERTE', priorite: 'NORMALE', canal: 'LIEN_WEB', categorie: categorie(3), agence: null, agent: ref(ADJOUA),
    client: { nom: 'Paul-Henri Assi' }, creeLe: t('25/09 09:30'), echeanceSlaLe: t('28/09 10:00'),
    sla: { etat: 'DANS_LES_DELAIS', delaiCibleMinutes: 480, minutesRestantes: 260 },
  }),
  resume(2442, {
    statut: 'EN_COURS', priorite: 'NORMALE', canal: 'QR_CODE', categorie: categorie(1), agence: agence(1), agent: ref(AYA),
    client: { nom: 'Yao Kouassi' }, creeLe: t('24/09 09:12'), echeanceSlaLe: t('28/09 17:22'), doublonPossible: true,
    sla: { etat: 'DANS_LES_DELAIS', delaiCibleMinutes: 960, minutesRestantes: 582 },
  }),
  resume(2441, {
    statut: 'EN_ATTENTE_CLIENT', priorite: 'NORMALE', canal: 'QR_CODE', categorie: categorie(1), agence: agence(4), agent: ref(AYA),
    client: { nom: 'Sylvie Dro' }, creeLe: t('23/09 14:30'),
    sla: { etat: 'EN_PAUSE', delaiCibleMinutes: 960, minutesRestantes: 480 },
  }),
  resume(2439, {
    statut: 'CLOTUREE', priorite: 'NORMALE', canal: 'QR_CODE', categorie: categorie(4), agence: agence(1), agent: ref(ADJOUA),
    client: { nom: 'Hervé Tanoh' }, creeLe: t('15/09 11:20'),
    sla: { etat: 'ARRETE', delaiCibleMinutes: 2400, minutesRestantes: null },
  }),
  resume(2438, {
    statut: 'EN_COURS', priorite: 'NORMALE', canal: 'LIEN_WEB', categorie: categorie(2), agence: null, agent: ref(AYA),
    client: { nom: 'Salimata Touré' }, creeLe: t('21/09 10:00'), echeanceSlaLe: t('24/09 11:30'), escaladee: true,
    sla: { etat: 'DEPASSE', delaiCibleMinutes: 1440, minutesRestantes: -550 },
  }),
];

/** Étape 21 : Adjoua N'Guessan est absente du 24 au 28/09 ; ses réclamations sont « à réassigner ». */
export const INDISPONIBLES = [ADJOUA.id];

/** Compteurs des onglets, dérivés de la file (réclamations non clôturées). */
export function compteurs(file: Resume[], moiId: string | null): S<'PageReclamations'>['compteurs'] {
  const actives = file.filter((r) => r.statut !== 'CLOTUREE');
  return {
    aReassigner: moiId === null ? actives.filter((r) => r.agent && INDISPONIBLES.includes(r.agent.id)).length : 0,
    recues: moiId === null ? actives.filter((r) => r.agent === null).length : 0,
    assignees: actives.filter((r) => r.agent?.id === moiId).length,
    urgentes: actives.filter((r) => r.priorite === 'URGENTE').length,
    enRetard: actives.filter((r) => r.enRetard).length,
    escaladees: actives.filter((r) => r.escaladee).length,
  };
}

/** Vue du superviseur (Serge Kouadio) : toute la banque. */
export const PAGE_SUPERVISEUR: S<'PageReclamations'> = {
  donnees: FILE,
  pagination: { page: 1, parPage: 25, total: FILE.length },
  compteurs: { ...compteurs(FILE, null), assignees: 0 },
};

/** Vue de l'agent (Aya Konan) : seulement ses réclamations. */
const fileAya = FILE.filter((r) => r.agent?.id === AYA.id);
export const PAGE_AGENT: S<'PageReclamations'> = {
  donnees: fileAya,
  pagination: { page: 1, parPage: 25, total: fileAya.length },
  compteurs: compteurs(fileAya, AYA.id),
};

/* ------------------------------------------------------------ Fiche ALP-2026-002442 */

const client = { type: 'CLIENT' as const, nom: null };
const aya = { type: 'UTILISATEUR' as const, nom: 'Aya Konan' };
const serge = { type: 'UTILISATEUR' as const, nom: 'Serge Kouadio' };

export const PHOTO_TICKET: S<'PieceJointe'> = {
  id: id('piece', 1), nomFichier: 'ticket-distributeur.jpg', typeMime: 'image/jpeg', tailleOctets: 1_258_291, creeLe: t('24/09 18:02'), antivirus: 'SAIN',
};

/* ------------------------------------------------------------ Messages au client (étape 22) */

type Envoi = S<'EnvoiClient'>;
const envoi = (n: number, e: Omit<Envoi, 'id' | 'motif' | 'tentatives' | 'prochaineTentativeLe' | 'envoyeLe' | 'remiseLe' | 'renvoyable'> & Partial<Envoi>): Envoi => ({
  id: id('notification', 900 + n), motif: null, tentatives: 1, prochaineTentativeLe: null, envoyeLe: e.creeLe, remiseLe: null, renvoyable: false, ...e,
});
const SMS_YAO = '+225 07 •• •• •• 11';
const EMAIL_YAO = 'y••••@exemple.ci';

/** Yao Kouassi (2442) : accusé, prise en charge, question, par SMS (remis) et par e-mail (accepté). */
const ENVOIS_42: Envoi[] = [
  envoi(6, { canal: 'EMAIL', objet: 'Question de la banque', destinationMasquee: EMAIL_YAO, etat: 'ENVOYE', creeLe: t('24/09 10:20') }),
  envoi(5, { canal: 'SMS', objet: 'Question de la banque', destinationMasquee: SMS_YAO, etat: 'REMIS', creeLe: t('24/09 10:20'), remiseLe: t('24/09 10:21') }),
  envoi(4, { canal: 'EMAIL', objet: 'Changement de statut', destinationMasquee: EMAIL_YAO, etat: 'ENVOYE', creeLe: t('24/09 10:05') }),
  envoi(2, { canal: 'EMAIL', objet: 'Accusé de dépôt', destinationMasquee: EMAIL_YAO, etat: 'ENVOYE', creeLe: t('24/09 09:12') }),
  envoi(1, { canal: 'SMS', objet: 'Accusé de dépôt', destinationMasquee: SMS_YAO, etat: 'REMIS', creeLe: t('24/09 09:12'), remiseLe: t('24/09 09:12') }),
];

export const DESCRIPTION_42 =
  "Mercredi soir vers 19 h, j'ai voulu retirer 50 000 FCFA au distributeur de l'agence du Plateau. " +
  "Le distributeur n'a pas donné les billets, mais mon compte a été débité. J'ai gardé le ticket.";

/** Chat web (étape 17) : ce que le client et Aya se sont écrit cet après-midi, dans le chat du portail. */
export const CHAT_42: S<'Message'>[] = [
  {
    id: id('message', 5), type: 'MESSAGE_DU_CLIENT', canal: 'WEB', auteur: client, creeLe: t('25/09 14:58'), piecesJointes: [],
    contenu: 'Bonjour, avez-vous pu vérifier le distributeur ? Je dois payer mes fournisseurs lundi.',
  },
  {
    id: id('message', 6), type: 'REPONSE_AU_CLIENT', canal: 'WEB', auteur: aya, creeLe: t('25/09 15:04'), piecesJointes: [],
    contenu: 'Bonjour M. Kouassi, oui : la monétique confirme l\'anomalie. Nous lançons le remboursement des 50 000 FCFA aujourd\'hui.',
  },
  {
    id: id('message', 7), type: 'MESSAGE_DU_CLIENT', canal: 'WEB', auteur: client, creeLe: t('25/09 15:07'), piecesJointes: [],
    contenu: 'Merci beaucoup ! Je le verrai quand sur mon compte ?',
  },
];

/**
 * Étape 21 : les autres réclamations de Yao Kouassi. Celle de cet après-midi (2453) n'est encore à
 * personne : Aya la voit sans pouvoir l'ouvrir ; le superviseur, oui.
 */
type DuClient = S<'ReclamationDuClient'>;
const YAO_53: DuClient = {
  id: id('reclamation', 2453), numero: 'ALP-2026-002453', categorie: categorie(1), statut: 'OUVERTE', creeLe: t('25/09 14:50'), agent: null, doublonPossible: true, accessible: true,
};
const YAO_42: DuClient = {
  id: id('reclamation', 2442), numero: 'ALP-2026-002442', categorie: categorie(1), statut: 'EN_COURS', creeLe: t('24/09 09:12'), agent: ref(AYA), doublonPossible: true, accessible: true,
};
const YAO_ANCIENNE: DuClient = {
  id: id('reclamation', 2198), numero: 'ALP-2026-002198', categorie: categorie(2), statut: 'CLOTUREE', creeLe: '2026-06-12T10:15:00Z', agent: ref(MAMADOU), doublonPossible: false, accessible: true,
};
const pourAya = (d: DuClient): DuClient => ({ ...d, accessible: d.agent?.id === AYA.id });

const ficheBase: Omit<S<'ReclamationDetail'>, 'actionsPossibles' | 'operationsPossibles'> = {
  id: id('reclamation', 2442),
  numero: 'ALP-2026-002442',
  statut: 'EN_COURS',
  priorite: 'NORMALE',
  canal: 'QR_CODE',
  description: DESCRIPTION_42,
  categorie: categorie(1),
  agence: agence(1),
  pointDepot: { id: id('point', 1), libelle: "Hall d'accueil" },
  agent: ref(AYA),
  avis: null,
  attributionSuggeree: null,
  // Chat web (étape 17) : le client écrit depuis son espace ; il a le chat à l'écran
  conversation: { id: id('conversation', 42), canal: 'WEB', aRepondre: true, nonLue: true, clientEnLigne: true, luParLeClientLe: t('25/09 15:09'), reponseVers: { canal: 'WEB', finFenetreLe: null } },
  depotAssistant: false,
  escaladeeVers: null,
  client: { id: id('client', 1), nom: 'Yao Kouassi', email: 'yao.kouassi@exemple.ci', telephone: '+2250708091011' },
  creeLe: t('24/09 09:12'),
  sla: {
    etat: 'DANS_LES_DELAIS',
    delaiCibleMinutes: 960,
    echeanceLe: t('28/09 17:22'),
    alertePreventiveLe: t('28/09 11:22'),
    enPauseDepuis: null,
    minutesRestantes: 582,
    enRetard: false,
    respecte: null,
  },
  jalons: {
    prisEnChargeLe: t('24/09 10:05'),
    premiereReponseLe: t('24/09 10:20'),
    resolueLe: null,
    clotureLe: null,
    clotureAutoPrevueLe: null,
    escaladeeLe: null,
    escaladeeAdminLe: null,
  },
  cloture: null,
  nbReouvertures: 0,
  saisiePar: null,
  duMemeClient: [YAO_53, YAO_ANCIENNE],
  rattacheeA: null,
  doublonsRattaches: [],
  envois: ENVOIS_42,
  messages: [
    {
      id: id('message', 1), type: 'REPONSE_AU_CLIENT', canal: 'WEB', auteur: aya, creeLe: t('24/09 10:20'), piecesJointes: [],
      contenu:
        'Bonjour M. Kouassi, merci pour votre signalement. Pour retrouver l\'opération, pouvez-vous nous envoyer une photo du ticket du distributeur et nous confirmer l\'heure du retrait ?',
    },
    {
      id: id('message', 2), type: 'MESSAGE_DU_CLIENT', canal: 'WEB', auteur: client, creeLe: t('24/09 18:02'), piecesJointes: [PHOTO_TICKET],
      contenu: 'Bonsoir, voici le ticket. Le retrait a eu lieu mercredi 23 vers 19 h 10.',
    },
    {
      id: id('message', 3), type: 'NOTE_INTERNE', canal: null, auteur: aya, creeLe: t('25/09 08:30'), piecesJointes: [],
      contenu: 'Journal du distributeur GAB-0412 demandé à la monétique. Opération du 23/09 à 19:11, 50 000 FCFA, anomalie de distribution d\'après le ticket.',
    },
    {
      id: id('message', 4), type: 'NOTE_INTERNE', canal: null, auteur: serge, creeLe: t('25/09 11:40'), piecesJointes: [],
      contenu: 'La monétique confirme l\'anomalie. Tu peux lancer la régularisation et résoudre.',
    },
    ...CHAT_42,
  ],
  piecesJointes: [],
  chronologie: [
    { type: 'CREATION', statutAvant: null, statutApres: 'OUVERTE', acteur: client, visibleClient: true, date: t('24/09 09:12') },
    { type: 'ASSIGNATION', statutAvant: null, statutApres: null, acteur: serge, visibleClient: false, date: t('24/09 09:40') },
    { type: 'PRISE_EN_CHARGE', statutAvant: 'OUVERTE', statutApres: 'EN_COURS', acteur: aya, visibleClient: true, date: t('24/09 10:05') },
    { type: 'QUESTION_AU_CLIENT', statutAvant: 'EN_COURS', statutApres: 'EN_ATTENTE_CLIENT', acteur: aya, visibleClient: true, date: t('24/09 10:20') },
    { type: 'REPONSE_DU_CLIENT', statutAvant: 'EN_ATTENTE_CLIENT', statutApres: 'EN_COURS', acteur: client, visibleClient: true, date: t('24/09 18:02') },
  ],
};

/**
 * Les boutons dépendent de l'utilisateur connecté : l'API calcule actionsPossibles et
 * operationsPossibles avec la machine d'états de l'étape 4 (vérifié par les tests).
 */
export const FICHE_42: Record<'AGENT' | 'SUPERVISEUR' | 'ADMIN_ENTREPRISE', S<'ReclamationDetail'>> = {
  AGENT: {
    ...ficheBase,
    // Étape 21 : la réclamation 2453 n'est pas à Aya, elle ne peut pas y rattacher celle-ci
    duMemeClient: ficheBase.duMemeClient.map(pourAya),
    actionsPossibles: ['QUESTIONNER_CLIENT', 'RESOUDRE'],
    operationsPossibles: ['CONSULTER', 'CHANGER_PRIORITE', 'ESCALADER', 'NOTE_INTERNE', 'REPONDRE_AU_CLIENT', 'RENVOYER_LIEN'],
  },
  SUPERVISEUR: {
    ...ficheBase,
    actionsPossibles: ['QUESTIONNER_CLIENT', 'RESOUDRE', 'CLOTURER_DE_FORCE', 'RATTACHER'],
    operationsPossibles: ['CONSULTER', 'ASSIGNER', 'CHANGER_PRIORITE', 'NOTE_INTERNE', 'REPONDRE_AU_CLIENT', 'RENVOYER_LIEN'],
  },
  ADMIN_ENTREPRISE: {
    ...ficheBase,
    actionsPossibles: [],
    operationsPossibles: ['CONSULTER'],
  },
};

/**
 * Fiche ALP-2026-002452, vue par le superviseur en mode suggestion (étape 16) : fraude suspectée,
 * pas encore assignée. Mamadou Traoré est proposé : Adjoua est absente, Aya a plus de réclamations.
 */
export const FICHE_52: S<'ReclamationDetail'> = {
  ...ficheBase,
  id: id('reclamation', 2452),
  numero: 'ALP-2026-002452',
  statut: 'OUVERTE',
  priorite: 'URGENTE',
  description: 'Deux paiements en ligne de 85 000 et 120 000 FCFA que je n\'ai pas faits sont apparus ce matin sur mon compte.',
  categorie: categorie(5),
  agent: null,
  client: { id: id('client', 7), nom: 'Adama Sanogo', email: null, telephone: '+2250545127788' },
  creeLe: t('25/09 14:32'),
  sla: {
    etat: 'DANS_LES_DELAIS', delaiCibleMinutes: 240, echeanceLe: t('28/09 09:02'), alertePreventiveLe: t('25/09 17:02'),
    enPauseDepuis: null, minutesRestantes: 202, enRetard: false, respecte: null,
  },
  jalons: { prisEnChargeLe: null, premiereReponseLe: null, resolueLe: null, clotureLe: null, clotureAutoPrevueLe: null, escaladeeLe: null, escaladeeAdminLe: null },
  messages: [],
  chronologie: [{ type: 'CREATION', statutAvant: null, statutApres: 'OUVERTE', acteur: client, visibleClient: true, date: t('25/09 14:32') }],
  attributionSuggeree: { agent: ref(MAMADOU), groupe: { id: id('groupe', 1), nom: 'Monétique' } },
  conversation: null,
  duMemeClient: [],
  envois: [envoi(10, { canal: 'SMS', objet: 'Accusé de dépôt', destinationMasquee: '+225 05 •• •• •• 88', etat: 'REMIS', creeLe: t('25/09 14:32'), remiseLe: t('25/09 14:32') })],
  actionsPossibles: ['CLOTURER_DE_FORCE'],
  operationsPossibles: ['CONSULTER', 'ASSIGNER', 'CHANGER_PRIORITE', 'NOTE_INTERNE', 'RENVOYER_LIEN'],
};

/**
 * Étape 21 : ALP-2026-002453, redéposée par Yao Kouassi faute de nouvelles. Le superviseur la
 * rattache à ALP-2026-002442, qu'Aya traite déjà.
 */
export const FICHE_53: S<'ReclamationDetail'> = {
  ...ficheBase,
  id: YAO_53.id,
  numero: YAO_53.numero,
  statut: 'OUVERTE',
  description: "Je reviens pour le retrait de 50 000 FCFA du distributeur du Plateau : l'argent n'est toujours pas revenu sur mon compte et personne ne m'a rappelé.",
  agent: null,
  pointDepot: { id: id('point', 2), libelle: 'Espace guichets' },
  creeLe: YAO_53.creeLe,
  sla: {
    etat: 'DANS_LES_DELAIS', delaiCibleMinutes: 960, echeanceLe: t('29/09 15:50'), alertePreventiveLe: t('29/09 09:50'),
    enPauseDepuis: null, minutesRestantes: 940, enRetard: false, respecte: null,
  },
  jalons: { prisEnChargeLe: null, premiereReponseLe: null, resolueLe: null, clotureLe: null, clotureAutoPrevueLe: null, escaladeeLe: null, escaladeeAdminLe: null },
  messages: [],
  chronologie: [{ type: 'CREATION', statutAvant: null, statutApres: 'OUVERTE', acteur: client, visibleClient: true, date: YAO_53.creeLe }],
  attributionSuggeree: { agent: ref(MAMADOU), groupe: { id: id('groupe', 1), nom: 'Monétique' } },
  conversation: null,
  duMemeClient: [YAO_42, YAO_ANCIENNE],
  envois: [
    envoi(12, { canal: 'EMAIL', objet: 'Accusé de dépôt', destinationMasquee: EMAIL_YAO, etat: 'ENVOYE', creeLe: YAO_53.creeLe }),
    envoi(11, { canal: 'SMS', objet: 'Accusé de dépôt', destinationMasquee: SMS_YAO, etat: 'REMIS', creeLe: YAO_53.creeLe, remiseLe: YAO_53.creeLe }),
  ],
  actionsPossibles: ['CLOTURER_DE_FORCE', 'RATTACHER'],
  operationsPossibles: ['CONSULTER', 'ASSIGNER', 'CHANGER_PRIORITE', 'NOTE_INTERNE', 'RENVOYER_LIEN'],
};

/** Étape 21 : ALP-2026-002454, saisie par Aya au guichet du Plateau pour Ahou Kouamé, sans smartphone. */
export const FICHE_54: S<'ReclamationDetail'> = {
  ...ficheBase,
  id: id('reclamation', 2454),
  numero: 'ALP-2026-002454',
  statut: 'OUVERTE',
  canal: 'GUICHET',
  categorie: categorie(4),
  description: 'La cliente conteste deux prélèvements de 7 500 FCFA intitulés « frais de tenue de compte » sur son relevé d\'août : elle dit en avoir déjà payé pour le trimestre. Elle a remis son relevé, scanné ci-dessous.',
  pointDepot: { id: id('point', 11), libelle: 'Guichet' },
  agent: ref(AYA),
  client: { id: id('client', 9), nom: 'Ahou Kouamé', email: null, telephone: '+2250101020304' },
  creeLe: t('25/09 15:02'),
  saisiePar: ref(AYA),
  piecesJointes: [
    { id: id('piece', 9), nomFichier: 'releve-aout.pdf', typeMime: 'application/pdf', tailleOctets: 412_000, creeLe: t('25/09 15:02'), antivirus: 'SAIN' },
    // Étape 22 : un document Word, accepté sans macro et analysé par l'antivirus
    { id: id('piece', 10), nomFichier: 'courrier-contestation.docx', typeMime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', tailleOctets: 38_912, creeLe: t('25/09 15:02'), antivirus: 'SAIN' },
  ],
  sla: {
    etat: 'DANS_LES_DELAIS', delaiCibleMinutes: 2400, echeanceLe: t('05/10 08:02'), alertePreventiveLe: t('01/10 14:02'),
    enPauseDepuis: null, minutesRestantes: 2392, enRetard: false, respecte: null,
  },
  jalons: { prisEnChargeLe: null, premiereReponseLe: null, resolueLe: null, clotureLe: null, clotureAutoPrevueLe: null, escaladeeLe: null, escaladeeAdminLe: null },
  messages: [],
  chronologie: [
    { type: 'CREATION', statutAvant: null, statutApres: 'OUVERTE', acteur: aya, visibleClient: true, date: t('25/09 15:02') },
    { type: 'PIECE_JOINTE', statutAvant: null, statutApres: null, acteur: aya, visibleClient: true, date: t('25/09 15:02') },
    { type: 'ASSIGNATION', statutAvant: null, statutApres: null, acteur: aya, visibleClient: false, date: t('25/09 15:02') },
  ],
  conversation: null,
  duMemeClient: [],
  // Étape 22 : le téléphone d'Ahou Kouamé était éteint ; la passerelle a renvoyé « non remis »
  envois: [
    envoi(13, {
      canal: 'SMS', objet: 'Accusé de dépôt', destinationMasquee: '+225 01 •• •• •• 04', etat: 'NON_REMIS', motif: 'INJOIGNABLE', creeLe: t('25/09 15:02'), renvoyable: true,
    }),
  ],
  actionsPossibles: ['PRENDRE_EN_CHARGE'],
  operationsPossibles: ['CONSULTER', 'CHANGER_PRIORITE', 'ESCALADER', 'NOTE_INTERNE', 'REPONDRE_AU_CLIENT', 'RENVOYER_LIEN'],
};

/** Étape 21 : récépissé de la saisie au guichet, avec le QR code du suivi (montré une fois au personnel). */
export const ACCUSE_SAISIE_54: S<'AccuseSaisie'> = {
  id: FICHE_54.id,
  numero: FICHE_54.numero,
  lienSuivi: `https://${ALPHA.slug}.${DOMAINE}/suivi/Ahk5bTJjZ3VpY2hldDU0`,
  creeLe: FICHE_54.creeLe,
  envoiPar: ['SMS'],
  agent: ref(AYA),
};

/** Étape 21 : saisie incomplète (réponse 400 de saisirReclamation). */
export const ERREUR_SAISIE: S<'Probleme'> = {
  type: 'https://reclamations.example/erreurs/validation',
  title: '2 champs à corriger',
  status: 400,
  code: 'VALIDATION',
  erreurs: [
    { champ: 'agenceId', message: 'Choisissez l\'agence du guichet' },
    { champ: 'telephone', message: 'Ce numéro a 8 chiffres ; un numéro ivoirien en compte 10, par exemple 07 08 09 10 11' },
  ],
};

/** Étape 21 : réassignation en lot des réclamations d'Adjoua, absente. */
export const RESULTAT_EN_LOT: S<'ResultatAssignationEnLot'> = {
  assignees: [
    { id: id('reclamation', 2447), numero: 'ALP-2026-002447', agent: ref(MAMADOU) },
    { id: id('reclamation', 2443), numero: 'ALP-2026-002443', agent: ref(AYA) },
  ],
  laissees: [],
};

/* ------------------------------------------------------------ Conversations (étape 17) */

type ResumeConversation = S<'ConversationResume'>;
const enConversation = (r: Resume): ResumeConversation['reclamation'] =>
  ({ id: r.id, numero: r.numero, statut: r.statut, priorite: r.priorite, categorie: r.categorie.nom });
const deLaFile = (n: number) => FILE.find((r) => r.numero.endsWith(String(n)))!;

/**
 * Boîte de réception au 25/09 15:10 : trois clients attendent une réponse, un autre a eu la sienne.
 * Étape 20 : Salimata Touré écrit sur WhatsApp, Adama Sanogo par SMS.
 */
const CONVERSATIONS: ResumeConversation[] = [
  {
    id: id('conversation', 38), canal: 'WHATSAPP', reclamation: enConversation(deLaFile(2438)), client: { nom: 'Salimata Touré' }, agent: ref(AYA),
    dernierMessage: { extrait: 'Toujours rien sur mon compte. C\'est la troisième fois que je relance, que se passe-t-il ?', auteur: 'CLIENT', date: t('25/09 09:46') },
    aRepondre: true, nonLue: false, clientEnLigne: false,
  },
  {
    id: id('conversation', 52), canal: 'SMS', reclamation: enConversation(deLaFile(2452)), client: { nom: 'Adama Sanogo' }, agent: null,
    dernierMessage: { extrait: 'J\'ai fait opposition sur ma carte depuis l\'application. Que dois-je faire d\'autre ?', auteur: 'CLIENT', date: t('25/09 14:41') },
    aRepondre: true, nonLue: true, clientEnLigne: false,
  },
  {
    id: id('conversation', 42), canal: 'WEB', reclamation: enConversation(deLaFile(2442)), client: { nom: 'Yao Kouassi' }, agent: ref(AYA),
    dernierMessage: { extrait: 'Merci beaucoup ! Je le verrai quand sur mon compte ?', auteur: 'CLIENT', date: t('25/09 15:07') },
    aRepondre: true, nonLue: true, clientEnLigne: true,
  },
  {
    id: id('conversation', 47), canal: 'WEB', reclamation: enConversation(deLaFile(2447)), client: { nom: 'Rokia Diallo' }, agent: ref(ADJOUA),
    dernierMessage: { extrait: 'Pouvez-vous nous envoyer le relevé où apparaît le prélèvement ?', auteur: 'BANQUE', date: t('25/09 11:20') },
    aRepondre: false, nonLue: false, clientEnLigne: false,
  },
];

function pageConversations(lignes: ResumeConversation[], filtre: 'a-repondre' | 'toutes'): S<'PageConversations'> {
  const donnees = filtre === 'a-repondre' ? lignes.filter((c) => c.aRepondre) : lignes;
  return {
    donnees,
    pagination: { page: 1, parPage: 50, total: donnees.length },
    compteurs: { aRepondre: lignes.filter((c) => c.aRepondre).length, nonLues: lignes.filter((c) => c.nonLue).length },
  };
}

/** listerConversations : le superviseur voit toute la banque, l'agent ses réclamations. */
export const CONVERSATIONS_SUPERVISEUR = pageConversations(CONVERSATIONS, 'a-repondre');
export const CONVERSATIONS_SUPERVISEUR_TOUTES = pageConversations(CONVERSATIONS, 'toutes');
export const CONVERSATIONS_AGENT = pageConversations(CONVERSATIONS.filter((c) => c.agent?.id === AYA.id), 'a-repondre');

/** lireConversation : la conversation de Yao Kouassi, vue par Aya (elle peut répondre) ou l'Admin Entreprise (lecture). */
export const CONVERSATION_42: Record<'AGENT' | 'SUPERVISEUR' | 'ADMIN_ENTREPRISE', S<'ConversationDetail'>> = (() => {
  const base = {
    ...CONVERSATIONS[2]!,
    description: DESCRIPTION_42,
    deposeeLe: t('24/09 09:12'),
    messages: ficheBase.messages.filter((m) => m.type !== 'NOTE_INTERNE'),
    luParLeClientLe: t('25/09 15:09'),
    reponseVers: { canal: 'WEB' as const, finFenetreLe: null },
  };
  const { dernierMessage: _dernier, ...detail } = base;
  return {
    AGENT: { ...detail, operationsPossibles: FICHE_42.AGENT.operationsPossibles },
    SUPERVISEUR: { ...detail, operationsPossibles: FICHE_42.SUPERVISEUR.operationsPossibles },
    ADMIN_ENTREPRISE: { ...detail, operationsPossibles: FICHE_42.ADMIN_ENTREPRISE.operationsPossibles },
  };
})();

/** Agents proposés à l'assignation (listerUtilisateurs, rôle AGENT, statut ACTIF). */
export const AGENTS_ASSIGNABLES = [AYA, MAMADOU, ADJOUA, IBRAHIM].map(ref);

/* ------------------------------------------------------------ Notifications in-app */

export const NOTIFICATIONS_AGENT: S<'PageNotifications'> = {
  donnees: [
    { id: id('notification', 5), modele: 'agent.envoi_non_remis', sujet: 'SMS non remis au client', contenu: 'ALP-2026-002454 : « Accusé de dépôt » n\'a pas été remis au +225 01 •• •• •• 04 (téléphone injoignable).', reclamationId: id('reclamation', 2454), creeLe: t('25/09 15:04'), lueLe: null },
    { id: id('notification', 4), modele: 'sla.alerte_preventive', sujet: 'Seuil d\'alerte atteint', contenu: 'ALP-2026-002448 : 75 % du délai consommé, échéance aujourd\'hui à 16:00.', reclamationId: id('reclamation', 2448), creeLe: t('25/09 15:00'), lueLe: null },
    { id: id('notification', 3), modele: 'agent.assignation', sujet: 'Nouvelle réclamation assignée', contenu: 'ALP-2026-002448 (Fraude suspectée) vous a été assignée par Serge Kouadio.', reclamationId: id('reclamation', 2448), creeLe: t('25/09 10:04'), lueLe: null },
    { id: id('notification', 2), modele: 'reclamation.urgente', sujet: 'Réclamation urgente', contenu: 'ALP-2026-002448, Fraude suspectée, déposée à l\'agence Plateau.', reclamationId: id('reclamation', 2448), creeLe: t('25/09 10:00'), lueLe: t('25/09 10:06') },
    { id: id('notification', 1), modele: 'agent.message_client', sujet: 'Message du client', contenu: 'Le client a répondu sur ALP-2026-002442.', reclamationId: id('reclamation', 2442), creeLe: t('24/09 18:02'), lueLe: t('25/09 08:01') },
  ],
  pagination: { page: 1, parPage: 20, total: 5 },
  nonLues: 3,
};

/* ------------------------------------------------------------ Tableau de bord (§6.6) */

/**
 * Courbe de septembre (étape 9) : 312 déposées, 276 résolues, du 1er au 25 ; les dimanches
 * (agences fermées) comptent peu de dépôts, et aucune résolution.
 */
const EVOLUTION_SEPTEMBRE: S<'Evolution'> = (() => {
  const deposees = [15, 16, 14, 17, 9, 3, 16, 18, 15, 14, 16, 8, 2, 17, 15, 14, 18, 13, 7, 2, 16, 15, 14, 13, 5];
  const resolues = [9, 13, 12, 14, 8, 0, 12, 16, 14, 13, 14, 7, 0, 14, 13, 14, 16, 12, 6, 0, 14, 14, 12, 12, 17];
  return {
    regroupement: 'JOUR',
    points: deposees.map((n, i) => ({ debut: `2026-09-${String(i + 1).padStart(2, '0')}T00:00:00Z`, deposees: n, resolues: resolues[i]! })),
  };
})();

/** Enquêtes de satisfaction de septembre (étape 15) : 241 clôtures confirmées ou automatiques. */
const SATISFACTION_SEPTEMBRE: S<'Satisfaction'> = {
  enquetes: 241,
  reponses: 103,
  tauxReponse: 0.4274,
  tauxSatisfaits: 0.7864,
  noteMoyenne: 4.1,
  nps: 28,
  promoteurs: 52,
  passifs: 28,
  detracteurs: 23,
  parAgent: [
    { cle: AYA.id, libelle: 'Aya Konan', reponses: 34, tauxSatisfaits: 0.8235, nps: 35 },
    { cle: IBRAHIM.id, libelle: 'Ibrahim Coulibaly', reponses: 29, tauxSatisfaits: 0.7931, nps: 31 },
    { cle: MAMADOU.id, libelle: 'Mamadou Traoré', reponses: 24, tauxSatisfaits: 0.75, nps: 21 },
    { cle: ADJOUA.id, libelle: "Adjoua N'Guessan", reponses: 16, tauxSatisfaits: 0.75, nps: 19 },
  ],
  commentaires: [
    { reclamationId: id('reclamation', 2391), numero: 'ALP-2026-002391', note: 5, recommandation: 10, commentaire: 'Réponse rapide et montant recrédité le lendemain. Merci à la conseillère.', reponduLe: t('25/09 12:41') },
    { reclamationId: id('reclamation', 2377), numero: 'ALP-2026-002377', note: 2, recommandation: 4, commentaire: "Il a fallu relancer deux fois avant d'avoir une vraie réponse.", reponduLe: t('25/09 09:03') },
    { reclamationId: id('reclamation', 2366), numero: 'ALP-2026-002366', note: 4, recommandation: 8, commentaire: 'Problème réglé, mais le suivi par SMS pourrait être plus détaillé.', reponduLe: t('24/09 18:27') },
    { reclamationId: id('reclamation', 2352), numero: 'ALP-2026-002352', note: 5, recommandation: 9, commentaire: "Très bon accueil à l'agence de Cocody.", reponduLe: t('23/09 16:10') },
  ],
};

export const INDICATEURS: S<'Indicateurs'> = {
  du: '2026-09-01T00:00:00Z',
  au: '2026-09-25T23:59:59Z',
  total: 312,
  parStatut: [
    { cle: 'OUVERTE', libelle: 'Ouverte', total: 9 },
    { cle: 'EN_COURS', libelle: 'En cours', total: 21 },
    { cle: 'EN_ATTENTE_CLIENT', libelle: 'En attente client', total: 6 },
    { cle: 'RESOLUE', libelle: 'Résolue', total: 14 },
    { cle: 'CLOTUREE', libelle: 'Clôturée', total: 262 },
  ],
  parCategorie: [
    { cle: id('categorie', 1), libelle: 'Carte bancaire', total: 98 },
    { cle: id('categorie', 2), libelle: 'Virement et transfert', total: 71 },
    { cle: id('categorie', 3), libelle: 'Banque mobile', total: 54 },
    { cle: id('categorie', 4), libelle: 'Frais et prélèvements', total: 39 },
    { cle: id('categorie', 6), libelle: 'Accueil en agence', total: 24 },
    { cle: id('categorie', 7), libelle: 'Crédit', total: 15 },
    { cle: id('categorie', 5), libelle: 'Fraude suspectée', total: 11 },
  ],
  parCanal: [
    { cle: 'QR_CODE', libelle: 'QR code en agence', total: 201 },
    { cle: 'LIEN_WEB', libelle: 'Lien web', total: 111 },
  ],
  parAgence: [
    { cle: id('agence', 1), libelle: 'Plateau', total: 88 },
    { cle: id('agence', 2), libelle: 'Cocody Angré', total: 57 },
    { cle: id('agence', 3), libelle: 'Yopougon Siporex', total: 49 },
    { cle: id('agence', 4), libelle: 'Treichville', total: 21 },
    { cle: id('agence', 5), libelle: 'Bouaké Commerce', total: 18 },
    { cle: 'aucune', libelle: 'Sans agence (lien web, téléphone, WhatsApp ou SMS)', total: 79 },
  ],
  delaiPremiereReponseMoyenMinutes: 104,
  delaiResolutionMoyenMinutes: 1386,
  tauxRespectSla: 0.87,
  tauxResolutionPremierContact: 0.43,
  charge: { aTraiter: 27, enAttenteClient: 6, enAlerte: 4, enRetard: 2 },
  evolution: EVOLUTION_SEPTEMBRE,
  satisfaction: SATISFACTION_SEPTEMBRE,
};

/* ------------------------------------------------------------ Journal d'audit */

const CHAINE = `banque:${id('banque', 1)}`;
type Ligne = S<'LigneAudit'>;
const ligne = (rang: number, horodatage: string, acteur: Ligne['acteur'], action: string, entite: string | null, entiteId: string | null, donnees: Ligne['donnees'], ip: string | null): Ligne => ({
  id: String(90_000 + rang), chaine: CHAINE, rang, horodatage, acteur, action, entite, entiteId, donnees, ip,
});
const u = (p: { id: string; prenom: string; nom: string }, role: string) => ({ type: 'UTILISATEUR' as const, id: p.id, libelle: `${p.prenom} ${p.nom}`, role });
const systeme = { type: 'SYSTEME' as const, id: null, libelle: null, role: null };
const clientAudit = { type: 'CLIENT' as const, id: id('client', 7), libelle: null, role: null };

export const JOURNAL: S<'PageAudit'> = {
  donnees: [
    ligne(4812, t('25/09 15:02'), u(SERGE, 'SUPERVISEUR'), 'reclamation.assignation', 'reclamation', id('reclamation', 2450), { agentId: IBRAHIM.id }, '10.20.4.17'),
    ligne(4811, t('25/09 15:00'), systeme, 'sla.alerte_preventive', 'reclamation', id('reclamation', 2448), { seuil: 75 }, null),
    ligne(4810, t('25/09 14:32'), clientAudit, 'reclamation.depot', 'reclamation', id('reclamation', 2452), { statut: 'OUVERTE', priorite: 'URGENTE' }, '102.67.12.9'),
    ligne(4809, t('25/09 14:20'), u(MAMADOU, 'AGENT'), 'utilisateur.verrouillage', 'utilisateur', MAMADOU.id, { echecs: 5 }, '10.20.4.33'),
    ligne(4808, t('25/09 11:40'), u(SERGE, 'SUPERVISEUR'), 'reclamation.note_interne', 'reclamation', id('reclamation', 2442), null, '10.20.4.17'),
    ligne(4807, t('25/09 10:00'), systeme, 'sla.depassement', 'reclamation', id('reclamation', 2449), { escaladeeVers: SERGE.id }, null),
    ligne(4806, t('25/09 09:14'), u(FATOU, 'ADMIN_ENTREPRISE'), 'categorie.modification', 'categorie', id('categorie', 3), { delaiCibleMinutes: [600, 480] }, '10.20.4.2'),
    ligne(4805, t('25/09 08:05'), u(FATOU, 'ADMIN_ENTREPRISE'), 'utilisateur.connexion', 'utilisateur', FATOU.id, null, '10.20.4.2'),
  ],
  pagination: { page: 1, parPage: 50, total: 4812 },
};

export const VERIFICATION_CHAINE: S<'VerificationChaine'> = {
  chaine: CHAINE,
  valide: true,
  lignes: 4812,
  premiereRupture: null,
};

/**
 * Étape 20 : la conversation de Salimata Touré, sur WhatsApp, vue par Aya. Elle a écrit à 09:46 : la
 * fenêtre de 24 h de Meta reste ouverte jusqu'au lendemain 09:46, la réponse part sur WhatsApp.
 */
export const CONVERSATION_WHATSAPP: S<'ConversationDetail'> = (() => {
  const { dernierMessage: _dernier, ...resume } = CONVERSATIONS[0]!;
  return {
    ...resume,
    description: 'Mon virement de salaire du 19 n\'est toujours pas arrivé sur mon compte. Mon employeur dit qu\'il est bien parti.',
    deposeeLe: t('22/09 08:41'),
    messages: [
      {
        id: id('message', 380), type: 'REPONSE_AU_CLIENT', canal: 'WHATSAPP', auteur: aya, creeLe: t('23/09 10:12'), piecesJointes: [],
        contenu: 'Bonjour Mme Touré, nous avons demandé la trace du virement à la banque émettrice. Je reviens vers vous dès que j\'ai leur réponse.',
      },
      {
        id: id('message', 381), type: 'MESSAGE_DU_CLIENT', canal: 'WHATSAPP', auteur: client, creeLe: t('24/09 17:20'), piecesJointes: [{ ...PHOTO_TICKET, id: id('piece', 380), nomFichier: 'whatsapp-1.jpg', creeLe: t('24/09 17:20') }],
        contenu: 'Voici l\'attestation de mon employeur.',
      },
      {
        id: id('message', 382), type: 'MESSAGE_DU_CLIENT', canal: 'WHATSAPP', auteur: client, creeLe: t('25/09 09:46'), piecesJointes: [],
        contenu: 'Toujours rien sur mon compte. C\'est la troisième fois que je relance, que se passe-t-il ?',
      },
    ],
    luParLeClientLe: t('23/09 10:15'),
    reponseVers: { canal: 'WHATSAPP', finFenetreLe: t('26/09 09:46') },
    operationsPossibles: FICHE_42.AGENT.operationsPossibles,
  };
})();
