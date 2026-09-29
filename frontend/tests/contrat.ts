/** Le contrat d'API (contrat/openapi.yaml), lu une fois pour les tests. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { parse } from 'yaml';

export const CHEMIN_CONTRAT = resolve(__dirname, '../../contrat/openapi.yaml');

export const contrat = parse(readFileSync(CHEMIN_CONTRAT, 'utf8')) as {
  paths: Record<string, Record<string, { operationId?: string }>>;
  components: { schemas: Record<string, unknown> };
};

export const OPERATIONS_DU_CONTRAT = new Set(
  Object.values(contrat.paths).flatMap((item) => Object.values(item).map((op) => op.operationId).filter(Boolean)),
);

/** Mode strict : un objet décrit par ses propriétés n'en accepte pas d'autres. */
function durcir(document: typeof contrat) {
  const copie = structuredClone(document);
  const dansAllOf = new Set<string>();
  const parcourir = (n: unknown, visite: (o: Record<string, unknown>) => void) => {
    if (Array.isArray(n)) n.forEach((e) => parcourir(e, visite));
    else if (n && typeof n === 'object') {
      visite(n as Record<string, unknown>);
      Object.values(n).forEach((e) => parcourir(e, visite));
    }
  };
  parcourir(copie.components, (o) => {
    if (Array.isArray(o.allOf)) for (const s of o.allOf as { $ref?: string }[]) if (s.$ref) dansAllOf.add(s.$ref.split('/').pop()!);
  });
  for (const [nom, schema] of Object.entries(copie.components.schemas)) {
    if (dansAllOf.has(nom)) continue;
    parcourir(schema, (o) => {
      if (o.properties && o.additionalProperties === undefined && !o.allOf) o.additionalProperties = false;
    });
  }
  return copie;
}

/** Validateur JSON Schema 2020-12 des schémas du contrat : getSchema('contrat#/components/schemas/<Nom>'). */
export const validateur = new Ajv2020({ strict: false, allErrors: true });
addFormats(validateur);
validateur.addFormat('binary', true);
validateur.addSchema(durcir(contrat), 'contrat');

/** Erreurs de validation d'une valeur contre un schéma du contrat ([] si elle est conforme). */
export function ecarts(schema: string, valeur: unknown) {
  const v = validateur.getSchema(`contrat#/components/schemas/${schema}`);
  if (!v) throw new Error(`Schéma inconnu : ${schema}`);
  return v(valeur) ? [] : (v.errors ?? []).map((e) => `${e.instancePath} ${e.message}`);
}
