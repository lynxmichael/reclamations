import { describe, expect, it } from 'vitest';
import { docx, docxRefuses } from '../../../test/outils/docx.js';
import { Probleme } from '../contrat/probleme.js';
import { MAX_OCTETS, TYPES_PIECES, typeReel, verifierFichiers } from './fichiers.js';
import { TYPE_DOCX, verifierDocx } from './word.js';

const fichier = (nom: string, contenu: Buffer) => ({ champ: 'fichiers', nomOriginal: nom, taille: contenu.length, contenu });
const refus = (nom: string, contenu: Buffer) => {
  try {
    verifierFichiers([fichier(nom, contenu)], TYPES_PIECES);
  } catch (e) {
    return e as Probleme;
  }
  throw new Error('accepté');
};

describe('documents Word (étape 22)', () => {
  it('un .docx ordinaire est reconnu au contenu, quel que soit son nom', () => {
    expect(verifierDocx(docx())).toEqual({ ok: true });
    expect(typeReel(docx())).toBe(TYPE_DOCX);
    expect(verifierFichiers([fichier('releve.pdf', docx())], TYPES_PIECES)[0]!.typeMime).toBe(TYPE_DOCX);
  });

  it.each([
    ['macros', docxRefuses.macros(), 'il contient des macros'],
    ['projet VBA caché', docxRefuses.vbaCache(), 'il contient des macros'],
    ['contrôles ActiveX', docxRefuses.activeX(), 'contrôles ActiveX'],
    ['modèle (.dotx)', docxRefuses.modele(), 'pas un document Word'],
    ['chiffré', docxRefuses.chiffre(), 'mot de passe'],
    ['archive piégée', docxRefuses.bombe(), 'archive anormale'],
    ['autre archive ZIP', docxRefuses.autreZip(), 'pas un document Word'],
  ])('refusé : %s', (_nom, contenu, raison) => {
    const v = verifierDocx(contenu);
    expect(v.ok).toBe(false);
    expect(!v.ok && v.raison).toContain(raison);
    expect(typeReel(contenu)).toBeNull();
    const p = refus('document.docx', contenu);
    expect(p.status).toBe(415);
    expect(p.message).toContain('Enregistrez-le en .docx sans macro, ou en PDF');
  });

  it('l\'ancien format .doc est refusé, avec ce qu\'il faut faire', () => {
    const p = refus('lettre.doc', docxRefuses.ancienDoc());
    expect(p.code).toBe('TYPE_DE_FICHIER_NON_SUPPORTE');
    expect(p.message).toContain('ancien format Word (.doc)');
  });

  it('un fichier inconnu cite les types acceptés, Word compris ; 10 Mo par fichier', () => {
    expect(refus('notes.txt', Buffer.from('bonjour')).message).toContain('JPEG, PNG, WebP, PDF ou Word (.docx) attendu');
    expect(MAX_OCTETS).toBe(10 * 1024 * 1024);
  });

  it('une archive tronquée ne fait pas planter le contrôle', () => {
    const c = docx();
    expect(verifierDocx(c.subarray(0, c.length - 30)).ok).toBe(false);
    expect(verifierDocx(c.subarray(0, 10)).ok).toBe(false);
  });
});
