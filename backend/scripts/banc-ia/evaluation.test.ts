import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CATEGORIES_EXEMPLE, faqExemple } from '../../src/domaine/ia/exemples.js';
import {
  centile, classer, corrigerBrouillon, corrigerTri, noteDonnees, noteTemps, rapportMarkdown, synthese,
  type CasBrouillon, type CasTri, type Corpus, type FichierFournisseurs, type ResultatBrouillon, type ResultatTri,
} from './evaluation.js';

const corpus = JSON.parse(readFileSync(resolve(__dirname, '../../banc-ia/corpus.json'), 'utf8')) as Corpus;
const fichier = JSON.parse(readFileSync(resolve(__dirname, '../../banc-ia/fournisseurs.json'), 'utf8')) as FichierFournisseurs;

describe('corpus et fournisseurs du banc (décision I6)', () => {
  it('100 échanges : 70 à trier, 30 brouillons ; 15 messages neufs de contrôle ; identifiants uniques', () => {
    expect(corpus.cas).toHaveLength(100);
    expect(corpus.cas.filter((c) => c.type === 'tri')).toHaveLength(70);
    expect(corpus.controle.cas).toHaveLength(15);
    const ids = [...corpus.cas, ...corpus.controle.cas].map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('chaque attendu désigne des questions et catégories qui existent', () => {
    const faq = new Set(faqExemple().map((f) => f.id));
    const cats = new Set<string | null>([...CATEGORIES_EXEMPLE.map((c) => c.id), null]);
    for (const c of [...corpus.cas, ...corpus.controle.cas]) {
      const attendus = c.type === 'tri' ? [c.attendu, ...(c.alternatives ?? [])] : [c.attendu];
      for (const a of attendus) {
        if ('faqId' in a && a.faqId) expect(faq.has(a.faqId), c.id).toBe(true);
        for (const x of a.categories ?? []) expect(cats.has(x), c.id).toBe(true);
      }
      if (c.type === 'brouillon') expect(cats.has(c.categorie), c.id).toBe(true);
    }
  });

  it('poids de la décision I6 ; trois candidats notés sur la même grille', () => {
    expect(fichier.ponderation).toEqual({ donnees: 30, interdits: 25, qualite: 20, cout: 15, temps: 10 });
    expect(fichier.candidats.map((c) => c.fournisseur)).toEqual(['anthropic', 'openai', 'mistral']);
    for (const c of fichier.candidats) for (const n of Object.values(c.donnees)) expect([0, 1, 2]).toContain(n.note);
  });
});

const tri = corpus.cas.find((c) => c.id === 'T16') as CasTri; // FAQ faq-2, ou réclamation carte
const brouillon = corpus.cas.find((c) => c.id === 'B03') as CasBrouillon; // fraude, urgente
const mesure = { dureeMs: 1000, jetonsEntree: 1000, jetonsSortie: 50, echec: null };
const rt = (decision: ResultatTri['decision'], o: Partial<ResultatTri> = {}): ResultatTri => ({ cas: tri, decision, ...mesure, ...o });
const rb = (texte: string, o: Partial<{ categorieId: string | null; urgente: boolean }> = {}): ResultatBrouillon =>
  ({ cas: brouillon, brouillon: { brouillon: texte, categorieId: 'cat-fraude', urgente: true, ...o }, ...mesure });

describe('correction', () => {
  it('tri : l\'attendu ou une alternative ; inexploitable compté faux', () => {
    expect(corrigerTri(rt({ intention: 'FAQ', faqId: 'faq-2', categorieId: null, complet: false })).exact).toBe(true);
    expect(corrigerTri(rt({ intention: 'RECLAMATION', faqId: null, categorieId: 'cat-carte', complet: false })).exact).toBe(true);
    expect(corrigerTri(rt({ intention: 'FAQ', faqId: 'faq-3', categorieId: null, complet: false }))).toMatchObject({ exact: false, intention: true });
    expect(corrigerTri(rt(null, { echec: 'HORS_DELAI' }))).toMatchObject({ exact: false, detail: 'réponse inexploitable (HORS_DELAI)' });
  });

  it('brouillon : interdits, forme, catégorie, urgence', () => {
    const bon = corrigerBrouillon(rb('Bonjour, nous avons bien reçu votre signalement. Nous bloquons la carte par précaution et vérifions les paiements. Cordialement.'));
    expect(bon).toMatchObject({ alertes: [], qualite: 1 });
    const promesse = corrigerBrouillon(rb('Bonjour, vous serez remboursé sous 48 heures. Cordialement.', { urgente: false }));
    expect(promesse.alertes).toEqual(['REMBOURSEMENT_PROMIS', 'DELAI_PROMIS']);
    expect(promesse.controles).toMatchObject({ forme: true, categorie: true, urgence: false });
    expect(corrigerBrouillon(rb('Ok.')).controles.forme).toBe(false);
  });
});

describe('notes et rapport', () => {
  it('temps, centile, données', () => {
    expect([noteTemps(1500), noteTemps(5000), noteTemps(9000)]).toEqual([100, 50, 0]);
    expect(centile([5, 1, 3, 2, 4], 50)).toBe(3);
    expect(centile([100, 200, 300, 400, 500, 600, 700, 800, 900, 1000], 95)).toBe(1000);
    expect(fichier.candidats.map(noteDonnees)).toEqual([70, 80, 60]);
  });

  it('coût relatif au moins cher, total pondéré, classement', () => {
    const [anthropic, openai] = fichier.candidats;
    const a = synthese('A', 'm', [rt({ intention: 'FAQ', faqId: 'faq-2', categorieId: null, complet: false })], [rb('Bonjour, merci. Nous vérifions.')], anthropic!, fichier.hypotheseMensuelle);
    const o = synthese('O', 'm', [rt({ intention: 'INCOMPRIS', faqId: null, categorieId: null, complet: false })], [rb('Bonjour, vous serez remboursé demain sans faute. Merci.')], openai!, fichier.hypotheseMensuelle);
    // 1 000 + 50 jetons, 3 000 tours et 300 brouillons : (1 000 × 1 + 50 × 5) × 3 300 / 1 000 000 = 4,13 $
    expect(a.coutMensuel).toBe(4.13);
    const [premier, second] = classer([o, a], fichier.ponderation);
    expect(second!.notes.cout).toBe(100);
    expect(premier!.notes.cout).toBeLessThan(100);
    expect(a.notes).toMatchObject({ donnees: 70, interdits: 100, qualite: 100, temps: 100 });
    expect(o.notes).toMatchObject({ interdits: 0 });
    const total = (n: typeof a.notes, cout: number) => Math.round(((n.donnees! * 30 + n.interdits * 25 + n.qualite * 20 + cout * 15 + n.temps! * 10) / 100) * 10) / 10;
    expect(classer([a], fichier.ponderation)[0]!.notes.total).toBe(total(a.notes, 100));
    const md = rapportMarkdown({
      date: '2 octobre 2026', corpus, fournisseurs: fichier, classement: classer([a, o], fichier.ponderation), regles: a, nonTestes: [fichier.candidats[2]!],
      details: new Map([['A', { tris: a ? [rt(null, { echec: 'ERREUR' })] : [], brouillons: [rb('Bonjour, vous serez remboursé demain sans faute. Merci.')], neufs: [] }]]),
    });
    expect(md).toContain('| Fournisseur | Modèle | Données (30) | Interdits (25) | Qualité (20) | Coût (15) | Temps (10) | **Total** |');
    expect(md).toContain('Non essayés (pas de clé d\'API fournie) : Mistral AI (Mistral Small 4)');
    expect(md).toContain('⚠ promet un remboursement, promet un délai');
    expect(md).toContain('réponse inexploitable (ERREUR)');
  });
});
