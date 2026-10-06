/**
 * Le moteur de la démo se comporte comme l'API : réponses conformes au contrat, règles de
 * l'étape 4 (machine d'états, chrono SLA en temps ouvré, tâches planifiées), SMS limités au
 * numéro et au lien, erreurs au format RFC 9457.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { CLIENT_DEMO, creerDemo, debutDemo } from '../src/demo/historique';
import { ErreurDemo, PERSONNES, type Moteur } from '../src/demo/moteur';
import { versBanque } from '../src/demo/prospect';
import { CATEGORIES, PERSONNEL } from '../src/maquettes/donnees/parametrage';
import { ecarts } from './contrat';

const BANQUE = { nom: 'Banque Alpha', slug: 'alpha', prefixe: 'ALP', couleur: '#0b6e5f', logoUrl: null };
const DEBUT = debutDemo(new Date('2026-09-26T15:00:00Z')); // un samedi : la démo s'ouvre le lundi 28/09 à 09:30
const SUP = PERSONNES.superviseur.id;
const AGENT = PERSONNES.agent.id;
const ADMIN = PERSONNES.admin.id;
const CARTE = CATEGORIES.find((c) => c.nom === 'Carte bancaire')!;

const nouvelle = () => creerDemo({ banque: BANQUE, debut: DEBUT });
const refus = (f: () => unknown) => {
  try {
    f();
  } catch (e) {
    if (e instanceof ErreurDemo) return e.probleme;
    throw e;
  }
  throw new Error('aucune erreur');
};
function deposerDepuisLeTelephone(m: Moteur) {
  return m.deposer('7K3QX9P2MA', {
    categorieId: CARTE.id,
    description: "Le distributeur n'a pas donné les billets mais mon compte a été débité de 50 000 FCFA.",
    nom: CLIENT_DEMO.nom,
    telephone: CLIENT_DEMO.telephone,
    email: CLIENT_DEMO.email,
    consentement: true,
  });
}
function sessionClient(m: Moteur, jeton: string) {
  m.demanderCode(jeton);
  const code = m.envois[m.envois.length - 1]!.texte.match(/code est (\d{6})/)![1]!;
  return m.verifierCode(jeton, code).jetonClient;
}

describe('ouverture de la démo', () => {
  let m: Moteur;
  beforeAll(() => {
    m = nouvelle();
  });

  it('s\'ouvre un jour ouvré à 09:30, avec 30 jours d\'historique rejoués en moins de 2 s', () => {
    expect(DEBUT.toISOString()).toBe('2026-09-28T09:30:00.000Z');
    const t0 = performance.now();
    nouvelle();
    expect(performance.now() - t0).toBeLessThan(2000);
    expect(m.toutesLesReclamations().length).toBeGreaterThan(250);
  });

  it('les files montrent des réclamations à assigner, une en retard et escaladée, une au seuil d\'alerte', () => {
    const f = m.files(SUP);
    expect(f.compteurs.recues).toBe(3);
    expect(f.compteurs.enRetard).toBeGreaterThanOrEqual(1);
    expect(f.donnees.some((r) => r.sla.etat === 'ALERTE')).toBe(true);
    expect(f.donnees.some((r) => r.priorite === 'URGENTE' && r.agent === null)).toBe(true);
    expect(m.notificationsDe(SUP).nonLues).toBeGreaterThan(0);
  });

  it('les indicateurs sont plausibles : SLA respecté entre 75 et 95 %', () => {
    const i = m.indicateurs();
    expect(i.total).toBeGreaterThan(250);
    expect(i.tauxRespectSla!).toBeGreaterThan(0.75);
    expect(i.tauxRespectSla!).toBeLessThan(0.95);
    expect(i.parStatut.reduce((s, v) => s + v.total, 0)).toBe(i.total);
  });

  it('le tableau de bord de l\'agent ne compte que ses réclamations ; sa charge suit sa file (étape 11)', () => {
    const banque = m.indicateurs();
    const agent = m.indicateurs(30, AGENT);
    const siennes = m.toutesLesReclamations().filter((t) => t.agentId === AGENT && t.creeLe >= new Date(agent.du));
    expect(agent.total).toBe(siennes.length);
    expect(agent.total).toBeGreaterThan(0);
    expect(agent.total).toBeLessThan(banque.total);
    expect(agent.charge.enRetard).toBe(m.files(AGENT).compteurs.enRetard);
    expect(agent.charge.aTraiter + agent.charge.enAttenteClient).toBeLessThanOrEqual(m.files(AGENT).compteurs.assignees);
    expect(banque.charge.aTraiter).toBeGreaterThanOrEqual(agent.charge.aTraiter);
  });

  it('activité des agences (étape 19) : les lignes font le tableau de bord ; les QR codes font chaque ligne', () => {
    const banque = m.indicateurs(30);
    const a = m.indicateursAgences(30);
    expect(ecarts('IndicateursAgences', a)).toEqual([]);
    const somme = (f: (l: (typeof a.agences)[number]) => number) => a.agences.reduce((t, l) => t + f(l), 0);
    expect(somme((l) => l.total)).toBe(banque.total);
    expect(somme((l) => l.charge.aTraiter)).toBe(banque.charge.aTraiter);
    expect(somme((l) => l.charge.enAttenteClient)).toBe(banque.charge.enAttenteClient);
    expect(somme((l) => l.charge.enRetard)).toBe(banque.charge.enRetard);
    for (const l of a.agences) expect(l.pointsDepot.reduce((t, p) => t + p.total, 0)).toBe(l.total);
    // De la plus sollicitée à la moins sollicitée ; « sans agence » en dernier
    const agences = a.agences.filter((l) => l.agence);
    expect(agences.map((l) => l.total)).toEqual([...agences.map((l) => l.total)].sort((x, y) => y - x));
    expect(a.agences.findIndex((l) => !l.agence)).toBe(a.agences.some((l) => !l.agence) ? a.agences.length - 1 : -1);
  });

  it('toutes les réponses sont conformes au contrat', () => {
    const erreurs: string[] = [];
    const verifier = (schema: string, v: unknown, ou: string) => erreurs.push(...ecarts(schema, v).map((e) => `${ou} ${e}`));
    verifier('FormulaireDepot', m.formulaire('7K3QX9P2MA'), 'formulaire QR');
    verifier('FormulaireDepot', m.formulaire('W5Q9HB2MLC'), 'formulaire web');
    for (const u of [SUP, AGENT, ADMIN]) {
      const f = m.files(u);
      verifier('PageReclamations', f, `files ${u}`);
      verifier('PageNotifications', m.notificationsDe(u), `notifications ${u}`);
      for (const r of f.donnees) verifier('ReclamationDetail', m.fiche(u, r.id), `fiche ${r.numero}`);
    }
    verifier('Indicateurs', m.indicateurs(), 'indicateurs');
    verifier('Indicateurs', m.indicateurs(30, AGENT), 'indicateurs de l\'agent');
    verifier('PageAudit', m.journalAudit(), 'journal');
    verifier('ReglesTraitement', m.regles(), 'règles d\'attribution');
    for (const g of m.groupes()) verifier('GroupeAgents', g, `groupe ${g.nom}`);
    for (const a of m.absencesAVenir()) verifier('Absence', a, `absence ${a.agent.nom}`);
    verifier('VerificationChaine', m.verificationJournal(), 'vérification');
    // Chat web (étape 17) : boîte de réception et conversations
    for (const u of [SUP, AGENT, ADMIN]) {
      for (const filtre of ['a-repondre', 'non-lues', 'toutes'] as const) {
        const page = m.conversations(u, filtre);
        verifier('PageConversations', page, `conversations ${u} ${filtre}`);
        for (const c of page.donnees) verifier('ConversationDetail', m.conversation(u, c.id), `conversation ${c.reclamation.numero}`);
      }
    }
    const t = m.toutesLesReclamations().find((x) => x.statut === 'RESOLUE')!;
    verifier('SuiviPublic', m.suivi(t.jetonSuivi), 'suivi');
    verifier('OtpEnvoye', m.demanderCode(t.jetonSuivi), 'otp');
    const s = sessionClient(m, t.jetonSuivi);
    for (const r of m.mesReclamations(s)) {
      verifier('ReclamationClientResume', r, 'mes réclamations');
      verifier('ReclamationClient', m.maReclamation(s, r.id), `ma réclamation ${r.numero}`);
    }
    expect(erreurs).toEqual([]);
  });

  it('enquêtes de satisfaction (étape 15) : un client sur deux répond, chiffres et réponses conformes', () => {
    const s = m.indicateurs().satisfaction!;
    expect(s.enquetes).toBeGreaterThan(50);
    expect(s.tauxReponse!).toBeGreaterThan(0.3);
    expect(s.tauxReponse!).toBeLessThan(0.7);
    expect(s.promoteurs + s.passifs + s.detracteurs).toBe(s.reponses);
    expect(s.parAgent.reduce((n, a) => n + a.reponses, 0)).toBe(s.reponses);
    expect(s.commentaires.length).toBeGreaterThan(0);
    const agent = m.indicateurs(30, AGENT).satisfaction!;
    expect(agent.reponses).toBeLessThan(s.reponses);
    expect(agent.parAgent.map((a) => a.cle)).toEqual([AGENT]);
    const erreurs: string[] = [];
    const avecEnquete = m.toutesLesReclamations().filter((t) => t.enquete).slice(0, 25);
    for (const t of avecEnquete) {
      erreurs.push(...ecarts('Avis', m.lireAvis(t.jetonSuivi)), ...ecarts('ReclamationDetail', m.fiche(SUP, t.id)), ...ecarts('SuiviPublic', m.suivi(t.jetonSuivi)));
    }
    expect(erreurs).toEqual([]);
    expect(m.toutesLesReclamations().some((t) => t.cloture?.mode === 'FORCEE' && t.enquete)).toBe(false);
    expect(m.journalAudit(5000).donnees.some((l) => l.action === 'client.avis_donne')).toBe(true);
  });
});

describe('le parcours de la visite guidée', () => {
  it('dépôt → assignation → réponse → alerte à 75 % → résolution → confirmation par le client', () => {
    const m = nouvelle();
    const accuse = deposerDepuisLeTelephone(m);
    expect(ecarts('AccuseDepot', accuse)).toEqual([]);
    expect(accuse.numero).toMatch(/^ALP-2026-\d{6}$/);

    // SMS d'accusé : numéro et lien, jamais le texte de la réclamation (S10)
    const client = m.clientParTelephone(CLIENT_DEMO.telephoneE164)!;
    const sms = m.envoisDe(client.id).filter((e) => e.canal === 'SMS');
    expect(sms.at(-1)!.texte).toContain(accuse.numero);
    expect(sms.at(-1)!.texte).not.toContain('distributeur');

    // Espace client : l'ancienne réclamation du client est retrouvée par son téléphone
    const session = sessionClient(m, accuse.jetonSuivi);
    expect(m.mesReclamations(session).length).toBe(2);

    // Le superviseur assigne ; l'agent prend en charge en répondant
    const id = m.ticket(accuse.numero).id;
    expect(refus(() => m.fiche(AGENT, id)).status).toBe(404); // l'agent ne la voit qu'une fois assignée (C5)
    m.assigner(SUP, id, AGENT);
    expect(m.notificationsDe(AGENT).donnees[0]!.modele).toBe('agent.assignation');
    m.avancer(20);
    m.repondre(AGENT, id, 'Bonjour, nous vérifions le journal du distributeur.');
    expect(m.fiche(AGENT, id).statut).toBe('EN_COURS');
    expect(m.fiche(AGENT, id).jalons.premiereReponseLe).not.toBeNull();

    // Alerte préventive exactement au seuil de 75 %, une seule fois
    const { alerte } = m.jalonsDe(id);
    m.avancerJusqua(alerte!);
    expect(m.fiche(AGENT, id).sla.etat).toBe('ALERTE');
    expect(m.fiche(AGENT, id).chronologie.filter((e) => e.type === 'ALERTE_SLA_PREVENTIVE')).toHaveLength(1);
    m.avancer(10);
    expect(m.fiche(AGENT, id).chronologie.filter((e) => e.type === 'ALERTE_SLA_PREVENTIVE')).toHaveLength(1);

    // Résolution avant l'échéance : SLA respecté, clôture automatique programmée
    m.resoudre(AGENT, id, 'Bonjour, les 50 000 FCFA ont été recrédités ce jour.');
    const resolue = m.fiche(AGENT, id);
    expect(resolue.statut).toBe('RESOLUE');
    expect(resolue.sla.respecte).toBe(true);
    expect(resolue.jalons.clotureAutoPrevueLe).not.toBeNull();

    // Le client confirme
    const vue = m.maReclamation(session, id);
    expect(vue.actionsPossibles).toEqual(['CONFIRMER', 'CONTESTER']);
    expect(vue.messages.some((x) => x.contenu.includes('journal'))).toBe(true);
    m.confirmer(session, id);
    expect(m.maReclamation(session, id).statut).toBe('CLOTUREE');
    const actions = m.journalAudit(1000).donnees.filter((l) => l.entiteId === id).map((l) => l.action).reverse();
    expect(actions).toEqual([
      'reclamation.depot', 'reclamation.assignation', 'reclamation.prise_en_charge', 'reclamation.reponse_client',
      'sla.alerte_preventive', 'reclamation.resolution', 'reclamation.confirmation',
    ]);
  });

  it('enquête de satisfaction : lien dans le SMS de clôture, une seule réponse, visible sur la fiche', () => {
    const m = nouvelle();
    const accuse = deposerDepuisLeTelephone(m);
    const id = m.ticket(accuse.numero).id;
    m.assigner(SUP, id, AGENT);
    m.prendreEnCharge(AGENT, id);
    m.resoudre(AGENT, id, 'Recrédité.');
    const session = sessionClient(m, accuse.jetonSuivi);
    expect(refus(() => m.lireAvis(accuse.jetonSuivi)).status).toBe(404);
    m.confirmer(session, id);

    const client = m.clientParTelephone(CLIENT_DEMO.telephoneE164)!;
    const sms = m.envoisDe(client.id).filter((e) => e.canal === 'SMS').at(-1)!;
    expect(sms.texte).toBe(`Banque Alpha : réclamation ${accuse.numero} close. Votre avis : alpha.reclamations.example/suivi/${accuse.jetonSuivi}/avis`);
    expect(sms.lien).toEqual({ jeton: accuse.jetonSuivi, avis: true });
    expect(m.suivi(accuse.jetonSuivi).avis?.etat).toBe('A_DONNER');
    expect(m.maReclamation(session, id).avis?.chemin).toBe(`/suivi/${accuse.jetonSuivi}/avis`);

    expect(refus(() => m.donnerAvis(accuse.jetonSuivi, { note: 6, recommandation: 9 })).status).toBe(400);
    const avis = m.donnerAvis(accuse.jetonSuivi, { note: 4, recommandation: 9, commentaire: '  Merci  ' });
    expect(ecarts('Avis', avis)).toEqual([]);
    expect(avis.reponse).toMatchObject({ note: 4, recommandation: 9, commentaire: 'Merci' });
    expect(refus(() => m.donnerAvis(accuse.jetonSuivi, { note: 1, recommandation: 0 })).code).toBe('AVIS_DEJA_DONNE');
    expect(m.fiche(AGENT, id).avis?.reponse?.note).toBe(4);
    expect(m.journalAudit().donnees[0]).toMatchObject({ action: 'client.avis_donne', entiteId: id, donnees: null });
    expect(m.indicateurs(1, AGENT).satisfaction!.commentaires[0]).toMatchObject({ numero: accuse.numero, note: 4, recommandation: 9, commentaire: 'Merci' });
  });

  it('enquête : ouverte à la clôture automatique, terminée après 7 jours ; aucune à une clôture forcée', () => {
    const m = nouvelle();
    const accuse = deposerDepuisLeTelephone(m);
    const id = m.ticket(accuse.numero).id;
    m.assigner(SUP, id, AGENT);
    m.prendreEnCharge(AGENT, id);
    m.resoudre(AGENT, id, 'Recrédité.');
    m.avancer(5 * 24 * 60 + 1);
    expect(m.fiche(SUP, id).cloture?.mode).toBe('AUTOMATIQUE');
    expect(m.lireAvis(accuse.jetonSuivi).etat).toBe('A_DONNER');
    m.avancer(7 * 24 * 60 + 1);
    expect(m.lireAvis(accuse.jetonSuivi).etat).toBe('TERMINE');
    expect(refus(() => m.donnerAvis(accuse.jetonSuivi, { note: 5, recommandation: 10 })).code).toBe('ENQUETE_TERMINEE');

    const autre = deposerDepuisLeTelephone(m);
    const id2 = m.ticket(autre.numero).id;
    m.cloturerDeForce(SUP, id2, 'DOUBLON', 'Même demande que la précédente.');
    expect(m.fiche(SUP, id2).avis).toBeNull();
    expect(refus(() => m.lireAvis(autre.jetonSuivi)).status).toBe(404);
  });

  it('sans réponse, l\'échéance passe : dépassement signalé et escalade au superviseur', () => {
    const m = nouvelle();
    const id = m.ticket(deposerDepuisLeTelephone(m).numero).id;
    m.assigner(SUP, id, AGENT);
    m.avancerJusqua(m.jalonsDe(id).echeance!);
    const f = m.fiche(SUP, id);
    expect(f.sla.etat).toBe('DEPASSE');
    expect(f.escaladeeVers?.id).toBe(SUP);
    expect(m.notificationsDe(SUP).donnees.some((n) => n.modele === 'sla.depassement' && n.reclamationId === id)).toBe(true);
  });

  it('question au client : le chrono se met en pause, puis reprend à sa réponse', () => {
    const m = nouvelle();
    const accuse = deposerDepuisLeTelephone(m);
    const id = m.ticket(accuse.numero).id;
    m.assigner(SUP, id, AGENT);
    m.repondre(AGENT, id, 'Pouvez-vous nous envoyer le ticket du distributeur ?', true);
    const pause = m.fiche(AGENT, id);
    expect(pause.statut).toBe('EN_ATTENTE_CLIENT');
    expect(pause.sla.etat).toBe('EN_PAUSE');
    const figees = pause.sla.minutesRestantes;
    m.avancer(24 * 60);
    expect(m.fiche(AGENT, id).sla.minutesRestantes).toBe(figees);
    const session = sessionClient(m, accuse.jetonSuivi);
    expect(m.maReclamation(session, id).operationsPossibles).toContain('MESSAGE_DU_CLIENT');
    m.messageClient(session, id, 'Voici le ticket.');
    expect(m.fiche(AGENT, id).statut).toBe('EN_COURS');
    expect(m.fiche(AGENT, id).sla.minutesRestantes).toBe(figees);
  });

  it('contestation, puis clôture automatique 5 jours après la nouvelle résolution', () => {
    const m = nouvelle();
    const accuse = deposerDepuisLeTelephone(m);
    const id = m.ticket(accuse.numero).id;
    m.assigner(SUP, id, AGENT);
    m.prendreEnCharge(AGENT, id);
    m.resoudre(AGENT, id, 'Recrédité.');
    const session = sessionClient(m, accuse.jetonSuivi);
    m.contester(session, id, 'Je n\'ai reçu que la moitié.');
    expect(m.fiche(AGENT, id).nbReouvertures).toBe(1);
    m.resoudre(AGENT, id, 'Le complément est recrédité.');
    m.avancer(5 * 24 * 60 + 1);
    const f = m.fiche(SUP, id);
    expect(f.statut).toBe('CLOTUREE');
    expect(f.cloture?.mode).toBe('AUTOMATIQUE');
  });

  it('les refus suivent la machine d\'états et le format RFC 9457', () => {
    const m = nouvelle();
    const accuse = deposerDepuisLeTelephone(m);
    const id = m.ticket(accuse.numero).id;
    expect(refus(() => m.prendreEnCharge(SUP, id)).code).toBe('AUCUN_AGENT_ASSIGNE');
    expect(refus(() => m.cloturerDeForce(AGENT, id, 'DOUBLON', 'x')).status).toBe(403);
    expect(refus(() => m.resoudre(SUP, id, 'Résolue')).code).toBe('TRANSITION_INTERDITE');
    const session = sessionClient(m, accuse.jetonSuivi);
    expect(refus(() => m.confirmer(session, id)).status).toBe(409);
    const p = refus(() => m.deposer('7K3QX9P2MA', { categorieId: CARTE.id, description: 'court', nom: '', telephone: '07 08 09 10', consentement: false }));
    expect(ecarts('Probleme', p)).toEqual([]);
    expect(p.code).toBe('VALIDATION');
    expect(p.erreurs!.map((e) => e.champ).sort()).toEqual(['consentement', 'description', 'nom', 'telephone']);
    expect(refus(() => m.verifierCode(accuse.jetonSuivi, '000000')).code).toBe('CODE_OTP_INVALIDE');
  });
});

describe('attribution et escalade (étape 16)', () => {
  const ADJOUA = PERSONNEL.find((u) => u.prenom === 'Adjoua')!.id;
  const MAMADOU = PERSONNEL.find((u) => u.prenom === 'Mamadou')!.id;

  it('mode suggestion : le superviseur voit l\'agent proposé, jamais un absent ; il valide en assignant', () => {
    const m = nouvelle();
    const id = m.ticket(deposerDepuisLeTelephone(m).numero).id;
    // Carte bancaire : groupe Monétique (Aya, Mamadou, et Adjoua, absente)
    const ligne = m.files(SUP).donnees.find((r) => r.id === id)!;
    expect(ligne.agent).toBeNull();
    expect([AGENT, MAMADOU]).toContain(ligne.agentSuggere?.id);
    expect(m.fiche(SUP, id).attributionSuggeree).toMatchObject({ agent: ligne.agentSuggere, groupe: { nom: 'Monétique' } });
    expect(m.files(ADMIN).donnees.find((r) => r.id === id)!.agentSuggere).toBeNull();
    expect(m.fiche(ADMIN, id).attributionSuggeree).toBeNull();
    expect(m.groupes().find((g) => g.nom === 'Monétique')!.membres.find((x) => x.id === ADJOUA)!.absent).toBe(true);

    // L'agent proposé s'absente : l'autre est proposé
    const propose = ligne.agentSuggere!.id;
    m.ajouterAbsence(SUP, { agentId: propose, du: m.aujourdhui(), au: m.aujourdhui() });
    const autre = m.fiche(SUP, id).attributionSuggeree!.agent.id;
    expect(autre).not.toBe(propose);
    m.assigner(SUP, id, autre);
    expect(m.fiche(SUP, id).attributionSuggeree).toBeNull();
    const absence = m.absencesAVenir().find((a) => a.agent.id === propose)!;
    m.supprimerAbsence(SUP, absence.id);
    expect(m.absencesAVenir().some((a) => a.agent.id === propose)).toBe(false);
    expect(refus(() => m.ajouterAbsence(SUP, { agentId: SUP, du: m.aujourdhui(), au: m.aujourdhui() })).code).toBe('AGENT_INVALIDE');
  });

  it('mode automatique : au dépôt pendant les heures d\'ouverture, par le système ; rien la nuit', () => {
    const m = nouvelle();
    m.changerModeAttribution('AUTOMATIQUE');
    const id = m.ticket(deposerDepuisLeTelephone(m).numero).id;
    const f = m.fiche(SUP, id);
    expect([AGENT, MAMADOU]).toContain(f.agent?.id);
    expect(f.chronologie.map((e) => [e.type, e.acteur.type])).toContainEqual(['ASSIGNATION', 'SYSTEME']);
    expect(m.notificationsDe(f.agent!.id).donnees[0]).toMatchObject({ modele: 'agent.assignation', reclamationId: id });
    expect(m.journalAudit().donnees.some((l) => l.action === 'reclamation.attribution_automatique' && l.entiteId === id)).toBe(true);

    m.avancerJusqua(new Date('2026-09-28T20:00:00Z'));
    const nuit = m.ticket(deposerDepuisLeTelephone(m).numero).id;
    expect(m.fiche(SUP, nuit).agent).toBeNull();
  });

  it('second niveau : l\'Admin Entreprise est prévenu à 150 % du délai, une seule fois', () => {
    const m = nouvelle();
    const id = m.ticket(deposerDepuisLeTelephone(m).numero).id;
    m.assigner(SUP, id, AGENT);
    m.avancerJusqua(m.jalonsDe(id).echeance!);
    expect(m.fiche(SUP, id).jalons.escaladeeAdminLe).toBeNull();
    // 960 minutes ouvrées : l'Admin Entreprise est prévenu 480 minutes ouvrées après l'échéance
    for (let i = 0; i < 40 && !m.fiche(SUP, id).jalons.escaladeeAdminLe; i++) m.avancer(60);
    const f = m.fiche(SUP, id);
    expect(f.jalons.escaladeeAdminLe).not.toBeNull();
    expect(f.chronologie.filter((e) => e.type === 'ESCALADE_ADMIN')).toHaveLength(1);
    expect(m.notificationsDe(ADMIN).donnees.filter((n) => n.modele === 'admin.escalade' && n.reclamationId === id)).toHaveLength(1);
    m.avancer(600);
    expect(m.fiche(SUP, id).chronologie.filter((e) => e.type === 'ESCALADE_ADMIN')).toHaveLength(1);
  });
});

describe('chat web (étape 17)', () => {
  /** Dépôt, assignation à l'agent de la démo, session du client ouverte. */
  function ouvrir() {
    const m = nouvelle();
    const accuse = deposerDepuisLeTelephone(m);
    const id = m.ticket(accuse.numero).id;
    m.assigner(SUP, id, AGENT);
    const session = sessionClient(m, accuse.jetonSuivi);
    const client = m.clientParTelephone(CLIENT_DEMO.telephoneE164)!;
    const sms = () => m.envoisDe(client.id).filter((e) => e.canal === 'SMS' && e.texte.includes('réponse'));
    return { m, id, session, sms };
  }

  it('à l\'ouverture, des clients attendent une réponse dans la boîte de réception', () => {
    const m = nouvelle();
    const page = m.conversations(SUP);
    expect(page.compteurs.aRepondre).toBe(2);
    expect(page.donnees.every((c) => c.aRepondre && c.dernierMessage.auteur === 'CLIENT')).toBe(true);
    // La plus longue attente d'abord
    const dates = page.donnees.map((c) => c.dernierMessage.date);
    expect([...dates].sort()).toEqual(dates);
    expect(m.notificationsDe(page.donnees[0]!.agent!.id).donnees.some((n) => n.modele === 'agent.message_client')).toBe(true);
  });

  it('le client ouvre le chat et écrit trois fois : l\'agent n\'est alerté qu\'une fois', () => {
    const { m, id, session } = ouvrir();
    expect(m.maReclamation(session, id).chat).toMatchObject({ ouvert: true, repriseLe: null, luParLaBanqueLe: null });
    m.lireChat(session, id);
    for (const texte of ['Bonjour', 'Ma carte est restée dans le distributeur', 'Pouvez-vous m\'aider ?']) {
      m.avancer(1);
      m.messageClient(session, id, texte);
    }
    expect(m.notificationsDe(AGENT).donnees.filter((n) => n.modele === 'agent.message_client' && n.reclamationId === id)).toHaveLength(1);
    const ligne = m.conversations(AGENT).donnees.find((c) => c.reclamation.id === id)!;
    expect(ligne).toMatchObject({ aRepondre: true, nonLue: true, clientEnLigne: true, dernierMessage: { extrait: 'Pouvez-vous m\'aider ?' } });
    // Le superviseur regarde : toujours non lue pour l'agent ; l'agent ouvre : lue
    m.marquerConversationLue(SUP, ligne.id);
    expect(m.conversation(AGENT, ligne.id).nonLue).toBe(true);
    m.marquerConversationLue(AGENT, ligne.id);
    expect(m.conversation(AGENT, ligne.id)).toMatchObject({ nonLue: false, aRepondre: true });
    expect(m.maReclamation(session, id).chat!.luParLaBanqueLe).not.toBeNull();
    expect(m.fiche(AGENT, id).conversation).toMatchObject({ aRepondre: true, nonLue: false, clientEnLigne: true });
  });

  it('réponse lue dans le chat : pas de SMS ; non lue 2 minutes après : un SMS, un seul', () => {
    const { m, id, session, sms } = ouvrir();
    m.lireChat(session, id);
    m.messageClient(session, id, 'Bonjour, des nouvelles ?');
    const avant = sms().length;
    m.repondre(AGENT, id, 'Bonjour, nous vérifions le distributeur.');
    m.lireChat(session, id); // le téléphone affiche le chat
    m.avancer(10);
    expect(sms().length).toBe(avant);
    // Le client a quitté le chat : deux réponses, un seul SMS, 2 minutes après la dernière
    m.repondre(AGENT, id, 'La carte est au coffre de l\'agence.');
    m.avancer(1);
    m.repondre(AGENT, id, 'Vous pourrez la retirer demain.');
    m.avancer(1.5);
    expect(sms().length).toBe(avant);
    m.avancer(1);
    expect(sms().length).toBe(avant + 1);
    expect(sms().at(-1)!.texte).not.toContain('coffre');
    m.avancer(30);
    expect(sms().length).toBe(avant + 1);
  });

  it('client qui n\'a jamais ouvert le chat : le SMS part tout de suite, comme avant', () => {
    const { m, id, sms } = ouvrir();
    const avant = sms().length;
    m.repondre(AGENT, id, 'Bonjour, nous vérifions.');
    expect(sms().length).toBe(avant + 1);
    expect(m.conversations(SUP, 'toutes').donnees.some((c) => c.reclamation.id === id)).toBe(false);
  });

  it('un autre agent ne voit pas la conversation ; l\'Admin Entreprise la lit sans pouvoir répondre', () => {
    const { m, id, session } = ouvrir();
    m.lireChat(session, id);
    m.messageClient(session, id, 'Bonjour');
    const c = m.conversations(SUP).donnees.find((x) => x.reclamation.id === id)!;
    const mamadou = PERSONNEL.find((u) => u.prenom === 'Mamadou')!.id;
    expect(refus(() => m.conversation(mamadou, c.id)).status).toBe(404);
    expect(m.conversation(ADMIN, c.id).operationsPossibles).not.toContain('REPONDRE_AU_CLIENT');
    expect(m.conversation(AGENT, c.id).operationsPossibles).toContain('REPONDRE_AU_CLIENT');
  });
});

