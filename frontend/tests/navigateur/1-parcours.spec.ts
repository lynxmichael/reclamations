/**
 * Critère de recette 1, dans les vraies interfaces : un client dépose par QR code depuis son
 * téléphone, le superviseur assigne, l'agent traite et résout, le client confirme ; tout est tracé.
 */
import { readFileSync } from 'node:fs';
import { devices, expect, test, type Browser, type Page } from '@playwright/test';
import { COMPTES, PNG, QR_ALPHA, capture, codeOtpRecu, connecter, portail, saisirCode } from './outils';

const TELEPHONE = '07 11 22 33 44';
const TELEPHONE_E164 = '+2250711223344';
const DESCRIPTION = 'Le distributeur de l\'agence ne m\'a pas donné les billets, mais mon compte a été débité de 50 000 FCFA.';

let numero = '';
let lienSuivi = '';

async function telephone(browser: Browser): Promise<Page> {
  const contexte = await browser.newContext({ ...devices['Pixel 7'], locale: 'fr-FR', timezoneId: 'Africa/Abidjan' });
  return contexte.newPage();
}

/** Le client ouvre sa réclamation avec le code reçu par SMS. */
async function ouvrirAvecCode(page: Page) {
  await page.getByRole('button', { name: 'Recevoir un code' }).click();
  await expect(page.getByRole('heading', { name: 'Saisissez le code reçu' })).toBeVisible();
  await saisirCode(page, await codeOtpRecu(TELEPHONE_E164));
  await page.getByRole('button', { name: 'Valider' }).click();
  await expect(page.getByRole('heading', { name: numero })).toBeVisible();
}

