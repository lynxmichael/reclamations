/**
 * Cohérence entre le contrat d'API (contrat/openapi.yaml) et le code des étapes 2 à 4.
 * Si le modèle, la machine d'états ou les erreurs changent sans que le contrat suive, ces tests échouent.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import openapiTS, { astToString } from 'openapi-typescript';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import * as Enums from '../generated/prisma/enums.js';
import { OPERATIONS, TRANSITIONS } from '../domaine/reclamation/machine.js';
import { CycleDeVie } from '../application/reclamations/cycle-de-vie.js';

const CHEMIN_CONTRAT = resolve(process.cwd(), '../contrat/openapi.yaml');
const texteContrat = readFileSync(CHEMIN_CONTRAT, 'utf8');
const contrat = parse(texteContrat) as {
  paths: Record<string, Record<string, Operation>>;
  components: { schemas: Record<string, { enum?: string[] }>; responses: Record<string, { content?: Record<string, unknown> }> };
};

interface Operation {
  operationId?: string;
  summary?: string;
  tags?: string[];
  security?: Record<string, string[]>[];
  'x-roles'?: string[];
  'x-action'?: string;
  responses: Record<string, { $ref?: string; content?: Record<string, unknown> }>;
}

const METHODES = ['get', 'post', 'put', 'patch', 'delete'] as const;
const operations = Object.entries(contrat.paths).flatMap(([chemin, item]) =>
  METHODES.filter((m) => item[m]).map((m) => ({ chemin, methode: m, op: item[m] as Operation })));
const enumContrat = (nom: string) => contrat.components.schemas[nom]?.enum ?? [];

describe('énumérations identiques au modèle de données', () => {
  it.each([
    ['StatutReclamation', Enums.StatutReclamation],
    ['Priorite', Enums.Priorite],
    ['CanalDepot', Enums.CanalDepot],
    ['RoleUtilisateur', Enums.RoleUtilisateur],
    ['StatutUtilisateur', Enums.StatutUtilisateur],
    ['TypeEvenement', Enums.TypeEvenement],
    ['ModeCloture', Enums.ModeCloture],
    ['MotifClotureForcee', Enums.MotifClotureForcee],
    ['TypeCommentaire', Enums.TypeCommentaire],
    ['TypeActeur', Enums.TypeActeur],
  ] as const)('%s', (nom, valeurs) => {
    expect(enumContrat(nom)).toEqual(Object.values(valeurs));
  });

  it('actions et opérations de la machine d\'états (étape 4)', () => {
    expect(enumContrat('ActionStatut')).toEqual(Object.keys(TRANSITIONS));
    expect(enumContrat('OperationTicket')).toEqual(Object.keys(OPERATIONS));
  });
});

describe('codes d\'erreur', () => {
  it('chaque code levé par le code (ErreurMetier, refus de la machine) existe dans le contrat', () => {
    const fichiers: string[] = [];
    const parcourir = (dossier: string) => {
      for (const nom of readdirSync(dossier)) {
        const chemin = join(dossier, nom);
        if (statSync(chemin).isDirectory()) parcourir(chemin);
        else if (nom.endsWith('.ts') && !nom.endsWith('.test.ts')) fichiers.push(chemin);
      }
    };
    parcourir(resolve(process.cwd(), 'src/application'));
    parcourir(resolve(process.cwd(), 'src/domaine'));
    const codes = new Set<string>();
    for (const f of fichiers) {
      const source = readFileSync(f, 'utf8');
      for (const m of source.matchAll(/new ErreurMetier\(\s*'([A-Z_]+)'/g)) codes.add(m[1]);
      for (const m of source.matchAll(/refus\(\s*'([A-Z_]+)'/g)) codes.add(m[1]);
      for (const m of source.matchAll(/new ErreurMetier\('INTROUVABLE'|introuvable\(\)/g)) if (m) codes.add('INTROUVABLE');
    }
    expect(codes.size).toBeGreaterThan(10);
    const manquants = [...codes].filter((c) => !enumContrat('CodeErreur').includes(c));
    expect(manquants).toEqual([]);
  });

  it('toutes les réponses d\'erreur sont au format problem+json (RFC 9457)', () => {
    for (const [nom, reponse] of Object.entries(contrat.components.responses)) {
      if (['Fichier', 'Reclamation', 'SessionOuverte', 'Parametres', 'Regles', 'Horaires', 'UnUtilisateur', 'UneBanque', 'Verification', 'Recu'].includes(nom)) continue;
      expect(Object.keys(reponse.content ?? {}), nom).toEqual(['application/problem+json']);
    }
    for (const { chemin, methode, op } of operations) {
      for (const [statut, reponse] of Object.entries(op.responses)) {
        if (/^4/.test(statut)) expect(reponse.$ref, `${methode.toUpperCase()} ${chemin} ${statut}`).toMatch(/^#\/components\/responses\//);
      }
    }
  });
});

describe('opérations', () => {
  it('chaque opération a un identifiant unique, un résumé, un tag et des rôles', () => {
    const ids = operations.map((o) => o.op.operationId);
    expect(new Set(ids).size).toBe(ids.length);
    const rolesConnus = ['PUBLIC', 'CLIENT', 'AGENT', 'SUPERVISEUR', 'ADMIN_ENTREPRISE', 'SUPER_ADMIN'];
    for (const { chemin, methode, op } of operations) {
      const nom = `${methode.toUpperCase()} ${chemin}`;
      expect(op.operationId, nom).toBeTruthy();
      expect(op.summary, nom).toBeTruthy();
      expect(op.tags?.length, nom).toBe(1);
      expect(op['x-roles']?.length, nom).toBeGreaterThan(0);
      for (const r of op['x-roles'] ?? []) expect(rolesConnus, nom).toContain(r);
    }
  });

  it('la sécurité suit l\'espace : public sans jeton, /client jeton client, /banque et /plateforme jeton du personnel', () => {
    for (const { chemin, methode, op } of operations) {
      const nom = `${methode.toUpperCase()} ${chemin}`;
      const schemas = (op.security ?? []).flatMap((s) => Object.keys(s));
      if (chemin.startsWith('/public') || chemin === '/sante') expect(schemas, nom).toEqual([]);
      else if (chemin.startsWith('/client')) expect(schemas, nom).toEqual(['jetonClient']);
      else if (chemin.startsWith('/banque') || chemin.startsWith('/plateforme')) expect(schemas, nom).toEqual(['jetonPersonnel']);
      if (chemin.startsWith('/plateforme')) expect(op['x-roles'], nom).toEqual(['SUPER_ADMIN']);
      if (chemin.startsWith('/banque')) expect(op['x-roles'], nom).not.toContain('SUPER_ADMIN');
      if (schemas.length === 0) expect(op['x-roles'], nom).toEqual(['PUBLIC']);
    }
  });

  it('les opérations protégées déclarent 401', () => {
    for (const { chemin, methode, op } of operations) {
      if ((op.security ?? []).length > 0) expect(Object.keys(op.responses), `${methode.toUpperCase()} ${chemin}`).toContain('401');
    }
  });
});

describe('lien avec le cycle de vie (étape 4)', () => {
  const INTERNES = new Set([
    'constructor', 'maintenant', 'trouverOuCreerClient', 'prochainNumero', 'signalerPlafond', 'surTicket',
    'transition', 'noterPremiereReponse', 'commentaire', 'joindre', 'evenement', 'auditer', 'envois',
    // Attribution par le système (étape 16), au dépôt et par le worker : pas d'opération d'API
    'attribuer',
  ]);
  const actionsDuService = Object.getOwnPropertyNames(CycleDeVie.prototype).filter((n) => !INTERNES.has(n));
  const parAction = new Map(operations.filter((o) => o.op['x-action']).map((o) => [o.op['x-action'] as string, o]));

  it('chaque action du service a exactement une opération d\'API', () => {
    expect(actionsDuService.sort()).toEqual([...parAction.keys()].sort());
  });

  /** Qualités de la machine d'états → rôles de l'API (l'agent assigné est un AGENT). */
  const ROLE: Record<string, string | null> = { AGENT_ASSIGNE: 'AGENT', SUPERVISEUR: 'SUPERVISEUR', CLIENT: 'CLIENT', ADMIN_ENTREPRISE: 'ADMIN_ENTREPRISE', SYSTEME: null };
  const REGLE: Record<string, { par: readonly string[] }> = {
    prendreEnCharge: TRANSITIONS.PRENDRE_EN_CHARGE,
    resoudre: TRANSITIONS.RESOUDRE,
    confirmer: TRANSITIONS.CONFIRMER,
    contester: TRANSITIONS.CONTESTER,
    cloturerDeForce: TRANSITIONS.CLOTURER_DE_FORCE,
    assigner: OPERATIONS.ASSIGNER,
    changerPriorite: OPERATIONS.CHANGER_PRIORITE,
    escalader: OPERATIONS.ESCALADER,
    noteInterne: OPERATIONS.NOTE_INTERNE,
    repondreAuClient: OPERATIONS.REPONDRE_AU_CLIENT,
    messageDuClient: OPERATIONS.MESSAGE_DU_CLIENT,
  };

  it.each(Object.keys(REGLE))('%s : les rôles de l\'API sont ceux de la machine d\'états', (action) => {
    const attendus = [...new Set(REGLE[action].par.map((q) => ROLE[q]).filter((r): r is string => !!r))].sort();
    expect([...(parAction.get(action)?.op['x-roles'] ?? [])].sort()).toEqual(attendus);
  });

  it('le dépôt est public', () => {
    expect(parAction.get('deposer')?.op['x-roles']).toEqual(['PUBLIC']);
  });
});

describe('types TypeScript générés', () => {
  it('src/contrat/api.d.ts est à jour (npm run contrat:types)', async () => {
    const attendu = astToString(await openapiTS(new URL(`file://${CHEMIN_CONTRAT}`)));
    const actuel = readFileSync(resolve(process.cwd(), 'src/contrat/api.d.ts'), 'utf8');
    const corps = (t: string) => t.slice(t.indexOf('export'));
    expect(corps(actuel)).toBe(corps(attendu));
  });
});
