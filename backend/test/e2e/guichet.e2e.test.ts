/**
 * Étape 21 : saisie d'une réclamation par le personnel (guichet, téléphone) pour un client sans
 * smartphone ; réclamations retrouvées par le client à son numéro ; lien de suivi renvoyé ; doublons
 * signalés et rattachés ; dossiers d'un agent désactivé ou absent, à réassigner, et alertes à son
 * superviseur.
 *
 * L'horloge de l'API est pilotée par le test, à une date passée (les réclamations du fichier
 * n'entrent pas dans les périodes « depuis le début » des fichiers suivants). À la fin, Mamadou est
 * réactivé, l'absence retirée et l'attribution refermée, comme au départ.
 */
import { randomInt } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BaseDonnees } from '../../src/infrastructure/base-de-donnees/base-de-donnees.service.js';
import { ClientApi, connecter, demarrerApi, FICHIERS, fermerOutils, jeu, nouvelleIp, type ApiDeTest, type Requete } from './environnement.js';

const j = jeu();
const a = j.alpha;
// Mardi 8 septembre 2026, 09:30 à Abidjan (UTC) : la banque est ouverte
let maintenant = new Date('2026-09-08T09:30:00Z');
let api: ApiDeTest;
let client: ClientApi;
let bd: BaseDonnees;
const jt: Record<string, string> = {};

const COMPTES = {
  sa: j.superAdmin.email, fatou: a.comptes.fatou!.email, serge: a.comptes.serge!.email, mariam: a.comptes.mariam!.email,
  aya: a.comptes.aya!.email, mamadou: a.comptes.mamadou!.email,
};
const id = { aya: a.comptes.aya!.id, mamadou: a.comptes.mamadou!.id, ibrahim: a.comptes.ibrahim!.id, serge: a.comptes.serge!.id };
/** Numéros propres à ce lancement : les limites de débit (Redis) ne se cumulent pas d'un lancement à l'autre */
const serie = String(randomInt(100, 999));
const tel = (n: number) => `01${serie}${String(n).padStart(5, '0')}`;
const e164 = (n: number) => `+225${tel(n)}`;
let absence: string | null = null;

async function connexions() {
  for (const [cle, email] of Object.entries(COMPTES)) jt[cle] = (await connecter(client, email, () => maintenant)).jeton;
}

const appeler = async (op: string, jeton: string | undefined, o: Parameters<ClientApi['appeler']>[1] = {}) => client.appeler(op, { ...(jeton ? { jeton } : {}), ...o });
const ok = async (op: string, jeton: string | undefined, o: Parameters<ClientApi['appeler']>[1] = {}) => {
  const r = await appeler(op, jeton, o);
  expect(r.statut, `${op} : ${JSON.stringify(r.corps)}`).toBeLessThan(300);
  return r.corps;
};
const enBase = <T>(f: (tx: Parameters<Parameters<BaseDonnees['enSysteme']>[0]>[0]) => Promise<T>) => bd.enSysteme(f);
const ticket = (numero: string) => enBase((tx) => tx.reclamation.findFirstOrThrow({ where: { numero } }));

/** Saisie au guichet ou au téléphone, par un membre du personnel. */
const saisir = (jeton: string, corps: Record<string, unknown>, o: { cle?: string; fichiers?: Requete['fichiers'] } = {}) =>
  appeler('saisirReclamation', jeton, {
    corps: { categorieId: a.categories['Frais et prélèvements'], consentementInforme: true, ...corps },
    ...(o.cle ? { entetes: { 'Idempotency-Key': o.cle } } : {}),
    ...(o.fichiers ? { fichiers: o.fichiers } : {}),
  });

/** Dépôt d'un client par le QR code du Plateau. */
async function deposer(categorie: string, telephone: string, description: string) {
  const r = await appeler('deposerReclamation', undefined, {
    ip: nouvelleIp(), chemin: { code: a.points.qr },
    corps: { categorieId: a.categories[categorie], description, nom: 'Yao Kouassi', telephone, consentement: true, versionPolitique: '2026-09' },
  });
  expect(r.statut, JSON.stringify(r.corps)).toBe(201);
  return r.corps as { numero: string; jetonSuivi: string; lienSuivi: string };
}

