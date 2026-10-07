/**
 * Baromètre mensuel et recommandations (étape 23), dans les vraies interfaces. Le jeu de démonstration
 * a publié les baromètres des deux derniers mois écoulés de la Banque Alpha (par les règles : pas de
 * fournisseur d'IA pour ces tests), avec leur notification. Fatou (Admin Entreprise) y arrive par la
 * notification, lit le dernier, écarte une recommandation, revient sur sa décision puis la retient avec
 * un commentaire, et l'imprime ; Serge (superviseur) le lit sans décider ; Aya (agente) n'y a pas accès.
 * Makor ferme la fonction : la page quitte le menu ; puis la rouvre.
 */
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { COMPTES, CONSOLE, capture, connecter, sql } from './outils';

const ETAPE = 23;
const moisFr = (m: string) => new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(new Date(`${m}-01T00:00:00Z`));
const COMMENTAIRE = 'Point chaque matin sur la file « En retard » de la catégorie, jusqu\'à la fin du mois.';

/** Les mois publiés de la Banque Alpha, le plus récent d'abord */
let mois: string[] = [];

const recommandation = (ordre: number, m = mois[0]!) => sql<{ decision: string; commentaire: string | null; decideur: string | null }>(
  `SELECT r.decision, r.commentaire, u.prenom AS decideur FROM recommandation_barometre r JOIN barometre b ON b.id = r.barometre_id
     JOIN banque x ON x.id = b.tenant_id LEFT JOIN utilisateur u ON u.id = r.decidee_par_id
    WHERE x.slug = 'alpha' AND to_char(b.mois, 'YYYY-MM') = $1 AND r.ordre = $2`, [m, ordre]);

const menu = (page: Page) => page.getByRole('navigation', { name: 'Menu principal' });

async function reglages(page: Page) {
  await connecter(page, COMPTES.superAdmin);
  await page.goto(`${CONSOLE}/plateforme/banques`);
  await page.getByRole('button', { name: 'Ouvrir Banque Alpha' }).click();
  return page.getByRole('checkbox', { name: /Baromètre et recommandations/ });
}

