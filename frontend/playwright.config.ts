/**
 * Tests du frontend dans un vrai navigateur (étape 8) : la console et le portail construits pour
 * la production, servis par Vite, branchés sur la vraie API (base jetable reclamations_navigateur,
 * jeu de démonstration). Les liens reçus par e-mail ou SMS sont lus dans la boîte d'envoi.
 *
 *   npm run test:navigateur                  (PostgreSQL et Redis du docker-compose.yml, variables de backend/.env)
 *   docker compose run --rm navigateur       (tout dans des conteneurs)
 */
import { resolve } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// Hors Docker : variables de backend/.env (DATABASE_URL, pour lire la boîte d'envoi), sans écraser
// celles déjà définies
try {
  process.loadEnvFile(resolve(import.meta.dirname, '../backend/.env'));
} catch {
  // pas de backend/.env : variables d'environnement seules
}

const API = process.env.API_NAVIGATEUR ?? 'http://127.0.0.1:3300';
const env = { ...process.env, API_URL: API } as Record<string, string>;

export default defineConfig({
  testDir: './tests/navigateur',
  globalSetup: './tests/navigateur/preparation.ts',
  globalTeardown: './tests/navigateur/fin.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: 0,
  reporter: [['list']],
  outputDir: './test-results',
  use: {
    ...devices['Desktop Chrome'],
    locale: 'fr-FR',
    timezoneId: 'Africa/Abidjan',
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    acceptDownloads: true,
  },
  webServer: [
    {
      command: 'npm run serveur:navigateur',
      cwd: '../backend',
      url: `${API}/api/v1/sante`,
      timeout: 180_000,
      reuseExistingServer: false,
      stdout: 'pipe',
      env,
    },
    {
      command: 'npm run build:console && npx vite preview --mode console --host 127.0.0.1',
      url: 'http://127.0.0.1:4273',
      timeout: 180_000,
      reuseExistingServer: false,
      env,
    },
    {
      command: 'npm run build:portail && npx vite preview --mode portail --host 127.0.0.1',
      url: 'http://127.0.0.1:4274',
      timeout: 180_000,
      reuseExistingServer: false,
      env,
    },
    // Serveurs de développement (npm run dev:console, dev:portail), sur d'autres ports que ceux
    // du docker-compose.yml : 6-developpement.spec.ts vérifie qu'ils chargent les applications
    {
      command: 'npx vite --mode console --host 127.0.0.1 --port 5183',
      url: 'http://127.0.0.1:5183',
      timeout: 120_000,
      reuseExistingServer: false,
      env,
    },
    {
      command: 'npx vite --mode portail --host 127.0.0.1 --port 5184',
      url: 'http://127.0.0.1:5184',
      timeout: 120_000,
      reuseExistingServer: false,
      env,
    },
  ],
});
