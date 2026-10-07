/**
 * Baromètre mensuel de la Banque Alpha (étape 23). Au 25 septembre 2026, le dernier publié est celui
 * d'août (le 1er septembre) ; l'assistant IA de la banque étant ouvert, l'analyse est passée par l'IA.
 * Fatou (Admin Entreprise) a déjà retenu une recommandation et écarté une autre.
 */
import type { S } from '../../api/types';
import { categorie, agence, FATOU, ref } from './parametrage';

const rid = (n: number) => `0199abab-0000-7000-8000-${String(n).padStart(12, '0')}`;

const mesures = (m: S<'MesuresBarometre'>) => m;

const AOUT = mesures({
  reclamations: 318, urgentes: 21, resolues: 297, tauxRespectSla: 0.8316, tauxPremierContact: 0.7104, delaiResolutionMoyenMinutes: 812,
  contestees: 14, enquetes: 246, tauxReponse: 0.4512, reponses: 109, tauxSatisfaits: 0.6972, noteMoyenne: 3.9, nps: 16,
});
const JUILLET = mesures({
  reclamations: 274, urgentes: 17, resolues: 266, tauxRespectSla: 0.8835, tauxPremierContact: 0.7368, delaiResolutionMoyenMinutes: 705,
  contestees: 9, enquetes: 221, tauxReponse: 0.4389, reponses: 97, tauxSatisfaits: 0.7526, noteMoyenne: 4, nps: 27,
});

const irritant = (r: { id: string; nom: string }, c: Omit<S<'Irritant'>, 'id' | 'nom' | 'score'>): S<'Irritant'> =>
  ({ ...r, ...c, score: c.reclamations + c.horsDelai + c.contestees + c.insatisfaits });

