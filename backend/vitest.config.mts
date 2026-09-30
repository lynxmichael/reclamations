import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
    environment: 'node',
    // Les tests unitaires sont purs : aucune base, aucun réseau (tests de bout en bout : vitest.e2e.config.mts)
    reporters: ['default'],
  },
});
