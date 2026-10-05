/**
 * Remplit la base de développement avec le jeu de démonstration (deux banques, leur personnel,
 * un Super Admin, quelques réclamations et, depuis l'étape 9, 60 jours d'historique pour le
 * tableau de bord). Refusé en production, sauf sur l'environnement de démonstration (étape 10,
 * scripts/demonstration.ts) ; refusé aussi si le jeu est déjà là.
 *
 *   npm run semer
 *   node dist/scripts/semer.js      (image de production, environnement de démonstration)
 */
import { parametresDemonstration } from './demonstration.js';
import { semer } from './jeu-de-donnees.js';
import { lireConfiguration, urlPortail } from '../src/configuration/configuration.js';
import { BaseDonnees } from '../src/infrastructure/base-de-donnees/base-de-donnees.service.js';

async function principal() {
  const config = lireConfiguration();
  const demo = parametresDemonstration();
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
      historique: 60,
      enquetes: true,
      attribution: true,
      chat: true,
      assistant: true,
      motDePasse: demo.motDePasse,
      graineTotp: demo.graineTotp,
      lienSuivi: (slug, jeton) => `${urlPortail(config, slug)}/suivi/${jeton}`,
    });
    const lignes = [
      ['Super Admin', jeu.superAdmin.email],
      ...Object.values(jeu.alpha.comptes).map((c) => [`Banque Alpha · ${c.role}`, c.email]),
      ...Object.values(jeu.horizon.comptes).map((c) => [`Banque Horizon · ${c.role}`, c.email]),
    ];
    console.log('\nJeu de démonstration créé.\n');
    for (const [role, email] of lignes) console.log(`  ${role.padEnd(34)} ${email}`);
    console.log(demo.enLigne ? '\nMot de passe de tous les comptes : DEMO_MOT_DE_PASSE' : `\nMot de passe de tous les comptes : ${demo.motDePasse}`);
    console.log(demo.enLigne
      ? 'Code TOTP et adresse pour une application d\'authentification : docker compose … exec api node dist/scripts/totp.js <e-mail>'
      : 'Code TOTP du moment : npm run totp -- <e-mail>   (docker compose exec api npm run totp -- <e-mail>)');
    console.log(`QR codes de dépôt : Alpha ${jeu.alpha.points.qr} · Horizon ${jeu.horizon.points.qr}\n`);
  } finally {
    await bd.fermer();
  }
}

principal().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
