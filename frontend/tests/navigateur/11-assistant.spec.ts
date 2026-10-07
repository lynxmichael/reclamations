/**
 * Assistant IA (étape 18, phase 2), dans les vraies interfaces, sans fournisseur d'IA (règles seules,
 * comme une banque dont l'IA ne répond pas). Le Super Admin ouvre le chat et l'assistant à la Banque
 * Alpha ; Fatou écrit une réponse de la base ; un client pose une question puis prépare sa
 * réclamation avec l'assistant, la relit et l'envoie ; Aya demande un brouillon sur la fiche ; Makor
 * voit l'usage du mois. À la fin, chat et assistant sont refermés, comme au départ.
 */
import { devices, expect, test, type Browser, type Page } from '@playwright/test';
import { COMPTES, CONSOLE, QR_ALPHA, capture, connecter, portail, sql } from './outils';

const ETAPE = 18;
let numero = '';

/** Le téléphone du client, avec sa propre adresse IP (limites de dépôt par adresse) */
async function telephone(browser: Browser): Promise<Page> {
  const contexte = await browser.newContext({
    ...devices['Pixel 7'], locale: 'fr-FR', timezoneId: 'Africa/Abidjan', extraHTTPHeaders: { 'X-Forwarded-For': '198.51.100.18' },
  });
  return contexte.newPage();
}

async function reglages(page: Page, connecte = false) {
  if (!connecte) await connecter(page, COMPTES.superAdmin);
  await page.goto(`${CONSOLE}/plateforme/banques`);
  await page.getByRole('button', { name: 'Ouvrir Banque Alpha' }).click();
  return {
    chat: page.getByRole('checkbox', { name: /Chat web et boîte de réception/ }),
    assistant: page.getByRole('checkbox', { name: /Assistant IA/ }),
  };
}

