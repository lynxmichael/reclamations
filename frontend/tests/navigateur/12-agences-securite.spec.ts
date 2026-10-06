/**
 * Étape 19 : l'activité des agences (Admin Entreprise et superviseurs) ; la double authentification
 * facultative, activée ou désactivée par chacun depuis « Mon compte » ; l'Admin Entreprise qui
 * l'exige de tout le personnel, puis la laisse de nouveau au choix de chacun.
 */
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import { COMPTES, CONSOLE, MOT_DE_PASSE, capture, codeTotp, connecter, saisirCode, secretDemo } from './outils';

const IBRAHIM = 'ibrahim.coulibaly@banque-alpha.example';
const OPTIONS = { locale: 'fr-FR', timezoneId: 'Africa/Abidjan', viewport: { width: 1440, height: 900 }, acceptDownloads: true } as const;

/** Le QR code affiché, lu comme par l'appareil photo d'un téléphone : renvoie le secret. */
async function lireQr(page: Page, email: string): Promise<string> {
  const qr = page.getByRole('img', { name: /QR code d'activation/ });
  await expect(qr).toBeVisible();
  const image = PNG.sync.read(await qr.screenshot());
  const lu = jsQR(new Uint8ClampedArray(image.data), image.width, image.height);
  expect(lu?.data).toMatch(/^otpauth:\/\/totp\/[^?]+\?/);
  const adresse = new URL(lu!.data);
  expect(decodeURIComponent(adresse.pathname)).toContain(email);
  const secret = adresse.searchParams.get('secret')!;
  // La clé à saisir à la main est la même
  expect(await page.locator('[data-secret]').getAttribute('data-secret')).toBe(secret);
  return secret;
}

/** E-mail et mot de passe, sans attendre d'étape suivante. */
async function motDePasse(page: Page, email: string) {
  await page.goto(`${CONSOLE}/connexion`);
  await page.getByLabel('E-mail professionnel').fill(email);
  await page.getByLabel('Mot de passe', { exact: true }).fill(MOT_DE_PASSE);
  await page.getByRole('button', { name: 'Continuer' }).click();
}

const etat = (page: Page) => page.getByRole('region', { name: 'Double authentification' });

test.describe.serial('activité des agences', () => {
  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage(OPTIONS);
    await connecter(page, COMPTES.admin);
  });
  test.afterAll(() => page.context().close());

  test('l\'Admin Entreprise voit chacune de ses agences, le détail de l\'une, et ouvre son tableau de bord', async () => {
    await page.getByRole('link', { name: 'Activité des agences' }).click();
    await expect(page).toHaveURL(`${CONSOLE}/agences`);
    await expect(page.getByRole('heading', { name: 'Activité des agences' })).toBeVisible();
    await expect(page.getByText('Agences sollicitées')).toBeVisible();
    // Les agences actives ont toujours leur ligne ; « Sans agence » seulement s'il y a eu des dépôts sans agence
    for (const nom of ['Plateau', 'Cocody Angré', 'Bouaké Commerce']) {
      await expect(page.getByRole('button', { name: new RegExp(`^${nom}`) })).toBeVisible();
    }

    // Sur 30 jours, l'historique du jeu de démonstration touche chaque agence, et des dépôts par lien web
    await page.getByLabel('Période').selectOption('30j');
    await expect(page).toHaveURL(/periode=30j/);
    await expect(page.getByRole('button', { name: /^Sans agence/ })).toBeVisible();

    // Le détail du Plateau : catégories, agents, et son QR code du hall avec son volume
    await page.getByRole('button', { name: /^Plateau/ }).click();
    await expect(page.getByRole('button', { name: /^Plateau/ })).toHaveAttribute('aria-expanded', 'true');
    const detail = page.locator('[id^="detail-"]');
    await expect(detail.getByRole('heading', { name: 'Catégories principales' })).toBeVisible();
    await expect(detail.getByRole('heading', { name: 'Agents qui traitent ses réclamations' })).toBeVisible();
    await expect(detail.getByText('Hall d\'accueil')).toBeVisible();
    await capture(page, '01-activite-des-agences', 19);

    // Export : une ligne par agence, mêmes chiffres
    const attente = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Exporter en CSV' }).click();
    const fichier = readFileSync((await (await attente).path())!, 'utf8');
    expect(fichier).toContain('Agence;Code;Ville;Active');
    expect(fichier).toMatch(/Plateau;AG01;Abidjan;Oui/);
    expect(fichier).toMatch(/Sans agence \(lien web, téléphone, WhatsApp ou SMS\);/);

    // Son tableau de bord : filtré sur l'agence
    await detail.getByRole('link', { name: 'Son tableau de bord' }).click();
    await expect(page).toHaveURL(/\/tableau-de-bord\?agenceId=[^&]+&periode=30j/);
    await expect(page.getByText('Agence : Plateau')).toBeVisible();

    // Ses réclamations : toute la banque, filtrées sur l'agence
    await page.goBack();
    await page.getByRole('button', { name: /^Plateau/ }).click();
    await page.locator('[id^="detail-"]').getByRole('link', { name: 'Ses réclamations' }).click();
    await expect(page).toHaveURL(/\/reclamations\?file=toutes&agenceId=/);
  });

  test('le superviseur la consulte aussi ; l\'agent ne la voit pas', async ({ browser }) => {
    const superviseur = await browser.newPage(OPTIONS);
    await connecter(superviseur, COMPTES.superviseur2);
    await superviseur.getByRole('link', { name: 'Activité des agences' }).click();
    await expect(superviseur.getByRole('button', { name: /^Cocody Angré/ })).toBeVisible();
    await superviseur.context().close();

    const agent = await browser.newPage(OPTIONS);
    await connecter(agent, COMPTES.agent);
    await expect(agent.getByRole('link', { name: 'Activité des agences' })).toHaveCount(0);
    await agent.goto(`${CONSOLE}/agences`);
    await expect(agent.getByRole('heading', { name: 'Page réservée' })).toBeVisible();
    await agent.context().close();
  });
});

