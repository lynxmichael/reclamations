/**
 * Jeu de démonstration : deux banques de test (critères de recette, §10), leur paramétrage et leur
 * personnel, un Super Admin, et quelques réclamations à différents stades.
 *
 * Les comptes ont tous le mot de passe MOT_DE_PASSE_DEMO et un secret TOTP déterministe :
 * `npm run totp -- <e-mail>` affiche le code du moment. Sur l'environnement de démonstration
 * (étape 10), mot de passe et graine des secrets TOTP sont propres à l'installation
 * (DEMO_MOT_DE_PASSE, DEMO_GRAINE_TOTP : scripts/demonstration.ts).
 *
 * Tout passe par le rôle de l'application en contexte système, avec les mêmes droits que l'API.
 */
import { createHash } from 'node:crypto';
import { DateTime } from 'luxon';
import { base32Encode } from './base32.js';
import { BarometresMensuels, moisEcoule } from '../src/application/barometre/barometres.js';
import { MoteurIa } from '../src/application/ia/moteur.js';
import { CycleDeVie } from '../src/application/reclamations/cycle-de-vie.js';
import { decalerMois } from '../src/domaine/barometre.js';
import { lectureClient } from '../src/application/reclamations/conversations.js';
import { signalerNonRemis } from '../src/application/reclamations/envois.js';
import type { Acteur } from '../src/domaine/reclamation/machine.js';
import { FAQ_EXEMPLE } from '../src/domaine/ia/exemples.js';
import { BaseDonnees } from '../src/infrastructure/base-de-donnees/base-de-donnees.service.js';
import { hacherMotDePasse } from '../src/infrastructure/securite/mots-de-passe.js';
import { chiffrer } from '../src/infrastructure/securite/totp.js';
import { cleCanauxDe } from '../src/configuration/configuration.js';
import { segmentsSms } from '../src/infrastructure/envois/adaptateurs.js';

export const MOT_DE_PASSE_DEMO = 'Makor-Demo-2026';

export const GRAINE_TOTP_DEMO = 'totp-demo';

/** Secret TOTP de démonstration : dérivé de la graine et de l'e-mail (jamais en production réelle). */
export function secretTotpDemo(email: string, graine = GRAINE_TOTP_DEMO): string {
  return base32Encode(createHash('sha256').update(`${graine}:${email}`).digest().subarray(0, 20));
}

interface Personne { prenom: string; nom: string; role: 'SUPER_ADMIN' | 'ADMIN_ENTREPRISE' | 'SUPERVISEUR' | 'AGENT'; superviseur?: string; statut?: 'ACTIF' | 'INVITE' | 'DESACTIVE' }

