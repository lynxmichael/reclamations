/**
 * Conversations et chat web (étape 17, phase 2, décisions I1 et I8) : ouvert banque par banque par le
 * Super Admin ; une conversation par réclamation, ouverte quand le client affiche le chat ; messages
 * relus par curseur ; boîte de réception des agents (à répondre, non lues, compteurs) ; marque « lue »
 * de l'agent assigné ; une rafale de messages du client n'alerte l'agent qu'une fois ; une réponse de
 * la banque n'est signalée par e-mail ou SMS que si elle reste non lue 2 minutes ; isolation.
 *
 * L'horloge de l'API est pilotée par le test (une date passée, comme le fichier de l'attribution). À la
 * fin, le chat des deux banques est refermé, comme au départ, et aucun avis ne reste en attente.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CycleDeVie } from '../../src/application/reclamations/cycle-de-vie.js';
import { TachesSla } from '../../src/application/reclamations/taches-sla.js';
import { BaseDonnees } from '../../src/infrastructure/base-de-donnees/base-de-donnees.service.js';
import { ClientApi, connecter, demarrerApi, fermerOutils, jeu, nouvelleIp, type ApiDeTest } from './environnement.js';

const j = jeu();
const a = j.alpha;
// Mardi 8 septembre 2026, 09:00 à Abidjan (UTC) : la Banque Alpha est ouverte (08:00–12:00, 14:00–17:30)
let maintenant = new Date('2026-09-08T09:00:00Z');
let api: ApiDeTest;
let client: ClientApi;
let bd: BaseDonnees;
let taches: TachesSla;
const jt: Record<string, string> = {};
let compteur = 0;

const COMPTES = {
  sa: j.superAdmin.email, fatou: a.comptes.fatou!.email, serge: a.comptes.serge!.email, aya: a.comptes.aya!.email,
  mamadou: a.comptes.mamadou!.email, didier: j.horizon.comptes.didier!.email,
};

interface Ticket { id: string; numero: string; jetonSuivi: string; jc: string }

const minutes = (n: number) => new Date(maintenant.getTime() + n * 60_000);

/** Avance l'horloge de l'API et reconnecte le personnel (jetons d'accès de 15 minutes). */
async function horlogeA(t: Date) {
  maintenant = t;
  for (const [cle, email] of Object.entries(COMPTES)) jt[cle] = (await connecter(client, email, () => maintenant)).jeton;
}

const appeler = (op: string, jeton: string, o: { chemin?: Record<string, string>; corps?: unknown; requete?: Record<string, string> } = {}) =>
  client.appeler(op, { jeton, ...o });
const ok = async (op: string, jeton: string, o: Parameters<typeof appeler>[2] = {}) => {
  const r = await appeler(op, jeton, o);
  expect(r.statut, `${op} : ${JSON.stringify(r.corps)}`).toBeLessThan(300);
  return r.corps;
};

/** Code à usage unique reçu par SMS, puis session du client (30 minutes). */
async function sessionClient(jetonSuivi: string, id: string): Promise<string> {
  expect((await client.appeler('demanderCodeOtp', { chemin: { jetonSuivi }, corps: { canal: 'SMS' } })).statut).toBe(202);
  const sms = await bd.enSysteme((tx) => tx.notification.findFirstOrThrow({ where: { reclamationId: id, modele: 'client.otp' }, orderBy: { creeLe: 'desc' } }));
  const s = await client.appeler('verifierCodeOtp', { chemin: { jetonSuivi }, corps: { code: /(\d{6})/.exec(sms.contenu)![1] } });
  expect(s.statut).toBe(200);
  return s.corps.jetonClient;
}

/** Dépôt par le QR code, assignation à Aya, session du client. */
async function deposer(banque: 'alpha' | 'horizon' = 'alpha', assigner = true): Promise<Ticket> {
  compteur++;
  const b = j[banque];
  const r = await client.appeler('deposerReclamation', {
    ip: nouvelleIp(), chemin: { code: b.points.qr },
    corps: {
      categorieId: b.categories['Carte bancaire'], description: `Scénario chat ${compteur} : carte avalée au distributeur`, nom: 'Client Chat',
      telephone: `0799017${String(compteur).padStart(3, '0')}`, email: `chat${compteur}@exemple.ci`, consentement: true, versionPolitique: '2026-09',
    },
  });
  expect(r.statut, JSON.stringify(r.corps)).toBe(201);
  const t = await bd.enSysteme((tx) => tx.reclamation.findUniqueOrThrow({ where: { jetonSuivi: r.corps.jetonSuivi } }));
  if (assigner && banque === 'alpha') await ok('assignerReclamation', jt.serge!, { chemin: { id: t.id }, corps: { agentId: a.comptes.aya!.id } });
  return { id: t.id, numero: t.numero, jetonSuivi: r.corps.jetonSuivi, jc: await sessionClient(r.corps.jetonSuivi, t.id) };
}

