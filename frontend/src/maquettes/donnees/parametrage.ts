/** Paramétrage et personnel de la Banque Alpha (fictive). */
import type { S } from '../../api/types';
import { ALPHA, DOMAINE, FUSEAU, id, t } from './commun';

export const CATEGORIES: S<'Categorie'>[] = [
  { id: id('categorie', 1), nom: 'Carte bancaire', description: 'Carte bloquée, retrait non abouti, opération inconnue', prioriteParDefaut: 'NORMALE', delaiCibleMinutes: 960, ordre: 1, active: true },
  { id: id('categorie', 2), nom: 'Virement et transfert', description: 'Virement non reçu, en retard ou vers un mauvais bénéficiaire', prioriteParDefaut: 'NORMALE', delaiCibleMinutes: 1440, ordre: 2, active: true },
  { id: id('categorie', 3), nom: 'Banque mobile', description: "Accès à l'application, code secret, paiement mobile", prioriteParDefaut: 'NORMALE', delaiCibleMinutes: 480, ordre: 3, active: true },
  { id: id('categorie', 4), nom: 'Frais et prélèvements', description: 'Frais contestés, prélèvement non autorisé', prioriteParDefaut: 'NORMALE', delaiCibleMinutes: 2400, ordre: 4, active: true },
  { id: id('categorie', 5), nom: 'Fraude suspectée', description: "Une opération que vous n'avez pas faite", prioriteParDefaut: 'URGENTE', delaiCibleMinutes: 240, ordre: 5, active: true },
  { id: id('categorie', 6), nom: 'Accueil en agence', description: "Temps d'attente, qualité du service reçu", prioriteParDefaut: 'NORMALE', delaiCibleMinutes: 2400, ordre: 6, active: true },
  { id: id('categorie', 7), nom: 'Crédit', description: 'Échéance, remboursement anticipé, suivi de dossier', prioriteParDefaut: 'NORMALE', delaiCibleMinutes: 3600, ordre: 7, active: true },
  { id: id('categorie', 8), nom: 'Chéquier', description: null, prioriteParDefaut: 'NORMALE', delaiCibleMinutes: 1440, ordre: 8, active: false },
];

export const categorie = (n: number) => ({ id: id('categorie', n), nom: CATEGORIES[n - 1]!.nom });

export const AGENCES: S<'Agence'>[] = [
  { id: id('agence', 1), code: 'AG01', nom: 'Plateau', ville: 'Abidjan', adresse: 'Avenue Franchet d\'Esperey', active: true },
  { id: id('agence', 2), code: 'AG02', nom: 'Cocody Angré', ville: 'Abidjan', adresse: 'Boulevard Latrille', active: true },
  { id: id('agence', 3), code: 'AG03', nom: 'Yopougon Siporex', ville: 'Abidjan', adresse: null, active: true },
  { id: id('agence', 4), code: 'AG04', nom: 'Treichville', ville: 'Abidjan', adresse: 'Avenue 16', active: true },
  { id: id('agence', 5), code: 'AG05', nom: 'Bouaké Commerce', ville: 'Bouaké', adresse: null, active: true },
];

export const agence = (n: number) => ({ id: id('agence', n), nom: AGENCES[n - 1]!.nom });

const url = (code: string) => `https://${ALPHA.slug}.${DOMAINE}/d/${code}`;