export const BAROMETRE_AOUT: S<'Barometre'> = {
  mois: '2026-08',
  du: '2026-08-01T00:00:00.000Z',
  au: '2026-09-01T00:00:00.000Z',
  source: 'IA',
  genereLe: '2026-09-01T00:04:12.000Z',
  mesures: AOUT,
  precedent: JUILLET,
  peuDeReponses: false,
  tendance: [
    { mois: '2026-03', reclamations: 196, tauxRespectSla: 0.9031, reponses: 71, tauxSatisfaits: 0.7746, nps: 31 },
    { mois: '2026-04', reclamations: 231, tauxRespectSla: 0.8918, reponses: 84, tauxSatisfaits: 0.7738, nps: 29 },
    { mois: '2026-05', reclamations: 249, tauxRespectSla: 0.8956, reponses: 92, tauxSatisfaits: 0.7826, nps: 30 },
    { mois: '2026-06', reclamations: 262, tauxRespectSla: 0.8862, reponses: 95, tauxSatisfaits: 0.7684, nps: 28 },
    { mois: '2026-07', reclamations: 274, tauxRespectSla: 0.8835, reponses: 97, tauxSatisfaits: 0.7526, nps: 27 },
    { mois: '2026-08', reclamations: 318, tauxRespectSla: 0.8316, reponses: 109, tauxSatisfaits: 0.6972, nps: 16 },
  ],
  irritants: [
    irritant(categorie(1), { reclamations: 112, precedent: 72, resolues: 104, horsDelai: 27, contestees: 6, reponses: 38, insatisfaits: 15 }),
    irritant(categorie(3), { reclamations: 64, precedent: 52, resolues: 61, horsDelai: 14, contestees: 3, reponses: 22, insatisfaits: 9 }),
    irritant(categorie(2), { reclamations: 58, precedent: 55, resolues: 55, horsDelai: 4, contestees: 2, reponses: 21, insatisfaits: 5 }),
    irritant(categorie(4), { reclamations: 39, precedent: 41, resolues: 36, horsDelai: 1, contestees: 2, reponses: 14, insatisfaits: 6 }),
    irritant(categorie(5), { reclamations: 21, precedent: 17, resolues: 21, horsDelai: 2, contestees: 0, reponses: 6, insatisfaits: 1 }),
  ],
  agences: [
    irritant(agence(3), { reclamations: 71, precedent: 49, resolues: 66, horsDelai: 19, contestees: 4, reponses: 24, insatisfaits: 11 }),
    irritant(agence(1), { reclamations: 82, precedent: 84, resolues: 79, horsDelai: 9, contestees: 3, reponses: 31, insatisfaits: 7 }),
    irritant(agence(2), { reclamations: 46, precedent: 44, resolues: 44, horsDelai: 3, contestees: 1, reponses: 17, insatisfaits: 3 }),
  ],
  themes: [
    {
      libelle: 'Cartes bloquées ou avalées', mentions: 14, negatifs: 12, positifs: 2,
      exemples: [
        { numero: 'ALP-2026-000812', note: 1, texte: 'Ma carte est bloquée depuis trois semaines et personne ne me dit quand je pourrai la récupérer.' },
        { numero: 'ALP-2026-000799', note: 2, texte: 'Le distributeur de Yopougon a avalé ma carte, on m\'a demandé de revenir deux fois.' },
      ],
    },
    {
      libelle: 'Suivi du dossier', mentions: 11, negatifs: 8, positifs: 3,
      exemples: [
        { numero: 'ALP-2026-000776', note: 2, texte: 'J\'ai dû appeler trois fois pour savoir où en était ma réclamation.' },
        { numero: 'ALP-2026-000741', note: 3, texte: 'Problème réglé, mais aucune nouvelle entre le dépôt et la réponse finale.' },
      ],
    },
    {
      libelle: 'Accueil et écoute', mentions: 9, negatifs: 1, positifs: 8,
      exemples: [
        { numero: 'ALP-2026-000803', note: 5, texte: 'Conseillère très à l\'écoute, merci.' },
        { numero: 'ALP-2026-000768', note: 5, texte: 'Bon accueil au Plateau, dossier réglé en deux jours.' },
      ],
    },
    {
      libelle: 'Connexion à l\'application', mentions: 7, negatifs: 5, positifs: 2,
      exemples: [
        { numero: 'ALP-2026-000790', note: 2, texte: 'Impossible de me connecter depuis la mise à jour de l\'application.' },
        { numero: 'ALP-2026-000757', note: 3, texte: 'Le code reçu par SMS arrive trop tard, la page a déjà expiré.' },
      ],
    },
  ],
  commentaires: 41,
  faitsMarquants: [
    { sens: 'MOINS_BIEN', texte: 'Délais respectés : 83 % (-5 points sur le mois précédent)' },
    { sens: 'MOINS_BIEN', texte: 'Clients satisfaits : 70 % (-6 points sur le mois précédent)' },
    { sens: 'MOINS_BIEN', texte: 'NPS : +16 (-11 sur le mois précédent)' },
    { sens: 'MOINS_BIEN', texte: '« Carte bancaire » : 112 réclamations, contre 72 le mois précédent' },
  ],
  recommandations: [
    {
      id: rid(1), ordre: 1, titre: 'Résorber le retard sur les cartes bloquées',
      constat: '27 réclamations « Carte bancaire » sur 104 résolues l\'ont été hors délai, et 112 sont arrivées ce mois-ci contre 72 le mois précédent.',
      action: 'Renforcer l\'équipe monétique jusqu\'à la fin du retard et suivre chaque matin la file « En retard » de la catégorie.',
      categorie: categorie(1), priorite: 'HAUTE', source: 'IA', decision: 'RETENUE',
      commentaire: 'Deux agents du back-office en renfort jusqu\'au 30 septembre.', decideePar: ref(FATOU), decideeLe: '2026-09-02T08:41:00.000Z',
    },
    {
      id: rid(2), ordre: 2, titre: 'Soutenir l\'agence Yopougon Siporex',
      constat: '19 réclamations sur 66 résolues à Yopougon Siporex l\'ont été hors délai, et son distributeur revient dans les commentaires.',
      action: 'Faire vérifier le distributeur de l\'agence et répartir ses dossiers en retard avec l\'équipe du Plateau.',
      categorie: null, priorite: 'HAUTE', source: 'IA', decision: 'A_ETUDIER', commentaire: null, decideePar: null, decideeLe: null,
    },
    {
      id: rid(3), ordre: 3, titre: 'Donner des nouvelles sur les dossiers longs',
      constat: '8 clients insatisfaits disent avoir dû relancer pour connaître l\'avancement de leur dossier.',
      action: 'Sur les dossiers ouverts depuis plus d\'une semaine, envoyer au client un point d\'étape chaque semaine, même sans nouvelle.',
      categorie: null, priorite: 'MOYENNE', source: 'IA', decision: 'A_ETUDIER', commentaire: null, decideePar: null, decideeLe: null,
    },
    {
      id: rid(4), ordre: 4, titre: 'Préparer une réponse type sur la connexion à l\'application',
      constat: '64 réclamations « Banque mobile », dont 14 résolues hors délai ; la connexion après la mise à jour revient dans les commentaires.',
      action: 'Rédiger avec le service digital une réponse type, et une question fréquente pour l\'assistant du portail.',
      categorie: categorie(3), priorite: 'MOYENNE', source: 'IA', decision: 'ECARTEE',
      commentaire: 'Correctif de l\'application prévu le 28 septembre : on attend.', decideePar: ref(FATOU), decideeLe: '2026-09-02T08:44:00.000Z',
    },
  ],
};

