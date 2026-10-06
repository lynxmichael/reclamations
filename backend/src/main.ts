/**
 * Point d'entrée de l'API HTTP (décision A8 : même code que le worker, autre point d'entrée).
 */
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { creerApplication } from './app.module.js';
import { lireConfiguration } from './configuration/configuration.js';

async function demarrer() {
  const configuration = lireConfiguration();
  const app = await creerApplication({ configuration });
  await app.listen(configuration.port, '0.0.0.0');
  new Logger('API').log(`API ${configuration.version} à l'écoute sur le port ${configuration.port} — documentation : /api/docs`);
  // Étape 22 : rappel, à chaque démarrage, d'une installation sans antivirus (refusée en production)
  if (configuration.antivirus.mode === 'aucun') new Logger('Antivirus').warn('ANTIVIRUS=aucun : pièces jointes acceptées sans analyse (développement seulement)');
}

demarrer().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
