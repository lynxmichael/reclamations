import { describe, expect, it } from 'vitest';
import { doublonPossible, ECART_DOUBLON_JOURS, MESSAGES_RATTACHEMENT, refusRattachement, type ReclamationComparee } from './doublons.js';

const jour = 86_400_000;
const base: ReclamationComparee = { id: 'a', clientId: 'c1', categorieId: 'carte', statut: 'OUVERTE', creeLe: new Date('2026-09-08T09:00:00Z') };
const autre = (m: Partial<ReclamationComparee>): ReclamationComparee => ({ ...base, id: 'b', ...m });

describe('doublon possible (étape 21)', () => {
  it('même client, même catégorie, non clôturées, à moins de 30 jours d\'écart', () => {
    expect(doublonPossible(base, autre({ creeLe: new Date(base.creeLe.getTime() + 2 * jour) }))).toBe(true);
    expect(doublonPossible(autre({ statut: 'RESOLUE' }), base)).toBe(true);
  });
  it('jamais avec elle-même, ni pour un autre client ou une autre catégorie', () => {
    expect(doublonPossible(base, base)).toBe(false);
    expect(doublonPossible(base, autre({ clientId: 'c2' }))).toBe(false);
    expect(doublonPossible(base, autre({ categorieId: 'credit' }))).toBe(false);
  });
  it('une clôturée n\'est plus un doublon ; au-delà de 30 jours non plus', () => {
    expect(doublonPossible(base, autre({ statut: 'CLOTUREE' }))).toBe(false);
    expect(doublonPossible(base, autre({ creeLe: new Date(base.creeLe.getTime() - ECART_DOUBLON_JOURS * jour) }))).toBe(false);
    expect(doublonPossible(base, autre({ creeLe: new Date(base.creeLe.getTime() - (ECART_DOUBLON_JOURS * jour - 60_000)) }))).toBe(true);
  });
});

describe('rattachement : la réclamation principale', () => {
  const doublon = { id: 'd', clientId: 'c1', statut: 'EN_COURS' as const, rattacheeAId: null };
  it('du même client, en cours, et pas elle-même un doublon rattaché', () => {
    expect(refusRattachement(doublon, { id: 'p', clientId: 'c1', statut: 'RESOLUE', rattacheeAId: null })).toBeNull();
    expect(refusRattachement(doublon, { ...doublon })).toBe('MEME_RECLAMATION');
    expect(refusRattachement(doublon, { id: 'p', clientId: 'c2', statut: 'OUVERTE', rattacheeAId: null })).toBe('AUTRE_CLIENT');
    expect(refusRattachement(doublon, { id: 'p', clientId: 'c1', statut: 'CLOTUREE', rattacheeAId: null })).toBe('PRINCIPALE_CLOTUREE');
    expect(refusRattachement(doublon, { id: 'p', clientId: 'c1', statut: 'CLOTUREE', rattacheeAId: 'x' })).toBe('DEJA_RATTACHEE');
  });
  it('chaque refus a son message, en français', () => {
    for (const m of Object.values(MESSAGES_RATTACHEMENT)) expect(m).toMatch(/^[A-ZÉ]/);
  });
});
