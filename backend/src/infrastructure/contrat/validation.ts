/**
 * Validation des entrées contre les schémas du contrat (JSON Schema 2020-12, Ajv).
 *
 * Paramètres de chemin et de requête, en-têtes et champs multipart arrivent en texte : ils sont
 * convertis (« 2 » → 2, « true » → true, une valeur seule → tableau) et complétés par les valeurs
 * par défaut du contrat. Le corps JSON n'est pas converti. Les messages sont en français.
 */
import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { contratApi, type OperationContrat, type Schema } from './contrat.js';
import type { ErreurChamp } from './probleme.js';

const REF_CONTRAT = 'contrat';

function nouvelAjv(coercition: boolean) {
  const ajv = new Ajv2020({
    strict: false,
    allErrors: true,
    useDefaults: true,
    coerceTypes: coercition ? 'array' : false,
  });
  addFormats(ajv);
  ajv.addFormat('binary', true);
  ajv.addSchema({ $id: REF_CONTRAT, components: { schemas: contratApi().brut.components.schemas } });
  return ajv;
}

let ajvTexte: ReturnType<typeof nouvelAjv> | null = null;
let ajvJson: ReturnType<typeof nouvelAjv> | null = null;

/** Réécrit les références internes (#/components/…) vers le document du contrat. */
export function rattacher(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(rattacher);
  if (schema && typeof schema === 'object') {
    return Object.fromEntries(Object.entries(schema).map(([k, v]) =>
      [k, k === '$ref' && typeof v === 'string' && v.startsWith('#/') ? `${REF_CONTRAT}${v}` : rattacher(v)]));
  }
  return schema;
}

/** Retire les propriétés fichier (format binary) : les fichiers sont contrôlés à part. */
function sansFichiers(schema: Schema): { schema: Schema; champsFichiers: string[]; fichiersRequis: string[] } {
  const proprietes = { ...((schema.properties as Record<string, Schema> | undefined) ?? {}) };
  const champsFichiers: string[] = [];
  for (const [nom, p] of Object.entries(proprietes)) {
    const estFichier = p.format === 'binary' || (p.items as Schema | undefined)?.format === 'binary'
      || (typeof p.$ref === 'string' && p.$ref.endsWith('/Fichiers'));
    if (estFichier) {
      champsFichiers.push(nom);
      delete proprietes[nom];
    }
  }
  const requis = (schema.required as string[] | undefined) ?? [];
  return {
    schema: { ...schema, properties: proprietes, required: requis.filter((r) => !champsFichiers.includes(r)) },
    champsFichiers,
    fichiersRequis: requis.filter((r) => champsFichiers.includes(r)),
  };
}

export interface ValidateurOperation {
  readonly chemin: ValidateFunction;
  readonly requete: ValidateFunction;
  readonly entetes: ValidateFunction;
  readonly corps: ValidateFunction | null;
  readonly champsFichiers: readonly string[];
  readonly fichiersRequis: readonly string[];
}

const cache = new Map<string, ValidateurOperation>();

export function validateurDe(op: OperationContrat): ValidateurOperation {
  const deja = cache.get(op.id);
  if (deja) return deja;
  ajvTexte ??= nouvelAjv(true);
  ajvJson ??= nouvelAjv(false);
  const objet = (dans: 'path' | 'query' | 'header') => {
    const ps = op.parametres.filter((p) => p.dans === dans);
    return rattacher({
      type: 'object',
      properties: Object.fromEntries(ps.map((p) => [dans === 'header' ? p.nom.toLowerCase() : p.nom, p.schema])),
      required: ps.filter((p) => p.requis).map((p) => (dans === 'header' ? p.nom.toLowerCase() : p.nom)),
    }) as Schema;
  };
  let corps: ValidateFunction | null = null;
  let champsFichiers: string[] = [];
  let fichiersRequis: string[] = [];
  if (op.corps) {
    if (op.corps.type === 'multipart') {
      const resolu = resoudre(op.corps.schema);
      const s = sansFichiers(resolu);
      champsFichiers = s.champsFichiers;
      fichiersRequis = s.fichiersRequis;
      corps = ajvTexte.compile(rattacher(s.schema) as Schema);
    } else {
      corps = ajvJson.compile(rattacher(op.corps.schema) as Schema);
    }
  }
  const v: ValidateurOperation = {
    chemin: ajvTexte.compile(objet('path')),
    requete: ajvTexte.compile(objet('query')),
    entetes: ajvTexte.compile(objet('header')),
    corps,
    champsFichiers,
    fichiersRequis,
  };
  cache.set(op.id, v);
  return v;
}

