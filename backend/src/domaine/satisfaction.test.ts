import { describe, expect, it } from 'vitest';
import {
  bilanAvis, categorieNps, clotureAvecEnquete, estSatisfait, etatAvis, finEnquete, normaliserReponse, nps,
} from './satisfaction.js';

const T0 = new Date('2026-10-01T09:00:00Z');

describe('enquête de satisfaction : règles', () => {
  it('ouverte à la clôture confirmée ou automatique, jamais à une clôture forcée', () => {
    expect(clotureAvecEnquete('CONFIRMATION_CLIENT')).toBe(true);
    expect(clotureAvecEnquete('AUTOMATIQUE')).toBe(true);
    expect(clotureAvecEnquete('FORCEE')).toBe(false);
  });

  it('7 jours pour répondre, fin incluse ; une réponse donnée le reste', () => {
    const fin = finEnquete(T0);
    expect(fin.toISOString()).toBe('2026-10-08T09:00:00.000Z');
    expect(etatAvis({ reponduLe: null, expireLe: fin }, T0)).toBe('A_DONNER');
    expect(etatAvis({ reponduLe: null, expireLe: fin }, fin)).toBe('A_DONNER');
    expect(etatAvis({ reponduLe: null, expireLe: fin }, new Date(fin.getTime() + 1))).toBe('TERMINE');
    expect(etatAvis({ reponduLe: T0, expireLe: fin }, new Date(fin.getTime() + 1))).toBe('DONNE');
  });

  it('réponse : notes bornées, commentaire blanc absent, 1000 caractères au plus', () => {
    expect(normaliserReponse({ note: 4, recommandation: 9, commentaire: '  Merci  ' })).toEqual({ note: 4, recommandation: 9, commentaire: 'Merci' });
    expect(normaliserReponse({ note: 5, recommandation: 0, commentaire: '   ' })).toEqual({ note: 5, recommandation: 0, commentaire: null });
    expect(normaliserReponse({ note: 1, recommandation: 10 })).toEqual({ note: 1, recommandation: 10, commentaire: null });
    for (const r of [{ note: 0, recommandation: 5 }, { note: 6, recommandation: 5 }, { note: 3.5, recommandation: 5 }, { note: 3, recommandation: 11 }, { note: 3, recommandation: -1 }]) {
      expect(typeof normaliserReponse(r)).toBe('string');
    }
    expect(typeof normaliserReponse({ note: 3, recommandation: 5, commentaire: 'x'.repeat(1001) })).toBe('string');
  });

  it('NPS : promoteurs (9-10) moins détracteurs (0-6), de -100 à 100 ; CSAT : notes 4 et 5', () => {
    expect([0, 6, 7, 8, 9, 10].map(categorieNps)).toEqual(['DETRACTEUR', 'DETRACTEUR', 'PASSIF', 'PASSIF', 'PROMOTEUR', 'PROMOTEUR']);
    expect([1, 3, 4, 5].map(estSatisfait)).toEqual([false, false, true, true]);
    expect(nps(0, 0, 0)).toBeNull();
    expect(nps(10, 0, 10)).toBe(100);
    expect(nps(0, 10, 10)).toBe(-100);
    expect(nps(5, 2, 10)).toBe(30);
    expect(nps(1, 0, 3)).toBe(33);
    const b = bilanAvis([{ note: 5, recommandation: 10 }, { note: 4, recommandation: 8 }, { note: 2, recommandation: 3 }, { note: 1, recommandation: 9 }]);
    expect(b).toEqual({ reponses: 4, satisfaits: 2, promoteurs: 2, passifs: 1, detracteurs: 1, sommeNotes: 12 });
    expect(nps(b.promoteurs, b.detracteurs, b.reponses)).toBe(25);
  });
});
