/**
 * Attribution et escalade automatiques (étape 16, phase 2), dans les vraies interfaces. Le jeu de
 * démonstration ouvre la fonction à la Banque Alpha, en mode suggestion, avec trois groupes
 * d'agents : Monétique (Aya, Mamadou), Comptes et crédits (Mamadou, Ibrahim), Agence de Bouaké.
 *
 * L'Admin Entreprise règle groupes, catégories et seuils ; le superviseur valide l'agent proposé et
 * déclare les absences ; en mode automatique, la réclamation part au dépôt ; au-delà du seuil,
 * l'Admin Entreprise est prévenu. Le serveur des tests n'a pas de worker : un passage des tâches
 * planifiées est lancé à la demande (backend/scripts/taches.ts). Les réglages reviennent à l'état
 * initial à la fin.
 */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { devices, expect, test, type Browser, type Page } from '@playwright/test';
import { COMPTES, CONSOLE, QR_ALPHA, capture, connecter, portail, sql } from './outils';

const ETAPE = 16;

type Horaire = { jour_semaine: number; debut_minute: number; fin_minute: number };
let horaires: Horaire[] = [];
let alphaId = '';
let numeroAuto = '';

async function telephone(browser: Browser): Promise<Page> {
  const contexte = await browser.newContext({ ...devices['Pixel 7'], locale: 'fr-FR', timezoneId: 'Africa/Abidjan' });
  return contexte.newPage();
}

/** Un client dépose une réclamation « Carte bancaire » par le QR code de l'agence Plateau. */
async function deposer(browser: Browser, telephoneClient: string): Promise<string> {
  const page = await telephone(browser);
  await page.goto(`${portail('alpha')}/d/${QR_ALPHA}`);
  await page.getByText('Carte bancaire', { exact: true }).click();
  await page.getByLabel('Votre réclamation').fill('Ma carte a été avalée par le distributeur de l\'agence ce matin.');
  await page.getByLabel('Nom et prénom').fill('Rokia Diallo');
  await page.getByLabel('Téléphone').fill(telephoneClient);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Envoyer ma réclamation' }).click();
  await expect(page.getByRole('heading', { name: 'Réclamation envoyée' })).toBeVisible();
  const numero = (await page.locator('.select-all').textContent())!.trim();
  await page.context().close();
  return numero;
}

/** Un passage des tâches du worker, tout de suite, sur la base des tests navigateur. */
function taches() {
  execFileSync('npx', ['tsx', 'scripts/taches.ts', '--base', 'reclamations_navigateur'], {
    cwd: resolve(import.meta.dirname, '../../../backend'), stdio: 'pipe', env: process.env, shell: process.platform === 'win32',
  });
}

async function ouvrirAttribution(page: Page) {
  await page.getByRole('link', { name: 'Attribution et escalade' }).click();
  await expect(page.getByRole('heading', { name: 'Attribution et escalade', level: 1 })).toBeVisible();
}

async function changerMode(page: Page, mode: 'Manuelle' | 'Suggestion' | 'Automatique', message: RegExp) {
  await page.getByRole('radio', { name: new RegExp(`^${mode}`) }).check();
  await expect(page.getByText(message)).toBeVisible();
  await expect(page.getByRole('radio', { name: new RegExp(`^${mode}`) })).toBeChecked();
}

