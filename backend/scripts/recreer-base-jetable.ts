/**
 * Recrée une base jetable et y applique les migrations, sans le moteur de Prisma ; avec --semer, y
 * met aussi le jeu de démonstration (deux banques, une semaine d'historique). Utilisé par la recette
 * automatique (recette/recette.mjs) : vérifications PostgreSQL, essai de sauvegarde.
 *
 *   npx tsx scripts/recreer-base-jetable.ts                          la base de DATABASE_URL
 *   npx tsx scripts/recreer-base-jetable.ts --base reclamations_test_sauvegarde --semer
 *
 * Refuse toute base dont le nom n'est pas celui d'une base jetable (verif, test, e2e, navigateur).
 */
import { recreerBase, urlsBase } from './base-de-test.js';
import { semer } from './jeu-de-donnees.js';
import { lireConfiguration } from '../src/configuration/configuration.js';
import { BaseDonnees } from '../src/infrastructure/base-de-donnees/base-de-donnees.service.js';

async function principal() {
  const args = process.argv.slice(2);
  const i = args.indexOf('--base');
  const urls = i >= 0 && args[i + 1]
    ? urlsBase(args[i + 1]!)
    : { proprietaire: process.env.DATABASE_URL ?? '', application: process.env.APP_DATABASE_URL ?? '' };
  if (!urls.proprietaire) throw new Error('DATABASE_URL manquante');
  await recreerBase(urls.proprietaire);
  const nom = new URL(urls.proprietaire).pathname.slice(1);
  if (!args.includes('--semer')) {
    console.log(`Base « ${nom} » recréée, migrations appliquées.`);
    return;
  }
  const config = lireConfiguration({ ...process.env, APP_DATABASE_URL: urls.application });
  const bd = new BaseDonnees(urls.application);
  try {
    await semer(bd, { cleTotp: config.cleTotp, reclamations: true, historique: 7, enquetes: true, attribution: true, chat: true, assistant: true, canaux: true });
  } finally {
    await bd.fermer();
  }
  console.log(`Base « ${nom} » recréée et semée (jeu de démonstration, une semaine d'historique).`);
}

principal().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
