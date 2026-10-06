/**
 * Guichet, doublons et réaffectation (étape 21), dans les vraies interfaces. Aya saisit au guichet du
 * Plateau la réclamation d'une cliente sans smartphone et imprime son récépissé. La cliente, qui a
 * perdu son SMS, retrouve ses réclamations sur le portail avec son numéro, puis redépose la même
 * réclamation par le QR code. Le superviseur voit le doublon possible et le rattache : la cliente ne
 * suit plus qu'une réclamation. Enfin, Mamadou absent, ses dossiers sont « à réassigner » : le
 * superviseur les répartit en lot. L'absence est retirée à la fin.
 */
import { devices, expect, test, type Browser, type Page } from '@playwright/test';
import { COMPTES, CONSOLE, PNG, QR_ALPHA, capture, codeOtpRecu, connecter, dernierMessage, portail, saisirCode, sql } from './outils';

const ETAPE = 21;
// Un numéro par lancement : les limites (3 codes par heure et par numéro) vivent dans Redis
const CHIFFRES = String(Math.floor(10_000_000 + Math.random() * 89_999_999));
const TELEPHONE = `01 ${CHIFFRES.replace(/(\d{2})(?=\d)/g, '$1 ')}`;
const TELEPHONE_E164 = `+22501${CHIFFRES}`;
const CLIENTE = 'Mariam Bamba';

let premiere = { id: '', numero: '' };
let seconde = '';
let suiviSeconde = '';

async function telephone(browser: Browser): Promise<Page> {
  const contexte = await browser.newContext({ ...devices['Pixel 7'], locale: 'fr-FR', timezoneId: 'Africa/Abidjan' });
  return contexte.newPage();
}

