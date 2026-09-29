/**
 * Outils partagés par les scripts de vérification (étapes 2 et 3).
 * Ils tournent sur une base JETABLE : son nom doit contenir « verif » ou « test ».
 */
import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';

export function urlBaseJetable(variable: 'DATABASE_URL' | 'APP_DATABASE_URL'): string {
  const url = process.env[variable];
  if (!url) throw new Error(`${variable} manquante`);
  const nomBase = new URL(url).pathname.slice(1);
  if (!/verif|test/i.test(nomBase)) {
    console.error(`Refusé : la base « ${nomBase} » n'a pas l'air jetable (son nom doit contenir « verif » ou « test »).`);
    process.exit(2);
  }
  return url;
}

/**
 * Durée maximale d'une transaction des vérifications. Vider la base (TRUNCATE de 19 tables)
 * peut prendre plus de 15 s sur un poste lent : le défaut de Prisma (5 s) faisait échouer
 * la vérification sans raison liée au code vérifié.
 */
export const DELAI_TRANSACTION_VERIFICATION = 120_000;

/** Client du propriétaire des tables (superutilisateur du conteneur) : prépare les données. */
export function clientProprietaire() {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: urlBaseJetable('DATABASE_URL') }),
    transactionOptions: { maxWait: 30_000, timeout: DELAI_TRANSACTION_VERIFICATION },
  });
}
export type ClientProprietaire = ReturnType<typeof clientProprietaire>;

const TABLES = [
  'journal_audit', 'notification', 'reclamation_evenement', 'piece_jointe', 'commentaire',
  'reclamation', 'compteur_numero', 'code_otp', 'client_final', 'jeton_utilisateur',
  'session_utilisateur', 'utilisateur', 'jour_ferie', 'horaire_ouvre', 'categorie',
  'point_depot', 'agence', 'banque', 'plan',
];

/**
 * Vide toutes les tables. Les tables en écriture seule refusent TRUNCATE : on désactive
 * les triggers le temps de la transaction (réservé à un superutilisateur, base jetable).
 */
export async function viderLaBase(prisma: ClientProprietaire) {
  await prisma.$transaction([
    prisma.$executeRawUnsafe('SET LOCAL session_replication_role = replica'),
    prisma.$executeRawUnsafe(`TRUNCATE ${TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`),
  ]);
}

// ---------------------------------------------------------------------------
//  Compte rendu
// ---------------------------------------------------------------------------

const derniereLigne = (e: unknown) =>
  e instanceof Error ? e.message.split('\n').filter(Boolean).slice(-1)[0] : String(e);

/** Codes portés par une erreur : code Prisma (P2002…) et SQLSTATE PostgreSQL (42501…). */
function codesDe(e: unknown): string[] {
  const err = e as { code?: string; meta?: { driverAdapterError?: { cause?: { originalCode?: string } } } };
  return [err.code, err.meta?.driverAdapterError?.cause?.originalCode].filter((c): c is string => !!c);
}

export class CompteRendu {
  reussis = 0;
  echecs = 0;

  section(titre: string) {
    console.log(`\n${titre}`);
  }

  async doitReussir(libelle: string, fn: () => Promise<unknown>) {
    try {
      await fn();
      this.reussis++;
      console.log(`  ✔ ${libelle}`);
    } catch (e) {
      this.echecs++;
      console.log(`  ✘ ${libelle}\n      ${derniereLigne(e)}`);
    }
  }

  /**
   * `attendu` : un code Prisma (P2002, P2003, P2025), un SQLSTATE PostgreSQL
   * (42501 droits ou RLS, 23514 contrainte CHECK) ou une expression sur le message.
   */
  async doitEtreRefuse(libelle: string, attendu: string | RegExp, fn: () => Promise<unknown>) {
    try {
      await fn();
      this.echecs++;
      console.log(`  ✘ ${libelle} — accepté à tort`);
    } catch (e) {
      const codes = codesDe(e);
      const ok = typeof attendu === 'string' ? codes.includes(attendu) : attendu.test(e instanceof Error ? e.message : String(e));
      if (ok) {
        this.reussis++;
        console.log(`  ✔ ${libelle} — refusé${typeof attendu === 'string' ? ` (${attendu})` : ''}`);
      } else {
        this.echecs++;
        console.log(`  ✘ ${libelle} — erreur inattendue [${codes.join(', ')}] : ${derniereLigne(e)}`);
      }
    }
  }

