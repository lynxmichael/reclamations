import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import { normaliserCalendrier } from '../temps-ouvre/calendrier.js';
import { estEnRetard, minutesAvantAlerte, slaALaReprise, slaALaResolution, slaAuDepot, slaEnPause, type ParametresSla } from './sla.js';

/** Lundi → vendredi, 08:00–12:00 et 14:00–17:30 (450 min par jour), Abidjan. */
const p: ParametresSla = {
  calendrier: normaliserCalendrier({
    fuseauHoraire: 'Africa/Abidjan',
    plages: [1, 2, 3, 4, 5].flatMap((jourSemaine) => [
      { jourSemaine, debutMinute: 480, finMinute: 720 },
      { jourSemaine, debutMinute: 840, finMinute: 1050 },
    ]),
    joursFeries: [],
  }),
  seuilAlertePourcent: 75,
  delaiClotureAutoJours: 5,
};
const t = (texte: string) => DateTime.fromFormat(texte, 'yyyy-MM-dd HH:mm', { zone: 'Africa/Abidjan' }).toJSDate();
const local = (d: Date | null) => (d ? DateTime.fromJSDate(d, { zone: 'Africa/Abidjan' }).toFormat('yyyy-MM-dd HH:mm') : null);

const DELAI = 960; // 16 h ouvrées
const depot = t('2026-09-25 10:00'); // vendredi

describe('dépôt', () => {
  it('75 % de 16 h = 12 h : alerte lundi 16:30, échéance mardi 11:00', () => {
    expect(minutesAvantAlerte(DELAI, 75)).toBe(720);
    const sla = slaAuDepot(depot, DELAI, p);
    expect(local(sla.alertePreventiveLe)).toBe('2026-09-28 16:30'); // vendredi 330 + lundi 390
    expect(local(sla.echeanceSlaLe)).toBe('2026-09-29 11:00'); // vendredi 330 + lundi 450 + mardi 180
  });
  it('seuil arrondi à la minute supérieure : 75 % de 7 min = 6 min', () => {
    expect(minutesAvantAlerte(7, 75)).toBe(6);
  });
});

describe('pause « En attente client » et reprise', () => {
  const auDepot = { delaiCibleMinutes: DELAI, ...slaAuDepot(depot, DELAI, p) };

  it('la pause fige le temps restant et efface l\'échéance', () => {
    const pause = slaEnPause(t('2026-09-28 09:00'), auDepot, p); // lundi : 330 + 60 consommées
    expect(pause).toMatchObject({ echeanceSlaLe: null, alertePreventiveLe: null, slaMinutesRestantes: 570 });
    expect(local(pause.slaSuspenduLe)).toBe('2026-09-28 09:00');
  });
  it('la reprise deux jours plus tard recalcule échéance et alerte depuis la reprise', () => {
    const pause = { delaiCibleMinutes: DELAI, ...slaEnPause(t('2026-09-28 09:00'), auDepot, p) };
    const reprise = slaALaReprise(t('2026-09-30 10:00'), pause, p); // mercredi
    expect(local(reprise.echeanceSlaLe)).toBe('2026-10-01 12:00'); // mercredi 330 + jeudi 240
    expect(local(reprise.alertePreventiveLe)).toBe('2026-09-30 17:30'); // 570 − 240 de marge = 330
    expect(reprise).toMatchObject({ slaMinutesRestantes: null, slaSuspenduLe: null });
  });
  it('le temps de pause ne compte pas : les minutes ouvrées totales restent 960', () => {
    const pause = { delaiCibleMinutes: DELAI, ...slaEnPause(t('2026-09-28 09:00'), auDepot, p) };
    const reprise = slaALaReprise(t('2026-09-30 10:00'), pause, p);
    // 390 consommées avant la pause + 570 après la reprise
    expect(390 + (pause.slaMinutesRestantes ?? 0)).toBe(DELAI);
    expect(reprise.echeanceSlaLe).not.toBeNull();
  });
  it('une pause après l\'échéance garde un restant nul : le ticket reste en retard', () => {
    const pause = slaEnPause(t('2026-09-30 09:00'), auDepot, p);
    expect(pause.slaMinutesRestantes).toBe(0);
    expect(estEnRetard(pause, t('2026-09-30 09:05'))).toBe(true);
    const reprise = slaALaReprise(t('2026-10-02 10:00'), { delaiCibleMinutes: DELAI, ...pause }, p);
    expect(local(reprise.echeanceSlaLe)).toBe('2026-10-02 10:00');
  });
});

describe('résolution', () => {
  const auDepot = { delaiCibleMinutes: DELAI, ...slaAuDepot(depot, DELAI, p) };

  it('avant l\'échéance : SLA respecté, clôture automatique 5 jours plus tard', () => {
    const r = slaALaResolution(t('2026-09-29 10:00'), depot, auDepot, p);
    expect(r.slaRespecte).toBe(true);
    expect(r.delaiResolutionMinutes).toBe(900); // 330 + 450 + 120
    expect(r.slaMinutesRestantes).toBe(60);
    expect(local(r.clotureAutoPrevueLe)).toBe('2026-10-04 10:00');
    expect(r).toMatchObject({ echeanceSlaLe: null, alertePreventiveLe: null });
  });
  it('après l\'échéance : SLA non respecté', () => {
    expect(slaALaResolution(t('2026-09-29 11:01'), depot, auDepot, p).slaRespecte).toBe(false);
  });
  it('pile à l\'échéance : respecté', () => {
    expect(slaALaResolution(t('2026-09-29 11:00'), depot, auDepot, p).slaRespecte).toBe(true);
  });
  it('une contestation reprend le chrono avec le temps qui restait à la résolution', () => {
    const resolue = slaALaResolution(t('2026-09-29 10:00'), depot, auDepot, p);
    const reprise = slaALaReprise(t('2026-10-01 15:00'), { delaiCibleMinutes: DELAI, ...resolue }, p);
    expect(local(reprise.echeanceSlaLe)).toBe('2026-10-01 16:00');
  });
});
