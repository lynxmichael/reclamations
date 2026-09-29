/**
 * Remplit la base de développement avec le jeu de démonstration (deux banques, leur personnel,
 * un Super Admin, quelques réclamations). Refusé en production, et si le jeu est déjà là.
 *
 *   npm run semer
 */
import { semer, MOT_DE_PASSE_DEMO } from './jeu-de-donnees.js';
import { lireConfiguration, urlPortail } from '../src/configuration/configuration.js';
import { BaseDonnees } from '../src/infrastructure/base-de-donnees/base-de-donnees.service.js';

async function principal() {
  const config = lireConfiguration();
  if (config.production) throw new Error('Jeu de démonstration refusé en production');
  const bd = new BaseDonnees(config.baseDeDonneesUrl);
  try {
    const deja = await bd.enSysteme((tx) => tx.banque.findUnique({ where: { slug: 'alpha' }, select: { id: true } }));
    if (deja) {
      console.log('Le jeu de démonstration est déjà en place (banque « alpha »). Rien à faire.');
      return;
    }
    const jeu = await semer(bd, {
      cleTotp: config.cleTotp,
      reclamations: true,
      lienSuivi: (slug, jeton) => `${urlPortail(config, slug)}/suivi/${jeton}`,
    });
    const lignes = [
      ['Super Admin', jeu.superAdmin.email],
      ...Object.values(jeu.alpha.comptes).map((c) => [`Banque Alpha · ${c.role}`, c.email]),
      ...Object.values(jeu.horizon.comptes).map((c) => [`Banque Horizon · ${c.role}`, c.email]),
    ];
    console.log('\nJeu de démonstration créé.\n');
    for (const [role, email] of lignes) console.log(`  ${role.padEnd(34)} ${email}`);
    console.log(`\nMot de passe de tous les comptes : ${MOT_DE_PASSE_DEMO}`);
    console.log('Code TOTP du moment : npm run totp -- <e-mail>   (docker compose exec api npm run totp -- <e-mail>)');
    console.log(`QR codes de dépôt : Alpha ${jeu.alpha.points.qr} · Horizon ${jeu.horizon.points.qr}\n`);
  } finally {
    await bd.fermer();
  }
}

principal().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
