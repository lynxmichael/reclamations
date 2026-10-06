import { describe, expect, it } from 'vitest';
import { espaceDisque, etatSante, type Mesures } from './sante.controller.js';

const Gio = 1024 ** 3;
const bien: Mesures = { base: true, redis: true, battement: true, envoisEnRetard: false, disque: { libres: 40 * Gio, total: 100 * Gio }, antivirus: true };

describe('état de santé publié (supervision)', () => {
  it('tout va bien : 200 et statut ok', () => {
    expect(etatSante(bien, '1.0.0')).toEqual({
      http: 200,
      corps: { statut: 'ok', base: 'ok', redis: 'ok', worker: 'ok', envois: 'ok', disque: 'ok', antivirus: 'ok', version: '1.0.0' },
    });
  });

  it('worker arrêté, envois en retard, disque presque plein : dégradé mais 200 (le site reste servi)', () => {
    for (const m of [{ battement: false }, { envoisEnRetard: true }, { disque: { libres: 4 * Gio, total: 100 * Gio } }, { disque: { libres: 1.5 * Gio, total: 20 * Gio } }]) {
      const { http, corps } = etatSante({ ...bien, ...m }, '1.0.0');
      expect(http).toBe(200);
      expect(corps.statut).toBe('degrade');
    }
    expect(etatSante({ ...bien, battement: false }, 'x').corps.worker).toBe('absent');
    expect(etatSante({ ...bien, envoisEnRetard: true }, 'x').corps.envois).toBe('en_retard');
    expect(etatSante({ ...bien, disque: { libres: 4.9 * Gio, total: 100 * Gio } }, 'x').corps.disque).toBe('presque_plein');
    expect(etatSante({ ...bien, disque: { libres: 5.1 * Gio, total: 100 * Gio } }, 'x').corps.disque).toBe('ok');
    expect(etatSante({ ...bien, disque: { libres: 1.9 * Gio, total: 20 * Gio } }, 'x').corps.disque).toBe('presque_plein');
  });

  it('étape 22 : ClamAV injoignable dégrade l\'état ; désactivé (développement), non', () => {
    expect(etatSante({ ...bien, antivirus: false }, 'x')).toMatchObject({ http: 200, corps: { statut: 'degrade', antivirus: 'indisponible' } });
    expect(etatSante({ ...bien, antivirus: null }, 'x').corps).toMatchObject({ statut: 'ok', antivirus: 'desactive' });
  });

  it('base ou Redis injoignable : 503 (contrôle de santé Docker), le reste devient inconnu', () => {
    expect(etatSante({ ...bien, base: false, envoisEnRetard: null }, 'x')).toMatchObject({ http: 503, corps: { statut: 'degrade', base: 'indisponible', envois: 'inconnu' } });
    expect(etatSante({ ...bien, redis: false, battement: null }, 'x')).toMatchObject({ http: 503, corps: { statut: 'degrade', redis: 'indisponible', worker: 'inconnu' } });
    expect(etatSante({ ...bien, disque: null }, 'x').corps).toMatchObject({ statut: 'degrade', disque: 'inconnu' });
  });

  it('espace disque mesuré sur le plus proche dossier existant', async () => {
    const d = await espaceDisque('/tmp/n-existe-pas/pas-plus/fichiers');
    expect(d!.total).toBeGreaterThan(0);
    expect(d!.libres).toBeLessThanOrEqual(d!.total);
  });
});
