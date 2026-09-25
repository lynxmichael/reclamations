import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { contratOperations } from './outils/contrat-operations.ts';

/**
 * Étape 6 : `npm run build:maquettes` produit docs/maquettes/index.html, une page unique
 * (scripts, styles et polices inclus) qui s'ouvre sans serveur ni connexion.
 * À l'étape 8, la même base servira l'application réelle (build classique, sans singlefile).
 */
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss(), contratOperations(), viteSingleFile()],
  build: {
    outDir: '../docs/maquettes',
    emptyOutDir: true,
    reportCompressedSize: false,
  },
  server: { port: 5173 },
});
