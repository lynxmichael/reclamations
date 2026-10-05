import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { consignesTri } from '../../domaine/ia/consignes.js';
import { CATEGORIES_EXEMPLE, faqExemple } from '../../domaine/ia/exemples.js';
import { coutMicroUsd, creerFournisseur, ErreurFournisseur, FournisseurAnthropic, FournisseurCompatibleOpenAi } from './fournisseurs.js';

/** Faux fournisseur : enregistre chaque requête et répond par le scénario du test. */
let serveur: Server;
let url = '';
const recues: { chemin: string; entetes: IncomingMessage['headers']; corps: any }[] = [];
let repondre: (res: ServerResponse) => void = (res) => res.end('{}');

beforeAll(async () => {
  serveur = createServer((req, res) => {
    let brut = '';
    req.on('data', (d) => (brut += d));
    req.on('end', () => {
      recues.push({ chemin: req.url ?? '', entetes: req.headers, corps: JSON.parse(brut) });
      res.setHeader('Content-Type', 'application/json');
      repondre(res);
    });
  });
  await new Promise<void>((ok) => serveur.listen(0, '127.0.0.1', ok));
  url = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((ok) => serveur.close(() => ok())));

const consignes = consignesTri([{ auteur: 'CLIENT', texte: 'le GAB a avalé ma carte [CARTE]' }], { banque: 'Banque Alpha', faq: faqExemple(), categories: CATEGORIES_EXEMPLE });
const signal = () => AbortSignal.timeout(2000);
const json = (corps: unknown, statut = 200) => (res: ServerResponse) => {
  res.statusCode = statut;
  res.end(JSON.stringify(corps));
};

describe('adaptateur Anthropic (API Messages, outil imposé)', () => {
  it('envoie les consignes et lit l\'entrée de l\'outil', async () => {
    const fournisseur = new FournisseurAnthropic({ modele: 'modele-test', cle: 'cle-de-test-0123456789', url: `${url}/v1/messages` });
    repondre = json({
      content: [{ type: 'text', text: '…' }, { type: 'tool_use', name: 'decision', input: { intention: 'RECLAMATION', faqId: null, categorieId: 'C1', complet: false } }],
      usage: { input_tokens: 900, output_tokens: 30, cache_read_input_tokens: 100 },
      stop_reason: 'tool_use',
    });
    const r = await fournisseur.demander(consignes, signal());
    expect(r).toEqual({ brute: { intention: 'RECLAMATION', faqId: null, categorieId: 'C1', complet: false }, jetonsEntree: 1000, jetonsSortie: 30 });
    expect(consignes.traduire(r.brute)).toEqual({ intention: 'RECLAMATION', faqId: null, categorieId: 'cat-carte', complet: false });
    const req = recues.at(-1)!;
    expect(req.chemin).toBe('/v1/messages');
    expect(req.entetes['x-api-key']).toBe('cle-de-test-0123456789');
    expect(req.entetes['anthropic-version']).toBe('2023-06-01');
    expect(req.corps).toMatchObject({
      model: 'modele-test', max_tokens: 300, temperature: 0, system: consignes.systeme,
      messages: [{ role: 'user', content: consignes.utilisateur }],
      tool_choice: { type: 'tool', name: 'decision' },
    });
    expect(req.corps.tools[0].input_schema).toEqual(consignes.schema);
  });

  it('sans appel de l\'outil : réponse invalide, jetons comptés', async () => {
    const fournisseur = new FournisseurAnthropic({ modele: 'm', cle: 'cle-de-test-0123456789', url });
    repondre = json({ content: [{ type: 'text', text: 'Bonjour' }], usage: { input_tokens: 10, output_tokens: 2 }, stop_reason: 'end_turn' });
    const e = await fournisseur.demander(consignes, signal()).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ErreurFournisseur);
    expect(e).toMatchObject({ issue: 'REPONSE_INVALIDE', jetonsEntree: 10, jetonsSortie: 2 });
  });

  it('erreur HTTP, délai dépassé, fournisseur injoignable', async () => {
    const fournisseur = new FournisseurAnthropic({ modele: 'm', cle: 'cle-de-test-0123456789', url });
    repondre = json({ type: 'error', error: { type: 'overloaded_error' } }, 529);
    await expect(fournisseur.demander(consignes, signal())).rejects.toMatchObject({ issue: 'ERREUR', message: expect.stringMatching(/^HTTP 529/) });
    repondre = (res) => setTimeout(() => res.end('{}'), 500);
    await expect(fournisseur.demander(consignes, AbortSignal.timeout(100))).rejects.toMatchObject({ issue: 'HORS_DELAI' });
    const absent = new FournisseurAnthropic({ modele: 'm', cle: 'cle-de-test-0123456789', url: 'http://127.0.0.1:9/v1/messages' });
    await expect(absent.demander(consignes, signal())).rejects.toMatchObject({ issue: 'ERREUR' });
  });
});