const ecrire = (t: Ticket, contenu: string) => ok('envoyerMessageClient', t.jc, { chemin: { id: t.id }, corps: { contenu } });
const repondre = (t: Ticket, contenu: string, jeton = jt.aya!, attendreReponse = false) =>
  ok('repondreAuClient', jeton, { chemin: { id: t.id }, corps: { contenu, ...(attendreReponse ? { attendreReponse: true } : {}) } });
const ouvrirChat = async (t: Ticket) => expect((await appeler('marquerConversationLueClient', t.jc, { chemin: { id: t.id } })).statut).toBe(204);
const chat = (t: Ticket, apres?: string) => ok('lireConversationClient', t.jc, { chemin: { id: t.id }, ...(apres ? { requete: { apres } } : {}) });
const boite = (jeton: string, filtre = 'a-repondre') => ok('listerConversations', jeton, { requete: { filtre } });
const ligne = async (jeton: string, t: Ticket, filtre = 'toutes') =>
  (await boite(jeton, filtre)).donnees.find((c: { reclamation: { id: string } }) => c.reclamation.id === t.id);
const conversationDe = (t: Ticket) => bd.enBanque(a.id, (tx) => tx.conversation.findUnique({ where: { tenantId_reclamationId: { tenantId: a.id, reclamationId: t.id } } }));
const notifications = (t: Ticket, modele: string) =>
  bd.enSysteme((tx) => tx.notification.findMany({ where: { reclamationId: t.id, modele }, select: { canal: true, destination: true, creeLe: true } }));

beforeAll(async () => {
  api = await demarrerApi({ horloge: () => maintenant });
  client = new ClientApi(api.url);
  bd = new BaseDonnees(api.config.baseDeDonneesUrl);
  taches = new TachesSla(bd.base, new CycleDeVie(bd.base, { horloge: () => maintenant, lienSuivi: (s, t) => `https://${s}.reclamations.test/suivi/${t}` }));
  await horlogeA(maintenant);
});

afterAll(async () => {
  await horlogeA(maintenant);
  for (const banque of [a.id, j.horizon.id]) await appeler('modifierBanque', jt.sa!, { chemin: { id: banque }, corps: { chatWeb: false } });
  await bd.fermer();
  await api.fermer();
  await fermerOutils();
});

let principal: Ticket;

describe('activation banque par banque (décision I2)', () => {
  it('fermé par défaut : fil de messages simple, chaque message du client alerte l\'agent', async () => {
    expect((await ok('lireParametresBanque', jt.fatou!)).chatWeb).toBe(false);
    const t = await deposer();
    expect((await ok('lireMaReclamation', t.jc, { chemin: { id: t.id } })).chat).toBeNull();
    for (const [op, jeton, o] of [
      ['lireConversationClient', t.jc, { chemin: { id: t.id } }],
      ['marquerConversationLueClient', t.jc, { chemin: { id: t.id } }],
      ['listerConversations', jt.aya!, {}],
    ] as const) {
      const r = await appeler(op, jeton, o);
      expect(r.statut, op).toBe(403);
      expect(r.corps.code).toBe('FONCTION_NON_OUVERTE');
    }
    await ecrire(t, 'Premier message');
    await ecrire(t, 'Second message');
    expect(await notifications(t, 'agent.message_client')).toHaveLength(4); // 2 messages × (e-mail + in-app)
    expect(await conversationDe(t)).toBeNull();
    expect((await ok('lireReclamation', jt.aya!, { chemin: { id: t.id } })).conversation).toBeNull();
  });

  it('le Super Admin l\'ouvre pour la Banque Alpha seulement ; il ne voit aucune conversation', async () => {
    const b = await ok('modifierBanque', jt.sa!, { chemin: { id: a.id }, corps: { chatWeb: true } });
    expect(b.chatWeb).toBe(true);
    expect((await ok('lireBanque', jt.sa!, { chemin: { id: j.horizon.id } })).chatWeb).toBe(false);
    expect((await ok('lireParametresBanque', jt.fatou!)).chatWeb).toBe(true);
    expect((await appeler('listerConversations', jt.didier!)).corps.code).toBe('FONCTION_NON_OUVERTE');
    expect((await appeler('listerConversations', jt.sa!)).statut).toBe(403);
    const audit = await bd.enSysteme((tx) => tx.journalAudit.findFirst({ where: { action: 'plateforme.banque_modifiee', entiteId: a.id }, orderBy: { id: 'desc' } }));
    expect((audit?.donnees as { champs: string[] }).champs).toEqual(['chatWeb']);
  });
});

