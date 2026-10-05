/**
 * Connexion du personnel : mot de passe, puis code TOTP (décision C6 de l'étape 5) ; sans code quand
 * la double authentification est facultative et non activée (étape 19).
 */
import type { S } from '../../api/types';

export const ETAPE_TOTP: S<'EtapeConnexion'> = {
  etape: 'TOTP_REQUIS',
  jetonIntermediaire: 'eyJhbGciOiJFUzI1NiJ9.intermediaire',
  expireDans: 300,
};

/** Première connexion d'Estelle Gnahoré, invitée : elle active la double authentification. */
export const ENROLEMENT: S<'EnrolementTotp'> = {
  jetonIntermediaire: 'eyJhbGciOiJFUzI1NiJ9.enrolement',
  otpauthUrl: 'otpauth://totp/Banque%20Alpha:estelle.gnahore%40banque-alpha.example?secret=K5XGC4TMEBQWY4DIMFSQ&issuer=Banque%20Alpha&digits=6&period=30',
  secret: 'K5XGC4TMEBQWY4DIMFSQ',
  qrCodeDataUrl: 'data:image/png;base64,iVBORw0KGgo=',
};

export const ERREUR_CONNEXION: S<'Probleme'> = {
  type: '/erreurs/identifiants-invalides',
  title: 'E-mail ou mot de passe incorrect',
  status: 401,
  code: 'IDENTIFIANTS_INVALIDES',
  detail: 'Vérifiez vos identifiants. Après 5 échecs, le compte est verrouillé pendant 15 minutes.',
};
