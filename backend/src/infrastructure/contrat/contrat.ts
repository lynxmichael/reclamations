/**
 * Le contrat d'API (contrat/openapi.yaml, étape 5) chargé au démarrage.
 *
 * L'API en tire, pour chaque opération : méthode et chemin HTTP, rôles autorisés (x-roles),
 * mode d'authentification, schémas des paramètres et du corps, statut de succès. Une route
 * ne peut donc pas dériver du contrat : elle en est lue.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';

export type Methode = 'get' | 'post' | 'put' | 'patch' | 'delete';
export type Securite = 'aucune' | 'jetonPersonnel' | 'jetonClient' | 'cookieRafraichissement';
export type Role = 'PUBLIC' | 'CLIENT' | 'AGENT' | 'SUPERVISEUR' | 'ADMIN_ENTREPRISE' | 'SUPER_ADMIN';

export type Schema = Record<string, unknown>;

export interface Parametre {
  readonly nom: string;
  readonly dans: 'path' | 'query' | 'header';
  readonly requis: boolean;
  readonly schema: Schema;
}

export interface OperationContrat {
  readonly id: string;
  readonly methode: Methode;
  /** Chemin du contrat, sans le préfixe /api/v1 : /banque/reclamations/{id} */
  readonly chemin: string;
  readonly roles: readonly Role[];
  readonly securite: Securite;
  readonly action?: string;
  readonly statutSucces: number;
  readonly parametres: readonly Parametre[];
  readonly corps: { readonly type: 'json' | 'multipart'; readonly requis: boolean; readonly schema: Schema } | null;
  /** Statut → type de contenu → schéma (références aux réponses communes résolues) */
  readonly reponses: Readonly<Record<string, Readonly<Record<string, Schema | null>>>>;
}

export interface DocumentContrat {
  readonly texte: string;
  readonly brut: {
    info: { version: string };
    paths: Record<string, Record<string, unknown>>;
    components: { schemas: Record<string, Schema>; parameters: Record<string, unknown>; responses: Record<string, unknown> };
  };
  readonly operations: ReadonlyMap<string, OperationContrat>;
}

const METHODES: readonly Methode[] = ['get', 'post', 'put', 'patch', 'delete'];

let charge: DocumentContrat | null = null;

/** Chemin du contrat : CONTRAT_CHEMIN, sinon ../contrat/openapi.yaml depuis le dossier backend. */
export function cheminContrat(): string {
  return resolve(process.env.CONTRAT_CHEMIN?.trim() || resolve(process.cwd(), '../contrat/openapi.yaml'));
}

export function contratApi(): DocumentContrat {
  if (charge) return charge;
  const texte = readFileSync(cheminContrat(), 'utf8');
  const brut = parse(texte) as DocumentContrat['brut'];
  const composants = brut.components;

  const deref = <T>(objet: unknown): T => {
    const ref = (objet as { $ref?: string })?.$ref;
    if (!ref) return objet as T;
    const [, , type, nom] = ref.split('/');
    return (composants as unknown as Record<string, Record<string, unknown>>)[type][nom] as T;
  };

  const operations = new Map<string, OperationContrat>();
  for (const [chemin, item] of Object.entries(brut.paths)) {
    for (const methode of METHODES) {
      const op = item[methode] as Record<string, unknown> | undefined;
      if (!op) continue;
      const id = op.operationId as string;
      const securiteBrute = (op.security as Record<string, unknown>[] | undefined) ?? [];
      const schemaSecurite = securiteBrute.flatMap((s) => Object.keys(s))[0];
      const parametres = ((op.parameters as unknown[] | undefined) ?? []).map((p) => {
        const d = deref<{ name: string; in: 'path' | 'query' | 'header'; required?: boolean; schema: Schema }>(p);
        return { nom: d.name, dans: d.in, requis: d.in === 'path' || !!d.required, schema: d.schema };
      });
      let corps: OperationContrat['corps'] = null;
      const rb = op.requestBody as { required?: boolean; content: Record<string, { schema: Schema }> } | undefined;
      if (rb) {
        const [type, contenu] = Object.entries(rb.content)[0];
        corps = { type: type === 'multipart/form-data' ? 'multipart' : 'json', requis: !!rb.required, schema: contenu.schema };
      }
      const reponses: Record<string, Record<string, Schema | null>> = {};
      for (const [statut, r] of Object.entries(op.responses as Record<string, unknown>)) {
        const rep = deref<{ content?: Record<string, { schema?: Schema }> }>(r);
        reponses[statut] = Object.fromEntries(Object.entries(rep.content ?? {}).map(([t, c]) => [t, c.schema ?? null]));
      }
      const statutSucces = Number(Object.keys(reponses).find((s) => s.startsWith('2')) ?? 200);
      operations.set(id, {
        id,
        methode,
        chemin,
        roles: (op['x-roles'] as Role[]) ?? [],
        securite: (schemaSecurite as Securite | undefined) ?? 'aucune',
        action: op['x-action'] as string | undefined,
        statutSucces,
        parametres,
        corps,
        reponses,
      });
    }
  }
  charge = { texte, brut, operations };
  return charge;
}

export function operation(id: string): OperationContrat {
  const op = contratApi().operations.get(id);
  if (!op) throw new Error(`Opération inconnue du contrat : ${id}`);
  return op;
}
