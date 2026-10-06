import { describe, expect, it } from 'vitest';
import {
  canalDuFil, DESCRIPTION_MIN, estNon, estNouvelle, estOui, estSatisfait, fenetreOuverte, finFenetre, nomValide, numeroChoisi, SESSION_VIDE,
  SUITE_RESOLUTION, TEXTES_CANAL, texteAccuse, texteCategories, texteChoix, traiter,
  type DecisionRequise, type EntreeCanal, type Issue, type ReclamationDuClient, type Session,
} from './canaux.js';
import { versGsm } from './sms.js';
import type { Decision } from './ia/assistant.js';

const CATEGORIES = [
  { id: 'carte', nom: 'Carte bancaire', description: 'Retrait, paiement, carte bloquée ou avalée' },
  { id: 'virement', nom: 'Virement et transfert', description: 'Virement non reçu ou en retard' },
  { id: 'frais', nom: 'Frais et prélèvements', description: 'Frais contestés, prélèvement non autorisé' },
];
const FAQ = [{ id: 'horaires', question: 'Quels sont vos horaires ?', reponse: 'Nos agences sont ouvertes de 8 h à 17 h 30, du lundi au vendredi.' }];

const ouverte = (id: string, numero: string, statut: ReclamationDuClient['statut'] = 'EN_COURS', categorie = 'Carte bancaire'): ReclamationDuClient =>
  ({ id, numero, categorie, statut });

function entree(texte: string, o: Partial<EntreeCanal> = {}): EntreeCanal {
  return {
    canal: 'WHATSAPP', texte, medias: [], session: SESSION_VIDE, reclamations: [], categories: CATEGORIES, faq: FAQ,
    assistant: false, nomConnu: true, banque: 'Banque Alpha', lienPolitique: 'https://alpha.example/politique-donnees', reprise: null, ...o,
  };
}

const issue = (r: Issue | DecisionRequise): Issue => {
  if ('decisionRequise' in r && r.decisionRequise) throw new Error('décision attendue');
  return r as Issue;
};

/** Un dialogue : chaque message repart de la session laissée par le précédent. */
function dialogue(messages: string[], o: Partial<EntreeCanal> = {}): Issue[] {
  let session: Session = o.session ?? SESSION_VIDE;
  return messages.map((m) => {
    const r = issue(traiter(entree(m, { ...o, session })));
    session = r.session;
    return r;
  });
}

const decision = (d: Partial<Decision>): Decision => ({ intention: 'INCOMPRIS', faqId: null, categorieId: null, complet: false, ...d });

describe('lecture des réponses du client', () => {
  it('OUI, NON, NOUVELLE, un numéro, un nom', () => {
    for (const t of ['oui', 'OUI', 'Oui.', 'ok', 'd\'accord', 'c\'est bon', 'C\'est réglé !', 'Oui merci', 'ok, merci beaucoup']) expect(estOui(t), t).toBe(true);
    for (const t of ['Merci !', 'merci beaucoup', 'Parfait', 'oui merci']) expect(estSatisfait(t), t).toBe(true);
    for (const t of ['merci mais non', 'Toujours rien']) expect(estSatisfait(t), t).toBe(false);
    for (const t of ['oui mais non', 'pas du tout', '']) expect(estOui(t), t).toBe(false);
    for (const t of ['non', 'NON', 'annuler', 'Stop']) expect(estNon(t), t).toBe(true);
    for (const t of ['nouvelle', 'NOUVELLE', 'nouvelle réclamation']) expect(estNouvelle(t), t).toBe(true);
    expect(numeroChoisi('2')).toBe(2);
    expect(numeroChoisi('n°3')).toBe(3);
    expect(numeroChoisi('le 1')).toBe(1);
    expect(numeroChoisi('2 virements')).toBeNull();
    expect(nomValide('  Moussa   Koné ')).toBe('Moussa Koné');
    expect(nomValide('0707070707')).toBeNull();
    expect(nomValide('?')).toBeNull();
  });
});

