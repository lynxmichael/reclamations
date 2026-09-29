/**
 * Stockage des fichiers (pièces jointes, logos) derrière une interface : disque local (volume
 * Docker) à l'étape 7 ; un adaptateur compatible S3 (Contabo Object Storage) pourra le remplacer
 * sans toucher au reste (point ouvert « Pièces jointes et sauvegardes »).
 *
 * Les fichiers ne sont jamais servis par une adresse publique : l'API vérifie les droits et les lit.
 */
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

export interface Stockage {
  ecrire(cle: string, contenu: Buffer): Promise<void>;
  lire(cle: string): Promise<Buffer | null>;
  supprimer(cle: string): Promise<void>;
}

export class StockageDisque implements Stockage {
  constructor(private readonly racine: string) {}

  private chemin(cle: string): string {
    if (!/^[A-Za-z0-9/_.-]{1,255}$/.test(cle) || cle.includes('..')) throw new Error(`Clé de stockage invalide : ${cle}`);
    const complet = resolve(this.racine, cle);
    if (!complet.startsWith(resolve(this.racine) + sep)) throw new Error(`Clé hors du stockage : ${cle}`);
    return complet;
  }

  async ecrire(cle: string, contenu: Buffer): Promise<void> {
    const chemin = this.chemin(cle);
    await mkdir(dirname(chemin), { recursive: true });
    // Écriture atomique : fichier temporaire puis renommage
    const temporaire = `${chemin}.${randomBytes(4).toString('hex')}.tmp`;
    await writeFile(temporaire, contenu, { mode: 0o640 });
    await rename(temporaire, chemin);
  }

  async lire(cle: string): Promise<Buffer | null> {
    try {
      return await readFile(this.chemin(cle));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  }

  async supprimer(cle: string): Promise<void> {
    await rm(this.chemin(cle), { force: true });
  }
}

/** Clé d'une pièce jointe : banque/année/mois/aléatoire (aucune donnée du client dans le nom). */
export function cleFichier(tenantId: string, maintenant: Date): string {
  const aaaa = maintenant.getUTCFullYear();
  const mm = String(maintenant.getUTCMonth() + 1).padStart(2, '0');
  return join('pieces-jointes', tenantId, String(aaaa), mm, randomBytes(18).toString('base64url')).split(sep).join('/');
}

export function sha256(contenu: Buffer): string {
  return createHash('sha256').update(contenu).digest('hex');
}

export const STOCKAGE = Symbol('STOCKAGE');
