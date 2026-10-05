/**
 * Fournisseurs d'IA derrière un adaptateur remplaçable (étape 18, décision I6). Le choix se fait par
 * la configuration (IA_FOURNISSEUR), d'après le banc d'essai : rien d'autre ne change.
 *
 * - anthropic : API Messages, outil imposé dont le schéma est celui de la réponse attendue ;
 * - openai et mistral : API Chat Completions, réponse au format JSON imposé par un schéma strict.
 *
 * Un adaptateur ne reçoit que des consignes déjà masquées (domaine/ia) et ne garde rien : ni
 * journal du contenu, ni nouvel essai. Toute erreur est rendue sous une forme connue, pour que
 * l'appelant journalise l'issue et réponde par les règles.
 */
import type { ConfigurationFournisseurIa, NomFournisseurIa } from '../../configuration/configuration.js';
import type { Consignes } from '../../domaine/ia/consignes.js';

export interface ReponseFournisseur {
  /** Objet rendu par le modèle, à vérifier par l'appelant (Consignes.traduire) */
  readonly brute: unknown;
  readonly jetonsEntree: number;
  readonly jetonsSortie: number;
}

export interface FournisseurIa {
  readonly nom: NomFournisseurIa;
  readonly modele: string;
  demander(c: Consignes<unknown>, signal: AbortSignal): Promise<ReponseFournisseur>;
}

export type IssueEchec = 'HORS_DELAI' | 'ERREUR' | 'REPONSE_INVALIDE';

export class ErreurFournisseur extends Error {
  constructor(readonly issue: IssueEchec, message: string, readonly jetonsEntree = 0, readonly jetonsSortie = 0) {
    super(message);
    this.name = 'ErreurFournisseur';
  }
}

async function poster(url: string, entetes: Record<string, string>, corps: unknown, signal: AbortSignal): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...entetes }, body: JSON.stringify(corps), signal });
  } catch (e) {
    if (signal.aborted) throw new ErreurFournisseur('HORS_DELAI', 'Délai dépassé');
    throw new ErreurFournisseur('ERREUR', `Fournisseur injoignable : ${(e as Error).message}`);
  }
  let texte: string;
  try {
    texte = await res.text();
  } catch {
    throw new ErreurFournisseur(signal.aborted ? 'HORS_DELAI' : 'ERREUR', 'Réponse interrompue');
  }
  // Le message d'erreur du fournisseur ne contient pas nos consignes ; on n'en garde que le début
  if (!res.ok) throw new ErreurFournisseur('ERREUR', `HTTP ${res.status} : ${texte.slice(0, 200)}`);
  try {
    return JSON.parse(texte) as Record<string, unknown>;
  } catch {
    throw new ErreurFournisseur('ERREUR', 'Réponse du fournisseur illisible');
  }
}

const nombre = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : 0);

/** API Messages d'Anthropic : la réponse attendue est l'entrée d'un outil que le modèle doit appeler. */
export class FournisseurAnthropic implements FournisseurIa {
  readonly nom = 'anthropic' as const;
  readonly modele: string;

  constructor(private readonly config: Pick<ConfigurationFournisseurIa, 'modele' | 'cle' | 'url'>) {
    this.modele = config.modele;
  }

  async demander(c: Consignes<unknown>, signal: AbortSignal): Promise<ReponseFournisseur> {
    const r = await poster(this.config.url, { 'x-api-key': this.config.cle, 'anthropic-version': '2023-06-01' }, {
      model: this.modele,
      max_tokens: c.maxJetons,
      temperature: 0,
      system: c.systeme,
      messages: [{ role: 'user', content: c.utilisateur }],
      tools: [{ name: c.nom, description: 'Rend la réponse au format demandé.', input_schema: c.schema }],
      tool_choice: { type: 'tool', name: c.nom },
    }, signal);
    const usage = (r.usage ?? {}) as Record<string, unknown>;
    const jetonsEntree = nombre(usage.input_tokens) + nombre(usage.cache_read_input_tokens) + nombre(usage.cache_creation_input_tokens);
    const jetonsSortie = nombre(usage.output_tokens);
    const outil = Array.isArray(r.content) ? (r.content as Record<string, unknown>[]).find((b) => b.type === 'tool_use' && b.name === c.nom) : undefined;
    if (!outil || typeof outil.input !== 'object' || outil.input === null) {
      throw new ErreurFournisseur('REPONSE_INVALIDE', `Pas de réponse au format demandé (arrêt : ${String(r.stop_reason)})`, jetonsEntree, jetonsSortie);
    }
    return { brute: outil.input, jetonsEntree, jetonsSortie };
  }
}

/**
 * API Chat Completions (OpenAI, et Mistral qui la reprend) : réponse JSON imposée par un schéma strict.
 * OpenAI compte le raisonnement de ses modèles dans max_completion_tokens : la marge est plus large.
 */
export class FournisseurCompatibleOpenAi implements FournisseurIa {
  readonly modele: string;

  constructor(readonly nom: 'openai' | 'mistral', private readonly config: Pick<ConfigurationFournisseurIa, 'modele' | 'cle' | 'url'>) {
    this.modele = config.modele;
  }

  async demander(c: Consignes<unknown>, signal: AbortSignal): Promise<ReponseFournisseur> {
    const plafond = this.nom === 'openai' ? { max_completion_tokens: Math.max(c.maxJetons, 2048) } : { max_tokens: c.maxJetons, temperature: 0 };
    const r = await poster(this.config.url, { Authorization: `Bearer ${this.config.cle}` }, {
      model: this.modele,
      ...plafond,
      messages: [{ role: 'system', content: c.systeme }, { role: 'user', content: c.utilisateur }],
      response_format: { type: 'json_schema', json_schema: { name: c.nom, schema: c.schema, strict: true } },
    }, signal);
    const usage = (r.usage ?? {}) as Record<string, unknown>;
    const jetonsEntree = nombre(usage.prompt_tokens);
    const jetonsSortie = nombre(usage.completion_tokens);
    const choix = Array.isArray(r.choices) ? (r.choices[0] as Record<string, unknown> | undefined) : undefined;
    const message = (choix?.message ?? {}) as Record<string, unknown>;
    if (typeof message.content !== 'string' || !message.content.trim()) {
      throw new ErreurFournisseur('REPONSE_INVALIDE', `Réponse vide (arrêt : ${String(choix?.finish_reason)})`, jetonsEntree, jetonsSortie);
    }
    try {
      return { brute: JSON.parse(message.content), jetonsEntree, jetonsSortie };
    } catch {
      throw new ErreurFournisseur('REPONSE_INVALIDE', 'Réponse hors du format JSON demandé', jetonsEntree, jetonsSortie);
    }
  }
}

export function creerFournisseur(config: ConfigurationFournisseurIa): FournisseurIa {
  return config.fournisseur === 'anthropic' ? new FournisseurAnthropic(config) : new FournisseurCompatibleOpenAi(config.fournisseur, config);
}

/** Coût d'un appel en millionièmes de dollar : le tarif est en dollars par million de jetons. */
export function coutMicroUsd(jetonsEntree: number, jetonsSortie: number, prix: { prixEntree: number; prixSortie: number }): number {
  return Math.round(jetonsEntree * prix.prixEntree + jetonsSortie * prix.prixSortie);
}
