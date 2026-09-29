import { describe, expect, it } from 'vitest';
import type { StatutReclamation } from '../enumerations.js';
import {
  actionsPossibles, OPERATIONS, TRANSITIONS, verifierOperation, verifierTransition,
  type Acteur, type ActionStatut, type EtatTicket, type Operation,
} from './machine.js';

const maintenant = new Date('2026-09-25T10:00:00Z');
const demain = new Date('2026-09-26T10:00:00Z');
const hier = new Date('2026-09-24T10:00:00Z');

const ACTEURS: Record<string, Acteur> = {
  AGENT_ASSIGNE: { type: 'UTILISATEUR', id: 'agent-1', role: 'AGENT', libelle: 'Agent 1' },
  AUTRE_AGENT: { type: 'UTILISATEUR', id: 'agent-2', role: 'AGENT', libelle: 'Agent 2' },
  SUPERVISEUR: { type: 'UTILISATEUR', id: 'sup-1', role: 'SUPERVISEUR', libelle: 'Superviseur' },
  ADMIN_ENTREPRISE: { type: 'UTILISATEUR', id: 'adm-1', role: 'ADMIN_ENTREPRISE', libelle: 'Admin' },
  SUPER_ADMIN: { type: 'UTILISATEUR', id: 'sa-1', role: 'SUPER_ADMIN', libelle: 'Super Admin' },
  CLIENT: { type: 'CLIENT', clientId: 'client-1' },
  AUTRE_CLIENT: { type: 'CLIENT', clientId: 'client-2' },
  SYSTEME: { type: 'SYSTEME' },
};
const STATUTS: StatutReclamation[] = ['OUVERTE', 'EN_COURS', 'EN_ATTENTE_CLIENT', 'RESOLUE', 'CLOTUREE'];
const ticket = (statut: StatutReclamation, extra: Partial<EtatTicket> = {}): EtatTicket => ({
  statut, agentId: 'agent-1', clientId: 'client-1', clotureAutoPrevueLe: statut === 'RESOLUE' ? demain : null, ...extra,
});

/**
 * Oracle écrit à partir du diagramme du §6.3 et des droits du §5 :
 * « statut:action » → acteurs autorisés. Tout ce qui n'est pas listé doit être refusé.
 */
const TRANSITIONS_ATTENDUES: Record<string, string[]> = {
  'OUVERTE:PRENDRE_EN_CHARGE': ['AGENT_ASSIGNE', 'SUPERVISEUR'],
  'OUVERTE:CLOTURER_DE_FORCE': ['SUPERVISEUR'],
  'EN_COURS:QUESTIONNER_CLIENT': ['AGENT_ASSIGNE', 'SUPERVISEUR'],
  'EN_COURS:RESOUDRE': ['AGENT_ASSIGNE', 'SUPERVISEUR'],
  'EN_COURS:CLOTURER_DE_FORCE': ['SUPERVISEUR'],
  'EN_ATTENTE_CLIENT:REPRENDRE_SUR_REPONSE': ['CLIENT'],
  'EN_ATTENTE_CLIENT:CLOTURER_DE_FORCE': ['SUPERVISEUR'],
  'RESOLUE:CONFIRMER': ['CLIENT'],
  'RESOLUE:CONTESTER': ['CLIENT'],
  'RESOLUE:CLOTURER_DE_FORCE': ['SUPERVISEUR'],
  // RESOLUE:CLOTURER_AUTOMATIQUEMENT seulement après le délai (testé à part)
};

describe('transitions de statut : matrice complète statut × action × acteur', () => {
  const actions = Object.keys(TRANSITIONS) as ActionStatut[];
  for (const statut of STATUTS) {
    for (const action of actions) {
      const autorises = TRANSITIONS_ATTENDUES[`${statut}:${action}`] ?? [];
      it(`${statut} · ${action} → ${autorises.length ? autorises.join(', ') : 'personne'}`, () => {
        for (const [nom, acteur] of Object.entries(ACTEURS)) {
          const verdict = verifierTransition(action, ticket(statut), acteur, maintenant);
          expect(verdict.ok, `${nom}`).toBe(autorises.includes(nom));
        }
      });
    }
  }

  it('CLOTUREE est un état final : aucune action possible pour personne', () => {
    for (const acteur of Object.values(ACTEURS)) expect(actionsPossibles(ticket('CLOTUREE'), acteur, maintenant)).toEqual([]);
  });
});

