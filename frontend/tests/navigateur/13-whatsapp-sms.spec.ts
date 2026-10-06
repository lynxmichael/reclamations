/**
 * WhatsApp Business et SMS entrant (étape 20), dans les vraies interfaces. Le Super Admin raccorde les
 * numéros de la Banque Alpha et lui ouvre le chat, WhatsApp et le SMS entrant. Une cliente écrit sur
 * WhatsApp (webhook signé comme Meta le signe) : l'assistant automatique prépare avec elle sa
 * réclamation, qu'elle envoie en répondant OUI. Le superviseur la confie à Aya, qui lui répond depuis
 * la boîte de réception : la réponse part sur WhatsApp. Un client écrit par SMS : la réponse partira du
 * numéro de la banque. Le portail propose WhatsApp ; la plateforme voit les totaux du mois. À la fin,
 * le chat est refermé, ce qui referme WhatsApp et le SMS entrant.
 */
import { createHmac, randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { COMPTES, CONSOLE, QR_ALPHA, capture, connecter, dernierMessage, portail, sql } from './outils';

const ETAPE = 20;
const API = process.env.API_NAVIGATEUR ?? 'http://127.0.0.1:3300';
const SECRET_WHATSAPP = 'developpement-whatsapp-secret-0123456789';
const SECRET_SMS = 'developpement-sms-entrant-0123456789';
const WA = { numero: '+225 27 22 00 00 00', identifiant: '109876543210987', compte: '209876543210987', jeton: 'jeton-navigateur-whatsapp-0123456789' };
const SMS_BANQUE = '+2252722000001';
const AWA = '+2250707000123';
const KOUAME = '+2250707000456';
/** Les messages arrivent par relecture (5 à 10 s côté banque) */
const DIRECT = { timeout: 20_000 };

const signer = (corps: string, secret: string) => `sha256=${createHmac('sha256', secret).update(corps).digest('hex')}`;

/** Une cliente écrit sur WhatsApp : notification de Meta, signée. */
async function whatsapp(de: string, texte: string, nom = 'Awa Konan') {
  const corps = JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{
      id: WA.compte,
      changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: { display_phone_number: '2252722000000', phone_number_id: WA.identifiant },
          contacts: [{ wa_id: de.slice(1), profile: { name: nom } }],
          messages: [{ from: de.slice(1), id: `wamid.navigateur.${randomUUID()}`, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: texte } }],
        },
      }],
    }],
  });
  const r = await fetch(`${API}/api/v1/webhooks/whatsapp`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': signer(corps, SECRET_WHATSAPP) }, body: corps });
  expect(r.status, await r.clone().text()).toBe(200);
}

