import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import { normaliserCalendrier } from '../temps-ouvre/calendrier.js';
import { instantEscaladeAdmin, seuilEscaladeAdmin } from './escalade.js';

const cal = normaliserCalendrier({
  fuseauHoraire: 'Africa/Abidjan',
  plages: [1, 2, 3, 4, 5].flatMap((j) => [{ jourSemaine: j, debutMinute: 480, finMinute: 720 }, { jourSemaine: j, debutMinute: 840, finMinute: 1050 }]),
  joursFeries: [],
});
const local = (d: Date) => DateTime.fromJSDate(d, { zone: 'Africa/Abidjan' }).toFormat('yyyy-MM-dd HH:mm');

describe('escalade à l\'Admin Entreprise (second niveau)', () => {
  it('seuil : la catégorie, puis la banque ; urgent : son seuil, sinon le seuil normal ; rien, pas de second niveau', () => {
    const banque = { pourcent: 150, urgentPourcent: 125 };
    const aucun = { pourcent: null, urgentPourcent: null };
    expect(seuilEscaladeAdmin('NORMALE', aucun, banque)).toBe(150);
    expect(seuilEscaladeAdmin('URGENTE', aucun, banque)).toBe(125);
    expect(seuilEscaladeAdmin('NORMALE', { pourcent: 200, urgentPourcent: null }, banque)).toBe(200);
    expect(seuilEscaladeAdmin('URGENTE', { pourcent: 200, urgentPourcent: 110 }, banque)).toBe(110);
    expect(seuilEscaladeAdmin('URGENTE', aucun, { pourcent: 150, urgentPourcent: null })).toBe(150);
    expect(seuilEscaladeAdmin('NORMALE', aucun, aucun)).toBeNull();
  });

  it('instant : l\'échéance plus (seuil − 100) % du délai, en minutes ouvrées', () => {
    // Délai de 480 minutes (8 h ouvrées), échéance jeudi 16:00 : 150 % → 240 minutes ouvrées plus tard
    const echeance = DateTime.fromISO('2026-10-01T16:00', { zone: 'Africa/Abidjan' }).toJSDate();
    expect(local(instantEscaladeAdmin(echeance, 480, 150, cal))).toBe('2026-10-02 10:30');
    // 200 % : 480 minutes de plus, le lendemain à 16:30
    expect(local(instantEscaladeAdmin(echeance, 480, 200, cal))).toBe('2026-10-02 16:30');
  });
});