describe('conditions particulières', () => {
  it('la prise en charge exige un agent assigné, même pour un superviseur', () => {
    const v = verifierTransition('PRENDRE_EN_CHARGE', ticket('OUVERTE', { agentId: null }), ACTEURS.SUPERVISEUR, maintenant);
    expect(v).toMatchObject({ ok: false, code: 'AUCUN_AGENT_ASSIGNE' });
  });
  it('répondre depuis « Ouverte » vaut prise en charge : refusé tant qu\'aucun agent n\'est assigné', () => {
    expect(verifierOperation('REPONDRE_AU_CLIENT', ticket('OUVERTE', { agentId: null }), ACTEURS.SUPERVISEUR))
      .toMatchObject({ ok: false, code: 'AUCUN_AGENT_ASSIGNE' });
    expect(verifierOperation('REPONDRE_AU_CLIENT', ticket('EN_COURS', { agentId: null }), ACTEURS.SUPERVISEUR).ok).toBe(true);
    expect(verifierOperation('NOTE_INTERNE', ticket('OUVERTE', { agentId: null }), ACTEURS.SUPERVISEUR).ok).toBe(true);
  });
  it('la contestation est refusée une fois le délai de clôture écoulé', () => {
    const v = verifierTransition('CONTESTER', ticket('RESOLUE', { clotureAutoPrevueLe: hier }), ACTEURS.CLIENT, maintenant);
    expect(v).toMatchObject({ ok: false, code: 'DELAI_DE_CONTESTATION_DEPASSE' });
  });
  it('la clôture automatique attend la fin du délai, puis revient au système seul', () => {
    expect(verifierTransition('CLOTURER_AUTOMATIQUEMENT', ticket('RESOLUE'), ACTEURS.SYSTEME, maintenant))
      .toMatchObject({ ok: false, code: 'CLOTURE_AUTOMATIQUE_PREMATUREE' });
    const echu = ticket('RESOLUE', { clotureAutoPrevueLe: hier });
    expect(verifierTransition('CLOTURER_AUTOMATIQUEMENT', echu, ACTEURS.SYSTEME, maintenant).ok).toBe(true);
    expect(verifierTransition('CLOTURER_AUTOMATIQUEMENT', echu, ACTEURS.SUPERVISEUR, maintenant).ok).toBe(false);
  });
  it('un agent non assigné ne peut rien faire sur le ticket d\'un collègue', () => {
    for (const statut of STATUTS) expect(actionsPossibles(ticket(statut), ACTEURS.AUTRE_AGENT, maintenant)).toEqual([]);
  });
  it('le Super Admin n\'agit sur aucun ticket (arbitrage 7)', () => {
    for (const statut of STATUTS) {
      expect(actionsPossibles(ticket(statut), ACTEURS.SUPER_ADMIN, maintenant)).toEqual([]);
      expect(verifierOperation('CONSULTER', ticket(statut), ACTEURS.SUPER_ADMIN).ok).toBe(false);
    }
  });
  it('boutons proposés au client sur un ticket résolu : confirmer ou contester', () => {
    expect(actionsPossibles(ticket('RESOLUE'), ACTEURS.CLIENT, maintenant)).toEqual(['CONFIRMER', 'CONTESTER']);
  });
});

describe('opérations sans changement de statut', () => {
  const ATTENDU: Record<Operation, { statuts: StatutReclamation[]; par: string[] }> = {
    CONSULTER: { statuts: STATUTS, par: ['AGENT_ASSIGNE', 'SUPERVISEUR', 'ADMIN_ENTREPRISE', 'CLIENT', 'SYSTEME'] },
    ASSIGNER: { statuts: ['OUVERTE', 'EN_COURS', 'EN_ATTENTE_CLIENT', 'RESOLUE'], par: ['SUPERVISEUR'] },
    CHANGER_PRIORITE: { statuts: ['OUVERTE', 'EN_COURS', 'EN_ATTENTE_CLIENT', 'RESOLUE'], par: ['AGENT_ASSIGNE', 'SUPERVISEUR'] },
    ESCALADER: { statuts: ['OUVERTE', 'EN_COURS', 'EN_ATTENTE_CLIENT'], par: ['AGENT_ASSIGNE'] },
    NOTE_INTERNE: { statuts: STATUTS, par: ['AGENT_ASSIGNE', 'SUPERVISEUR'] },
    REPONDRE_AU_CLIENT: { statuts: ['OUVERTE', 'EN_COURS', 'EN_ATTENTE_CLIENT'], par: ['AGENT_ASSIGNE', 'SUPERVISEUR'] },
    MESSAGE_DU_CLIENT: { statuts: ['OUVERTE', 'EN_COURS', 'EN_ATTENTE_CLIENT'], par: ['CLIENT'] },
  };
  for (const operation of Object.keys(OPERATIONS) as Operation[]) {
    it(`${operation}`, () => {
      for (const statut of STATUTS) {
        for (const [nom, acteur] of Object.entries(ACTEURS)) {
          const attendu = ATTENDU[operation].statuts.includes(statut) && ATTENDU[operation].par.includes(nom);
          expect(verifierOperation(operation, ticket(statut), acteur).ok, `${statut} · ${nom}`).toBe(attendu);
        }
      }
    });
  }
});
