/**
 * Module virtuel « virtual:contrat-operations » : les opérations du contrat (méthode, chemin,
 * résumé, rôles, format du corps et de la réponse), lues dans contrat/openapi.yaml au moment de la
 * compilation. La galerie des maquettes s'en sert pour afficher les appels d'API sous chaque écran ;
 * le client d'API des applications (src/api/client.ts), pour appeler une opération par son nom.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import type { Plugin } from 'vite';

const ID = 'virtual:contrat-operations';
const CONTRAT = resolve(import.meta.dirname, '../../contrat/openapi.yaml');

interface OperationBrute {
  operationId: string;
  summary: string;
  'x-roles'?: string[];
  security?: Record<string, string[]>[];
  requestBody?: { content: Record<string, unknown> };
  responses: Record<string, { $ref?: string; content?: Record<string, unknown> }>;
}

interface OperationContrat {
  methode: string;
  chemin: string;
  resume: string;
  roles: string[];
  corps: 'json' | 'multipart' | null;
  reponse: 'json' | 'fichier' | 'vide';
  securite: 'aucune' | 'personnel' | 'client' | 'cookie';
}

export function contratOperations(): Plugin {
  return {
    name: 'contrat-operations',
    resolveId: (id) => (id === ID ? `\0${ID}` : undefined),
    load(id) {
      if (id !== `\0${ID}`) return;
      this.addWatchFile(CONTRAT);
      const contrat = parse(readFileSync(CONTRAT, 'utf8')) as {
        paths: Record<string, Record<string, OperationBrute>>;
        components: { responses: Record<string, { content?: Record<string, unknown> }> };
      };
      const operations: Record<string, OperationContrat> = {};
      for (const [chemin, item] of Object.entries(contrat.paths)) {
        for (const [methode, op] of Object.entries(item)) {
          if (!['get', 'post', 'put', 'patch', 'delete'].includes(methode)) continue;
          const types = Object.keys(op.requestBody?.content ?? {});
          const corps = types.includes('multipart/form-data') ? 'multipart' : types.includes('application/json') ? 'json' : null;
          const succes = Object.entries(op.responses).find(([code]) => code.startsWith('2'))?.[1];
          const contenu = succes?.$ref ? contrat.components.responses[succes.$ref.split('/').pop()!]?.content : succes?.content;
          const reponse = !contenu ? 'vide' : 'application/json' in contenu ? 'json' : 'fichier';
          const schema = Object.keys(op.security?.[0] ?? {})[0];
          const securite = schema === 'jetonPersonnel' ? 'personnel' : schema === 'jetonClient' ? 'client' : schema === 'cookieRafraichissement' ? 'cookie' : 'aucune';
          operations[op.operationId] = { methode: methode.toUpperCase(), chemin: `/api/v1${chemin}`, resume: op.summary, roles: op['x-roles'] ?? [], corps, reponse, securite };
        }
      }
      return `export default ${JSON.stringify(operations)};`;
    },
  };
}
