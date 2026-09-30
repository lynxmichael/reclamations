/**
 * Code TOTP du moment pour un compte du jeu de démonstration (développement, et environnement de
 * démonstration de l'étape 10 avec sa graine DEMO_GRAINE_TOTP ; refusé en production réelle).
 * Les comptes de démonstration ont un secret dérivé de leur e-mail : aucune base n'est lue.
 *
 *   npm run totp -- serge.kouadio@banque-alpha.example
 *
 * Pour les ajouter à une application d'authentification, l'adresse otpauth:// est aussi affichée.
 */
import { parametresDemonstration } from './demonstration.js';
import { secretTotpDemo } from './jeu-de-donnees.js';
import { codeCourant, enrolement } from '../src/infrastructure/securite/totp.js';

async function principal() {
  const { graineTotp } = parametresDemonstration();
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) throw new Error('Usage : npm run totp -- <e-mail d\'un compte de démonstration>');
  const secret = secretTotpDemo(email, graineTotp);
  const restant = 30 - (Math.floor(Date.now() / 1000) % 30);
  console.log(`${codeCourant(secret)}   (valable encore ${restant} s)`);
  console.log(`Application d'authentification : ${(await enrolement(secret, email)).otpauthUrl}`);
}

principal().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
