/**
 * Jeu de démonstration : deux banques de test (critères de recette, §10), leur paramétrage et leur
 * personnel, un Super Admin, et quelques réclamations à différents stades.
 *
 * Les comptes ont tous le mot de passe MOT_DE_PASSE_DEMO et un secret TOTP déterministe :
 * `npm run totp -- <e-mail>` affiche le code du moment (développement seulement).
 *
 * Tout passe par le rôle de l'application en contexte système, avec les mêmes droits que l'API.
 */
import { createHash } from 'node:crypto';
import { base32Encode } from './base32.js';
import { CycleDeVie } from '../src/application/reclamations/cycle-de-vie.js';
import type { Acteur } from '../src/domaine/reclamation/machine.js';
import { BaseDonnees } from '../src/infrastructure/base-de-donnees/base-de-donnees.service.js';
import { hacherMotDePasse } from '../src/infrastructure/securite/mots-de-passe.js';
import { chiffrer } from '../src/infrastructure/securite/totp.js';

export const MOT_DE_PASSE_DEMO = 'Makor-Demo-2026';

/** Secret TOTP de démonstration : dérivé de l'e-mail (jamais en production). */
export function secretTotpDemo(email: string): string {
  return base32Encode(createHash('sha256').update(`totp-demo:${email}`).digest().subarray(0, 20));
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

export interface JeuDemo {
  readonly superAdmin: { id: string; email: string };
  readonly alpha: BanqueDemo;
  readonly horizon: BanqueDemo;
}

export interface OptionsSemis {
  readonly cleTotp: Buffer;
  /** Réclamations d'exemple (dépôts, prise en charge, résolution) ; non par défaut dans les tests */
  readonly reclamations?: boolean;
  readonly horloge?: () => Date;
  readonly lienSuivi?: (slug: string, jeton: string) => string;
}

export async function semer(bd: BaseDonnees, o: OptionsSemis): Promise<JeuDemo> {
  const hash = await hacherMotDePasse(MOT_DE_PASSE_DEMO);
  const maintenant = o.horloge?.() ?? new Date();

  const creerCompte = async (p: Personne, tenantId: string | null, domaine: string, superviseurId: string | null) => {
    const adresse = email(p, domaine);
    const actif = (p.statut ?? 'ACTIF') !== 'INVITE';
    return bd.enSysteme((tx) => tx.utilisateur.create({
      data: {
        tenantId, role: p.role, statut: p.statut ?? 'ACTIF', email: adresse, nom: p.nom, prenom: p.prenom, superviseurId,
        motDePasseHash: actif ? hash : null,
        totpSecretChiffre: actif ? chiffrer(o.cleTotp, secretTotpDemo(adresse)) : null,
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
      data: { nom, slug, prefixeTickets: prefixe, planId: plan.id, couleurPrimaire: couleurs[0], couleurSecondaire: couleurs[1], emailContact: `reclamations@${domaine}` },
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

  if (o.reclamations) await reclamationsExemple(bd, alpha, o);
  return { superAdmin: { id: sa.id, email: sa.email }, alpha, horizon };
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
  await deposer('Virement et transfert', 'Mon virement de salaire du 25 n\'apparaît pas sur mon compte.', 'Adjoua Koffi', '0102030405');
  const c = await deposer('Fraude suspectée', 'Deux paiements en ligne que je n\'ai pas faits sont apparus ce matin.', 'Brice Tanoh', '0506070809');
  const d = await deposer('Banque mobile', 'Je n\'arrive plus à me connecter à l\'application depuis la mise à jour.', 'Nadia Sylla', '0748596071');
  await cycle.assigner(alpha.id, a.id, superviseur, alpha.comptes.aya.id);
  await cycle.repondreAuClient(alpha.id, a.id, agent('aya'), 'Bonjour, nous vérifions le journal du distributeur et revenons vers vous dans la journée.');
  await cycle.assigner(alpha.id, c.id, superviseur, alpha.comptes.ibrahim.id);
  await cycle.assigner(alpha.id, d.id, superviseur, alpha.comptes.aya.id);
  await cycle.prendreEnCharge(alpha.id, d.id, agent('aya'));
  await cycle.resoudre(alpha.id, d.id, agent('aya'), 'Nous avons réinitialisé votre accès : reconnectez-vous avec le code reçu par SMS.');
}