describe('sans réclamation en cours, sans assistant : un dépôt préparé avec le client', () => {
  it('« Bonjour » : accueil ; la description, la catégorie déduite, OUI : la réclamation part', () => {
    const [accueil, description, oui] = dialogue([
      'Bonjour',
      'Le distributeur a avalé ma carte hier soir au Plateau, et il ne m\'a pas rendu les 20 000 FCFA.',
      'oui',
    ]);
    expect(accueil.reponses).toEqual([TEXTES_CANAL.ACCUEIL('Banque Alpha')]);
    expect(accueil.session.etape).toBe('DESCRIPTION');
    expect(description.session.etape).toBe('CONFIRMATION');
    expect(description.reponses[0]).toContain('- Sujet : Carte bancaire');
    expect(description.reponses[0]).toContain('https://alpha.example/politique-donnees');
    expect(oui.action).toEqual({
      type: 'DEPOSER', categorieId: 'carte', nom: null, medias: [],
      description: 'Le distributeur a avalé ma carte hier soir au Plateau, et il ne m\'a pas rendu les 20 000 FCFA.',
    });
    expect(oui.reponses).toEqual([]);
    expect(oui.session).toEqual(SESSION_VIDE);
  });

  it('un premier message qui décrit déjà : la proposition tout de suite, sans accueil', () => {
    const [r] = dialogue(['Mon virement de salaire du 25 n\'est toujours pas arrivé sur mon compte']);
    expect(r.reponses).toHaveLength(1);
    expect(r.reponses[0]).toContain('Virement et transfert');
  });

  it('trop court : des précisions ; catégorie introuvable : la liste, choisie par son numéro', () => {
    const [accueil, court, flou, choix] = dialogue(['Bonjour', 'Un souci', 'Il y a un problème sur mon compte depuis lundi dernier', '3']);
    expect(accueil.session.etape).toBe('DESCRIPTION');
    expect(court.reponses).toEqual([TEXTES_CANAL.PRECISER]);
    expect(flou.session.etape).toBe('CATEGORIE');
    expect(flou.reponses).toEqual([texteCategories(CATEGORIES)]);
    expect(choix.session.etape).toBe('CONFIRMATION');
    expect(choix.session.donnees.categorieId).toBe('frais');
    // Ce qu'il a écrit trop court reste dans la description
    expect(choix.session.donnees.description).toBe('Un souci\nIl y a un problème sur mon compte depuis lundi dernier');
  });

  it('à la proposition : un complément s\'ajoute, « sujet » change la catégorie, NON annule', () => {
    const debut = dialogue(['Mon virement de salaire du 25 n\'est toujours pas arrivé']);
    const [complement, sujet, choix, non] = dialogue(['C\'était un virement de 350 000 FCFA', 'sujet', '1', 'non'], { session: debut[0]!.session });
    expect(complement.session.donnees.description).toBe('Mon virement de salaire du 25 n\'est toujours pas arrivé\nC\'était un virement de 350 000 FCFA');
    expect(complement.session.etape).toBe('CONFIRMATION');
    expect(sujet.session.etape).toBe('CATEGORIE');
    expect(choix.session.donnees.categorieId).toBe('carte');
    expect(non.reponses).toEqual([TEXTES_CANAL.ANNULE]);
    expect(non.session).toEqual(SESSION_VIDE);
  });

  it('client inconnu : son nom est demandé après OUI, puis la réclamation part avec', () => {
    const r = dialogue(['Mon virement de salaire du 25 n\'est toujours pas arrivé', 'OUI', '0707', 'Moussa Koné'], { nomConnu: false });
    expect(r[1]!.reponses).toEqual([TEXTES_CANAL.NOM]);
    expect(r[2]!.reponses).toEqual([TEXTES_CANAL.NOM_INVALIDE]);
    expect(r[3]!.action).toMatchObject({ type: 'DEPOSER', nom: 'Moussa Koné', categorieId: 'virement' });
  });

  it('un code secret n\'entre jamais dans la description', () => {
    const [r] = dialogue(['Mon virement n\'est pas arrivé, mon code secret est 4589 si besoin']);
    expect(r.session.donnees.description).toContain('[code retiré]');
    expect(r.session.donnees.description).not.toContain('4589');
  });

  it('les photos reçues pendant la préparation partent avec la réclamation (5 au plus)', () => {
    const photo = (n: number) => ({ id: `media-${n}`, typeMime: 'image/jpeg', nom: null });
    const debut = issue(traiter(entree('Bonjour')));
    const r = issue(traiter(entree('Le distributeur a avalé ma carte hier soir au Plateau', { session: debut.session, medias: [1, 2, 3, 4, 5, 6].map(photo) })));
    const oui = issue(traiter(entree('oui', { session: r.session })));
    expect(oui.action.type === 'DEPOSER' && oui.action.medias.map((m) => m.id)).toEqual(['media-1', 'media-2', 'media-3', 'media-4', 'media-5']);
  });
});

