/**
 * ClamAV simulé (étape 22) pour les tests de bout en bout et le serveur des tests navigateur : un petit
 * serveur TCP qui parle le protocole de clamd (zPING, zINSTREAM). Il trouve le fichier de test EICAR,
 * dit sain tout le reste, et compte les fichiers analysés. L'adaptateur de l'API (ClamAv) est ainsi
 * exercé tel qu'en production ; un vrai clamd est contrôlé au déploiement (deploiement/verifier.sh).
 */
import { createServer, type Server, type Socket } from 'node:net';
import { EICAR } from '../../src/infrastructure/fichiers/antivirus.js';

export interface ClamavSimule {
  readonly port: number;
  /** Nombre de fichiers analysés depuis le démarrage */
  analyses(): number;
  fermer(): Promise<void>;
}

const SIGNATURE = 'Win.Test.EICAR_HDB-1';

function traiter(socket: Socket, compter: () => void) {
  let tampon = Buffer.alloc(0);
  let commande: string | null = null;
  const morceaux: Buffer[] = [];
  socket.on('data', (d: Buffer) => {
    tampon = Buffer.concat([tampon, d]);
    if (commande === null) {
      const fin = tampon.indexOf(0);
      if (fin < 0) return;
      commande = tampon.subarray(0, fin).toString('ascii');
      tampon = tampon.subarray(fin + 1);
      if (commande === 'zPING') {
        socket.end('PONG\0');
        return;
      }
      if (commande !== 'zINSTREAM') {
        socket.end('UNKNOWN COMMAND\0');
        return;
      }
    }
    // Morceaux [longueur sur 4 octets][données], terminés par une longueur nulle
    while (tampon.length >= 4) {
      const n = tampon.readUInt32BE(0);
      if (n === 0) {
        compter();
        const contenu = Buffer.concat(morceaux).toString('latin1');
        socket.end(contenu.includes(EICAR) ? `stream: ${SIGNATURE} FOUND\0` : 'stream: OK\0');
        return;
      }
      if (tampon.length < 4 + n) return;
      morceaux.push(tampon.subarray(4, 4 + n));
      tampon = tampon.subarray(4 + n);
    }
  });
  socket.on('error', () => undefined);
}

export async function demarrerClamavSimule(port = 0): Promise<ClamavSimule> {
  let analyses = 0;
  const serveur: Server = createServer((s) => traiter(s, () => analyses++));
  await new Promise<void>((ok) => serveur.listen(port, '127.0.0.1', ok));
  const adresse = serveur.address() as { port: number };
  return {
    port: adresse.port,
    analyses: () => analyses,
    fermer: () => new Promise<void>((ok) => serveur.close(() => ok())),
  };
}
