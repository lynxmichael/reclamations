import { fileURLToPath } from 'node:url';
import { defineConfig, type PluginOption } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { contratOperations } from './outils/contrat-operations.ts';
import { entetesProduction, rapportsCsp } from './outils/rapports-csp.ts';

const ici = (chemin: string) => fileURLToPath(new URL(chemin, import.meta.url));

/**
 * Alias communs à Vite et Vitest :
 * - @domaine : le code pur du backend (machine d'états, SLA, temps ouvré, coordonnées), réutilisé
 *   tel quel par la démo cliquable ;
 * - luxon : toujours la copie du frontend, même quand l'import vient d'un fichier du backend.
 */
export const alias = {
  '@domaine': ici('../backend/src/domaine'),
  luxon: ici('./node_modules/luxon/src/luxon.js'),
};

/** Adresse de l'API pour le serveur de développement (Docker : http://api:3000). */
const API = process.env.API_URL ?? 'http://localhost:3000';

/**
 * Quatre constructions depuis le même code :
 *   npm run build:portail     → dist/portail   portail client, servi sur <slug>.<domaine> (étape 8)
 *   npm run build:console     → dist/console   console du personnel, servie sur console.<domaine> (étape 8)
 *   npm run build:maquettes   → docs/maquettes/index.html, page unique hors ligne (étape 6)
 *   npm run build:demo        → docs/demo/index.html, démo cliquable hors ligne (étape 6)
 */
export default defineConfig(({ mode, isPreview }) => {
  const application = mode === 'portail' || mode === 'console' ? mode : null;
  const plugins: PluginOption[] = [react(), tailwindcss(), contratOperations()];
  if (!application) plugins.push(viteSingleFile());
  // `vite preview` (tests navigateur) : CSP de production, ressources refusées signalées
  if (application && isPreview) plugins.push(rapportsCsp());

  if (application) {
    return {
      root: ici(`./${application}`),
      base: '/',
      plugins,
      resolve: { alias },
      build: {
        outDir: ici(`./dist/${application}`),
        emptyOutDir: true,
        reportCompressedSize: false,
        sourcemap: false,
        assetsInlineLimit: 0,
      },
      server: {
        host: true,
        port: application === 'console' ? 5173 : 5174,
        strictPort: true,
        proxy: { '/api': { target: API, changeOrigin: false } },
      },
      preview: {
        port: application === 'console' ? 4273 : 4274,
        strictPort: true,
        proxy: { '/api': { target: API, changeOrigin: false } },
        headers: isPreview ? entetesProduction(ici('../docker/caddy/commun.caddy')) : undefined,
      },
    };
  }

  const demo = mode === 'demo';
  return {
    root: demo ? ici('./demo') : ici('.'),
    base: './',
    plugins,
    resolve: { alias },
    build: {
      outDir: demo ? ici('../docs/demo') : ici('../docs/maquettes'),
      emptyOutDir: true,
      reportCompressedSize: false,
    },
    server: { port: 5175 },
  };
});
