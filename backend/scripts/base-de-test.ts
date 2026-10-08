import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import pg from "pg";

export const NOM_BASE_E2E = "reclamations_e2e";

/** DATABASE_URL (propriétaire) et APP_DATABASE_URL (rôle de l'application), repointées sur une base jetable. */
export function urlsBase(
  nom: string,
  env = process.env,
): { proprietaire: string; application: string } {
  const proprietaire = env.DATABASE_URL;
  const application = env.APP_DATABASE_URL;
  if (!proprietaire || !application)
    throw new Error(
      "DATABASE_URL et APP_DATABASE_URL sont nécessaires aux tests",
    );
  if (!/^[a-z_][a-z0-9_]*$/.test(nom))
    throw new Error(`Nom de base invalide : ${nom}`);
  const vers = (url: string) => {
    const u = new URL(url);
    u.pathname = `/${nom}`;
    return u.toString();
  };
  return { proprietaire: vers(proprietaire), application: vers(application) };
}

/** Bases des tests de bout en bout de l'API. */
export function urlsE2E(env = process.env): {
  proprietaire: string;
  application: string;
} {
  return urlsBase(NOM_BASE_E2E, env);
}

/** Recrée la base désignée par l'adresse (nom de la base = chemin de l'URL), puis applique les migrations. */
export async function recreerBase(urlProprietaire: string): Promise<void> {
  const cible = new URL(urlProprietaire);
  const nom = cible.pathname.slice(1);
  if (!/^[a-z_][a-z0-9_]*$/.test(nom) || !/test|e2e|navigateur|verif/.test(nom))
    throw new Error(`Refusé : « ${nom} » n'est pas une base jetable`);
  const admin = new URL(urlProprietaire);
  admin.pathname = "/postgres";
  admin.search = "";
  const c = new pg.Client({ connectionString: admin.toString() });
  await c.connect();
  try {
    await c.query(`DROP DATABASE IF EXISTS ${nom} WITH (FORCE)`);
    await c.query(
      `CREATE DATABASE ${nom} TEMPLATE template0 ENCODING 'UTF8' LOCALE_PROVIDER icu ICU_LOCALE 'fr-FR' LOCALE 'C.UTF-8'`,
    );
    // Base jetable : une validation n'attend pas l'écriture sur disque. Rien ne change pour les tests,
    // sinon la vitesse là où le disque est lent (Docker Desktop sous Windows : 5 à 10 fois plus lent)
    await c.query(`ALTER DATABASE ${nom} SET synchronous_commit = off`);
  } finally {
    await c.end();
  }
  cible.search = "";
  const base = new pg.Client({ connectionString: cible.toString() });
  await base.connect();
  try {
    // scripts/ (tsx) ou dist/scripts/ (compilé)
    const dossier = [
      resolve(__dirname, "../prisma/migrations"),
      resolve(__dirname, "../../prisma/migrations"),
    ].find((d) => existsSync(d))!;
    for (const dossierMigration of readdirSync(dossier)
      .filter((n) => /^\d{14}_/.test(n))
      .sort()) {
      await base.query(
        readFileSync(join(dossier, dossierMigration, "migration.sql"), "utf8"),
      );
    }
  } finally {
    await base.end();
  }
}

export const recreerBaseE2E = recreerBase;
