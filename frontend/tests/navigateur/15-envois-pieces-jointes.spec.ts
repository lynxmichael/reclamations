/**
 * Envois non remis et pièces jointes (étape 22), dans les vraies interfaces. Une cliente dépose au
 * portail une photo et un courrier Word : l'ancien format Word est écarté dès le choix du fichier ; un
 * relevé infecté (le fichier de test EICAR, sans danger) et un document Word à macros sont refusés par
 * l'API, avec la raison. Son SMS d'accusé n'arrive pas (accusé « non remis » de la passerelle, simulé) :
 * Aya, prévenue dans l'application, le voit sur la fiche et le renvoie ; la passerelle confirme ensuite
 * la remise. Makor voit les SMS remis et non remis dans la facturation.
 */
import { createHmac } from 'node:crypto';
import { devices, expect, test, type Browser, type Page } from '@playwright/test';
import { TYPE_DOCX, ancienDoc, docx, docxAMacros, pdfInfecte } from './fichiers';
import { COMPTES, CONSOLE, PNG, QR_ALPHA, capture, connecter, portail, sql } from './outils';

const ETAPE = 22;
const API = process.env.API_NAVIGATEUR ?? 'http://127.0.0.1:3300';
const SECRET_SMS = 'developpement-sms-entrant-0123456789';
// Un numéro par lancement : les limites (3 dépôts par heure et par numéro) vivent dans Redis
const CHIFFRES = String(Math.floor(10_000_000 + Math.random() * 89_999_999));
const TELEPHONE = `05 ${CHIFFRES.replace(/(\d{2})(?=\d)/g, '$1 ')}`;
const TELEPHONE_E164 = `+22505${CHIFFRES}`;
const MASQUE = `+225 05 •• •• •• ${CHIFFRES.slice(-2)}`;
const CLIENTE = 'Odile Gbagbo-Yao';

const COURRIER = docx('Madame, Monsieur, je conteste les frais de tenue de compte prélevés deux fois en septembre.');

let numero = '';
let id = '';

/** Le téléphone de la cliente, avec sa propre adresse IP (limites de dépôt par adresse) */
async function telephone(browser: Browser): Promise<Page> {
  const contexte = await browser.newContext({
    ...devices['Pixel 7'], locale: 'fr-FR', timezoneId: 'Africa/Abidjan', extraHTTPHeaders: { 'X-Forwarded-For': '198.51.100.22' },
  });
  return contexte.newPage();
}

