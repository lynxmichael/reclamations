/**
 * Environnement des tests de bout en bout : API démarrée dans le processus du test, sur la base
 * jetable et une base Redis réservée ; client HTTP qui valide chaque réponse contre le contrat.
 */
import { randomInt } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { Redis } from 'ioredis';
import { inject } from 'vitest';
import { urlsE2E } from '../../scripts/base-de-test.js';
import type { JeuDemo } from '../../scripts/jeu-de-donnees.js';
import { secretTotpDemo, MOT_DE_PASSE_DEMO } from '../../scripts/jeu-de-donnees.js';
import { creerApplication } from '../../src/app.module.js';
import { lireConfiguration, type Configuration } from '../../src/configuration/configuration.js';
import { contratApi, operation, type Schema } from '../../src/infrastructure/contrat/contrat.js';
import { rattacher } from '../../src/infrastructure/contrat/validation.js';
import { encoderJeton, resoudreDefi, type Defi } from '../../src/infrastructure/securite/anti-robot.js';
import { cleAntiRejeu, codeCourant } from '../../src/infrastructure/securite/totp.js';
import type { Horloge } from '../../src/noyau/noyau.module.js';

export const FICHIER_COUVERTURE = join(tmpdir(), 'reclamations-e2e-couverture.txt');

export function redisE2E(): string {
  const u = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');
  u.pathname = '/15';
  return u.toString();
}

export function configurationE2E(env: Record<string, string> = {}): Configuration {
  const urls = urlsE2E();
  return lireConfiguration({
    ...process.env,
    // Assistant IA (étape 18) : règles seules, sauf pour les tests qui simulent un fournisseur
    IA_FOURNISSEUR: 'regles',
    APP_DATABASE_URL: urls.application,
    REDIS_URL: redisE2E(),
    COOKIE_SECURE: 'false',
    STOCKAGE_DOSSIER: mkdtempSync(join(tmpdir(), 'reclamations-fichiers-')),
    NODE_ENV: 'test',
    // Adresses par défaut (https://<slug>.reclamations.example…), attendues par les tests, même si
    // l'environnement (docker-compose.yml, .env) pointe les liens vers les écrans de développement
    DOMAINE_PLATEFORME: '',
    URL_PORTAIL: '',
    URL_CONSOLE: '',
    // Défis anti-robot faciles : les tests en résolvent des centaines (le test dédié le vérifie)
    ANTI_ROBOT_MAXIMUM: '2000',
    // Étape 22 : ClamAV simulé (preparation.ts), interrogé comme le vrai
    ANTIVIRUS: 'clamav',
    CLAMAV_HOTE: '127.0.0.1',
    CLAMAV_PORT: String(inject('clamav')),
    ...env,
  });
}

export const jeu = (): JeuDemo => JSON.parse(inject('jeu')) as JeuDemo;

export interface ApiDeTest {
  readonly app: INestApplication;
  readonly url: string;
  readonly config: Configuration;
  fermer(): Promise<void>;
}

export async function demarrerApi(o: { horloge?: Horloge; env?: Record<string, string> } = {}): Promise<ApiDeTest> {
  const config = configurationE2E(o.env);
  const app = await creerApplication({ configuration: config, horloge: o.horloge, journaux: 'erreurs' });
  await app.listen(0, '127.0.0.1');
  const adresse = app.getHttpServer().address() as { port: number };
  return { app, url: `http://127.0.0.1:${adresse.port}/api/v1`, config, fermer: () => app.close() };
}

// ---------------------------------------------------------------------------
//  Validation stricte des réponses
// ---------------------------------------------------------------------------

/** Objets fermés : un champ que le contrat ne déclare pas fait échouer le test (pas de fuite). */
function strict(s: unknown): unknown {
  if (Array.isArray(s)) return s.map(strict);
  if (!s || typeof s !== 'object') return s;
  const o = Object.fromEntries(Object.entries(s).map(([k, v]) => [k, k === 'properties' ? Object.fromEntries(Object.entries(v as object).map(([p, d]) => [p, strict(d)])) : strict(v)]));
  if ((o.properties || o.type === 'object') && o.additionalProperties === undefined && !o.allOf) o.additionalProperties = false;
  return o;
}

const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addFormat('binary', true);
ajv.addSchema({ $id: 'contrat', components: { schemas: strict(contratApi().brut.components.schemas) } });
const validateurs = new Map<string, ValidateFunction>();

