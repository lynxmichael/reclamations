/**
 * Recette §10, critère 10 : les opérations courantes répondent en moins d'une seconde.
 * Mesure sur une banque de 1 000 réclamations, à travers toute la pile (HTTP, contrat, RLS, Prisma).
 */
import { appendFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CycleDeVie } from '../../src/application/reclamations/cycle-de-vie.js';
import { BaseDonnees } from '../../src/infrastructure/base-de-donnees/base-de-donnees.service.js';
import { ClientApi, connecter, demarrerApi, fermerOutils, jeu, type ApiDeTest } from './environnement.js';

const VOLUME = 1000;
let api: ApiDeTest;
let client: ClientApi;
let bd: BaseDonnees;
const j = jeu();
let superviseur: string;
let ids: string[] = [];

beforeAll(async () => {
  api = await demarrerApi();
  client = new ClientApi(api.url);
  bd = new BaseDonnees(api.config.baseDeDonneesUrl);
  const cycle = new CycleDeVie(bd.base, { lienSuivi: (s, t) => `https://${s}.test/suivi/${t}` });
  const point = await bd.enSysteme((tx) => tx.pointDepot.findUniqueOrThrow({ where: { code: j.horizon.points.qr } }));
  const categories = Object.values(j.horizon.categories);
  for (let i = 0; i < VOLUME; i++) {
    const r = await cycle.deposer({
      tenantId: j.horizon.id, pointDepotId: point.id, categorieId: categories[i % categories.length],
      description: `Réclamation de charge n° ${i}`, client: { nom: `Client ${i}`, telephone: `05${String(10_000_000 + i).slice(-8)}` },
      consentementVersion: '2026-09',
    });
    ids.push(r.id);
  }
  superviseur = (await connecter(client, j.horizon.comptes.didier.email)).jeton;
}, 1_200_000);

afterAll(async () => {
  await bd.fermer();
  await api.fermer();
  await fermerOutils();
});

async function mesurer(n: number, appel: (i: number) => Promise<{ statut: number }>): Promise<{ p95: number; max: number }> {
  const durees: number[] = [];
  for (let i = 0; i < n; i++) {
    const debut = performance.now();
    const r = await appel(i);
    durees.push(performance.now() - debut);
    expect(r.statut).toBeLessThan(300);
  }
  durees.sort((a, b) => a - b);
  return { p95: durees[Math.floor(n * 0.95) - 1], max: durees[n - 1] };
}

describe(`opérations courantes sur ${VOLUME} réclamations`, () => {
  it.each([
    ['file « toutes », 25 par page', (_: number) => client.appeler('listerReclamations', { jeton: superviseur })],
    ['file « reçues » triée par échéance', (_: number) => client.appeler('listerReclamations', { jeton: superviseur, requete: { file: 'recues', tri: 'echeanceSlaLe' } })],
    ['recherche par nom de client', (i: number) => client.appeler('listerReclamations', { jeton: superviseur, requete: { recherche: `Client ${500 + i}` } })],
    ['fiche d\'une réclamation', (i: number) => client.appeler('lireReclamation', { jeton: superviseur, chemin: { id: ids[i * 7] } })],
    ['assignation (écriture + notifications + audit)', (i: number) => client.appeler('assignerReclamation', { jeton: superviseur, chemin: { id: ids[i * 11] }, corps: { agentId: j.horizon.comptes.salif.id } })],
    ['tableau de bord du mois (indicateurs du §6.6 et courbe)', (_: number) => client.appeler('lireIndicateurs', { jeton: superviseur })],
    ['activité des agences du mois (étape 19)', (_: number) => client.appeler('lireIndicateursAgences', { jeton: superviseur })],
    ['tableau de bord sur un an, par semaine', (_: number) => client.appeler('lireIndicateurs', { jeton: superviseur, requete: { du: new Date(Date.now() - 365 * 86_400_000).toISOString(), regroupement: 'SEMAINE' } })],
    [`export CSV de toute la banque (plus de ${VOLUME} lignes)`, (_: number) => client.appeler('exporterReclamations', { jeton: superviseur })],
  ] as const)('%s : moins d\'une seconde', async (_nom, appel) => {
    const { p95, max } = await mesurer(20, appel);
    console.log(`  ${_nom} : p95 ${p95.toFixed(0)} ms, max ${max.toFixed(0)} ms`);
    // Rapport de recette (recette/recette.mjs) : mesures reprises telles quelles
    if (process.env.RECETTE_MESURES) appendFileSync(process.env.RECETTE_MESURES, `${JSON.stringify({ operation: _nom, p95: Math.round(p95), max: Math.round(max) })}\n`);
    expect(p95).toBeLessThan(1000);
  });
});
