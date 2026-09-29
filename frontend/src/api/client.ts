/**
 * Client de l'API (étape 8) : chaque appel nomme une opération du contrat (operationId), comme les
 * tests de bout en bout du backend. Méthode, chemin, format du corps et sécurité viennent de
 * contrat/openapi.yaml à la compilation (virtual:contrat-operations) ; paramètres, corps et
 * réponses sont typés par src/api/schema.d.ts. Aucune adresse d'API n'est écrite à la main.
 *
 * Erreurs : toute réponse non 2xx devient une ErreurApi portant le « problem+json » (RFC 9457) de
 * l'API ; une panne réseau aussi, avec le code RESEAU.
 */
import operationsContrat from 'virtual:contrat-operations';
import type { components, operations } from './schema';

export type Operation = keyof operations;
type Def<K extends Operation> = operations[K];
type Parametres<K extends Operation> = Def<K>['parameters'];
type Probleme = components['schemas']['Probleme'];

type CheminDe<K extends Operation> = Parametres<K> extends { path: infer X } ? X : never;
type RequeteDe<K extends Operation> = Parametres<K> extends { query?: infer X } ? NonNullable<X> : never;
type ContenuCorps<K extends Operation> = NonNullable<Def<K>['requestBody']> extends { content: infer C } ? C : never;
/** En multipart, les fichiers sont de vrais File du navigateur (le contrat les décrit en binaire). */
type Multipart<B> = { [C in keyof B]: C extends 'fichiers' ? File[] : C extends 'logo' ? File : B[C] };
type CorpsDe<K extends Operation> =
  ContenuCorps<K> extends { 'multipart/form-data': infer B } ? Multipart<B> : ContenuCorps<K> extends { 'application/json': infer J } ? J : never;

type SiPresent<T, O> = [T] extends [never] ? unknown : O;

export type OptionsAppel<K extends Operation> = SiPresent<CheminDe<K>, { chemin: CheminDe<K> }> &
  SiPresent<RequeteDe<K>, { requete?: RequeteDe<K> }> &
  SiPresent<CorpsDe<K>, undefined extends Def<K>['requestBody'] ? { corps?: CorpsDe<K> } : { corps: CorpsDe<K> }> & {
    entetes?: Record<string, string>;
    signal?: AbortSignal;
  };

type Reponses<K extends Operation> = Def<K>['responses'];
type ReponseSucces<K extends Operation> = Reponses<K>[Extract<keyof Reponses<K>, 200 | 201 | 202 | 204>];

/** Un fichier téléchargé (pièce jointe, QR code) avec le nom proposé par l'API. */
export interface FichierRecu {
  contenu: Blob;
  nom: string | null;
  type: string;
}
type Donnees<R> = R extends { content: { 'application/json': infer J } } ? J : R extends { content: object } ? FichierRecu : void;
export type Resultat<K extends Operation> = Donnees<ReponseSucces<K>>;

/** Arguments d'un appel : l'objet d'options devient facultatif quand rien n'y est obligatoire. */
export type ArgumentsAppel<K extends Operation> = object extends OptionsAppel<K> ? [options?: OptionsAppel<K>] : [options: OptionsAppel<K>];

export class ErreurApi extends Error {
  constructor(
    readonly probleme: Probleme,
    readonly statut: number,
    /** Secondes à attendre (en-tête Retry-After des réponses 423 et 429) */
    readonly reessayerDans: number | null = null,
  ) {
    super(probleme.detail ?? probleme.title);
    this.name = 'ErreurApi';
  }
  get code(): string {
    return this.probleme.code;
  }
  /** Message de l'API pour un champ du formulaire, s'il y en a un. */
  champ(nom: string): string | undefined {
    return this.probleme.erreurs?.find((e) => e.champ === nom)?.message;
  }
}

export const PROBLEME_RESEAU: Probleme = {
  type: '/erreurs/reseau',
  title: 'Connexion impossible',
  status: 0,
  code: 'RESEAU' as Probleme['code'],
  detail: 'Le serveur ne répond pas. Vérifiez votre connexion, puis réessayez.',
};

/** Texte à montrer pour une erreur, quelle qu'elle soit. */
export function messageErreur(e: unknown): string {
  if (e instanceof ErreurApi) return e.probleme.detail ? e.probleme.detail : e.probleme.title;
  return 'Une erreur inattendue est survenue. Réessayez dans un instant.';
}

export interface ConfigurationClient {
  /** Préfixe des adresses, vide par défaut : l'API est servie sur le même domaine (/api/v1) */
  base?: string;
  /** Jeton à présenter aux opérations protégées par jetonPersonnel ou jetonClient */
  jeton?: () => string | null;
  /** Sur un 401 : obtenir un nouveau jeton (refresh token) ; true s'il y en a un */
  renouveler?: () => Promise<boolean>;
  /** Sur un 401 définitif : la session est terminée */
  surDeconnexion?: () => void;
}

function nomFichier(disposition: string | null): string | null {
  if (!disposition) return null;
  const etendu = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (etendu) {
    try {
      return decodeURIComponent(etendu);
    } catch {
      // nom mal encodé : on essaie la forme simple
    }
  }
  return disposition.match(/filename="?([^";]+)"?/i)?.[1] ?? null;
}

