/**
 * Conversations et chat web (étape 17, phase 2), dans les vraies interfaces. Le Super Admin ouvre le
 * chat à la Banque Alpha ; le client de la réclamation d'exemple (Yao Kouassi, carte avalée,
 * assignée à Aya) ouvre son espace par le lien de suivi et le code, et écrit dans le chat ; Aya lui
 * répond depuis sa boîte de réception, en direct ; le superviseur voit toute la banque. À la fin, le
 * chat est refermé : l'espace client reprend le fil de messages simple, comme au départ.
 */
import { devices, expect, test, type Browser, type Page } from '@playwright/test';
import { COMPTES, CONSOLE, capture, codeOtpRecu, connecter, portail, saisirCode, sql } from './outils';

const ETAPE = 17;
/** Les messages arrivent par relecture (5 s côté client, 5 à 10 s côté banque) */
const DIRECT = { timeout: 20_000 };

let cible: { id: string; numero: string; jeton: string; telephone: string };
let client: Page;

async function telephone(browser: Browser): Promise<Page> {
  const contexte = await browser.newContext({ ...devices['Pixel 7'], locale: 'fr-FR', timezoneId: 'Africa/Abidjan' });
  return contexte.newPage();
}

/** Ouvre (ou ferme) le chat de la Banque Alpha depuis la console de la plateforme. */
async function reglerChat(page: Page, ouvert: boolean) {
  await connecter(page, COMPTES.superAdmin);
  await page.goto(`${CONSOLE}/plateforme/banques`);
  await page.getByRole('button', { name: 'Ouvrir Banque Alpha' }).click();
  const caseChat = page.getByRole('checkbox', { name: /Chat web et boîte de réception/ });
  await caseChat.setChecked(ouvert);
  return caseChat;
}

/** Heure de la base, pour ne compter que les notifications créées pendant le test. */
const horlogeBase = async () => (await sql<{ t: Date }>('SELECT now() AS t'))[0]!.t;

const ecrire = async (texte: string) => {
  await client.getByLabel('Écrire à la banque').fill(texte);
  await client.keyboard.press('Enter');
  await expect(client.getByRole('log', { name: 'Messages' }).getByText(texte)).toBeVisible();
};

