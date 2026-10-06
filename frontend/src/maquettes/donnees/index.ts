/**
 * Inventaire des données des maquettes, avec le schéma du contrat de chacune.
 * tests/maquettes.test.ts valide chaque entrée contre contrat/openapi.yaml.
 */
import type { Schemas } from '../../api/types';
import { ALPHA, HORIZON } from './commun';
import { ENROLEMENT, ERREUR_CONNEXION, ETAPE_TOTP } from './auth';
import { ENROLEMENT_COMPTE, INDICATEURS_AGENCES } from './agences';
import { ABSENCES, AGENCES, CATEGORIES, GROUPES, HORAIRES, IBRAHIM, JOURS_FERIES, PAGE_PERSONNEL, PARAMETRES, POINTS_DEPOT, REGLES, SERGE, moi } from './parametrage';
import { ALERTES, FACTURATION_CANAUX, FACTURATION_SMS, INDICATEURS_PLATEFORME, PAGE_BANQUES, PLANS } from './plateforme';
import {
  ERREUR_DEPOT, MA_RECLAMATION_EN_COURS, MA_RECLAMATION_RESOLUE, MES_RECLAMATIONS, OTP_ACCES, OTP_ENVOYE, accuse, avis, formulaire, maReclamationChat, suivi, suiviClos, suiviRattache,
} from './portail';
import {
  ACCUSE_SAISIE_54, CONVERSATION_42, CONVERSATIONS_AGENT, CONVERSATIONS_SUPERVISEUR, CONVERSATIONS_SUPERVISEUR_TOUTES, ERREUR_SAISIE, FICHE_42, FICHE_52, FICHE_53, FICHE_54, INDICATEURS, JOURNAL,
  NOTIFICATIONS_AGENT, PAGE_AGENT, PAGE_SUPERVISEUR, RESULTAT_EN_LOT, VERIFICATION_CHAINE,
} from './reclamations';

export interface Exemple {
  nom: string;
  schema: keyof Schemas;
  /** Réponse de type tableau : chaque élément est validé contre `schema`. */
  liste?: boolean;
  valeur: unknown;
}