/** Schéma référencé (#/components/schemas/X) → sa définition. */
function resoudre(schema: Schema): Schema {
  const ref = schema.$ref as string | undefined;
  if (!ref) return schema;
  return contratApi().brut.components.schemas[ref.split('/').pop() as string];
}

// ---------------------------------------------------------------------------
//  Messages en français
// ---------------------------------------------------------------------------

const FORMATS: Record<string, string> = {
  email: 'Adresse e-mail invalide',
  uuid: 'Identifiant invalide',
  'date-time': 'Date et heure invalides (format ISO 8601 attendu)',
  date: 'Date invalide (format AAAA-MM-JJ attendu)',
  uri: 'Adresse invalide',
};

function champDe(e: ErrorObject, prefixe: string): string {
  const chemin = e.instancePath.split('/').filter(Boolean).join('.');
  const manquant = e.keyword === 'required' ? (e.params as { missingProperty: string }).missingProperty : '';
  const complet = [chemin, manquant].filter(Boolean).join('.');
  return complet || prefixe || 'corps';
}

function messageDe(e: ErrorObject): string {
  const p = e.params as Record<string, unknown>;
  switch (e.keyword) {
    case 'required': return 'Champ obligatoire';
    case 'type': return `Type attendu : ${String(p.type)}`;
    case 'format': return FORMATS[String(p.format)] ?? 'Format invalide';
    case 'minLength': return Number(p.limit) === 1 ? 'Ne peut pas être vide' : `${String(p.limit)} caractères au moins`;
    case 'maxLength': return `${String(p.limit)} caractères au plus`;
    case 'minimum': return `Doit être supérieur ou égal à ${String(p.limit)}`;
    case 'maximum': return `Doit être inférieur ou égal à ${String(p.limit)}`;
    case 'minItems': return `${String(p.limit)} éléments au moins`;
    case 'maxItems': return `${String(p.limit)} éléments au plus`;
    case 'minProperties': return 'Au moins un champ à modifier';
    case 'pattern': return 'Format invalide';
    case 'enum': return `Valeur attendue parmi : ${(p.allowedValues as unknown[]).join(', ')}`;
    case 'const': return p.allowedValue === true ? 'Doit être accepté' : `Valeur attendue : ${String(p.allowedValue)}`;
    default: return 'Valeur invalide';
  }
}

/** Erreurs Ajv → erreurs par champ, sans doublon, en ignorant les messages de structure (anyOf, oneOf). */
export function erreursChamps(erreurs: ErrorObject[] | null | undefined, prefixe = ''): ErreurChamp[] {
  const vus = new Set<string>();
  const res: ErreurChamp[] = [];
  const anyOf = (erreurs ?? []).some((e) => e.keyword === 'anyOf' && e.instancePath === '');
  for (const e of erreurs ?? []) {
    if (['anyOf', 'oneOf', 'if'].includes(e.keyword)) continue;
    // anyOf [email] [telephone] du dépôt : un seul message clair
    if (anyOf && e.keyword === 'required' && e.instancePath === '' && e.schemaPath.includes('anyOf')) {
      const champ = 'telephone';
      if (!vus.has(champ)) {
        vus.add(champ);
        res.push({ champ, message: 'Un téléphone ou un e-mail au moins' });
      }
      continue;
    }
    const champ = champDe(e, prefixe);
    if (vus.has(champ)) continue;
    vus.add(champ);
    res.push({ champ, message: messageDe(e) });
  }
  return res;
}
