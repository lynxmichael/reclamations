/**
 * Les maquettes suivent le contrat :
 * - chaque donnée affichée est une réponse valide de l'API (schémas de contrat/openapi.yaml,
 *   sans champ en plus) ;
 * - les boutons montrés sur un ticket sont ceux que la machine d'états de l'étape 4 permet ;
 * - chaque écran cite des opérations qui existent, et s'affiche sans valeur manquante ;
 * - les types générés (src/api/schema.d.ts) sont à jour.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import openapiTS, { astToString } from 'openapi-typescript';
import { describe, expect, it } from 'vitest';
import type { S } from '../src/api/types';
import { EXEMPLES } from '../src/maquettes/donnees';
import { CHEMIN_CONTRAT, validateur } from './contrat';
import { MAINTENANT, id } from '../src/maquettes/donnees/commun';
import { AYA, SERGE, FATOU } from '../src/maquettes/donnees/parametrage';
import { FICHE_42, FICHE_52, FICHE_53, FICHE_54 } from '../src/maquettes/donnees/reclamations';
import { MA_RECLAMATION_EN_COURS, MA_RECLAMATION_RESOLUE } from '../src/maquettes/donnees/portail';
import { OPERATIONS, actionsPossibles, verifierOperation } from '../../backend/src/domaine/reclamation/machine';
import type { Acteur, EtatTicket, Operation } from '../../backend/src/domaine/reclamation/machine';

const ajv = validateur;

describe('données des maquettes conformes au contrat', () => {
  it.each(EXEMPLES.map((e) => [e.nom, e] as const))('%s', (_nom, e) => {
    const valider = ajv.getSchema(`contrat#/components/schemas/${e.schema}`);
    expect(valider, `schéma ${e.schema}`).toBeDefined();
    const valeurs = e.liste ? (e.valeur as unknown[]) : [e.valeur];
    if (e.liste) expect(valeurs.length).toBeGreaterThan(0);
    for (const v of valeurs) {
      const ok = valider!(v);
      expect(ok ? [] : valider!.errors).toEqual([]);
    }
  });
});

describe("boutons d'une réclamation = machine d'états de l'étape 4", () => {
  const maintenant = new Date(MAINTENANT);
  const operations = (ticket: EtatTicket, acteur: Acteur) =>
    (Object.keys(OPERATIONS) as Operation[]).filter((o) => verifierOperation(o, ticket, acteur).ok);
  /** Étape 21 : l'API ne propose « Rattacher » que s'il y a une autre réclamation en cours du client, consultable */
  const actions = (fiche: S<'ReclamationDetail'>, ticket: EtatTicket, acteur: Acteur) =>
    actionsPossibles(ticket, acteur, maintenant).filter((a) => a !== 'RATTACHER' || fiche.duMemeClient.some((d) => d.statut !== 'CLOTUREE' && d.accessible));

  const ticket42: EtatTicket = { statut: 'EN_COURS', agentId: AYA.id, clientId: id('client', 1), clotureAutoPrevueLe: null };
  const personnel = {
    AGENT: { type: 'UTILISATEUR', id: AYA.id, role: 'AGENT', libelle: 'Aya Konan' },
    SUPERVISEUR: { type: 'UTILISATEUR', id: SERGE.id, role: 'SUPERVISEUR', libelle: 'Serge Kouadio' },
    ADMIN_ENTREPRISE: { type: 'UTILISATEUR', id: FATOU.id, role: 'ADMIN_ENTREPRISE', libelle: 'Fatou Diabaté' },
  } as const satisfies Record<keyof typeof FICHE_42, Acteur>;

  it.each(Object.keys(personnel) as (keyof typeof personnel)[])('fiche vue par %s', (role) => {
    const fiche = FICHE_42[role];
    expect(fiche.actionsPossibles).toEqual(actions(fiche, ticket42, personnel[role]));
    expect(fiche.operationsPossibles).toEqual(operations(ticket42, personnel[role]));
  });

  it('fiche à assigner (étape 16), vue par le superviseur', () => {
    const ticket: EtatTicket = { statut: 'OUVERTE', agentId: null, clientId: FICHE_52.client.id, clotureAutoPrevueLe: null };
    expect(FICHE_52.actionsPossibles).toEqual(actions(FICHE_52, ticket, personnel.SUPERVISEUR));
    expect(FICHE_52.operationsPossibles).toEqual(operations(ticket, personnel.SUPERVISEUR));
  });

  it('doublon possible (étape 21), vu par le superviseur', () => {
    const ticket: EtatTicket = { statut: 'OUVERTE', agentId: null, clientId: FICHE_53.client.id, clotureAutoPrevueLe: null };
    expect(FICHE_53.actionsPossibles).toEqual(actions(FICHE_53, ticket, personnel.SUPERVISEUR));
    expect(FICHE_53.operationsPossibles).toEqual(operations(ticket, personnel.SUPERVISEUR));
  });

  it('saisie au guichet (étape 21), vue par l\'agente qui l\'a saisie', () => {
    const ticket: EtatTicket = { statut: 'OUVERTE', agentId: AYA.id, clientId: FICHE_54.client.id, clotureAutoPrevueLe: null };
    expect(FICHE_54.actionsPossibles).toEqual(actions(FICHE_54, ticket, personnel.AGENT));
    expect(FICHE_54.operationsPossibles).toEqual(operations(ticket, personnel.AGENT));
  });

  it.each([
    ['en cours', MA_RECLAMATION_EN_COURS],
    ['résolue', MA_RECLAMATION_RESOLUE],
  ] as const)('espace client : réclamation %s', (_nom, r) => {
    const ticket: EtatTicket = {
      statut: r.statut,
      agentId: AYA.id,
      clientId: id('client', 1),
      clotureAutoPrevueLe: r.clotureAutoPrevueLe ? new Date(r.clotureAutoPrevueLe) : null,
    };
    const client: Acteur = { type: 'CLIENT', clientId: id('client', 1) };
    expect(r.actionsPossibles).toEqual(actionsPossibles(ticket, client, maintenant));
    expect(r.operationsPossibles).toEqual(operations(ticket, client));
  });
});

describe('types TypeScript générés', () => {
  it('src/api/schema.d.ts est à jour (npm run contrat:types)', async () => {
    const attendu = astToString(await openapiTS(new URL(`file://${CHEMIN_CONTRAT}`)));
    const actuel = readFileSync(resolve(__dirname, '../src/api/schema.d.ts'), 'utf8');
    const corps = (t: string) => t.slice(t.indexOf('export'));
    expect(corps(actuel)).toBe(corps(attendu));
  });
});