test.describe.serial('assistant IA (étape 18)', () => {
  test.afterAll(async () => {
    // Quoi qu'il arrive, la Banque Alpha retrouve son portail habituel pour les tests suivants
    await sql('UPDATE banque SET assistant_ia = false, chat_web = false WHERE slug = \'alpha\'');
  });

  test('le Super Admin ouvre l\'assistant, qui exige le chat web', async ({ page }) => {
    const { chat, assistant } = await reglages(page);
    await expect(assistant).toBeDisabled();
    await chat.setChecked(true);
    await expect(assistant).toBeEnabled();
    await assistant.setChecked(true);
    await assistant.scrollIntoViewIfNeeded();
    await capture(page, '01-super-admin-assistant', ETAPE);
    await page.getByRole('button', { name: 'Enregistrer les réglages' }).click();
    await expect(page.getByText('Réglages enregistrés.')).toBeVisible();
    await expect(page.getByRole('row', { name: /Banque Alpha/ }).getByText('Assistant IA')).toBeVisible();
  });

  test('Fatou écrit la base de réponses ; une promesse est signalée pendant la saisie', async ({ page }) => {
    await connecter(page, COMPTES.admin);
    await page.getByRole('link', { name: 'Assistant IA' }).click();
    await expect(page.getByRole('heading', { name: 'Assistant IA', level: 1 })).toBeVisible();
    await page.getByRole('button', { name: 'Nouvelle réponse' }).click();
    await page.getByLabel('Question du client').fill('Quels sont les horaires des agences ?');
    const reponse = page.getByLabel('Réponse validée');
    await reponse.fill('Nos agences ouvrent du lundi au vendredi. Vous serez remboursé sous 48 heures.');
    await expect(page.getByText(/La réponse promet un remboursement/)).toBeVisible();
    await expect(page.getByText(/La réponse promet un délai/)).toBeVisible();
    await capture(page, '02-base-reponses-alerte', ETAPE);
    await reponse.fill('Nos agences sont ouvertes du lundi au vendredi, de 8 h à 12 h et de 14 h à 17 h 30.');
    await expect(page.getByText(/La réponse promet/)).toHaveCount(0);
    await page.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByText('Réponse ajoutée : l\'assistant peut la donner aux clients.')).toBeVisible();
    await expect(page.getByText('Quels sont les horaires des agences ?')).toBeVisible();
  });

  test('le client : question fréquente, puis réclamation préparée, relue et envoyée par lui', async ({ browser }) => {
    const client = await telephone(browser);
    await client.goto(`${portail('alpha')}/d/${QR_ALPHA}`);
    const fil = client.getByRole('log', { name: 'Conversation avec l\'assistant' });
    await expect(fil.getByText(/Bonjour, je suis l'assistant automatique de Banque Alpha/)).toBeVisible();
    await expect(client.getByText('Vous échangez avec un assistant automatique, pas avec une personne.', { exact: false })).toBeVisible();

    const ecrire = async (texte: string) => {
      await client.getByLabel('Votre message à l\'assistant').fill(texte);
      await client.keyboard.press('Enter');
      await expect(fil.getByText(texte)).toBeVisible();
    };
    await ecrire('Bonjour, vous ouvrez à quelle heure ?');
    await expect(fil.getByText('Nos agences sont ouvertes du lundi au vendredi, de 8 h à 12 h et de 14 h à 17 h 30.')).toBeVisible();
    await ecrire('Le GAB de l\'agence a avalé ma carte hier soir vers 21h, mon code secret 1234 ne passe plus');
    await expect(fil.getByText(/ne communiquez jamais votre code secret/)).toBeVisible();
    const proposition = client.getByTestId('proposition');
    await expect(proposition).toBeVisible();
    await expect(proposition.getByText('Carte bancaire')).toBeVisible();
    await proposition.evaluate((e) => e.scrollIntoView({ block: 'center' }));
    await capture(client, '03-assistant-portail', ETAPE);

    await proposition.getByRole('button', { name: 'Vérifier et envoyer' }).click();
    await expect(client.getByText('Préparée avec l\'assistant : vérifiez la catégorie', { exact: false })).toBeVisible();
    await expect(client.getByRole('radio', { name: /Carte bancaire/ })).toBeChecked();
    const description = client.getByLabel('Votre réclamation');
    await expect(description).toHaveValue(/mon code secret \[code retiré\] ne passe plus/);
    await expect(description).not.toHaveValue(/1234/);
    await client.getByLabel('Nom et prénom').fill('Aminata Touré');
    await client.getByLabel('Téléphone').fill('05 99 18 00 42');
    await client.getByRole('checkbox', { name: /J'accepte/ }).check();
    await client.getByRole('button', { name: 'Envoyer ma réclamation' }).click();
    await expect(client.getByRole('heading', { name: 'Réclamation envoyée' })).toBeVisible({ timeout: 30_000 });
    numero = (await client.locator('.chiffres').first().textContent())!.trim();
    expect(numero).toMatch(/^ALP-\d{4}-\d{6}$/);

    const [creation] = await sql<{ donnees: { assistant?: { categorieGardee: boolean } } }>(
      `SELECT e.donnees FROM reclamation_evenement e JOIN reclamation r ON r.id = e.reclamation_id WHERE r.numero = $1 AND e.type = 'CREATION'`, [numero],
    );
    expect(creation!.donnees.assistant).toMatchObject({ categorieGardee: true });
    // Journal sans contenu : deux tours, par les règles (aucun fournisseur configuré)
    const appels = await sql<{ issue: string; fournisseur: string }>(
      `SELECT a.issue, a.fournisseur FROM appel_ia a JOIN banque b ON b.id = a.tenant_id WHERE b.slug = 'alpha' AND a.finalite = 'ACCUEIL_PORTAIL'`,
    );
    expect(appels.length).toBeGreaterThanOrEqual(2);
    expect(appels.every((x) => x.issue === 'REGLES' && x.fournisseur === 'regles')).toBe(true);
    await client.context().close();
  });

  test('Aya demande un brouillon : rien ne part, les interdits s\'affichent à la frappe', async ({ page, browser }) => {
    // Serge assigne la nouvelle réclamation à Aya
    const superviseur = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    await connecter(superviseur, COMPTES.superviseur);
    await superviseur.goto(`${CONSOLE}/reclamations`);
    await superviseur.getByRole('link', { name: numero }).first().click();
    await superviseur.getByLabel('Agent assigné').selectOption({ label: 'Aya Konan' });
    await expect(superviseur.getByText('Réclamation assignée à Aya Konan.')).toBeVisible();
    await superviseur.context().close();

    await connecter(page, COMPTES.agent);
    await page.goto(`${CONSOLE}/reclamations`);
    await page.getByRole('link', { name: numero }).first().click();
    await expect(page.getByRole('heading', { name: numero, level: 1 })).toBeVisible();
    await expect(page.getByText('Déposée avec l\'assistant')).toBeVisible();
    const avant = await sql<{ n: string }>('SELECT count(*) AS n FROM commentaire c JOIN reclamation r ON r.id = c.reclamation_id WHERE r.numero = $1', [numero]);

    await page.getByRole('button', { name: 'Suggérer une réponse' }).click();
    const aide = page.getByTestId('aide-ia');
    await expect(aide.getByText(/Brouillon type/)).toBeVisible();
    const zone = page.getByLabel('Réponse au client');
    await expect(zone).toHaveValue(/^Bonjour,\n/);
    await expect(aide.getByText(/Aucune promesse/)).toBeVisible();
    await zone.fill('Bonjour,\n\nVous serez remboursé sous 48 heures.\n\nCordialement');
    await expect(aide.getByText(/promet un remboursement/)).toBeVisible();
    await expect(aide.getByText(/promet un délai/)).toBeVisible();
    await page.getByTestId('aide-ia').scrollIntoViewIfNeeded();
    await capture(page, '04-brouillon-agent', ETAPE);
    await zone.fill('Bonjour,\n\nNous avons bien reçu votre réclamation et vérifions le journal du distributeur.\n\nCordialement');
    await expect(aide.getByText(/Aucune promesse/)).toBeVisible();
    // Rien n'a été envoyé ni écrit sur la réclamation
    const apres = await sql<{ n: string }>('SELECT count(*) AS n FROM commentaire c JOIN reclamation r ON r.id = c.reclamation_id WHERE r.numero = $1', [numero]);
    expect(apres[0]!.n).toBe(avant[0]!.n);
    const [audit] = await sql<{ donnees: { source: string } }>(
      `SELECT j.donnees FROM journal_audit j JOIN reclamation r ON r.id::text = j.entite_id WHERE r.numero = $1 AND j.action = 'reclamation.brouillon_demande'`, [numero],
    );
    expect(audit!.donnees.source).toBe('REGLES');
  });

  test('Makor voit l\'usage du mois, sans contenu ; puis referme le chat, donc l\'assistant', async ({ page }) => {
    await connecter(page, COMPTES.superAdmin);
    await page.goto(`${CONSOLE}/plateforme/activite`);
    const panneau = page.locator('section', { has: page.getByRole('heading', { name: /^Assistant IA et baromètre de/ }) });
    await expect(panneau.getByRole('row', { name: /Banque Alpha/ })).toBeVisible();
    await expect(panneau.getByText(/aucun \(règles seules, rien n'est envoyé\)/)).toBeVisible();
    await panneau.scrollIntoViewIfNeeded();
    await capture(page, '05-consommation', ETAPE);

    const { chat, assistant } = await reglages(page, true);
    await chat.setChecked(false);
    await expect(assistant).toBeDisabled();
    await page.getByRole('button', { name: 'Enregistrer les réglages' }).click();
    await expect(page.getByText('Réglages enregistrés.')).toBeVisible();
    const [b] = await sql<{ assistant_ia: boolean; chat_web: boolean }>('SELECT assistant_ia, chat_web FROM banque WHERE slug = \'alpha\'');
    expect(b).toEqual({ assistant_ia: false, chat_web: false });
  });
});
