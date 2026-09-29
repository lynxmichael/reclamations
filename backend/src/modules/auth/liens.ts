/**
 * Liens envoyés par e-mail au personnel (invitation, réinitialisation) : jeton aléatoire à usage
 * unique, dont seule l'empreinte SHA-256 est stockée. Le lien porte le jeton après « # » : il
 * n'apparaît donc ni dans les journaux du serveur web, ni dans l'en-tête Referer.
 */
import { createHash, randomBytes } from 'node:crypto';
import type { Configuration } from '../../configuration/configuration.js';
import type { ClientTransaction } from '../../infrastructure/base-de-donnees/index.js';

export const DUREE_INVITATION_JOURS = 7;
export const DUREE_REINITIALISATION_HEURES = 1;

export const empreinte = (jeton: string) => createHash('sha256').update(jeton).digest('hex');

/**
 * Crée un jeton (contexte système : la table n'est lisible que par l'authentification) et annule
 * les jetons du même type encore valides : seul le dernier lien envoyé fonctionne.
 */
export async function nouveauJeton(tx: ClientTransaction, utilisateurId: string, type: 'INVITATION' | 'REINITIALISATION', maintenant: Date): Promise<string> {
  const jeton = randomBytes(32).toString('base64url');
  await tx.jetonUtilisateur.updateMany({ where: { utilisateurId, type, utiliseLe: null }, data: { utiliseLe: maintenant } });
  const duree = type === 'INVITATION' ? DUREE_INVITATION_JOURS * 86_400_000 : DUREE_REINITIALISATION_HEURES * 3_600_000;
  await tx.jetonUtilisateur.create({
    data: { utilisateurId, type, jetonHash: empreinte(jeton), expireLe: new Date(maintenant.getTime() + duree), creeLe: maintenant },
  });
  return jeton;
}

export function lienInvitation(config: Configuration, jeton: string): string {
  return `${config.urlConsole}/invitation#jeton=${jeton}`;
}

export function lienReinitialisation(config: Configuration, jeton: string): string {
  return `${config.urlConsole}/mot-de-passe#jeton=${jeton}`;
}

/** E-mail d'invitation (boîte d'envoi, contexte système). Son contenu est masqué après l'envoi. */
export async function envoyerInvitation(
  tx: ClientTransaction, config: Configuration,
  u: { id: string; tenantId: string | null; email: string; prenom: string }, nomBanque: string | null, jeton: string,
): Promise<void> {
  const lien = lienInvitation(config, jeton);
  await tx.notification.create({
    data: {
      tenantId: u.tenantId,
      canal: 'EMAIL',
      modele: 'personnel.invitation',
      destinataireUtilisateurId: u.id,
      destination: u.email,
      sujet: nomBanque ? `Invitation — réclamations ${nomBanque}` : 'Invitation — console de la plateforme de réclamations',
      contenu: `Bonjour ${u.prenom},\n\nVous êtes invité(e) à rejoindre ${nomBanque ? `l'espace réclamations de ${nomBanque}` : 'la console de la plateforme'}.\n`
        + `Choisissez votre mot de passe et activez la double authentification : ${lien}\n\nCe lien est valable ${DUREE_INVITATION_JOURS} jours.`,
    },
  });
}

export async function envoyerReinitialisation(
  tx: ClientTransaction, config: Configuration, u: { id: string; tenantId: string | null; email: string; prenom: string }, jeton: string,
): Promise<void> {
  await tx.notification.create({
    data: {
      tenantId: u.tenantId,
      canal: 'EMAIL',
      modele: 'personnel.reinitialisation',
      destinataireUtilisateurId: u.id,
      destination: u.email,
      sujet: 'Réinitialisation de votre mot de passe',
      contenu: `Bonjour ${u.prenom},\n\nPour choisir un nouveau mot de passe : ${lienReinitialisation(config, jeton)}\n`
        + `Ce lien est valable ${DUREE_REINITIALISATION_HEURES} heure. Si vous n'êtes pas à l'origine de la demande, ignorez ce message.`,
    },
  });
}