export const POINTS_DEPOT: S<'PointDepot'>[] = [
  { id: id('point', 1), code: '7K3QX9P2MA', canal: 'QR_CODE', libelle: "Hall d'accueil", agence: agence(1), actif: true, urlDepot: url('7K3QX9P2MA') },
  { id: id('point', 2), code: '4HT8M2WQZC', canal: 'QR_CODE', libelle: 'Espace guichets', agence: agence(1), actif: true, urlDepot: url('4HT8M2WQZC') },
  { id: id('point', 3), code: 'P9D2LK7VXR', canal: 'QR_CODE', libelle: "Hall d'accueil", agence: agence(2), actif: true, urlDepot: url('P9D2LK7VXR') },
  { id: id('point', 4), code: 'B6N4TR8YQE', canal: 'QR_CODE', libelle: "Hall d'accueil", agence: agence(3), actif: true, urlDepot: url('B6N4TR8YQE') },
  { id: id('point', 5), code: 'Z2W7CM5HKP', canal: 'QR_CODE', libelle: "Hall d'accueil", agence: agence(4), actif: false, urlDepot: url('Z2W7CM5HKP') },
  { id: id('point', 6), code: 'R8F3JX6NDT', canal: 'QR_CODE', libelle: "Hall d'accueil", agence: agence(5), actif: true, urlDepot: url('R8F3JX6NDT') },
  { id: id('point', 7), code: 'W5Q9HB2MLC', canal: 'LIEN_WEB', libelle: 'Site web, page Contact', agence: null, actif: true, urlDepot: url('W5Q9HB2MLC') },
  { id: id('point', 8), code: 'K4V8PZ3TRG', canal: 'LIEN_WEB', libelle: "Application mobile, rubrique Aide", agence: null, actif: true, urlDepot: url('K4V8PZ3TRG') },
  // Étape 20 : les numéros de la banque, raccordés et ouverts par Makor
  { id: id('point', 9), code: 'WHATSAPP2A', canal: 'WHATSAPP', libelle: 'WhatsApp', agence: null, actif: true, urlDepot: 'https://wa.me/2252722000000' },
  { id: id('point', 10), code: 'SMSALPHA2B', canal: 'SMS', libelle: 'SMS', agence: null, actif: true, urlDepot: 'sms:+2252722000001' },
];

const plagesJour = (j: number): S<'Plage'>[] => [
  { jourSemaine: j, debut: '08:00', fin: '12:00' },
  { jourSemaine: j, debut: '14:00', fin: '17:30' },
];

export const HORAIRES: S<'Horaires'> = {
  fuseauHoraire: FUSEAU,
  plages: [1, 2, 3, 4, 5].flatMap(plagesJour),
};

export const JOURS_FERIES: S<'JourFerie'>[] = [
  { id: id('ferie', 1), date: '2026-01-01', libelle: "Jour de l'an", recurrent: true },
  { id: id('ferie', 2), date: '2026-05-01', libelle: 'Fête du Travail', recurrent: true },
  { id: id('ferie', 3), date: '2026-08-07', libelle: "Fête de l'Indépendance", recurrent: true },
  { id: id('ferie', 4), date: '2026-08-15', libelle: 'Assomption', recurrent: true },
  { id: id('ferie', 5), date: '2026-11-01', libelle: 'Toussaint', recurrent: true },
  { id: id('ferie', 6), date: '2026-11-15', libelle: 'Journée nationale de la Paix', recurrent: true },
  { id: id('ferie', 7), date: '2026-12-25', libelle: 'Noël', recurrent: true },
  { id: id('ferie', 8), date: '2027-03-29', libelle: 'Lundi de Pâques', recurrent: false },
];

export const PARAMETRES: S<'ParametresBanque'> = {
  nom: ALPHA.nom,
  slug: ALPHA.slug,
  prefixeTickets: 'ALP',
  fuseauHoraire: FUSEAU,
  seuilAlerteSlaPourcent: 75,
  delaiClotureAutoJours: 5,
  smsChaqueChangementStatut: true,
  enqueteSatisfaction: true,
  attributionAutomatique: true,
  modeAttribution: 'SUGGESTION',
  chatWeb: true,
  assistantIa: true,
  barometre: true,
  doubleAuthentificationObligatoire: false,
  whatsapp: '+2252722000000',
  smsEntrant: '+2252722000001',
  couleurPrimaire: ALPHA.couleurPrimaire,
  couleurSecondaire: ALPHA.couleurSecondaire,
  logoUrl: null,
  emailContact: 'reclamations@banque-alpha.example',
  plan: { nom: 'Pro', plafondAgents: 40, plafondTicketsMois: 3000 },
  consommation: { agents: 7, ticketsCeMois: 312 },
};