/** Le dernier code envoyé à ce numéro ou à cette adresse. */
async function dernierCode(destination: string): Promise<string | null> {
  const n = await enBase((tx) => tx.notification.findFirst({ where: { destination, modele: 'client.otp' }, orderBy: { creeLe: 'desc' } }));
  return n?.contenu.match(/code est (\d{6})/)?.[1] ?? null;
}

/** Session de l'espace client, par « Retrouver mes réclamations ». */
async function sessionClient(contact: string, destination: string): Promise<string> {
  await ok('demanderCodeAcces', undefined, { ip: nouvelleIp(), chemin: { slug: 'alpha' }, corps: { contact } });
  const code = await dernierCode(destination);
  expect(code).not.toBeNull();
  return (await ok('verifierCodeAcces', undefined, { ip: nouvelleIp(), chemin: { slug: 'alpha' }, corps: { contact, code } })).jetonClient;
}

beforeAll(async () => {
  api = await demarrerApi({ horloge: () => maintenant });
  client = new ClientApi(api.url);
  bd = new BaseDonnees(api.config.baseDeDonneesUrl);
  await connexions();
});

afterAll(async () => {
  await connexions().catch(() => undefined);
  if (absence) await appeler('supprimerAbsence', jt.fatou!, { chemin: { id: absence } });
  await appeler('modifierBanque', jt.sa!, { chemin: { id: a.id }, corps: { attributionAutomatique: false } });
  await appeler('reactiverUtilisateur', jt.fatou!, { chemin: { id: id.mamadou } });
  await bd.fermer();
  await api.fermer();
  await fermerOutils();
});

const numeros: Record<string, string> = {};

