/**
 * Code TOTP du moment pour un compte du jeu de démonstration (développement seulement).
 * Les comptes de démonstration ont un secret dérivé de leur e-mail : aucune base n'est lue.
 *
 *   npm run totp -- serge.kouadio@banque-alpha.example
 *
 * Pour les ajouter à une application d'authentification, l'adresse otpauth:// est aussi affichée.
 */
import { secretTotpDemo } from './jeu-de-donnees.js';
import { codeCourant, enrolement } from '../src/infrastructure/securite/totp.js';

async function principal() {
  if (process.env.NODE_ENV === 'production') throw new Error('Outil de développement : refusé en production');
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) throw new Error('Usage : npm run totp -- <e-mail d\'un compte de démonstration>');
  const secret = secretTotpDemo(email);
  const restant = 30 - (Math.floor(Date.now() / 1000) % 30);
  console.log(`${codeCourant(secret)}   (valable encore ${restant} s)`);
  console.log(`Application d'authentification : ${(await enrolement(secret, email)).otpauthUrl}`);
}

principal().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
