import { describe, expect, expectTypeOf, it } from 'vitest';
import * as Prisma from '../generated/prisma/enums.js';
import * as Domaine from './enumerations.js';

describe('énumérations du domaine identiques au modèle de données', () => {
  it('statuts, rôles et événements, dans le même ordre', () => {
    expect(Domaine.STATUTS_RECLAMATION).toEqual(Object.values(Prisma.StatutReclamation));
    expect(Domaine.ROLES_UTILISATEUR).toEqual(Object.values(Prisma.RoleUtilisateur));
    expect(Domaine.TYPES_EVENEMENT).toEqual(Object.values(Prisma.TypeEvenement));
  });

  it('les types sont interchangeables avec ceux de Prisma', () => {
    expectTypeOf<Domaine.StatutReclamation>().toEqualTypeOf<Prisma.StatutReclamation>();
    expectTypeOf<Domaine.RoleUtilisateur>().toEqualTypeOf<Prisma.RoleUtilisateur>();
    expectTypeOf<Domaine.TypeEvenement>().toEqualTypeOf<Prisma.TypeEvenement>();
  });
});