const email = (p: { prenom: string; nom: string }, domaine: string) =>
  `${p.prenom}.${p.nom}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ']/g, '').replace(/\s/g, '') + `@${domaine}`;

const CATEGORIES = [
  ['Carte bancaire', 'Carte bloquée, retrait non abouti, opération inconnue', 'NORMALE', 960],
  ['Virement et transfert', 'Virement non reçu, en retard ou vers un mauvais bénéficiaire', 'NORMALE', 1440],
  ['Banque mobile', 'Accès à l\'application, code secret, paiement mobile', 'NORMALE', 480],
  ['Frais et prélèvements', 'Frais contestés, prélèvement non autorisé', 'NORMALE', 2400],
  ['Fraude suspectée', 'Une opération que vous n\'avez pas faite', 'URGENTE', 240],
  ['Accueil en agence', 'Temps d\'attente, qualité du service reçu', 'NORMALE', 2400],
  ['Crédit', 'Échéance, remboursement anticipé, suivi de dossier', 'NORMALE', 3600],
] as const;

const FERIES = [
  ['2026-01-01', 'Jour de l\'an'], ['2026-05-01', 'Fête du Travail'], ['2026-08-07', 'Fête de l\'Indépendance'],
  ['2026-08-15', 'Assomption'], ['2026-11-01', 'Toussaint'], ['2026-11-15', 'Journée nationale de la Paix'], ['2026-12-25', 'Noël'],
] as const;

export interface BanqueDemo {
  readonly id: string;
  readonly slug: string;
  readonly points: { readonly qr: string; readonly lien: string };
  readonly comptes: Record<string, { id: string; email: string; role: string }>;
  readonly categories: Record<string, string>;
  readonly agences: Record<string, string>;
}

/** WhatsApp et SMS entrant de la Banque Alpha (étape 20) */
export const CANAUX_DEMO = {
  whatsapp: { identifiant: '109876543210987', compte: '209876543210987', numero: '+2252722000000', jeton: 'jeton-de-demonstration-whatsapp-alpha', point: 'WHATSAPP2A' },
  sms: { numero: '+2252722000001', point: 'SMSALPHA2B' },
} as const;

export interface JeuDemo {
  readonly superAdmin: { id: string; email: string };
  readonly alpha: BanqueDemo;
  readonly horizon: BanqueDemo;
}

export interface OptionsSemis {
  readonly cleTotp: Buffer;
  /** Réclamations d'exemple (dépôts, prise en charge, résolution) ; non par défaut dans les tests */
  readonly reclamations?: boolean;
  /**
   * Étape 9 : historique de la Banque Alpha sur ce nombre de jours (tableau de bord, exports,
   * facturation SMS), traité de bout en bout par le cycle de vie ; non par défaut dans les tests
   */
  readonly historique?: number;
  /**
   * Étape 15 : enquêtes de satisfaction activées pour la Banque Alpha (pas pour Horizon) ; dans
   * l'historique, un client sur deux environ répond après la confirmation. Non par défaut dans les tests
   */
  readonly enquetes?: boolean;
  /**
   * Étape 16 : attribution automatique ouverte pour la Banque Alpha, en mode suggestion, avec trois
   * groupes d'agents, des seuils d'escalade et une absence à venir. Non par défaut dans les tests
   */
  readonly attribution?: boolean;
  /**
   * Étape 17 : chat web ouvert pour la Banque Alpha ; avec les réclamations d'exemple, deux clients
   * y écrivent (boîte de réception des agents). Non par défaut dans les tests
   */
  readonly chat?: boolean;
  /**
   * Étape 18 : assistant IA ouvert pour la Banque Alpha (avec le chat), base de réponses d'exemple ; avec
   * l'historique, un journal des appels (règles seules) pour l'écran de consommation. Non par défaut dans les tests
   */
  readonly assistant?: boolean;
  /**
   * Étape 20 : WhatsApp et SMS entrant raccordés et ouverts pour la Banque Alpha (avec le chat) ; avec les
   * réclamations d'exemple, un dépôt par WhatsApp et un client qui écrit par SMS. Non par défaut dans les tests
   */
  readonly canaux?: boolean;
  /**
   * Étape 21 : avec les réclamations d'exemple, une saisie au guichet du Plateau et une par téléphone,
   * un doublon possible (Yao Kouassi redépose pour sa carte). Non par défaut dans les tests
   */
  readonly guichet?: boolean;
  /**
   * Étape 21 : Mamadou absent aujourd'hui et demain, ses dossiers « à réassigner » (avec l'attribution).
   * Pour la démonstration seulement : les tests navigateur déclarent eux-mêmes leurs absences
   */
  readonly absenceDuJour?: boolean;
  /**
   * Étape 22 : avec les saisies au guichet, l'accusé de dépôt de Bakary Fofana non remis (téléphone
   * injoignable, d'après la passerelle) et l'alerte des superviseurs. Non par défaut dans les tests
   */
  readonly envois?: boolean;
  /**
   * Étape 23 : baromètre ouvert pour la Banque Alpha ; avec l'historique, les baromètres des deux derniers
   * mois écoulés (analyse par les règles), la première recommandation du plus ancien déjà retenue par
   * l'Admin Entreprise. Non par défaut dans les tests
   */
  readonly barometre?: boolean;
  readonly horloge?: () => Date;
  readonly lienSuivi?: (slug: string, jeton: string) => string;
  /** Environnement de démonstration : mot de passe et graine TOTP propres à l'installation */
  readonly motDePasse?: string;
  readonly graineTotp?: string;
}

export async function semer(bd: BaseDonnees, o: OptionsSemis): Promise<JeuDemo> {
  const hash = await hacherMotDePasse(o.motDePasse ?? MOT_DE_PASSE_DEMO);
  const maintenant = o.horloge?.() ?? new Date();

  const creerCompte = async (p: Personne, tenantId: string | null, domaine: string, superviseurId: string | null) => {
    const adresse = email(p, domaine);
    const actif = (p.statut ?? 'ACTIF') !== 'INVITE';
    return bd.enSysteme((tx) => tx.utilisateur.create({
      data: {
        tenantId, role: p.role, statut: p.statut ?? 'ACTIF', email: adresse, nom: p.nom, prenom: p.prenom, superviseurId,
        motDePasseHash: actif ? hash : null,
        totpSecretChiffre: actif ? chiffrer(o.cleTotp, secretTotpDemo(adresse, o.graineTotp)) : null,
        totpActiveLe: actif ? maintenant : null,
        desactiveLe: p.statut === 'DESACTIVE' ? maintenant : null,
      },
      select: { id: true, email: true, role: true },
    }));
  };

  const plan = await bd.enSysteme((tx) => tx.plan.upsert({
    where: { code: 'PRO' }, update: {},
    create: { code: 'PRO', nom: 'Pro', description: '40 agents, 3 000 réclamations par mois', plafondAgents: 40, plafondTicketsMois: 3000 },
  }));
  await bd.enSysteme((tx) => tx.plan.upsert({
    where: { code: 'ESSENTIEL' }, update: {},
    create: { code: 'ESSENTIEL', nom: 'Essentiel', description: '10 agents, 500 réclamations par mois', plafondAgents: 10, plafondTicketsMois: 500 },
  }));
  const sa = await creerCompte({ prenom: 'Koffi', nom: 'Admin', role: 'SUPER_ADMIN' }, null, 'makortelecoms.example', null);

  const banque = async (nom: string, slug: string, prefixe: string, couleurs: [string, string], domaine: string, equipe: Personne[], codes: { qr: string; lien: string }): Promise<BanqueDemo> => {
    const b = await bd.enSysteme((tx) => tx.banque.create({
      data: {
        nom, slug, prefixeTickets: prefixe, planId: plan.id, couleurPrimaire: couleurs[0], couleurSecondaire: couleurs[1], emailContact: `reclamations@${domaine}`,
        enqueteSatisfaction: (o.enquetes ?? false) && slug === 'alpha',
      },
    }));
    const categories: Record<string, string> = {};
    const agences: Record<string, string> = {};
    await bd.enSysteme(async (tx) => {
      for (const [i, [nomC, desc, prio, delai]] of CATEGORIES.entries()) {
        categories[nomC] = (await tx.categorie.create({ data: { tenantId: b.id, nom: nomC, description: desc, prioriteParDefaut: prio, delaiCibleMinutes: delai, ordre: i + 1 } })).id;
      }
      for (const [code, nomA, ville] of [['AG01', 'Plateau', 'Abidjan'], ['AG02', 'Cocody Angré', 'Abidjan'], ['AG03', 'Bouaké Commerce', 'Bouaké']]) {
        agences[nomA] = (await tx.agence.create({ data: { tenantId: b.id, code, nom: nomA, ville } })).id;
      }
      await tx.pointDepot.create({ data: { tenantId: b.id, agenceId: agences.Plateau, code: codes.qr, canal: 'QR_CODE', libelle: 'Hall d\'accueil' } });
      await tx.pointDepot.create({ data: { tenantId: b.id, code: codes.lien, canal: 'LIEN_WEB', libelle: 'Site web, page Contact' } });
      await tx.horaireOuvre.createMany({
        data: [1, 2, 3, 4, 5].flatMap((j) => [{ tenantId: b.id, jourSemaine: j, debutMinute: 480, finMinute: 720 }, { tenantId: b.id, jourSemaine: j, debutMinute: 840, finMinute: 1050 }]),
      });
      await tx.jourFerie.createMany({ data: FERIES.map(([date, libelle]) => ({ tenantId: b.id, date: new Date(`${date}T00:00:00Z`), libelle, recurrent: true })) });
    });
    const comptes: BanqueDemo['comptes'] = {};
    for (const p of equipe) {
      const sup = p.superviseur ? comptes[p.superviseur]?.id ?? null : null;
      comptes[p.prenom.toLowerCase()] = await creerCompte(p, b.id, domaine, sup);
    }
    return { id: b.id, slug, points: codes, comptes, categories, agences };
  };

  const alpha = await banque('Banque Alpha', 'alpha', 'ALP', ['#0B6E5F', '#E3F1ED'], 'banque-alpha.example', [
    { prenom: 'Fatou', nom: 'Diabaté', role: 'ADMIN_ENTREPRISE' },
    { prenom: 'Serge', nom: 'Kouadio', role: 'SUPERVISEUR' },
    { prenom: 'Mariam', nom: 'Ouattara', role: 'SUPERVISEUR' },
    { prenom: 'Aya', nom: 'Konan', role: 'AGENT', superviseur: 'serge' },
    { prenom: 'Mamadou', nom: 'Traoré', role: 'AGENT', superviseur: 'serge' },
    { prenom: 'Ibrahim', nom: 'Coulibaly', role: 'AGENT', superviseur: 'mariam' },
    { prenom: 'Estelle', nom: 'Gnahoré', role: 'AGENT', superviseur: 'mariam', statut: 'INVITE' },
  ], { qr: '7K3QX9P2MA', lien: 'W5Q9HB2MLC' });

  const horizon = await banque('Banque Horizon', 'horizon', 'HOR', ['#E0A526', '#1F2A44'], 'banque-horizon.example', [
    { prenom: 'Awa', nom: 'Bamba', role: 'ADMIN_ENTREPRISE' },
    { prenom: 'Didier', nom: 'Yao', role: 'SUPERVISEUR' },
    { prenom: 'Salif', nom: 'Koné', role: 'AGENT', superviseur: 'didier' },
  ], { qr: 'H7P4XK2RQD', lien: 'H3M9TW6ZLB' });
  // Étape 19 : la Banque Horizon exige la double authentification ; la Banque Alpha la laisse facultative
  // (le réglage par défaut), et tout son personnel de démonstration l'a activée
  await bd.enSysteme((tx) => tx.banque.update({ where: { id: horizon.id }, data: { doubleAuthentificationObligatoire: true } }));

  if (o.historique) await historique(bd, alpha, o, o.historique);
  const exemples = o.reclamations ? await reclamationsExemple(bd, alpha, o) : null;
  // Après l'historique, qui reste assigné à la main comme en phase 1
  if (o.attribution) await attributionAlpha(bd, alpha, maintenant);
  if (o.chat) await chatAlpha(bd, alpha, o, exemples);
  if (o.chat && o.assistant) await assistantAlpha(bd, alpha, o, maintenant);
  if (o.chat && o.canaux) await canauxAlpha(bd, alpha, o, exemples);
  if (o.guichet && exemples) await guichetAlpha(bd, alpha, o, exemples, maintenant);
  if (o.guichet && o.envois && exemples) await envoisAlpha(bd, alpha, maintenant);
  if (o.barometre) await barometreAlpha(bd, alpha, o, maintenant);
  return { superAdmin: { id: sa.id, email: sa.email }, alpha, horizon };
}

/**
 * Attribution automatique de la Banque Alpha (étape 16) : la carte et la fraude à la monétique, les
 * comptes et le crédit à un second groupe, l'agence de Bouaké à son équipe. Une réclamation « carte »
 * déposée à Bouaké va donc à un agent des deux groupes à la fois.
 */
async function attributionAlpha(bd: BaseDonnees, alpha: BanqueDemo, maintenant: Date) {
  const c = alpha.comptes;
  await bd.enSysteme((tx) => tx.banque.update({
    where: { id: alpha.id },
    data: { attributionAutomatique: true, modeAttribution: 'SUGGESTION', seuilEscaladeAdminPourcent: 150, seuilEscaladeAdminUrgentPourcent: 125 },
  }));
  await bd.enBanque(alpha.id, async (tx) => {
    const groupe = async (nom: string, membres: string[], categories: string[], agences: string[]) => {
      const g = await tx.groupeAgents.create({ data: { tenantId: alpha.id, nom } });
      await tx.groupeAgentsMembre.createMany({ data: membres.map((m) => ({ tenantId: alpha.id, groupeId: g.id, utilisateurId: c[m]!.id })) });
      await tx.categorie.updateMany({ where: { id: { in: categories.map((n) => alpha.categories[n]!) } }, data: { groupeId: g.id } });
      await tx.agence.updateMany({ where: { id: { in: agences.map((n) => alpha.agences[n]!) } }, data: { groupeId: g.id } });
    };
    await groupe('Monétique', ['aya', 'mamadou'], ['Carte bancaire', 'Banque mobile', 'Fraude suspectée'], []);
    await groupe('Comptes et crédits', ['mamadou', 'ibrahim'], ['Virement et transfert', 'Frais et prélèvements', 'Crédit'], []);
    await groupe('Agence de Bouaké', ['ibrahim', 'aya', 'estelle'], ['Accueil en agence'], ['Bouaké Commerce']);
    // La fraude remonte plus vite à l'Admin Entreprise
    await tx.categorie.update({ where: { id: alpha.categories['Fraude suspectée']! }, data: { seuilEscaladeAdminUrgentPourcent: 110 } });
    const jour = (n: number) => new Date(`${DateTime.fromJSDate(maintenant, { zone: 'Africa/Abidjan' }).plus({ days: n }).toISODate()}T00:00:00Z`);
    await tx.absenceAgent.create({ data: { tenantId: alpha.id, utilisateurId: c.ibrahim!.id, du: jour(7), au: jour(11) } });
  });
}

/** Quelques réclamations de la Banque Alpha, par le service du cycle de vie (étape 4). */
async function reclamationsExemple(bd: BaseDonnees, alpha: BanqueDemo, o: OptionsSemis) {
  const cycle = new CycleDeVie(bd.base, { horloge: o.horloge, lienSuivi: o.lienSuivi ?? ((slug, j) => `https://${slug}.reclamations.example/suivi/${j}`) });
  const qr = await bd.enSysteme((tx) => tx.pointDepot.findUniqueOrThrow({ where: { code: alpha.points.qr } }));
  const agent = (prenom: string): Acteur => ({ type: 'UTILISATEUR', id: alpha.comptes[prenom].id, role: 'AGENT', libelle: prenom });
  const superviseur: Acteur = { type: 'UTILISATEUR', id: alpha.comptes.serge.id, role: 'SUPERVISEUR', libelle: 'Serge Kouadio' };
  const deposer = (categorie: string, description: string, nom: string, telephone: string) => cycle.deposer({
    tenantId: alpha.id, pointDepotId: qr.id, categorieId: alpha.categories[categorie], description,
    client: { nom, telephone, email: null }, consentementVersion: '2026-09',
  });
  const a = await deposer('Carte bancaire', 'Hier soir, j\'ai voulu retirer 50 000 FCFA au distributeur de l\'agence. Il n\'a pas donné les billets, mais mon compte a été débité.', 'Yao Kouassi', '0708091011');
  const b = await deposer('Virement et transfert', 'Mon virement de salaire du 25 n\'apparaît pas sur mon compte.', 'Adjoua Koffi', '0102030405');
  const c = await deposer('Fraude suspectée', 'Deux paiements en ligne que je n\'ai pas faits sont apparus ce matin.', 'Brice Tanoh', '0506070809');
  const d = await deposer('Banque mobile', 'Je n\'arrive plus à me connecter à l\'application depuis la mise à jour.', 'Nadia Sylla', '0748596071');
  await cycle.assigner(alpha.id, a.id, superviseur, alpha.comptes.aya.id);
  await cycle.repondreAuClient(alpha.id, a.id, agent('aya'), 'Bonjour, nous vérifions le journal du distributeur et revenons vers vous dans la journée.');
  await cycle.assigner(alpha.id, c.id, superviseur, alpha.comptes.ibrahim.id);
  await cycle.assigner(alpha.id, d.id, superviseur, alpha.comptes.aya.id);
  await cycle.prendreEnCharge(alpha.id, d.id, agent('aya'));
  await cycle.resoudre(alpha.id, d.id, agent('aya'), 'Nous avons réinitialisé votre accès : reconnectez-vous avec le code reçu par SMS.');
  return { cycle, carte: a.id, fraude: c.id, virement: b.id };
}