/** Accusé de remise signé, comme l'enverrait la passerelle SMS de Makor */
async function accuseDeRemise(corps: Record<string, unknown>): Promise<number> {
  const brut = JSON.stringify(corps);
  const signature = `sha256=${createHmac('sha256', SECRET_SMS).update(brut).digest('hex')}`;
  const r = await fetch(`${API}/api/v1/webhooks/sms/remise`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Signature': signature }, body: brut });
  return r.status;
}

const smsDepot = async () => sql<{ id: string; statut: string; motif_echec: string | null }>(
  `SELECT n.id, n.statut::text, n.motif_echec FROM notification n JOIN reclamation r ON r.id = n.reclamation_id
    WHERE r.numero = $1 AND n.modele = 'client.depot' AND n.canal = 'SMS' ORDER BY n.cree_le, n.id`, [numero]);

test.describe.serial('envois non remis et pièces jointes (étape 22)', () => {
  test('au portail : Word accepté ; ancien .doc, fichier infecté et Word à macros refusés avec la raison', async ({ browser }) => {
    const page = await telephone(browser);
    await page.goto(`${portail('alpha')}/d/${QR_ALPHA}`);
    await page.getByText('Frais et prélèvements', { exact: true }).click();
    await page.getByLabel('Votre réclamation').fill('Les frais de tenue de compte de septembre ont été prélevés deux fois. Je joins mon courrier et mon relevé.');
    await page.getByLabel('Nom et prénom').fill(CLIENTE);
    await page.getByLabel('Téléphone').fill(TELEPHONE);
    await page.getByRole('checkbox').check();
    await expect(page.getByText('Word .docx sans macro')).toBeVisible();
    await expect(page.getByText('Chaque fichier est vérifié par un antivirus.')).toBeVisible();

    // L'ancien format Word est écarté dès le choix, avec ce qu'il faut faire
    const fichiers = page.locator('input[type=file]');
    await fichiers.setInputFiles({ name: 'lettre.doc', mimeType: 'application/msword', buffer: ancienDoc() });
    await expect(page.getByRole('alert')).toContainText('lettre.doc : ancien format Word, à enregistrer en .docx ou en PDF');

    // Un relevé infecté : refusé par l'antivirus, rien n'est enregistré
    await fichiers.setInputFiles([
      { name: 'courrier.docx', mimeType: TYPE_DOCX, buffer: COURRIER },
      { name: 'releve.pdf', mimeType: 'application/pdf', buffer: pdfInfecte() },
    ]);
    await expect(page.getByText('courrier.docx')).toBeVisible();
    await page.getByRole('button', { name: 'Envoyer ma réclamation' }).click();
    const erreur = page.getByRole('alert').filter({ hasText: 'Fichier infecté' });
    await expect(erreur).toContainText('« releve.pdf » contient un virus (Win.Test.EICAR_HDB-1) : rien n\'a été enregistré. Retirez ce fichier, puis réessayez.');
    await capture(page, '01-portail-fichier-infecte', ETAPE);
    expect(await sql('SELECT 1 FROM client_final WHERE telephone = $1', [TELEPHONE_E164])).toEqual([]);

    // Un document Word à macros, même nommé .docx : refusé par l'API
    await page.getByRole('button', { name: 'Retirer releve.pdf' }).click();
    await page.locator('input[type=file]').setInputFiles({ name: 'formulaire.docx', mimeType: TYPE_DOCX, buffer: docxAMacros() });
    await page.getByRole('button', { name: 'Envoyer ma réclamation' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Type de fichier non supporté' })).toContainText('« formulaire.docx » refusé : il contient des macros');

    // Le courrier Word et une photo : la réclamation part
    await page.getByRole('button', { name: 'Retirer formulaire.docx' }).click();
    await page.locator('input[type=file]').setInputFiles({ name: 'photo-releve.png', mimeType: 'image/png', buffer: PNG });
    await page.getByRole('button', { name: 'Envoyer ma réclamation' }).click();
    await expect(page.getByRole('heading', { name: 'Réclamation envoyée' })).toBeVisible();
    numero = (await page.locator('.select-all').textContent())!.trim();
    const pieces = await sql<{ nom_fichier: string; type_mime: string; antivirus: string }>(
      `SELECT p.nom_fichier, p.type_mime, p.antivirus::text FROM piece_jointe p JOIN reclamation r ON r.id = p.reclamation_id
        WHERE r.numero = $1 ORDER BY p.nom_fichier`, [numero]);
    expect(pieces).toEqual([
      { nom_fichier: 'courrier.docx', type_mime: TYPE_DOCX, antivirus: 'SAIN' },
      { nom_fichier: 'photo-releve.png', type_mime: 'image/png', antivirus: 'SAIN' },
    ]);
    await page.context().close();
  });

  test('le SMS d\'accusé n\'est pas remis : Aya est prévenue, le voit sur la fiche et le renvoie', async ({ page }) => {
    // Serge confie la réclamation à Aya
    await connecter(page, COMPTES.superviseur);
    await page.goto(`${CONSOLE}/reclamations?file=toutes&recherche=${encodeURIComponent(CLIENTE)}`);
    await page.getByRole('link', { name: numero }).click();
    await expect(page.getByRole('heading', { name: numero })).toBeVisible();
    id = page.url().split('/').at(-1)!;
    await page.getByLabel('Agent assigné').selectOption({ label: 'Aya Konan' });
    await expect(page.getByText('Réclamation assignée à Aya Konan.')).toBeVisible();

    // La passerelle signale l'accusé de dépôt non remis (téléphone éteint trop longtemps)
    const [sms] = await smsDepot();
    expect(await accuseDeRemise({ reference: sms!.id, statut: 'EXPIRE', code: 'DLR-EXP' })).toBe(200);
    expect((await smsDepot())[0]).toMatchObject({ statut: 'ECHEC', motif_echec: 'EXPIRE' });

    await page.context().clearCookies();
    await connecter(page, COMPTES.agent);
    // Prévenue dans l'application
    await page.getByRole('button', { name: /^Notifications/ }).click();
    const alerte = page.getByRole('dialog', { name: 'Notifications' }).getByRole('button', { name: new RegExp(`${numero} : « Accusé de dépôt » n'a pas été remis`) });
    await expect(alerte).toContainText(MASQUE);
    await expect(alerte).toContainText('téléphone resté éteint ou hors réseau');
    await capture(page, '02-alerte-agent', ETAPE);
    await page.keyboard.press('Escape');

    // Dans sa file, « Message non remis »
    await page.goto(`${CONSOLE}/reclamations?file=assignees`);
    const ligne = page.getByRole('row', { name: new RegExp(numero) });
    await expect(ligne.getByText('Message non remis')).toBeVisible();
    await capture(page, '03-file-message-non-remis', ETAPE);
    await ligne.getByRole('link', { name: numero }).click();

    // La fiche : le bandeau, les messages au client (coordonnée masquée), le courrier Word téléchargeable
    const bandeau = page.getByTestId('alerte-non-remis');
    await expect(bandeau).toContainText(`« Accusé de dépôt » n'a pas pu être remis par SMS au ${MASQUE} (téléphone resté éteint ou hors réseau)`);
    const envois = page.getByTestId('envois');
    await expect(envois.locator('li').first()).toContainText('Non remis');
    await expect(envois).not.toContainText(CHIFFRES);
    const telechargement = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Télécharger courrier.docx' }).click();
    expect((await telechargement).suggestedFilename()).toBe('courrier.docx');
    await capture(page, '04-fiche-message-non-remis', ETAPE);

    // Renvoyer : le même message, au même numéro ; plus de bandeau ni de second renvoi
    await bandeau.getByRole('button', { name: 'Renvoyer' }).click();
    await expect(page.getByText(`« Accusé de dépôt » renvoyé par SMS au ${MASQUE}`)).toBeVisible();
    await expect(page.getByTestId('alerte-non-remis')).toHaveCount(0);
    await expect(envois.locator('li').first()).toContainText('En cours d\'envoi');
    await expect(envois.getByRole('button', { name: /Renvoyer/ })).toHaveCount(0);
    const [ancien, copie] = await smsDepot();
    expect(copie).toMatchObject({ statut: 'EN_ATTENTE' });
    const [contenus] = await sql<{ identiques: boolean; destination: string }>(
      'SELECT a.contenu = b.contenu AS identiques, b.destination FROM notification a, notification b WHERE a.id = $1 AND b.id = $2', [ancien!.id, copie!.id]);
    expect(contenus).toEqual({ identiques: true, destination: TELEPHONE_E164 });

    // Le worker l'envoie (simulé : pas de worker pendant ces tests), la passerelle confirme la remise
    await sql('UPDATE notification SET statut = \'ENVOYEE\', envoyee_le = now(), tentatives = 1, segments_sms = 1, id_fournisseur = $2 WHERE id = $1', [copie!.id, `dlr-${CHIFFRES}`]);
    await page.reload();
    await expect(page.getByTestId('envois').locator('li').first()).toContainText('en attente de l\'accusé de remise');
    expect(await accuseDeRemise({ id: `dlr-${CHIFFRES}`, statut: 'REMIS' })).toBe(200);
    await page.reload();
    await expect(page.getByTestId('envois').locator('li').first()).toContainText('Remis');
    await capture(page, '05-fiche-renvoye-remis', ETAPE);
    await page.goto(`${CONSOLE}/reclamations?file=assignees`);
    await expect(page.getByRole('row', { name: new RegExp(numero) }).getByText('Message non remis')).toHaveCount(0);
    const [audit] = await sql<{ acteur: string }>(
      'SELECT acteur_libelle AS acteur FROM journal_audit WHERE entite_id = $1 AND action = \'reclamation.message_renvoye\'', [id]);
    expect(audit).toEqual({ acteur: 'Aya Konan' });
  });

  test('Makor : SMS remis et non remis dans la facturation du mois', async ({ page }) => {
    await connecter(page, COMPTES.superAdmin);
    await page.getByRole('link', { name: /Activité/ }).click();
    const tableau = page.getByRole('table').filter({ hasText: 'Segments facturés' });
    await expect(tableau.getByRole('columnheader', { name: 'Remis', exact: true })).toBeVisible();
    await expect(tableau.getByRole('columnheader', { name: 'Non remis' })).toBeVisible();
    await tableau.scrollIntoViewIfNeeded();
    await capture(page, '06-facturation-remis', ETAPE);
  });
});
