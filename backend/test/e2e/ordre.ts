import { BaseSequencer, type TestSpecification } from 'vitest/node';

/** Fichiers dans l'ordre alphabétique : zz-couverture.e2e.test.ts passe en dernier. */
export default class OrdreAlphabetique extends BaseSequencer {
  async sort(fichiers: TestSpecification[]): Promise<TestSpecification[]> {
    return [...fichiers].sort((a, b) => a.moduleId.localeCompare(b.moduleId));
  }
}
