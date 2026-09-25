/**
 * Libellés français des énumérations du contrat. Le typage `Record<…>` garantit qu'aucune
 * valeur n'est oubliée : si le contrat ajoute un statut, la compilation échoue ici.
 */
import type { S } from '../api/types';

export const STATUT: Record<S<'StatutReclamation'>, string> = {
  OUVERTE: 'Ouverte',
  EN_COURS: 'En cours',
  EN_ATTENTE_CLIENT: 'En attente client',
  RESOLUE: 'Résolue',
  CLOTUREE: 'Clôturée',
};

/** Le client lit « sa » réclamation : formulations à la deuxième personne. */
export const STATUT_CLIENT: Record<S<'StatutReclamation'>, string> = {
  OUVERTE: 'Reçue',
  EN_COURS: 'En cours de traitement',
  EN_ATTENTE_CLIENT: 'En attente de votre réponse',
  RESOLUE: 'Résolue, à confirmer',
  CLOTUREE: 'Clôturée',
};

export const PRIORITE: Record<S<'Priorite'>, string> = {
  NORMALE: 'Normale',
  URGENTE: 'Urgente',
};

export const CANAL: Record<S<'CanalDepot'>, string> = {
  QR_CODE: 'QR code',
  LIEN_WEB: 'Lien web',
};

export const ROLE: Record<S<'RoleUtilisateur'>, string> = {
  SUPER_ADMIN: 'Super Admin',
  ADMIN_ENTREPRISE: 'Admin Entreprise',
  SUPERVISEUR: 'Superviseur',
  AGENT: 'Agent',
};

export const STATUT_UTILISATEUR: Record<S<'StatutUtilisateur'>, string> = {
  INVITE: 'Invitation envoyée',
  ACTIF: 'Actif',
  DESACTIVE: 'Désactivé',
};

export const EVENEMENT: Record<S<'TypeEvenement'>, string> = {
  CREATION: 'Dépôt',
  PRISE_EN_CHARGE: 'Prise en charge',
  QUESTION_AU_CLIENT: 'Question au client',
  REPONSE_DU_CLIENT: 'Réponse du client',
  RESOLUTION: 'Résolution',
  CONFIRMATION: 'Confirmée par le client',
  CONTESTATION: 'Contestée par le client',
  CLOTURE_AUTOMATIQUE: 'Clôture automatique',
  CLOTURE_FORCEE: 'Clôture forcée',
  ASSIGNATION: 'Assignation',
  CHANGEMENT_PRIORITE: 'Changement de priorité',
  ESCALADE: 'Escalade',
  ALERTE_SLA_PREVENTIVE: 'Alerte SLA',
  DEPASSEMENT_SLA: 'Délai SLA dépassé',
  MESSAGE: 'Message',
  PIECE_JOINTE: 'Pièce jointe',
};

/** Étapes visibles du client (suivi public et espace client). */
export const EVENEMENT_CLIENT: Partial<Record<S<'TypeEvenement'>, string>> = {
  CREATION: 'Réclamation reçue',
  PRISE_EN_CHARGE: 'Prise en charge par un conseiller',
  QUESTION_AU_CLIENT: 'La banque vous a posé une question',
  REPONSE_DU_CLIENT: 'Vous avez répondu',
  RESOLUTION: 'Réclamation résolue',
  CONFIRMATION: 'Vous avez confirmé la résolution',
  CONTESTATION: 'Vous avez contesté la résolution',
  CLOTURE_AUTOMATIQUE: 'Réclamation clôturée',
  CLOTURE_FORCEE: 'Réclamation clôturée par la banque',
};

export const ACTION: Record<S<'ActionStatut'>, string> = {
  PRENDRE_EN_CHARGE: 'Prendre en charge',
  QUESTIONNER_CLIENT: 'Questionner le client',
  REPRENDRE_SUR_REPONSE: 'Reprendre',
  RESOUDRE: 'Résoudre',
  CONFIRMER: 'Confirmer la résolution',
  CONTESTER: 'Contester',
  CLOTURER_AUTOMATIQUEMENT: 'Clôturer automatiquement',
  CLOTURER_DE_FORCE: 'Clôturer de force',
};

export const OPERATION: Record<S<'OperationTicket'>, string> = {
  CONSULTER: 'Consulter',
  ASSIGNER: 'Assigner',
  CHANGER_PRIORITE: 'Changer la priorité',
  ESCALADER: 'Escalader',
  NOTE_INTERNE: 'Note interne',
  REPONDRE_AU_CLIENT: 'Répondre au client',
  MESSAGE_DU_CLIENT: 'Écrire à la banque',
};

export const MOTIF_CLOTURE: Record<S<'MotifClotureForcee'>, string> = {
  DOUBLON: 'Doublon',
  HORS_PERIMETRE: 'Hors périmètre',
  ABUS: 'Abus',
  AUTRE: 'Autre',
};

export const MODE_CLOTURE: Record<S<'ModeCloture'>, string> = {
  CONFIRMATION_CLIENT: 'Confirmée par le client',
  AUTOMATIQUE: 'Automatique, sans réponse du client',
  FORCEE: 'Forcée',
};

export const ETAT_CHRONO: Record<S<'EtatChrono'>, string> = {
  DANS_LES_DELAIS: 'Dans les délais',
  ALERTE: 'Seuil d\'alerte franchi',
  DEPASSE: 'Délai dépassé',
  EN_PAUSE: 'Chrono en pause',
  ARRETE: 'Chrono arrêté',
};

export const JOURS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'] as const;