test.describe.serial('guichet, doublons et réaffectation (étape 21)', () => {
  test('Aya saisit au guichet la réclamation d\'une cliente sans smartphone et imprime son récépissé', async ({ page }) => {
    await connecter(page, COMPTES.agent);
    await page.getByRole('button', { name: 'Nouvelle réclamation' }).click();
    await expect(page.getByRole('heading', { name: 'Nouvelle réclamation', level: 1 })).toBeVisible();
    await expect(page).toHaveURL(/\/reclamations\/nouvelle$/);

    // Sans agence ni coordonnées : les erreurs de l'API sous chaque champ
    await page.getByLabel('Catégorie', { exact: true }).selectOption({ label: 'Carte bancaire' });
    await page.getByLabel('Ce que dit le client').fill('Le distributeur de l\'agence a gardé sa carte hier soir après un retrait de 30 000 FCFA, sans délivrer les billets.');
    await page.getByLabel('Nom et prénom').fill(CLIENTE);
    await page.getByRole('checkbox', { name: /J'ai informé le client/ }).check();
    await page.getByRole('button', { name: 'Enregistrer la réclamation' }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByText('Un téléphone ou un e-mail au moins')).toBeVisible();
    await page.getByLabel('Téléphone', { exact: true }).fill(TELEPHONE);
    await page.getByRole('button', { name: 'Enregistrer la réclamation' }).click();
    await expect(page.getByText('Choisissez l\'agence du guichet')).toBeVisible();
    await expect(page.getByLabel('Téléphone', { exact: true })).toHaveValue(TELEPHONE);

    await capture(page, '01-saisie-a-corriger', ETAPE);
    await page.getByLabel('Agence du guichet').selectOption({ label: 'Plateau' });
    // Le champ corrigé perd son erreur, et l'alerte disparaît avec la dernière
    await expect(page.getByText('Choisissez l\'agence du guichet')).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await page.locator('input[type=file]').setInputFiles({ name: 'ticket-retrait.png', mimeType: 'image/png', buffer: PNG });
    await expect(page.getByText('ticket-retrait.png')).toBeVisible();
    await expect(page.getByRole('checkbox', { name: 'Me l\'assigner' })).toBeChecked();
    await capture(page, '02-saisie-guichet', ETAPE);
    await page.getByRole('button', { name: 'Enregistrer la réclamation' }).click();

    await expect(page.getByRole('heading', { name: 'Réclamation enregistrée' })).toBeVisible();
    const recepisse = page.getByRole('region', { name: 'Récépissé' });
    premiere.numero = (await recepisse.locator('.chiffres').filter({ hasText: /^ALP-\d{4}-\d{6}$/ }).first().textContent())!.trim();
    await expect(recepisse.getByRole('img', { name: 'QR code du suivi de la réclamation' })).toBeVisible();
    await expect(recepisse).toContainText(`+225 ${TELEPHONE}`);
    await expect(page.getByText('Elle vous est assignée.', { exact: false })).toBeVisible();
    await capture(page, '03-recepisse', ETAPE);

    // La cliente reçoit son numéro et son lien par SMS
    expect(await dernierMessage(TELEPHONE_E164, premiere.numero)).toContain('/suivi/');
    // Le consentement oral est au journal, au nom d'Aya
    const [audit] = await sql<{ action: string; acteur: string }>(
      `SELECT j.action, j.acteur_libelle AS acteur FROM journal_audit j
        JOIN reclamation r ON r.id::text = j.entite_id WHERE r.numero = $1 AND j.action = 'reclamation.saisie'`, [premiere.numero]);
    expect(audit).toEqual({ action: 'reclamation.saisie', acteur: 'Aya Konan' });

    await page.getByRole('button', { name: 'Ouvrir la fiche' }).click();
    await expect(page.getByRole('heading', { name: premiere.numero })).toBeVisible();
    premiere.id = page.url().split('/').at(-1)!;
    await expect(page.getByText('Au guichet de l\'agence')).toBeVisible();
    await expect(page.getByText('Saisie par Aya Konan, avec l\'accord du client')).toBeVisible();
    await expect(page.getByText('Saisie pour le client')).toBeVisible();
    await capture(page, '04-fiche-guichet', ETAPE);
  });

  test('la cliente a perdu son SMS : elle retrouve ses réclamations avec son numéro, puis redépose', async ({ browser }) => {
    const page = await telephone(browser);
    await page.goto(portail('alpha'));
    await expect(page.getByRole('heading', { name: 'Déposer ou suivre une réclamation' })).toBeVisible();
    await page.getByRole('button', { name: 'Retrouver mes réclamations' }).click();
    await expect(page.getByRole('heading', { name: 'Retrouver mes réclamations' })).toBeVisible();
    await page.getByLabel('Téléphone ou e-mail').fill(TELEPHONE);
    await capture(page, '05-retrouver', ETAPE);
    await page.getByRole('button', { name: 'Recevoir un code' }).click();
    await expect(page.getByRole('heading', { name: 'Saisissez le code reçu' })).toBeVisible();
    await saisirCode(page, await codeOtpRecu(TELEPHONE_E164));
    await page.getByRole('button', { name: 'Valider' }).click();
    await expect(page).toHaveURL(/\/mes-reclamations$/);
    await expect(page.getByText(premiere.numero)).toBeVisible();
    await capture(page, '06-espace-retrouve', ETAPE);

    // Un numéro inconnu reçoit la même réponse, sans code
    await page.goto(`${portail('alpha')}/retrouver`);
    await page.getByLabel('Téléphone ou e-mail').fill('05 00 00 00 01');
    await page.getByRole('button', { name: 'Recevoir un code' }).click();
    await expect(page.getByRole('heading', { name: 'Saisissez le code reçu' })).toBeVisible();
    expect(await sql('SELECT 1 FROM notification WHERE destination = $1', ['+2250500000001'])).toEqual([]);

    // Sans nouvelles, elle redépose la même réclamation par le QR code de l'agence
    await page.goto(`${portail('alpha')}/d/${QR_ALPHA}`);
    await expect(page.getByRole('link', { name: 'Retrouvez-la' })).toBeVisible();
    await page.getByText('Carte bancaire', { exact: true }).click();
    await page.getByLabel('Votre réclamation').fill('Ma carte est toujours bloquée dans le distributeur du Plateau, je n\'ai pas de nouvelles.');
    await page.getByLabel('Nom et prénom').fill(CLIENTE);
    await page.getByLabel('Téléphone').fill(TELEPHONE);
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Envoyer ma réclamation' }).click();
    await expect(page.getByRole('heading', { name: 'Réclamation envoyée' })).toBeVisible();
    seconde = (await page.locator('.select-all').textContent())!.trim();
    expect(seconde).not.toBe(premiere.numero);
    await page.getByRole('button', { name: 'Suivre ma réclamation' }).click();
    await expect(page).toHaveURL(/\/suivi\//);
    suiviSeconde = page.url();
    await page.context().close();
  });

  test('le superviseur voit le doublon possible et le rattache : un seul SMS, un seul suivi', async ({ page, browser }) => {
    await connecter(page, COMPTES.superviseur);
    await page.goto(`${CONSOLE}/reclamations?file=toutes&recherche=${encodeURIComponent(CLIENTE)}`);
    const ligne = page.getByRole('row', { name: new RegExp(seconde) });
    await expect(ligne.getByText('Doublon possible')).toBeVisible();
    await expect(page.getByRole('row', { name: new RegExp(premiere.numero) }).getByText('Doublon possible')).toBeVisible();
    await ligne.getByRole('link', { name: seconde }).click();
    await expect(page.getByRole('heading', { name: seconde })).toBeVisible();

    const bandeau = page.getByRole('note');
    await expect(bandeau).toContainText('Doublon possible.');
    await expect(bandeau.getByRole('link', { name: premiere.numero })).toBeVisible();
    const autres = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Du même client' }) });
    await expect(autres.getByRole('link', { name: premiere.numero })).toBeVisible();
    await capture(page, '07-doublon-possible', ETAPE);

    await page.getByRole('button', { name: 'Rattacher à…' }).click();
    const dialogue = page.getByRole('dialog', { name: 'Rattacher ce doublon' });
    await expect(dialogue.getByRole('radio', { name: new RegExp(premiere.numero) })).toBeChecked();
    await capture(page, '08-rattacher', ETAPE);
    await dialogue.getByRole('button', { name: 'Rattacher et clôturer' }).click();
    await expect(page.getByText(`Rattachée à ${premiere.numero} et clôturée : le client reçoit un seul message, avec le lien de celle-ci.`)).toBeVisible();
    await expect(page.getByText('Clôturée').first()).toBeVisible();
    await expect(page.getByText(/Les messages et les pièces jointes ci-dessous restent consultables/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Rattacher à…' })).toHaveCount(0);

    // Un seul message à la cliente, avec le lien de la principale
    const sms = await dernierMessage(TELEPHONE_E164, 'est jointe à');
    expect(sms).toContain(`${seconde} est jointe à ${premiere.numero}`);
    const [{ n }] = (await sql<{ n: string }>(
      "SELECT count(*) AS n FROM enquete_satisfaction e JOIN reclamation r ON r.id = e.reclamation_id WHERE r.numero = $1", [seconde])) as [{ n: string }];
    expect(Number(n), 'pas d\'enquête pour un doublon').toBe(0);

    // La principale montre son doublon ; le lien de suivi se renvoie aux seules coordonnées du dossier
    await page.getByRole('link', { name: premiere.numero }).first().click();
    await expect(page.getByRole('heading', { name: premiere.numero })).toBeVisible();
    const doublons = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Doublons rattachés' }) });
    await expect(doublons.getByRole('link', { name: seconde })).toBeVisible();
    await page.getByRole('button', { name: 'Renvoyer le lien de suivi' }).click();
    await expect(page.getByText(/^Lien de suivi renvoyé par SMS au \+225 01 •• •• •• \d{2}\.$/)).toBeVisible();
    await capture(page, '09-principale', ETAPE);

    // L'ancien lien de la cliente mène à la principale
    const client = await telephone(browser);
    await client.goto(suiviSeconde);
    await expect(client.getByRole('heading', { name: 'Jointe à votre autre réclamation' })).toBeVisible();
    await capture(client, '10-suivi-doublon', ETAPE);
    await client.getByRole('link', { name: `Suivre ${premiere.numero}` }).click();
    await expect(client.getByRole('heading', { name: premiere.numero })).toBeVisible();
    await client.context().close();
  });

  test('Mamadou absent : ses dossiers sont « à réassigner », le superviseur les répartit en lot', async ({ page }) => {
    await connecter(page, COMPTES.superviseur);
    await page.getByRole('link', { name: 'Absences' }).click();
    await expect(page.getByRole('heading', { name: 'Absences', level: 1 })).toBeVisible();
    await page.getByLabel('Agent').selectOption({ label: 'Mamadou Traoré' });
    await page.getByRole('button', { name: 'Déclarer l\'absence' }).click();
    await expect(page.getByText('Absence de Mamadou Traoré déclarée')).toBeVisible();
    const ligne = page.getByRole('row', { name: /Mamadou Traoré/ });
    const lien = ligne.getByRole('link', { name: /à réassigner$/ });
    await expect(lien).toBeVisible();
    const n = Number((await lien.textContent())!.match(/^(\d+)/)![1]);
    expect(n).toBeGreaterThan(0);
    await capture(page, '11-absences', ETAPE);

    await lien.click();
    await expect(page).toHaveURL(/file=a-reassigner/);
    await expect(page.getByRole('tab', { name: /À réassigner/, selected: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: /À réassigner/ })).toContainText(String(n));
    await page.getByRole('checkbox', { name: 'Tout sélectionner' }).check();
    await expect(page.getByRole('region', { name: 'Réclamations sélectionnées' })).toContainText(`${n} sélectionnée`);
    await capture(page, '12-a-reassigner', ETAPE);
    await page.getByRole('button', { name: 'Répartir entre les agents disponibles' }).click();
    await expect(page.getByText(new RegExp(`^${n} réclamations? assignées?\\.$`))).toBeVisible();
    await expect(page.getByText(/^Aucune réclamation (dans cette file|ne correspond)/)).toBeVisible();

    // Chacune à un agent présent, jamais à Mamadou
    const restantes = await sql<{ n: string }>(
      "SELECT count(*) AS n FROM reclamation r JOIN utilisateur u ON u.id = r.agent_id WHERE u.email = $1 AND r.statut <> 'CLOTUREE'", [COMPTES.agent2]);
    expect(Number(restantes[0]!.n)).toBe(0);

    // L'absence est retirée
    await page.getByRole('link', { name: 'Absences' }).click();
    await page.getByRole('button', { name: /^Retirer l'absence de Mamadou Traoré/ }).click();
    await expect(page.getByText('Absence de Mamadou Traoré retirée.')).toBeVisible();
  });
});