/**
 * Chat web de la Banque Alpha (étape 17). Après les réponses d'exemple, deux clients ouvrent le chat
 * et écrivent : la carte (Aya) attend une réponse, la fraude (Ibrahim) deux messages d'affilée.
 */
async function chatAlpha(bd: BaseDonnees, alpha: BanqueDemo, o: OptionsSemis, exemples: Awaited<ReturnType<typeof reclamationsExemple>> | null) {
  await bd.enSysteme((tx) => tx.banque.update({ where: { id: alpha.id }, data: { chatWeb: true } }));
  if (!exemples) return;
  const ecrire = async (id: string, messages: string[]) => {
    const t = await bd.enBanque(alpha.id, (tx) => tx.reclamation.findUniqueOrThrow({ where: { id }, select: { id: true, tenantId: true, clientId: true } }));
    await bd.enBanque(alpha.id, (tx) => lectureClient(tx, t, o.horloge?.() ?? new Date()));
    for (const m of messages) await exemples.cycle.messageDuClient(alpha.id, id, { type: 'CLIENT', clientId: t.clientId }, m);
  };
  await ecrire(exemples.carte, ['Merci. C\'était au distributeur de l\'agence du Plateau, vers 21 h. J\'ai gardé le ticket.']);
  await ecrire(exemples.fraude, ['J\'ai bloqué ma carte depuis l\'application.', 'Faut-il que je passe en agence pour la plainte ?']);
}

