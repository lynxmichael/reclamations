import { defineConfig } from 'vitest/config';
import OrdreAlphabetique from './test/e2e/ordre.ts';

/**
 * Tests de bout en bout : l'API complète sur PostgreSQL et Redis (base jetable recréée),
 * chaque réponse validée contre le contrat. Fichiers exécutés l'un après l'autre.
 */
export default defineConfig({
  test: {
    include: ['test/e2e/**/*.e2e.test.ts'],
    environment: 'node',
    globalSetup: ['test/e2e/preparation.ts'],
    fileParallelism: false,
    // Larges : un poste sous Docker Desktop peut être plusieurs fois plus lent que le serveur
    testTimeout: 180_000,
    hookTimeout: 300_000,
    pool: 'forks',
    sequence: { sequencer: OrdreAlphabetique },
    reporters: ['default'],
  },
});
