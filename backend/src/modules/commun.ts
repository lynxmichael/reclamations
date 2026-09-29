/**
 * Outils partagés par les modules de l'API.
 */
import type { Response } from 'express';
import type { components } from '../contrat/api.js';
import type { FichierStocke } from '../application/reclamations/cycle-de-vie.js';
import { urlPortail, type Configuration } from '../configuration/configuration.js';
import type { FichierRecu } from '../infrastructure/contrat/appel.js';
import { verifierFichiers } from '../infrastructure/fichiers/fichiers.js';
import { cleFichier, sha256, type Stockage } from '../infrastructure/stockage/stockage.js';

export type S<N extends keyof components['schemas']> = components['schemas'][N];

export function pagination(requete: Record<string, unknown>) {
  const page = Number(requete.page ?? 1);
  const parPage = Number(requete.parPage ?? 25);
  return { page, parPage, skip: (page - 1) * parPage, take: parPage };
}

export const pageDe = <T>(donnees: T[], page: number, parPage: number, total: number) =>
  ({ donnees, pagination: { page, parPage, total } });

/** Adresse publique du logo : /api/v1/public/logos/<fichier> (clé logos/<fichier>). */
export function urlLogo(logoCle: string | null): string | null {
  return logoCle ? `/api/v1/public/${logoCle}` : null;
}

export function banquePublique(b: { nom: string; slug: string; logoCle: string | null; couleurPrimaire: string | null; couleurSecondaire: string | null }): S<'BanquePublique'> {
  return { nom: b.nom, slug: b.slug, logoUrl: urlLogo(b.logoCle), couleurPrimaire: b.couleurPrimaire, couleurSecondaire: b.couleurSecondaire };
}

export function urlDepot(config: Configuration, slug: string, code: string): string {
  return `${urlPortail(config, slug)}/d/${code}`;
}

/**
 * Contrôle et écrit les fichiers reçus avant la transaction ; rend de quoi les rattacher,
 * et de quoi les effacer si la transaction échoue (aucun fichier orphelin durable).
 */
export async function stockerPiecesJointes(stockage: Stockage, tenantId: string, recus: readonly FichierRecu[], maintenant: Date) {
  const verifies = verifierFichiers(recus, ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
  const stockes: FichierStocke[] = [];
  try {
    for (const f of verifies) {
      const cle = cleFichier(tenantId, maintenant);
      await stockage.ecrire(cle, f.contenu);
      stockes.push({ cleStockage: cle, nomFichier: f.nomOriginal, typeMime: f.typeMime, tailleOctets: f.taille, empreinteSha256: sha256(f.contenu) });
    }
  } catch (e) {
    await Promise.allSettled(stockes.map((s) => stockage.supprimer(s.cleStockage)));
    throw e;
  }
  return {
    fichiers: stockes,
    annuler: () => Promise.allSettled(stockes.map((s) => stockage.supprimer(s.cleStockage))).then(() => undefined),
  };
}

/** Exécute `travail` ; en cas d'échec, efface les fichiers déjà écrits. */
export async function avecFichiers<T>(annuler: () => Promise<void>, travail: () => Promise<T>): Promise<T> {
  try {
    return await travail();
  } catch (e) {
    await annuler();
    throw e;
  }
}

/** Un fichier à renvoyer tel quel : pièce jointe, QR code, logo. */
export interface FichierAEnvoyer {
  readonly contenu: Buffer;
  readonly type: string;
  readonly disposition?: string;
  readonly cache?: string;
}

/** Téléchargement : application/octet-stream, nom encodé (RFC 6266 / 5987). */
export function telechargement(contenu: Buffer, nomFichier: string, type = 'application/octet-stream'): FichierAEnvoyer {
  const ascii = nomFichier.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return { contenu, type, disposition: `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(nomFichier)}` };
}

/**
 * Écrit le fichier directement dans la réponse (méthode avec @Res(), sans passthrough).
 * Pas de StreamableFile : Nest le reconnaît par instanceof, et sous tsx (développement) la classe
 * existe en deux exemplaires ; le fichier partait alors sérialisé en JSON.
 */
export function envoyerFichier(res: Response, f: FichierAEnvoyer): void {
  res.status(200);
  res.setHeader('Content-Type', f.type);
  res.setHeader('Content-Length', String(f.contenu.length));
  if (f.disposition) res.setHeader('Content-Disposition', f.disposition);
  if (f.cache) res.setHeader('Cache-Control', f.cache);
  res.end(f.contenu);
}
