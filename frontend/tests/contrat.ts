/** Le contrat d'API (contrat/openapi.yaml), lu une fois pour les tests. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';

export const CHEMIN_CONTRAT = resolve(__dirname, '../../contrat/openapi.yaml');

export const contrat = parse(readFileSync(CHEMIN_CONTRAT, 'utf8')) as {
  paths: Record<string, Record<string, { operationId?: string }>>;
  components: { schemas: Record<string, unknown> };
};

export const OPERATIONS_DU_CONTRAT = new Set(
  Object.values(contrat.paths).flatMap((item) => Object.values(item).map((op) => op.operationId).filter(Boolean)),
);
