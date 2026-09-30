import { describe, expect, it } from 'vitest';
import { parametresDemonstration } from './demonstration.js';
import { GRAINE_TOTP_DEMO, MOT_DE_PASSE_DEMO, secretTotpDemo } from './jeu-de-donnees.js';

describe('environnement de démonstration (étape 10)', () => {
  const demo = { NODE_ENV: 'production', DEMONSTRATION: '1', DEMO_MOT_DE_PASSE: 'Salon-Banque-2026!', DEMO_GRAINE_TOTP: 'a'.repeat(64) };

  it('développement : valeurs du dépôt', () => {
    expect(parametresDemonstration({})).toEqual({ motDePasse: MOT_DE_PASSE_DEMO, graineTotp: GRAINE_TOTP_DEMO, enLigne: false });
  });

  it('production réelle : jeu de démonstration refusé', () => {
    expect(() => parametresDemonstration({ NODE_ENV: 'production' })).toThrow(/refusé en production/);
    expect(() => parametresDemonstration({ ...demo, DEMONSTRATION: 'oui' })).toThrow(/refusé en production/);
  });

  it('démonstration en ligne : mot de passe et graine propres à l\'installation, obligatoires', () => {
    expect(parametresDemonstration(demo)).toEqual({ motDePasse: demo.DEMO_MOT_DE_PASSE, graineTotp: demo.DEMO_GRAINE_TOTP, enLigne: true });
    expect(() => parametresDemonstration({ ...demo, DEMO_MOT_DE_PASSE: MOT_DE_PASSE_DEMO })).toThrow(/DEMO_MOT_DE_PASSE/);
    expect(() => parametresDemonstration({ ...demo, DEMO_GRAINE_TOTP: 'courte' })).toThrow(/DEMO_GRAINE_TOTP/);
  });

  it('la graine change les secrets TOTP ; sans graine, ceux des tests restent les mêmes', () => {
    const e = 'aya.konan@banque-alpha.example';
    expect(secretTotpDemo(e)).toBe(secretTotpDemo(e, GRAINE_TOTP_DEMO));
    expect(secretTotpDemo(e, demo.DEMO_GRAINE_TOTP)).not.toBe(secretTotpDemo(e));
    expect(secretTotpDemo(e, demo.DEMO_GRAINE_TOTP)).toMatch(/^[A-Z2-7]{32}$/);
  });
});
