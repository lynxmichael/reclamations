import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { contratOperations } from './outils/contrat-operations.ts';
import { alias } from './vite.config.ts';

export default defineConfig({
  plugins: [react(), contratOperations()],
  resolve: { alias },
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
    environment: 'node',
  },
});
