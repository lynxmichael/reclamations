import { describe, expect, it } from 'vitest';
import {
  decalerMois, deMois, faitsMarquants, irritants, libelleMois, moisJusqua, nombresCites, peuDeReponses, recommandationsParRegles, scoreIrritant, themesParRegles,
  type CommentaireMois, type ComptesIrritant, type EntreeAnalyse, type MesuresMois,
} from './barometre.js';

const mesures = (m: Partial<MesuresMois> = {}): MesuresMois => ({
  reclamations: 100, urgentes: 5, resolues: 90, tauxRespectSla: 0.85, tauxPremierContact: 0.5, delaiResolutionMoyenMinutes: 600,
  contestees: 4, enquetes: 80, tauxReponse: 0.4, reponses: 40, tauxSatisfaits: 0.75, noteMoyenne: 4, nps: 20, ...m,
});
const ligne = (cle: string, c: Partial<ComptesIrritant> = {}): ComptesIrritant => ({
  cle, libelle: cle, reclamations: 10, precedent: 10, resolues: 10, horsDelai: 0, contestees: 0, reponses: 0, insatisfaits: 0, ...c,
});
const avis = (texte: string, note: number, numero = 'ALP-2026-000001'): CommentaireMois => ({ numero, note, recommandation: note * 2, texte });

