/**
 * Anti-robot du portail (étape 11) : SHA-256 maison conforme, jeton accepté par la vérification
 * du backend (même code), jeton préparé à l'avance, second essai sur refus.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { cleAntiRobot, creerDefi, verifierJeton } from '../../backend/src/infrastructure/securite/anti-robot';
import { AntiRobot, jetonDe, resoudre } from '../src/api/anti-robot';
import { chercher, sha256Hex } from '../src/api/anti-robot-calcul';
import { ErreurApi, type Appeler } from '../src/api/client';

const CLE = cleAntiRobot(new TextEncoder().encode('secret-de-test-anti-robot-0123456789'));

describe('calcul', () => {
  it('SHA-256 identique à celui de Node, y compris sur deux blocs et en UTF-8', () => {
    for (const t of ['', 'abc', 'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(64), 'Réclamation Abidjan'.repeat(9)]) {
      expect(sha256Hex(t), `longueur ${t.length}`).toBe(createHash('sha256').update(t).digest('hex'));
    }
  });

  it('retrouve le nombre du défi, et rien hors de l\'intervalle', () => {
    const sel = '9f86d081884c7d659a2feaa0?expire=1790000000';
    const defi = createHash('sha256').update(`${sel}4321`).digest('hex');
    expect(chercher(sel, defi, 0, 10_000)).toBe(4321);
    expect(chercher(sel, defi, 0, 4320)).toBeNull();
    expect(chercher(sel, defi, 4321, 4321)).toBe(4321);
  });

  it('le jeton du navigateur est accepté par la vérification de l\'API (sans Web Worker : fil principal)', async () => {
    const d = creerDefi(CLE, 50_000, new Date());
    const nombre = await resoudre(d);
    const jeton = jetonDe(d, nombre);
    expect(jeton).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(verifierJeton(CLE, jeton, new Date())).toMatchObject({ valide: true, defi: d.defi });
  });
});

describe('jeton préparé et second essai', () => {
  function api(expireDansMs = 600_000) {
    const defis: string[] = [];
    const appeler = vi.fn(async (operation: string) => {
      if (operation !== 'lireDefiAntiRobot') throw new Error(operation);
      const d = creerDefi(CLE, 500, new Date(Date.now() + expireDansMs - 600_000));
      defis.push(d.defi);
      return d;
    }) as unknown as Appeler;
    return { appeler, defis };
  }

  it('le défi est demandé et résolu dès la préparation ; chaque jeton ne sert qu\'une fois', async () => {
    const { appeler, defis } = api();
    const ar = new AntiRobot(appeler);
    ar.preparer();
    ar.preparer();
    const premier = await ar.prendre();
    expect(defis).toHaveLength(1);
    expect(verifierJeton(CLE, premier, new Date())).toMatchObject({ valide: true, defi: defis[0] });
    const second = await ar.prendre();
    expect(defis).toHaveLength(2);
    expect(second).not.toBe(premier);
  });

  it('un jeton préparé qui expire dans moins d\'une minute est remplacé', async () => {
    const { appeler, defis } = api(30_000);
    const ar = new AntiRobot(appeler);
    ar.preparer();
    await ar.prendre();
    expect(defis).toHaveLength(2);
  });

  it('refus ANTI_ROBOT_REFUSE : un second essai avec un jeton neuf ; une autre erreur remonte telle quelle', async () => {
    const { appeler } = api();
    const ar = new AntiRobot(appeler);
    const refus = new ErreurApi({ type: '/erreurs/anti-robot', title: 'Refusé', status: 422, code: 'ANTI_ROBOT_REFUSE' }, 422);
    const recus: string[] = [];
    const resultat = await ar.avec(async (jeton) => {
      recus.push(jeton);
      if (recus.length === 1) throw refus;
      return 'ok';
    });
    expect(resultat).toBe('ok');
    expect(new Set(recus).size).toBe(2);
    const autre = new ErreurApi({ type: '/erreurs/validation', title: 'Invalide', status: 400, code: 'VALIDATION' }, 400);
    let essais = 0;
    await expect(ar.avec(async () => {
      essais++;
      throw autre;
    })).rejects.toBe(autre);
    expect(essais).toBe(1);
  });
});