async function sms(de: string, texte: string) {
  const corps = JSON.stringify({ id: `sms-navigateur-${randomUUID()}`, de, vers: SMS_BANQUE, texte });
  const r = await fetch(`${API}/api/v1/webhooks/sms`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Signature': signer(corps, SECRET_SMS) }, body: corps });
  expect(r.status).toBe(200);
}

/** Fiche de la Banque Alpha dans la console de la plateforme. */
async function ficheAlpha(page: Page) {
  await connecter(page, COMPTES.superAdmin);
  await page.goto(`${CONSOLE}/plateforme/banques`);
  await page.getByRole('button', { name: 'Ouvrir Banque Alpha' }).click();
}

let reclamation: { id: string; numero: string };

test.describe.serial('WhatsApp et SMS entrant (étape 20)', () => {
  test('le Super Admin raccorde les numéros de la Banque Alpha, puis ouvre le chat, WhatsApp et le SMS', async ({ page }) => {
    await ficheAlpha(page);
    const caseWa = page.getByRole('checkbox', { name: /WhatsApp Business/ });
    await expect(caseWa).toBeDisabled();
    const r = page.getByTestId('raccordements');
    await r.getByLabel('Numéro de la banque').fill(WA.numero);
    await r.getByLabel('Identifiant du numéro chez Meta').fill(WA.identifiant);
    await r.getByLabel('Compte WhatsApp Business').fill(WA.compte);
    await r.getByLabel('Jeton d\'accès').fill(WA.jeton);
    await r.getByRole('button', { name: 'Raccorder le numéro WhatsApp' }).click();
    await expect(page.getByText('Numéro WhatsApp raccordé : ouvrez maintenant le canal à la banque.')).toBeVisible();
    await r.getByLabel('Numéro de réception').fill('+225 27 22 00 00 01');
    await r.getByRole('button', { name: 'Raccorder', exact: true }).click();
    await expect(page.getByText('Numéro SMS raccordé : ouvrez maintenant le canal à la banque.')).toBeVisible();
    // Le jeton est chiffré en base, jamais réaffiché
    const [ligne] = await sql<{ jeton_chiffre: string }>('SELECT jeton_chiffre FROM canal_banque WHERE canal = \'WHATSAPP\'');
    expect(ligne!.jeton_chiffre).toMatch(/^v1:/);
    await expect(r.getByLabel('Jeton d\'accès')).toHaveValue('');
    await page.getByRole('checkbox', { name: /Chat web et boîte de réception/ }).setChecked(true);
    await caseWa.setChecked(true);
    await page.getByRole('checkbox', { name: /SMS entrant/ }).setChecked(true);
    await r.scrollIntoViewIfNeeded();
    await capture(page, '01-super-admin-raccordement', ETAPE);
    await page.getByRole('button', { name: 'Enregistrer les réglages' }).click();
    await expect(page.getByText('Réglages enregistrés.')).toBeVisible();
    await expect(page.getByRole('row', { name: /Banque Alpha/ }).getByText('+225 27 22 00 00 00')).toBeVisible();
  });

  test('une cliente écrit sur WhatsApp : l\'assistant prépare sa réclamation, elle l\'envoie en répondant OUI', async () => {
    await whatsapp(AWA, 'Bonjour');
    expect(await dernierMessage(AWA, 'Decrivez votre probleme')).toContain('service reclamations de Banque Alpha');
    await whatsapp(AWA, 'Le distributeur du Plateau a avalé ma carte hier soir, je ne peux plus retirer.');
    const proposition = await dernierMessage(AWA, 'Repondez OUI');
    expect(proposition).toContain('- Sujet : Carte bancaire');
    await whatsapp(AWA, 'OUI');
    const accuse = await dernierMessage(AWA, 'est enregistree');
    const numero = accuse.match(/ALP-\d{4}-\d{6}/)![0];
    const [r] = await sql<{ id: string; canal: string }>('SELECT id, canal::text FROM reclamation WHERE numero = $1', [numero]);
    expect(r!.canal).toBe('WHATSAPP');
    reclamation = { id: r!.id, numero };
  });

  test('le superviseur la confie à Aya ; la boîte de réception montre le canal', async ({ page }) => {
    await connecter(page, COMPTES.superviseur);
    await page.goto(`${CONSOLE}/reclamations/${reclamation.id}`);
    await expect(page.getByText('WhatsApp, au numéro de la banque')).toBeVisible();
    await page.getByLabel('Agent assigné').selectOption({ label: 'Aya Konan' });
    await expect(page.getByLabel('Agent assigné')).toHaveValue(/.+/);
    await page.goto(`${CONSOLE}/conversations`);
    await expect(page.getByRole('button', { name: new RegExp(`Awa Konan, ${reclamation.numero}, WhatsApp`) })).toBeVisible(DIRECT);
  });

  test('Aya répond depuis la boîte de réception : la réponse part sur WhatsApp, telle quelle', async ({ page }) => {
    await whatsapp(AWA, 'Je suis passée à l\'agence, ils m\'ont dit d\'attendre votre appel.');
    await connecter(page, COMPTES.agent);
    await page.goto(`${CONSOLE}/conversations`);
    await page.getByRole('button', { name: new RegExp(`Awa Konan, ${reclamation.numero}, WhatsApp`) }).click();
    await expect(page.getByTestId('aide-envoi')).toContainText('Elle part sur WhatsApp');
    const zone = page.getByLabel('Réponse au client');
    await zone.fill('Bonjour Mme Konan, votre carte est au coffre de l\'agence du Plateau : vous pouvez la retirer dès demain avec une pièce d\'identité.');
    await capture(page, '02-boite-whatsapp', ETAPE);
    await page.getByRole('button', { name: 'Envoyer', exact: true }).click();
    await expect(page.getByRole('list', { name: 'Messages' }).getByText('votre carte est au coffre')).toBeVisible();
    const [n] = await sql<{ canal: string }>('SELECT canal::text FROM notification WHERE destination = $1 AND modele = \'conversation.reponse\'', [AWA]);
    expect(n!.canal).toBe('WHATSAPP');
    await page.goto(`${CONSOLE}/reclamations/${reclamation.id}`);
    await expect(page.getByText('a répondu au client sur WhatsApp').first()).toBeVisible();
    await capture(page, '03-fiche-whatsapp', ETAPE);
  });

  test('un client écrit par SMS : la réponse partira du numéro de la banque, SMS facturés comptés', async ({ page, browser }) => {
    await sms('07 07 00 04 56', 'Bonjour');
    expect((await sql<{ expediteur: string }>('SELECT expediteur FROM notification WHERE destination = $1 ORDER BY cree_le DESC LIMIT 1', [KOUAME]))[0]!.expediteur).toBe(SMS_BANQUE);
    await sms(KOUAME, 'Mon virement de salaire du 25 n\'est toujours pas arrivé sur mon compte.');
    await sms(KOUAME, 'OUI');
    await sms(KOUAME, 'Kouamé Yao');
    const accuse = await dernierMessage(KOUAME, 'est enregistree');
    const numero = accuse.match(/ALP-\d{4}-\d{6}/)![0];
    const [r] = await sql<{ id: string }>('SELECT id FROM reclamation WHERE numero = $1', [numero]);
    const superviseur = await (await browser.newContext({ locale: 'fr-FR', timezoneId: 'Africa/Abidjan', viewport: { width: 1440, height: 900 } })).newPage();
    await connecter(superviseur, COMPTES.superviseur);
    await superviseur.goto(`${CONSOLE}/reclamations/${r!.id}`);
    await superviseur.getByLabel('Agent assigné').selectOption({ label: 'Aya Konan' });
    await expect.poll(async () => (await sql<{ agent_id: string | null }>('SELECT agent_id FROM reclamation WHERE id = $1', [r!.id]))[0]!.agent_id).not.toBeNull();
    await superviseur.context().close();
    await connecter(page, COMPTES.agent);
    await page.goto(`${CONSOLE}/reclamations/${r!.id}`);
    await page.getByLabel('Réponse au client').fill('Bonjour M. Yao, le virement est arrivé ce matin : il apparaîtra sur votre compte ce soir.');
    await expect(page.getByTestId('aide-envoi')).toContainText('Elle part par SMS, du numéro de la banque : 1 SMS facturé');
    await capture(page, '04-fiche-sms', ETAPE);
  });

  test('le portail propose d\'écrire sur WhatsApp', async ({ page }) => {
    await page.goto(`${portail('alpha')}/d/${QR_ALPHA}`);
    const lien = page.getByTestId('lien-whatsapp');
    await expect(lien).toContainText('+225 27 22 00 00 00');
    await expect(lien).toHaveAttribute('href', 'https://wa.me/2252722000000');
    await capture(page, '05-portail-whatsapp', ETAPE);
  });

  test('l\'Admin Entreprise voit les numéros de la banque, à afficher en agence', async ({ page }) => {
    await connecter(page, COMPTES.admin);
    await page.goto(`${CONSOLE}/parametrage/agences`);
    const section = page.getByRole('region', { name: 'WhatsApp et SMS' });
    await expect(section).toContainText('+225 27 22 00 00 00');
    await expect(section).toContainText('+225 27 22 00 00 01');
    await section.scrollIntoViewIfNeeded();
    await capture(page, '06-numeros-banque', ETAPE);
  });

  test('la plateforme voit les totaux du mois, puis referme le chat, WhatsApp et le SMS', async ({ page }) => {
    // Pas de worker dans ces tests : on marque les messages WhatsApp remis comme il le ferait, et Meta en
    // déclare un facturable (statut « delivered » avec pricing)
    await sql('UPDATE notification SET statut = \'ENVOYEE\', envoyee_le = now() WHERE canal = \'WHATSAPP\' AND statut = \'EN_ATTENTE\'');
    await sql('UPDATE notification SET facturable = true, categorie_tarif = \'service\' WHERE id = (SELECT id FROM notification WHERE canal = \'WHATSAPP\' AND modele = \'conversation.reponse\' LIMIT 1)');
    await connecter(page, COMPTES.superAdmin);
    await page.goto(`${CONSOLE}/plateforme/activite`);
    const table = page.getByTestId('facturation-canaux');
    await expect(table.getByRole('row', { name: /Banque Alpha/ })).toBeVisible();
    const [n] = await sql<{ envoyes: number }>('SELECT count(*)::int AS envoyes FROM notification WHERE canal = \'WHATSAPP\' AND statut = \'ENVOYEE\'');
    await expect(table.getByRole('row', { name: /Banque Alpha/ }).getByRole('cell').nth(1)).toHaveText(String(n!.envoyes));
    await expect(table.getByRole('row', { name: /Banque Alpha/ }).getByRole('cell').nth(2)).toHaveText('1');
    await table.scrollIntoViewIfNeeded();
    await capture(page, '07-facturation-canaux', ETAPE);
    await page.goto(`${CONSOLE}/plateforme/banques`);
    await page.getByRole('button', { name: 'Ouvrir Banque Alpha' }).click();
    await page.getByRole('checkbox', { name: /Chat web et boîte de réception/ }).setChecked(false);
    await page.getByRole('button', { name: 'Enregistrer les réglages' }).click();
    await expect(page.getByText('Réglages enregistrés.')).toBeVisible();
    const [b] = await sql<{ chat_web: boolean; whatsapp: boolean; sms_entrant: boolean }>('SELECT chat_web, whatsapp, sms_entrant FROM banque WHERE slug = \'alpha\'');
    expect(b).toEqual({ chat_web: false, whatsapp: false, sms_entrant: false });
  });
});
