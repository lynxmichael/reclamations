/**
 * Développement et vérification seulement : garantit que le rôle de connexion de l'application
 * (l'utilisateur de APP_DATABASE_URL, reclamations_app) existe, avec le mot de passe de cette
 * adresse, et qu'il porte les trois rôles d'accès.
 *
 * docker/postgres/init/02-roles.sh ne crée ce rôle qu'une fois, à la création du volume. Un
 * volume plus ancien (créé avant l'étape 3) ou un APP_DB_PASSWORD changé depuis laissaient
 * l'application sans connexion possible (erreur 28P01). Lancé avant les migrations par
 * `backend-installation` et par `verification` (docker-compose.yml) ; refusé en production,
 * où les rôles sont provisionnés une fois pour toutes.
 *
 *   npm run roles:dev
 */
import pg from 'pg';

const ROLES_ACCES = [
  ['acces_banque', 'NOLOGIN'],
  ['acces_plateforme', 'NOLOGIN'],
  ['acces_systeme', 'NOLOGIN BYPASSRLS'],
] as const;

async function connexionPossible(url: string): Promise<boolean> {
  const c = new pg.Client({ connectionString: url, connectionTimeoutMillis: 10_000 });
  try {
    await c.connect();
    return true;
  } catch (e) {
    // 28P01 : mot de passe refusé (ou rôle inconnu) ; toute autre erreur est un vrai problème
    if ((e as { code?: string }).code === '28P01') return false;
    throw e;
  } finally {
    await c.end().catch(() => undefined);
  }
}

async function principal() {
  if (process.env.NODE_ENV === 'production') throw new Error('Outil de développement : refusé en production');
  const urlProprietaire = process.env.DATABASE_URL;
  const urlApplication = process.env.APP_DATABASE_URL;
  if (!urlProprietaire || !urlApplication) throw new Error('DATABASE_URL et APP_DATABASE_URL sont nécessaires');

  const app = new URL(urlApplication);
  const role = decodeURIComponent(app.username);
  const motDePasse = decodeURIComponent(app.password);
  if (!role || !motDePasse) throw new Error('APP_DATABASE_URL doit contenir un utilisateur et un mot de passe');

  const pret = await connexionPossible(urlApplication);
  const c = new pg.Client({ connectionString: urlProprietaire });
  await c.connect();
  try {
    const existe = (await c.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role])).rowCount === 1;
    const id = c.escapeIdentifier(role);
    await c.query('BEGIN');
    for (const [nom, attributs] of ROLES_ACCES) {
      if ((await c.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [nom])).rowCount === 0) {
        await c.query(`CREATE ROLE ${nom} ${attributs}`);
      }
    }
    // NOINHERIT : sans « SET ROLE » explicite, ce rôle n'a aucun droit (étape 3)
    if (!existe) await c.query(`CREATE ROLE ${id} LOGIN NOINHERIT PASSWORD ${c.escapeLiteral(motDePasse)}`);
    else if (!pret) await c.query(`ALTER ROLE ${id} WITH LOGIN NOINHERIT PASSWORD ${c.escapeLiteral(motDePasse)}`);
    await c.query(`GRANT ${ROLES_ACCES.map(([nom]) => nom).join(', ')} TO ${id}`);
    await c.query('COMMIT');
    const etat = !existe ? 'créé' : !pret ? 'mot de passe réaligné sur APP_DATABASE_URL' : 'déjà prêt';
    console.log(`Rôle de connexion ${role} : ${etat}.`);
  } catch (e) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    await c.end();
  }
  if (!(await connexionPossible(urlApplication))) throw new Error(`${role} ne peut toujours pas se connecter : vérifier APP_DATABASE_URL`);
}

principal().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