test.describe.serial('conversations et chat web (étape 17)', () => {
  test.beforeAll(async () => {
    // La réclamation d'exemple du jeu de démonstration : carte avalée, assignée à Aya, déjà répondue
    const [r] = await sql<{ id: string; numero: string; jeton_suivi: string; telephone: string }>(`
      SELECT r.id, r.numero, r.jeton_suivi, c.telephone
        FROM reclamation r
        JOIN client_final c ON c.id = r.client_id
        JOIN banque b ON b.id = r.tenant_id
       WHERE b.slug = 'alpha' AND r.statut = 'EN_COURS' AND r.description LIKE 'Hier soir, j''ai voulu retirer%'
       LIMIT 1`);
    expect(r, 'la réclamation d\'exemple de la Banque Alpha').toBeDefined();
    cible = { id: r!.id, numero: r!.numero, jeton: r!.jeton_suivi, telephone: r!.telephone };
  });

  test.afterAll(async () => {
    await client?.context().close();
  });

  test('fermé par défaut ; le Super Admin ouvre le chat à la Banque Alpha', async ({ page }) => {
    const caseChat = await reglerChat(page, true);
    await expect(caseChat).toBeChecked();
    await caseChat.scrollIntoViewIfNeeded();
    await capture(page, '01-super-admin-chat', ETAPE);
    await page.getByRole('button', { name: 'Enregistrer les réglages' }).click();
    await expect(page.getByText('Réglages enregistrés.')).toBeVisible();
    await expect(page.getByRole('row', { name: /Banque Alpha/ }).getByText('Chat web et boîte de réception')).toBeVisible();
  });

  test('le client ouvre son espace : la discussion remplace le fil de messages', async ({ browser }) => {
    client = await telephone(browser);
    await client.goto(`${portail('alpha')}/suivi/${cible.jeton}`);
    await client.getByRole('button', { name: 'Recevoir un code' }).click();
    await saisirCode(client, await codeOtpRecu(cible.telephone));
    await client.getByRole('button', { name: 'Valider' }).click();
    await expect(client.getByRole('heading', { name: cible.numero })).toBeVisible();
    await expect(client.getByRole('heading', { name: 'Discussion avec Banque Alpha' })).toBeVisible();
    const depuis = await horlogeBase();
    // La réponse déjà donnée par Aya est dans le fil, signée par la banque
    await expect(client.getByRole('log', { name: 'Messages' }).getByText('Bonjour, nous vérifions le journal du distributeur')).toBeVisible();
    await expect(client.getByText('Aya')).toHaveCount(0);
    await ecrire('Merci. C\'était au distributeur de l\'agence du Plateau, vers 21 h.');
    await ecrire('J\'ai gardé le ticket, je peux vous l\'envoyer.');
    await expect(client.getByText('Envoyé')).toBeVisible();
    // Une seule alerte pour la rafale
    const alertes = await sql<{ n: string }>(
      `SELECT count(*) AS n FROM notification WHERE reclamation_id = $1 AND modele = 'agent.message_client' AND canal = 'IN_APP' AND cree_le > $2`,
      [cible.id, depuis],
    );
    expect(Number(alertes[0]!.n)).toBe(1);
  });

  test('Aya répond depuis sa boîte de réception ; le client voit la réponse et « Lu », sans SMS', async ({ page }) => {
    await connecter(page, COMPTES.agent);
    const menu = page.getByRole('link', { name: /^Conversations/ });
    await expect(menu).toBeVisible();
    await menu.click();
    await expect(page.getByRole('heading', { name: 'Conversations', level: 1 })).toBeVisible();
    const ligne = page.getByRole('button', { name: new RegExp(`${cible.numero}, non lue, à répondre, en ligne`) });
    await expect(ligne).toBeVisible(DIRECT);
    await ligne.click();
    const fil = page.getByRole('region', { name: /Conversation avec/ });
    await expect(fil.getByText('J\'ai gardé le ticket, je peux vous l\'envoyer.')).toBeVisible();
    await expect(fil.getByText('En ligne')).toBeVisible();
    // Ouvrir la conversation la marque lue : le client voit « Lu »
    await expect(client.getByText('Lu', { exact: true })).toBeVisible(DIRECT);
    await page.getByLabel('Réponse au client').fill('Merci, nous avons retrouvé l\'opération : le remboursement des 50 000 FCFA part aujourd\'hui.');
    await capture(page, '02-boite-agent', ETAPE);
    const depuis = await horlogeBase();
    await page.getByRole('button', { name: 'Envoyer', exact: true }).click();
    await expect(page.getByText('Réponse envoyée dans le chat du client.')).toBeVisible();

    await expect(client.getByRole('log', { name: 'Messages' }).getByText('le remboursement des 50 000 FCFA part aujourd\'hui')).toBeVisible(DIRECT);
    // La discussion en haut de l'écran : fil et zone de saisie
    await client.getByRole('heading', { name: 'Discussion avec Banque Alpha' }).evaluate((e) => e.scrollIntoView({ block: 'start' }));
    await capture(client, '03-chat-client', ETAPE);
    await expect(fil.getByText('Lu par le client')).toBeVisible(DIRECT);
    // Lue dans le chat : ni e-mail ni SMS « nouvelle réponse »
    const [conv] = await sql<{ lue: boolean }>('SELECT lu_client_le >= dernier_message_banque_le AS lue FROM conversation WHERE reclamation_id = $1', [cible.id]);
    expect(conv!.lue).toBe(true);
    const avis = await sql<{ n: string }>(
      `SELECT count(*) AS n FROM notification WHERE reclamation_id = $1 AND modele = 'client.reponse' AND cree_le > $2`,
      [cible.id, depuis],
    );
    expect(Number(avis[0]!.n)).toBe(0);

    // La fiche dit que le client est en ligne et mène à la conversation
    await page.getByRole('link', { name: cible.numero }).click();
    await expect(page.getByRole('heading', { name: cible.numero, level: 1 })).toBeVisible();
    await expect(page.getByText('Le client est en ligne')).toBeVisible();
    await page.getByText('Le client est en ligne').scrollIntoViewIfNeeded();
    await capture(page, '04-fiche-chat', ETAPE);
    await page.getByRole('button', { name: 'Ouvrir la conversation' }).click();
    await expect(page).toHaveURL(/\/conversations\//);
  });

  test('le superviseur voit toute la banque ; il lit sans marquer lu pour Aya', async ({ page }) => {
    await ecrire('Je passe à l\'agence demain matin, c\'est possible ?');
    await connecter(page, COMPTES.superviseur);
    await page.goto(`${CONSOLE}/conversations`);
    const ligne = page.getByRole('button', { name: new RegExp(`${cible.numero}, non lue, à répondre`) });
    await expect(ligne).toBeVisible(DIRECT);
    await expect(ligne.getByText('Suivie par Aya Konan')).toBeVisible();
    await ligne.click();
    await expect(page.getByRole('region', { name: /Conversation avec/ }).getByText('Je passe à l\'agence demain matin')).toBeVisible();
    await capture(page, '05-boite-superviseur', ETAPE);
    await page.getByRole('tab', { name: /Non lues/ }).click();
    await expect(page.getByRole('button', { name: new RegExp(`${cible.numero}, non lue`) })).toBeVisible();
    const [conv] = await sql<{ nonlue: boolean }>('SELECT lu_banque_le < dernier_message_client_le AS nonlue FROM conversation WHERE reclamation_id = $1', [cible.id]);
    expect(conv!.nonlue).toBe(true);
  });

  test('refermé : l\'espace client reprend le fil simple, la boîte de réception disparaît', async ({ page, browser }) => {
    const caseChat = await reglerChat(page, false);
    await expect(caseChat).not.toBeChecked();
    await page.getByRole('button', { name: 'Enregistrer les réglages' }).click();
    await expect(page.getByText('Réglages enregistrés.')).toBeVisible();

    await client.reload();
    await expect(client.getByRole('heading', { name: 'Échanges' })).toBeVisible();
    await expect(client.getByRole('heading', { name: 'Discussion avec Banque Alpha' })).toHaveCount(0);
    await expect(client.getByText('Je passe à l\'agence demain matin, c\'est possible ?')).toBeVisible();

    const agent = await (await browser.newContext()).newPage();
    await connecter(agent, COMPTES.agent);
    await expect(agent.getByRole('link', { name: 'Réclamations' })).toBeVisible();
    await expect(agent.getByRole('link', { name: /^Conversations/ })).toHaveCount(0);
    await agent.context().close();
  });
});
