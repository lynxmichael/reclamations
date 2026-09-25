import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // Les tests du domaine sont purs : aucune base, aucun réseau
    reporters: ['default'],
  },
});