function adresse(base: string, chemin: string, parametres?: Record<string, unknown>, requete?: Record<string, unknown>): string {
  const url = chemin.replace(/\{([^}]+)\}/g, (_, nom: string) => {
    const valeur = parametres?.[nom];
    if (valeur === undefined || valeur === null) throw new Error(`Paramètre de chemin manquant : ${nom}`);
    return encodeURIComponent(String(valeur));
  });
  const q = new URLSearchParams();
  for (const [cle, valeur] of Object.entries(requete ?? {})) {
    if (valeur === undefined || valeur === null || valeur === '') continue;
    // Tableaux en « form, explode » (?statut=OUVERTE&statut=EN_COURS), comme le décrit le contrat
    for (const v of Array.isArray(valeur) ? valeur : [valeur]) q.append(cle, String(v));
  }
  const suite = q.toString();
  return `${base}${url}${suite ? `?${suite}` : ''}`;
}

function formulaire(corps: Record<string, unknown>): FormData {
  const f = new FormData();
  for (const [cle, valeur] of Object.entries(corps)) {
    if (valeur === undefined || valeur === null) continue;
    for (const v of Array.isArray(valeur) ? valeur : [valeur]) {
      if (v instanceof Blob) f.append(cle, v, v instanceof File ? v.name : cle);
      else f.append(cle, String(v));
    }
  }
  return f;
}

async function probleme(reponse: Response): Promise<Probleme> {
  const type = reponse.headers.get('content-type') ?? '';
  if (type.includes('json')) {
    try {
      const corps = (await reponse.json()) as Probleme;
      if (corps && typeof corps === 'object' && 'title' in corps) return corps;
    } catch {
      // corps illisible : on retombe sur un problème générique
    }
  }
  return {
    type: '/erreurs/inattendue',
    title: reponse.status >= 500 ? 'Service momentanément indisponible' : 'Requête refusée',
    status: reponse.status,
    code: (reponse.status >= 500 ? 'ERREUR_INTERNE' : 'INTERDIT') as Probleme['code'],
    detail: reponse.status >= 500 ? 'Réessayez dans quelques instants.' : undefined,
  };
}

export type Appeler = <K extends Operation>(operation: K, ...args: ArgumentsAppel<K>) => Promise<Resultat<K>>;

export function creerClient(config: ConfigurationClient = {}): Appeler {
  const base = config.base ?? '';

  async function executer(operation: Operation, options: Record<string, unknown>, deuxiemeEssai: boolean): Promise<unknown> {
    const def = operationsContrat[operation];
    if (!def) throw new Error(`Opération inconnue du contrat : ${operation}`);
    const entetes: Record<string, string> = {
      Accept: def.reponse === 'fichier' ? '*/*' : 'application/json, application/problem+json',
      ...(options.entetes as Record<string, string> | undefined),
    };
    const protegee = def.securite === 'personnel' || def.securite === 'client';
    const jeton = protegee ? config.jeton?.() : null;
    if (jeton) entetes.Authorization = `Bearer ${jeton}`;

    let body: BodyInit | undefined;
    const corps = options.corps as Record<string, unknown> | undefined;
    if (def.corps === 'json') {
      entetes['Content-Type'] = 'application/json';
      body = JSON.stringify(corps ?? {});
    } else if (def.corps === 'multipart') {
      body = formulaire(corps ?? {});
    }

    let reponse: Response;
    try {
      reponse = await fetch(adresse(base, def.chemin, options.chemin as Record<string, unknown>, options.requete as Record<string, unknown>), {
        method: def.methode,
        headers: entetes,
        body,
        credentials: 'same-origin',
        signal: options.signal as AbortSignal | undefined,
      });
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') throw e;
      throw new ErreurApi(PROBLEME_RESEAU, 0);
    }

    if (!reponse.ok) {
      if (reponse.status === 401 && protegee && !deuxiemeEssai && config.renouveler && (await config.renouveler())) {
        return executer(operation, options, true);
      }
      const p = await probleme(reponse);
      if (reponse.status === 401 && protegee) config.surDeconnexion?.();
      const attente = Number(reponse.headers.get('retry-after'));
      throw new ErreurApi(p, reponse.status, Number.isFinite(attente) && attente > 0 ? attente : null);
    }
    if (def.reponse === 'vide' || reponse.status === 204) return undefined;
    if (def.reponse === 'fichier') {
      return { contenu: await reponse.blob(), nom: nomFichier(reponse.headers.get('content-disposition')), type: reponse.headers.get('content-type') ?? 'application/octet-stream' } satisfies FichierRecu;
    }
    return reponse.json();
  }

  return (<K extends Operation>(operation: K, ...args: ArgumentsAppel<K>) =>
    executer(operation, (args[0] ?? {}) as Record<string, unknown>, false) as Promise<Resultat<K>>) as Appeler;
}

/** Propose un fichier reçu de l'API au téléchargement (pièce jointe, QR code à imprimer). */
export function enregistrer(fichier: FichierRecu, nomParDefaut = 'fichier'): void {
  const url = URL.createObjectURL(fichier.contenu);
  const lien = document.createElement('a');
  lien.href = url;
  lien.download = fichier.nom ?? nomParDefaut;
  document.body.append(lien);
  lien.click();
  lien.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