export const EXEMPLES: Exemple[] = [
  { nom: 'formulaire de dépôt (Alpha)', schema: 'FormulaireDepot', valeur: formulaire(ALPHA) },
  { nom: 'formulaire de dépôt (Horizon)', schema: 'FormulaireDepot', valeur: formulaire(HORIZON) },
  { nom: 'erreur de dépôt', schema: 'Probleme', valeur: ERREUR_DEPOT },
  { nom: 'accusé de dépôt', schema: 'AccuseDepot', valeur: accuse(ALPHA) },
  { nom: 'suivi public', schema: 'SuiviPublic', valeur: suivi(ALPHA) },
  { nom: 'suivi public, réclamation close (enquête)', schema: 'SuiviPublic', valeur: suiviClos(ALPHA) },
  { nom: 'enquête à donner', schema: 'Avis', valeur: avis(ALPHA, 'A_DONNER') },
  { nom: 'enquête donnée', schema: 'Avis', valeur: avis(ALPHA, 'DONNE') },
  { nom: 'enquête terminée', schema: 'Avis', valeur: avis(HORIZON, 'TERMINE') },
  { nom: 'code OTP envoyé', schema: 'OtpEnvoye', valeur: OTP_ENVOYE },
  { nom: 'suivi d\'un doublon rattaché (étape 21)', schema: 'SuiviPublic', valeur: suiviRattache(ALPHA) },
  { nom: 'banque du portail (étape 21)', schema: 'BanquePublique', valeur: ALPHA },
  { nom: 'code pour retrouver ses réclamations (étape 21)', schema: 'OtpEnvoye', valeur: OTP_ACCES },
  { nom: 'mes réclamations', schema: 'ReclamationClientResume', liste: true, valeur: MES_RECLAMATIONS },
  { nom: 'ma réclamation en cours', schema: 'ReclamationClient', valeur: MA_RECLAMATION_EN_COURS },
  { nom: 'ma réclamation résolue', schema: 'ReclamationClient', valeur: MA_RECLAMATION_RESOLUE },
  { nom: 'ma réclamation, chat ouvert (étape 17)', schema: 'ReclamationClient', valeur: maReclamationChat(true) },
  { nom: 'ma réclamation, chat fermé le soir', schema: 'ReclamationClient', valeur: maReclamationChat(false) },
  { nom: 'étape TOTP', schema: 'EtapeConnexion', valeur: ETAPE_TOTP },
  { nom: 'enrôlement TOTP', schema: 'EnrolementTotp', valeur: ENROLEMENT },
  { nom: 'étape d\'activation exigée (étape 19)', schema: 'EtapeConnexion', valeur: { etape: 'ENROLEMENT_TOTP_REQUIS', jetonIntermediaire: ENROLEMENT.jetonIntermediaire, expireDans: 300, enrolement: ENROLEMENT } },
  { nom: 'session ouverte sans code (étape 19)', schema: 'EtapeConnexion', valeur: { etape: 'SESSION_OUVERTE', session: { jetonAcces: 'eyJhbGciOiJFUzI1NiJ9.acces', expireDans: 900, utilisateur: moi(IBRAHIM, 'AGENT', false) } } },
  { nom: 'Mon compte : activation préparée (étape 19)', schema: 'EnrolementCompte', valeur: ENROLEMENT_COMPTE },
  { nom: 'profil sans double authentification (étape 19)', schema: 'Moi', valeur: moi(IBRAHIM, 'AGENT', false) },
  { nom: 'erreur de connexion', schema: 'Probleme', valeur: ERREUR_CONNEXION },
  { nom: 'profil du superviseur', schema: 'Moi', valeur: moi(SERGE, 'SUPERVISEUR') },
  { nom: 'files du superviseur', schema: 'PageReclamations', valeur: PAGE_SUPERVISEUR },
  { nom: "files de l'agent", schema: 'PageReclamations', valeur: PAGE_AGENT },
  { nom: 'fiche (agent assigné)', schema: 'ReclamationDetail', valeur: FICHE_42.AGENT },
  { nom: 'fiche (superviseur)', schema: 'ReclamationDetail', valeur: FICHE_42.SUPERVISEUR },
  { nom: 'fiche (Admin Entreprise)', schema: 'ReclamationDetail', valeur: FICHE_42.ADMIN_ENTREPRISE },
  { nom: 'fiche à assigner, agent suggéré (superviseur)', schema: 'ReclamationDetail', valeur: FICHE_52 },
  { nom: 'fiche d\'un doublon possible (étape 21, superviseur)', schema: 'ReclamationDetail', valeur: FICHE_53 },
  { nom: 'fiche saisie au guichet (étape 21)', schema: 'ReclamationDetail', valeur: FICHE_54 },
  { nom: 'récépissé de la saisie au guichet (étape 21)', schema: 'AccuseSaisie', valeur: ACCUSE_SAISIE_54 },
  { nom: 'saisie à corriger (étape 21)', schema: 'Probleme', valeur: ERREUR_SAISIE },
  { nom: 'réassignation en lot (étape 21)', schema: 'ResultatAssignationEnLot', valeur: RESULTAT_EN_LOT },
  { nom: 'boîte de réception (superviseur, à répondre)', schema: 'PageConversations', valeur: CONVERSATIONS_SUPERVISEUR },
  { nom: 'boîte de réception (superviseur, toutes)', schema: 'PageConversations', valeur: CONVERSATIONS_SUPERVISEUR_TOUTES },
  { nom: 'boîte de réception (agent)', schema: 'PageConversations', valeur: CONVERSATIONS_AGENT },
  { nom: 'conversation (agent assigné)', schema: 'ConversationDetail', valeur: CONVERSATION_42.AGENT },
  { nom: 'conversation (Admin Entreprise)', schema: 'ConversationDetail', valeur: CONVERSATION_42.ADMIN_ENTREPRISE },
  { nom: "notifications de l'agent", schema: 'PageNotifications', valeur: NOTIFICATIONS_AGENT },
  { nom: 'indicateurs', schema: 'Indicateurs', valeur: INDICATEURS },
  { nom: 'activité des agences (étape 19)', schema: 'IndicateursAgences', valeur: INDICATEURS_AGENCES },
  { nom: 'paramètres de la banque', schema: 'ParametresBanque', valeur: PARAMETRES },
  { nom: 'catégories', schema: 'Categorie', liste: true, valeur: CATEGORIES },
  { nom: 'agences', schema: 'Agence', liste: true, valeur: AGENCES },
  { nom: 'points de dépôt', schema: 'PointDepot', liste: true, valeur: POINTS_DEPOT },
  { nom: 'horaires', schema: 'Horaires', valeur: HORAIRES },
  { nom: 'jours fériés', schema: 'JourFerie', liste: true, valeur: JOURS_FERIES },
  { nom: 'personnel', schema: 'PageUtilisateurs', valeur: PAGE_PERSONNEL },
  { nom: 'règles d\'attribution et d\'escalade', schema: 'ReglesTraitement', valeur: REGLES },
  { nom: 'groupes d\'agents', schema: 'GroupeAgents', liste: true, valeur: GROUPES },
  { nom: 'absences', schema: 'Absence', liste: true, valeur: ABSENCES },
  { nom: "journal d'audit", schema: 'PageAudit', valeur: JOURNAL },
  { nom: 'vérification de la chaîne', schema: 'VerificationChaine', valeur: VERIFICATION_CHAINE },
  { nom: 'plans', schema: 'Plan', liste: true, valeur: PLANS },
  { nom: 'banques', schema: 'PageBanques', valeur: PAGE_BANQUES },
  { nom: 'indicateurs de la plateforme', schema: 'IndicateursPlateforme', valeur: INDICATEURS_PLATEFORME },
  { nom: 'facturation SMS', schema: 'FacturationSms', valeur: FACTURATION_SMS },
  { nom: 'facturation WhatsApp et SMS reçus', schema: 'FacturationCanaux', valeur: FACTURATION_CANAUX },
  { nom: 'alertes du Super Admin', schema: 'PageNotifications', valeur: ALERTES },
];