test.describe.serial('parcours complet d\'une réclamation', () => {
  test('le client dépose par QR code, avec une photo, et reçoit son numéro', async ({ browser }) => {
    const page = await telephone(browser);
    await page.goto(`${portail('alpha')}/d/${QR_ALPHA}`);
    await expect(page.getByRole('heading', { name: 'Déposer une réclamation' })).toBeVisible();
    await expect(page.getByText(/^Agence /)).toBeVisible();
    await capture(page, '01-depot');

    // Formulaire incomplet : les erreurs de l'API s'affichent sous chaque champ
    await page.getByRole('button', { name: 'Envoyer ma réclamation' }).click();
    await expect(page.getByRole('alert').first()).toBeVisible();
    await capture(page, '02-depot-erreurs');

    await page.getByText('Carte bancaire', { exact: true }).click();
    await page.getByLabel('Votre réclamation').fill(DESCRIPTION);
    await page.locator('input[type=file]').setInputFiles({ name: 'ticket-distributeur.png', mimeType: 'image/png', buffer: PNG });
    await expect(page.getByText('ticket-distributeur.png')).toBeVisible();
    await page.getByLabel('Nom et prénom').fill('Yao Kouassi');
    await page.getByLabel('Téléphone').fill(TELEPHONE);
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Envoyer ma réclamation' }).click();

    await expect(page.getByRole('heading', { name: 'Réclamation envoyée' })).toBeVisible();
    numero = (await page.locator('.select-all').textContent())!.trim();
    expect(numero).toMatch(/^ALP-\d{4}-\d{6}$/);
    await expect(page.getByText('par SMS', { exact: false })).toBeVisible();
    await capture(page, '03-accuse');

    await page.getByRole('button', { name: 'Suivre ma réclamation' }).click();
    await expect(page).toHaveURL(/\/suivi\//);
    lienSuivi = page.url();
    await expect(page.getByRole('heading', { name: numero })).toBeVisible();
    await expect(page.getByText('Réclamation reçue')).toBeVisible();
    // Le suivi public ne montre ni la description ni les coordonnées
    await expect(page.getByText(DESCRIPTION)).toHaveCount(0);
    await capture(page, '04-suivi');

    await ouvrirAvecCode(page);
    await expect(page.getByText(DESCRIPTION)).toBeVisible();
    await expect(page.getByRole('button', { name: /Télécharger ticket-distributeur\.png/ })).toBeVisible();
    await page.context().close();
  });

  test('le superviseur la trouve dans « Reçues » et l\'assigne à une agente', async ({ page }) => {
    await connecter(page, COMPTES.superviseur);
    await expect(page).toHaveURL(/\/reclamations/);
    await expect(page.getByRole('tab', { name: /Reçues/, selected: true })).toBeVisible();
    await capture(page, '10-files-superviseur');
    await page.getByRole('link', { name: numero }).click();
    await expect(page.getByRole('heading', { name: numero })).toBeVisible();
    await page.getByLabel('Agent assigné').selectOption({ label: 'Aya Konan' });
    await expect(page.getByText('Réclamation assignée à Aya Konan.')).toBeVisible();
    await expect(page.getByLabel('Agent assigné')).toHaveValue(/.+/);
  });

  test('l\'agente prend en charge, répond avec une pièce jointe, note, puis résout', async ({ page }) => {
    await connecter(page, COMPTES.agent);
    await expect(page.getByRole('tab', { name: /Mes réclamations/, selected: true })).toBeVisible();
    await page.getByRole('link', { name: numero }).click();
    await expect(page.getByRole('heading', { name: numero })).toBeVisible();

    await page.getByRole('button', { name: 'Prendre en charge' }).click();
    await expect(page.getByText('Réclamation prise en charge : le client est prévenu.')).toBeVisible();
    await expect(page.getByText('En cours', { exact: true }).first()).toBeVisible();

    await page.getByLabel('Réponse au client').fill('Bonjour, nous vérifions le journal du distributeur et revenons vers vous dans la journée.');
    await page.locator('input[type=file]').setInputFiles({ name: 'procedure.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF\n') });
    await page.getByRole('button', { name: 'Envoyer au client' }).click();
    await expect(page.getByText('Réponse envoyée au client.')).toBeVisible();
    await expect(page.getByRole('button', { name: /Télécharger procedure\.pdf/ })).toBeVisible();

    await page.getByRole('tab', { name: 'Note interne' }).click();
    await page.getByLabel('Note interne').fill('Journal du GAB demandé au service monétique.');
    await page.getByRole('button', { name: 'Ajouter la note' }).click();
    await expect(page.getByText('Note interne ajoutée, invisible du client.')).toBeVisible();

    // Une pièce jointe se télécharge depuis la fiche
    const telechargement = page.waitForEvent('download');
    await page.getByRole('button', { name: /Télécharger ticket-distributeur\.png/ }).click();
    const fichier = await telechargement;
    expect(fichier.suggestedFilename()).toBe('ticket-distributeur.png');
    // Les octets reçus sont ceux du fichier déposé par le client
    expect(readFileSync((await fichier.path())!).equals(PNG)).toBe(true);

    await page.getByRole('button', { name: 'Résoudre' }).click();
    await page.getByLabel('Réponse finale au client').fill('Le distributeur n\'a pas délivré les billets. Les 50 000 FCFA ont été recrédités sur votre compte ce jour.');
    await capture(page, '12-resolution');
    await page.getByRole('button', { name: 'Résoudre et envoyer' }).click();
    await expect(page.getByText('Réclamation résolue : le client peut confirmer ou contester.')).toBeVisible();
    await expect(page.getByText('Résolue', { exact: true }).first()).toBeVisible();
    await capture(page, '11-fiche-agent');
  });

  test('le client lit la réponse, sans la note interne, et confirme : la réclamation est clôturée', async ({ browser }) => {
    const page = await telephone(browser);
    await page.goto(lienSuivi);
    await ouvrirAvecCode(page);
    await expect(page.getByText('La banque a résolu votre réclamation')).toBeVisible();
    await expect(page.getByText('Les 50 000 FCFA ont été recrédités', { exact: false })).toBeVisible();
    await expect(page.getByText('Journal du GAB demandé')).toHaveCount(0);
    await capture(page, '05-reponse-client');
    await page.getByRole('button', { name: 'Oui, clôturer ma réclamation' }).click();
    await expect(page.getByText('Merci : votre réclamation est clôturée.')).toBeVisible();
    await expect(page.getByText('Clôturée', { exact: true }).first()).toBeVisible();

    // L'espace client liste ses réclamations ; « Quitter » ferme la session
    await page.getByRole('link', { name: 'Vos réclamations' }).click();
    await expect(page.getByRole('heading', { name: 'Vos réclamations' })).toBeVisible();
    await page.getByRole('button', { name: 'Quitter' }).click();
    await expect(page.getByRole('button', { name: 'Recevoir un code' })).toBeVisible();
    await page.context().close();
  });

  test('l\'Admin Entreprise retrouve toute l\'histoire dans le journal d\'audit, chaîne intacte', async ({ page }) => {
    await connecter(page, COMPTES.admin);
    await page.getByRole('link', { name: 'Journal d\'audit' }).click();
    await expect(page.getByText(/^Journal intact/)).toBeVisible();
    await page.getByLabel('Action').selectOption({ label: 'Confirmation du client' });
    await expect(page.getByRole('cell', { name: /Confirmation du client/ }).first()).toBeVisible();
    await capture(page, '30-audit');
  });
});
