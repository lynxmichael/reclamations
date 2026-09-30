import { describe, expect, it } from 'vitest';
import { BOM, cellule, ligne } from './csv.js';
import { debutsDesPas, periodeDe, regroupementDe } from './indicateurs.js';

/** Champ et message de l'erreur de validation levée par `f`. */
function refus(f: () => unknown): { champ: string; message: string } | undefined {
  try {
    f();
  } catch (e) {
    return (e as { erreurs?: { champ: string; message: string }[] }).erreurs?.[0];
  }
  return undefined;
}

describe('CSV pour Excel en français', () => {
  it('séparateur « ; », fin de ligne CRLF, cellules vides pour null', () => {
    expect(ligne(['ALP-2026-000001', 42, null, undefined, 'Résolue'])).toBe('ALP-2026-000001;42;;;Résolue\r\n');
    expect(BOM).toBe('\uFEFF');
  });

  it('guillemets autour d\'un texte qui contient « ; », des guillemets ou un retour à la ligne', () => {
    expect(cellule('Crédit; immobilier')).toBe('"Crédit; immobilier"');
    expect(cellule('Agence "Plateau"')).toBe('"Agence ""Plateau"""');
    expect(cellule('ligne 1\nligne 2')).toBe('"ligne 1\nligne 2"');
    expect(cellule(' espace')).toBe('" espace"');
  });

  it('injection de formule neutralisée (= + - @ tabulation), jamais sur un nombre', () => {
    for (const debut of ['=', '+', '-', '@', '\t']) expect(cellule(`${debut}SOMME(A1:A9)`).startsWith('\'') || cellule(`${debut}SOMME(A1:A9)`).startsWith('"\'')).toBe(true);
    expect(cellule('=HYPERLIEN("http://x";"clic")')).toBe('"\'=HYPERLIEN(""http://x"";""clic"")"');
    expect(cellule(-12)).toBe('-12');
    expect(cellule(Number.NaN)).toBe('');
  });
});

describe('période et pas de la courbe', () => {
  const maintenant = new Date('2026-09-29T09:30:00Z');

  it('par défaut : du 1er du mois (fuseau de la banque) à maintenant', () => {
    expect(periodeDe({}, 'Africa/Abidjan', maintenant)).toEqual({ du: new Date('2026-09-01T00:00:00Z'), au: maintenant });
    // Un fuseau à UTC+1 : le mois commence la veille à 23 h en temps universel
    expect(periodeDe({}, 'Africa/Lagos', maintenant).du).toEqual(new Date('2026-08-31T23:00:00Z'));
  });

  it('fin avant le début : refusée', () => {
    expect(refus(() => periodeDe({ du: '2026-09-10T00:00:00Z', au: '2026-09-10T00:00:00Z' }, 'UTC', maintenant)))
      .toEqual({ champ: 'au', message: 'La fin de la période doit suivre son début' });
  });

  it('pas automatique selon la durée ; pas demandé respecté', () => {
    const p = (jours: number) => ({ du: new Date(maintenant.getTime() - jours * 86_400_000), au: maintenant });
    expect(regroupementDe(p(30), undefined)).toBe('JOUR');
    expect(regroupementDe(p(62), undefined)).toBe('JOUR');
    expect(regroupementDe(p(90), undefined)).toBe('SEMAINE');
    expect(regroupementDe(p(365), undefined)).toBe('MOIS');
    expect(regroupementDe(p(365), 'SEMAINE')).toBe('SEMAINE');
  });

  it('débuts des pas dans le fuseau de la banque : jours, semaines du lundi, mois', () => {
    const iso = (l: { toUTC(): { toISO(): string | null } }[]) => l.map((d) => d.toUTC().toISO());
    const sept = { du: new Date('2026-09-01T00:00:00Z'), au: new Date('2026-09-04T12:00:00Z') };
    expect(iso(debutsDesPas(sept, 'JOUR', 'Africa/Abidjan'))).toEqual([
      '2026-09-01T00:00:00.000Z', '2026-09-02T00:00:00.000Z', '2026-09-03T00:00:00.000Z', '2026-09-04T00:00:00.000Z',
    ]);
    // Le 1er septembre 2026 est un mardi : la première semaine commence le lundi 31 août
    expect(iso(debutsDesPas({ du: sept.du, au: new Date('2026-09-15T00:00:00Z') }, 'SEMAINE', 'UTC'))).toEqual([
      '2026-08-31T00:00:00.000Z', '2026-09-07T00:00:00.000Z', '2026-09-14T00:00:00.000Z',
    ]);
    expect(debutsDesPas({ du: new Date('2026-01-15T00:00:00Z'), au: new Date('2027-01-01T00:00:00Z') }, 'MOIS', 'UTC')).toHaveLength(12);
  });

  it('au-delà de 400 points : refusé', () => {
    expect(refus(() => debutsDesPas({ du: new Date('2024-01-01T00:00:00Z'), au: new Date('2026-01-01T00:00:00Z') }, 'JOUR', 'UTC'))?.champ).toBe('regroupement');
  });
});
