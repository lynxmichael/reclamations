/**
 * Paramétrage par l'Admin Entreprise, dans la console : catégories, agences et QR codes,
 * horaires et jours fériés, apparence et logo, invitation d'un agent ; puis ce que voit le client.
 */
import { readFileSync } from 'node:fs';
import { devices, expect, test, type Page } from '@playwright/test';
import { COMPTES, LOGO_SVG, PNG, QR_ALPHA, capture, connecter, portail } from './outils';

test.describe.serial('paramétrage de la Banque Alpha', () => {
  // Une seule connexion pour le groupe : chaque code TOTP ne sert qu'une fois
  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage({ locale: 'fr-FR', timezoneId: 'Africa/Abidjan', viewport: { width: 1440, height: 900 }, acceptDownloads: true });
    await connecter(page, COMPTES.admin);
  });
  test.afterAll(() => page.context().close());

  test('catégories : création, modification, retrait du formulaire client', async () => {
    await page.getByRole('link', { name: 'Catégories et délais' }).click();
    await page.getByRole('button', { name: 'Nouvelle catégorie' }).click();
    await page.getByLabel('Nom').fill('Assurance');
    await page.getByLabel('Heures').fill('24');
    await page.getByLabel('Minutes').fill('00');
    await page.getByRole('button', { name: 'Créer la catégorie' }).click();
    await expect(page.getByText('Catégorie « Assurance » créée')).toBeVisible();
    await expect(page.getByRole('cell', { name: /^Assurance/ })).toBeVisible();

    await page.getByRole('button', { name: 'Modifier Assurance' }).click();
    await page.getByLabel('Nom').fill('Assurance et prévoyance');
    await page.getByLabel('Proposée au client').uncheck();
    await capture(page, '31-categories');
    await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    await expect(page.getByText('Catégorie enregistrée.')).toBeVisible();
    await expect(page.getByRole('row', { name: /Assurance et prévoyance/ })).toContainText('Désactivée');
  });

  test('agences et QR codes : nouvelle agence, nouveau QR code, téléchargement pour l\'impression', async () => {
    await page.getByRole('link', { name: 'Agences et QR codes' }).click();
    await page.getByRole('button', { name: 'Nouvelle agence' }).click();
    await page.getByLabel('Code', { exact: true }).fill('YOP');
    await page.getByLabel('Nom').fill('Yopougon');
    await page.getByLabel('Ville').fill('Abidjan');
    await page.getByRole('button', { name: 'Créer l\'agence' }).click();
    await expect(page.getByText('Agence Yopougon créée.')).toBeVisible();

    await page.getByRole('button', { name: 'Nouveau QR code' }).click();
    await page.getByLabel('Libellé').fill('Yopougon Accueil');
    await page.getByLabel('Agence', { exact: true }).selectOption({ label: 'Yopougon' });
    await page.getByRole('button', { name: 'Créer', exact: true }).click();
    await expect(page.getByText('QR code créé')).toBeVisible();
    await expect(page.getByText('Yopougon Accueil')).toBeVisible();
    await capture(page, '32-agences-qr');

    const telechargement = page.waitForEvent('download');
    await page.getByRole('button', { name: 'QR code PNG de Yopougon Accueil' }).click();
    const qr = await telechargement;
    expect(qr.suggestedFilename()).toMatch(/^qr-[A-Z0-9]+\.png$/);
    expect(readFileSync((await qr.path())!).subarray(0, 8).equals(PNG.subarray(0, 8))).toBe(true);
  });

  test('horaires : le samedi matin ouvert, un jour férié ajouté puis retiré', async () => {
    await page.getByRole('link', { name: 'Horaires et jours fériés' }).click();
    await page.getByRole('button', { name: 'Ajouter une plage le samedi' }).click();
    await page.getByRole('button', { name: 'Enregistrer la semaine' }).click();
    await expect(page.getByText('Semaine enregistrée')).toBeVisible();

    await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
    const fenetre = page.getByRole('dialog', { name: 'Ajouter un jour férié' });
    await fenetre.getByLabel('Date', { exact: true }).fill(`${new Date().getFullYear() + 1}-06-06`);
    await fenetre.getByLabel('Libellé', { exact: true }).fill('Tabaski');
    await fenetre.getByRole('button', { name: 'Ajouter', exact: true }).click();
    await expect(page.getByText('Tabaski ajouté aux jours fériés.')).toBeVisible();
    await capture(page, '33-horaires');
    await page.getByRole('button', { name: 'Supprimer Tabaski' }).click();
    await expect(page.getByText('Tabaski retiré des jours fériés.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Supprimer Tabaski' })).toHaveCount(0);
  });

  test('apparence : nouvelle couleur et logo, aussitôt sur le portail du client', async ({ browser }) => {
    await page.getByRole('link', { name: 'Banque et apparence' }).click();
    await page.getByLabel('Couleur principale').fill('#7A1F5C');
    await page.getByRole('button', { name: 'Enregistrer l\'apparence' }).click();
    await expect(page.getByText('Apparence enregistrée')).toBeVisible();
    await page.getByLabel('Fichier du logo').setInputFiles({ name: 'logo.svg', mimeType: 'image/svg+xml', buffer: LOGO_SVG });
    await expect(page.getByText('Logo enregistré.')).toBeVisible();
    await expect(page.getByRole('img', { name: 'Banque Alpha' }).first()).toBeVisible();
    await capture(page, '34-apparence');

    const client = await (await browser.newContext({ ...devices['Pixel 7'] })).newPage();
    await client.goto(`${portail('alpha')}/d/${QR_ALPHA}`);
    const logo = client.getByRole('img', { name: 'Banque Alpha' });
    await expect(logo).toBeVisible();
    // L'image est vraiment chargée (et non un lien cassé)
    await expect.poll(() => logo.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth)).toBeGreaterThan(0);
    const fond = await client.locator('header').first().evaluate((e) => getComputedStyle(e).backgroundColor);
    expect(fond).toBe('rgb(122, 31, 92)');
    // La catégorie retirée n'est plus proposée
    await expect(client.getByText('Assurance et prévoyance')).toHaveCount(0);
    await client.context().close();
  });

  test('personnel : invitation d\'un agent rattaché à un superviseur', async () => {
    await page.getByRole('link', { name: 'Personnel' }).click();
    await page.getByRole('button', { name: 'Inviter une personne' }).click();
    await page.getByLabel('Prénom').fill('Ali');
    await page.getByLabel('Nom', { exact: true }).fill('Koné');
    await page.getByLabel('E-mail professionnel').fill('ali.kone@banque-alpha.example');
    await page.getByRole('combobox', { name: 'Superviseur' }).selectOption({ label: 'Serge Kouadio' });
    await page.getByRole('button', { name: 'Envoyer l\'invitation' }).click();
    await expect(page.getByText('Invitation envoyée à ali.kone@banque-alpha.example.')).toBeVisible();
    await expect(page.getByRole('row', { name: /Ali Koné/ })).toContainText('Invitation envoyée');
    await capture(page, '35-personnel');
  });
});
