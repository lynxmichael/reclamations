/** Console de la plateforme (Super Admin, Makor Telecoms) : banques clientes fictives. */
import type { S } from '../../api/types';
import { FUSEAU, id, t } from './commun';

export const PLANS: S<'Plan'>[] = [
  { id: id('plan', 1), code: 'ESSENTIEL', nom: 'Essentiel', description: 'Une à trois agences', plafondAgents: 10, plafondTicketsMois: 500, actif: true },
  { id: id('plan', 2), code: 'PRO', nom: 'Pro', description: 'Réseau régional', plafondAgents: 40, plafondTicketsMois: 3000, actif: true },
  { id: id('plan', 3), code: 'RESEAU', nom: 'Réseau', description: 'Sans plafond', plafondAgents: null, plafondTicketsMois: null, actif: true },
];

const plan = (n: number) => ({ id: PLANS[n - 1]!.id, nom: PLANS[n - 1]!.nom });

function banque(n: number, b: Omit<S<'BanquePlateforme'>, 'id' | 'fuseauHoraire' | 'seuilAlerteSlaPourcent' | 'delaiClotureAutoJours' | 'smsChaqueChangementStatut' | 'enqueteSatisfaction' | 'attributionAutomatique' | 'chatWeb' | 'assistantIa' | 'doubleAuthentificationObligatoire' | 'suspendueLe' | 'motifSuspension' | 'whatsapp' | 'smsEntrant' | 'raccordements'> & Partial<S<'BanquePlateforme'>>): S<'BanquePlateforme'> {
  return {
    id: id('banque', n),
    fuseauHoraire: FUSEAU,
    seuilAlerteSlaPourcent: 75,
    delaiClotureAutoJours: 5,
    smsChaqueChangementStatut: true,
    enqueteSatisfaction: false,
    attributionAutomatique: false,
    chatWeb: false,
    assistantIa: false,
    doubleAuthentificationObligatoire: false,
    whatsapp: false,
    smsEntrant: false,
    raccordements: { whatsapp: null, sms: null },
    suspendueLe: null,
    motifSuspension: null,
    ...b,
  };
}

export const BANQUES: S<'BanquePlateforme'>[] = [
  banque(1, { nom: 'Banque Alpha', slug: 'alpha', prefixeTickets: 'ALP', plan: plan(2), creeLe: '2026-03-02T09:00:00Z', enqueteSatisfaction: true, attributionAutomatique: true, chatWeb: true, assistantIa: true,
    whatsapp: true, smsEntrant: true,
    raccordements: { whatsapp: { numero: '+2252722000000', identifiant: '109876543210987', compte: '209876543210987' }, sms: { numero: '+2252722000001' } },
    consommation: { agents: 7, ticketsCeMois: 312 } }),
  banque(2, { nom: 'Banque Horizon', slug: 'horizon', prefixeTickets: 'HZN', plan: plan(3), creeLe: '2026-04-14T10:30:00Z', seuilAlerteSlaPourcent: 80, doubleAuthentificationObligatoire: true, consommation: { agents: 23, ticketsCeMois: 1184 } }),
  banque(3, { nom: 'Caisse Lagune', slug: 'lagune', prefixeTickets: 'LAG', plan: plan(1), creeLe: '2026-06-01T08:00:00Z', smsChaqueChangementStatut: false, consommation: { agents: 9, ticketsCeMois: 517 } }),
  banque(4, { nom: 'Banque Savane', slug: 'savane', prefixeTickets: 'SAV', plan: plan(1), creeLe: '2026-07-20T11:15:00Z', delaiClotureAutoJours: 7, suspendueLe: t('18/09 17:00'), motifSuspension: 'Contrat en cours de renouvellement', consommation: { agents: 4, ticketsCeMois: 61 } }),
];

export const PAGE_BANQUES: S<'PageBanques'> = {
  donnees: BANQUES,
  pagination: { page: 1, parPage: 25, total: BANQUES.length },
};

const statuts = (o: number, c: number, a: number, r: number, cl: number): S<'Volume'>[] => [
  { cle: 'OUVERTE', libelle: 'Ouverte', total: o },
  { cle: 'EN_COURS', libelle: 'En cours', total: c },
  { cle: 'EN_ATTENTE_CLIENT', libelle: 'En attente client', total: a },
  { cle: 'RESOLUE', libelle: 'Résolue', total: r },
  { cle: 'CLOTUREE', libelle: 'Clôturée', total: cl },
];