describe('baromètre mensuel (étape 23)', () => {
  it('mois : libellé, décalage, six derniers mois', () => {
    expect(libelleMois('2026-09')).toBe('septembre 2026');
    expect(libelleMois('2026-08')).toBe('août 2026');
    expect([deMois('2026-08'), deMois('2026-04'), deMois('2026-10'), deMois('2026-09')]).toEqual(['d\'août 2026', 'd\'avril 2026', 'd\'octobre 2026', 'de septembre 2026']);
    expect(decalerMois('2026-01', -1)).toBe('2025-12');
    expect(decalerMois('2025-12', 1)).toBe('2026-01');
    expect(moisJusqua('2026-02')).toEqual(['2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02']);
    expect(peuDeReponses({ reponses: 29 })).toBe(true);
    expect(peuDeReponses({ reponses: 30 })).toBe(false);
  });

  it('irritants : une réclamation compte 1, plus hors délai, contestée, client insatisfait ; 3 réclamations au moins', () => {
    expect(scoreIrritant(ligne('x', { reclamations: 10, horsDelai: 3, contestees: 2, insatisfaits: 4 }))).toBe(19);
    const r = irritants([
      ligne('Carte', { reclamations: 20, horsDelai: 6 }),
      ligne('Frais', { reclamations: 24 }),
      ligne('Crédit', { reclamations: 2, horsDelai: 2, contestees: 2 }),
      ligne('Virement', { reclamations: 20, horsDelai: 6 }),
    ]);
    expect(r.map((x) => [x.cle, x.score])).toEqual([['Carte', 26], ['Virement', 26], ['Frais', 24]]);
    expect(irritants(Array.from({ length: 8 }, (_, i) => ligne(`c${i}`)))).toHaveLength(5);
  });

  it('thèmes par mots-clés : mentions, tonalité, exemples les plus parlants, raccourcis', () => {
    const t = themesParRegles([
      avis('Trop long, trois semaines sans nouvelles de mon dossier', 1, 'A-1'),
      avis('Le délai était correct, merci', 5, 'A-2'),
      avis('Personne ne m\'a informé, j\'ai dû relancer', 2, 'A-3'),
      avis('Frais prélevés deux fois sur mon compte', 2, 'A-4'),
      avis('x'.repeat(400) + ' attente', 3, 'A-5'),
    ]);
    const delai = t.find((x) => x.libelle === 'Délais de traitement')!;
    expect(delai).toMatchObject({ mentions: 4, negatifs: 3, positifs: 1 });
    expect(delai.exemples.map((e) => e.numero)).toEqual(['A-1', 'A-3']);
    expect(t.find((x) => x.libelle === 'Information et suivi du dossier')).toMatchObject({ mentions: 2, negatifs: 2 });
    expect(t.find((x) => x.libelle === 'Frais et prélèvements')).toMatchObject({ mentions: 1 });
    const long = themesParRegles([avis('x'.repeat(400) + ' attente', 3)])[0]!.exemples[0]!.texte;
    expect(long.length).toBeLessThanOrEqual(240);
    expect(long.endsWith('…')).toBe(true);
    expect(t[0]!.libelle).toBe('Délais de traitement');
    expect(themesParRegles([])).toEqual([]);
    // Deux clients qui écrivent la même phrase : un seul exemple
    const memes = themesParRegles([avis('Trop long', 2, 'B-1'), avis('Trop long', 2, 'B-2'), avis('Attente trop longue', 1, 'B-3')])[0]!;
    expect([memes.mentions, memes.exemples.map((e) => e.numero)]).toEqual([3, ['B-3', 'B-1']]);
  });

  it('faits marquants : seulement ce qui a nettement bougé, avec assez de données', () => {
    const p = mesures();
    expect(faitsMarquants(mesures(), p, [])).toEqual([]);
    expect(faitsMarquants(mesures(), null, [])).toEqual([]);
    const f = faitsMarquants(mesures({ reclamations: 130, tauxRespectSla: 0.75, tauxSatisfaits: 0.85, nps: 35 }), p,
      [{ ...ligne('Carte', { reclamations: 30, precedent: 12 }), score: 30 }]);
    expect(f).toEqual([
      { sens: 'MOINS_BIEN', texte: 'Réclamations reçues : 130 (+30 %)' },
      { sens: 'MOINS_BIEN', texte: 'Délais respectés : 75 % (-10 points sur le mois précédent)' },
      { sens: 'MIEUX', texte: 'Clients satisfaits : 85 % (+10 points sur le mois précédent)' },
      { sens: 'MIEUX', texte: 'NPS : +35 (+15 sur le mois précédent)' },
      { sens: 'MOINS_BIEN', texte: '« Carte » : 30 réclamations, contre 12 le mois précédent' },
    ]);
    // Trop peu de réponses : la satisfaction ne fait pas un fait marquant
    expect(faitsMarquants(mesures({ reponses: 5, tauxSatisfaits: 1 }), mesures({ reponses: 5, tauxSatisfaits: 0.2 }), [])).toEqual([]);
  });

  const entree = (e: Partial<EntreeAnalyse> = {}): EntreeAnalyse => ({
    banque: 'Banque Alpha', mois: '2026-09', mesures: mesures(), precedent: mesures(), categories: [], agences: [], themes: [],
    enqueteActive: true, smsChaqueChangementStatut: false, ...e,
  });

  it('recommandations par règles : appuyées sur un chiffre, les plus urgentes d\'abord, 2 au plus par catégorie, 5 au plus', () => {
    const carte = { ...ligne('cat-carte', { libelle: 'Carte bancaire', reclamations: 30, precedent: 12, resolues: 20, horsDelai: 8, contestees: 4, reponses: 10, insatisfaits: 6 }), score: 48 };
    const r = recommandationsParRegles(entree({ categories: [carte] }));
    expect(r.map((x) => [x.titre, x.priorite, x.categorieId])).toEqual([
      ['Traiter plus vite les réclamations « Carte bancaire »', 'HAUTE', 'cat-carte'],
      ['Répondre du premier coup sur « Carte bancaire »', 'HAUTE', 'cat-carte'],
    ]);
    expect(r[0]!.constat).toBe('8 réclamations sur 20 résolues ce mois-ci l\'ont été hors délai (60 % dans les délais).');
    // Sans enquête : la mesurer
    expect(recommandationsParRegles(entree({ enqueteActive: false })).map((x) => x.titre)).toEqual(['Mesurer la satisfaction des clients']);
    // Peu de réponses à l'enquête
    expect(recommandationsParRegles(entree({ mesures: mesures({ enquetes: 50, tauxReponse: 0.1 }) }))[0]!.constat)
      .toBe('10 % des clients ont répondu à l\'enquête de satisfaction terminée ce mois-ci.');
    // Plusieurs catégories : 5 au plus
    const beaucoup = Array.from({ length: 4 }, (_, i) => ({ ...carte, cle: `c${i}`, libelle: `Catégorie ${i}` }));
    expect(recommandationsParRegles(entree({ categories: beaucoup }))).toHaveLength(5);
  });

  it('recommandations par règles : information et accueil selon les commentaires, agence la plus en retard', () => {
    const information = { libelle: 'Information et suivi du dossier', mentions: 5, negatifs: 4, positifs: 1, exemples: [] };
    const accueil = { libelle: 'Accueil et écoute', mentions: 3, negatifs: 3, positifs: 0, exemples: [] };
    const sans = recommandationsParRegles(entree({ themes: [information, accueil] }));
    expect(sans.map((x) => x.titre)).toEqual(['Informer les clients à chaque étape', 'Travailler l\'accueil et l\'écoute']);
    expect(sans[0]!.action).toContain('Activer « SMS à chaque changement de statut »');
    expect(recommandationsParRegles(entree({ themes: [information], smsChaqueChangementStatut: true }))[0]!.action).not.toContain('Activer');
    const agences = [
      { ...ligne('a1', { libelle: 'Plateau', resolues: 10, horsDelai: 3 }), score: 13 },
      { ...ligne('a2', { libelle: 'Bouaké Commerce', resolues: 10, horsDelai: 5 }), score: 15 },
    ];
    expect(recommandationsParRegles(entree({ agences }))[0]).toMatchObject({ titre: 'Soutenir l\'agence Bouaké Commerce', categorieId: null });
    // Une seule réclamation hors délai : au singulier
    expect(recommandationsParRegles(entree({ agences: [{ ...ligne('a3', { libelle: 'Plateau', resolues: 5, horsDelai: 1 }), score: 6 }] }))[0]!.constat)
      .toBe('1 réclamation sur 5 résolues à l\'agence Plateau l\'a été hors délai.');
  });

  it('nombres cités dans un texte', () => {
    expect(nombresCites('87 % des 1 200 réclamations, note 3,5 sur 5')).toEqual(['87', '1200', '3.5', '5']);
    expect(nombresCites('Aucun chiffre')).toEqual([]);
  });
});
