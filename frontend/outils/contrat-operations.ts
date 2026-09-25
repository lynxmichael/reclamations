/**
 * Module virtuel « virtual:contrat-operations » : les opérations du contrat (méthode, chemin,
 * résumé, rôles), lues dans contrat/openapi.yaml au moment de la compilation. La galerie des
 * maquettes s'en sert pour afficher, sous chaque écran, les appels d'API qui l'alimentent.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import type { Plugin } from 'vite';

const ID = 'virtual:contrat-operations';
const CONTRAT = resolve(import.meta.dirname, '../../contrat/openapi.yaml');

export function contratOperations(): Plugin {
  return {
    name: 'contrat-operations',
    resolveId: (id) => (id === ID ? `\0${ID}` : undefined),
    load(id) {
      if (id !== `\0${ID}`) return;
      this.addWatchFile(CONTRAT);
      const contrat = parse(readFileSync(CONTRAT, 'utf8')) as {
        paths: Record<string, Record<string, { operationId: string; summary: string; 'x-roles'?: string[] }>>;
      };
      const operations: Record<string, { methode: string; chemin: string; resume: string; roles: string[] }> = {};
      for (const [chemin, item] of Object.entries(contrat.paths)) {
        for (const [methode, op] of Object.entries(item)) {
          if (!['get', 'post', 'put', 'patch', 'delete'].includes(methode)) continue;
          operations[op.operationId] = { methode: methode.toUpperCase(), chemin: `/api/v1${chemin}`, resume: op.summary, roles: op['x-roles'] ?? [] };
        }
      }
      return `export default ${JSON.stringify(operations)};`;
    },
  };
}