/**
 * WhatsApp et SMS entrant de la Banque Alpha (étape 20) : numéros raccordés par Makor (jeton de
 * démonstration chiffré), canaux ouverts. Avec les réclamations d'exemple, Moussa Koné dépose par
 * WhatsApp et y écrit encore, Adjoua Koffi relance son virement par SMS : la boîte de réception montre
 * les deux canaux, et les réponses des agents y partent.
 */
async function canauxAlpha(bd: BaseDonnees, alpha: BanqueDemo, o: OptionsSemis, exemples: Awaited<ReturnType<typeof reclamationsExemple>> | null) {
  const { whatsapp, sms } = CANAUX_DEMO;
  const points = await bd.enSysteme(async (tx) => {
    const wa = await tx.pointDepot.create({ data: { tenantId: alpha.id, code: whatsapp.point, canal: 'WHATSAPP', libelle: 'WhatsApp' } });
    const sm = await tx.pointDepot.create({ data: { tenantId: alpha.id, code: sms.point, canal: 'SMS', libelle: 'SMS' } });
    await tx.canalBanque.create({
      data: {
        tenantId: alpha.id, canal: 'WHATSAPP', identifiant: whatsapp.identifiant, numero: whatsapp.numero, compteWhatsapp: whatsapp.compte,
        jetonChiffre: chiffrer(cleCanauxDe(o.cleTotp), whatsapp.jeton), pointDepotId: wa.id,
      },
    });
    await tx.canalBanque.create({ data: { tenantId: alpha.id, canal: 'SMS', identifiant: sms.numero, numero: sms.numero, pointDepotId: sm.id } });
    await tx.banque.update({ where: { id: alpha.id }, data: { whatsapp: true, smsEntrant: true } });
    return { whatsapp: wa.id };
  });
  if (!exemples) return;
  const depot = await exemples.cycle.deposer({
    tenantId: alpha.id, pointDepotId: points.whatsapp, categorieId: alpha.categories['Frais et prélèvements']!,
    description: 'On m\'a prélevé 15 000 FCFA de frais de tenue de compte deux fois ce mois-ci.',
    client: { nom: 'Moussa Koné', telephone: '+2250707070707' }, consentementVersion: '2026-09',
  });
  const client = (id: string) => bd.enBanque(alpha.id, (tx) => tx.reclamation.findUniqueOrThrow({ where: { id }, select: { clientId: true } }));
  await exemples.cycle.messageDuClient(alpha.id, depot.id, { type: 'CLIENT', clientId: (await client(depot.id)).clientId },
    'Je peux vous envoyer le relevé si besoin.', undefined, undefined, 'WHATSAPP');
  await exemples.cycle.messageDuClient(alpha.id, exemples.virement, { type: 'CLIENT', clientId: (await client(exemples.virement)).clientId },
    'Bonjour, toujours rien sur mon compte ce matin.', undefined, undefined, 'SMS');
}