describe('WhatsApp et SMS (étape 20)', () => {
  it('à l\'ouverture, un client a écrit sur WhatsApp : la réponse y part, telle quelle, sans SMS', () => {
    const m = nouvelle();
    const ligne = m.conversations(SUP).donnees.find((c) => c.canal === 'WHATSAPP')!;
    expect(ligne).toMatchObject({ aRepondre: true, clientEnLigne: false });
    const agent = ligne.agent!.id;
    const c = m.conversation(agent, ligne.id);
    expect(c.messages.filter((x) => x.type === 'MESSAGE_DU_CLIENT').map((x) => x.canal)).toEqual(expect.arrayContaining(['WHATSAPP']));
    expect(c.reponseVers.canal).toBe('WHATSAPP');
    expect(new Date(c.reponseVers.finFenetreLe!).getTime()).toBeGreaterThan(new Date(m.maintenant).getTime());
    const fiche = m.fiche(agent, c.reclamation.id);
    expect(fiche.conversation).toMatchObject({ canal: 'WHATSAPP', reponseVers: { canal: 'WHATSAPP' } });
    const envois = m.envois.length;
    m.repondre(agent, c.reclamation.id, 'Bonjour, nous réinitialisons votre accès.');
    expect(m.conversation(agent, ligne.id).messages.at(-1)).toMatchObject({ type: 'REPONSE_AU_CLIENT', canal: 'WHATSAPP' });
    m.avancer(10);
    expect(m.envois.length).toBe(envois);
    // Plus de 24 h après son dernier message : la réponse reste dans son suivi
    m.avancer(24 * 60);
    expect(m.conversation(agent, ligne.id).reponseVers).toEqual({ canal: 'WEB', finFenetreLe: null });
  });

  it('le portail propose WhatsApp quand la banque l\'a ouvert', () => {
    const m = nouvelle();
    expect(m.formulaire('7K3QX9P2MA').banque.whatsapp).toBe('+2252722000000');
    m.chatActif = false;
    expect(m.formulaire('7K3QX9P2MA').banque.whatsapp).toBeNull();
  });
});

