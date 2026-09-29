/**
 * Accès contextuel à la base (étape 3).
 *
 * Chaque requête s'exécute dans une transaction qui commence par fixer :
 *   - le rôle PostgreSQL (acces_banque, acces_plateforme ou acces_systeme) ;
 *   - le tenant courant (app.tenant_id), lu par les politiques de Row-Level Security.
 * Les deux réglages sont locaux à la transaction : ils disparaissent au COMMIT et ne
 * peuvent pas « déborder » sur la requête suivante qui réutilise la même connexion.
 *
 * Le rôle de connexion reclamations_app n'a aucun droit propre (NOINHERIT) : une requête
 * qui contourne ce module échoue avec « permission denied » au lieu de fuiter.
 *
 * L'intégration NestJS (contexte de requête, garde d'authentification) arrive à l'étape 7 ;
 * ce module ne dépend d'aucun framework.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client.js';

export type ContexteAcces =
  /** Personnel d'une banque, et portail client (après résolution du point de dépôt ou de l'OTP) */
  | { readonly type: 'banque'; readonly tenantId: string }
  /** Super Admin : toutes les banques, métadonnées seulement (arbitrage 7) */
  | { readonly type: 'plateforme' }
  /** Workers, authentification, résolution d'un QR code ou d'un lien de suivi */
  | { readonly type: 'systeme' };

const ROLES = {
  banque: 'acces_banque',
  plateforme: 'acces_plateforme',
  systeme: 'acces_systeme',
} as const satisfies Record<ContexteAcces['type'], string>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const contexte = {
  banque: (tenantId: string): ContexteAcces => {
    if (!UUID.test(tenantId)) throw new Error(`Identifiant de banque invalide : ${tenantId}`);
    return Object.freeze({ type: 'banque', tenantId });
  },
  plateforme: (): ContexteAcces => Object.freeze({ type: 'plateforme' }),
  systeme: (): ContexteAcces => Object.freeze({ type: 'systeme' }),
};

/**
 * Client de base, connecté avec reclamations_app. Le hash du mot de passe et le secret TOTP
 * sont omis par défaut : seules les requêtes d'authentification les demandent explicitement
 * (omit: { motDePasseHash: false }), en contexte système.
 */
export function creerClientBase(connectionString: string, options: { delaiTransaction?: number } = {}) {
  const timeout = options.delaiTransaction ?? DELAI_TRANSACTION_MS;
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
    omit: { utilisateur: { motDePasseHash: true, totpSecretChiffre: true } },
    // S'applique à toutes les transactions, y compris celles de clientEn() : le défaut de Prisma
    // (5 s) est trop court sur un poste de développement chargé (Docker Desktop).
    transactionOptions: { maxWait: Math.min(timeout, 10_000), timeout },
  });
}

/** Durée maximale d'une transaction de l'API ou du worker ; les scripts de vérification en donnent plus. */
export const DELAI_TRANSACTION_MS = 15_000;

export type ClientBase = ReturnType<typeof creerClientBase>;

/** Client transactionnel reçu par transactionEn(). */
export type ClientTransaction = Parameters<Parameters<ClientBase['$transaction']>[0]>[0];

function reglages(ctx: ContexteAcces) {
  return { role: ROLES[ctx.type], tenant: ctx.type === 'banque' ? ctx.tenantId : '' };
}

/**
 * Client limité à un contexte : chaque opération de modèle (findMany, create, update…)
 * part dans sa propre transaction courte, précédée du réglage du rôle et du tenant.
 * Les requêtes SQL brutes ($queryRaw) ne sont pas couvertes : utiliser transactionEn().
 */
export function clientEn(base: ClientBase, ctx: ContexteAcces) {
  const { role, tenant } = reglages(ctx);
  return base.$extends({
    name: `contexte-${ctx.type}`,
    query: {
      $allModels: {
        async $allOperations({ args, query }) {
          const [, resultat] = await base.$transaction([
            base.$executeRaw`SELECT set_config('role', ${role}, true), set_config('app.tenant_id', ${tenant}, true)`,
            query(args),
          ]);
          return resultat;
        },
      },
    },
  });
}

/**
 * Transaction interactive dans un contexte : pour enchaîner plusieurs écritures
 * atomiquement (dépôt = numéro + client + réclamation + événement + notification)
 * ou pour du SQL brut soumis à la Row-Level Security.
 */
export async function transactionEn<T>(
  base: ClientBase,
  ctx: ContexteAcces,
  travail: (tx: ClientTransaction) => Promise<T>,
  options?: { timeout?: number },
): Promise<T> {
  // Sans délai explicite, celui du client s'applique (creerClientBase)
  return base.$transaction(async (tx) => {
    await basculer(tx, ctx);
    return travail(tx);
  }, options?.timeout ? { timeout: options.timeout } : undefined);
}

/**
 * Change de contexte au milieu d'une transaction, sans la couper. Sert quand une même
 * opération atomique doit écrire hors de la banque : l'alerte urgente au Super Admin
 * (notification de plateforme) part dans la transaction du dépôt, puis on revient.
 */
export async function basculer(tx: ClientTransaction, ctx: ContexteAcces): Promise<void> {
  const { role, tenant } = reglages(ctx);
  await tx.$executeRaw`SELECT set_config('role', ${role}, true), set_config('app.tenant_id', ${tenant}, true)`;
}

/**
 * Plusieurs requêtes d'une même transaction, l'une après l'autre : une connexion PostgreSQL
 * n'exécute qu'une requête à la fois (pg 9 refusera les requêtes simultanées sur un client).
 */
export async function enSerie<T extends readonly unknown[]>(taches: { readonly [K in keyof T]: () => Promise<T[K]> }): Promise<T> {
  const resultats: unknown[] = [];
  for (const tache of taches as readonly (() => Promise<unknown>)[]) resultats.push(await tache());
  return resultats as unknown as T;
}