/**
 * Étape 21 à la Banque Alpha : une réclamation saisie au guichet du Plateau par Aya pour une cliente
 * sans smartphone, une saisie par téléphone par Serge, un doublon possible (Yao Kouassi redépose pour
 * sa carte avalée), et Mamadou absent aujourd'hui et demain (avec l'attribution) : ses dossiers en
 * cours sont dans la file « À réassigner » des superviseurs.
 */
async function guichetAlpha(
  bd: BaseDonnees, alpha: BanqueDemo, o: OptionsSemis, exemples: NonNullable<Awaited<ReturnType<typeof reclamationsExemple>>>, maintenant: Date,
) {
  const c = alpha.comptes;
  const personne = (prenom: string, role: 'AGENT' | 'SUPERVISEUR', nom: string) =>
    ({ type: 'UTILISATEUR' as const, id: c[prenom]!.id, role, libelle: nom });
  const point = async (canal: 'GUICHET' | 'TELEPHONE', agenceId: string | null) => (await bd.enBanque(alpha.id, (tx) => tx.pointDepot.create({
    data: { tenantId: alpha.id, code: canal === 'GUICHET' ? 'GUICHETPLAT' : 'TELEPHONEAL', canal, libelle: canal === 'GUICHET' ? 'Guichet' : 'Téléphone', agenceId },
  }))).id;
  await exemples.cycle.saisir({
    tenantId: alpha.id, pointDepotId: await point('GUICHET', alpha.agences.Plateau!), categorieId: alpha.categories['Frais et prélèvements']!,
    description: 'Cliente venue au guichet : 2 500 FCFA de frais de SMS prélevés chaque mois alors qu\'elle n\'a pas souscrit au service. Elle n\'a pas de smartphone.',
    client: { nom: 'Ahou Kouamé', telephone: '+2250101020304', email: null }, consentementVersion: '2026-09',
  }, { par: personne('aya', 'AGENT', 'Aya Konan'), meLAssigner: true });
  await exemples.cycle.saisir({
    tenantId: alpha.id, pointDepotId: await point('TELEPHONE', null), categorieId: alpha.categories['Virement et transfert']!,
    agenceId: alpha.agences['Cocody Angré'] ?? null,
    description: 'Appel du client : virement de 120 000 FCFA vers sa sœur, envoyé lundi, toujours pas reçu à Cocody.',
    client: { nom: 'Bakary Fofana', telephone: '+2250505060708', email: null }, consentementVersion: '2026-09',
  }, { par: personne('serge', 'SUPERVISEUR', 'Serge Kouadio') });
  // Doublon possible : même client, même catégorie que sa réclamation « carte » en cours
  const qr = await bd.enSysteme((tx) => tx.pointDepot.findUniqueOrThrow({ where: { code: alpha.points.qr } }));
  await exemples.cycle.deposer({
    tenantId: alpha.id, pointDepotId: qr.id, categorieId: alpha.categories['Carte bancaire']!,
    description: 'Toujours pas de nouvelles pour mes 50 000 FCFA bloqués au distributeur du Plateau, je redépose ma réclamation.',
    client: { nom: 'Yao Kouassi', telephone: '0708091011', email: null }, consentementVersion: '2026-09',
  });
  if (o.attribution && o.absenceDuJour) {
    const jour = (n: number) => new Date(`${DateTime.fromJSDate(maintenant, { zone: 'Africa/Abidjan' }).plus({ days: n }).toISODate()}T00:00:00Z`);
    await bd.enBanque(alpha.id, (tx) => tx.absenceAgent.create({ data: { tenantId: alpha.id, utilisateurId: c.mamadou!.id, du: jour(0), au: jour(1) } }));
  }
}