describe('assistant IA (étape 18)', () => {
  const C = (texte: string) => ({ auteur: 'CLIENT' as const, texte });

  it('sur le portail, il se présente, répond par la base de la banque et prépare la réclamation (règles, sans IA)', () => {
    const m = nouvelle();
    expect(m.formulaire('7K3QX9P2MA').assistant).toBe(true);
    const accueil = m.converserAvecAssistant('7K3QX9P2MA', []);
    expect(accueil.messages[0]!.code).toBe('PRESENTATION');
    expect(accueil.messages[0]!.texte).toMatch(/assistant automatique de Banque Alpha/);
    const faq = m.converserAvecAssistant('7K3QX9P2MA', [C('Quels sont vos horaires ?')]);
    expect(faq.messages.map((x) => x.code)).toEqual(['FAQ', 'FAQ_SUITE']);
    const depot = m.converserAvecAssistant('7K3QX9P2MA', [C('Le GAB du Plateau a avalé ma carte hier à 21 h, je n\'ai pas pu la récupérer')]);
    expect(depot.proposition).toMatchObject({ motif: 'DEPOT', categorieId: CARTE.id });
    const conseiller = m.converserAvecAssistant('7K3QX9P2MA', [C('je veux un conseiller')]);
    expect(conseiller.messages[0]!.code).toBe('TRANSFERT');
    for (const r of [accueil, faq, depot, conseiller]) expect(ecarts('ReponseAssistant', r)).toEqual([]);
  });

  it('dépôt préparé avec l\'assistant : noté sur la fiche ; brouillon pour l\'agent, sans alerte', () => {
    const m = nouvelle();
    const accuse = m.deposer('7K3QX9P2MA', {
      categorieId: CARTE.id, description: 'Retrait de 50 000 FCFA non servi au GAB du Plateau hier soir, compte débité.',
      nom: CLIENT_DEMO.nom, telephone: CLIENT_DEMO.telephone, consentement: true, viaAssistant: true,
    });
    const id = m.ticket(accuse.numero).id;
    expect(m.fiche(SUP, id).depotAssistant).toBe(true);
    m.assigner(SUP, id, AGENT);
    const s = m.suggererReponse(AGENT, id);
    expect(ecarts('SuggestionReponse', s)).toEqual([]);
    expect(s).toMatchObject({ source: 'REGLES', alertes: [], categorie: null });
    expect(s.brouillon).toMatch(/^Bonjour,\n/);
    expect(m.fiche(SUP, m.toutesLesReclamations().find((t) => !t.viaAssistant)!.id).depotAssistant).toBe(false);
    for (const r of m.reponsesAssistant()) expect(ecarts('ReponseBanque', r)).toEqual([]);
  });
});

