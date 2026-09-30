/**
 * Reporting (étape 9) : tableau de bord et exports CSV de la banque, activité et facturation SMS
 * de la plateforme. Critère 11 : les listes s'exportent en CSV.
 */
import { readFileSync } from 'node:fs';
import { expect, test, type Download, type Page } from '@playwright/test';
import { COMPTES, capture, connecter } from './outils';

async function texte(d: Download): Promise<string> {
  return readFileSync((await d.path())!, 'utf8');
}

async function telecharger(page: Page, bouton: string): Promise<Download> {
  const attente = page.waitForEvent('download');
  await page.getByRole('button', { name: bouton }).click();
  return attente;
}

test.describe.serial('reporting de la banque', () => {
  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage({ locale: 'fr-FR', timezoneId: 'Africa/Abidjan', viewport: { width: 1440, height: 900 }, acceptDownloads: true });
    await connecter(page, COMPTES.superviseur);
  });
  test.afterAll(() => page.context().close());

  test('tableau de bord : indicateurs, courbe lisible au clavier et en tableau, filtres dans l\'adresse', async () => {
    await page.getByRole('link', { name: 'Tableau de bord' }).click();
    await expect(page.getByRole('heading', { name: 'Tableau de bord' })).toBeVisible();
    await expect(page.getByText('Réclamations reçues')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Évolution' })).toBeVisible();
    await expect(page.getByLabel('Légende')).toContainText('Déposées');
    await capture(page, '01-tableau-de-bord', 9);

    // Clavier : la bulle donne les deux valeurs du jour choisi
    const courbe = page.getByRole('group', { name: /^Évolution par jour/ });
    await courbe.focus();
    await page.keyboard.press('ArrowLeft');
    await expect(courbe.getByRole('status')).toContainText(/déposées/);
    await expect(courbe.getByRole('status')).toContainText(/résolues/);

    // Toutes les valeurs, sans survol
    await capture(page, '02-courbe-bulle', 9);
    await page.getByRole('button', { name: 'Voir le tableau' }).click();
    await expect(page.getByRole('columnheader', { name: 'Jour' })).toBeVisible();
    await page.getByRole('button', { name: 'Voir la courbe' }).click();

    // Période : la courbe passe au mois, le choix reste dans l'adresse
    await page.getByLabel('Période').selectOption('12m');
    await expect(page).toHaveURL(/periode=12m/);
    await expect(page.getByRole('group', { name: /^Évolution par mois/ })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('group', { name: /^Évolution par mois/ })).toBeVisible();
    await page.getByLabel('Période').selectOption('90j');
    await expect(page.getByRole('group', { name: /^Évolution par semaine/ })).toBeVisible();
    await page.getByRole('heading', { name: 'Évolution' }).scrollIntoViewIfNeeded();
    await capture(page, '03-trois-mois-par-semaine', 9);
  });

  test('export CSV du tableau de bord et d\'une file (critère 11)', async () => {
    const d = await telecharger(page, 'Exporter en CSV');
    expect(d.suggestedFilename()).toMatch(/^reclamations-alp-\d{4}-\d{2}-\d{2}\.csv$/);
    const csv = await texte(d);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1).split('\r\n')[0]).toMatch(/^Numéro;Déposée le;Statut;Priorité;Catégorie;Agence;Canal;Agent;/);
    expect(csv.split('\r\n').filter(Boolean).length).toBeGreaterThan(1);

    // Depuis les réclamations : la file et les filtres affichés
    await page.getByRole('link', { name: 'Réclamations' }).click();
    await page.getByRole('tab', { name: /Toutes/ }).click();
    await page.getByLabel('Statut').selectOption('CLOTUREE');
    await expect(page.getByRole('table').getByText('Ouverte')).toHaveCount(0);
    await expect(page.getByRole('table').getByText('Clôturée').first()).toBeVisible();
    await capture(page, '04-file-filtree', 9);
    const filtre = await texte(await telecharger(page, 'Exporter en CSV'));
    const lignes = filtre.slice(1).split('\r\n').filter(Boolean).slice(1);
    expect(lignes.length).toBeGreaterThan(0);
    for (const l of lignes) expect(l.split(';')[2]).toBe('Clôturée');
    await expect(page.getByText('Export CSV téléchargé.').first()).toBeVisible();
  });
});

test('un agent n\'a ni tableau de bord ni export', async ({ page }) => {
  await connecter(page, COMPTES.agent);
  await expect(page.getByRole('link', { name: 'Tableau de bord' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Exporter en CSV' })).toHaveCount(0);
});

test('plateforme : activité des banques et facturation SMS du mois, exportée en CSV', async ({ page }) => {
  await connecter(page, COMPTES.superAdmin);
  await page.getByRole('link', { name: /Activité/ }).click();
  await expect(page.getByRole('heading', { name: 'Activité et SMS' })).toBeVisible();
  await expect(page.getByRole('row', { name: /Banque Alpha/ }).first()).toBeVisible();
  await capture(page, '05-activite-sms', 9);

  const d = await telecharger(page, 'Exporter en CSV');
  expect(d.suggestedFilename()).toMatch(/^facturation-sms-\d{4}-\d{2}\.csv$/);
  const csv = await texte(d);
  expect(csv.slice(1).split('\r\n')[0]).toBe('Banque;SMS envoyés;Segments facturés;Échecs');
  expect(csv).toContain('Banque Alpha;');
  expect(csv).toMatch(/\r\nTotal;\d+;\d+;\d+\r\n$/);

  // Mois précédent : autre période, mêmes banques
  const options = await page.getByLabel('Mois').locator('option').allTextContents();
  await page.getByLabel('Mois').selectOption({ label: options[1]! });
  await expect(page).toHaveURL(/mois=\d{4}-\d{2}/);
  await expect(page.getByRole('heading', { name: `SMS de ${options[1]}` })).toBeVisible();
});
