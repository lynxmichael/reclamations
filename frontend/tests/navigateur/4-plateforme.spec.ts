/**
 * Console de la plateforme (Super Admin) : plans, création d'une banque avec son Admin, suspension
 * (le portail de la banque se ferme) et réactivation, alertes, journal, Super Admins.
 */
import { devices, expect, test, type Page } from '@playwright/test';
import { COMPTES, capture, connecter, portail } from './outils';

test.describe.serial('console de la plateforme', () => {
  // Une seule connexion pour le groupe : chaque code TOTP ne sert qu'une fois
  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage({ locale: 'fr-FR', timezoneId: 'Africa/Abidjan', viewport: { width: 1440, height: 900 }, acceptDownloads: true });
    await connecter(page, COMPTES.superAdmin);
  });
  test.afterAll(() => page.context().close());

  test('plans et nouvelle banque avec son premier Admin Entreprise', async () => {
    await expect(page).toHaveURL(/\/plateforme\/banques/);
    await expect(page.getByText('Banque Horizon')).toBeVisible();

    await page.getByRole('link', { name: 'Plans' }).click();
    await page.getByRole('button', { name: 'Nouveau plan' }).click();
    await page.getByLabel('Code', { exact: true }).fill('PREMIUM');
    await page.getByLabel('Nom').fill('Premium');
    await page.getByLabel('Agents et superviseurs').fill('100');
    await page.getByRole('button', { name: 'Créer le plan' }).click();
    await expect(page.getByText('Plan Premium créé.')).toBeVisible();

    await page.getByRole('link', { name: 'Banques' }).click();
    await page.getByRole('button', { name: 'Nouvelle banque' }).click();
    await page.getByLabel('Nom', { exact: true }).first().fill('Banque Kora');
    await expect(page.getByLabel('Adresse du portail')).toHaveValue('kora');
    await expect(page.getByLabel('Préfixe')).toHaveValue('KOR');
    await page.getByText('Premium', { exact: true }).click();
    await page.getByLabel('Prénom').fill('Nathalie');
    await page.getByLabel('Nom', { exact: true }).last().fill('Yéo');
    await page.getByLabel('E-mail professionnel').fill('nathalie.yeo@banque-kora.example');
    await capture(page, '40-nouvelle-banque');
    await page.getByRole('button', { name: 'Créer la banque et inviter l\'Admin' }).click();
    await expect(page.getByText('Banque Kora créée')).toBeVisible();
    await expect(page.getByRole('row', { name: /Banque Kora/ })).toContainText('Premium');
    await capture(page, '41-banques');
  });

  test('suspension : le portail de la banque se ferme ; réactivation', async ({ browser }) => {
    await page.getByRole('link', { name: 'Banques' }).click();
    await page.getByRole('button', { name: 'Ouvrir Banque Horizon' }).click();
    await page.getByLabel('Motif').fill('Impayé du mois d\'août');
    await page.getByRole('button', { name: 'Suspendre', exact: true }).click();
    await expect(page.getByText('Banque suspendue : son portail et sa console sont fermés.')).toBeVisible();

    const client = await (await browser.newContext({ ...devices['Pixel 7'] })).newPage();
    await client.goto(`${portail('horizon')}/d/H7P4XK2RQD`);
    await expect(client.getByRole('heading', { name: 'Service momentanément fermé' })).toBeVisible();

    await page.getByRole('button', { name: 'Réactiver la banque' }).click();
    await expect(page.getByText('Banque réactivée.')).toBeVisible();
    await client.reload();
    await expect(client.getByRole('heading', { name: 'Déposer une réclamation' })).toBeVisible();
    await client.context().close();
    // Échap ferme le panneau de la banque
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('alertes, journal vérifié par banque, invitation d\'un Super Admin', async () => {
    await page.getByRole('link', { name: /Alertes/ }).click();
    await expect(page.getByRole('heading', { name: 'Alertes' })).toBeVisible();
    await capture(page, '42-alertes');
    const aLire = page.getByRole('button', { name: 'Tout marquer comme lu' });
    if (await aLire.isEnabled()) {
      await aLire.click();
      await expect(aLire).toBeDisabled();
    }

    await page.getByRole('link', { name: 'Journal d\'audit' }).click();
    await page.getByLabel('Banque').selectOption({ label: 'Banque Alpha' });
    await expect(page.getByText('Journal intact : chaîne de Banque Alpha')).toBeVisible();

    await page.getByRole('link', { name: 'Super Admins' }).click();
    await page.getByRole('button', { name: 'Inviter' }).click();
    await page.getByLabel('Prénom').fill('Awa');
    await page.getByLabel('Nom', { exact: true }).fill('Touré');
    await page.getByLabel('E-mail professionnel').fill('awa.toure@makortelecoms.example');
    await page.getByRole('button', { name: 'Envoyer l\'invitation' }).click();
    await expect(page.getByText('Invitation envoyée à awa.toure@makortelecoms.example.')).toBeVisible();
    await expect(page.getByText('Awa Touré')).toBeVisible();
  });
});
