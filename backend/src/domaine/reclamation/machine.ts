/**
 * Machine d'états d'une réclamation (§6.3) et droits d'action par acteur (§5).
 *
 * Module pur : il dit si une action est permise, sans rien écrire. Le service du cycle de vie
 * l'applique en base ; un trigger PostgreSQL refuse en plus toute transition hors de ce graphe.
 *
 *   [dépôt] → OUVERTE → EN_COURS ⇄ EN_ATTENTE_CLIENT
 *                        EN_COURS → RESOLUE → CLOTUREE (confirmation ou délai)
 *                                   RESOLUE → EN_COURS (contestation)
 *   tout statut non clôturé → CLOTUREE (clôture forcée par un superviseur, motif obligatoire)
 *   tout statut non clôturé → CLOTUREE (doublon rattaché à la réclamation principale du même client,
 *                                        par le superviseur ou l'agent assigné, étape 21)
 */
import type { RoleUtilisateur, StatutReclamation, TypeEvenement } from '../enumerations.js';

export type Acteur =
  | { readonly type: 'UTILISATEUR'; readonly id: string; readonly role: RoleUtilisateur; readonly libelle: string }
  | { readonly type: 'CLIENT'; readonly clientId: string }
  | { readonly type: 'SYSTEME' };

/** Ce que la machine a besoin de savoir d'un ticket. */
export interface EtatTicket {
  readonly statut: StatutReclamation;
  readonly agentId: string | null;
  readonly clientId: string;
  readonly clotureAutoPrevueLe: Date | null;
}

/** Qualité d'un acteur vis-à-vis d'un ticket donné. */
export type Qualite = 'AGENT_ASSIGNE' | 'SUPERVISEUR' | 'CLIENT' | 'SYSTEME' | 'ADMIN_ENTREPRISE';

export function qualiteDe(acteur: Acteur, ticket: EtatTicket): Qualite | null {
  switch (acteur.type) {
    case 'SYSTEME':
      return 'SYSTEME';
    case 'CLIENT':
      return acteur.clientId === ticket.clientId ? 'CLIENT' : null;
    case 'UTILISATEUR':
      if (acteur.role === 'SUPERVISEUR') return 'SUPERVISEUR';
      if (acteur.role === 'ADMIN_ENTREPRISE') return 'ADMIN_ENTREPRISE';
      if (acteur.role === 'AGENT' && ticket.agentId === acteur.id) return 'AGENT_ASSIGNE';
      return null; // autre agent, Super Admin
  }
}

// ---------------------------------------------------------------------------
//  Transitions de statut
// ---------------------------------------------------------------------------

interface DefinitionTransition {
  readonly de: readonly StatutReclamation[];
  readonly vers: StatutReclamation;
  readonly par: readonly Qualite[];
  readonly evenement: TypeEvenement;
}

export const TRANSITIONS = {
  PRENDRE_EN_CHARGE: { de: ['OUVERTE'], vers: 'EN_COURS', par: ['AGENT_ASSIGNE', 'SUPERVISEUR'], evenement: 'PRISE_EN_CHARGE' },
  QUESTIONNER_CLIENT: { de: ['EN_COURS'], vers: 'EN_ATTENTE_CLIENT', par: ['AGENT_ASSIGNE', 'SUPERVISEUR'], evenement: 'QUESTION_AU_CLIENT' },
  REPRENDRE_SUR_REPONSE: { de: ['EN_ATTENTE_CLIENT'], vers: 'EN_COURS', par: ['CLIENT'], evenement: 'REPONSE_DU_CLIENT' },
  RESOUDRE: { de: ['EN_COURS'], vers: 'RESOLUE', par: ['AGENT_ASSIGNE', 'SUPERVISEUR'], evenement: 'RESOLUTION' },
  CONFIRMER: { de: ['RESOLUE'], vers: 'CLOTUREE', par: ['CLIENT'], evenement: 'CONFIRMATION' },
  CONTESTER: { de: ['RESOLUE'], vers: 'EN_COURS', par: ['CLIENT'], evenement: 'CONTESTATION' },
  CLOTURER_AUTOMATIQUEMENT: { de: ['RESOLUE'], vers: 'CLOTUREE', par: ['SYSTEME'], evenement: 'CLOTURE_AUTOMATIQUE' },
  CLOTURER_DE_FORCE: {
    de: ['OUVERTE', 'EN_COURS', 'EN_ATTENTE_CLIENT', 'RESOLUE'], vers: 'CLOTUREE', par: ['SUPERVISEUR'], evenement: 'CLOTURE_FORCEE',
  },
  // Étape 21 : le service vérifie en plus que la principale est du même client et consultable par l'acteur
  RATTACHER: {
    de: ['OUVERTE', 'EN_COURS', 'EN_ATTENTE_CLIENT', 'RESOLUE'], vers: 'CLOTUREE', par: ['AGENT_ASSIGNE', 'SUPERVISEUR'], evenement: 'RATTACHEMENT',
  },
} as const satisfies Record<string, DefinitionTransition>;

export type ActionStatut = keyof typeof TRANSITIONS;

// ---------------------------------------------------------------------------
//  Opérations sans changement de statut
// ---------------------------------------------------------------------------

interface DefinitionOperation {
  readonly statuts: readonly StatutReclamation[];
  readonly par: readonly Qualite[];
}

