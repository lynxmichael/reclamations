/**
 * Fichiers de test de l'étape 22, fabriqués en mémoire : un document Word (.docx) minimal, ses
 * variantes refusées (macros, ancien format .doc) et un PDF qui contient le fichier de test EICAR,
 * reconnu comme un virus par tous les antivirus, sans danger. Même fabrication que
 * backend/test/outils/docx.ts (tests de bout en bout), en plus court : éléments non compressés.
 */
import { Buffer } from 'node:buffer';

/** Assemblé à l'exécution : écrit d'un seul tenant, il ferait mettre ce fichier en quarantaine par l'antivirus du poste */
export const EICAR = ['X5O!P%@AP[4\\PZX54(P^)7CC)7}$', 'EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'].join('');

export const TYPE_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (b: Buffer) => (b.reduce((c, o) => TABLE[(c ^ o) & 0xff]! ^ (c >>> 8), 0xffffffff) ^ 0xffffffff) >>> 0;

/** Archive ZIP, éléments stockés tels quels */
function zip(elements: readonly { nom: string; contenu: string }[]): Buffer {
  const locaux: Buffer[] = [];
  const central: Buffer[] = [];
  let decalage = 0;
  for (const e of elements) {
    const donnees = Buffer.from(e.contenu, 'utf8');
    const nom = Buffer.from(e.nom, 'utf8');
    const crc = crc32(donnees);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(donnees.length, 18);
    local.writeUInt32LE(donnees.length, 22);
    local.writeUInt16LE(nom.length, 26);
    locaux.push(local, nom, donnees);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(donnees.length, 20);
    c.writeUInt32LE(donnees.length, 24);
    c.writeUInt16LE(nom.length, 28);
    c.writeUInt32LE(decalage, 42);
    central.push(c, nom);
    decalage += 30 + nom.length + donnees.length;
  }
  const repertoire = Buffer.concat(central);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);
  fin.writeUInt16LE(elements.length, 8);
  fin.writeUInt16LE(elements.length, 10);
  fin.writeUInt32LE(repertoire.length, 12);
  fin.writeUInt32LE(decalage, 16);
  return Buffer.concat([...locaux, repertoire, fin]);
}

const TYPES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
  + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
  + '<Default Extension="xml" ContentType="application/xml"/>'
  + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>';
const RELATIONS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
  + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
  + '</Relationships>';
const document = (texte: string) => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'
  + `<w:p><w:r><w:t>${texte.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</w:t></w:r></w:p></w:body></w:document>`;

/** Un .docx minimal, sans macro : accepté */
export const docx = (texte: string) => zip([
  { nom: '[Content_Types].xml', contenu: TYPES },
  { nom: '_rels/.rels', contenu: RELATIONS },
  { nom: 'word/document.xml', contenu: document(texte) },
]);

/** Un projet de macros (VBA) glissé dans un document nommé .docx : refusé par l'API */
export const docxAMacros = () => zip([
  { nom: '[Content_Types].xml', contenu: TYPES },
  { nom: '_rels/.rels', contenu: RELATIONS },
  { nom: 'word/document.xml', contenu: document('Activez les macros pour lire ce formulaire.') },
  { nom: 'word/vbaProject.bin', contenu: 'VBA' },
]);

/** L'ancien format Word (.doc) : en-tête d'un fichier OLE */
export const ancienDoc = () => Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(504)]);

/** Un relevé PDF qui contient le fichier de test EICAR */
export const pdfInfecte = () => Buffer.concat([Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n'), Buffer.from(`\n${EICAR}\n`)]);
