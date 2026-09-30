import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { ServiceRedis } from '../redis/redis.service.js';
import {
  AntiRobot, cleAntiRobot, creerDefi, DUREE_DEFI_SECONDES, encoderJeton, maximumPour, resoudreDefi, verifierJeton,
} from './anti-robot.js';

const CLE = cleAntiRobot(new TextEncoder().encode('secret-de-test-anti-robot-0123456789'));
const T0 = new Date('2026-10-01T09:00:00Z');

/** Redis en mémoire : seulement ce dont l'anti-robot se sert. */
function faussesCles(enPanne = false) {
  const cles = new Map<string, string>();
  const panne = () => Promise.reject(new Error('connexion refusée'));
  const client = {
    multi() {
      const ops: (() => unknown)[] = [];
      const m = {
        incr: (k: string) => (ops.push(() => { const n = Number(cles.get(k) ?? 0) + 1; cles.set(k, String(n)); return n; }), m),
        expire: () => (ops.push(() => 1), m),
        exec: () => (enPanne ? panne() : Promise.resolve(ops.map((f) => [null, f()]))),
      };
      return m;
    },
    set: (k: string, v: string, ..._options: unknown[]) => {
      if (enPanne) return panne();
      if (cles.has(k)) return Promise.resolve(null);
      cles.set(k, v);
      return Promise.resolve('OK');
    },
  };
  return { redis: { client } as unknown as ServiceRedis, cles };
}

describe('anti-robot : défi et jeton', () => {
  it('le défi se résout, le jeton se vérifie sans état et donne le défi', () => {
    const d = creerDefi(CLE, 5000, T0);
    expect(d.algorithme).toBe('SHA-256');
    expect(d.sel).toMatch(/^[0-9a-f]{24}\?expire=\d{10}$/);
    expect(new Date(d.expireLe).getTime() - T0.getTime()).toBe(DUREE_DEFI_SECONDES * 1000);
    const n = resoudreDefi(d);
    expect(n).not.toBeNull();
    expect(createHash('sha256').update(d.sel + n).digest('hex')).toBe(d.defi);
    expect(verifierJeton(CLE, encoderJeton(d, n!), T0)).toEqual({ valide: true, defi: d.defi, expire: Number(d.sel.split('=')[1]) });
  });

  it('refusé : mauvais nombre, signature d\'une autre clé, sel modifié, expiré, illisible', () => {
    const d = creerDefi(CLE, 1000, T0);
    const n = resoudreDefi(d)!;
    expect(verifierJeton(CLE, encoderJeton(d, n + 1), T0)).toEqual({ valide: false, raison: 'signature' });
    const autre = cleAntiRobot(new TextEncoder().encode('un-autre-secret-de-test-0123456789ab'));
    expect(verifierJeton(autre, encoderJeton(d, n), T0)).toEqual({ valide: false, raison: 'signature' });
    // Repousser l'expiration change le sel, donc le défi : la signature ne correspond plus
    const prolonge = { ...d, sel: d.sel.replace(/expire=(\d+)/, (_, e: string) => `expire=${Number(e) + 3600}`) };
    expect(verifierJeton(CLE, encoderJeton(prolonge, n), T0)).toEqual({ valide: false, raison: 'signature' });
    const apres = new Date(T0.getTime() + (DUREE_DEFI_SECONDES + 1) * 1000);
    expect(verifierJeton(CLE, encoderJeton(d, n), apres)).toEqual({ valide: false, raison: 'expire' });
    for (const jeton of ['', 'pas-du-json', Buffer.from('{"sel":1}').toString('base64url'), encoderJeton({ ...d, signature: 'zz' }, n), encoderJeton(d, -1)]) {
      expect(verifierJeton(CLE, jeton, T0)).toEqual({ valide: false, raison: 'illisible' });
    }
  });

  it('difficulté : ×1 jusqu\'à 10 défis, puis double par tranche de 10, 16 fois au plus', () => {
    expect([0, 1, 10, 11, 20, 21, 31, 41, 500].map((n) => maximumPour(1000, n))).toEqual([1000, 1000, 1000, 2000, 2000, 4000, 8000, 16000, 16000]);
  });
});

describe('anti-robot : service', () => {
  it('un jeton sert une seule fois ; 422 ANTI_ROBOT_REFUSE ensuite', async () => {
    const { redis } = faussesCles();
    const ar = new AntiRobot(redis, new TextEncoder().encode('secret-de-test-anti-robot-0123456789'), 2000, () => T0);
    const d = await ar.defi('203.0.113.7');
    const jeton = encoderJeton(d, resoudreDefi(d)!);
    await expect(ar.exiger(jeton)).resolves.toBeUndefined();
    await expect(ar.exiger(jeton)).rejects.toMatchObject({ status: 422, code: 'ANTI_ROBOT_REFUSE' });
    expect(() => ar.verifier(undefined)).toThrow(expect.objectContaining({ code: 'ANTI_ROBOT_REFUSE' }));
  });

  it('la difficulté monte pour une adresse IP qui demande beaucoup de défis, pas pour les autres', async () => {
    const { redis } = faussesCles();
    const ar = new AntiRobot(redis, new TextEncoder().encode('secret-de-test-anti-robot-0123456789'), 2000, () => T0);
    const maximums = [];
    for (let i = 0; i < 25; i++) maximums.push((await ar.defi('203.0.113.8')).maximum);
    expect(maximums[0]).toBe(2000);
    expect(maximums[10]).toBe(4000);
    expect(maximums[24]).toBe(8000);
    expect((await ar.defi('203.0.113.9')).maximum).toBe(2000);
  });

  it('Redis en panne : difficulté de base et jeton accepté (le portail reste ouvert)', async () => {
    const { redis } = faussesCles(true);
    const ar = new AntiRobot(redis, new TextEncoder().encode('secret-de-test-anti-robot-0123456789'), 2000, () => T0);
    const d = await ar.defi('203.0.113.10');
    expect(d.maximum).toBe(2000);
    const jeton = encoderJeton(d, resoudreDefi(d)!);
    await expect(ar.exiger(jeton)).resolves.toBeUndefined();
  });
});
