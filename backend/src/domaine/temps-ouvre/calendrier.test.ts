import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import { ajouterMinutesOuvrees, minutesOuvreesEntre, normaliserCalendrier, type Calendrier } from './calendrier.js';

/** Lundi → vendredi, 08:00–12:00 et 14:00–17:30 (450 minutes par jour), heure d'Abidjan (UTC). */
const JOURS_OUVRES = [1, 2, 3, 4, 5];
const abidjan = (feries: Calendrier['joursFeries'] = []) =>
  normaliserCalendrier({
    fuseauHoraire: 'Africa/Abidjan',
    plages: JOURS_OUVRES.flatMap((jourSemaine) => [
      { jourSemaine, debutMinute: 8 * 60, finMinute: 12 * 60 },
      { jourSemaine, debutMinute: 14 * 60, finMinute: 17 * 60 + 30 },
    ]),
    joursFeries: feries,
  });

/** Instant local d'Abidjan (UTC) : « 2026-09-25 10:00 » */
const t = (texte: string, zone = 'Africa/Abidjan') => DateTime.fromFormat(texte, 'yyyy-MM-dd HH:mm', { zone }).toJSDate();
const local = (d: Date, zone = 'Africa/Abidjan') => DateTime.fromJSDate(d, { zone }).toFormat('yyyy-MM-dd HH:mm');

describe('ajouterMinutesOuvrees', () => {
  const cal = abidjan();

  it('reste dans la même plage', () => {
    expect(local(ajouterMinutesOuvrees(t('2026-09-25 10:00'), 60, cal))).toBe('2026-09-25 11:00');
  });
  it('saute la pause de midi', () => {
    expect(local(ajouterMinutesOuvrees(t('2026-09-25 11:30'), 60, cal))).toBe('2026-09-25 14:30');
  });
  it('saute le week-end (vendredi 17:00 + 1 h → lundi 08:30)', () => {
    expect(local(ajouterMinutesOuvrees(t('2026-09-25 17:00'), 60, cal))).toBe('2026-09-28 08:30');
  });
  it('un départ le samedi commence lundi à l\'ouverture', () => {
    expect(local(ajouterMinutesOuvrees(t('2026-09-26 10:00'), 30, cal))).toBe('2026-09-28 08:30');
  });
  it('un départ avant l\'ouverture commence à 08:00', () => {
    expect(local(ajouterMinutesOuvrees(t('2026-09-25 07:00'), 30, cal))).toBe('2026-09-25 08:30');
  });
  it('tombe pile à la fermeture quand le délai remplit la plage', () => {
    expect(local(ajouterMinutesOuvrees(t('2026-09-25 14:00'), 210, cal))).toBe('2026-09-25 17:30');
  });
  it('saute un jour férié ponctuel', () => {
    const avecFerie = abidjan([{ date: '2026-09-28', recurrent: false }]);
    expect(local(ajouterMinutesOuvrees(t('2026-09-25 17:00'), 60, avecFerie))).toBe('2026-09-29 08:30');
  });
  it('saute un jour férié récurrent saisi une autre année', () => {
    const recurrent = abidjan([{ date: '2020-09-28', recurrent: true }]);
    expect(local(ajouterMinutesOuvrees(t('2026-09-25 17:00'), 60, recurrent))).toBe('2026-09-29 08:30');
  });
  it('un délai de 16 h ouvrées déposé vendredi 10:00 échoit mardi 11:00', () => {
    // 960 min = vendredi 330 + lundi 450 + mardi 180 (08:00 → 11:00)
    expect(local(ajouterMinutesOuvrees(t('2026-09-25 10:00'), 960, cal))).toBe('2026-09-29 11:00');
  });
  it('zéro minute ne bouge pas', () => {
    expect(local(ajouterMinutesOuvrees(t('2026-09-26 10:00'), 0, cal))).toBe('2026-09-26 10:00');
  });
});