describe('avec des réclamations en cours', () => {
  it('une seule : le message y entre ; l\'accueil une fois, avec la réouverture si la banque est fermée', () => {
    const a = ouverte('a', 'ALP-2026-000001');
    const [premier, second] = dialogue(['J\'ai gardé le ticket du distributeur', 'Il est daté de 21 h 04'], { reclamations: [a], reprise: 'demain a 8 h' });
    expect(premier.action).toEqual({ type: 'RATTACHER', reclamationId: 'a', texte: 'J\'ai gardé le ticket du distributeur', medias: [] });
    expect(premier.reponses[0]).toContain('ALP-2026-000001');
    expect(premier.reponses[0]).toContain('demain a 8 h');
    expect(second.action).toMatchObject({ type: 'RATTACHER', reclamationId: 'a' });
    expect(second.reponses).toEqual([]);
  });

  it('plusieurs : il choisit par le numéro, son message va à celle choisie ; 0 en commence une nouvelle', () => {
    const a = ouverte('a', 'ALP-2026-000001');
    const b = ouverte('b', 'ALP-2026-000002', 'OUVERTE', 'Virement et transfert');
    const [question, choix, suite] = dialogue(['Des nouvelles ?', '2', 'Merci'], { reclamations: [a, b] });
    expect(question.reponses).toEqual([texteChoix([a, b])]);
    expect(question.session.etape).toBe('CHOIX');
    expect(choix.action).toEqual({ type: 'RATTACHER', reclamationId: 'b', texte: 'Des nouvelles ?', medias: [] });
    expect(suite.action).toMatchObject({ type: 'RATTACHER', reclamationId: 'b', texte: 'Merci' });
    const [, zero] = dialogue(['Le distributeur m\'a encore avalé ma carte ce matin à Cocody', '0'], { reclamations: [a, b] });
    expect(zero.session.etape).toBe('CONFIRMATION');
    expect(zero.session.donnees.description).toBe('Le distributeur m\'a encore avalé ma carte ce matin à Cocody');
  });

  it('un numéro inconnu : la question revient', () => {
    const r = dialogue(['Bonjour', '7'], { reclamations: [ouverte('a', 'A-1'), ouverte('b', 'B-2')] });
    expect(r[1]!.session.etape).toBe('CHOIX');
    expect(r[1]!.action.type).toBe('AUCUNE');
  });

  it('« NOUVELLE » : un nouveau dépôt, même avec une réclamation en cours', () => {
    const [r] = dialogue(['nouvelle'], { reclamations: [ouverte('a', 'A-1')] });
    expect(r.reponses).toEqual([TEXTES_CANAL.NOUVELLE]);
    expect(r.session.etape).toBe('DESCRIPTION');
  });

  it('résolue : OUI la clôture (sans réponse automatique : la clôture part dans le fil), autre chose la conteste', () => {
    const r = ouverte('r', 'ALP-2026-000009', 'RESOLUE');
    const [oui] = dialogue(['Oui merci'], { reclamations: [r] });
    expect(oui).toMatchObject({ action: { type: 'CONFIRMER', reclamationId: 'r' }, reponses: [], issue: 'CONFIRMATION' });
    const [non] = dialogue(['Toujours pas remboursé'], { reclamations: [r] });
    expect(non.action).toEqual({ type: 'CONTESTER', reclamationId: 'r', motif: 'Toujours pas remboursé' });
    expect(non.reponses[0]).toContain('rouverte');
    const [photo] = dialogue([''], { reclamations: [r], medias: [{ id: 'm', typeMime: 'image/png', nom: null }] });
    expect(photo).toMatchObject({ action: { type: 'AUCUNE' }, reponses: [SUITE_RESOLUTION] });
  });
});