export const LISTE_BAROMETRES: S<'ListeBarometres'> = {
  prochainLe: '2026-10-01',
  donnees: [
    { mois: '2026-08', source: 'IA', genereLe: '2026-09-01T00:04:12.000Z', reclamations: 318, tauxRespectSla: 0.8316, tauxSatisfaits: 0.6972, recommandations: 4, aEtudier: 2 },
    { mois: '2026-07', source: 'IA', genereLe: '2026-08-01T00:03:48.000Z', reclamations: 274, tauxRespectSla: 0.8835, tauxSatisfaits: 0.7526, recommandations: 3, aEtudier: 0 },
    { mois: '2026-06', source: 'REGLES', genereLe: '2026-07-01T00:05:02.000Z', reclamations: 262, tauxRespectSla: 0.8862, tauxSatisfaits: 0.7684, recommandations: 2, aEtudier: 0 },
  ],
};

/** Fonction ouverte ce mois-ci : le premier baromètre arrive le 1er octobre */
export const LISTE_BAROMETRES_VIDE: S<'ListeBarometres'> = { prochainLe: '2026-10-01', donnees: [] };

/** Notification du 1er septembre aux Admin Entreprise et superviseurs */
export const NOTIFICATION_BAROMETRE: S<'NotificationInApp'> = {
  id: '01995555-5555-7000-8000-000000000923',
  modele: 'barometre.pret',
  sujet: 'Baromètre d\'août 2026',
  contenu: 'Le baromètre d\'août 2026 est prêt : 4 recommandations à étudier, irritant principal « Carte bancaire ».',
  reclamationId: null,
  creeLe: '2026-09-01T00:04:12.000Z',
  lueLe: '2026-09-01T07:58:00.000Z',
};

/**
 * Démo cliquable : le baromètre d'août recalé sur le dernier mois écoulé à la date de la démo (mois,
 * dates de publication et de décision, tendance) ; un seul mois publié.
 */
export function barometreDemo(maintenant: Date): { liste: S<'ListeBarometres'>; barometre: S<'Barometre'> } {
  const mois = (decalage: number) => new Date(Date.UTC(maintenant.getUTCFullYear(), maintenant.getUTCMonth() - 1 + decalage, 1)).toISOString().slice(0, 7);
  const barometre: S<'Barometre'> = {
    ...BAROMETRE_AOUT,
    mois: mois(0),
    du: `${mois(0)}-01T00:00:00.000Z`,
    au: `${mois(1)}-01T00:00:00.000Z`,
    genereLe: `${mois(1)}-01T00:04:12.000Z`,
    tendance: BAROMETRE_AOUT.tendance.map((p, i) => ({ ...p, mois: mois(i - 5) })),
    recommandations: BAROMETRE_AOUT.recommandations.map((r) => (r.decideeLe ? { ...r, decideeLe: `${mois(1)}-01T08:4${r.ordre}:00.000Z` } : r)),
  };
  const [dernier] = LISTE_BAROMETRES.donnees;
  return { liste: { prochainLe: `${mois(2)}-01`, donnees: [{ ...dernier!, mois: mois(0), genereLe: barometre.genereLe }] }, barometre };
}
