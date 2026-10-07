import { describe, expect, it } from 'vitest';
import type { CommentaireMois, EntreeAnalyse, MesuresMois } from '../barometre.js';
import { consignesBarometre, COMMENTAIRES_IA_MAX } from './barometre.js';
import { masquer } from './masquage.js';

const mesures: MesuresMois = {
  reclamations: 120, urgentes: 6, resolues: 100, tauxRespectSla: 0.82, tauxPremierContact: 0.45, delaiResolutionMoyenMinutes: 720,
  contestees: 7, enquetes: 90, tauxReponse: 0.42, reponses: 38, tauxSatisfaits: 0.71, noteMoyenne: 3.9, nps: 12,
};
const carte = {
  cle: 'id-carte', libelle: 'Carte bancaire', reclamations: 42, precedent: 25, resolues: 35, horsDelai: 9, contestees: 4, reponses: 12, insatisfaits: 6, score: 61,
};
const entree: EntreeAnalyse = {
  banque: 'Banque Alpha', mois: '2026-09', mesures, precedent: { ...mesures, reclamations: 98 }, categories: [carte],
  agences: [{ ...carte, cle: 'id-plateau', libelle: 'Plateau' }], themes: [], enqueteActive: true, smsChaqueChangementStatut: false,
};
const originaux: CommentaireMois[] = [
  { numero: 'ALP-2026-000101', note: 1, recommandation: 2, texte: 'Trois semaines sans nouvelles, appelez-moi au 07 08 09 10 11' },
  { numero: 'ALP-2026-000102', note: 2, recommandation: 4, texte: 'Le GAB du Plateau a avalé ma carte, personne ne rappelle' },
  { numero: 'ALP-2026-000103', note: 5, recommandation: 10, texte: 'Très bon accueil, merci à la conseillère' },
];
const masques = originaux.map((c) => ({ ...c, texte: masquer(c.texte).texte }));

describe('analyse du baromètre par l\'IA (étape 23)', () => {
  it('consignes : chiffres agrégés, catégories en identifiants courts, commentaires masqués et numérotés', () => {
    const c = consignesBarometre(entree, masques, originaux);
    expect(c.utilisateur).toContain('Baromètre de septembre 2026.');
    expect(c.utilisateur).toContain('- C1 « Carte bancaire » : 42 réclamations (mois précédent : 25)');
    expect(c.utilisateur).toContain('- A1 « Plateau »');
    expect(c.utilisateur).toContain('[1] (1/5) Trois semaines sans nouvelles, appelez-moi au [TELEPHONE]');
    expect(c.utilisateur).not.toContain('07 08 09 10 11');
    expect(c.utilisateur).not.toContain('id-carte');
    expect(c.utilisateur).not.toContain('ALP-2026');
    expect(c.systeme).toContain('N\'invente aucun chiffre');
    expect(c.systeme).toContain('Ne nomme aucune personne');
    // 60 commentaires au plus, raccourcis
    const beaucoup = Array.from({ length: 80 }, (_, i) => ({ ...originaux[0]!, numero: `N${i}`, texte: `Commentaire ${'a'.repeat(400)}` }));
    const cb = consignesBarometre(entree, beaucoup);
    expect(cb.utilisateur.match(/^\[\d+\]/gm)).toHaveLength(COMMENTAIRES_IA_MAX);
    expect(cb.utilisateur).toContain('…');
  });

  it('traduire : thèmes comptés sur les vrais commentaires, catégorie traduite, exemples non masqués', () => {
    const c = consignesBarometre(entree, masques, originaux);
    const r = c.traduire({
      themes: [
        { titre: 'Attente et suivi', commentaires: [1, 2, 2, 9] },
        { titre: 'Accueil en agence', commentaires: [3] },
        { titre: 'Thème vide', commentaires: [] },
      ],
      recommandations: [{
        titre: 'Accélérer les réclamations carte bancaire',
        constat: '9 réclamations « Carte bancaire » sur 35 résolues l\'ont été hors délai.',
        action: 'Renforcer l\'équipe monétique le temps de résorber le retard.',
        categorieId: 'C1', priorite: 'HAUTE',
      }],
    });
    expect(r!.themes.map((t) => [t.libelle, t.mentions, t.negatifs, t.positifs])).toEqual([['Attente et suivi', 2, 2, 0], ['Accueil en agence', 1, 0, 1]]);
    expect(r!.themes[0]!.exemples[0]!.texte).toContain('07 08 09 10 11');
    expect(r!.recommandations).toEqual([{
      titre: 'Accélérer les réclamations carte bancaire',
      constat: '9 réclamations « Carte bancaire » sur 35 résolues l\'ont été hors délai.',
      action: 'Renforcer l\'équipe monétique le temps de résorber le retard.',
      categorieId: 'id-carte', priorite: 'HAUTE',
    }]);
  });

  it('traduire : chiffre inventé, étiquette de masquage ou format faux écartés ; rien de valable → règles', () => {
    const c = consignesBarometre(entree, masques, originaux);
    const reco = (constat: string, o: Record<string, unknown> = {}) => ({ titre: 'Rappeler les clients insatisfaits', constat, action: 'Appeler chaque client insatisfait cette semaine.', categorieId: null, priorite: 'MOYENNE', ...o });
    expect(c.traduire({ themes: [], recommandations: [reco('Le NPS a perdu 47 points ce mois-ci.')] })).toBeNull();
    expect(c.traduire({ themes: [], recommandations: [reco('Le client [NOM] attend depuis longtemps.')] })).toBeNull();
    expect(c.traduire({ themes: [], recommandations: [reco('Les clients insatisfaits attendent un appel.', { priorite: 'URGENTE' })] })).toBeNull();
    expect(c.traduire({ themes: [], recommandations: [] })).toBeNull();
    expect(c.traduire('texte libre')).toBeNull();
    // Un identifiant de catégorie inconnu : pas de catégorie
    const r = c.traduire({ themes: [], recommandations: [reco('NPS de 12 ce mois-ci, 38 réponses.', { categorieId: 'C9' })] });
    expect(r!.recommandations[0]!.categorieId).toBeNull();
  });
});
