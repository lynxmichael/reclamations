/**
 * Enquêtes de satisfaction (étape 15, phase 2), dans les vraies interfaces. Le jeu de démonstration
 * active les enquêtes pour la Banque Alpha et simule des réponses sur son historique.
 *
 * Le client confirme une réclamation résolue, reçoit le lien d'avis dans le SMS de clôture et
 * répond une fois. Le superviseur voit l'avis sur la fiche et la satisfaction au tableau de bord,
 * l'agent seulement la sienne, le Super Admin des totaux par banque, sans commentaire. Le Super
 * Admin active l'enquête banque par banque.
 */
import { devices, expect, test, type Browser, type Page } from '@playwright/test';
import { COMPTES, CONSOLE, capture, codeOtpRecu, connecter, dernierMessage, portail, saisirCode, sql } from './outils';

const COMMENTAIRE = 'Conseiller très clair, montant recrédité rapidement. Merci.';

interface Cible { id: string; numero: string; jeton: string; telephone: string }
let cible: Cible;

async function telephone(browser: Browser): Promise<Page> {
  const contexte = await browser.newContext({ ...devices['Pixel 7'], locale: 'fr-FR', timezoneId: 'Africa/Abidjan' });
  return contexte.newPage();
}

test.describe.serial('enquête de satisfaction (étape 15)', () => {
  test.beforeAll(async () => {
    // Une réclamation résolue de la Banque Alpha, dont le client a un téléphone
    const [r] = await sql<{ id: string; numero: string; jeton_suivi: string; telephone: string }>(`
      SELECT r.id, r.numero, r.jeton_suivi, c.telephone
        FROM reclamation r
        JOIN client_final c ON c.id = r.client_id
        JOIN banque b ON b.id = r.tenant_id
       WHERE b.slug = 'alpha' AND r.statut = 'RESOLUE' AND c.telephone IS NOT NULL
       ORDER BY r.resolue_le DESC
       LIMIT 1`);
    expect(r, 'une réclamation résolue dans le jeu de démonstration').toBeDefined();
    cible = { id: r!.id, numero: r!.numero, jeton: r!.jeton_suivi, telephone: r!.telephone };
  });

  test('le client confirme ; le SMS de clôture porte le lien d\'avis ; il répond une seule fois', async ({ browser }) => {
    const page = await telephone(browser);
    await page.goto(`${portail('alpha')}/suivi/${cible.jeton}`);
    await page.getByRole('button', { name: 'Recevoir un code' }).click();
    await saisirCode(page, await codeOtpRecu(cible.telephone));
    await page.getByRole('button', { name: 'Valider' }).click();
    await expect(page.getByRole('heading', { name: cible.numero })).toBeVisible();
    await page.getByRole('button', { name: 'Oui, clôturer ma réclamation' }).click();
    await expect(page.getByText('Merci : votre réclamation est clôturée.')).toBeVisible();

    // Un seul message de clôture, avec le lien de l'enquête (sans SMS de plus, décision I9)
    const sms = await dernierMessage(cible.telephone, '/avis');
    const lien = `${portail('alpha')}/suivi/${cible.jeton}/avis`;
    expect(sms).toBe(`Banque Alpha : réclamation ${cible.numero} close. Votre avis : ${lien}`);

    // L'espace client invite à donner son avis
    await expect(page.getByRole('heading', { name: 'Votre avis sur le traitement' })).toBeVisible();
    await page.getByRole('button', { name: 'Fermer le message' }).click();
    await capture(page, '01-invitation-avis', 15);
    await page.getByRole('button', { name: 'Donner mon avis' }).click();
    await expect(page).toHaveURL(lien);
    await expect(page.getByRole('heading', { name: 'Votre avis compte' })).toBeVisible();

    // Deux questions obligatoires ; les notes se choisissent aussi au clavier
    const envoyer = page.getByRole('button', { name: 'Envoyer mon avis' });
    await expect(envoyer).toBeDisabled();
    await page.getByRole('radio', { name: '3 sur 5, moyennement satisfait' }).check();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('radio', { name: '4 sur 5, satisfait' })).toBeChecked();
    await expect(page.getByText('Satisfait', { exact: true })).toBeVisible();
    await page.getByRole('radio', { name: '9 sur 10' }).check();
    await page.getByLabel(/Un commentaire/).fill(COMMENTAIRE);
    await capture(page, '02-avis-formulaire', 15);
    await envoyer.click();

    await expect(page.getByRole('heading', { name: 'Merci pour votre avis' })).toBeVisible();
    await expect(page.getByText(COMMENTAIRE)).toBeVisible();
    await capture(page, '03-avis-merci', 15);

    // La réponse ne se modifie plus : au rechargement, le formulaire ne revient pas
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Merci pour votre avis' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Envoyer mon avis' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Voir le suivi de ma réclamation' }).click();
    await expect(page.getByText('Merci, votre avis a bien été transmis à la banque.')).toBeVisible();
    await page.context().close();
  });

  test('après 7 jours sans réponse, l\'enquête est terminée', async ({ browser }) => {
    const [e] = await sql<{ jeton_suivi: string }>(`
      SELECT r.jeton_suivi FROM enquete_satisfaction e JOIN reclamation r ON r.id = e.reclamation_id
       WHERE e.repondu_le IS NULL AND e.expire_le < now() LIMIT 1`);
    expect(e, 'une enquête terminée dans l\'historique de démonstration').toBeDefined();
    const page = await telephone(browser);
    await page.goto(`${portail('alpha')}/suivi/${e!.jeton_suivi}/avis`);
    await expect(page.getByRole('heading', { name: 'Cette enquête est terminée' })).toBeVisible();
    await expect(page.getByRole('radio')).toHaveCount(0);
    await capture(page, '04-avis-termine', 15);
    await page.context().close();
  });

  test('le superviseur voit l\'avis sur la fiche et la satisfaction au tableau de bord', async ({ page }) => {
    await connecter(page, COMPTES.superviseur);
    await page.goto(`${CONSOLE}/reclamations/${cible.id}`);
    const panneau = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Avis du client' }) });
    await expect(panneau).toBeVisible();
    await expect(panneau).toContainText(/Satisfaction\s*4\s*\/ 5/);
    await expect(panneau).toContainText(/Recommandation\s*9\s*\/ 10/);
    await expect(panneau.getByText(COMMENTAIRE)).toBeVisible();
    await page.getByRole('heading', { name: 'Avis du client' }).scrollIntoViewIfNeeded();
    await capture(page, '05-fiche-avis', 15);

    await page.getByRole('link', { name: 'Tableau de bord' }).click();
    const satisfaction = page.getByRole('region', { name: 'Satisfaction des clients' });
    await expect(satisfaction).toBeVisible();
    // Le mois vient de commencer : les 30 derniers jours montrent l'historique simulé
    await page.getByLabel('Période').selectOption('30j');
    await expect(page).toHaveURL(/periode=30j/);
    for (const libelle of ['Taux de réponse', 'Clients satisfaits', 'Note moyenne', 'NPS', 'Par agent', 'Derniers commentaires']) {
      await expect(satisfaction.getByText(libelle, { exact: true }).first()).toBeVisible();
    }
    // Le commentaire le plus récent est le nôtre ; son numéro ouvre la fiche
    await expect(satisfaction.getByText(COMMENTAIRE)).toBeVisible();
    await satisfaction.scrollIntoViewIfNeeded();
    await capture(page, '06-tableau-satisfaction', 15);
    await satisfaction.getByRole('button', { name: cible.numero }).click();
    await expect(page.getByRole('heading', { name: cible.numero })).toBeVisible();
  });

  test('l\'agent ne voit que la satisfaction de ses réclamations', async ({ page }) => {
    await connecter(page, COMPTES.agent);
    await page.getByRole('link', { name: 'Tableau de bord' }).click();
    await expect(page.getByRole('heading', { name: 'Mon tableau de bord' })).toBeVisible();
    await page.getByLabel('Période').selectOption('30j');
    const satisfaction = page.getByRole('region', { name: 'Satisfaction des clients' });
    await expect(satisfaction).toBeVisible();
    await expect(satisfaction.getByText('Par agent', { exact: true })).toHaveCount(0);
    await satisfaction.scrollIntoViewIfNeeded();
    await capture(page, '07-tableau-agent', 15);
  });

  test('l\'Admin Entreprise lit le réglage, sans pouvoir le changer', async ({ page }) => {
    await connecter(page, COMPTES.admin);
    await page.getByRole('link', { name: 'Banque et apparence' }).click();
    await expect(page.getByText('Enquête de satisfaction', { exact: true })).toBeVisible();
    await expect(page.getByText('Oui, à la clôture')).toBeVisible();
    await expect(page.getByRole('checkbox', { name: /Enquête de satisfaction/ })).toHaveCount(0);
  });

  test('le Super Admin voit des totaux par banque, sans commentaire, et active l\'enquête banque par banque', async ({ page }) => {
    await connecter(page, COMPTES.superAdmin);
    await page.getByRole('link', { name: /Activité/ }).click();
    const panneau = page.getByRole('heading', { name: 'Satisfaction des clients' });
    await expect(panneau).toBeVisible();
    const tableau = page.getByRole('table').filter({ has: page.getByRole('columnheader', { name: 'NPS' }) });
    await expect(tableau.getByRole('row', { name: /Banque Alpha/ })).toBeVisible();
    await expect(page.getByText(COMMENTAIRE)).toHaveCount(0);
    // Le mois précédent, avec l'historique simulé
    await page.getByLabel('Mois').selectOption({ index: 1 });
    await expect(tableau.getByRole('row', { name: /Banque Alpha/ })).toBeVisible();
    await panneau.scrollIntoViewIfNeeded();
    await capture(page, '08-activite-satisfaction', 15);

    // Activation pour la Banque Horizon (désactivée par défaut), puis retour à l'état initial
    await page.getByRole('link', { name: 'Banques' }).click();
    await page.getByRole('button', { name: 'Ouvrir Banque Horizon' }).click();
    const caseEnquete = page.getByRole('checkbox', { name: /Enquête de satisfaction à la clôture/ });
    await expect(caseEnquete).not.toBeChecked();
    await caseEnquete.check();
    await capture(page, '09-activation-banque', 15);
    await page.getByRole('button', { name: 'Enregistrer les réglages' }).click();
    await expect(page.getByText('Réglages enregistrés.')).toBeVisible();
    await expect(page.getByRole('row', { name: /Banque Horizon/ })).toContainText('Enquête de satisfaction à la clôture');

    await page.getByRole('button', { name: 'Ouvrir Banque Horizon' }).click();
    await page.getByRole('checkbox', { name: /Enquête de satisfaction à la clôture/ }).uncheck();
    await page.getByRole('button', { name: 'Enregistrer les réglages' }).click();
    await expect(page.getByRole('row', { name: /Banque Horizon/ })).not.toContainText('Enquête de satisfaction');
  });
});
