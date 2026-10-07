/**
 * API pour les tests du frontend dans un vrai navigateur (étape 8, Playwright) : base jetable
 * recréée (reclamations_navigateur), jeu de démonstration, Redis base 14 vidée, puis l'API sur le
 * port 3300. Aucun worker : les e-mails et SMS restent dans la boîte d'envoi, où les tests lisent
 * les codes et les liens reçus.
 *
 *   npm run serveur:navigateur        (lancé par frontend/playwright.config.ts)
 *
 * Les liens envoyés pointent vers les applications servies par Vite pendant les tests :
 * portail http://<slug>.localhost:4274, console http://localhost:4273.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Redis } from 'ioredis';
import { creerApplication } from '../src/app.module.js';
import { lireConfiguration, urlPortail } from '../src/configuration/configuration.js';
import { BaseDonnees } from '../src/infrastructure/base-de-donnees/base-de-donnees.service.js';
import { recreerBase, urlsBase } from './base-de-test.js';
import { demarrerClamavSimule } from '../test/outils/clamav-simule.js';
import { semer } from './jeu-de-donnees.js';

export const NOM_BASE_NAVIGATEUR = 'reclamations_navigateur';

async function principal() {
  if (process.env.NODE_ENV === 'production') throw new Error('Serveur de test : refusé en production');
  const urls = urlsBase(NOM_BASE_NAVIGATEUR);
  await recreerBase(urls.proprietaire);

  const redis = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');
  redis.pathname = '/14';
  const r = new Redis(redis.toString());
  await r.flushdb();
  await r.quit();

  // Étape 22 : ClamAV simulé (il trouve le fichier de test EICAR), interrogé comme le vrai
  const clamav = await demarrerClamavSimule();
  const config = lireConfiguration({
    ...process.env,
    NODE_ENV: 'test',
    ANTIVIRUS: 'clamav',
    CLAMAV_HOTE: '127.0.0.1',
    CLAMAV_PORT: String(clamav.port),
    APP_DATABASE_URL: urls.application,
    REDIS_URL: redis.toString(),
    PORT: process.env.PORT_NAVIGATEUR ?? '3300',
    COOKIE_SECURE: 'false',
    STOCKAGE_DOSSIER: mkdtempSync(join(tmpdir(), 'reclamations-navigateur-')),
    URL_PORTAIL: process.env.URL_PORTAIL_NAVIGATEUR ?? 'http://{slug}.localhost:4274',
    URL_CONSOLE: process.env.URL_CONSOLE_NAVIGATEUR ?? 'http://localhost:4273',
    // Étape 20 : les tests simulent Meta et la passerelle SMS avec ces secrets (aucun envoi : pas de worker)
    WHATSAPP_ENVOI: 'journal',
    WHATSAPP_SECRET_APP: 'developpement-whatsapp-secret-0123456789',
    WHATSAPP_JETON_VERIFICATION: 'developpement-verification',
    SMS_ENTRANT_SECRET: 'developpement-sms-entrant-0123456789',
  });
  const bd = new BaseDonnees(urls.application);
  await semer(bd, { cleTotp: config.cleTotp, reclamations: true, historique: 60, enquetes: true, attribution: true, barometre: true, lienSuivi: (slug, jeton) => `${urlPortail(config, slug)}/suivi/${jeton}` });
  await bd.fermer();

  const app = await creerApplication({ configuration: config, journaux: process.env.JOURNAUX_NAVIGATEUR === '1' });
  await app.listen(config.port, '0.0.0.0');
  console.log(`API de test prête sur le port ${config.port} (base ${NOM_BASE_NAVIGATEUR})`);
}

principal().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
