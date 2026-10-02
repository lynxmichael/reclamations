/**
 * Un passage des tâches planifiées du worker, tout de suite : attribution des réclamations en
 * attente, alertes à 75 %, dépassements et escalade au superviseur, escalade à l'Admin Entreprise,
 * clôtures automatiques. Les mêmes que le worker lance chaque minute (idempotentes).
 *
 *   npx tsx scripts/taches.ts                                  la base de APP_DATABASE_URL
 *   npx tsx scripts/taches.ts --base reclamations_navigateur   une base jetable (tests navigateur)
 *
 * Sert aux tests navigateur (étape 16), qui n'ont pas de worker, et au dépannage.
 */
import { CycleDeVie } from '../src/application/reclamations/cycle-de-vie.js';
import { TachesSla } from '../src/application/reclamations/taches-sla.js';
import { lireConfiguration, urlPortail } from '../src/configuration/configuration.js';
import { BaseDonnees } from '../src/infrastructure/base-de-donnees/base-de-donnees.service.js';
import { urlsBase } from './base-de-test.js';

async function principal() {
  const args = process.argv.slice(2);
  const i = args.indexOf('--base');
  const application = i >= 0 && args[i + 1] ? urlsBase(args[i + 1]!).application : process.env.APP_DATABASE_URL;
  if (!application) throw new Error('APP_DATABASE_URL manquante');
  const config = lireConfiguration({ ...process.env, APP_DATABASE_URL: application });
  const bd = new BaseDonnees(application);
  try {
    const taches = new TachesSla(bd.base, new CycleDeVie(bd.base, { lienSuivi: (slug, jeton) => `${urlPortail(config, slug)}/suivi/${jeton}` }));
    console.log(JSON.stringify(await taches.toutes(new Date())));
  } finally {
    await bd.fermer();
  }
}

principal().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
