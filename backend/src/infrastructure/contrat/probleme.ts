/**
 * Erreurs de l'API au format RFC 9457 (application/problem+json), avec un code stable (décision C4).
 */
import type { components } from '../../contrat/api.js';

export type CodeErreur = components['schemas']['CodeErreur'];
export type ErreurChamp = components['schemas']['ErreurChamp'];
export type CorpsProbleme = components['schemas']['Probleme'];

const TITRES: Partial<Record<CodeErreur, string>> = {
  VALIDATION: 'Requête invalide',
  NON_AUTHENTIFIE: 'Authentification requise',
  JETON_INVALIDE: 'Session expirée ou invalide',
  INTERDIT: 'Accès refusé',
  INTROUVABLE: 'Introuvable',
  TROP_DE_REQUETES: 'Trop de requêtes',
  CONFLIT_IDEMPOTENCE: 'Clé d\'idempotence déjà utilisée',
  IDENTIFIANTS_INVALIDES: 'E-mail ou mot de passe incorrect',
  COMPTE_VERROUILLE: 'Compte verrouillé temporairement',
  CODE_TOTP_INVALIDE: 'Code de vérification incorrect',
  MOT_DE_PASSE_TROP_FAIBLE: 'Mot de passe trop faible',
  CODE_OTP_INVALIDE: 'Code incorrect',
  CODE_OTP_EXPIRE: 'Code expiré',
  TROP_DE_TENTATIVES: 'Trop de tentatives',
  TRANSITION_INTERDITE: 'Action impossible dans le statut actuel',
  ACTEUR_NON_AUTORISE: 'Action réservée à un autre rôle',
  AUCUN_AGENT_ASSIGNE: 'Aucun agent assigné',
  DELAI_DE_CONTESTATION_DEPASSE: 'Délai de contestation dépassé',
  CLOTURE_AUTOMATIQUE_PREMATUREE: 'Clôture automatique prématurée',
  BANQUE_SUSPENDUE: 'Banque suspendue',
  POINT_DE_DEPOT_INACTIF: 'Point de dépôt inactif',
  CATEGORIE_INVALIDE: 'Catégorie invalide',
  CONTACT_REQUIS: 'E-mail ou téléphone requis',
  CONTACT_INVALIDE: 'Coordonnées invalides',
  DESCRIPTION_REQUISE: 'Description requise',
  CONSENTEMENT_REQUIS: 'Consentement requis',
  ANTI_ROBOT_REFUSE: 'Vérification anti-robot refusée',
  MESSAGE_VIDE: 'Message vide',
  PRECISION_REQUISE: 'Précision requise',
  AGENT_INVALIDE: 'Agent invalide',
  FICHIER_TROP_VOLUMINEUX: 'Fichier trop volumineux',
  TYPE_DE_FICHIER_NON_SUPPORTE: 'Type de fichier non supporté',
  TROP_DE_FICHIERS: 'Trop de fichiers',
  PLAFOND_AGENTS_ATTEINT: 'Plafond d\'agents atteint',
  EMAIL_DEJA_UTILISE: 'E-mail déjà utilisé',
  NOM_DEJA_UTILISE: 'Nom déjà utilisé',
  CODE_DEJA_UTILISE: 'Code déjà utilisé',
  PREFIXE_DEJA_UTILISE: 'Préfixe déjà utilisé',
  SLUG_DEJA_UTILISE: 'Adresse de portail déjà utilisée',
  QR_CODE_SANS_AGENCE: 'Un QR code doit être rattaché à une agence',
  SUPERVISEUR_INVALIDE: 'Superviseur invalide',
  INVITATION_DEJA_ACCEPTEE: 'Invitation déjà acceptée',
  JOUR_FERIE_EXISTANT: 'Jour férié déjà enregistré',
  EXPORT_TROP_VOLUMINEUX: 'Export trop volumineux',
  AVIS_DEJA_DONNE: 'Avis déjà donné',
  ENQUETE_TERMINEE: 'Enquête terminée',
  FONCTION_NON_OUVERTE: 'Fonction non ouverte à cette banque',
  GROUPE_INVALIDE: 'Groupe d\'agents invalide',
  ABSENCE_INVALIDE: 'Absence invalide',
  DOUBLE_AUTHENTIFICATION_OBLIGATOIRE: 'Double authentification exigée par la banque',
  DOUBLE_AUTHENTIFICATION_A_ACTIVER: 'Double authentification à activer d\'abord',
  DOUBLE_AUTHENTIFICATION_DEJA_ACTIVE: 'Double authentification déjà activée',
  DOUBLE_AUTHENTIFICATION_INACTIVE: 'Double authentification non activée',
  DOUBLE_AUTHENTIFICATION_NON_PREPAREE: 'Double authentification non préparée',
  CHAT_WEB_REQUIS: 'Chat web requis',
  SIGNATURE_INVALIDE: 'Signature invalide',
  NUMERO_DEJA_UTILISE: 'Numéro déjà raccordé',
  CANAL_NON_RACCORDE: 'Numéro à raccorder d\'abord',
  RATTACHEMENT_IMPOSSIBLE: 'Rattachement impossible',
  FICHIER_INFECTE: 'Fichier infecté',
  FICHIER_EN_ANALYSE: 'Analyse antivirus en cours',
  FICHIER_SUPPRIME: 'Fichier supprimé',
  MESSAGE_NON_RENVOYABLE: 'Message non renvoyable',
  ERREUR_INTERNE: 'Erreur interne',
};

export class Probleme extends Error {
  constructor(
    readonly status: number,
    readonly code: CodeErreur,
    detail?: string,
    readonly erreurs?: ErreurChamp[],
    readonly entetes: Record<string, string> = {},
  ) {
    super(detail ?? TITRES[code] ?? code);
    this.name = 'Probleme';
  }

  get detail(): string | undefined {
    return this.message !== (TITRES[this.code] ?? this.code) ? this.message : undefined;
  }

  corps(instance?: string): CorpsProbleme {
    return {
      type: `/erreurs/${this.code.toLowerCase().replaceAll('_', '-')}`,
      title: TITRES[this.code] ?? this.code,
      status: this.status,
      code: this.code,
      ...(this.detail ? { detail: this.detail } : {}),
      ...(instance ? { instance } : {}),
      ...(this.erreurs?.length ? { erreurs: this.erreurs } : {}),
    };
  }
}

export const introuvable = (detail = 'Ressource introuvable') => new Probleme(404, 'INTROUVABLE', detail);
export const interdit = (detail = 'Votre rôle ne permet pas cette action') => new Probleme(403, 'INTERDIT', detail);
export const nonAuthentifie = (detail = 'Connectez-vous pour continuer') => new Probleme(401, 'NON_AUTHENTIFIE', detail);
export const jetonInvalide = (detail = 'Session expirée ou invalide') => new Probleme(401, 'JETON_INVALIDE', detail);
export const invalide = (erreurs: ErreurChamp[], detail?: string) =>
  new Probleme(400, 'VALIDATION', detail ?? `${erreurs.length} champ${erreurs.length > 1 ? 's' : ''} à corriger`, erreurs);
export const invalideChamp = (champ: string, message: string) => invalide([{ champ, message }]);
export const tropDeRequetes = (secondes: number, detail = 'Réessayez dans quelques minutes') =>
  new Probleme(429, 'TROP_DE_REQUETES', detail, undefined, { 'Retry-After': String(Math.max(1, Math.ceil(secondes))) });