describe('saisie par le personnel, au guichet et au téléphone', () => {
  it('Aya saisit au guichet du Plateau pour une cliente sans smartphone : accusé par SMS, elle la traite', async () => {
    const r = await saisir(jt.aya!, {
      canal: 'GUICHET', agenceId: a.agences.Plateau, description: 'Frais de SMS prélevés chaque mois sans souscription.',
      nom: 'Ahou Kouamé', telephone: tel(1),
    }, { cle: `guichet-${serie}`, fichiers: [{ champ: 'fichiers', nom: 'releve.pdf', contenu: FICHIERS.pdf, type: 'application/pdf' }] });
    expect(r.statut, JSON.stringify(r.corps)).toBe(201);
    expect(r.corps).toMatchObject({ envoiPar: ['SMS'], agent: { id: id.aya, nom: 'Aya Konan' } });
    expect(r.corps.lienSuivi).toMatch(/\/suivi\//);
    numeros.guichet = r.corps.numero;

    const t = await ticket(r.corps.numero);
    expect(t).toMatchObject({ canal: 'GUICHET', agenceId: a.agences.Plateau, agentId: id.aya, statut: 'OUVERTE', consentementVersion: '2026-09' });
    const point = await enBase((tx) => tx.pointDepot.findUniqueOrThrow({ where: { id: t.pointDepotId } }));
    expect(point).toMatchObject({ canal: 'GUICHET', libelle: 'Guichet', agenceId: a.agences.Plateau });
    // L'accusé de dépôt, comme au portail
    const accuse = await enBase((tx) => tx.notification.findFirstOrThrow({ where: { reclamationId: t.id, modele: 'client.depot' } }));
    expect(accuse).toMatchObject({ canal: 'SMS', destination: e164(1) });
    // La création est l'acte d'Aya : chronologie, journal d'audit
    const f = await ok('lireReclamation', jt.aya!, { chemin: { id: t.id } });
    expect(f.saisiePar).toEqual({ id: id.aya, nom: 'Aya Konan' });
    const etapes = f.chronologie.map((e: { type: string; acteur: { nom: string | null } }) => [e.type, e.acteur.nom]);
    expect(etapes[0]).toEqual(['CREATION', 'Aya Konan']);
    expect(etapes).toContainEqual(['ASSIGNATION', 'Aya Konan']);
    expect(f.piecesJointes).toHaveLength(1);
    const audit = await enBase((tx) => tx.journalAudit.findFirstOrThrow({ where: { entiteId: t.id, action: 'reclamation.saisie' } }));
    expect(audit.acteurId).toBe(id.aya);

    // La même clé : le même accusé, aucune réclamation de plus
    const encore = await saisir(jt.aya!, {
      canal: 'GUICHET', agenceId: a.agences.Plateau, description: 'Frais de SMS prélevés chaque mois sans souscription.',
      nom: 'Ahou Kouamé', telephone: tel(1),
    }, { cle: `guichet-${serie}`, fichiers: [{ champ: 'fichiers', nom: 'releve.pdf', contenu: FICHIERS.pdf, type: 'application/pdf' }] });
    expect(encore.corps.numero).toBe(r.corps.numero);
    expect(await enBase((tx) => tx.reclamation.count({ where: { client: { telephone: e164(1) } } }))).toBe(1);
  });

  it('Serge saisit pendant un appel, urgente, sans agent : elle attend dans la file « Reçues »', async () => {
    const r = await saisir(jt.serge!, {
      canal: 'TELEPHONE', agenceId: a.agences['Cocody Angré'], categorieId: a.categories['Virement et transfert'],
      description: 'Appel du client : virement de 120 000 FCFA envoyé lundi, toujours pas reçu.', nom: 'Bakary Fofana', telephone: tel(2), urgente: true,
    });
    expect(r.statut, JSON.stringify(r.corps)).toBe(201);
    expect(r.corps.agent).toBeNull();
    numeros.telephone = r.corps.numero;
    const t = await ticket(r.corps.numero);
    expect(t).toMatchObject({ canal: 'TELEPHONE', agenceId: a.agences['Cocody Angré'], agentId: null, priorite: 'URGENTE' });
    const point = await enBase((tx) => tx.pointDepot.findUniqueOrThrow({ where: { id: t.pointDepotId } }));
    expect(point).toMatchObject({ canal: 'TELEPHONE', agenceId: null });
    const recues = await ok('listerReclamations', jt.serge!, { requete: { file: 'recues', canal: 'TELEPHONE' } });
    expect(recues.donnees.map((x: { numero: string }) => x.numero)).toContain(r.corps.numero);
    // L'alerte urgente part comme pour un dépôt du portail
    expect(await enBase((tx) => tx.notification.count({ where: { reclamationId: t.id, modele: 'reclamation.urgente' } }))).toBeGreaterThan(0);
  });

  it('le point « Guichet » sert à toutes les saisies de l\'agence ; il ne s\'ouvre pas au portail et ne se gère pas', async () => {
    const r = await saisir(jt.aya!, { canal: 'GUICHET', agenceId: a.agences.Plateau, description: 'Deuxième client au guichet.', nom: 'Awa Diallo', email: `awa.${serie}@exemple.ci` });
    expect(r.statut).toBe(201);
    expect(r.corps.envoiPar).toEqual(['EMAIL']);
    const guichets = await enBase((tx) => tx.pointDepot.findMany({ where: { tenantId: a.id, canal: 'GUICHET' } }));
    expect(guichets).toHaveLength(1);
    expect((await appeler('lireFormulaireDepot', undefined, { chemin: { code: guichets[0]!.code } })).statut).toBe(404);
    const points = await ok('listerPointsDepot', jt.fatou!);
    expect(points.map((p: { canal: string }) => p.canal)).not.toContain('GUICHET');
    expect((await appeler('modifierPointDepot', jt.fatou!, { chemin: { id: guichets[0]!.id }, corps: { libelle: 'Autre' } })).statut).toBe(404);
  });

  it('refus : agence du guichet, contact, consentement, rôle', async () => {
    const sansAgence = await saisir(jt.aya!, { canal: 'GUICHET', description: 'x', nom: 'Client', telephone: tel(3) });
    expect(sansAgence.statut).toBe(400);
    expect(sansAgence.corps.erreurs.map((e: { champ: string }) => e.champ)).toEqual(['agenceId']);
    const sansContact = await saisir(jt.aya!, { canal: 'TELEPHONE', description: 'x', nom: 'Client' });
    expect(sansContact.statut).toBe(400);
    const mauvaisNumero = await saisir(jt.aya!, { canal: 'TELEPHONE', description: 'x', nom: 'Client', telephone: '07 08' });
    expect(mauvaisNumero.corps.erreurs).toEqual([expect.objectContaining({ champ: 'telephone' })]);
    const sansConsentement = await appeler('saisirReclamation', jt.aya!, { corps: { canal: 'TELEPHONE', categorieId: a.categories['Crédit'], description: 'x', nom: 'Client', telephone: tel(3) } });
    expect(sansConsentement.statut).toBe(400);
    // L'Admin Entreprise ne traite pas de réclamation
    expect((await saisir(jt.fatou!, { canal: 'TELEPHONE', description: 'x', nom: 'Client', telephone: tel(3) })).statut).toBe(403);
  });
});

describe('retrouver ses réclamations (le lien de suivi est perdu)', () => {
  it('l\'accueil du portail connaît la banque par son adresse', async () => {
    expect(await ok('lireBanquePortail', undefined, { chemin: { slug: 'alpha' } })).toMatchObject({ nom: 'Banque Alpha', slug: 'alpha' });
    expect((await appeler('lireBanquePortail', undefined, { chemin: { slug: 'inconnue' } })).statut).toBe(404);
  });

  it('un code au numéro du dépôt, puis toutes ses réclamations dans la banque', async () => {
    const d = await ok('demanderCodeAcces', undefined, { ip: nouvelleIp(), chemin: { slug: 'alpha' }, corps: { contact: tel(1) } });
    expect(d).toMatchObject({ canal: 'SMS', expireDans: 600 });
    expect(d.destinationMasquee).toMatch(/^\+225 01 •• •• •• \d\d$/);
    const code = (await dernierCode(e164(1)))!;
    const faux = await appeler('verifierCodeAcces', undefined, { ip: nouvelleIp(), chemin: { slug: 'alpha' }, corps: { contact: tel(1), code: code === '000000' ? '111111' : '000000' } });
    expect(faux).toMatchObject({ statut: 422, corps: { code: 'CODE_OTP_INVALIDE' } });
    const s = await ok('verifierCodeAcces', undefined, { ip: nouvelleIp(), chemin: { slug: 'alpha' }, corps: { contact: `+225 ${tel(1)}`, code } });
    const liste = await ok('listerMesReclamations', s.jetonClient);
    expect(liste.donnees.map((r: { numero: string }) => r.numero)).toEqual([numeros.guichet]);
    // Le code ne sert qu'une fois
    expect((await appeler('verifierCodeAcces', undefined, { ip: nouvelleIp(), chemin: { slug: 'alpha' }, corps: { contact: tel(1), code } })).statut).toBe(422);
  });

  it('un numéro inconnu : la même réponse, aucun SMS ; son code est toujours faux', async () => {
    const d = await ok('demanderCodeAcces', undefined, { ip: nouvelleIp(), chemin: { slug: 'alpha' }, corps: { contact: tel(99) } });
    expect(d).toMatchObject({ canal: 'SMS', expireDans: 600 });
    expect(await dernierCode(e164(99))).toBeNull();
    const v = await appeler('verifierCodeAcces', undefined, { ip: nouvelleIp(), chemin: { slug: 'alpha' }, corps: { contact: tel(99), code: '123456' } });
    expect(v).toMatchObject({ statut: 422, corps: { code: 'CODE_OTP_INVALIDE' } });
    // Par e-mail aussi, sans dire si l'adresse est connue
    expect((await ok('demanderCodeAcces', undefined, { ip: nouvelleIp(), chemin: { slug: 'alpha' }, corps: { contact: 'personne@exemple.ci' } })).canal).toBe('EMAIL');
  });

  it('anti-robot, contact illisible, 3 codes par heure et par numéro', async () => {
    expect((await appeler('demanderCodeAcces', undefined, { ip: nouvelleIp(), chemin: { slug: 'alpha' }, corps: { contact: tel(98) }, antiRobot: false })).statut).toBe(400);
    expect((await appeler('demanderCodeAcces', undefined, { ip: nouvelleIp(), chemin: { slug: 'alpha' }, corps: { contact: 'pas un numéro' } })).statut).toBe(400);
    for (let i = 0; i < 3; i++) await ok('demanderCodeAcces', undefined, { ip: nouvelleIp(), chemin: { slug: 'alpha' }, corps: { contact: tel(98) } });
    expect((await appeler('demanderCodeAcces', undefined, { ip: nouvelleIp(), chemin: { slug: 'alpha' }, corps: { contact: tel(98) } })).statut).toBe(429);
  });
});

describe('lien de suivi renvoyé par la banque', () => {
  it('aux seules coordonnées du dossier, par l\'agent assigné ou le superviseur, 3 fois par heure', async () => {
    const t = await ticket(numeros.guichet!);
    const r = await ok('renvoyerLienSuivi', jt.aya!, { chemin: { id: t.id } });
    expect(r.envois).toEqual([{ canal: 'SMS', destinationMasquee: expect.stringMatching(/^\+225 01 •• •• •• \d\d$/) }]);
    const n = await enBase((tx) => tx.notification.findFirstOrThrow({ where: { reclamationId: t.id, modele: 'client.lien_suivi' } }));
    expect(n).toMatchObject({ canal: 'SMS', destination: e164(1) });
    expect(n.contenu).toContain(`/suivi/${t.jetonSuivi}`);
    expect(await enBase((tx) => tx.journalAudit.count({ where: { entiteId: t.id, action: 'reclamation.lien_suivi_renvoye' } }))).toBe(1);
    // Un autre agent ne la voit pas ; l'Admin Entreprise ne traite pas
    expect((await appeler('renvoyerLienSuivi', jt.mamadou!, { chemin: { id: t.id } })).statut).toBe(404);
    expect((await appeler('renvoyerLienSuivi', jt.fatou!, { chemin: { id: t.id } })).statut).toBe(403);
    await ok('renvoyerLienSuivi', jt.serge!, { chemin: { id: t.id } });
    await ok('renvoyerLienSuivi', jt.aya!, { chemin: { id: t.id } });
    expect((await appeler('renvoyerLienSuivi', jt.aya!, { chemin: { id: t.id } })).statut).toBe(429);
  });
});

describe('doublons : signalés, puis rattachés à la réclamation principale', () => {
  const yao = { tel: tel(10) };
  let principale: { id: string; numero: string; jetonSuivi: string };
  let doublon: { id: string; numero: string; jetonSuivi: string };

  it('même client, même catégorie, non clôturées : doublon possible dans la file et sur la fiche', async () => {
    const p = await deposer('Carte bancaire', yao.tel, 'Le distributeur a avalé ma carte hier soir.');
    maintenant = new Date(maintenant.getTime() + 60_000);
    const d = await deposer('Carte bancaire', yao.tel, 'Toujours pas de nouvelles de ma carte avalée, je redépose.');
    const autre = await deposer('Crédit', yao.tel, 'Une question sur mon prêt.');
    principale = await ticket(p.numero);
    doublon = await ticket(d.numero);
    const ligne = async (numero: string) => (await ok('listerReclamations', jt.serge!, { requete: { recherche: numero } })).donnees[0];
    expect((await ligne(p.numero)).doublonPossible).toBe(true);
    expect((await ligne(d.numero)).doublonPossible).toBe(true);
    expect((await ligne(autre.numero)).doublonPossible).toBe(false);
    const f = await ok('lireReclamation', jt.serge!, { chemin: { id: doublon.id } });
    expect(f.duMemeClient.map((x: { numero: string; doublonPossible: boolean; accessible: boolean }) => [x.numero, x.doublonPossible, x.accessible]))
      .toEqual([[autre.numero, false, true], [p.numero, true, true]]);
    expect(f.actionsPossibles).toContain('RATTACHER');
  });

  it('l\'agent du seul doublon ne voit pas la principale : il ne peut pas la rattacher', async () => {
    await ok('assignerReclamation', jt.serge!, { chemin: { id: doublon.id }, corps: { agentId: id.aya } });
    const f = await ok('lireReclamation', jt.aya!, { chemin: { id: doublon.id } });
    expect(f.duMemeClient.find((x: { numero: string }) => x.numero === principale.numero)).toMatchObject({ doublonPossible: true, accessible: false });
    expect((await appeler('rattacherReclamation', jt.aya!, { chemin: { id: doublon.id }, corps: { principaleId: principale.id } })).statut).toBe(404);
  });

  it('refus : elle-même, une autre cliente', async () => {
    const meme = await appeler('rattacherReclamation', jt.serge!, { chemin: { id: doublon.id }, corps: { principaleId: doublon.id } });
    expect(meme).toMatchObject({ statut: 422, corps: { code: 'RATTACHEMENT_IMPOSSIBLE' } });
    const autreCliente = await ticket(numeros.guichet!);
    const autre = await appeler('rattacherReclamation', jt.serge!, { chemin: { id: doublon.id }, corps: { principaleId: autreCliente.id } });
    expect(autre).toMatchObject({ statut: 422, corps: { code: 'RATTACHEMENT_IMPOSSIBLE' } });
  });

  it('Serge rattache le doublon : clôturé « Doublon », un seul message au client, le lien de la principale', async () => {
    const f = await ok('rattacherReclamation', jt.serge!, { chemin: { id: doublon.id }, corps: { principaleId: principale.id } });
    expect(f).toMatchObject({
      statut: 'CLOTUREE', rattacheeA: { id: principale.id, numero: principale.numero, chemin: null },
      cloture: { mode: 'FORCEE', motif: 'DOUBLON', precision: `Rattachée à ${principale.numero}`, par: { id: id.serge } },
      sla: { etat: 'ARRETE' },
    });
    expect(f.chronologie.at(-1)).toMatchObject({ type: 'RATTACHEMENT', statutApres: 'CLOTUREE', visibleClient: true });
    const p = await ok('lireReclamation', jt.serge!, { chemin: { id: principale.id } });
    expect(p.doublonsRattaches).toEqual([{ id: doublon.id, numero: doublon.numero, chemin: null }]);
    expect(p.chronologie.at(-1)).toMatchObject({ type: 'RATTACHEMENT', statutApres: null, visibleClient: false });
    expect(p.statut).toBe('OUVERTE');
    // Un seul message, avec le lien de la principale ; ni clôture ordinaire ni enquête
    const messages = await enBase((tx) => tx.notification.findMany({ where: { reclamationId: doublon.id, modele: { startsWith: 'client.' } }, orderBy: { creeLe: 'asc' } }));
    expect(messages.map((m) => m.modele)).toEqual(['client.depot', 'client.rattachement']);
    expect(messages[1]!.contenu).toContain(`jointe à ${principale.numero}`);
    expect(messages[1]!.contenu).toContain(`/suivi/${principale.jetonSuivi}`);
    expect(await bd.enBanque(a.id, (tx) => tx.enqueteSatisfaction.count({ where: { reclamationId: doublon.id } }))).toBe(0);
    // Le suivi du doublon renvoie à la principale
    const suivi = await ok('lireSuivi', undefined, { chemin: { jetonSuivi: doublon.jetonSuivi } });
    expect(suivi).toMatchObject({ statut: 'CLOTUREE', rattacheeA: { numero: principale.numero, chemin: `/suivi/${principale.jetonSuivi}` } });
    expect(suivi.etapes.at(-1)).toMatchObject({ type: 'RATTACHEMENT', statut: 'CLOTUREE' });
    const session = await sessionClient(yao.tel, e164(10));
    const vue = await ok('lireMaReclamation', session, { chemin: { id: doublon.id } });
    expect(vue.rattacheeA).toMatchObject({ id: principale.id, numero: principale.numero });
    // Plus de doublon possible une fois clôturé
    expect((await ok('listerReclamations', jt.serge!, { requete: { recherche: principale.numero } })).donnees[0].doublonPossible).toBe(false);
  });

  it('une réclamation clôturée ne se rattache pas, ni ne sert de principale', async () => {
    const clos = await appeler('rattacherReclamation', jt.serge!, { chemin: { id: doublon.id }, corps: { principaleId: principale.id } });
    expect(clos.statut).toBe(409);
    const versClos = await appeler('rattacherReclamation', jt.serge!, { chemin: { id: principale.id }, corps: { principaleId: doublon.id } });
    expect(versClos).toMatchObject({ statut: 422, corps: { code: 'RATTACHEMENT_IMPOSSIBLE' } });
  });
});

describe('dossiers d\'un agent désactivé ou absent : à réassigner, alertes au superviseur', () => {
  const dossiers: { id: string; numero: string }[] = [];

  it('Fatou désactive Mamadou : ses réclamations en cours vont dans la file « À réassigner »', async () => {
    for (const n of [20, 21]) {
      const d = await deposer('Frais et prélèvements', tel(n), `Frais contestés ${n}.`);
      const t = await ticket(d.numero);
      await ok('assignerReclamation', jt.serge!, { chemin: { id: t.id }, corps: { agentId: id.mamadou } });
      dossiers.push({ id: t.id, numero: t.numero });
    }
    const avant = await ok('lireUtilisateur', jt.fatou!, { chemin: { id: id.mamadou } });
    expect(avant.reclamationsEnCours).toBeGreaterThanOrEqual(2);
    const u = await ok('desactiverUtilisateur', jt.fatou!, { chemin: { id: id.mamadou } });
    expect(u).toMatchObject({ statut: 'DESACTIVE', reclamationsEnCours: avant.reclamationsEnCours });
    // Les superviseurs en sont prévenus dans la console
    const avis = await ok('listerNotifications', jt.serge!);
    expect(avis.donnees.some((n: { modele: string; contenu: string }) => n.modele === 'superviseur.reassignation' && n.contenu.includes('Mamadou Traoré'))).toBe(true);
    const file = await ok('listerReclamations', jt.serge!, { requete: { file: 'a-reassigner', parPage: 100 } });
    expect(file.compteurs.aReassigner).toBe(avant.reclamationsEnCours);
    expect(file.donnees.map((r: { numero: string }) => r.numero)).toEqual(expect.arrayContaining(dossiers.map((d) => d.numero)));
    // Un agent n'a pas cette file
    const agent = await ok('listerReclamations', jt.aya!, { requete: { file: 'a-reassigner' } });
    expect([agent.donnees.length, agent.compteurs.aReassigner]).toEqual([0, 0]);
  });

  it('le client écrit sur un dossier de Mamadou : c\'est Serge, son superviseur, qui est prévenu', async () => {
    const session = await sessionClient(tel(20), e164(20));
    await ok('envoyerMessageClient', session, { chemin: { id: dossiers[0]!.id }, corps: { contenu: 'Avez-vous du nouveau ?' } });
    const alertes = await enBase((tx) => tx.notification.findMany({ where: { reclamationId: dossiers[0]!.id, modele: 'agent.message_client', canal: 'IN_APP' } }));
    expect(alertes.map((n) => n.destinataireUtilisateurId)).toEqual([id.serge]);
  });

  it('Serge les répartit : chacune à l\'agent disponible le moins chargé, jamais à Mamadou', async () => {
    expect((await appeler('assignerEnLot', jt.aya!, { corps: { reclamationIds: dossiers.map((d) => d.id), repartir: true } })).statut).toBe(403);
    expect((await appeler('assignerEnLot', jt.serge!, { corps: { reclamationIds: [dossiers[0]!.id], repartir: true, agentId: id.aya } })).statut).toBe(400);
    const r = await ok('assignerEnLot', jt.serge!, { corps: { reclamationIds: dossiers.map((d) => d.id), repartir: true } });
    expect(r.laissees).toEqual([]);
    expect(r.assignees.map((x: { numero: string }) => x.numero).sort()).toEqual(dossiers.map((d) => d.numero).sort());
    for (const x of r.assignees) expect([id.aya, id.ibrahim]).toContain(x.agent.id);
    // Chacune comme une assignation : chronologie, notification au nouvel agent
    const f = await ok('lireReclamation', jt.serge!, { chemin: { id: dossiers[0]!.id } });
    expect(f.chronologie.at(-1)).toMatchObject({ type: 'ASSIGNATION', acteur: { nom: 'Serge Kouadio' } });
    expect((await ok('listerReclamations', jt.serge!, { requete: { file: 'a-reassigner' } })).donnees.map((x: { id: string }) => x.id))
      .not.toEqual(expect.arrayContaining([dossiers[0]!.id]));
  });

  it('à un agent choisi ; une réclamation clôturée ou introuvable est laissée, avec sa raison', async () => {
    // Le doublon rattaché plus haut
    const clos = await enBase((tx) => tx.reclamation.findFirstOrThrow({ where: { tenantId: a.id, rattacheeAId: { not: null } } }));
    const inconnue = '0190f6a0-0000-7000-8000-000000000000';
    const actuel = (await ticket(dossiers[1]!.numero)).agentId;
    const autre = actuel === id.aya ? id.ibrahim : id.aya;
    const r = await ok('assignerEnLot', jt.serge!, { corps: { reclamationIds: [dossiers[1]!.id, inconnue, clos.id], agentId: autre } });
    expect(r.assignees).toEqual([{ id: dossiers[1]!.id, numero: dossiers[1]!.numero, agent: { id: autre, nom: expect.any(String) } }]);
    expect(r.laissees).toEqual(expect.arrayContaining([
      { id: inconnue, numero: null, raison: 'Réclamation introuvable' },
      { id: clos.id, numero: clos.numero, raison: 'Réclamation clôturée' },
    ]));
    const meme = await ok('assignerEnLot', jt.serge!, { corps: { reclamationIds: [dossiers[1]!.id], agentId: autre } });
    expect(meme.laissees).toEqual([{ id: dossiers[1]!.id, numero: dossiers[1]!.numero, raison: 'Déjà assignée à cet agent' }]);
    expect((await appeler('assignerEnLot', jt.serge!, { corps: { reclamationIds: [clos.id], agentId: id.mamadou } })).corps.code).toBe('AGENT_INVALIDE');
  });

  it('absent aujourd\'hui (attribution ouverte) : ses dossiers sont à réassigner, l\'absence les compte', async () => {
    await ok('modifierBanque', jt.sa!, { chemin: { id: a.id }, corps: { attributionAutomatique: true } });
    const avant = (await ok('listerReclamations', jt.serge!, { requete: { file: 'a-reassigner' } })).compteurs.aReassigner;
    const ab = await ok('ajouterAbsence', jt.serge!, { corps: { agentId: id.ibrahim, du: '2026-09-08', au: '2026-09-09' } });
    absence = ab.id;
    const enCours = await enBase((tx) => tx.reclamation.count({ where: { agentId: id.ibrahim, statut: { not: 'CLOTUREE' } } }));
    expect(ab.reclamationsEnCours).toBe(enCours);
    expect((await ok('listerAbsences', jt.serge!)).find((x: { id: string }) => x.id === ab.id).reclamationsEnCours).toBe(enCours);
    const apres = await ok('listerReclamations', jt.serge!, { requete: { file: 'a-reassigner', agentId: id.ibrahim } });
    expect(apres.compteurs.aReassigner).toBe(avant + enCours);
    expect(apres.donnees.every((r: { agent: { id: string } }) => r.agent.id === id.ibrahim)).toBe(true);
    // Répartis, ses dossiers ne vont ni à lui ni à Mamadou (désactivé)
    const r = await ok('assignerEnLot', jt.serge!, { corps: { reclamationIds: apres.donnees.map((x: { id: string }) => x.id), repartir: true } });
    for (const x of r.assignees) expect(x.agent.id).toBe(id.aya);
  });
});
