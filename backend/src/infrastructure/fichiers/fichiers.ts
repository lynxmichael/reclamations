/**
 * Fichiers reçus (décision C8) : 5 au plus par dépôt ou message, 5 Mo chacun, JPEG, PNG, WebP ou
 * PDF ; logo : PNG, SVG ou WebP, 1 Mo. Le type est reconnu au contenu (signature du fichier),
 * jamais d'après le nom ou le type annoncé par le navigateur.
 */
import type { Request, Response } from 'express';
import multer from 'multer';
import { Probleme } from '../contrat/probleme.js';
import type { FichierRecu } from '../contrat/appel.js';

export const MAX_FICHIERS = 5;
export const MAX_OCTETS = 5 * 1024 * 1024;
export const MAX_OCTETS_LOGO = 1024 * 1024;
export const TYPES_PIECES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const;
export const TYPES_LOGO = ['image/png', 'image/svg+xml', 'image/webp'] as const;

export type TypeFichier = (typeof TYPES_PIECES)[number] | 'image/svg+xml';

/** Type réel d'après les premiers octets. */
export function typeReel(contenu: Buffer): TypeFichier | null {
  const debut = (n: number) => contenu.subarray(0, n);
  if (contenu.length >= 3 && debut(3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'image/jpeg';
  if (contenu.length >= 8 && debut(8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (contenu.length >= 12 && contenu.toString('ascii', 0, 4) === 'RIFF' && contenu.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (contenu.length >= 5 && contenu.toString('ascii', 0, 5) === '%PDF-') return 'application/pdf';
  const texte = contenu.subarray(0, 1024).toString('utf8').replace(/^\uFEFF/, '').trimStart();
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(texte)) return 'image/svg+xml';
  return null;
}

/** Un SVG ne doit contenir ni script, ni gestionnaire d'événement, ni contenu externe. */
export function svgSain(contenu: Buffer): boolean {
  const t = contenu.toString('utf8');
  if (/<script|<foreignObject|<iframe|<embed|<object|javascript:|data:text\/html/i.test(t)) return false;
  if (/\son[a-z]+\s*=/i.test(t)) return false;
  // Seuls les liens internes au dessin (#forme) sont admis
  for (const m of t.matchAll(/(?:xlink:)?href\s*=\s*["']?([^"'\s>]*)/gi)) if (!m[1].startsWith('#')) return false;
  return true;
}

export interface FichierVerifie extends FichierRecu {
  readonly typeMime: TypeFichier;
}

/** Contrôle le type de chaque fichier ; 415 TYPE_DE_FICHIER_NON_SUPPORTE sinon. */
export function verifierFichiers(fichiers: readonly FichierRecu[], types: readonly string[]): FichierVerifie[] {
  if (fichiers.length > MAX_FICHIERS) throw new Probleme(422, 'TROP_DE_FICHIERS', `${MAX_FICHIERS} fichiers au plus`);
  return fichiers.map((f) => {
    const type = typeReel(f.contenu);
    if (!type || !types.includes(type)) {
      throw new Probleme(415, 'TYPE_DE_FICHIER_NON_SUPPORTE', `« ${f.nomOriginal} » : ${types === TYPES_LOGO ? 'PNG, SVG ou WebP' : 'JPEG, PNG, WebP ou PDF'} attendu`);
    }
    return { ...f, typeMime: type };
  });
}

/** Nom de fichier présentable : sans chemin ni caractère de contrôle, 255 caractères au plus. */
export function nomPropre(nom: string): string {
  const base = nom.split(/[\\/]/).pop() ?? 'fichier';
  const propre = base.replace(/[\u0000-\u001f\u007f"<>|:*?]/g, '_').trim().slice(0, 255);
  return propre || 'fichier';
}

/** Lit un corps multipart en mémoire (limites appliquées pendant la lecture). */
export function lireMultipart(req: Request, res: Response, maxOctets: number): Promise<FichierRecu[]> {
  const lecteur = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxOctets, files: MAX_FICHIERS, fields: 30, fieldSize: 64 * 1024, parts: 40 },
  }).any();
  return new Promise((ok, echec) => {
    lecteur(req, res, (err: unknown) => {
      if (!err) {
        const fichiers = ((req.files as Express.Multer.File[] | undefined) ?? []).map((f) => ({
          champ: f.fieldname,
          nomOriginal: nomPropre(Buffer.from(f.originalname, 'latin1').toString('utf8')),
          taille: f.size,
          contenu: f.buffer,
        }));
        ok(fichiers);
        return;
      }
      const code = (err as { code?: string }).code;
      if (code === 'LIMIT_FILE_SIZE') {
        echec(new Probleme(413, 'FICHIER_TROP_VOLUMINEUX', `${Math.round(maxOctets / 1024 / 1024)} Mo au plus par fichier`));
      } else if (code === 'LIMIT_FILE_COUNT') {
        echec(new Probleme(422, 'TROP_DE_FICHIERS', `${MAX_FICHIERS} fichiers au plus`));
      } else {
        echec(new Probleme(400, 'VALIDATION', 'Formulaire multipart illisible'));
      }
    });
  });
}
