/**
 * Antivirus des pièces jointes (étape 22) : ClamAV, interrogé par son démon clamd en TCP (commande
 * INSTREAM : le fichier est envoyé par morceaux, rien n'est écrit sur un disque partagé).
 *
 *   ANTIVIRUS=clamav (par défaut en production) · CLAMAV_HOTE (clamav) · CLAMAV_PORT (3310)
 *   ANTIVIRUS=aucun : développement et tests seulement, refusé en production ; les fichiers sont
 *   alors acceptés sans analyse (le journal le rappelle au démarrage).
 *
 * clamd injoignable ou trop lent : `ErreurAntivirus`. L'appelant enregistre alors le fichier « en
 * attente d'analyse » ; le worker le reprend (travail antivirus) et il n'est téléchargeable qu'une fois sain.
 */
import { connect } from 'node:net';

export type ResultatAnalyse = { readonly sain: true } | { readonly sain: false; readonly virus: string };

export interface Antivirus {
  /** false : pas d'analyse (développement) */
  readonly actif: boolean;
  analyser(contenu: Buffer): Promise<ResultatAnalyse>;
  /** clamd répond-il ? (santé) */
  disponible(): Promise<boolean>;
}

export class ErreurAntivirus extends Error {}

/** Morceaux d'INSTREAM (clamd refuse au-delà de StreamMaxLength, 25 Mo par défaut, au total) */
const MORCEAU = 64 * 1024;

export class ClamAv implements Antivirus {
  readonly actif = true;

  constructor(private readonly hote: string, private readonly port: number, private readonly delaiMs = 30_000) {}

  analyser(contenu: Buffer): Promise<ResultatAnalyse> {
    return this.commande(Buffer.from('zINSTREAM\0'), contenu).then((reponse) => {
      // « stream: OK » ou « stream: Eicar-Test-Signature FOUND »
      const trouve = /^stream: (.+) FOUND$/.exec(reponse);
      if (trouve) return { sain: false, virus: trouve[1]!.slice(0, 120) };
      if (reponse === 'stream: OK') return { sain: true };
      throw new ErreurAntivirus(`ClamAV : réponse inattendue « ${reponse.slice(0, 120)} »`);
    });
  }

  async disponible(): Promise<boolean> {
    try {
      return (await this.commande(Buffer.from('zPING\0'))) === 'PONG';
    } catch {
      return false;
    }
  }

  private commande(debut: Buffer, flux?: Buffer): Promise<string> {
    return new Promise((ok, echec) => {
      const morceaux: Buffer[] = [];
      let fini = false;
      const finir = (e: Error | null, r?: string) => {
        if (fini) return;
        fini = true;
        socket.destroy();
        if (e) echec(e);
        else ok(r!);
      };
      const socket = connect({ host: this.hote, port: this.port }, () => {
        socket.write(debut);
        if (flux) {
          for (let i = 0; i < flux.length; i += MORCEAU) {
            const part = flux.subarray(i, i + MORCEAU);
            const longueur = Buffer.alloc(4);
            longueur.writeUInt32BE(part.length);
            socket.write(longueur);
            socket.write(part);
          }
          socket.write(Buffer.alloc(4));
        }
      });
      socket.setTimeout(this.delaiMs, () => finir(new ErreurAntivirus(`ClamAV : pas de réponse en ${Math.ceil(this.delaiMs / 1000)} s`)));
      socket.on('data', (d: Buffer) => {
        morceaux.push(d);
        const tout = Buffer.concat(morceaux);
        const fin = tout.indexOf(0);
        if (fin >= 0) finir(null, tout.subarray(0, fin).toString('utf8').trim());
      });
      socket.on('end', () => finir(null, Buffer.concat(morceaux).toString('utf8').replace(/\0/g, '').trim()));
      socket.on('error', (e) => finir(new ErreurAntivirus(`ClamAV injoignable (${this.hote}:${this.port}) : ${e.message}`)));
    });
  }
}

/** Développement et tests sans clamd : aucun fichier n'est analysé. */
export class SansAntivirus implements Antivirus {
  readonly actif = false;
  async analyser(): Promise<ResultatAnalyse> {
    return { sain: true };
  }
  async disponible(): Promise<boolean> {
    return true;
  }
}

export interface ConfigurationAntivirus {
  readonly mode: 'clamav' | 'aucun';
  readonly hote: string;
  readonly port: number;
}

export function antivirusDe(c: ConfigurationAntivirus): Antivirus {
  return c.mode === 'clamav' ? new ClamAv(c.hote, c.port) : new SansAntivirus();
}

/**
 * Fichier de test EICAR : reconnu comme un virus par tous les antivirus, sans danger. Assemblé à
 * l'exécution : écrit d'un seul tenant dans le code, il ferait mettre ce fichier en quarantaine par
 * l'antivirus du poste de développement.
 */
export const EICAR = ['X5O!P%@AP[4\\PZX54(P^)7CC)7}$', 'EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'].join('');

export const ANTIVIRUS = Symbol('ANTIVIRUS');
