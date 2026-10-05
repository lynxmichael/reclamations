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

/** Canal d'une conversation (étape 17) ; WhatsApp et SMS entrant à l'étape 19 */
export const CANAL_CONVERSATION: Record<S<'CanalConversation'>, string> = {
  WEB: 'Chat du portail',
  WHATSAPP: 'WhatsApp',
  SMS: 'SMS',
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
  ESCALADE_ADMIN: 'Escalade à l\'Admin Entreprise',
  ALERTE_SLA_PREVENTIVE: 'Alerte SLA',
  DEPASSEMENT_SLA: 'Délai SLA dépassé',
  MESSAGE: 'Message',
  PIECE_JOINTE: 'Pièce jointe',
};

/** Attribution des réclamations (étape 16) : mode choisi par l'Admin Entreprise. */
export const MODE_ATTRIBUTION: Record<S<'ModeAttribution'>, { libelle: string; description: string }> = {
  MANUELLE: { libelle: 'Manuelle', description: 'Le superviseur assigne chaque réclamation, comme aujourd\'hui.' },
  SUGGESTION: { libelle: 'Suggestion', description: 'L\'agent le plus disponible est proposé ; le superviseur valide en un clic.' },
  AUTOMATIQUE: { libelle: 'Automatique', description: 'Au dépôt, la réclamation part à l\'agent disponible le moins chargé, pendant les heures d\'ouverture.' },
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

/** Enquête de satisfaction (étape 15) : libellé de chaque note de 1 à 5 (CSAT). */
export const NOTE_SATISFACTION: Record<number, string> = {
  1: 'Pas du tout satisfait',
  2: 'Peu satisfait',
  3: 'Moyennement satisfait',
  4: 'Satisfait',
  5: 'Très satisfait',
};

export const ETAT_AVIS: Record<S<'EtatAvis'>, string> = {
  A_DONNER: 'Enquête envoyée, en attente de réponse',
  DONNE: 'Avis donné',
  TERMINE: 'Sans réponse (enquête terminée)',
};

export const JOURS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'] as const;

/** Actions inscrites au journal d'audit (backend : journaliser), en français. */
export const ACTION_AUDIT: Record<string, string> = {
  'reclamation.depot': 'Dépôt d\'une réclamation',
  'reclamation.assignation': 'Assignation',
  'reclamation.attribution_automatique': 'Attribution automatique',
  'reclamation.prise_en_charge': 'Prise en charge',
  'reclamation.reponse_client': 'Réponse au client',
  'reclamation.note_interne': 'Note interne',
  'reclamation.message_client': 'Message du client',
  'reclamation.resolution': 'Résolution',
  'reclamation.confirmation': 'Confirmation du client',
  'reclamation.contestation': 'Contestation du client',
  'reclamation.cloture_automatique': 'Clôture automatique',
  'reclamation.cloture_forcee': 'Clôture forcée',
  'reclamation.priorite': 'Changement de priorité',
  'reclamation.escalade': 'Escalade',
  'reclamation.urgente': 'Alerte urgente',
  'reclamation.export': 'Export CSV',
  'sla.alerte_preventive': 'Alerte SLA envoyée',
  'sla.depassement': 'Dépassement SLA et escalade',
  'sla.escalade_admin': 'Escalade à l\'Admin Entreprise',
  'client.code_envoye': 'Code envoyé au client',
  'client.session_ouverte': 'Espace client ouvert',
  'client.avis_donne': 'Avis du client (enquête)',
  'auth.connexion': 'Connexion',
  'auth.deconnexion': 'Déconnexion',
  'auth.echec_mot_de_passe': 'Mot de passe erroné',
  'auth.echec_totp': 'Code TOTP erroné',
  'auth.compte_verrouille': 'Compte verrouillé (5 échecs)',
  'auth.totp_active': 'Double authentification activée',
  'auth.totp_desactive': 'Double authentification désactivée',
  'auth.demande_reinitialisation': 'Mot de passe oublié',
  'auth.mot_de_passe_reinitialise': 'Mot de passe changé',
  'auth.reutilisation_refresh_token': 'Session fermée (jeton réutilisé)',
  'personnel.invitation': 'Invitation',
  'personnel.invitation_renvoyee': 'Invitation renvoyée',
  'personnel.invitation_acceptee': 'Invitation acceptée',
  'personnel.modifie': 'Compte modifié',
  'personnel.desactive': 'Compte désactivé',
  'personnel.reactive': 'Compte réactivé',
  'personnel.totp_reinitialise': 'Double authentification réinitialisée',
  'personnel.reinitialisation': 'Réinitialisation',
  'personnel.absence_ajoutee': 'Absence déclarée',
  'personnel.absence_retiree': 'Absence retirée',
  'parametrage.apparence': 'Apparence modifiée',
  'parametrage.double_authentification': 'Règle de double authentification modifiée',
  'parametrage.logo': 'Logo changé',
  'parametrage.categorie_creee': 'Catégorie créée',
  'parametrage.categorie_modifiee': 'Catégorie modifiée',
  'parametrage.agence_creee': 'Agence créée',
  'parametrage.agence_modifiee': 'Agence modifiée',
  'parametrage.point_cree': 'Point de dépôt créé',
  'parametrage.point_modifie': 'Point de dépôt modifié',
  'parametrage.horaires': 'Horaires remplacés',
  'parametrage.jour_ferie_ajoute': 'Jour férié ajouté',
  'parametrage.jour_ferie_retire': 'Jour férié retiré',
  'parametrage.regles_traitement': 'Règles d\'attribution modifiées',
  'parametrage.groupe_cree': 'Groupe d\'agents créé',
  'parametrage.groupe_modifie': 'Groupe d\'agents modifié',
  'parametrage.groupe_supprime': 'Groupe d\'agents supprimé',
  'plateforme.banque_creee': 'Banque créée',
  'plateforme.banque_modifiee': 'Banque modifiée',
  'plateforme.banque_suspendue': 'Banque suspendue',
  'plateforme.banque_reactivee': 'Banque réactivée',
  'plateforme.plan_cree': 'Plan créé',
  'plateforme.plan_modifie': 'Plan modifié',
  'plateforme.super_admin_invite': 'Super Admin invité',
  'plateforme.urgente': 'Alerte urgente',
  'plateforme.plafond': 'Plafond du plan dépassé',
};
