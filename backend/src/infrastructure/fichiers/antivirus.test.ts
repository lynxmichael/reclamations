import { createServer } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { demarrerClamavSimule, type ClamavSimule } from '../../../test/outils/clamav-simule.js';
import { ClamAv, EICAR, ErreurAntivirus, SansAntivirus, antivirusDe } from './antivirus.js';

let clamd: ClamavSimule;
beforeAll(async () => {
  clamd = await demarrerClamavSimule();
});
afterAll(() => clamd.fermer());

describe('antivirus ClamAV (étape 22)', () => {
  it('fichier sain, fichier EICAR, gros fichier envoyé par morceaux', async () => {
    const av = new ClamAv('127.0.0.1', clamd.port);
    expect(await av.analyser(Buffer.from('%PDF-1.4 relevé'))).toEqual({ sain: true });
    expect(await av.analyser(Buffer.from(EICAR))).toEqual({ sain: false, virus: 'Win.Test.EICAR_HDB-1' });
    const gros = Buffer.concat([Buffer.alloc(3 * 1024 * 1024, 7), Buffer.from(EICAR)]);
    expect((await av.analyser(gros)).sain).toBe(false);
    expect(await av.disponible()).toBe(true);
  });

  it('clamd injoignable ou muet : ErreurAntivirus (le fichier sera analysé plus tard)', async () => {
    // Accepte la connexion, lit sans jamais répondre
    const muet = createServer((s) => s.resume());
    await new Promise<void>((ok) => muet.listen(0, '127.0.0.1', ok));
    const port = (muet.address() as { port: number }).port;
    await expect(new ClamAv('127.0.0.1', port, 300).analyser(Buffer.from('x'))).rejects.toBeInstanceOf(ErreurAntivirus);
    await new Promise<void>((ok) => muet.close(() => ok()));
    await expect(new ClamAv('127.0.0.1', port, 300).analyser(Buffer.from('x'))).rejects.toBeInstanceOf(ErreurAntivirus);
    expect(await new ClamAv('127.0.0.1', port, 300).disponible()).toBe(false);
  });

  it('sans antivirus (développement) : tout est accepté, et l\'API le sait', async () => {
    expect(antivirusDe({ mode: 'aucun', hote: 'x', port: 1 })).toBeInstanceOf(SansAntivirus);
    expect(antivirusDe({ mode: 'clamav', hote: 'x', port: 1 }).actif).toBe(true);
    expect(await new SansAntivirus().analyser()).toEqual({ sain: true });
  });

  it('la chaîne EICAR n\'est jamais écrite d\'un seul tenant dans le code', () => {
    expect(EICAR).toHaveLength(68);
    expect(EICAR.startsWith('X5O!P%@AP')).toBe(true);
  });
});
