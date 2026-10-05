import { describe, expect, it } from 'vitest';
import {
  decisionParRegles, descriptionPourDepot, presentation, repondre, retirerCodesSecrets, SUGGESTION_CONSEILLER, SUGGESTION_DEPOT, TEXTES, texteReprise, urgenceParRegles, validerDecision,
  type ContexteAssistant, type Decision, type Echange, type Intention,
} from './assistant.js';
import { CATEGORIES_EXEMPLE, faqExemple, FAQ_EXEMPLE } from './exemples.js';
import { demandeHumain, verifierInterdits } from './interdits.js';

const ctx: ContexteAssistant = { banque: 'Banque Alpha', faq: faqExemple(), categories: CATEGORIES_EXEMPLE, ouverte: true, reprise: null };
const ferme: ContexteAssistant = { ...ctx, ouverte: false, reprise: 'lundi à 8 h' };
const client = (texte: string): Echange => ({ auteur: 'CLIENT', texte });
const decision = (intention: Intention, autres: Partial<Decision> = {}): Decision => ({ intention, faqId: null, categorieId: null, complet: false, ...autres });

describe('tri par règles, sans IA (français de Côte d\'Ivoire)', () => {
  it.each([
    ['Bonjour', 'SALUTATION', null, null],
    ['bjr', 'SALUTATION', null, null],
    ['merci', 'FIN', null, null],
    ['je veux parler à un conseiller', 'CONSEILLER', null, null],
    ['un conseiler svp', 'CONSEILLER', null, null],
    ['Quels sont vos horaires ?', 'FAQ', 'faq-1', null],
    ['vous ouvrez à quelle heure le samedi', 'FAQ', 'faq-1', null],
    ['comment activer l\'appli', 'FAQ', 'faq-5', null],
    ['quels papiers pour ouvrir un compte', 'FAQ', 'faq-4', null],
    ['où en est ma réclamation ALP-2026-000042', 'FAQ', 'faq-7', null],
    ['combien de temps pour un virement vers une autre banque ?', 'FAQ', 'faq-6', null],
    ['le GAB a avalé ma carte', 'RECLAMATION', null, 'cat-carte'],
    ['mon salaire n\'est pas tombé', 'RECLAMATION', null, 'cat-virement'],
    ['on m\'a coupé 2000 sur mon compte sans raison, c\'est pas normal hein', 'RECLAMATION', null, 'cat-frais'],
    ['il y a un retrait de 150 000 que je n\'ai pas fait hier à 23h', 'RECLAMATION', null, 'cat-fraude'],
    ['l\'application ne marche pas depuis la mise à jour', 'RECLAMATION', null, 'cat-mobile'],
    ['la caissière m\'a mal parlé à l\'agence du Plateau ce matin', 'RECLAMATION', null, 'cat-accueil'],
    ['mon échéance de crédit a été prélevée deux fois ce mois', 'RECLAMATION', null, 'cat-credit'],
    ['quelqu\'un m\'a appelé pour me demander mon code', 'RECLAMATION', null, 'cat-fraude'],
    ['Déposer une réclamation', 'RECLAMATION', null, null],
    ['il fait quel temps demain', 'HORS_SUJET', null, null],
    ['je veux investir dans quoi', 'HORS_SUJET', null, null],
    ['qsdkjqsd', 'INCOMPRIS', null, null],
  ])('%s → %s', (texte, intention, faqId, categorieId) => {
    const d = decisionParRegles([client(texte)], ctx);
    expect(d.intention).toBe(intention);
    expect(d.faqId).toBe(faqId);
    expect(d.categorieId).toBe(categorieId);
  });

  it('une réclamation est complète quand le client a donné un détail utile, sur l\'ensemble de ses messages', () => {
    expect(decisionParRegles([client('mon salaire n\'est pas tombé')], ctx).complet).toBe(false);
    const echanges: Echange[] = [
      client('mon salaire n\'est pas tombé'),
      { auteur: 'ASSISTANT', texte: '…', code: 'PRECISER' },
      client('le virement de mon employeur du 25 septembre, 350 000 F'),
    ];
    const d = decisionParRegles(echanges, ctx);
    expect(d).toMatchObject({ intention: 'RECLAMATION', categorieId: 'cat-virement', complet: true });
  });

  it('les suggestions en un toucher sont reconnues', () => {
    expect(decisionParRegles([client(SUGGESTION_CONSEILLER)], ctx).intention).toBe('CONSEILLER');
    expect(decisionParRegles([client(SUGGESTION_DEPOT)], ctx).intention).toBe('RECLAMATION');
    expect(demandeHumain(SUGGESTION_CONSEILLER)).toBe(true);
  });
});

