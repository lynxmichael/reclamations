import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { contratOperations } from './outils/contrat-operations.ts';

export default defineConfig({
  plugins: [react(), contratOperations()],
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
    environment: 'node',
  },
});