  terminer() {
    console.log(`\n${this.reussis} vérifications réussies, ${this.echecs} en échec.`);
    if (this.echecs > 0) process.exitCode = 1;
  }
}

// ---------------------------------------------------------------------------
//  Jeu de données : deux banques de test
// ---------------------------------------------------------------------------

export const jeton = () => randomBytes(24).toString('base64url');
export const codePublic = () => randomBytes(6).toString('hex').toUpperCase().slice(0, 10);

export async function creerPlan(prisma: ClientProprietaire) {
  return prisma.plan.create({ data: { code: 'ESSENTIEL', nom: 'Essentiel', plafondAgents: 10, plafondTicketsMois: 500 } });
}

export async function creerBanque(prisma: ClientProprietaire, plan: { id: string }, nom: string, prefixe: string) {
  const banque = await prisma.banque.create({
    data: { nom, slug: prefixe.toLowerCase(), prefixeTickets: prefixe, planId: plan.id },
  });
  const tenantId = banque.id;
  const agence = await prisma.agence.create({ data: { tenantId, code: 'AG01', nom: `${nom} — Plateau`, ville: 'Abidjan' } });
  const pointQr = await prisma.pointDepot.create({
    data: { tenantId, agenceId: agence.id, code: codePublic(), canal: 'QR_CODE', libelle: 'Hall — Plateau' },
  });
  const categorie = await prisma.categorie.create({
    data: { tenantId, nom: 'Carte bancaire', prioriteParDefaut: 'NORMALE', delaiCibleMinutes: 16 * 60 },
  });
  await prisma.horaireOuvre.createMany({
    data: [1, 2, 3, 4, 5].flatMap((jourSemaine) => [
      { tenantId, jourSemaine, debutMinute: 8 * 60, finMinute: 12 * 60 },
      { tenantId, jourSemaine, debutMinute: 14 * 60, finMinute: 17 * 60 + 30 },
    ]),
  });
  await prisma.jourFerie.create({ data: { tenantId, date: new Date('2026-08-07'), libelle: "Fête de l'Indépendance", recurrent: true } });
  const domaine = `${prefixe.toLowerCase()}.test`;
  const admin = await prisma.utilisateur.create({
    data: { tenantId, role: 'ADMIN_ENTREPRISE', statut: 'ACTIF', email: `admin@${domaine}`, nom: 'Admin', prenom: prefixe },
  });
  const superviseur = await prisma.utilisateur.create({
    data: { tenantId, role: 'SUPERVISEUR', statut: 'ACTIF', email: `sup@${domaine}`, nom: 'Superviseur', prenom: prefixe },
  });
  const agent = await prisma.utilisateur.create({
    data: {
      tenantId, role: 'AGENT', statut: 'ACTIF', email: `agent@${domaine}`, nom: 'Agent', prenom: prefixe,
      superviseurId: superviseur.id, motDePasseHash: '$argon2id$v=19$m=65536,t=3,p=4$exemple$exemple',
    },
  });
  const client = await prisma.clientFinal.create({
    data: { tenantId, nom: 'Awa Koné', email: 'awa.kone@exemple.ci', telephone: '+2250700000001' },
  });
  return { banque, tenantId, agence, pointQr, categorie, admin, superviseur, agent, client };
}
export type BanqueDeTest = Awaited<ReturnType<typeof creerBanque>>;

export function donneesReclamation(b: BanqueDeTest, numero: string) {
  return {
    tenantId: b.tenantId,
    numero,
    jetonSuivi: jeton(),
    clientId: b.client.id,
    categorieId: b.categorie.id,
    pointDepotId: b.pointQr.id,
    agenceId: b.agence.id,
    canal: 'QR_CODE' as const,
    description: 'Carte avalée par le distributeur.',
    priorite: 'NORMALE' as const,
    // Même horloge que les jalons posés ensuite (la base exige jalons >= cree_le)
    creeLe: new Date(),
    consentementLe: new Date(),
    consentementVersion: '2026-09',
    delaiCibleMinutes: b.categorie.delaiCibleMinutes,
    // Chrono SLA en marche (obligatoire au statut OUVERTE depuis l'étape 4)
    echeanceSlaLe: new Date(Date.now() + 2 * 86_400_000),
    alertePreventiveLe: new Date(Date.now() + 86_400_000),
  };
}

/** Champs d'un ticket pris en charge (statut EN_COURS) par l'agent de la banque. */
export function priseEnCharge(b: BanqueDeTest) {
  return { statut: 'EN_COURS' as const, agentId: b.agent.id, prisEnChargeLe: new Date() };
}
