/**
 * Le moteur de la démo se comporte comme l'API : réponses conformes au contrat, règles de
 * l'étape 4 (machine d'états, chrono SLA en temps ouvré, tâches planifiées), SMS limités au
 * numéro et au lien, erreurs au format RFC 9457.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { CLIENT_DEMO, creerDemo, debutDemo } from '../src/demo/historique';
import { ErreurDemo, PERSONNES, type Moteur } from '../src/demo/moteur';
import { versBanque } from '../src/demo/prospect';
import { CATEGORIES } from '../src/maquettes/donnees/parametrage';
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
    verifier('VerificationChaine', m.verificationJournal(), 'vérification');
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
    const actions = m.journalAudit().donnees.filter((l) => l.entiteId === id).map((l) => l.action).reverse();
    expect(actions).toEqual([
      'reclamation.depot', 'reclamation.assignation', 'reclamation.prise_en_charge', 'reclamation.reponse_client',
      'sla.alerte_preventive', 'reclamation.resolution', 'reclamation.confirmation',
    ]);
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
