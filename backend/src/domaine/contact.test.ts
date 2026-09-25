import { describe, expect, it } from 'vitest';
import { normaliserEmail, normaliserTelephone } from './contact.js';

describe('normaliserTelephone', () => {
  it.each([
    ['07 00 00 00 01', '+2250700000001'],
    ['0700000001', '+2250700000001'],
    ['+225 07.00.00.00.01', '+2250700000001'],
    ['002250700000001', '+2250700000001'],
    ['+33 6 12 34 56 78', '+33612345678'],
  ])('%s → %s', (brut, attendu) => expect(normaliserTelephone(brut)).toBe(attendu));

  it('vide → null', () => expect(normaliserTelephone('  ')).toBeNull());
  it.each(['12345', '07000000', 'abc'])('refuse %s', (brut) => expect(() => normaliserTelephone(brut)).toThrow(/invalide/));
});

describe('normaliserEmail', () => {
  it('met en minuscules et retire les espaces', () => expect(normaliserEmail('  Awa.Kone@Exemple.CI ')).toBe('awa.kone@exemple.ci'));
  it('vide → null', () => expect(normaliserEmail('')).toBeNull());
  it('refuse une adresse sans domaine', () => expect(() => normaliserEmail('awa@')).toThrow(/invalide/));
});