function valider(opId: string, statut: number, type: string, schema: Schema, corps: unknown) {
  const cle = `${opId}:${statut}:${type}`;
  let v = validateurs.get(cle);
  if (!v) {
    v = ajv.compile(strict(rattacher(schema)) as Schema);
    validateurs.set(cle, v);
  }
  if (!v(corps)) {
    throw new Error(`Réponse ${statut} de ${opId} non conforme au contrat :\n${JSON.stringify(v.errors, null, 1).slice(0, 1500)}\nCorps : ${JSON.stringify(corps).slice(0, 800)}`);
  }
}

// ---------------------------------------------------------------------------
//  Client HTTP
// ---------------------------------------------------------------------------

export interface Requete {
  readonly chemin?: Record<string, string>;
  readonly requete?: Record<string, string | number | boolean | readonly string[]>;
  readonly corps?: unknown;
  readonly fichiers?: readonly { champ: string; nom: string; contenu: Buffer; type?: string }[];
  readonly jeton?: string;
  readonly entetes?: Record<string, string>;
  /** Adresse IP simulée (X-Forwarded-For) : chaque test a ses propres limites de débit */
  readonly ip?: string;
  /** En-tête Cookie (refresh token) */
  readonly cookie?: string;
  /**
   * Dépôt et demande de code : le client résout un défi anti-robot et ajoute jetonAntiRobot au corps
   * s'il n'y est pas déjà (false : ne rien ajouter, pour tester le refus)
   */
  readonly antiRobot?: boolean;
}

export interface Reponse<T = any> {
  readonly statut: number;
  readonly corps: T;
  readonly entetes: Headers;
  readonly octets: Buffer;
}

/**
 * Adresse IP de test unique (réseau de test 198.18.0.0/15, 131 072 adresses). Chaque fichier de
 * test tourne dans son propre processus : le point de départ est tiré au hasard, pour que deux
 * fichiers n'utilisent pas les mêmes adresses et ne cumulent pas leurs limites de débit (Redis).
 */
let compteurIp = randomInt(0, 120_000);
export const nouvelleIp = () => {
  const n = compteurIp++ % 131_072;
  return `198.${18 + (n >> 16)}.${(n >> 8) & 255}.${n & 255}`;
};

/** Opérations qui exigent un jeton anti-robot (étape 11) */
export const AVEC_ANTI_ROBOT = new Set(['deposerReclamation', 'demanderCodeOtp', 'demanderCodeAcces']);

export class ClientApi {
  constructor(private readonly url: string, private readonly ipParDefaut = nouvelleIp()) {}

  /** Défi demandé à l'API puis résolu, comme le fait le portail. */
  async jetonAntiRobot(ip?: string): Promise<string> {
    const d = await this.appeler<Defi>('lireDefiAntiRobot', { ip });
    if (d.statut !== 200) throw new Error(`Défi anti-robot refusé : ${d.statut}`);
    const n = resoudreDefi(d.corps);
    if (n === null) throw new Error('Défi anti-robot sans solution');
    return encoderJeton(d.corps, n);
  }