const NON_CLOTUREE = ['OUVERTE', 'EN_COURS', 'EN_ATTENTE_CLIENT', 'RESOLUE'] as const;
const TOUS = [...NON_CLOTUREE, 'CLOTUREE'] as const;

export const OPERATIONS = {
  CONSULTER: { statuts: TOUS, par: ['AGENT_ASSIGNE', 'SUPERVISEUR', 'ADMIN_ENTREPRISE', 'CLIENT', 'SYSTEME'] },
  ASSIGNER: { statuts: NON_CLOTUREE, par: ['SUPERVISEUR'] },
  CHANGER_PRIORITE: { statuts: NON_CLOTUREE, par: ['AGENT_ASSIGNE', 'SUPERVISEUR'] },
  ESCALADER: { statuts: ['OUVERTE', 'EN_COURS', 'EN_ATTENTE_CLIENT'], par: ['AGENT_ASSIGNE'] },
  NOTE_INTERNE: { statuts: TOUS, par: ['AGENT_ASSIGNE', 'SUPERVISEUR'] },
  // Depuis OUVERTE, le service prend d'abord le ticket en charge
  REPONDRE_AU_CLIENT: { statuts: ['OUVERTE', 'EN_COURS', 'EN_ATTENTE_CLIENT'], par: ['AGENT_ASSIGNE', 'SUPERVISEUR'] },
  // En RESOLUE, le client confirme ou conteste ; après clôture, plus de message
  MESSAGE_DU_CLIENT: { statuts: ['OUVERTE', 'EN_COURS', 'EN_ATTENTE_CLIENT'], par: ['CLIENT'] },
  // Étape 21 : le lien de suivi renvoyé aux coordonnées du dossier, à tout statut (l'enquête suit la clôture)
  RENVOYER_LIEN: { statuts: TOUS, par: ['AGENT_ASSIGNE', 'SUPERVISEUR'] },
} as const satisfies Record<string, DefinitionOperation>;

export type Operation = keyof typeof OPERATIONS;

// ---------------------------------------------------------------------------
//  Vérification
// ---------------------------------------------------------------------------

export type CodeRefus =
  | 'TRANSITION_INTERDITE'
  | 'ACTEUR_NON_AUTORISE'
  | 'AUCUN_AGENT_ASSIGNE'
  | 'DELAI_DE_CONTESTATION_DEPASSE'
  | 'CLOTURE_AUTOMATIQUE_PREMATUREE';

export type Verdict = { readonly ok: true } | { readonly ok: false; readonly code: CodeRefus; readonly message: string };

const OK: Verdict = { ok: true };
const refus = (code: CodeRefus, message: string): Verdict => ({ ok: false, code, message });

export function verifierTransition(action: ActionStatut, ticket: EtatTicket, acteur: Acteur, maintenant: Date): Verdict {
  const def: DefinitionTransition = TRANSITIONS[action];
  if (!def.de.includes(ticket.statut)) {
    return refus('TRANSITION_INTERDITE', `${action} est impossible depuis le statut ${ticket.statut}`);
  }
  const qualite = qualiteDe(acteur, ticket);
  if (!qualite || !def.par.includes(qualite)) {
    return refus('ACTEUR_NON_AUTORISE', `${action} est réservé à : ${def.par.join(', ')}`);
  }
  if (action === 'PRENDRE_EN_CHARGE' && !ticket.agentId) {
    return refus('AUCUN_AGENT_ASSIGNE', 'Le ticket doit d\'abord être assigné à un agent');
  }
  if (action === 'CONTESTER' && ticket.clotureAutoPrevueLe && maintenant >= ticket.clotureAutoPrevueLe) {
    return refus('DELAI_DE_CONTESTATION_DEPASSE', 'Le délai de contestation est écoulé');
  }
  if (action === 'CLOTURER_AUTOMATIQUEMENT' && (!ticket.clotureAutoPrevueLe || maintenant < ticket.clotureAutoPrevueLe)) {
    return refus('CLOTURE_AUTOMATIQUE_PREMATUREE', 'Le délai de clôture automatique n\'est pas écoulé');
  }
  return OK;
}

export function verifierOperation(operation: Operation, ticket: EtatTicket, acteur: Acteur): Verdict {
  const def: DefinitionOperation = OPERATIONS[operation];
  if (!def.statuts.includes(ticket.statut)) {
    return refus('TRANSITION_INTERDITE', `${operation} est impossible au statut ${ticket.statut}`);
  }
  const qualite = qualiteDe(acteur, ticket);
  if (!qualite || !def.par.includes(qualite)) {
    return refus('ACTEUR_NON_AUTORISE', `${operation} est réservé à : ${def.par.join(', ')}`);
  }
  // Répondre depuis OUVERTE prend le ticket en charge : même exigence qu'une prise en charge
  if (operation === 'REPONDRE_AU_CLIENT' && ticket.statut === 'OUVERTE' && !ticket.agentId) {
    return refus('AUCUN_AGENT_ASSIGNE', 'Le ticket doit d\'abord être assigné à un agent');
  }
  return OK;
}

/** Actions de statut offertes à cet acteur maintenant : ce que l'interface affichera en boutons. */
export function actionsPossibles(ticket: EtatTicket, acteur: Acteur, maintenant: Date): ActionStatut[] {
  return (Object.keys(TRANSITIONS) as ActionStatut[]).filter((a) => verifierTransition(a, ticket, acteur, maintenant).ok);
}