test.describe.serial('double authentification au choix de la banque', () => {
  let ibrahim: Page;
  let admin: Page;
  let secret = secretDemo(IBRAHIM);
  test.beforeAll(async ({ browser }) => {
    ibrahim = await browser.newPage(OPTIONS);
    admin = await browser.newPage(OPTIONS);
  });
  test.afterAll(async () => {
    await ibrahim.context().close();
    await admin.context().close();
  });

  test('Mon compte : Ibrahim désactive sa double authentification, puis se connecte avec son seul mot de passe', async () => {
    await connecter(ibrahim, IBRAHIM, secret);
    await ibrahim.getByRole('link', { name: /Mon compte/ }).click();
    await expect(ibrahim.getByRole('heading', { name: 'Mon compte' })).toBeVisible();
    await expect(etat(ibrahim)).toContainText('Activée');

    await etat(ibrahim).getByRole('button', { name: 'Désactiver' }).click();
    await saisirCode(ibrahim, await codeTotp(secret));
    await etat(ibrahim).getByRole('button', { name: 'Désactiver' }).click();
    await expect(etat(ibrahim)).toContainText('Non activée');
    await expect(etat(ibrahim).getByRole('button', { name: 'Activer la double authentification' })).toBeVisible();

    // Un rappel en haut des autres pages, que « Plus tard » masque
    await ibrahim.getByRole('link', { name: 'Réclamations' }).first().click();
    const rappel = ibrahim.getByRole('status').filter({ hasText: 'n\'est protégé que par votre mot de passe' });
    await expect(rappel).toBeVisible();
    await capture(ibrahim, '02-rappel', 19);
    await rappel.getByRole('button', { name: 'Plus tard' }).click();
    await expect(rappel).toHaveCount(0);

    // Plus de code à la connexion
    await ibrahim.getByRole('button', { name: 'Se déconnecter' }).click();
    await motDePasse(ibrahim, IBRAHIM);
    await expect(ibrahim.getByRole('heading', { name: 'Réclamations' })).toBeVisible();
    await expect(ibrahim.getByRole('heading', { name: 'Code de vérification' })).toHaveCount(0);
    await expect(rappel).toBeVisible();
  });

  test('l\'Admin Entreprise l\'exige : la session d\'Ibrahim se ferme, il l\'active à sa connexion', async () => {
    await connecter(admin, COMPTES.admin);
    await admin.getByRole('link', { name: 'Personnel' }).click();
    const regle = admin.getByRole('region', { name: /^Double authentification/ });
    await expect(regle).toContainText('Double authentification : facultative');
    await expect(admin.getByRole('row', { name: /Ibrahim Coulibaly/ })).toContainText('Sans double authentification');

    await regle.getByRole('button', { name: 'Rendre obligatoire' }).click();
    const dialogue = admin.getByRole('dialog', { name: /^Exiger la double authentification/ });
    await expect(dialogue).toContainText('2 personnes ne l\'ont pas activée');
    await capture(admin, '03-exiger', 19);
    await dialogue.getByRole('button', { name: 'Rendre obligatoire' }).click();
    await expect(dialogue).toBeHidden();
    await expect(regle).toContainText('Double authentification : obligatoire');
    await expect(admin.getByRole('row', { name: /Ibrahim Coulibaly/ })).toContainText('Double authentification à activer');
    await capture(admin, '04-personnel-obligatoire', 19);

    // Sa session est fermée : au rechargement, retour à la connexion
    await ibrahim.reload();
    await expect(ibrahim).toHaveURL(/\/connexion/);
    await motDePasse(ibrahim, IBRAHIM);
    await expect(ibrahim.getByRole('heading', { name: 'Protégez votre compte' })).toBeVisible();
    await capture(ibrahim, '05-activation-a-la-connexion', 19);
    secret = await lireQr(ibrahim, IBRAHIM);
    await saisirCode(ibrahim, await codeTotp(secret));
    await ibrahim.getByRole('button', { name: 'Activer et me connecter' }).click();
    await expect(ibrahim.getByRole('heading', { name: 'Réclamations' })).toBeVisible();
    await expect(ibrahim.getByText('n\'est protégé que par votre mot de passe')).toHaveCount(0);

    // Exigée : elle ne se désactive plus
    await ibrahim.getByRole('link', { name: /Mon compte/ }).click();
    await expect(etat(ibrahim)).toContainText('Votre banque exige la double authentification');
    await expect(etat(ibrahim).getByRole('button', { name: 'Désactiver' })).toHaveCount(0);

    // La connexion demande maintenant son code
    await ibrahim.getByRole('button', { name: 'Se déconnecter' }).click();
    await motDePasse(ibrahim, IBRAHIM);
    await expect(ibrahim.getByRole('heading', { name: 'Code de vérification' })).toBeVisible();
    await saisirCode(ibrahim, await codeTotp(secret));
    await expect(ibrahim.getByRole('heading', { name: 'Réclamations' })).toBeVisible();
  });

  test('de nouveau facultative : Ibrahim la désactive et la réactive depuis Mon compte', async () => {
    const regle = admin.getByRole('region', { name: /^Double authentification/ });
    await regle.getByRole('button', { name: 'Rendre facultative' }).click();
    await admin.getByRole('dialog', { name: /^Ne plus exiger la double authentification/ }).getByRole('button', { name: 'Rendre facultative' }).click();
    await expect(regle).toContainText('Double authentification : facultative');

    // Ceux qui l'ont activée la gardent ; Ibrahim peut la désactiver
    await ibrahim.goto(`${CONSOLE}/compte`);
    await expect(etat(ibrahim)).toContainText('Activée');
    await etat(ibrahim).getByRole('button', { name: 'Désactiver' }).click();
    await saisirCode(ibrahim, await codeTotp(secret));
    await etat(ibrahim).getByRole('button', { name: 'Désactiver' }).click();
    await expect(etat(ibrahim)).toContainText('Non activée');

    // Puis la réactive : nouveau QR code, premier code
    await etat(ibrahim).getByRole('button', { name: 'Activer la double authentification' }).click();
    await expect(etat(ibrahim).getByRole('img', { name: /QR code d'activation/ })).toBeVisible();
    await capture(ibrahim, '06-mon-compte-activation', 19);
    const nouveau = await lireQr(ibrahim, IBRAHIM);
    expect(nouveau).not.toBe(secret);
    secret = nouveau;
    await saisirCode(ibrahim, await codeTotp(secret));
    await etat(ibrahim).getByRole('button', { name: 'Activer', exact: true }).click();
    await expect(etat(ibrahim)).toContainText('Activée');
    await expect(etat(ibrahim).getByRole('button', { name: 'Désactiver' })).toBeVisible();
    await capture(ibrahim, '07-mon-compte-activee', 19);
  });
});