describe('banque du prospect', () => {
  const vers = (nom: string) => versBanque({ nom, couleur: '#1d4f91', logoUrl: null, contact: '' });

  it('préfixe des numéros et adresse tirés du nom, aux formats du contrat', () => {
    expect(vers('Banque Alpha')).toMatchObject({ prefixe: 'ALP', slug: 'alpha' });
    expect(vers('Banque Horizon')).toMatchObject({ prefixe: 'HOR', slug: 'horizon' });
    expect(vers('Société Ivoirienne de Banque')).toMatchObject({ prefixe: 'SIB', slug: 'societe-ivoirienne' });
    expect(vers('Coris Bank International').prefixe).toBe('CBI');
    expect(vers("Banque Atlantique Côte d'Ivoire")).toMatchObject({ prefixe: 'BAC', slug: 'atlantique-cote-ivoire' });
    expect(vers('Société Générale').prefixe).toBe('SGE');
    for (const nom of ['Banque Alpha', 'Caisse Nationale des Caisses d\'Épargne de Côte d\'Ivoire', 'B', '  —  ', 'NSIA Banque', 'Ecobank']) {
      const b = vers(nom);
      expect(b.prefixe, nom).toMatch(/^[A-Z0-9]{2,10}$/);
      expect(b.slug, nom).toMatch(/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/);
    }
  });
});