describe('ce que l\'assistant écrit au client', () => {
  it('se présente comme un assistant automatique et dit comment joindre une personne (décision I3)', () => {
    const p = presentation('Banque Alpha').texte;
    expect(p).toMatch(/assistant automatique de Banque Alpha/);
    expect(p).toMatch(/« conseiller »/);
  });

  it('aucun de ses textes ne promet, n\'annonce de statut, ne conseille ni ne demande de code (décision I4)', () => {
    const textes: string[] = [presentation('Banque Alpha').texte, ...Object.values(TEXTES)];
    for (const c of [ctx, ferme]) {
      for (const intention of ['SALUTATION', 'FAQ', 'RECLAMATION', 'CONSEILLER', 'FIN', 'HORS_SUJET', 'INCOMPRIS'] as const) {
        for (const complet of [false, true]) {
          const r = repondre(decision(intention, { faqId: 'faq-3', categorieId: 'cat-carte', complet }), [client('ma carte')], c, true);
          textes.push(...r.messages.map((m) => m.texte));
        }
      }
    }
    for (const t of textes) expect(verifierInterdits(t), t).toEqual([]);
  });

  it('les réponses de la base d\'exemple ne déclenchent aucun interdit', () => {
    for (const f of FAQ_EXEMPLE) expect(verifierInterdits(f.reponse), f.question).toEqual([]);
  });

  it('une question fréquente : la réponse de la banque, telle quelle, puis une relance', () => {
    const r = repondre(decision('FAQ', { faqId: 'faq-1' }), [client('vos horaires ?')], ctx);
    expect(r.messages.map((m) => m.code)).toEqual(['FAQ', 'FAQ_SUITE']);
    expect(r.messages[0]!.texte).toBe(FAQ_EXEMPLE[0]!.reponse);
    expect(r.suggestions).toContain(SUGGESTION_CONSEILLER);
    expect(r.proposition).toBeNull();
  });

  it('une question fréquente inconnue est traitée comme une incompréhension', () => {
    const r = repondre(decision('FAQ', { faqId: 'faq-inventee' }), [client('?')], ctx);
    expect(r.messages[0]!.code).toBe('INCOMPRIS');
  });

  it('une réclamation incomplète : il demande des précisions ; complète : il propose le dépôt, que le client envoie lui-même', () => {
    const echanges = [client('le GAB de Cocody a avalé ma carte hier à 19h')];
    const a = repondre(decision('RECLAMATION', { categorieId: 'cat-carte' }), echanges, ctx);
    expect(a.messages[0]!.code).toBe('PRECISER');
    expect(a.messages[0]!.texte).toMatch(/Carte bancaire/);
    expect(a.proposition).toBeNull();
    const b = repondre(decision('RECLAMATION', { categorieId: 'cat-carte', complet: true }), echanges, ctx);
    expect(b.messages[0]!.code).toBe('PROPOSER_DEPOT');
    expect(b.proposition).toEqual({ motif: 'DEPOT', categorieId: 'cat-carte', description: 'le GAB de Cocody a avalé ma carte hier à 19h' });
  });

  it('le client demande un conseiller : transfert, avec la réouverture si la banque est fermée', () => {
    const ouvert = repondre(decision('CONSEILLER'), [client('mon virement'), client('conseiller')], ctx);
    expect(ouvert.messages[0]!.code).toBe('TRANSFERT');
    expect(ouvert.proposition).toEqual({ motif: 'TRANSFERT', categorieId: null, description: 'mon virement' });
    expect(ouvert.messages[0]!.texte).not.toMatch(/fermée/);
    const nuit = repondre(decision('CONSEILLER'), [client('conseiller')], ferme);
    expect(nuit.messages[0]!.texte).toMatch(/La banque est fermée : un conseiller vous répondra dès la réouverture, lundi à 8 h\./);
  });

  it('après deux incompréhensions de suite, il passe la main', () => {
    const echanges: Echange[] = [
      client('xx'), { auteur: 'ASSISTANT', texte: TEXTES.INCOMPRIS, code: 'INCOMPRIS' },
      client('yy'), { auteur: 'ASSISTANT', texte: TEXTES.HORS_SUJET, code: 'HORS_SUJET' },
      client('zz'),
    ];
    expect(repondre(decision('INCOMPRIS'), echanges, ctx).messages[0]!.code).toBe('TRANSFERT');
    expect(repondre(decision('INCOMPRIS'), echanges.slice(2), ctx).messages[0]!.code).toBe('INCOMPRIS');
    // Une réponse comprise remet le compte à zéro
    const reprise: Echange[] = [...echanges.slice(0, 2), client('bonjour'), { auteur: 'ASSISTANT', texte: TEXTES.SALUTATION, code: 'SALUTATION' }, client('zz')];
    expect(repondre(decision('INCOMPRIS'), reprise, ctx).messages[0]!.code).toBe('INCOMPRIS');
  });

  it('un code secret écrit par le client : rappel en tête, et le code ne passe pas dans la description', () => {
    const echanges = [client('ma carte est bloquée, mon code secret 1234 ne marche plus au GAB du Plateau')];
    const r = repondre(decision('RECLAMATION', { categorieId: 'cat-carte', complet: true }), echanges, ctx, true);
    expect(r.messages[0]!.code).toBe('CODE_SECRET');
    expect(r.proposition!.description).toBe('ma carte est bloquée, mon code secret [code retiré] ne marche plus au GAB du Plateau');
  });
});

