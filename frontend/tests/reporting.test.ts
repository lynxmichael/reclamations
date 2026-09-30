/**
 * Reporting côté navigateur (étape 9) : périodes dans le fuseau de la banque, CSV de la
 * facturation SMS, graduations et libellés de la courbe.
 */
import { describe, expect, it } from 'vitest';
import { cellule, csv } from '../src/ui/csv';
import { graduations, libellePas } from '../src/ui/Evolution';
import { bornes, derniersMois, minuit, nomMois } from '../src/ui/periodes';

describe('périodes du tableau de bord', () => {
  const maintenant = new Date('2026-09-29T09:30:00Z');

  it('minuit local, y compris hors de l\'heure universelle et au changement d\'heure', () => {
    expect(minuit(2026, 9, 1, 'Africa/Abidjan').toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(minuit(2026, 9, 1, 'Africa/Lagos').toISOString()).toBe('2026-08-31T23:00:00.000Z');
    // Paris passe à l'heure d'été le 29 mars 2026
    expect(minuit(2026, 3, 29, 'Europe/Paris').toISOString()).toBe('2026-03-28T23:00:00.000Z');
    expect(minuit(2026, 3, 30, 'Europe/Paris').toISOString()).toBe('2026-03-29T22:00:00.000Z');
    // Débordements : mois 0 = décembre de l'année précédente, jour 0 = dernier jour du mois précédent
    expect(minuit(2026, 0, 1, 'UTC').toISOString()).toBe('2025-12-01T00:00:00.000Z');
  });

  it('bornes des périodes proposées', () => {
    expect(bornes('mois', 'Africa/Abidjan', maintenant)).toEqual({ du: '2026-09-01T00:00:00.000Z' });
    expect(bornes('mois-precedent', 'Africa/Abidjan', maintenant)).toEqual({ du: '2026-08-01T00:00:00.000Z', au: '2026-09-01T00:00:00.000Z' });
    expect(bornes('7j', 'Africa/Abidjan', maintenant)).toEqual({ du: '2026-09-23T00:00:00.000Z' });
    expect(bornes('30j', 'Africa/Abidjan', maintenant)).toEqual({ du: '2026-08-31T00:00:00.000Z' });
    expect(bornes('12m', 'Africa/Abidjan', maintenant)).toEqual({ du: '2025-10-01T00:00:00.000Z' });
    expect(bornes('annee', 'Africa/Lagos', maintenant)).toEqual({ du: '2025-12-31T23:00:00.000Z' });
  });

  it('les 12 derniers mois, le plus récent d\'abord ; noms en français', () => {
    const mois = derniersMois(maintenant);
    expect(mois).toHaveLength(12);
    expect(mois[0]).toBe('2026-09');
    expect(mois[11]).toBe('2025-10');
    expect(nomMois('2026-09')).toBe('septembre 2026');
  });
});

describe('CSV de la facturation SMS', () => {
  it('BOM, « ; », CRLF ; formules neutralisées', async () => {
    const fichier = csv([['Banque', 'SMS envoyés'], ['=Banque Alpha', 12], ['Crédit; Épargne', 3]]);
    const texte = new TextDecoder('utf-8', { ignoreBOM: true }).decode(await fichier.arrayBuffer());
    expect(texte.charCodeAt(0)).toBe(0xfeff);
    expect(texte.slice(1)).toBe("Banque;SMS envoyés\r\n'=Banque Alpha;12\r\n\"Crédit; Épargne\";3\r\n");
    expect(cellule(-4)).toBe('-4');
    expect(cellule('-4')).toBe("'-4");
  });
});

describe('courbe d\'évolution', () => {
  it('graduations rondes, de zéro au-dessus du maximum', () => {
    expect(graduations(0)).toEqual([0, 1, 2, 3, 4]);
    expect(graduations(3)).toEqual([0, 1, 2, 3]);
    expect(graduations(18)).toEqual([0, 5, 10, 15, 20]);
    expect(graduations(312)).toEqual([0, 100, 200, 300, 400]);
    expect(graduations(1184)).toEqual([0, 500, 1000, 1500]);
  });

  it('libellés des pas, dans le fuseau de la banque', () => {
    expect(libellePas('2026-09-07T00:00:00Z', 'JOUR')).toBe('7 sept.');
    expect(libellePas('2026-09-07T00:00:00Z', 'JOUR', 'Africa/Abidjan', true)).toBe('lundi 7 septembre');
    expect(libellePas('2026-09-07T00:00:00Z', 'SEMAINE')).toBe('sem. du 7 sept.');
    expect(libellePas('2026-09-01T00:00:00Z', 'MOIS', 'Africa/Abidjan', true)).toBe('septembre 2026');
    // Minuit à Lagos = 23 h la veille en temps universel
    expect(libellePas('2026-08-31T23:00:00Z', 'JOUR', 'Africa/Lagos')).toBe('1 sept.');
  });
});