/* ------------------------------------------------------------------ Personnel */

const personne = (n: number, prenom: string, nom: string) => ({ id: id('utilisateur', n), prenom, nom });
export const FATOU = personne(1, 'Fatou', 'Diabaté');
export const SERGE = personne(2, 'Serge', 'Kouadio');
export const MARIAM = personne(3, 'Mariam', 'Ouattara');
export const AYA = personne(4, 'Aya', 'Konan');
export const MAMADOU = personne(5, 'Mamadou', 'Traoré');
export const ADJOUA = personne(6, 'Adjoua', "N'Guessan");
export const IBRAHIM = personne(7, 'Ibrahim', 'Coulibaly');
export const ESTELLE = personne(8, 'Estelle', 'Gnahoré');
export const JEAN_MARC = personne(9, 'Jean-Marc', 'Aka');

/** Référence nommée (« Aya Konan ») d'un membre du personnel. */
export const ref = (p: { id: string; prenom: string; nom: string }) => ({ id: p.id, nom: `${p.prenom} ${p.nom}` });

const email = (p: { prenom: string; nom: string }) =>
  `${p.prenom}.${p.nom}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ']/g, '').replace(/\s/g, '') + '@banque-alpha.example';

function utilisateur(
  p: { id: string; prenom: string; nom: string },
  role: S<'RoleUtilisateur'>,
  autres: Partial<S<'Utilisateur'>> = {},
): S<'Utilisateur'> {
  return {
    ...p,
    email: email(p),
    telephone: null,
    role,
    statut: 'ACTIF',
    superviseur: null,
    totpActif: true,
    derniereConnexionLe: null,
    verrouilleJusquA: null,
    // Étape 21 : réclamations non clôturées à son nom (celles de la file des maquettes)
    reclamationsEnCours: 0,
    ...autres,
  };
}

export const PERSONNEL: S<'Utilisateur'>[] = [
  utilisateur(FATOU, 'ADMIN_ENTREPRISE', { derniereConnexionLe: t('25/09 08:05'), telephone: '+2250701020304' }),
  utilisateur(SERGE, 'SUPERVISEUR', { derniereConnexionLe: t('25/09 07:52') }),
  utilisateur(MARIAM, 'SUPERVISEUR', { derniereConnexionLe: t('25/09 08:11') }),
  utilisateur(AYA, 'AGENT', { superviseur: ref(SERGE), derniereConnexionLe: t('25/09 07:58'), reclamationsEnCours: 5 }),
  utilisateur(MAMADOU, 'AGENT', { superviseur: ref(SERGE), derniereConnexionLe: t('24/09 17:20'), verrouilleJusquA: t('25/09 15:22'), reclamationsEnCours: 2 }),
  utilisateur(ADJOUA, 'AGENT', { superviseur: ref(SERGE), derniereConnexionLe: t('25/09 08:20'), reclamationsEnCours: 2 }),
  utilisateur(IBRAHIM, 'AGENT', { superviseur: ref(MARIAM), derniereConnexionLe: t('25/09 08:03'), totpActif: false, reclamationsEnCours: 2 }),
  utilisateur(ESTELLE, 'AGENT', { superviseur: ref(MARIAM), statut: 'INVITE', totpActif: false }),
  utilisateur(JEAN_MARC, 'AGENT', { superviseur: ref(MARIAM), statut: 'DESACTIVE', derniereConnexionLe: t('31/08 17:02') }),
];

export const PAGE_PERSONNEL: S<'PageUtilisateurs'> = {
  donnees: PERSONNEL,
  pagination: { page: 1, parPage: 50, total: PERSONNEL.length },
};

const banqueDe = { id: id('banque', 1), nom: ALPHA.nom, slug: ALPHA.slug, fuseauHoraire: FUSEAU };

export function moi(p: { id: string; prenom: string; nom: string }, role: S<'RoleUtilisateur'>, totpActif = true): S<'Moi'> {
  return {
    id: p.id, email: email(p), prenom: p.prenom, nom: p.nom, role, banque: role === 'SUPER_ADMIN' ? null : banqueDe,
    // Étape 19 : la Banque Alpha laisse la double authentification facultative ; le Super Admin l'a toujours
    totpActif, totpObligatoire: role === 'SUPER_ADMIN',
  };
}

/* ------------------------------------------------------------------ Attribution (étape 16) */

const membre = (p: { id: string; prenom: string; nom: string }, aTraiter: number, autres: Partial<S<'MembreGroupe'>> = {}): S<'MembreGroupe'> =>
  ({ id: p.id, nom: `${p.prenom} ${p.nom}`, statut: 'ACTIF', absent: false, aTraiter, ...autres });
const AYA_M = membre(AYA, 6);
const MAMADOU_M = membre(MAMADOU, 4);
const ADJOUA_M = membre(ADJOUA, 3, { absent: true });
const IBRAHIM_M = membre(IBRAHIM, 3);
const ESTELLE_M = membre(ESTELLE, 0, { statut: 'INVITE' });

/** Groupes de la Banque Alpha : la carte et la fraude à la monétique, les comptes à un second groupe, Bouaké à son équipe. */
export const GROUPES: S<'GroupeAgents'>[] = [
  { id: id('groupe', 3), nom: 'Agence de Bouaké', membres: [ESTELLE_M, IBRAHIM_M], categories: [categorie(6)], agences: [agence(5)] },
  { id: id('groupe', 2), nom: 'Comptes et crédits', membres: [IBRAHIM_M, MAMADOU_M], categories: [categorie(2), categorie(4), categorie(7)], agences: [] },
  { id: id('groupe', 1), nom: 'Monétique', membres: [ADJOUA_M, AYA_M, MAMADOU_M], categories: [categorie(1), categorie(3), categorie(5)], agences: [] },
];

const groupeDe = (n: number) => ({ id: id('groupe', n), nom: GROUPES.find((g) => g.id === id('groupe', n))!.nom });
const GROUPE_DE_CATEGORIE: Record<number, number | null> = { 1: 1, 2: 2, 3: 1, 4: 2, 5: 1, 6: 3, 7: 2, 8: null };

export const REGLES: S<'ReglesTraitement'> = {
  mode: 'SUGGESTION',
  seuilEscaladeAdminPourcent: 150,
  seuilEscaladeAdminUrgentPourcent: 125,
  categories: CATEGORIES.map((c, i) => ({
    categorie: { id: c.id, nom: c.nom },
    active: c.active,
    groupe: GROUPE_DE_CATEGORIE[i + 1] ? groupeDe(GROUPE_DE_CATEGORIE[i + 1]!) : null,
    seuilEscaladeAdminPourcent: null,
    // La fraude remonte plus vite à l'Admin Entreprise
    seuilEscaladeAdminUrgentPourcent: i + 1 === 5 ? 110 : null,
  })),
  agences: AGENCES.map((a, i) => ({ agence: { id: a.id, nom: a.nom }, active: a.active, groupe: i + 1 === 5 ? groupeDe(3) : null })),
};

/** Agents qu'on peut mettre dans un groupe : rôle Agent, compte non désactivé. */
export const AGENTS_DES_GROUPES = PERSONNEL.filter((u) => u.role === 'AGENT' && u.statut !== 'DESACTIVE')
  .map((u) => ({ id: u.id, nom: `${u.prenom} ${u.nom}`, statut: u.statut }))
  .sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));

export const ABSENCES: S<'Absence'>[] = [
  { id: id('absence', 1), agent: ref(ADJOUA), du: '2026-09-24', au: '2026-09-28', creeLe: t('23/09 16:40'), reclamationsEnCours: 2 },
  { id: id('absence', 2), agent: ref(IBRAHIM), du: '2026-10-12', au: '2026-10-23', creeLe: t('21/09 09:15'), reclamationsEnCours: 2 },
];
