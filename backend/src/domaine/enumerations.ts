/**
 * Énumérations dont le domaine a besoin, déclarées ici plutôt qu'importées du client Prisma :
 * le domaine reste du code pur, sans dépendance à la base, et le frontend peut le réutiliser
 * (démo cliquable de l'étape 6). enumerations.test.ts vérifie qu'elles restent identiques au
 * modèle de données.
 */

export const STATUTS_RECLAMATION = ['OUVERTE', 'EN_COURS', 'EN_ATTENTE_CLIENT', 'RESOLUE', 'CLOTUREE'] as const;
export type StatutReclamation = (typeof STATUTS_RECLAMATION)[number];

export const ROLES_UTILISATEUR = ['SUPER_ADMIN', 'ADMIN_ENTREPRISE', 'SUPERVISEUR', 'AGENT'] as const;
export type RoleUtilisateur = (typeof ROLES_UTILISATEUR)[number];

export const TYPES_EVENEMENT = [
  'CREATION', 'PRISE_EN_CHARGE', 'QUESTION_AU_CLIENT', 'REPONSE_DU_CLIENT', 'RESOLUTION', 'CONFIRMATION', 'CONTESTATION',
  'CLOTURE_AUTOMATIQUE', 'CLOTURE_FORCEE', 'ASSIGNATION', 'CHANGEMENT_PRIORITE', 'ESCALADE', 'ESCALADE_ADMIN', 'ALERTE_SLA_PREVENTIVE',
  'DEPASSEMENT_SLA', 'MESSAGE', 'PIECE_JOINTE',
] as const;
export type TypeEvenement = (typeof TYPES_EVENEMENT)[number];