  async appeler<T = any>(opId: string, r: Requete = {}): Promise<Reponse<T>> {
    if (AVEC_ANTI_ROBOT.has(opId) && r.antiRobot !== false && !(r.corps as { jetonAntiRobot?: string } | undefined)?.jetonAntiRobot) {
      r = { ...r, corps: { ...((r.corps ?? {}) as object), jetonAntiRobot: await this.jetonAntiRobot(r.ip) } };
    }
    const op = operation(opId);
    appendFileSync(FICHIER_COUVERTURE, `${opId}\n`);
    let chemin = op.chemin.replace(/\{([^}]+)\}/g, (_, nom: string) => encodeURIComponent(r.chemin?.[nom] ?? `{${nom}}`));
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(r.requete ?? {})) for (const x of Array.isArray(v) ? v : [v]) q.append(k, String(x));
    if ([...q].length) chemin += `?${q}`;
    const entetes: Record<string, string> = { 'X-Forwarded-For': r.ip ?? this.ipParDefaut, ...(r.entetes ?? {}) };
    if (r.jeton) entetes.Authorization = `Bearer ${r.jeton}`;
    if (r.cookie) entetes.Cookie = r.cookie;
    let body: FormData | string | undefined;
    if (op.corps?.type === 'multipart' && (r.corps !== undefined || r.fichiers)) {
      const f = new FormData();
      for (const [k, v] of Object.entries((r.corps ?? {}) as Record<string, unknown>)) if (v !== undefined && v !== null) f.append(k, String(v));
      for (const fi of r.fichiers ?? []) f.append(fi.champ, new Blob([new Uint8Array(fi.contenu)], { type: fi.type ?? 'application/octet-stream' }), fi.nom);
      body = f;
    } else if (r.corps !== undefined) {
      body = JSON.stringify(r.corps);
      entetes['Content-Type'] = 'application/json';
    }
    const res = await fetch(`${this.url}${chemin}`, { method: op.methode.toUpperCase(), headers: entetes, body, redirect: 'manual' });
    const octets = Buffer.from(await res.arrayBuffer());
    const type = (res.headers.get('content-type') ?? '').split(';')[0].trim();
    const corps = type.includes('json') ? (octets.length ? JSON.parse(octets.toString('utf8')) : undefined) : octets;

    // Le statut, le type de contenu et le corps doivent être ceux du contrat
    const declares = op.reponses[String(res.status)];
    if (!declares) throw new Error(`${opId} : statut ${res.status} non déclaré par le contrat — ${octets.toString('utf8').slice(0, 500)}`);
    const types = Object.keys(declares);
    if (types.length === 0) {
      if (octets.length) throw new Error(`${opId} : statut ${res.status} sans corps attendu, reçu ${octets.length} octets`);
    } else {
      if (!types.includes(type)) throw new Error(`${opId} : type ${type || '(aucun)'} reçu, ${types.join(' ou ')} attendu (statut ${res.status})`);
      const schema = declares[type];
      if (schema && type.includes('json')) valider(opId, res.status, type, schema, corps);
    }
    return { statut: res.status, corps: corps as T, entetes: res.headers, octets };
  }
}

// ---------------------------------------------------------------------------
//  Connexion du personnel du jeu de démonstration
// ---------------------------------------------------------------------------

/**
 * Code TOTP utilisable maintenant : celui du pas courant, ou du pas suivant (accepté grâce à la
 * tolérance d'un pas) si l'anti-rejeu de l'API a déjà vu le premier. Sinon on attend.
 */
let redisTests: Redis | null = null;
export async function codeTotp(email: string, horloge: () => Date = () => new Date()): Promise<string> {
  redisTests ??= new Redis(redisE2E());
  const secret = secretTotpDemo(email);
  const id = idDe(email);
  for (;;) {
    const maintenant = horloge().getTime();
    const pas = Math.floor(maintenant / 30_000);
    // L'API accepte le pas précédent et le suivant (dérive des horloges) : trois codes par pas de 30 s
    for (const p of [pas, pas + 1, pas - 1]) {
      if (!(await redisTests.exists(cleAntiRejeu(id, secret, p))) && !reserves.has(`${id}:${p}`)) {
        reserves.add(`${id}:${p}`);
        return codeCourant(secret, new Date(p * 30_000 + 1000));
      }
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}
const reserves = new Set<string>();

function idDe(email: string): string {
  const j = jeu();
  if (j.superAdmin.email === email) return j.superAdmin.id;
  for (const b of [j.alpha, j.horizon]) for (const c of Object.values(b.comptes)) if (c.email === email) return c.id;
  throw new Error(`Compte inconnu du jeu de démonstration : ${email}`);
}

export async function connecter(api: ClientApi, email: string, horloge?: () => Date): Promise<{ jeton: string; cookie: string }> {
  const etape = await api.appeler('connexion', { corps: { email, motDePasse: MOT_DE_PASSE_DEMO } });
  if (etape.statut !== 200) throw new Error(`Connexion refusée pour ${email} : ${JSON.stringify(etape.corps)}`);
  const s = await api.appeler('validerCodeTotp', { corps: { jetonIntermediaire: etape.corps.jetonIntermediaire, code: await codeTotp(email, horloge) } });
  if (s.statut !== 200) throw new Error(`Code TOTP refusé pour ${email} : ${JSON.stringify(s.corps)}`);
  return { jeton: s.corps.jetonAcces, cookie: (s.entetes.get('set-cookie') ?? '').split(';')[0] };
}

export async function fermerOutils(): Promise<void> {
  await redisTests?.quit();
  redisTests = null;
}

/** Petits fichiers valides pour les tests. */
export const FICHIERS = {
  png: Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000' + '1f15c4890000000d49444154789c6300010000050001' + '0d0a2db40000000049454e44ae426082', 'hex'),
  pdf: Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n'),
  exe: Buffer.from('4d5a90000300000004000000ffff0000', 'hex'),
};