describe('avec l\'assistant IA (étape 18) : il trie, les textes restent ceux de la banque', () => {
  const avec = { assistant: true };

  it('le tri est demandé à l\'appelant, avec les échanges', () => {
    const r = traiter(entree('Quels sont vos horaires ?', avec));
    expect(r).toEqual({ decisionRequise: true, echanges: [{ auteur: 'CLIENT', texte: 'Quels sont vos horaires ?' }] });
  });

  it('question fréquente : la réponse écrite par la banque, puis la relance', () => {
    const r = issue(traiter(entree('Quels sont vos horaires ?', avec), decision({ intention: 'FAQ', faqId: 'horaires' })));
    expect(r.reponses).toEqual([FAQ[0]!.reponse, TEXTES_CANAL.FAQ_SUITE]);
    expect(r.issue).toBe('ASSISTANT');
  });

  it('salutation au premier message : l\'assistant se présente comme tel', () => {
    const r = issue(traiter(entree('Bonjour', avec), decision({ intention: 'SALUTATION' })));
    expect(r.reponses).toEqual([TEXTES_CANAL.PRESENTATION('Banque Alpha')]);
  });

  it('réclamation complète : la proposition, avec la catégorie de l\'assistant', () => {
    const r = issue(traiter(entree('On m\'a prélevé deux fois les frais de tenue de compte ce mois-ci', avec),
      decision({ intention: 'RECLAMATION', categorieId: 'frais', complet: true })));
    expect(r.session.etape).toBe('CONFIRMATION');
    expect(r.session.donnees.categorieId).toBe('frais');
  });

  it('« conseiller » sans description : il décrit d\'abord sa demande', () => {
    const r = issue(traiter(entree('conseiller', avec), decision({ intention: 'CONSEILLER' })));
    expect(r.session.etape).toBe('DESCRIPTION');
    expect(r.reponses[0]).toContain('un conseiller va vous repondre');
  });

  it('deux incompréhensions : on passe au dépôt, un conseiller lira', () => {
    const premier = issue(traiter(entree('azerty', avec), decision({ intention: 'INCOMPRIS' })));
    const second = issue(traiter(entree('qsdfg', { ...avec, session: premier.session }), decision({ intention: 'INCOMPRIS' })));
    expect(second.session.etape).toBe('DESCRIPTION');
    expect(second.reponses).toEqual([TEXTES_CANAL.DESCRIPTION]);
  });
});

describe('textes envoyés par SMS : alphabet GSM, un segment coûte 160 caractères', () => {
  it('aucun caractère hors ASCII dans les textes fixes', () => {
    const textes = [
      ...Object.values(TEXTES_CANAL).map((t) => (typeof t === 'function' ? t('Banque Alpha') : t)),
      texteAccuse('ALP-2026-000001', 'https://alpha.example/suivi/x', 'demain a 8 h'), SUITE_RESOLUTION,
      texteChoix([ouverte('a', 'A-1', 'EN_COURS', 'Carte')]),
    ];
    for (const t of textes) {
      expect(t, t).toMatch(/^[\x20-\x7e\n]*$/);
      expect(versGsm(t)).toBe(t);
    }
    expect(DESCRIPTION_MIN).toBe(20);
  });
});

describe('par où part la réponse de la banque', () => {
  const ouverts = { whatsapp: true, smsEntrant: true };
  const t0 = new Date('2026-10-06T09:00:00Z');
  const apres = (h: number) => new Date(t0.getTime() + h * 3_600_000);

  it('WhatsApp tant que la fenêtre de 24 h est ouverte (marge de 5 minutes), puis le portail', () => {
    const c = { canal: 'WHATSAPP' as const, dernierMessageClientLe: t0 };
    expect(canalDuFil(c, ouverts, apres(23))).toEqual({ canal: 'WHATSAPP', finFenetreLe: finFenetre(t0) });
    expect(finFenetre(t0).toISOString()).toBe('2026-10-07T09:00:00.000Z');
    expect(fenetreOuverte(t0, apres(23.9))).toBe(true);
    expect(fenetreOuverte(t0, apres(23.95))).toBe(false);
    expect(canalDuFil(c, ouverts, apres(24))).toEqual({ canal: 'WEB', finFenetreLe: null });
  });

  it('SMS sans limite de temps ; un canal fermé par Makor, ou le portail : WEB', () => {
    expect(canalDuFil({ canal: 'SMS', dernierMessageClientLe: t0 }, ouverts, apres(200)).canal).toBe('SMS');
    expect(canalDuFil({ canal: 'SMS', dernierMessageClientLe: t0 }, { whatsapp: true, smsEntrant: false }, t0).canal).toBe('WEB');
    expect(canalDuFil({ canal: 'WHATSAPP', dernierMessageClientLe: t0 }, { whatsapp: false, smsEntrant: true }, t0).canal).toBe('WEB');
    expect(canalDuFil({ canal: 'WEB', dernierMessageClientLe: t0 }, ouverts, t0).canal).toBe('WEB');
    expect(canalDuFil(null, ouverts, t0).canal).toBe('WEB');
  });
});