describe('le chat du client', () => {
  it('ouvrir le chat ouvre la conversation ; disponibilité de la banque, aucune lecture', async () => {
    principal = await deposer();
    const r = await ok('lireMaReclamation', principal.jc, { chemin: { id: principal.id } });
    expect(r.chat).toEqual({ ouvert: true, repriseLe: null, luParLaBanqueLe: null });
    expect(await conversationDe(principal)).toBeNull();
    await ouvrirChat(principal);
    const c = await conversationDe(principal);
    expect(c).toMatchObject({ canal: 'WEB', luClientLe: maintenant, dernierMessageClientLe: null });
    const vide = await chat(principal);
    expect(vide).toEqual({ statut: 'OUVERTE', messages: [], curseur: null, chat: { ouvert: true, repriseLe: null, luParLaBanqueLe: null } });
    // Sans message du client, la conversation n'entre pas dans la boîte de réception
    expect(await ligne(jt.aya!, principal)).toBeUndefined();
  });

  it('une rafale de messages n\'alerte l\'agent qu\'une fois', async () => {
    await horlogeA(minutes(1));
    await ecrire(principal, 'Bonjour, ma carte a été avalée ce matin.');
    await horlogeA(minutes(0.5));
    await ecrire(principal, 'Au distributeur du Plateau.');
    await ecrire(principal, 'Je dois retirer de l\'argent aujourd\'hui.');
    const alertes = await notifications(principal, 'agent.message_client');
    expect(alertes.map((n) => n.canal).sort()).toEqual(['EMAIL', 'IN_APP']);
    const c = await conversationDe(principal);
    expect(c!.dernierMessageClientLe).toEqual(maintenant);
  });

  it('messages relus par curseur ; jamais de note interne', async () => {
    await ok('ajouterNoteInterne', jt.aya!, { chemin: { id: principal.id }, corps: { contenu: 'Note interne : vérifier le journal du GAB' } });
    const tout = await chat(principal);
    expect(tout.messages.map((m: { contenu: string; auteur: string }) => [m.auteur, m.contenu])).toEqual([
      ['CLIENT', 'Bonjour, ma carte a été avalée ce matin.'],
      ['CLIENT', 'Au distributeur du Plateau.'],
      ['CLIENT', 'Je dois retirer de l\'argent aujourd\'hui.'],
    ]);
    expect(tout.curseur).toBe(tout.messages[2].creeLe);
    const suite = await chat(principal, tout.curseur);
    // Le message à l'heure du curseur revient (à dédoublonner par id), rien d'autre
    expect(suite.messages.map((m: { id: string }) => m.id)).toEqual([tout.messages[2].id]);
    expect(suite.curseur).toBe(tout.curseur);
  });
});

