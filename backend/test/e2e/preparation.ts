/**
 * Préparation des tests de bout en bout (une fois) : base jetable neuve, Redis de test vidé,
 * jeu de démonstration des deux banques.
 */
import { rmSync } from 'node:fs';
import { Redis } from 'ioredis';
import type { TestProject } from 'vitest/node';
import { recreerBaseE2E, urlsE2E } from '../../scripts/base-de-test.js';
import { semer } from '../../scripts/jeu-de-donnees.js';
import { lireConfiguration } from '../../src/configuration/configuration.js';
import { BaseDonnees } from '../../src/infrastructure/base-de-donnees/base-de-donnees.service.js';
import { demarrerClamavSimule } from '../outils/clamav-simule.js';
import { FICHIER_COUVERTURE, redisE2E } from './environnement.js';

export default async function preparer(projet: TestProject) {
  const urls = urlsE2E();
  await recreerBaseE2E(urls.proprietaire);
  const redis = new Redis(redisE2E());
  await redis.flushdb();
  await redis.quit();
  rmSync(FICHIER_COUVERTURE, { force: true });

  const config = lireConfiguration({ ...process.env, APP_DATABASE_URL: urls.application, REDIS_URL: redisE2E() });
  const bd = new BaseDonnees(urls.application);
  const jeu = await semer(bd, { cleTotp: config.cleTotp });
  await bd.fermer();
  projet.provide('jeu', JSON.stringify(jeu));
  // Étape 22 : un ClamAV simulé pour toute la suite, arrêté à la fin
  const clamav = await demarrerClamavSimule();
  projet.provide('clamav', clamav.port);
  return () => clamav.fermer();
}

declare module 'vitest' {
  export interface ProvidedContext {
    jeu: string;
    clamav: number;
  }
}
