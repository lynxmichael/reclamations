/**
 * Documents Word (étape 22) : seul le format .docx (Office Open XML, une archive ZIP) est accepté, et
 * seulement sans macro. Le contrôle lit l'archive sans l'extraire :
 *
 * - le sommaire de l'archive (répertoire central) : `[Content_Types].xml` et `word/document.xml`
 *   présents ; ni macros (`vbaProject.bin`, `vbaData.xml`), ni contrôles ActiveX ; aucun élément chiffré ;
 * - la déclaration des types : document Word ordinaire (pas « macroEnabled », pas un modèle) ;
 * - les tailles : 2 000 éléments, 200 Mo décompressés au plus, et un taux de compression plausible (1 000 au plus)
 *   (une « bombe » ZIP se décompresse en gigaoctets).
 *
 * L'ancien format .doc (binaire, macros possibles) est refusé : le client l'enregistre en .docx ou en PDF.
 * L'antivirus analyse ensuite le fichier comme les autres.
 */
import { inflateRawSync } from 'node:zlib';

export const TYPE_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const MAX_ELEMENTS = 2000;
const MAX_DECOMPRESSE = 200 * 1024 * 1024;
const MAX_TAUX = 1000;

export type VerdictWord = { readonly ok: true } | { readonly ok: false; readonly raison: string };

/** Signature d'une archive ZIP (et donc d'un .docx) */
export const estZip = (c: Buffer) => c.length >= 4 && c.readUInt32LE(0) === 0x04034b50;
/** Signature d'un fichier OLE (ancien .doc, .xls…) */
export const estOle = (c: Buffer) => c.length >= 8 && c.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));

interface Element {
  readonly nom: string;
  readonly chiffre: boolean;
  readonly methode: number;
  readonly compresse: number;
  readonly decompresse: number;
  readonly entete: number;
}

const refus = (raison: string): VerdictWord => ({ ok: false, raison });

function repertoire(c: Buffer): Element[] | string {
  // Fin du répertoire central : dans les 65 557 derniers octets (commentaire de 65 535 au plus)
  let fin = -1;
  for (let i = c.length - 22; i >= Math.max(0, c.length - 65_557); i--) {
    if (c.readUInt32LE(i) === 0x06054b50) {
      fin = i;
      break;
    }
  }
  if (fin < 0) return 'archive illisible';
  const nombre = c.readUInt16LE(fin + 10);
  const taille = c.readUInt32LE(fin + 12);
  const debut = c.readUInt32LE(fin + 16);
  if (nombre === 0xffff || debut === 0xffffffff) return 'archive trop grande';
  if (nombre > MAX_ELEMENTS) return 'trop d\'éléments';
  if (debut + taille > fin) return 'archive illisible';
  const elements: Element[] = [];
  let p = debut;
  for (let n = 0; n < nombre; n++) {
    if (p + 46 > c.length || c.readUInt32LE(p) !== 0x02014b50) return 'archive illisible';
    const longueurNom = c.readUInt16LE(p + 28);
    const longueurExtra = c.readUInt16LE(p + 30);
    const longueurCommentaire = c.readUInt16LE(p + 32);
    elements.push({
      nom: c.toString('utf8', p + 46, p + 46 + longueurNom),
      chiffre: (c.readUInt16LE(p + 8) & 1) === 1,
      methode: c.readUInt16LE(p + 10),
      compresse: c.readUInt32LE(p + 20),
      decompresse: c.readUInt32LE(p + 24),
      entete: c.readUInt32LE(p + 42),
    });
    p += 46 + longueurNom + longueurExtra + longueurCommentaire;
  }
  return elements;
}

/** Contenu d'un petit élément (la déclaration des types), décompressé dans la limite de 1 Mo. */
function lire(c: Buffer, e: Element): string | null {
  const p = e.entete;
  if (p + 30 > c.length || c.readUInt32LE(p) !== 0x04034b50) return null;
  const debut = p + 30 + c.readUInt16LE(p + 26) + c.readUInt16LE(p + 28);
  const donnees = c.subarray(debut, debut + e.compresse);
  try {
    if (e.methode === 0) return donnees.toString('utf8');
    if (e.methode === 8) return inflateRawSync(donnees, { maxOutputLength: 1024 * 1024 }).toString('utf8');
  } catch {
    return null;
  }
  return null;
}

export function verifierDocx(c: Buffer): VerdictWord {
  if (!estZip(c)) return refus('ce n\'est pas un document Word (.docx)');
  const elements = repertoire(c);
  if (typeof elements === 'string') return refus(elements);
  let total = 0;
  for (const e of elements) {
    if (e.chiffre) return refus('document protégé par un mot de passe');
    total += e.decompresse;
    if (total > MAX_DECOMPRESSE || (e.compresse > 0 && e.decompresse / e.compresse > MAX_TAUX)) return refus('archive anormale');
    if (/(^|\/)vbaProject\.bin$/i.test(e.nom) || /(^|\/)vbaData\.xml$/i.test(e.nom)) return refus('il contient des macros');
    if (/^word\/activeX\//i.test(e.nom)) return refus('il contient des contrôles ActiveX');
  }
  const types = elements.find((e) => e.nom === '[Content_Types].xml');
  if (!types || !elements.some((e) => e.nom === 'word/document.xml')) return refus('ce n\'est pas un document Word (.docx)');
  const declaration = lire(c, types);
  if (declaration === null) return refus('archive illisible');
  if (/macroEnabled/i.test(declaration)) return refus('il contient des macros');
  if (!/wordprocessingml\.document\.main\+xml/i.test(declaration)) return refus('ce n\'est pas un document Word (.docx)');
  return { ok: true };
}