/**
 * Envois non remis (étape 22) : la passerelle a signalé l'accusé de dépôt de Bakary Fofana (saisi par
 * téléphone, à personne) non remis ; les superviseurs sont prévenus, la fiche propose de le renvoyer.
 */
async function envoisAlpha(bd: BaseDonnees, alpha: BanqueDemo, maintenant: Date) {
  const n = await bd.enSysteme(async (tx) => {
    const sms = await tx.notification.findFirstOrThrow({
      where: { tenantId: alpha.id, modele: 'client.depot', canal: 'SMS', destination: '+2250505060708' },
    });
    return tx.notification.update({
      where: { id: sms.id },
      data: {
        statut: 'ECHEC', tentatives: 1, envoyeeLe: maintenant, segmentsSms: 1, motifEchec: 'INJOIGNABLE',
        idFournisseur: 'demo-dlr-0001', derniereErreur: 'Accusé de remise : NON_REMIS (démonstration)',
      },
    });
  });
  await signalerNonRemis(bd, { ...n, motifEchec: 'INJOIGNABLE' }, maintenant);
}

/**
 * Assistant IA de la Banque Alpha (étape 18) : base de réponses d'exemple ; avec l'historique, les
 * tours de l'assistant et les brouillons des derniers jours, journalisés sans contenu, réponses par
 * les règles (aucun fournisseur d'IA n'est configuré en démonstration).
 */
async function assistantAlpha(bd: BaseDonnees, alpha: BanqueDemo, o: OptionsSemis, maintenant: Date) {
  await bd.enSysteme((tx) => tx.banque.update({ where: { id: alpha.id }, data: { assistantIa: true } }));
  await bd.enBanque(alpha.id, (tx) => tx.reponseAssistant.createMany({
    data: FAQ_EXEMPLE.map((f, i) => ({ tenantId: alpha.id, question: f.question, reponse: f.reponse, ordre: (i + 1) * 10 })),
  }));
  if (!o.historique) return;
  const hasard = aleatoire(18);
  const jours = Math.min(o.historique, 14);
  const lignes: { tenantId: string; finalite: 'ACCUEIL_PORTAIL' | 'SUGGESTION_AGENT'; fournisseur: string; issue: 'REGLES'; dureeMs: number; creeLe: Date }[] = [];
  for (let j = jours; j >= 1; j--) {
    const jour = DateTime.fromJSDate(maintenant).minus({ days: j }).startOf('day');
    const tours = 15 + Math.floor(hasard() * 25);
    const brouillons = 2 + Math.floor(hasard() * 5);
    for (let n = 0; n < tours + brouillons; n++) {
      lignes.push({
        tenantId: alpha.id, finalite: n < tours ? 'ACCUEIL_PORTAIL' : 'SUGGESTION_AGENT', fournisseur: 'regles', issue: 'REGLES',
        dureeMs: 1 + Math.floor(hasard() * 4), creeLe: jour.plus({ minutes: 8 * 60 + Math.floor(hasard() * 9 * 60) }).toJSDate(),
      });
    }
  }
  await bd.enBanque(alpha.id, (tx) => tx.appelIa.createMany({ data: lignes }));
}

/**
 * Baromètre de la Banque Alpha (étape 23) : ouvert par Makor ; les deux derniers mois écoulés publiés
 * comme le ferait le worker, par les règles (sans fournisseur d'IA), avec leur notification.
 */
async function barometreAlpha(bd: BaseDonnees, alpha: BanqueDemo, o: OptionsSemis, maintenant: Date) {
  await bd.enSysteme((tx) => tx.banque.update({ where: { id: alpha.id }, data: { barometre: true } }));
  if (!o.historique) return;
  const barometres = new BarometresMensuels(bd, new MoteurIa(bd, { fournisseur: 'regles', plafondJour: 0 }, null, () => maintenant), () => maintenant);
  const dernier = moisEcoule(maintenant, 'Africa/Abidjan');
  for (const mois of [decalerMois(dernier, -1), dernier]) await barometres.generer(alpha.id, mois);
  // Fatou a déjà retenu la première recommandation du mois le plus ancien
  await bd.enBanque(alpha.id, async (tx) => {
    const premiere = await tx.recommandationBarometre.findFirst({
      where: { barometre: { mois: new Date(`${decalerMois(dernier, -1)}-01T00:00:00Z`) } }, orderBy: { ordre: 'asc' }, select: { id: true },
    });
    if (premiere) {
      await tx.recommandationBarometre.update({
        where: { id: premiere.id },
        data: { decision: 'RETENUE', commentaire: 'Point chaque lundi avec l\'équipe concernée.', decideeParId: alpha.comptes.fatou!.id, decideeLe: maintenant },
      });
    }
  });
}

// ---- Historique (étape 9) ---------------------------------------------------------------------