describe('minutesOuvreesEntre', () => {
  const cal = abidjan();

  it('vendredi 10:00 → lundi 10:00 = un jour ouvré (450 min)', () => {
    expect(minutesOuvreesEntre(t('2026-09-25 10:00'), t('2026-09-28 10:00'), cal)).toBe(450);
  });
  it('exclut la pause de midi', () => {
    expect(minutesOuvreesEntre(t('2026-09-25 11:00'), t('2026-09-25 15:00'), cal)).toBe(120);
  });
  it('exclut un jour férié', () => {
    const avecFerie = abidjan([{ date: '2026-09-28', recurrent: false }]);
    expect(minutesOuvreesEntre(t('2026-09-25 17:00'), t('2026-09-29 09:00'), avecFerie)).toBe(30 + 60);
  });
  it('vaut 0 si la fin précède le début', () => {
    expect(minutesOuvreesEntre(t('2026-09-25 11:00'), t('2026-09-25 10:00'), cal)).toBe(0);
  });
  it('vaut 0 sur un week-end entier', () => {
    expect(minutesOuvreesEntre(t('2026-09-26 00:00'), t('2026-09-28 00:00'), cal)).toBe(0);
  });
});

describe('propriétés', () => {
  it('aller-retour : minutesOuvreesEntre(a, ajouter(a, m)) = m, sur 2 000 tirages', { timeout: 20_000 }, () => {
    const cal = abidjan([{ date: '2026-11-15', recurrent: true }, { date: '2026-12-25', recurrent: true }]);
    let graine = 42;
    const aleatoire = () => ((graine = (graine * 1_103_515_245 + 12_345) % 2 ** 31) / 2 ** 31);
    const debutPeriode = t('2026-09-01 00:00').getTime();
    for (let i = 0; i < 2000; i++) {
      const a = new Date(debutPeriode + Math.floor(aleatoire() * 120 * 86_400_000));
      const m = 1 + Math.floor(aleatoire() * 6000);
      const echeance = ajouterMinutesOuvrees(a, m, cal);
      expect(minutesOuvreesEntre(a, echeance, cal)).toBeCloseTo(m, 6);
      expect(echeance.getTime()).toBeGreaterThan(a.getTime());
    }
  });
  it('fusionne les plages qui se chevauchent', () => {
    const cal = normaliserCalendrier({
      fuseauHoraire: 'Africa/Abidjan',
      plages: [{ jourSemaine: 5, debutMinute: 480, finMinute: 720 }, { jourSemaine: 5, debutMinute: 600, finMinute: 840 }],
      joursFeries: [],
    });
    expect(minutesOuvreesEntre(t('2026-09-25 00:00'), t('2026-09-26 00:00'), cal)).toBe(360);
  });
  it('une plage jusqu\'à minuit (fin = 1440) est acceptée', () => {
    const cal = normaliserCalendrier({ fuseauHoraire: 'Africa/Abidjan', plages: [{ jourSemaine: 6, debutMinute: 0, finMinute: 1440 }], joursFeries: [] });
    expect(minutesOuvreesEntre(t('2026-09-26 00:00'), t('2026-09-27 00:00'), cal)).toBe(1440);
  });
});

describe('fuseaux et cas limites', () => {
  it('respecte le changement d\'heure d\'un fuseau à heure d\'été (Paris, 25/10/2026)', () => {
    const paris = normaliserCalendrier({
      fuseauHoraire: 'Europe/Paris',
      plages: JOURS_OUVRES.map((jourSemaine) => ({ jourSemaine, debutMinute: 9 * 60, finMinute: 17 * 60 })),
      joursFeries: [],
    });
    const echeance = ajouterMinutesOuvrees(t('2026-10-23 16:00', 'Europe/Paris'), 120, paris);
    expect(local(echeance, 'Europe/Paris')).toBe('2026-10-26 10:00');
    expect(echeance.toISOString()).toBe('2026-10-26T09:00:00.000Z'); // UTC+1 après le passage à l'heure d'hiver
  });
  it('sans aucune plage, le temps s\'écoule en continu', () => {
    const continu = normaliserCalendrier({ fuseauHoraire: 'Africa/Abidjan', plages: [], joursFeries: [] });
    expect(local(ajouterMinutesOuvrees(t('2026-09-26 10:00'), 90, continu))).toBe('2026-09-26 11:30');
    expect(minutesOuvreesEntre(t('2026-09-26 10:00'), t('2026-09-26 11:30'), continu)).toBe(90);
  });
  it('refuse un fuseau inconnu', () => {
    expect(() => normaliserCalendrier({ fuseauHoraire: 'Afrique/Yopougon', plages: [], joursFeries: [] })).toThrow(/Fuseau horaire inconnu/);
  });
  it('refuse une plage inversée', () => {
    expect(() => normaliserCalendrier({ fuseauHoraire: 'UTC', plages: [{ jourSemaine: 1, debutMinute: 600, finMinute: 500 }], joursFeries: [] })).toThrow(/Plage horaire invalide/);
  });
});
