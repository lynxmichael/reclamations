/**
 * Documents Word de test (étape 22), fabriqués en mémoire : un .docx minimal valide (il s'ouvre dans
 * Word), et ses variantes refusées (macros, modèle, chiffré, archive piégée). Aucune dépendance.
 */
import { crc32, deflateRawSync } from 'node:zlib';

export interface ElementZip {
  readonly nom: string;
  readonly contenu: Buffer | string;
  /** Compressé (deflate), sinon stocké tel quel */
  readonly compresse?: boolean;
  /** Marqué chiffré (bit 0 des indicateurs) */
  readonly chiffre?: boolean;
  /** Taille décompressée annoncée, pour simuler une archive piégée */
  readonly tailleAnnoncee?: number;
}

/** Archive ZIP (en-têtes locaux, répertoire central, fin de répertoire). */
export function zip(elements: readonly ElementZip[]): Buffer {
  const locaux: Buffer[] = [];
  const central: Buffer[] = [];
  let decalage = 0;
  for (const e of elements) {
    const brut = Buffer.isBuffer(e.contenu) ? e.contenu : Buffer.from(e.contenu, 'utf8');
    const donnees = e.compresse === false ? brut : deflateRawSync(brut);
    const methode = e.compresse === false ? 0 : 8;
    const nom = Buffer.from(e.nom, 'utf8');
    const crc = crc32(brut);
    const indicateurs = e.chiffre ? 1 : 0;
    const taille = e.tailleAnnoncee ?? brut.length;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(indicateurs, 6);
    local.writeUInt16LE(methode, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(donnees.length, 18);
    local.writeUInt32LE(taille, 22);
    local.writeUInt16LE(nom.length, 26);
    locaux.push(local, nom, donnees);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(indicateurs, 8);
    c.writeUInt16LE(methode, 10);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(donnees.length, 20);
    c.writeUInt32LE(taille, 24);
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

const TYPE_DOCUMENT = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';
const TYPE_MACROS = 'application/vnd.ms-word.document.macroEnabled.main+xml';
const TYPE_MODELE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml';

const types = (principal: string, vba = false) => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
  + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
  + '<Default Extension="xml" ContentType="application/xml"/>'
  + (vba ? '<Default Extension="bin" ContentType="application/vnd.ms-office.vbaProject"/>' : '')
  + `<Override PartName="/word/document.xml" ContentType="${principal}"/></Types>`;

const RELATIONS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
  + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
  + '</Relationships>';

const document = (texte: string) => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'
  + `<w:p><w:r><w:t>${texte.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</w:t></w:r></w:p>`
  + '</w:body></w:document>';

/** Un .docx minimal, sans macro : accepté. */
export function docx(texte = 'Relevé contesté : deux prélèvements de 7 500 FCFA.', supplement: readonly ElementZip[] = []): Buffer {
  return zip([
    { nom: '[Content_Types].xml', contenu: types(TYPE_DOCUMENT) },
    { nom: '_rels/.rels', contenu: RELATIONS },
    { nom: 'word/document.xml', contenu: document(texte) },
    ...supplement,
  ]);
}

/** Variantes refusées */
export const docxRefuses = {
  /** Un .docm renommé en .docx : déclaration « macroEnabled » et projet VBA */
  macros: () => zip([
    { nom: '[Content_Types].xml', contenu: types(TYPE_MACROS, true) },
    { nom: '_rels/.rels', contenu: RELATIONS },
    { nom: 'word/document.xml', contenu: document('Activez les macros pour voir le relevé.') },
    { nom: 'word/vbaProject.bin', contenu: Buffer.from('VBA', 'ascii'), compresse: false },
  ]),
  /** Projet VBA glissé dans un document ordinaire */
  vbaCache: () => docx('texte', [{ nom: 'word/vbaProject.bin', contenu: Buffer.from('VBA', 'ascii'), compresse: false }]),
  modele: () => zip([
    { nom: '[Content_Types].xml', contenu: types(TYPE_MODELE) },
    { nom: '_rels/.rels', contenu: RELATIONS },
    { nom: 'word/document.xml', contenu: document('Modèle') },
  ]),
  activeX: () => docx('texte', [{ nom: 'word/activeX/activeX1.xml', contenu: '<ax/>' }]),
  chiffre: () => zip([
    { nom: '[Content_Types].xml', contenu: types(TYPE_DOCUMENT) },
    { nom: 'word/document.xml', contenu: document('secret'), chiffre: true },
  ]),
  /** 1 Go annoncé pour quelques octets : archive piégée */
  bombe: () => docx('texte', [{ nom: 'word/media/image1.png', contenu: Buffer.alloc(1000), tailleAnnoncee: 1_000_000_000 }]),
  /** Une archive ZIP qui n'est pas un document Word */
  autreZip: () => zip([{ nom: 'photos/plage.jpg', contenu: Buffer.from([0xff, 0xd8, 0xff, 0xe0]) }]),
  /** Ancien format Word (.doc), conteneur OLE */
  ancienDoc: () => Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(504)]),
};