/** Générateur pseudo-aléatoire déterministe (mulberry32) : le même historique à chaque semis. */
function aleatoire(graine: number): () => number {
  let a = graine >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** Commentaires des enquêtes simulées, selon la note donnée. */
const COMMENTAIRES: Record<'positif' | 'mitige' | 'negatif', readonly string[]> = {
  positif: [
    'Traitement rapide, merci au conseiller.', 'Très satisfait, le conseiller a été clair.', 'Réponse claire et courtoise.',
    'Bon accueil en agence, dossier réglé en deux jours.', 'J\'ai été tenu informé à chaque étape, merci.',
  ],
  mitige: [
    'Bonne prise en charge, mais j\'ai dû relancer une fois.', 'Le délai était trop long pour un simple virement.',
    'Problème réglé, mais personne ne m\'a prévenu de l\'avancement.', 'Les frais ont été remboursés, mais il a fallu insister.',
  ],
  negatif: [
    'Le délai était trop long pour un simple virement.', 'On ne m\'a pas expliqué pourquoi l\'opération avait été bloquée.',
    'Trois semaines d\'attente pour ma carte, sans aucune nouvelle.', 'Le distributeur a avalé ma carte et personne ne rappelle.',
    'Frais prélevés deux fois, toujours pas remboursés.',
  ],
};

/** Avis simulé : plutôt satisfait, la recommandation suit la note ; un commentaire une fois sur quatre, accordé à la note. */
function avisSimule(hasard: () => number): { note: number; recommandation: number; commentaire: string | null } {
  const r = hasard();
  const note = r < 0.06 ? 1 : r < 0.14 ? 2 : r < 0.28 ? 3 : r < 0.62 ? 4 : 5;
  const base = [0, 2, 4, 6, 8, 9][note]!;
  const recommandation = Math.min(10, Math.max(0, base + Math.floor(hasard() * 3) - (note >= 4 ? 0 : 1)));
  const ton = COMMENTAIRES[note >= 4 ? 'positif' : note === 3 ? 'mitige' : 'negatif'];
  const commentaire = hasard() < 0.25 ? ton[Math.floor(hasard() * ton.length)]! : null;
  return { note, recommandation, commentaire };
}

const PRENOMS = ['Kouadio', 'Adjoua', 'Mamadou', 'Awa', 'Yao', 'Aminata', 'Koffi', 'Mariam', 'Sékou', 'Affoué', 'Brice', 'Nadia', 'Ibrahim', 'Grâce', 'Serge', 'Fanta'];
const NOMS = ['Kouassi', 'Koné', 'Traoré', 'Bamba', 'Yao', 'Diabaté', 'N\'Guessan', 'Ouattara', 'Coulibaly', 'Touré', 'Kra', 'Aka', 'Sylla', 'Tanoh', 'Gbagbo', 'Diomandé'];
const HEURE = 3_600_000;
const JOUR = 24 * HEURE;

/**
 * Réclamations de la Banque Alpha sur les `jours` derniers jours, chacune menée par le vrai cycle
 * de vie à des instants simulés : dépôt (QR code du Plateau ou lien web, agence au choix), assignation,
 * première réponse, parfois une question au client ou une escalade, résolution, puis confirmation
 * du client (ou contestation et nouvelle résolution). Les plus récentes restent en cours.
 * Les notifications de cet historique sont marquées envoyées (et lues) : le worker ne les envoie pas.
 */
async function historique(bd: BaseDonnees, alpha: BanqueDemo, o: OptionsSemis, jours: number) {
  const debutSemis = await bd.enSysteme(async (tx) => (await tx.$queryRaw<{ t: Date }[]>`SELECT clock_timestamp() AS t`)[0]!.t);
  let horloge = new Date();
  const fin = o.horloge?.() ?? new Date();
  const cycle = new CycleDeVie(bd.base, { horloge: () => horloge, lienSuivi: o.lienSuivi ?? ((slug, j) => `https://${slug}.reclamations.example/suivi/${j}`) });
  const hasard = aleatoire(20260929);
  const choisir = <T>(liste: readonly T[]): T => liste[Math.floor(hasard() * liste.length)]!;
  const [qr, lien] = await bd.enSysteme((tx) => Promise.all([
    tx.pointDepot.findUniqueOrThrow({ where: { code: alpha.points.qr } }),
    tx.pointDepot.findUniqueOrThrow({ where: { code: alpha.points.lien } }),
  ]));
  const personne = (prenom: string, role: 'AGENT' | 'SUPERVISEUR'): Acteur => ({ type: 'UTILISATEUR', id: alpha.comptes[prenom]!.id, role, libelle: prenom });
  const equipes = [{ agent: 'aya', superviseur: 'serge' }, { agent: 'mamadou', superviseur: 'serge' }, { agent: 'ibrahim', superviseur: 'mariam' }];
  const categories = Object.keys(alpha.categories);
  // Plus de réclamations sur les cartes et les virements que sur le crédit
  const poids = [5, 4, 3, 2, 1, 1, 1];
  const categorie = () => {
    let r = hasard() * poids.reduce((a, b) => a + b, 0);
    for (const [i, p] of poids.entries()) if ((r -= p) < 0) return categories[i]!;
    return categories[0]!;
  };
  const ids: string[] = [];
  let n = 0;
  const debut = Math.floor((fin.getTime() - jours * JOUR) / JOUR) * JOUR;

  for (let jour = debut; jour < fin.getTime() - JOUR; jour += JOUR) {
    const semaine = new Date(jour).getUTCDay();
    const depots = semaine === 0 ? Math.floor(hasard() * 2) : semaine === 6 ? Math.floor(hasard() * 3) : 2 + Math.floor(hasard() * 4);
    for (let k = 0; k < depots; k++) {
      const instant = jour + 7.5 * HEURE + hasard() * 10 * HEURE;
      const age = fin.getTime() - instant;
      // Chaque étape avance l'horloge ; une étape qui tomberait dans le futur n'a pas lieu
      const a = async (delai: number, faire: () => Promise<unknown>) => {
        const t = horloge.getTime() + delai;
        if (t > fin.getTime() - HEURE) return false;
        horloge = new Date(t);
        await faire();
        return true;
      };
      horloge = new Date(instant);
      const parQr = hasard() < 0.6;
      const agence = parQr ? null : choisir([alpha.agences['Cocody Angré']!, alpha.agences['Bouaké Commerce']!, alpha.agences.Plateau!, null]);
      n++;
      const d = await cycle.deposer({
        tenantId: alpha.id, pointDepotId: (parQr ? qr : lien).id, categorieId: alpha.categories[categorie()]!, agenceId: agence,
        description: 'Réclamation de l\'historique de démonstration.',
        client: { nom: `${choisir(PRENOMS)} ${choisir(NOMS)}`, telephone: `07${String(20_000_000 + n).slice(-8)}`, email: hasard() < 0.5 ? `client${n}@exemple.ci` : null },
        consentementVersion: '2026-09',
      });
      ids.push(d.id);
      const { clientId } = await bd.enSysteme((tx) => tx.reclamation.findUniqueOrThrow({ where: { id: d.id }, select: { clientId: true } }));
      const client: Acteur = { type: 'CLIENT', clientId };
      const e = choisir(equipes);
      const agent = personne(e.agent, 'AGENT');

      if (!(await a((0.2 + hasard()) * HEURE, () => cycle.assigner(alpha.id, d.id, personne(e.superviseur, 'SUPERVISEUR'), alpha.comptes[e.agent]!.id)))) continue;
      const question = hasard() < 0.15;
      if (!(await a((0.5 + hasard() * 6) * HEURE, () => cycle.repondreAuClient(alpha.id, d.id, agent, question
        ? 'Pouvez-vous nous préciser la date et le montant de l\'opération ?'
        : 'Nous avons bien reçu votre réclamation et la traitons.', { attendreReponse: question })))) continue;
      if (question && !(await a((3 + hasard() * 20) * HEURE, () => cycle.messageDuClient(alpha.id, d.id, client, 'Voici les précisions demandées.')))) continue;
      if (hasard() < 0.08 && !(await a((1 + hasard() * 4) * HEURE, () => cycle.escalader(alpha.id, d.id, agent, 'Avis du superviseur')))) continue;
      // Les deux derniers jours, une réclamation sur deux est encore en cours
      if (age < 2 * JOUR && hasard() < 0.5) continue;
      if (!(await a((1 + hasard() * 30) * HEURE, () => cycle.resoudre(alpha.id, d.id, agent, 'Votre réclamation est traitée : l\'opération a été régularisée.')))) continue;
      // Au-delà du délai de contestation (5 jours), la réclamation est close
      if (fin.getTime() - horloge.getTime() < 5 * JOUR) continue;
      if (hasard() < 0.08) {
        if (!(await a((5 + hasard() * 24) * HEURE, () => cycle.contester(alpha.id, d.id, client, 'Le problème n\'est pas réglé.')))) continue;
        if (!(await a((2 + hasard() * 20) * HEURE, () => cycle.resoudre(alpha.id, d.id, agent, 'Nous avons corrigé l\'opération restante.')))) continue;
      }
      if (!(await a((2 + hasard() * 60) * HEURE, () => cycle.confirmer(alpha.id, d.id, client)))) continue;
      // Étape 15 : un client sur deux donne son avis dans les deux jours (la réponse du portail, sans le journal)
      if (o.enquetes && hasard() < 0.5) {
        const avis = avisSimule(hasard);
        await a((0.5 + hasard() * 48) * HEURE, () => bd.enBanque(alpha.id, (tx) => tx.enqueteSatisfaction.updateMany({
          where: { reclamationId: d.id, reponduLe: null }, data: { reponduLe: horloge, ...avis },
        })));
      }
    }
  }

  // Notifications de l'historique : déjà envoyées à la date du dépôt (facturation SMS réaliste) et lues
  await bd.enSysteme(async (tx) => {
    await tx.$executeRaw`
      UPDATE notification n SET statut = 'ENVOYEE', envoyee_le = r.cree_le, cree_le = r.cree_le,
             lue_le = CASE WHEN n.canal = 'IN_APP' THEN r.cree_le ELSE NULL END
        FROM reclamation r WHERE n.reclamation_id = r.id AND r.id = ANY(${ids}::uuid[])`;
    const sms = await tx.notification.findMany({ where: { reclamationId: { in: ids }, canal: 'SMS' }, select: { id: true, contenu: true } });
    const parSegments = new Map<number, string[]>();
    for (const m of sms) {
      const s = segmentsSms(m.contenu);
      parSegments.set(s, [...(parSegments.get(s) ?? []), m.id]);
    }
    for (const [segmentsSms, liste] of parSegments) await tx.notification.updateMany({ where: { id: { in: liste } }, data: { segmentsSms } });
    // Alertes de la plateforme nées de l'historique (réclamations urgentes) : envoyées et lues
    await tx.notification.updateMany({
      where: { tenantId: null, creeLe: { gte: debutSemis }, modele: { in: ['plateforme.urgente', 'plateforme.plafond'] } },
      data: { statut: 'ENVOYEE', envoyeeLe: debutSemis, lueLe: debutSemis },
    });
  });
}
