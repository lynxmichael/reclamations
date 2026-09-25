/**
 * Chaque écran, dans chacune de ses variantes et pour chaque banque, s'affiche sans erreur et
 * sans valeur manquante ; chaque opération citée existe dans le contrat.
 */
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ECRANS, GROUPES } from '../src/maquettes/catalogue';
import { ALPHA, HORIZON } from '../src/maquettes/donnees/commun';
import { OPERATIONS_DU_CONTRAT } from './contrat';

/** Toutes les combinaisons de variantes d'un écran. */
function combinaisons(e: (typeof ECRANS)[number]): Record<string, string>[] {
  return (e.variantes ?? []).reduce<Record<string, string>[]>(
    (acc, v) => acc.flatMap((c) => v.options.map((o) => ({ ...c, [v.cle]: o.valeur }))),
    [{}],
  );
}

const cas = ECRANS.flatMap((e) =>
  combinaisons(e).flatMap((v) =>
    (e.marque ? [ALPHA, HORIZON] : [ALPHA]).map((banque) => [`${e.groupe}/${e.id} ${JSON.stringify(v)} ${banque.slug}`, e, v, banque] as const),
  ),
);

describe('écrans', () => {
  it('le catalogue couvre les quatre espaces, sans doublon', () => {
    expect(new Set(ECRANS.map((e) => e.groupe))).toEqual(new Set(GROUPES.map((g) => g.cle)));
    expect(new Set(ECRANS.map((e) => e.id)).size).toBe(ECRANS.length);
  });

  it.each(ECRANS.map((e) => [e.id, e] as const))('%s : opérations du contrat', (_id, e) => {
    expect(e.operations.length).toBeGreaterThan(0);
    expect(e.operations.filter((o) => !OPERATIONS_DU_CONTRAT.has(o))).toEqual([]);
  });

  it.each(cas)('%s', (_nom, e, v, banque) => {
    const html = renderToString(<>{e.rendu({ v, banque })}</>);
    const texte = html.replace(/<[^>]+>/g, ' ');
    for (const interdit of ['undefined', 'NaN', 'Invalid Date', '[object Object]']) expect(texte).not.toContain(interdit);
    expect(texte).not.toMatch(/\bnull\b/);
    if (banque.slug === 'horizon') expect(texte).not.toContain('Banque Alpha');
  });
});