/** Métadonnées seulement : jamais le contenu d'une réclamation ni un client (arbitrage 4). */
export const INDICATEURS_PLATEFORME: S<'IndicateursPlateforme'> = {
  du: '2026-09-01T00:00:00Z',
  au: '2026-09-25T23:59:59Z',
  banques: [
    { banque: { id: id('banque', 1), nom: 'Banque Alpha' }, total: 312, parStatut: statuts(9, 21, 6, 14, 262), urgentes: 11, tauxRespectSla: 0.87, tauxResolutionPremierContact: 0.43, satisfaction: { enquetes: 241, reponses: 103, tauxSatisfaits: 0.7864, nps: 28 } },
    { banque: { id: id('banque', 2), nom: 'Banque Horizon' }, total: 1184, parStatut: statuts(41, 96, 22, 58, 967), urgentes: 37, tauxRespectSla: 0.91, tauxResolutionPremierContact: 0.52, satisfaction: null },
    { banque: { id: id('banque', 3), nom: 'Caisse Lagune' }, total: 517, parStatut: statuts(38, 44, 12, 19, 404), urgentes: 6, tauxRespectSla: 0.68, tauxResolutionPremierContact: 0.31, satisfaction: null },
    { banque: { id: id('banque', 4), nom: 'Banque Savane' }, total: 61, parStatut: statuts(0, 0, 0, 0, 61), urgentes: 1, tauxRespectSla: 0.79, tauxResolutionPremierContact: 0.38, satisfaction: null },
  ],
};

export const FACTURATION_SMS: S<'FacturationSms'> = {
  mois: '2026-09',
  banques: [
    { banque: { id: id('banque', 1), nom: 'Banque Alpha' }, sms: 1486, segments: 1502, remis: 1461, echecs: 12 },
    { banque: { id: id('banque', 2), nom: 'Banque Horizon' }, sms: 5210, segments: 5288, remis: 5098, echecs: 41 },
    { banque: { id: id('banque', 3), nom: 'Caisse Lagune' }, sms: 1034, segments: 1034, remis: 1017, echecs: 9 },
    { banque: { id: id('banque', 4), nom: 'Banque Savane' }, sms: 188, segments: 191, remis: 188, echecs: 0 },
  ],
};

/** WhatsApp et SMS reçus (étape 20) : totaux par banque, sans numéro ni texte. */
export const FACTURATION_CANAUX: S<'FacturationCanaux'> = {
  mois: '2026-09',
  banques: [
    { banque: { id: id('banque', 1), nom: 'Banque Alpha' }, whatsappEnvoyes: 642, whatsappFactures: 118, whatsappEchecs: 7, whatsappRecus: 931, smsRecus: 214 },
    { banque: { id: id('banque', 2), nom: 'Banque Horizon' }, whatsappEnvoyes: 0, whatsappFactures: 0, whatsappEchecs: 0, whatsappRecus: 0, smsRecus: 0 },
    { banque: { id: id('banque', 3), nom: 'Caisse Lagune' }, whatsappEnvoyes: 0, whatsappFactures: 0, whatsappEchecs: 0, whatsappRecus: 0, smsRecus: 0 },
    { banque: { id: id('banque', 4), nom: 'Banque Savane' }, whatsappEnvoyes: 0, whatsappFactures: 0, whatsappEchecs: 0, whatsappRecus: 0, smsRecus: 0 },
  ],
};

/** Alertes du Super Admin : « banque · numéro · catégorie · heure », sans donnée du client. */
export const ALERTES: S<'PageNotifications'> = {
  donnees: [
    { id: id('notification', 14), modele: 'plateforme.urgente', sujet: 'Réclamation urgente', contenu: 'Banque Alpha · ALP-2026-002452 · Fraude suspectée · 14:32', reclamationId: null, creeLe: t('25/09 14:32'), lueLe: null },
    { id: id('notification', 13), modele: 'plateforme.urgente', sujet: 'Réclamation urgente', contenu: 'Banque Horizon · HZN-2026-009731 · Fraude suspectée · 13:05', reclamationId: null, creeLe: t('25/09 13:05'), lueLe: null },
    { id: id('notification', 11), modele: 'plateforme.urgente', sujet: 'Réclamation urgente', contenu: 'Banque Alpha · ALP-2026-002448 · Fraude suspectée · 10:00', reclamationId: null, creeLe: t('25/09 10:00'), lueLe: t('25/09 10:20') },
    { id: id('notification', 12), modele: 'plateforme.plafond', sujet: 'Plafond de tickets dépassé', contenu: 'Caisse Lagune : 517 réclamations ce mois pour un plafond de 500 (plan Essentiel). Les dépôts continuent.', reclamationId: null, creeLe: t('24/09 16:48'), lueLe: null },
  ],
  pagination: { page: 1, parPage: 20, total: 4 },
  nonLues: 3,
};