test.describe.serial('baromètre mensuel et recommandations (étape 23)', () => {
  test.beforeAll(async () => {
    mois = (await sql<{ mois: string }>(
      'SELECT to_char(b.mois, \'YYYY-MM\') AS mois FROM barometre b JOIN banque x ON x.id = b.tenant_id WHERE x.slug = \'alpha\' ORDER BY b.mois DESC',
    )).map((l) => l.mois);
    expect(mois).toHaveLength(2);
    // Les notifications du semis, remises en tête et non lues (d'autres tests en ont ajouté depuis)
    await sql(`UPDATE notification SET lue_le = NULL, cree_le = now() WHERE modele = 'barometre.pret'
                 AND destinataire_utilisateur_id = (SELECT id FROM utilisateur WHERE email = $1)`, [COMPTES.admin]);
  });

  test.afterAll(async () => {
    await sql('UPDATE banque SET barometre = true WHERE slug = \'alpha\'');
  });

  test('Fatou arrive par la notification : chiffres du mois, tendance, irritants, ce que disent les clients', async ({ page }) => {
    await connecter(page, COMPTES.admin);
    await page.getByRole('button', { name: /^Notifications/ }).click();
    const avis = page.getByRole('dialog', { name: 'Notifications' }).getByRole('button', { name: new RegExp(`Baromètre (de |d')${moisFr(mois[0]!)}`) });
    await expect(avis).toContainText('est prêt');
    await avis.click();
    await expect(page).toHaveURL(`${CONSOLE}/barometre`);
    await expect(menu(page).getByRole('link', { name: 'Baromètre' })).toHaveAttribute('aria-current', 'page');

    await expect(page.getByRole('heading', { level: 1 })).toHaveText(`Baromètre de l'expérience client · ${moisFr(mois[0]!)}`);
    await expect(page.getByText('Analyse par les règles')).toBeVisible();
    const [m] = await sql<{ reclamations: number; irritant: string | null }>(
      `SELECT (contenu->'mesures'->>'reclamations')::int AS reclamations, contenu->'irritants'->0->>'libelle' AS irritant
         FROM barometre b JOIN banque x ON x.id = b.tenant_id WHERE x.slug = 'alpha' AND to_char(b.mois, 'YYYY-MM') = $1`, [mois[0]]);
    const tuiles = page.locator('dl').first();
    await expect(tuiles.locator('div', { hasText: 'Réclamations reçues' }).locator('dd').first()).toHaveText(String(m!.reclamations));
    await expect(tuiles).toContainText('Délais respectés');
    await expect(tuiles).toContainText('Clients satisfaits');
    await capture(page, '01-barometre-admin', ETAPE);

    // Tendance : trois petits graphiques, ou le tableau des 6 mois
    await expect(page.getByRole('img', { name: /^Réclamations reçues, 6 derniers mois/ })).toBeVisible();
    await page.getByRole('button', { name: 'Voir le tableau' }).click();
    const tableau = page.getByRole('table', { name: 'Les 6 derniers mois' });
    await expect(tableau.getByRole('row')).toHaveCount(7);
    await expect(tableau.getByRole('row').last()).toContainText(moisFr(mois[0]!));
    await page.getByRole('button', { name: 'Voir les graphiques' }).click();

    // Irritants : la première catégorie du baromètre en tête du tableau
    if (m!.irritant) {
      const irritants = page.locator('section', { has: page.getByRole('heading', { name: 'Irritants par catégorie' }) });
      await expect(irritants.getByRole('row').nth(1)).toContainText(m!.irritant);
      await irritants.scrollIntoViewIfNeeded();
      await capture(page, '03-irritants-clients', ETAPE);
    }
    await expect(page.getByRole('heading', { name: 'Ce que disent les clients' })).toBeVisible();
    await page.getByText('Comment lire ce baromètre').click();
    await expect(page.getByText(/Score d'irritation d'une catégorie ou d'une agence/)).toBeVisible();
  });

  test('Fatou écarte une recommandation, revient sur sa décision, puis la retient avec un commentaire', async ({ page }) => {
    await connecter(page, COMPTES.admin);
    await page.goto(`${CONSOLE}/barometre`);
    const carte = page.locator('li[data-recommandation="1"]');
    await expect(carte.getByText('À étudier')).toBeVisible();
    const titre = await carte.getByRole('heading', { level: 3 }).innerText();

    await carte.getByRole('button', { name: 'Écarter' }).click();
    await expect(page.getByText('Recommandation écartée.')).toBeVisible();
    await expect(carte).toContainText('Écartée par Fatou Diabaté');
    expect(await recommandation(1)).toEqual([{ decision: 'ECARTEE', commentaire: null, decideur: 'Fatou' }]);

    await carte.getByRole('button', { name: 'Revenir sur la décision' }).click();
    await expect(page.getByText('Recommandation remise à l\'étude.')).toBeVisible();
    await expect(carte.getByText('À étudier')).toBeVisible();

    await carte.getByLabel(/Commentaire/).fill(COMMENTAIRE);
    await carte.getByRole('button', { name: 'Retenir' }).click();
    await expect(page.getByText('Recommandation retenue.')).toBeVisible();
    await expect(carte).toContainText('Retenue par Fatou Diabaté');
    await expect(carte.getByRole('heading', { level: 3 })).toHaveText(titre);
    expect(await recommandation(1)).toEqual([{ decision: 'RETENUE', commentaire: COMMENTAIRE, decideur: 'Fatou' }]);
    const journal = await sql<{ n: number }>('SELECT count(*)::int AS n FROM journal_audit WHERE action = \'barometre.recommandation\' AND acteur_libelle = \'Fatou Diabaté\'');
    expect(journal[0]!.n).toBe(3);
    await carte.scrollIntoViewIfNeeded();
    await capture(page, '02-recommandations', ETAPE);

    // Le mois d'avant, dans la liste ; la décision prise au semis y est
    await page.getByLabel('Mois du baromètre').selectOption(mois[1]!);
    await expect(page).toHaveURL(`${CONSOLE}/barometre?mois=${mois[1]}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(`Baromètre de l'expérience client · ${moisFr(mois[1]!)}`);
    const [ancienne] = await recommandation(1, mois[1]);
    if (ancienne) await expect(page.locator('li[data-recommandation="1"]')).toContainText('Retenue par Fatou Diabaté');
  });

  test('à l\'impression : la page seule, sans menu ni commandes', async ({ page }) => {
    await connecter(page, COMPTES.admin);
    await page.goto(`${CONSOLE}/barometre`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    // À peu près la largeur d'une feuille A4 : les graphiques se mesurent à la taille du papier
    await page.setViewportSize({ width: 820, height: 1160 });
    await page.emulateMedia({ media: 'print' });
    await expect(menu(page)).toBeHidden();
    await expect(page.getByRole('button', { name: 'Imprimer' })).toBeHidden();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    // Le commentaire de Fatou s'imprime en texte (la zone de saisie, elle, ne s'imprime pas)
    await expect(page.locator('p', { hasText: COMMENTAIRE })).toBeVisible();
    await expect(page.getByRole('textbox', { name: /Commentaire/ }).first()).toBeHidden();
    await capture(page, '06-impression', ETAPE);
    if (process.env.CAPTURES === '1') {
      await page.pdf({ path: resolve(import.meta.dirname, '../../../docs/etape-23-captures/barometre-imprime.pdf'), format: 'A4', printBackground: true, margin: { top: '12mm', bottom: '12mm', left: '10mm', right: '10mm' } });
    }
    await page.emulateMedia({ media: 'screen' });
  });

  test('Serge lit sans décider ; Aya n\'y a pas accès', async ({ page }) => {
    await connecter(page, COMPTES.superviseur);
    await menu(page).getByRole('link', { name: 'Baromètre' }).click();
    const carte = page.locator('li[data-recommandation="1"]');
    await expect(carte).toContainText('Retenue par Fatou Diabaté');
    await expect(carte).toContainText(COMMENTAIRE);
    await expect(page.getByRole('button', { name: 'Retenir' })).toHaveCount(0);
    await expect(page.getByText('L\'Admin Entreprise retient ou écarte chacune.')).toBeVisible();
    await capture(page, '04-superviseur', ETAPE);

    await page.context().clearCookies();
    await connecter(page, COMPTES.agent);
    await expect(menu(page).getByRole('link', { name: 'Tableau de bord' })).toBeVisible();
    await expect(menu(page).getByRole('link', { name: 'Baromètre' })).toHaveCount(0);
    await page.goto(`${CONSOLE}/barometre`);
    await expect(page.getByRole('heading', { name: 'Page réservée' })).toBeVisible();
  });

  test('Makor ferme la fonction : la page quitte le menu, l\'API refuse ; puis la rouvre', async ({ page }) => {
    const barometre = await reglages(page);
    await expect(barometre).toBeChecked();
    await barometre.scrollIntoViewIfNeeded();
    await capture(page, '05-plateforme-reglage', ETAPE);
    await barometre.uncheck();
    await page.getByRole('button', { name: 'Enregistrer les réglages' }).click();
    await expect(page.getByText('Réglages enregistrés.')).toBeVisible();
    expect(await sql('SELECT barometre FROM banque WHERE slug = \'alpha\'')).toEqual([{ barometre: false }]);

    await page.context().clearCookies();
    await connecter(page, COMPTES.admin);
    await expect(menu(page).getByRole('link', { name: 'Réclamations' })).toBeVisible();
    await expect(menu(page).getByRole('link', { name: 'Baromètre' })).toHaveCount(0);
    await page.goto(`${CONSOLE}/barometre`);
    await expect(page.getByText('Le baromètre n\'est pas ouvert à votre banque : adressez-vous à Makor')).toBeVisible();
    // Les baromètres publiés restent en base
    expect((await sql('SELECT 1 FROM barometre b JOIN banque x ON x.id = b.tenant_id WHERE x.slug = \'alpha\'')).length).toBe(2);

    await page.context().clearCookies();
    const encore = await reglages(page);
    await encore.check();
    await page.getByRole('button', { name: 'Enregistrer les réglages' }).click();
    await expect(page.getByText('Réglages enregistrés.')).toBeVisible();
    expect(await sql('SELECT barometre FROM banque WHERE slug = \'alpha\'')).toEqual([{ barometre: true }]);
  });
});
