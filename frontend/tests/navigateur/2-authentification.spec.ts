/**
 * Entrée dans la console : erreurs de connexion, session reprise au rechargement, déconnexion,
 * pages réservées, première connexion d'une invitée (mot de passe puis TOTP), mot de passe oublié.
 */
import { expect, test } from '@playwright/test';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import { COMPTES, CONSOLE, MOT_DE_PASSE, capture, codeTotp, connecter, lienRecu, saisirCode, secretDemo } from './outils';

test('mauvais mot de passe : message identique que le compte existe ou non', async ({ page }) => {
  await page.goto(`${CONSOLE}/connexion`);
  await capture(page, '20-connexion');
  for (const email of [COMPTES.superviseur2, 'personne@banque-alpha.example']) {
    await page.getByLabel('E-mail professionnel').fill(email);
    await page.getByLabel('Mot de passe', { exact: true }).fill('pas-le-bon-mot-de-passe');
    await page.getByRole('button', { name: 'Continuer' }).click();
    await expect(page.getByRole('alert')).toContainText('E-mail ou mot de passe incorrect');
  }
});

test('la session reprend après un rechargement ; la déconnexion la ferme', async ({ page }) => {
  await connecter(page, COMPTES.superviseur2);
  await expect(page.getByRole('heading', { name: 'Réclamations' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Réclamations' })).toBeVisible();
  await expect(page).toHaveURL(/\/reclamations/);

  await page.getByRole('button', { name: 'Se déconnecter' }).click();
  await expect(page.getByText('Vous êtes déconnecté.')).toBeVisible();
  await page.goto(`${CONSOLE}/personnel`);
  await expect(page).toHaveURL(/\/connexion\?retour=%2Fpersonnel/);
});

test('un agent ne voit pas le paramétrage : menu restreint, page réservée', async ({ page }) => {
  await connecter(page, COMPTES.agent2);
  await expect(page.getByRole('link', { name: 'Catégories et délais' })).toHaveCount(0);
  await page.goto(`${CONSOLE}/parametrage/categories`);
  await expect(page.getByRole('heading', { name: 'Page réservée' })).toBeVisible();
});

test('première connexion d\'une invitée : mot de passe, QR code TOTP, puis son espace', async ({ page, browser }) => {
  // L'Admin Entreprise renvoie l'invitation
  await connecter(page, COMPTES.admin);
  await page.getByRole('link', { name: 'Personnel' }).click();
  await page.getByRole('button', { name: 'Actions pour Estelle Gnahoré' }).click();
  await page.getByRole('menuitem', { name: 'Renvoyer l\'invitation' }).click();
  await expect(page.getByText(`Invitation renvoyée à ${COMPTES.invitee}`)).toBeVisible();

  const invitee = await (await browser.newContext()).newPage();
  await invitee.goto(await lienRecu(COMPTES.invitee, '/invitation#jeton='));
  await expect(invitee.getByRole('heading', { name: 'Bienvenue' })).toBeVisible();
  // Le jeton quitte l'adresse dès sa lecture
  await expect(invitee).toHaveURL(`${CONSOLE}/invitation`);

  await invitee.getByLabel('Nouveau mot de passe').fill('court');
  await invitee.getByLabel('Confirmez-le').fill('court');
  await invitee.getByRole('button', { name: 'Continuer' }).click();
  await expect(invitee.getByText('12 caractères au moins', { exact: true })).toBeVisible();

  const motDePasse = 'Un café au Plateau chaque matin';
  await invitee.getByLabel('Nouveau mot de passe').fill(motDePasse);
  await invitee.getByLabel('Confirmez-le').fill(motDePasse);
  await invitee.getByRole('button', { name: 'Continuer' }).click();
  await expect(invitee.getByRole('heading', { name: 'Protégez votre compte' })).toBeVisible();
  await capture(invitee, '21-activation-totp');
  // Le QR code affiché se lit comme avec l'appareil photo d'un téléphone (étape 11) : décodé depuis
  // une capture de l'écran, il donne l'adresse otpauth:// que Google Authenticator enregistre
  const qr = invitee.getByRole('img', { name: /QR code d'activation/ });
  expect((await qr.boundingBox())!.width).toBeGreaterThanOrEqual(200);
  const image = PNG.sync.read(await qr.screenshot());
  const lu = jsQR(new Uint8ClampedArray(image.data), image.width, image.height);
  expect(lu?.data).toMatch(/^otpauth:\/\/totp\/[^?]+\?/);
  const adresse = new URL(lu!.data);
  expect(decodeURIComponent(adresse.pathname)).toContain(COMPTES.invitee);
  expect(adresse.searchParams.get('algorithm')).toBe('SHA1');
  expect(adresse.searchParams.get('digits')).toBe('6');
  expect(adresse.searchParams.get('period')).toBe('30');
  const secret = adresse.searchParams.get('secret')!;
  // La clé à saisir à la main est la même
  expect(await invitee.locator('[data-secret]').getAttribute('data-secret')).toBe(secret);
  await saisirCode(invitee, await codeTotp(secret));
  await invitee.getByRole('button', { name: 'Activer et me connecter' }).click();
  await expect(invitee.getByRole('tab', { name: /Mes réclamations/ })).toBeVisible();
  await expect(invitee.getByText('Estelle Gnahoré')).toBeVisible();
  await invitee.context().close();
});

test('mot de passe oublié : lien par e-mail, nouveau mot de passe, connexion', async ({ page, browser }) => {
  await page.goto(`${CONSOLE}/connexion`);
  await page.getByRole('link', { name: 'Mot de passe oublié' }).click();
  await page.getByLabel('E-mail professionnel').fill(COMPTES.agent2);
  await page.getByRole('button', { name: 'Recevoir le lien' }).click();
  await expect(page.getByRole('heading', { name: 'Vérifiez vos e-mails' })).toBeVisible();

  const onglet = await (await browser.newContext()).newPage();
  await onglet.goto(await lienRecu(COMPTES.agent2, '/mot-de-passe#jeton='));
  const nouveau = 'Une longue phrase sous la pluie 2026';
  await onglet.getByLabel('Nouveau mot de passe').fill(nouveau);
  await onglet.getByLabel('Confirmez-le').fill(nouveau);
  await onglet.getByRole('button', { name: 'Enregistrer le mot de passe' }).click();
  await expect(onglet.getByText('Votre mot de passe est changé')).toBeVisible();

  // L'ancien mot de passe ne marche plus, le nouveau si
  await onglet.getByLabel('E-mail professionnel').fill(COMPTES.agent2);
  await onglet.getByLabel('Mot de passe', { exact: true }).fill(MOT_DE_PASSE);
  await onglet.getByRole('button', { name: 'Continuer' }).click();
  await expect(onglet.getByRole('alert')).toContainText('E-mail ou mot de passe incorrect');
  await onglet.getByLabel('Mot de passe', { exact: true }).fill(nouveau);
  await onglet.getByRole('button', { name: 'Continuer' }).click();
  await saisirCode(onglet, await codeTotp(secretDemo(COMPTES.agent2)));
  await expect(onglet.getByRole('heading', { name: 'Réclamations' })).toBeVisible();
  await onglet.context().close();
});