describe('description proposée et décision de l\'IA', () => {
  it('la description reprend les mots du client, sans salutations ni demandes de conseiller', () => {
    const echanges: Echange[] = [
      client('Bonjour'), { auteur: 'ASSISTANT', texte: '…', code: 'SALUTATION' },
      client('mon virement de 200 000 F n\'est pas arrivé'), { auteur: 'ASSISTANT', texte: '…', code: 'PRECISER' },
      client('envoyé le 22/09 depuis Ecobank'), client('merci'), client('Parler à un conseiller'),
    ];
    expect(descriptionPourDepot(echanges)).toBe('mon virement de 200 000 F n\'est pas arrivé\nenvoyé le 22/09 depuis Ecobank');
  });

  it('une question fréquente déjà réglée n\'entre pas dans la description', () => {
    const echanges: Echange[] = [
      client('vous ouvrez à quelle heure ?'), { auteur: 'ASSISTANT', texte: '…', code: 'FAQ' }, { auteur: 'ASSISTANT', texte: '…', code: 'FAQ_SUITE' },
      client('Le GAB a avalé ma carte hier soir'), { auteur: 'ASSISTANT', texte: '…', code: 'PRECISER' }, client('au Plateau, vers 21 h'),
    ];
    expect(descriptionPourDepot(echanges)).toBe('Le GAB a avalé ma carte hier soir\nau Plateau, vers 21 h');
  });

  it('retire les codes écrits en clair, garde le reste', () => {
    expect(retirerCodesSecrets('pin: 0000 et mdp azerty12')).toBe('pin: [code retiré] et mdp [code retiré]');
    expect(retirerCodesSecrets('mon code est bloqué')).toBe('mon code est bloqué');
  });

  it('une décision venue de l\'IA est ramenée à ce que la banque connaît', () => {
    expect(validerDecision({ intention: 'FAQ', faqId: 'faq-2', categorieId: null, complet: false }, ctx)).toEqual(decision('FAQ', { faqId: 'faq-2' }));
    expect(validerDecision({ intention: 'RECLAMATION', faqId: 'faq-99', categorieId: 'cat-inconnue', complet: 'oui' }, ctx)).toEqual(decision('RECLAMATION'));
    expect(validerDecision({ intention: 'REMBOURSER' }, ctx)).toBeNull();
    expect(validerDecision('FAQ', ctx)).toBeNull();
    expect(validerDecision(null, ctx)).toBeNull();
  });
});

describe('réouverture et urgence', () => {
  const lundi = new Date('2026-10-05T08:00:00Z');
  it.each([
    ['2026-10-02T12:30:00Z', '2026-10-02T14:00:00Z', 'aujourd\'hui à 14 h'],
    ['2026-10-01T19:00:00Z', '2026-10-02T08:30:00Z', 'demain à 8 h 30'],
    ['2026-10-02T18:00:00Z', lundi.toISOString(), 'lundi à 8 h'],
    ['2026-09-20T18:00:00Z', lundi.toISOString(), 'le 05/10 à 8 h'],
  ])('%s → %s', (maintenant, reprise, attendu) => {
    expect(texteReprise(new Date(reprise), new Date(maintenant), 'Africa/Abidjan')).toBe(attendu);
  });

  it('le fuseau de la banque compte', () => {
    expect(texteReprise(new Date('2026-10-02T23:30:00Z'), new Date('2026-10-02T20:00:00Z'), 'Europe/Paris')).toBe('demain à 1 h 30');
  });

  it('urgence : fraude, vol, opération inconnue', () => {
    expect(urgenceParRegles('Un retrait de 300 000 que je n\'ai pas fait, c\'est une arnaque')).toBe(true);
    expect(urgenceParRegles('Ma carte a été volée au marché')).toBe(true);
    expect(urgenceParRegles('Le guichetier a été impoli')).toBe(false);
  });
});
