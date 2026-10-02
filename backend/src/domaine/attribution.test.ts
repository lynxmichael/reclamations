import { describe, expect, it } from 'vitest';
import { choisirAgent, ensemblesCandidats, estAbsent, plusDisponible, type AgentDisponible, type Groupe } from './attribution.js';

const agent = (id: string, aTraiter: number, derniere: string | null = null, nom = id): AgentDisponible =>
  ({ id, nom, aTraiter, derniereAttributionLe: derniere ? new Date(derniere) : null });
const disponibles = (...a: AgentDisponible[]) => new Map(a.map((x) => [x.id, x]));

const CARTES: Groupe = { id: 'g-cartes', nom: 'Cartes', membres: ['aya', 'mamadou', 'ibrahim'] };
const PLATEAU: Groupe = { id: 'g-plateau', nom: 'Plateau', membres: ['mamadou', 'adjoua'] };

describe('attribution automatique : règles', () => {
  it('candidats : groupe de la catégorie ∩ groupe de l\'agence, puis la catégorie, puis l\'agence', () => {
    expect(ensemblesCandidats(CARTES, PLATEAU).map((e) => e.agents)).toEqual([['mamadou'], CARTES.membres, PLATEAU.membres]);
    expect(ensemblesCandidats(CARTES, null).map((e) => e.groupe.nom)).toEqual(['Cartes']);
    expect(ensemblesCandidats(null, PLATEAU).map((e) => e.groupe.nom)).toEqual(['Plateau']);
    expect(ensemblesCandidats(CARTES, CARTES).map((e) => e.groupe.nom)).toEqual(['Cartes']);
    expect(ensemblesCandidats(null, null)).toEqual([]);
  });

  it('le moins chargé ; à égalité, celui qui n\'a rien reçu depuis le plus longtemps, puis l\'ordre alphabétique', () => {
    expect(plusDisponible([agent('aya', 3), agent('mamadou', 1), agent('ibrahim', 2)])!.id).toBe('mamadou');
    expect(plusDisponible([agent('aya', 1, '2026-10-02T09:00:00Z'), agent('mamadou', 1, '2026-10-01T16:00:00Z')])!.id).toBe('mamadou');
    expect(plusDisponible([agent('aya', 1, '2026-10-02T09:00:00Z'), agent('ibrahim', 1, null)])!.id).toBe('ibrahim');
    expect(plusDisponible([agent('b', 0, null, 'Mamadou Traoré'), agent('a', 0, null, 'Aya Konan')])!.nom).toBe('Aya Konan');
    expect(plusDisponible([])).toBeNull();
  });

  it('un agent absent ou désactivé n\'est pas disponible : on passe au suivant, puis au groupe suivant', () => {
    // Mamadou (seul dans les deux groupes) est absent : groupe de la catégorie
    const c1 = choisirAgent(CARTES, PLATEAU, disponibles(agent('aya', 2), agent('ibrahim', 1), agent('adjoua', 0)));
    expect(c1).toMatchObject({ agent: { id: 'ibrahim' }, groupe: { nom: 'Cartes' } });
    // Tout le groupe Cartes absent : groupe de l'agence
    expect(choisirAgent(CARTES, PLATEAU, disponibles(agent('adjoua', 4)))).toMatchObject({ agent: { id: 'adjoua' }, groupe: { nom: 'Plateau' } });
    // Personne : la file « Reçues »
    expect(choisirAgent(CARTES, PLATEAU, disponibles())).toBeNull();
    expect(choisirAgent(null, null, disponibles(agent('aya', 0)))).toBeNull();
  });

  it('absences : jours inclus', () => {
    const absences = [{ du: '2026-10-05', au: '2026-10-09' }];
    expect(['2026-10-04', '2026-10-05', '2026-10-09', '2026-10-10'].map((j) => estAbsent(absences, j))).toEqual([false, true, true, false]);
  });
});
