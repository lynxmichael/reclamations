/**
 * Back-office : files et recherche, actions sur un ticket, notifications in-app.
 * Recette §10, critère 3 : une réclamation urgente alerte immédiatement l'agent, le superviseur,
 * l'Admin Entreprise et le Super Admin ; l'alerte du Super Admin ne contient ni nom ni description.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BaseDonnees } from '../../src/infrastructure/base-de-donnees/base-de-donnees.service.js';
import { ClientApi, connecter, demarrerApi, fermerOutils, jeu, nouvelleIp, type ApiDeTest } from './environnement.js';

let api: ApiDeTest;
let client: ClientApi;
let bd: BaseDonnees;
const j = jeu();
const jt: Record<string, string> = {};
let compteur = 400;

async function nouveauTicket(categorie = 'Crédit', nom = 'Client Back Office'): Promise<{ id: string; numero: string; jetonSuivi: string }> {
  const r = await client.appeler('deposerReclamation', {
    ip: nouvelleIp(), chemin: { code: j.alpha.points.qr },
    corps: { categorieId: j.alpha.categories[categorie], description: `Réclamation ${compteur}`, nom, telephone: `0700000${compteur++}`, consentement: true, versionPolitique: '2026-09' },
  });
  expect(r.statut).toBe(201);
  const t = await bd.enSysteme((tx) => tx.reclamation.findUniqueOrThrow({ where: { jetonSuivi: r.corps.jetonSuivi } }));
  return { id: t.id, numero: t.numero, jetonSuivi: r.corps.jetonSuivi };
}

async function sessionClient(jetonSuivi: string): Promise<string> {
  const o = await client.appeler('demanderCodeOtp', { chemin: { jetonSuivi }, corps: { canal: 'SMS' } });
  expect(o.statut).toBe(202);
  const ref = await bd.enSysteme((tx) => tx.reclamation.findUniqueOrThrow({ where: { jetonSuivi }, select: { id: true } }));
  const sms = await bd.enSysteme((tx) => tx.notification.findFirstOrThrow({ where: { reclamationId: ref.id, modele: 'client.otp' }, orderBy: { creeLe: 'desc' } }));
  return (await client.appeler('verifierCodeOtp', { chemin: { jetonSuivi }, corps: { code: /(\d{6})/.exec(sms.contenu)![1] } })).corps.jetonClient;
}

beforeAll(async () => {
  api = await demarrerApi();
  client = new ClientApi(api.url);
  bd = new BaseDonnees(api.config.baseDeDonneesUrl);
  for (const [cle, email] of Object.entries({
    aya: j.alpha.comptes.aya.email, serge: j.alpha.comptes.serge.email, fatou: j.alpha.comptes.fatou.email, sa: j.superAdmin.email,
  })) jt[cle] = (await connecter(client, email)).jeton;
});

afterAll(async () => {
  await bd.fermer();
  await api.fermer();
  await fermerOutils();
});

describe('réclamation urgente (critère 3)', () => {
  it('une catégorie urgente alerte superviseurs, Admin Entreprise et Super Admin ; l\'agent l\'est à l\'assignation', async () => {
    const t = await nouveauTicket('Fraude suspectée', 'Victime Fraude');
    const alertes = await bd.enSysteme((tx) => tx.notification.findMany({ where: { modele: { in: ['reclamation.urgente', 'plateforme.urgente'] }, OR: [{ reclamationId: t.id }, { contenu: { contains: t.numero } }] } }));
    const destinataires = new Set(alertes.map((a) => a.destinataireUtilisateurId));
    for (const qui of [j.alpha.comptes.serge.id, j.alpha.comptes.mariam.id, j.alpha.comptes.fatou.id, j.superAdmin.id]) expect(destinataires.has(qui)).toBe(true);
    expect(alertes.filter((a) => a.destinataireUtilisateurId === j.superAdmin.id).map((a) => a.canal).sort()).toEqual(['EMAIL', 'IN_APP']);
    await client.appeler('assignerReclamation', { jeton: jt.serge, chemin: { id: t.id }, corps: { agentId: j.alpha.comptes.aya.id } });
    const agent = await bd.enSysteme((tx) => tx.notification.count({ where: { reclamationId: t.id, modele: 'reclamation.urgente', destinataireUtilisateurId: j.alpha.comptes.aya.id } }));
    expect(agent).toBe(2);

    // Alerte du Super Admin : banque, numéro, catégorie, heure — ni nom, ni description
    const sa = await client.appeler('listerNotificationsPlateforme', { jeton: jt.sa, requete: { nonLues: true, parPage: 100 } });
    const n = sa.corps.donnees.find((x: { contenu: string }) => x.contenu.includes(t.numero));
    expect(n.contenu).toMatch(/^Banque Alpha · ALP-\d{4}-\d{6} · Fraude suspectée · \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/);
    expect(n.contenu).not.toContain('Victime');
    expect(n.reclamationId).toBeNull();
    expect((await client.appeler('marquerNotificationPlateformeLue', { jeton: jt.sa, chemin: { id: n.id } })).statut).toBe(204);
    const apres = await client.appeler('listerNotificationsPlateforme', { jeton: jt.sa, requete: { nonLues: true, parPage: 100 } });
    expect(apres.corps.nonLues).toBe(sa.corps.nonLues - 1);
  });

  it('passer une réclamation en « Urgente » alerte aussitôt les quatre destinataires', async () => {
    const t = await nouveauTicket();
    await client.appeler('assignerReclamation', { jeton: jt.serge, chemin: { id: t.id }, corps: { agentId: j.alpha.comptes.aya.id } });
    const r = await client.appeler('changerPriorite', { jeton: jt.aya, chemin: { id: t.id }, corps: { priorite: 'URGENTE' } });
    expect(r.corps.priorite).toBe('URGENTE');
    const alertes = await bd.enSysteme((tx) => tx.notification.findMany({ where: { reclamationId: t.id, modele: 'reclamation.urgente', canal: 'IN_APP' } }));
    expect(new Set(alertes.map((a) => a.destinataireUtilisateurId))).toEqual(new Set([j.alpha.comptes.aya.id, j.alpha.comptes.serge.id, j.alpha.comptes.fatou.id]));
    const sa = await bd.enSysteme((tx) => tx.notification.count({ where: { modele: 'plateforme.urgente', contenu: { contains: t.numero } } }));
    expect(sa).toBe(2);
  });
});

describe('files de traitement et recherche (§6.2)', () => {
  it('compteurs des onglets, filtres, tri et pagination', async () => {
    const a = await nouveauTicket('Carte bancaire', 'Zoé Filtre');
    const b = await nouveauTicket('Carte bancaire', 'Zoé Filtre');
    const liste = await client.appeler('listerReclamations', { jeton: jt.serge, requete: { recherche: 'Zoé Filtre', tri: 'creeLe' } });
    expect(liste.corps.donnees.map((x: { id: string }) => x.id)).toEqual([a.id, b.id]);
    expect(liste.corps.compteurs.recues).toBeGreaterThanOrEqual(2);
    const page = await client.appeler('listerReclamations', { jeton: jt.serge, requete: { recherche: 'Zoé Filtre', parPage: 1, page: 2, tri: 'creeLe' } });
    expect(page.corps.donnees.map((x: { id: string }) => x.id)).toEqual([b.id]);
    expect(page.corps.pagination).toEqual({ page: 2, parPage: 1, total: 2 });
    const parNumero = await client.appeler('listerReclamations', { jeton: jt.serge, requete: { recherche: a.numero.slice(-6) } });
    expect(parNumero.corps.donnees.some((x: { id: string }) => x.id === a.id)).toBe(true);
    const parStatut = await client.appeler('listerReclamations', { jeton: jt.serge, requete: { statut: ['RESOLUE', 'CLOTUREE'], categorieId: j.alpha.categories['Carte bancaire'] } });
    expect(parStatut.corps.donnees.every((x: { statut: string }) => ['RESOLUE', 'CLOTUREE'].includes(x.statut))).toBe(true);
    const canal = await client.appeler('listerReclamations', { jeton: jt.serge, requete: { canal: 'QR_CODE', agenceId: j.alpha.agences.Plateau, priorite: 'NORMALE', du: '2020-01-01T00:00:00Z', au: '2100-01-01T00:00:00Z', tri: '-priorite' } });
    expect(canal.statut).toBe(200);
    const urgentes = await client.appeler('listerReclamations', { jeton: jt.serge, requete: { file: 'urgentes' } });
    expect(urgentes.corps.donnees.every((x: { priorite: string }) => x.priorite === 'URGENTE')).toBe(true);
    const invalide = await client.appeler('listerReclamations', { jeton: jt.serge, requete: { parPage: 500 } });
    expect(invalide.statut).toBe(400);
  });

  it('un agent n\'a pas de file « reçues » ; « assignées à moi » ne contient que les siennes', async () => {
    const r = await client.appeler('listerReclamations', { jeton: jt.aya, requete: { file: 'recues' } });
    expect(r.corps.donnees).toEqual([]);
    expect(r.corps.compteurs.recues).toBe(0);
    const miennes = await client.appeler('listerReclamations', { jeton: jt.aya, requete: { file: 'assignees', parPage: 100 } });
    expect(miennes.corps.donnees.every((x: { agent: { id: string } }) => x.agent.id === j.alpha.comptes.aya.id)).toBe(true);
  });
});

describe('actions sur un ticket', () => {
  it('prise en charge (refusée sans agent), escalade, clôture forcée motivée', async () => {
    const t = await nouveauTicket();
    const sansAgent = await client.appeler('prendreEnCharge', { jeton: jt.serge, chemin: { id: t.id } });
    expect(sansAgent.statut).toBe(409);
    expect(sansAgent.corps.code).toBe('AUCUN_AGENT_ASSIGNE');
    const agentInvalide = await client.appeler('assignerReclamation', { jeton: jt.serge, chemin: { id: t.id }, corps: { agentId: j.alpha.comptes.serge.id } });
    expect(agentInvalide.statut).toBe(422);
    await client.appeler('assignerReclamation', { jeton: jt.serge, chemin: { id: t.id }, corps: { agentId: j.alpha.comptes.aya.id } });
    const p = await client.appeler('prendreEnCharge', { jeton: jt.aya, chemin: { id: t.id } });
    expect(p.corps.statut).toBe('EN_COURS');
    expect(p.corps.actionsPossibles).toEqual(['QUESTIONNER_CLIENT', 'RESOUDRE']);
    const e = await client.appeler('escaladerReclamation', { jeton: jt.aya, chemin: { id: t.id }, corps: { motif: 'Montant au-delà de mon habilitation' } });
    expect(e.corps.escaladeeVers.nom).toBe('Serge Kouadio');
    expect(e.corps.messages.at(-1)).toMatchObject({ type: 'NOTE_INTERNE', contenu: 'Montant au-delà de mon habilitation' });
    const notif = await client.appeler('listerNotifications', { jeton: jt.serge, requete: { nonLues: true, parPage: 100 } });
    expect(notif.corps.donnees.some((n: { modele: string; reclamationId: string }) => n.modele === 'superviseur.escalade' && n.reclamationId === t.id)).toBe(true);
    const sansMotif = await client.appeler('cloturerDeForce', { jeton: jt.serge, chemin: { id: t.id }, corps: { motif: 'DOUBLON', precision: '   ' } });
    expect(sansMotif.statut).toBe(422);
    const c = await client.appeler('cloturerDeForce', { jeton: jt.serge, chemin: { id: t.id }, corps: { motif: 'DOUBLON', precision: 'Doublon de ALP-2026-000001' } });
    expect(c.corps.cloture).toEqual({ mode: 'FORCEE', motif: 'DOUBLON', precision: 'Doublon de ALP-2026-000001', par: { id: j.alpha.comptes.serge.id, nom: 'Serge Kouadio' } });
    expect(c.corps.sla.etat).toBe('ARRETE');
    const encore = await client.appeler('resoudreReclamation', { jeton: jt.aya, chemin: { id: t.id }, corps: { reponseFinale: 'x' } });
    expect(encore.statut).toBe(409);
    expect(encore.corps.code).toBe('TRANSITION_INTERDITE');
    // Une note interne reste possible sur un ticket clôturé
    expect((await client.appeler('ajouterNoteInterne', { jeton: jt.serge, chemin: { id: t.id }, corps: { contenu: 'Client prévenu par téléphone' } })).statut).toBe(201);
  });

  it('contestation dans le délai : le ticket revient en cours, compté comme réouverture (arbitrage 5)', async () => {
    const t = await nouveauTicket();
    await client.appeler('assignerReclamation', { jeton: jt.serge, chemin: { id: t.id }, corps: { agentId: j.alpha.comptes.aya.id } });
    await client.appeler('repondreAuClient', { jeton: jt.aya, chemin: { id: t.id }, corps: { contenu: 'Nous regardons.' } });
    const r = await client.appeler('resoudreReclamation', { jeton: jt.aya, chemin: { id: t.id }, corps: { reponseFinale: 'C\'est corrigé.' } });
    expect(r.corps.jalons.clotureAutoPrevueLe).not.toBeNull();
    const jc = await sessionClient(t.jetonSuivi);
    const vue = await client.appeler('lireMaReclamation', { jeton: jc, chemin: { id: t.id } });
    expect(vue.corps.actionsPossibles.sort()).toEqual(['CONFIRMER', 'CONTESTER']);
    expect(vue.corps.clotureAutoPrevueLe).not.toBeNull();
    const c = await client.appeler('contesterResolution', { jeton: jc, chemin: { id: t.id }, corps: { motif: 'Le montant n\'est pas revenu sur mon compte.' } });
    expect(c.corps.statut).toBe('EN_COURS');
    const f = await client.appeler('lireReclamation', { jeton: jt.aya, chemin: { id: t.id } });
    expect(f.corps.nbReouvertures).toBe(1);
    expect(f.corps.sla.etat).not.toBe('ARRETE');
    expect(f.corps.sla.respecte).toBeNull();
    const notif = await client.appeler('listerNotifications', { jeton: jt.aya, requete: { parPage: 100 } });
    const contestation = notif.corps.donnees.find((n: { modele: string; reclamationId: string }) => n.modele === 'agent.contestation' && n.reclamationId === t.id);
    expect(contestation).toBeTruthy();
    expect((await client.appeler('marquerNotificationLue', { jeton: jt.aya, chemin: { id: contestation.id } })).statut).toBe(204);
    expect((await client.appeler('marquerNotificationLue', { jeton: jt.serge, chemin: { id: contestation.id } })).statut).toBe(404);
    expect((await client.appeler('marquerToutesNotificationsLues', { jeton: jt.aya })).statut).toBe(204);
    expect((await client.appeler('listerNotifications', { jeton: jt.aya })).corps.nonLues).toBe(0);
  });

  it('l\'Admin Entreprise consulte une fiche mais n\'agit pas sur le ticket', async () => {
    const t = await nouveauTicket();
    const f = await client.appeler('lireReclamation', { jeton: jt.fatou, chemin: { id: t.id } });
    expect(f.statut).toBe(200);
    expect(f.corps.actionsPossibles).toEqual([]);
    expect(f.corps.operationsPossibles).toEqual(['CONSULTER']);
    expect((await client.appeler('ajouterNoteInterne', { jeton: jt.fatou, chemin: { id: t.id }, corps: { contenu: 'x' } })).statut).toBe(403);
  });
});
