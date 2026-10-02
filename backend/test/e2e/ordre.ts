import { BaseSequencer, type TestSpecification } from 'vitest/node';

/**
 * Fichiers dans l'ordre alphabétique, sauf deux, à la fin :
 * - performance.e2e.test.ts dépose 1 000 réclamations. Avant lui, les tâches du worker et la boîte
 *   d'envoi, qui parcourent toute la base, auraient ces 1 000 réclamations à traiter ;
 * - zz-couverture.e2e.test.ts vérifie que chaque opération du contrat a été appelée.
 */
const EN_DERNIER = ['performance.e2e.test.ts', 'zz-couverture.e2e.test.ts'];
const rang = (f: TestSpecification) => EN_DERNIER.findIndex((n) => f.moduleId.endsWith(n));

export default class OrdreAlphabetique extends BaseSequencer {
  async sort(fichiers: TestSpecification[]): Promise<TestSpecification[]> {
    return [...fichiers].sort((a, b) => rang(a) - rang(b) || a.moduleId.localeCompare(b.moduleId));
  }
}