describe('boîte de réception des agents', () => {
  it('l\'agent assigné voit la conversation à répondre, non lue, client en ligne ; un autre agent ne la voit pas', async () => {
    const page = await boite(jt.aya!);
    const l = page.donnees.find((c: { reclamation: { id: string } }) => c.reclamation.id === principal.id);
    expect(l).toMatchObject({
      canal: 'WEB', reclamation: { numero: principal.numero, statut: 'OUVERTE', categorie: 'Carte bancaire' }, client: { nom: 'Client Chat' },
      agent: { id: a.comptes.aya!.id, nom: 'Aya Konan' }, aRepondre: true, nonLue: true, clientEnLigne: true,
      dernierMessage: { auteur: 'CLIENT', extrait: 'Je dois retirer de l\'argent aujourd\'hui.' },
    });
    expect(page.compteurs.aRepondre).toBeGreaterThanOrEqual(1);
    expect(page.compteurs.nonLues).toBeGreaterThanOrEqual(1);
    expect(await ligne(jt.mamadou!, principal)).toBeUndefined();
    expect((await appeler('lireConversation', jt.mamadou!, { chemin: { id: l.id } })).statut).toBe(404);
    expect(await ligne(jt.serge!, principal, 'non-lues')).toBeDefined();
    expect(await ligne(jt.fatou!, principal)).toBeDefined();
  });

  it('un superviseur qui lit la conversation d\'un agent ne la marque pas lue ; l\'agent, si', async () => {
    const l = await ligne(jt.serge!, principal);
    const detail = await ok('lireConversation', jt.serge!, { chemin: { id: l.id } });
    expect(detail).toMatchObject({
      id: l.id, description: 'Scénario chat 2 : carte avalée au distributeur', aRepondre: true, nonLue: true, clientEnLigne: true,
    });
    expect(detail.messages.every((m: { type: string }) => m.type !== 'NOTE_INTERNE')).toBe(true);
    expect(detail.operationsPossibles).toContain('REPONDRE_AU_CLIENT');
    expect((await appeler('marquerConversationLue', jt.serge!, { chemin: { id: l.id } })).statut).toBe(204);
    expect((await ligne(jt.aya!, principal)).nonLue).toBe(true);
    // L'Admin Entreprise lit, sans pouvoir répondre ni marquer lue
    const vueAdmin = await ok('lireConversation', jt.fatou!, { chemin: { id: l.id } });
    expect(vueAdmin.operationsPossibles).not.toContain('REPONDRE_AU_CLIENT');
    await ok('marquerConversationLue', jt.fatou!, { chemin: { id: l.id } });
    expect((await ligne(jt.aya!, principal)).nonLue).toBe(true);
    await ok('marquerConversationLue', jt.aya!, { chemin: { id: l.id } });
    expect(await ligne(jt.aya!, principal, 'non-lues')).toBeUndefined();
    expect((await ligne(jt.aya!, principal, 'a-repondre')).nonLue).toBe(false);
    // Le client voit la lecture de la banque
    expect((await chat(principal)).chat.luParLaBanqueLe).toBe(maintenant.toISOString());
  });

  it('après la lecture, un nouveau message alerte de nouveau l\'agent', async () => {
    await horlogeA(minutes(1));
    await ecrire(principal, 'Pouvez-vous me rappeler ?');
    expect(await notifications(principal, 'agent.message_client')).toHaveLength(4);
    const fiche = await ok('lireReclamation', jt.aya!, { chemin: { id: principal.id } });
    expect(fiche.conversation).toMatchObject({ canal: 'WEB', aRepondre: true, nonLue: true, clientEnLigne: true });
  });

  it('fiche d\'un agent : 404 pour une conversation d\'une autre banque', async () => {
    await ok('modifierBanque', jt.sa!, { chemin: { id: j.horizon.id }, corps: { chatWeb: true } });
    const l = await ligne(jt.aya!, principal);
    expect((await appeler('lireConversation', jt.didier!, { chemin: { id: l.id } })).statut).toBe(404);
    expect((await appeler('marquerConversationLue', jt.didier!, { chemin: { id: l.id } })).statut).toBe(404);
    expect(await ligne(jt.didier!, principal)).toBeUndefined();
    // Un client ne lit pas le chat d'une réclamation qui n'est pas la sienne
    const autre = await deposer();
    expect((await appeler('lireConversationClient', autre.jc, { chemin: { id: principal.id } })).statut).toBe(404);
    expect((await appeler('marquerConversationLueClient', autre.jc, { chemin: { id: principal.id } })).statut).toBe(404);
  });
});