describe('adaptateur compatible OpenAI (OpenAI, Mistral)', () => {
  it('OpenAI : schéma strict, marge de jetons pour le raisonnement', async () => {
    const f = creerFournisseur({ fournisseur: 'openai', modele: 'modele-o', cle: 'cle-de-test-0123456789', url: `${url}/v1/chat/completions`, delaiMs: 8000, prixEntree: 0, prixSortie: 0 });
    expect(f).toBeInstanceOf(FournisseurCompatibleOpenAi);
    repondre = json({
      choices: [{ message: { role: 'assistant', content: '{"intention":"FAQ","faqId":"F1","categorieId":null,"complet":false}' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 800, completion_tokens: 25 },
    });
    const r = await f.demander(consignes, signal());
    expect(consignes.traduire(r.brute)).toEqual({ intention: 'FAQ', faqId: 'faq-1', categorieId: null, complet: false });
    expect(r).toMatchObject({ jetonsEntree: 800, jetonsSortie: 25 });
    const req = recues.at(-1)!;
    expect(req.entetes.authorization).toBe('Bearer cle-de-test-0123456789');
    expect(req.corps).toMatchObject({
      model: 'modele-o', max_completion_tokens: 2048,
      messages: [{ role: 'system', content: consignes.systeme }, { role: 'user', content: consignes.utilisateur }],
      response_format: { type: 'json_schema', json_schema: { name: 'decision', schema: consignes.schema, strict: true } },
    });
    expect(req.corps.temperature).toBeUndefined();
  });

  it('Mistral : max_tokens et température nulle ; JSON illisible refusé', async () => {
    const f = creerFournisseur({ fournisseur: 'mistral', modele: 'modele-m', cle: 'cle-de-test-0123456789', url, delaiMs: 8000, prixEntree: 0, prixSortie: 0 });
    repondre = json({ choices: [{ message: { content: 'Voici : {intention' }, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 3 } });
    await expect(f.demander(consignes, signal())).rejects.toMatchObject({ issue: 'REPONSE_INVALIDE', jetonsEntree: 5 });
    expect(recues.at(-1)!.corps).toMatchObject({ model: 'modele-m', max_tokens: 300, temperature: 0 });
    repondre = json({ choices: [{ message: { content: null }, finish_reason: 'length' }] });
    await expect(f.demander(consignes, signal())).rejects.toMatchObject({ issue: 'REPONSE_INVALIDE', message: expect.stringMatching(/length/) });
  });
});

it('coût d\'un appel : tarif en dollars par million de jetons → millionièmes de dollar', () => {
  expect(coutMicroUsd(1000, 30, { prixEntree: 1, prixSortie: 5 })).toBe(1150);
  expect(coutMicroUsd(1_000_000, 0, { prixEntree: 2, prixSortie: 10 })).toBe(2_000_000);
  expect(coutMicroUsd(10, 10, { prixEntree: 0, prixSortie: 0 })).toBe(0);
});