test.describe.serial('attribution et escalade automatiques (étape 16)', () => {
  test.beforeAll(async () => {
    [{ id: alphaId }] = await sql<{ id: string }>(`SELECT id FROM banque WHERE slug = 'alpha'`);
    horaires = await sql<Horaire>('SELECT jour_semaine, debut_minute, fin_minute FROM horaire_ouvre WHERE tenant_id = $1', [alphaId]);
  });

  test.afterAll(async () => {
    // Horaires de la banque, si un test les a retirés
    const [{ n }] = await sql<{ n: string }>('SELECT count(*) AS n FROM horaire_ouvre WHERE tenant_id = $1', [alphaId]);
    if (Number(n) === 0) {
      for (const h of horaires) {
        await sql('INSERT INTO horaire_ouvre (id, tenant_id, jour_semaine, debut_minute, fin_minute, modifie_le) VALUES (gen_random_uuid(), $1, $2, $3, $4, now())', [alphaId, h.jour_semaine, h.debut_minute, h.fin_minute]);
      }
    }
  });

  test('l\'Admin Entreprise compose un groupe, lui confie une catégorie, puis le supprime', async ({ page }) => {
    await connecter(page, COMPTES.admin);
    await ouvrirAttribution(page);
    await expect(page.getByRole('radio', { name: /^Suggestion/ })).toBeChecked();
    const monetique = page.getByRole('article', { name: 'Groupe Monétique' });
    await expect(monetique).toContainText('Aya Konan');
    await expect(monetique).toContainText('Reçoit : Carte bancaire, Banque mobile, Fraude suspectée');
    await expect(page.getByRole('article', { name: 'Groupe Agence de Bouaké' })).toContainText('agence Bouaké Commerce');
    await expect(page.getByLabel('Seuil d\'escalade de la banque, réclamations normales')).toHaveValue('150');
    await capture(page, '01-attribution-admin', ETAPE);

    await page.getByRole('button', { name: 'Nouveau groupe' }).click();
    const fenetre = page.getByRole('dialog', { name: 'Nouveau groupe d\'agents' });
    await fenetre.getByLabel('Nom du groupe').fill('Litiges');
    await fenetre.getByRole('checkbox', { name: 'Ibrahim Coulibaly' }).check();
    await fenetre.getByRole('checkbox', { name: 'Mamadou Traoré' }).check();
    await capture(page, '02-nouveau-groupe', ETAPE);
    await fenetre.getByRole('button', { name: 'Créer le groupe' }).click();
    await expect(page.getByText('Groupe « Litiges » créé')).toBeVisible();
    const litiges = page.getByRole('article', { name: 'Groupe Litiges' });
    await expect(litiges).toContainText('Aucune catégorie ni agence');

    // La catégorie Crédit passe au nouveau groupe, avec son propre seuil d'escalade
    await page.getByLabel('Groupe de la catégorie Crédit').selectOption({ label: 'Litiges' });
    await page.getByLabel('Seuil d\'escalade, Crédit, réclamations normales').fill('200');
    await page.getByRole('heading', { name: 'Escalade', exact: true }).scrollIntoViewIfNeeded();
    await capture(page, '03-regles-escalade', ETAPE);
    await page.getByRole('button', { name: 'Enregistrer les règles' }).click();
    await expect(page.getByText('Règles enregistrées')).toBeVisible();
    await expect(litiges).toContainText('Reçoit : Crédit');
    await expect(page.getByLabel('Seuil d\'escalade, Crédit, réclamations normales')).toHaveValue('200');

    // Supprimé : la catégorie n'a plus de groupe ; on rétablit l'état initial
    await page.getByRole('button', { name: 'Supprimer le groupe Litiges' }).click();
    await page.getByRole('dialog', { name: 'Supprimer le groupe Litiges ?' }).getByRole('button', { name: 'Supprimer' }).click();
    await expect(page.getByText('Groupe « Litiges » supprimé.')).toBeVisible();
    await expect(page.getByLabel('Groupe de la catégorie Crédit')).toHaveValue('');
    await page.getByLabel('Groupe de la catégorie Crédit').selectOption({ label: 'Comptes et crédits' });
    await page.getByLabel('Seuil d\'escalade, Crédit, réclamations normales').fill('');
    await page.getByRole('button', { name: 'Enregistrer les règles' }).click();
    await expect(page.getByRole('article', { name: 'Groupe Comptes et crédits' })).toContainText('Crédit');
  });

  test('le superviseur voit l\'agent proposé ; une absence le change ; il valide', async ({ page, browser }) => {
    // Une réclamation déposée maintenant et une autre, pas encore assignées, d'une catégorie qui a un groupe
    const nouvelle = await deposer(browser, '07 31 42 53 65');
    const libres = await sql<{ id: string; numero: string }>(`
      SELECT r.id, r.numero FROM reclamation r JOIN categorie c ON c.id = r.categorie_id
       WHERE r.tenant_id = $1 AND r.statut = 'OUVERTE' AND r.agent_id IS NULL AND c.groupe_id IS NOT NULL
       ORDER BY r.cree_le DESC LIMIT 2`, [alphaId]);
    expect(libres, 'deux réclamations à assigner').toHaveLength(2);
    expect(libres[0]!.numero).toBe(nouvelle);
    const [fiche, ligne] = libres as [{ id: string; numero: string }, { id: string; numero: string }];

    await connecter(page, COMPTES.superviseur);
    await expect(page.getByRole('tab', { name: /Reçues/, selected: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Assigner ALP-.* à / }).first()).toBeVisible();
    await capture(page, '04-file-suggestions', ETAPE);

    await page.goto(`${CONSOLE}/reclamations/${fiche.id}`);
    const suggestion = page.getByRole('region', { name: 'Attribution suggérée' });
    await expect(suggestion).toBeVisible();
    const propose = (await suggestion.getByRole('button', { name: /^Assigner à / }).textContent())!.replace('Assigner à ', '').trim();
    await capture(page, '05-fiche-suggestion', ETAPE);

    // L'agent proposé est absent aujourd'hui : un autre agent du groupe est proposé
    await page.getByRole('link', { name: 'Absences' }).click();
    await expect(page.getByRole('heading', { name: 'Absences', level: 1 })).toBeVisible();
    await page.getByLabel('Agent').selectOption({ label: propose });
    await page.getByRole('button', { name: 'Déclarer l\'absence' }).click();
    await expect(page.getByText(`Absence de ${propose} déclarée`)).toBeVisible();
    await expect(page.getByRole('row', { name: new RegExp(propose) })).toContainText('En cours');
    await capture(page, '06-absences', ETAPE);

    await page.goto(`${CONSOLE}/reclamations/${fiche.id}`);
    const autre = (await suggestion.getByRole('button', { name: /^Assigner à / }).textContent())!.replace('Assigner à ', '').trim();
    expect(autre).not.toBe(propose);
    await suggestion.getByRole('button', { name: `Assigner à ${autre}` }).click();
    await expect(page.getByText(`Réclamation assignée à ${autre}.`)).toBeVisible();
    await expect(suggestion).toHaveCount(0);
    await expect(page.getByLabel('Agent assigné')).toHaveValue(/.+/);

    // Depuis la file : valider d'un clic, sans ouvrir la fiche
    await page.goto(`${CONSOLE}/reclamations?recherche=${ligne.numero}&file=toutes`);
    const valider = page.getByRole('button', { name: new RegExp(`^Assigner ${ligne.numero} à `) });
    const agent = (await valider.getAttribute('aria-label'))!.replace(`Assigner ${ligne.numero} à `, '');
    expect(agent).not.toBe(propose);
    await valider.click();
    await expect(page.getByText(`${ligne.numero} assignée à ${agent}.`)).toBeVisible();

    // L'absence est retirée
    await page.getByRole('link', { name: 'Absences' }).click();
    await page.getByRole('button', { name: new RegExp(`^Retirer l'absence de ${propose}`) }).click();
    await expect(page.getByText(`Absence de ${propose} retirée.`)).toBeVisible();
  });

  test('mode automatique : la réclamation part au dépôt, l\'historique le dit', async ({ page, browser }) => {
    // Banque ouverte à toute heure le temps du test : hors des heures d'ouverture, rien ne serait attribué
    await sql('DELETE FROM horaire_ouvre WHERE tenant_id = $1', [alphaId]);
    try {
      await connecter(page, COMPTES.admin);
      await ouvrirAttribution(page);
      await changerMode(page, 'Automatique', /Attribution automatique : chaque nouvelle réclamation/);

      numeroAuto = await deposer(browser, '07 31 42 53 64');
      const [t] = await sql<{ id: string; agent_id: string | null; agent: string | null }>(`
        SELECT r.id, r.agent_id, u.prenom || ' ' || u.nom AS agent FROM reclamation r LEFT JOIN utilisateur u ON u.id = r.agent_id WHERE r.numero = $1`, [numeroAuto]);
      expect(t!.agent, 'attribuée au dépôt').toMatch(/^(Aya Konan|Mamadou Traoré)$/);

      await page.goto(`${CONSOLE}/reclamations/${t!.id}`);
      await expect(page.getByRole('heading', { name: numeroAuto })).toBeVisible();
      const chronologie = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Chronologie' }) });
      await expect(chronologie.getByText('Attribution automatique')).toBeVisible();
      await expect(chronologie.getByText(/, le système/).first()).toBeVisible();
      // Vue de l'Admin Entreprise : l'agent assigné, en lecture
      await expect(page.locator('dd').filter({ hasText: t!.agent! }).first()).toBeVisible();
      await chronologie.scrollIntoViewIfNeeded();
      await capture(page, '07-attribution-automatique', ETAPE);

      await ouvrirAttribution(page);
      await changerMode(page, 'Suggestion', /Mode suggestion/);
    } finally {
      for (const h of horaires) {
        await sql('INSERT INTO horaire_ouvre (id, tenant_id, jour_semaine, debut_minute, fin_minute, modifie_le) VALUES (gen_random_uuid(), $1, $2, $3, $4, now())', [alphaId, h.jour_semaine, h.debut_minute, h.fin_minute]);
      }
    }
  });

  test('au-delà du seuil (150 %), l\'Admin Entreprise est prévenu et la fiche le montre', async ({ page }) => {
    // La réclamation attribuée au dépôt est très en retard : un passage des tâches du worker
    await sql(`UPDATE reclamation SET alerte_preventive_le = now() - interval '21 days', echeance_sla_le = now() - interval '20 days' WHERE numero = $1`, [numeroAuto]);
    taches();
    const [t] = await sql<{ id: string; escaladee_admin_le: Date | null }>('SELECT id, escaladee_admin_le FROM reclamation WHERE numero = $1', [numeroAuto]);
    expect(t!.escaladee_admin_le).not.toBeNull();

    await connecter(page, COMPTES.admin);
    await page.getByRole('button', { name: /^Notifications/ }).click();
    const notification = page.getByRole('dialog', { name: 'Notifications' }).getByRole('button', { name: new RegExp(`${numeroAuto} : retard important`) });
    await expect(notification).toBeVisible();
    await notification.click();
    await expect(page.getByRole('heading', { name: numeroAuto })).toBeVisible();
    await expect(page.getByText('Escaladée à l\'Admin Entreprise', { exact: true }).first()).toBeVisible();
    const chronologie = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Chronologie' }) });
    // Événements internes, invisibles du client
    for (const e of ['Délai SLA dépassé', 'Escalade', 'Escalade à l\'Admin Entreprise']) {
      await expect(chronologie.getByText(new RegExp(`^${e}\\s*\\(interne\\)$`))).toBeVisible();
    }
    await capture(page, '08-escalade-admin', ETAPE);
  });

  test('le Super Admin ouvre la fonction banque par banque', async ({ page }) => {
    await connecter(page, COMPTES.superAdmin);
    await page.getByRole('link', { name: 'Banques' }).click();
    await expect(page.getByRole('row', { name: /Banque Alpha/ })).toContainText('Attribution et escalade automatiques');
    await page.getByRole('button', { name: 'Ouvrir Banque Horizon' }).click();
    const caseAttribution = page.getByRole('checkbox', { name: /Attribution et escalade automatiques/ });
    await expect(caseAttribution).not.toBeChecked();
    await caseAttribution.check();
    await capture(page, '09-activation-banque', ETAPE);
    await page.getByRole('button', { name: 'Enregistrer les réglages' }).click();
    await expect(page.getByText('Réglages enregistrés.')).toBeVisible();
    await expect(page.getByRole('row', { name: /Banque Horizon/ })).toContainText('Attribution et escalade automatiques');

    await page.getByRole('button', { name: 'Ouvrir Banque Horizon' }).click();
    await page.getByRole('checkbox', { name: /Attribution et escalade automatiques/ }).uncheck();
    await page.getByRole('button', { name: 'Enregistrer les réglages' }).click();
    await expect(page.getByRole('row', { name: /Banque Horizon/ })).not.toContainText('Attribution et escalade');
  });

  test('fonction fermée : ni page ni suggestion pour la banque', async ({ page }) => {
    await connecter(page, 'awa.bamba@banque-horizon.example');
    await expect(page.getByRole('link', { name: 'Attribution et escalade' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Absences' })).toHaveCount(0);
    await page.getByRole('link', { name: 'Banque et apparence' }).click();
    const libelle = page.getByText('Attribution et escalade automatiques', { exact: true });
    await expect(libelle).toBeVisible();
    await expect(libelle.locator('xpath=..')).toContainText('Non');
  });
});
