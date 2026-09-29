/**
 * Serveurs de développement (npm run dev:console, dev:portail ; services console et portail du
 * docker-compose.yml) : les applications s'y chargent vraiment. Les autres tests utilisent les
 * applications construites ; un point d'entrée hors de la racine Vite ne casse que ce mode-ci.
 */
import { expect, test } from '@playwright/test';
import { QR_ALPHA } from './outils';

test('serveurs de développement : la console et le portail se chargent, /api relayé', async ({ page }) => {
  const erreurs: string[] = [];
  page.on('pageerror', (e) => erreurs.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('401')) erreurs.push(m.text());
  });

  await page.goto('http://localhost:5183/connexion');
  // Premier chargement : Vite transforme les modules à la demande
  await expect(page.getByLabel('E-mail professionnel')).toBeVisible({ timeout: 30_000 });

  await page.goto(`http://alpha.localhost:5184/d/${QR_ALPHA}`);
  await expect(page.getByRole('heading', { name: 'Déposer une réclamation' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Virement et transfert', { exact: true })).toBeVisible();

  expect(erreurs).toEqual([]);
});