describe('réponses de la banque et avis différés', () => {
  it('répondre : la conversation est lue et répondue ; le client voit « la banque », pas l\'agent ; pas d\'e-mail tout de suite', async () => {
    await horlogeA(minutes(1));
    await repondre(principal, 'Bonjour, nous lançons la récupération de votre carte.');
    const l = await ligne(jt.aya!, principal);
    expect(l).toMatchObject({ aRepondre: false, nonLue: false, dernierMessage: { auteur: 'BANQUE' } });
    expect(await notifications(principal, 'client.reponse')).toEqual([]);
    const vu = await chat(principal);
    expect(vu.statut).toBe('EN_COURS');
    const dernier = vu.messages.at(-1);
    expect(dernier).toMatchObject({ auteur: 'BANQUE', type: 'REPONSE_AU_CLIENT', contenu: 'Bonjour, nous lançons la récupération de votre carte.' });
    expect(JSON.stringify(vu)).not.toContain('Konan');
    expect((await ok('lireConversation', jt.aya!, { chemin: { id: l.id } })).messages.at(-1).auteur).toEqual({ type: 'UTILISATEUR', nom: 'Aya Konan' });
  });

  it('lue dans le chat dans les 2 minutes : ni e-mail ni SMS', async () => {
    await horlogeA(minutes(1.5));
    await ouvrirChat(principal);
    await horlogeA(minutes(5));
    expect((await taches.toutes(maintenant)).avisConversations).toBe(0);
    expect(await notifications(principal, 'client.reponse')).toEqual([]);
    const l = await ligne(jt.aya!, principal);
    expect((await ok('lireConversation', jt.aya!, { chemin: { id: l.id } })).luParLeClientLe).not.toBeNull();
    // Plus vu depuis 5 minutes : le client n'est plus en ligne
    expect(l.clientEnLigne).toBe(false);
  });

  it('plusieurs réponses non lues : un seul avis, 2 minutes après la dernière', async () => {
    await repondre(principal, 'La carte est au coffre de l\'agence.');
    await horlogeA(minutes(1));
    await repondre(principal, 'Vous pourrez la retirer demain à l\'agence du Plateau.');
    await horlogeA(minutes(1.5));
    expect((await taches.toutes(maintenant)).avisConversations).toBe(0);
    await horlogeA(minutes(1));
    expect((await taches.toutes(maintenant)).avisConversations).toBe(1);
    const avis = await notifications(principal, 'client.reponse');
    expect(avis.map((n) => n.canal).sort()).toEqual(['EMAIL', 'SMS']);
    await horlogeA(minutes(5));
    expect((await taches.toutes(maintenant)).avisConversations).toBe(0);
    expect(await notifications(principal, 'client.reponse')).toHaveLength(2);
  });

  it('une question non lue : l\'avis demande l\'information ; une résolution prévient tout de suite, sans second avis', async () => {
    await repondre(principal, 'Avez-vous une pièce d\'identité valide ?', jt.aya!, true);
    expect(await notifications(principal, 'client.question')).toEqual([]);
    await horlogeA(minutes(3));
    expect((await taches.toutes(maintenant)).avisConversations).toBe(1);
    expect((await notifications(principal, 'client.question')).map((n) => n.canal).sort()).toEqual(['EMAIL', 'SMS']);
    await ecrire(principal, 'Oui, ma CNI.');
    await ok('resoudreReclamation', jt.aya!, { chemin: { id: principal.id }, corps: { reponseFinale: 'Votre carte vous attend à l\'agence du Plateau.' } });
    expect(await notifications(principal, 'client.resolution')).toHaveLength(2);
    await horlogeA(minutes(5));
    expect((await taches.toutes(maintenant)).avisConversations).toBe(0);
    // Résolue : plus « à répondre », le client confirme ou conteste ; la fiche le montre
    const l = await ligne(jt.aya!, principal);
    expect(l).toMatchObject({ aRepondre: false, reclamation: { statut: 'RESOLUE' } });
    expect((await chat(principal)).statut).toBe('RESOLUE');
  });

  it('client qui n\'a jamais ouvert le chat : la réponse est signalée tout de suite, comme avant', async () => {
    const t = await deposer();
    await repondre(t, 'Bonjour, nous regardons.');
    expect((await notifications(t, 'client.reponse')).map((n) => n.canal).sort()).toEqual(['EMAIL', 'SMS']);
    expect(await conversationDe(t)).toBeNull();
  });
});

describe('disponibilité, limites et fermeture', () => {
  it('banque fermée à midi : le chat annonce la reprise à 14 h', async () => {
    const midi = new Date('2026-09-08T12:30:00Z');
    await horlogeA(midi);
    const t = await deposer();
    expect((await ok('lireMaReclamation', t.jc, { chemin: { id: t.id } })).chat).toEqual({
      ouvert: false, repriseLe: '2026-09-08T14:00:00.000Z', luParLaBanqueLe: null,
    });
  });

  it('30 messages par réclamation et par 10 minutes', async () => {
    const t = await deposer();
    for (let i = 1; i <= 30; i++) await ecrire(t, `Message ${i}`);
    const r = await appeler('envoyerMessageClient', t.jc, { chemin: { id: t.id }, corps: { contenu: 'Message 31' } });
    expect(r.statut).toBe(429);
    expect(r.corps.code).toBe('TROP_DE_REQUETES');
    expect(Number(r.entetes.get('retry-after'))).toBeGreaterThan(0);
  });

  it('refermé : l\'espace client reprend le fil simple, la boîte de réception se ferme', async () => {
    await ok('modifierBanque', jt.sa!, { chemin: { id: a.id }, corps: { chatWeb: false } });
    principal.jc = await sessionClient(principal.jetonSuivi, principal.id);
    expect((await ok('lireMaReclamation', principal.jc, { chemin: { id: principal.id } })).chat).toBeNull();
    expect((await appeler('listerConversations', jt.aya!)).corps.code).toBe('FONCTION_NON_OUVERTE');
    expect((await ok('lireReclamation', jt.aya!, { chemin: { id: principal.id } })).conversation).toBeNull();
    // Aucun avis en attente pour les fichiers suivants
    await horlogeA(minutes(10));
    expect((await taches.toutes(maintenant)).avisConversations).toBe(0);
  });
});
