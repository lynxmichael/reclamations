/**
 * Dernier fichier de la suite (ordre alphabétique) : chaque opération servie par l'API a été
 * appelée au moins une fois par les tests de bout en bout, et chaque réponse validée contre le contrat.
 */
import { existsSync, readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { contratApi } from '../../src/infrastructure/contrat/contrat.js';
import { FICHIER_COUVERTURE } from './environnement.js';

it('les 100 opérations du contrat ont été appelées par les tests', () => {
  const appelees = new Set(existsSync(FICHIER_COUVERTURE) ? readFileSync(FICHIER_COUVERTURE, 'utf8').split('\n').filter(Boolean) : []);
  const servies = [...contratApi().operations.keys()];
  expect(servies.filter((id) => !appelees.has(id))).toEqual([]);
  expect(servies.length).toBe(100);
});
