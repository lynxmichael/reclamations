import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
    environment: 'node',
    // Les tests unitaires sont purs : aucune base, aucun réseau (tests de bout en bout : vitest.e2e.config.mts)
    reporters: ['default'],
    // Délais larges : sous Docker Desktop, le code est lu depuis le disque de Windows, et les fichiers
    // tournent en parallèle. Générer les types du contrat y prend 15 s, contre moins d'une seconde ici
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
