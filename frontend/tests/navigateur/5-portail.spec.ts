/**
 * Portail client, cas complémentaires : dépôt avec un e-mail seulement (code reçu par e-mail),
 * message du client avec une pièce jointe, contestation qui rouvre la réclamation, QR code inconnu.
 */
import { devices, expect, test, type Browser, type Page } from '@playwright/test';
import { COMPTES, QR_ALPHA, capture, connecter, dernierMessage, portail, saisirCode } from './outils';

const EMAIL = 'adjoua.yao@exemple.ci';
let numero = '';
let lienSuivi = '';

async function telephone(browser: Browser): Promise<Page> {
  return (await browser.newContext({ ...devices['Pixel 7'], locale: 'fr-FR', timezoneId: 'Africa/Abidjan' })).newPage();
}

async function ouvrir(page: Page) {
  await page.getByRole('button', { name: 'Recevoir un code' }).click();
  await expect(page.getByText(/Envoyé par e-mail à/)).toBeVisible();
  const code = (await dernierMessage(EMAIL, 'votre code est')).match(/code est (\d{6})/)![1]!;
  await saisirCode(page, code);
  await page.getByRole('button', { name: 'Valider' }).click();
  await expect(page.getByRole('heading', { name: numero })).toBeVisible();
}

test.describe.serial('portail : e-mail seul, messages, contestation', () => {
  test('dépôt avec un e-mail seulement ; le code arrive par e-mail', async ({ browser }) => {
    const page = await telephone(browser);
    await page.goto(`${portail('alpha')}/d/${QR_ALPHA}`);
    await page.getByText('Virement et transfert', { exact: true }).click();
    await page.getByLabel('Votre réclamation').fill('Mon virement du 20 septembre vers la BICICI n\'est jamais arrivé.');
    await page.getByLabel('Nom et prénom').fill('Adjoua Yao');
    await page.getByLabel('E-mail').fill(EMAIL);
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Envoyer ma réclamation' }).click();
    await expect(page.getByText(/par e-mail\. Gardez-les/)).toBeVisible();
    numero = (await page.locator('.select-all').textContent())!.trim();
    await page.getByRole('button', { name: 'Suivre ma réclamation' }).click();
    lienSuivi = page.url();
    await ouvrir(page);

    await page.getByLabel('Écrire à la banque').fill('Voici le reçu du virement.');
    await page.locator('input[type=file]').setInputFiles({ name: 'recu-virement.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF\n') });
    await page.getByRole('button', { name: 'Envoyer', exact: true }).click();
    await expect(page.getByText('Message envoyé à la banque.')).toBeVisible();
    await expect(page.getByText('Voici le reçu du virement.')).toBeVisible();
    await expect(page.getByRole('button', { name: /Télécharger recu-virement\.pdf/ })).toBeVisible();
    await page.context().close();
  });

  test('la banque résout ; le client conteste : la réclamation repart en traitement', async ({ page, browser }) => {
    // Répondre depuis « Ouverte » vaut prise en charge : il faut d'abord un agent assigné
    await connecter(page, COMPTES.superviseur);
    await page.getByRole('link', { name: numero }).click();
    const consigne = page.getByText('Pour répondre au client, assignez d\'abord la réclamation à un agent.');
    await expect(consigne).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Répondre au client' })).toHaveCount(0);
    await consigne.scrollIntoViewIfNeeded();
    await capture(page, '13-fiche-non-assignee');
    await page.getByLabel('Agent assigné').selectOption({ label: 'Aya Konan' });
    await expect(page.getByText('Réclamation assignée à Aya Konan.')).toBeVisible();
    // Le superviseur répond lui-même, puis résout
    await page.getByLabel('Réponse au client').fill('Nous avons relancé la banque destinataire.');
    await page.getByRole('button', { name: 'Envoyer au client' }).click();
    await expect(page.getByText('Réponse envoyée au client.')).toBeVisible();
    await page.getByRole('button', { name: 'Résoudre' }).click();
    await page.getByLabel('Réponse finale au client').fill('Le virement a été retrouvé et crédité.');
    await page.getByRole('button', { name: 'Résoudre et envoyer' }).click();
    await expect(page.getByText('Réclamation résolue')).toBeVisible();

    const client = await telephone(browser);
    await client.goto(lienSuivi);
    await ouvrir(client);
    await client.getByRole('button', { name: 'Non, je conteste' }).click();
    await client.getByLabel('Qu\'est-ce qui ne vous convient pas ?').fill('Je n\'ai toujours rien reçu sur mon compte.');
    await client.getByRole('button', { name: 'Envoyer ma contestation' }).click();
    await expect(client.getByText('Contestation envoyée : la banque reprend votre réclamation.')).toBeVisible();
    await expect(client.getByText('En cours de traitement')).toBeVisible();
    await client.context().close();

    await page.reload();
    await expect(page.getByText('En cours', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Réouvertures')).toBeVisible();
  });

  test('QR code inconnu : message clair, pas de formulaire', async ({ browser }) => {
    const page = await telephone(browser);
    await page.goto(`${portail('alpha')}/d/INCONNU42`);
    await expect(page.getByRole('heading', { name: 'QR code ou lien inconnu' })).toBeVisible();
    await page.context().close();
  });
});
