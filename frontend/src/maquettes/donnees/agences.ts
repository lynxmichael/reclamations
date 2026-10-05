/**
 * Étape 19 : activité des agences de la Banque Alpha en septembre (lireIndicateursAgences), mêmes
 * totaux que le tableau de bord (INDICATEURS : 312 réclamations, charge 27 / 6 / 4 / 2), et
 * « Mon compte » (preparerTotp).
 */
import type { S } from '../../api/types';
import { id } from './commun';
import { ADJOUA, AGENCES, AYA, IBRAHIM, MAMADOU, POINTS_DEPOT } from './parametrage';

const agence = (n: number) => {
  const a = AGENCES[n - 1]!;
  return { id: a.id, code: a.code, nom: a.nom, ville: a.ville, active: a.active };
};
const point = (n: number, total: number) => {
  const p = POINTS_DEPOT[n - 1]!;
  return { id: p.id, libelle: p.libelle, canal: p.canal, actif: p.actif, total };
};
const cat = (n: number, libelle: string, total: number) => ({ cle: id('categorie', n), libelle, total });
const agent = (p: { id: string; prenom: string; nom: string }, total: number) => ({ cle: p.id, libelle: `${p.prenom} ${p.nom}`, total });

export const INDICATEURS_AGENCES: S<'IndicateursAgences'> = {
  du: '2026-09-01T00:00:00Z',
  au: '2026-09-25T23:59:59Z',
  agences: [
    {
      agence: agence(1), groupe: null, total: 88, urgentes: 4, resolues: 74,
      delaiPremiereReponseMoyenMinutes: 92, delaiResolutionMoyenMinutes: 1210, tauxRespectSla: 0.92, tauxResolutionPremierContact: 0.47,
      charge: { aTraiter: 7, enAttenteClient: 2, enAlerte: 1, enRetard: 0 },
      satisfaction: { enquetes: 61, reponses: 34, tauxSatisfaits: 0.82, nps: 41 },
      parCategorie: [cat(1, 'Carte bancaire', 31), cat(2, 'Virement et transfert', 22), cat(3, 'Banque mobile', 14)],
      agents: [agent(AYA, 34), agent(MAMADOU, 29), agent(ADJOUA, 17)],
      pointsDepot: [point(1, 52), point(2, 27), point(7, 9)],
    },
    {
      agence: agence(2), groupe: null, total: 57, urgentes: 2, resolues: 46,
      delaiPremiereReponseMoyenMinutes: 118, delaiResolutionMoyenMinutes: 1490, tauxRespectSla: 0.85, tauxResolutionPremierContact: 0.41,
      charge: { aTraiter: 6, enAttenteClient: 1, enAlerte: 1, enRetard: 1 },
      satisfaction: { enquetes: 39, reponses: 20, tauxSatisfaits: 0.75, nps: 30 },
      parCategorie: [cat(2, 'Virement et transfert', 19), cat(1, 'Carte bancaire', 17), cat(4, 'Frais et prélèvements', 9)],
      agents: [agent(MAMADOU, 24), agent(AYA, 18), agent(IBRAHIM, 9)],
      pointsDepot: [point(3, 41), point(7, 11), point(8, 5)],
    },
    {
      agence: agence(3), groupe: null, total: 49, urgentes: 3, resolues: 38,
      delaiPremiereReponseMoyenMinutes: 131, delaiResolutionMoyenMinutes: 1622, tauxRespectSla: 0.79, tauxResolutionPremierContact: 0.37,
      charge: { aTraiter: 7, enAttenteClient: 1, enAlerte: 1, enRetard: 1 },
      satisfaction: { enquetes: 33, reponses: 17, tauxSatisfaits: 0.71, nps: 18 },
      parCategorie: [cat(1, 'Carte bancaire', 18), cat(3, 'Banque mobile', 13), cat(2, 'Virement et transfert', 10)],
      agents: [agent(IBRAHIM, 21), agent(ADJOUA, 15), agent(AYA, 8)],
      pointsDepot: [point(4, 44), point(7, 5)],
    },
    {
      agence: agence(4), groupe: null, total: 21, urgentes: 1, resolues: 18,
      delaiPremiereReponseMoyenMinutes: 97, delaiResolutionMoyenMinutes: 1180, tauxRespectSla: 0.94, tauxResolutionPremierContact: 0.5,
      charge: { aTraiter: 2, enAttenteClient: 0, enAlerte: 0, enRetard: 0 },
      satisfaction: { enquetes: 15, reponses: 9, tauxSatisfaits: 0.89, nps: 56 },
      parCategorie: [cat(6, 'Accueil en agence', 8), cat(1, 'Carte bancaire', 7), cat(4, 'Frais et prélèvements', 4)],
      agents: [agent(ADJOUA, 11), agent(MAMADOU, 8)],
      pointsDepot: [point(5, 17), point(7, 4)],
    },
    {
      agence: agence(5), groupe: { id: id('groupe', 3), nom: 'Agence de Bouaké' }, total: 18, urgentes: 0, resolues: 15,
      delaiPremiereReponseMoyenMinutes: 76, delaiResolutionMoyenMinutes: 905, tauxRespectSla: 1, tauxResolutionPremierContact: 0.6,
      charge: { aTraiter: 1, enAttenteClient: 0, enAlerte: 0, enRetard: 0 },
      satisfaction: { enquetes: 12, reponses: 8, tauxSatisfaits: 0.88, nps: 50 },
      parCategorie: [cat(6, 'Accueil en agence', 9), cat(1, 'Carte bancaire', 5), cat(2, 'Virement et transfert', 4)],
      agents: [agent(IBRAHIM, 16)],
      pointsDepot: [point(6, 15), point(7, 3)],
    },
    {
      agence: null, groupe: null, total: 79, urgentes: 1, resolues: 63,
      delaiPremiereReponseMoyenMinutes: 95, delaiResolutionMoyenMinutes: 1402, tauxRespectSla: 0.86, tauxResolutionPremierContact: 0.44,
      charge: { aTraiter: 4, enAttenteClient: 2, enAlerte: 1, enRetard: 0 },
      satisfaction: { enquetes: 44, reponses: 26, tauxSatisfaits: 0.77, nps: 35 },
      parCategorie: [cat(3, 'Banque mobile', 23), cat(1, 'Carte bancaire', 20), cat(2, 'Virement et transfert', 16)],
      agents: [agent(MAMADOU, 27), agent(AYA, 25), agent(IBRAHIM, 14)],
      pointsDepot: [point(7, 52), point(8, 27)],
    },
  ],
};

/** « Mon compte » d'Ibrahim Coulibaly : la double authentification préparée, à confirmer avec un premier code. */
export const ENROLEMENT_COMPTE: S<'EnrolementCompte'> = {
  otpauthUrl: 'otpauth://totp/R%C3%A9clamations%20Makor:ibrahim.coulibaly%40banque-alpha.example?secret=JBSWY3DPEHPK3PXPMFRGG43F&issuer=R%C3%A9clamations%20Makor&digits=6&period=30',
  secret: 'JBSWY3DPEHPK3PXPMFRGG43F',
  qrCodeDataUrl: 'data:image/png;base64,iVBORw0KGgo=',
};
