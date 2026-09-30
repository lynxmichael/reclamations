/**
 * Anti-robot du portail (étape 11) : le dépôt et la demande de code exigent un défi résolu
 * (lireDefiAntiRobot). Rien à cocher ni à déchiffrer pour le client : le défi est demandé et résolu
 * en arrière-plan dès l'ouverture du formulaire, dans un Web Worker (sinon par tranches sur le fil
 * principal). À l'envoi, le jeton est déjà prêt.
 *
 * Un jeton ne sert qu'une fois : il est retiré dès qu'il est pris, et le suivant se prépare aussitôt.
 * Si l'API refuse le jeton (expiré, déjà servi), l'appel est refait une fois avec un jeton neuf.
 */
import { useEffect, useState } from 'react';
import { chercher } from './anti-robot-calcul';
import { ErreurApi, type Appeler } from './client';
import type { S } from './types';

type Defi = S<'DefiAntiRobot'>;

/** Un jeton qui expire dans moins d'une minute est remplacé avant l'envoi. */
const MARGE_MS = 60_000;
/** Taille d'une tranche sur le fil principal (quelques millisecondes) */
const TRANCHE = 20_000;

/** Jeton à envoyer : JSON {sel, nombre, signature} en base64url. */
export function jetonDe(d: Pick<Defi, 'sel' | 'signature'>, nombre: number): string {
  const json = JSON.stringify({ sel: d.sel, nombre, signature: d.signature });
  return btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

class SansSolution extends Error {}

function dansUnWorker(d: Defi): Promise<number> {
  return new Promise((ok, echec) => {
    const w = new Worker(new URL('./anti-robot.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<{ nombre: number | null }>) => {
      w.terminate();
      if (e.data.nombre === null) echec(new SansSolution('Défi anti-robot sans solution'));
      else ok(e.data.nombre);
    };
    w.onerror = (e) => {
      w.terminate();
      e.preventDefault();
      echec(new Error(e.message || 'Web Worker indisponible'));
    };
    w.postMessage({ sel: d.sel, defi: d.defi, maximum: d.maximum });
  });
}

async function parTranches(d: Defi): Promise<number> {
  for (let debut = 0; debut <= d.maximum; debut += TRANCHE) {
    const n = chercher(d.sel, d.defi, debut, Math.min(d.maximum, debut + TRANCHE - 1));
    if (n !== null) return n;
    await new Promise((r) => setTimeout(r, 0));
  }
  throw new SansSolution('Défi anti-robot sans solution');
}

/** Trouve le nombre du défi : Web Worker si possible, fil principal sinon. */
export async function resoudre(d: Defi): Promise<number> {
  if (typeof Worker !== 'undefined') {
    try {
      return await dansUnWorker(d);
    } catch (e) {
      if (e instanceof SansSolution) throw e;
      // Worker refusé ou absent : on cherche sur le fil principal
    }
  }
  return parTranches(d);
}

interface Pret {
  jeton: string;
  expire: number;
}

export class AntiRobot {
  private prepare: Promise<Pret> | null = null;

  constructor(private readonly appeler: Appeler) {}

  private async nouveau(): Promise<Pret> {
    const d = await this.appeler('lireDefiAntiRobot');
    const nombre = await resoudre(d);
    return { jeton: jetonDe(d, nombre), expire: new Date(d.expireLe).getTime() };
  }

  /** Demande et résout un défi en arrière-plan, s'il n'y en a pas déjà un de prêt ou en cours. */
  preparer(): void {
    if (this.prepare) return;
    const p = this.nouveau();
    this.prepare = p;
    // Réseau coupé : on réessaiera à l'envoi
    p.catch(() => {
      if (this.prepare === p) this.prepare = null;
    });
  }

  /** Jeton prêt (ou calculé maintenant), retiré aussitôt : il ne sert qu'une fois. */
  async prendre(): Promise<string> {
    const p = this.prepare;
    this.prepare = null;
    const pret = p ? await p.catch(() => null) : null;
    if (pret && pret.expire - Date.now() > MARGE_MS) return pret.jeton;
    return (await this.nouveau()).jeton;
  }

  /** Appel protégé : un jeton ; si l'API le refuse, un second essai avec un jeton neuf. */
  async avec<T>(appel: (jeton: string) => Promise<T>): Promise<T> {
    try {
      return await appel(await this.prendre());
    } catch (e) {
      if (!(e instanceof ErreurApi && e.code === 'ANTI_ROBOT_REFUSE')) throw e;
      return await appel((await this.nouveau()).jeton);
    } finally {
      this.preparer();
    }
  }
}

/** Anti-robot d'une page : le premier défi se prépare dès l'affichage. */
export function useAntiRobot(appeler: Appeler): AntiRobot {
  const [antiRobot] = useState(() => new AntiRobot(appeler));
  useEffect(() => antiRobot.preparer(), [antiRobot]);
  return antiRobot;
}
