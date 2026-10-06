/**
 * Outils partagés par les modules de l'API.
 */
import type { Response } from 'express';
import type { components } from '../contrat/api.js';
import type { FichierStocke } from '../application/reclamations/cycle-de-vie.js';
import { urlPortail, type Configuration } from '../configuration/configuration.js';
import type { FichierRecu } from '../infrastructure/contrat/appel.js';
import { Probleme } from '../infrastructure/contrat/probleme.js';
import { ErreurAntivirus, type Antivirus } from '../infrastructure/fichiers/antivirus.js';
import { TYPES_PIECES, verifierFichiers } from '../infrastructure/fichiers/fichiers.js';
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

/** Champs de la banque lus pour son portail (dont son numéro WhatsApp, étape 20) */
export const CHAMPS_BANQUE_PUBLIQUE = {
  nom: true, slug: true, logoCle: true, couleurPrimaire: true, couleurSecondaire: true, whatsapp: true, chatWeb: true,
  canaux: { where: { canal: 'WHATSAPP' }, select: { numero: true } },
} as const;

interface BanqueLue {
  nom: string; slug: string; logoCle: string | null; couleurPrimaire: string | null; couleurSecondaire: string | null;
  whatsapp: boolean; chatWeb: boolean; canaux: { numero: string }[];
}

export function banquePublique(b: BanqueLue): S<'BanquePublique'> {
  return {
    nom: b.nom, slug: b.slug, logoUrl: urlLogo(b.logoCle), couleurPrimaire: b.couleurPrimaire, couleurSecondaire: b.couleurSecondaire,
    whatsapp: b.whatsapp && b.chatWeb ? (b.canaux[0]?.numero ?? null) : null,
  };
}

/**
 * Adresse à partager d'un point de dépôt : le portail pour un QR code ou un lien web ; pour le numéro
 * WhatsApp ou SMS de la banque (étape 20), l'ouverture de la conversation sur le téléphone du client.
 */
export function adresseDepot(config: Configuration, slug: string, point: { code: string; canal: string }, numero: string | null): string {
  if (point.canal === 'WHATSAPP' && numero) return `https://wa.me/${numero.replace(/\D/g, '')}`;
  if (point.canal === 'SMS' && numero) return `sms:${numero}`;
  return urlDepot(config, slug, point.code);
}

export function urlDepot(config: Configuration, slug: string, code: string): string {
  return `${urlPortail(config, slug)}/d/${code}`;
}

/**
 * Contrôle et écrit les fichiers reçus avant la transaction ; rend de quoi les rattacher,
 * et de quoi les effacer si la transaction échoue (aucun fichier orphelin durable).
 *
 * Étape 22 : chaque fichier passe par l'antivirus. Infecté : refusé (422 FICHIER_INFECTE), rien n'est
 * écrit. Antivirus injoignable : écrit « en attente d'analyse », le worker l'analyse dès qu'il répond,
 * et le fichier n'est téléchargeable qu'une fois déclaré sain.
 */
export async function stockerPiecesJointes(stockage: Stockage, antivirus: Antivirus, tenantId: string, recus: readonly FichierRecu[], maintenant: Date) {
  const verifies = verifierFichiers(recus, TYPES_PIECES);
  const analyses: { antivirus: 'SAIN' | 'EN_ATTENTE'; analyseeLe: Date | null }[] = [];
  for (const f of verifies) {
    try {
      const r = await antivirus.analyser(f.contenu);
      if (!r.sain) throw new Probleme(422, 'FICHIER_INFECTE', `« ${f.nomOriginal} » contient un virus (${r.virus}) : rien n'a été enregistré. Retirez ce fichier, puis réessayez.`);
      analyses.push({ antivirus: 'SAIN', analyseeLe: maintenant });
    } catch (e) {
      if (!(e instanceof ErreurAntivirus)) throw e;
      analyses.push({ antivirus: 'EN_ATTENTE', analyseeLe: null });
    }
  }
  const stockes: FichierStocke[] = [];
  try {
    for (const [i, f] of verifies.entries()) {
      const cle = cleFichier(tenantId, maintenant);
      await stockage.ecrire(cle, f.contenu);
      stockes.push({ cleStockage: cle, nomFichier: f.nomOriginal, typeMime: f.typeMime, tailleOctets: f.taille, empreinteSha256: sha256(f.contenu), ...analyses[i]! });
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

/** Étape 22 : une pièce jointe ne se télécharge qu'une fois déclarée saine par l'antivirus. */
export function exigerSaine(p: { antivirus: 'EN_ATTENTE' | 'SAIN' | 'INFECTE' }): void {
  if (p.antivirus === 'EN_ATTENTE') throw new Probleme(409, 'FICHIER_EN_ANALYSE', 'Ce fichier sera disponible dans quelques minutes, une fois analysé par l\'antivirus.');
  if (p.antivirus === 'INFECTE') throw new Probleme(409, 'FICHIER_SUPPRIME', 'L\'antivirus y a trouvé un virus : il a été effacé.');
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
