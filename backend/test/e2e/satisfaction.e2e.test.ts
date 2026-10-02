/**
 * Enquêtes de satisfaction (étape 15, phase 2) : activées banque par banque par le Super Admin ;
 * ouvertes à la clôture confirmée ou automatique, jamais à une clôture forcée ; lien dans le message
 * de clôture ; une seule réponse, dans les 7 jours ; tableau de bord (taux de réponse, CSAT, NPS,
 * par agent, commentaires), fiche, export ; le Super Admin ne voit que des totaux par banque.
 *
 * L'horloge de l'API est pilotée par le test (fin de l'enquête) ; les enquêtes des deux banques
 * sont désactivées à la fin, comme au départ, pour les fichiers suivants.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { urlPortail } from '../../src/configuration/configuration.js';
import { CycleDeVie } from '../../src/application/reclamations/cycle-de-vie.js';
import { TachesSla } from '../../src/application/reclamations/taches-sla.js';
import { BaseDonnees } from '../../src/infrastructure/base-de-donnees/base-de-donnees.service.js';
import { segmentsSms } from '../../src/infrastructure/envois/adaptateurs.js';
import { hacherMotDePasse } from '../../src/infrastructure/securite/mots-de-passe.js';
import { MOT_DE_PASSE_DEMO } from '../../scripts/jeu-de-donnees.js';
import { ClientApi, connecter, demarrerApi, fermerOutils, jeu, nouvelleIp, type ApiDeTest } from './environnement.js';

const j = jeu();
// Un lundi, 09:00 à Abidjan (UTC) : l'horloge de l'API suit cette variable
let maintenant = new Date('2026-11-02T09:00:00Z');
const debut = new Date(maintenant);
let api: ApiDeTest;
let client: ClientApi;
let bd: BaseDonnees;
let taches: TachesSla;
const jt: Record<string, string> = {};
let compteur = 0;

type Banque = 'alpha' | 'horizon';
interface Ticket { id: string; numero: string; jetonSuivi: string; banque: Banque }

const COMPTES = {
  sa: j.superAdmin.email,
  fatou: j.alpha.comptes.fatou.email, serge: j.alpha.comptes.serge.email, aya: j.alpha.comptes.aya.email, mamadou: j.alpha.comptes.mamadou.email,
  awa: j.horizon.comptes.awa.email, didier: j.horizon.comptes.didier.email, salif: j.horizon.comptes.salif.email,
};

/** Avance l'horloge de l'API et reconnecte le personnel (jetons d'accès de 15 minutes). */
async function horlogeA(t: Date) {
  maintenant = t;
  for (const [cle, email] of Object.entries(COMPTES)) jt[cle] = (await connecter(client, email, () => maintenant)).jeton;
}

async function deposer(banque: Banque, categorieId?: string): Promise<Ticket> {
  compteur++;
  const b = j[banque];
  const r = await client.appeler('deposerReclamation', {
    ip: nouvelleIp(), chemin: { code: b.points.qr },
    corps: {
      categorieId: categorieId ?? b.categories['Carte bancaire'], description: `Scénario satisfaction ${compteur}`, nom: 'Client Satisfaction',
      telephone: `0799015${String(compteur).padStart(3, '0')}`, email: `avis${compteur}@exemple.ci`, consentement: true, versionPolitique: '2026-09',
    },
  });
  expect(r.statut, JSON.stringify(r.corps)).toBe(201);
  const t = await bd.enSysteme((tx) => tx.reclamation.findUniqueOrThrow({ where: { jetonSuivi: r.corps.jetonSuivi } }));
  return { id: t.id, numero: t.numero, jetonSuivi: r.corps.jetonSuivi, banque };
}

const action = async (op: string, jeton: string, id: string, corps?: unknown) => {
  const r = await client.appeler(op, { jeton, chemin: { id }, ...(corps === undefined ? {} : { corps }) });
  expect(r.statut, `${op} : ${JSON.stringify(r.corps)}`).toBeLessThan(300);
  return r;
};

/** Assignée par le superviseur, prise en charge et résolue par l'agent. */
async function resoudre(t: Ticket, agent: string) {
  const sup = t.banque === 'alpha' ? 'serge' : 'didier';
  const agentId = t.banque === 'alpha' ? j.alpha.comptes[agent]!.id : j.horizon.comptes[agent]!.id;
  await action('assignerReclamation', jt[sup]!, t.id, { agentId });
  await action('prendreEnCharge', jt[agent]!, t.id);
  await action('resoudreReclamation', jt[agent]!, t.id, { reponseFinale: 'Votre demande est traitée.' });
}

async function sessionClient(t: Ticket): Promise<string> {
  expect((await client.appeler('demanderCodeOtp', { chemin: { jetonSuivi: t.jetonSuivi }, corps: { canal: 'SMS' } })).statut).toBe(202);
  const sms = await bd.enSysteme((tx) => tx.notification.findFirstOrThrow({ where: { reclamationId: t.id, modele: 'client.otp' }, orderBy: { creeLe: 'desc' } }));
  const s = await client.appeler('verifierCodeOtp', { chemin: { jetonSuivi: t.jetonSuivi }, corps: { code: /(\d{6})/.exec(sms.contenu)![1] } });
  expect(s.statut).toBe(200);
  return s.corps.jetonClient;
}

async function confirmer(t: Ticket): Promise<string> {
  const jc = await sessionClient(t);
  await action('confirmerResolution', jc, t.id);
  return jc;
}

const messagesCloture = (t: Ticket) =>
  bd.enSysteme((tx) => tx.notification.findMany({ where: { reclamationId: t.id, modele: 'client.cloture' }, orderBy: { canal: 'asc' } }));
// Contexte de la banque : le rôle système n'a aucun droit sur les enquêtes
const enquete = (t: Ticket) => bd.enBanque(j[t.banque].id, (tx) => tx.enqueteSatisfaction.findFirst({ where: { reclamationId: t.id } }));
const lireAvis = (t: Ticket) => client.appeler('lireAvis', { chemin: { jetonSuivi: t.jetonSuivi } });
const donnerAvis = (t: Ticket, corps: unknown) => client.appeler('donnerAvis', { chemin: { jetonSuivi: t.jetonSuivi }, corps });
const activer = async (banque: Banque, enqueteSatisfaction: boolean) =>
  expect((await client.appeler('modifierBanque', { jeton: jt.sa, chemin: { id: j[banque].id }, corps: { enqueteSatisfaction } })).statut).toBe(200);

beforeAll(async () => {
  api = await demarrerApi({ horloge: () => maintenant });
  client = new ClientApi(api.url);
  bd = new BaseDonnees(api.config.baseDeDonneesUrl);
  taches = new TachesSla(bd.base, new CycleDeVie(bd.base, { horloge: () => maintenant, lienSuivi: (s, t) => `https://${s}.reclamations.test/suivi/${t}` }));
  // authentification.e2e change le mot de passe de Salif (mot de passe oublié) : on remet celui du jeu
  const hash = await hacherMotDePasse(MOT_DE_PASSE_DEMO);
  await bd.enSysteme((tx) => tx.utilisateur.update({ where: { id: j.horizon.comptes.salif.id }, data: { motDePasseHash: hash } }));
  await horlogeA(maintenant);
});

afterAll(async () => {
  await horlogeA(maintenant);
  await activer('alpha', false);
  await activer('horizon', false);
  await bd.fermer();
  await api.fermer();
  await fermerOutils();
});

describe('activation banque par banque (décision I2)', () => {
  it('désactivée par défaut : la clôture n\'ouvre pas d\'enquête, le message de clôture n\'a pas de lien d\'avis', async () => {
    const t = await deposer('horizon');
    await resoudre(t, 'salif');
    await confirmer(t);
    expect(await enquete(t)).toBeNull();
    expect((await lireAvis(t)).statut).toBe(404);
    expect((await client.appeler('lireSuivi', { chemin: { jetonSuivi: t.jetonSuivi } })).corps.avis).toBeNull();
    for (const m of await messagesCloture(t)) expect(m.contenu).not.toContain('/avis');
  });

  it('le Super Admin l\'active pour une banque ; l\'Admin Entreprise le lit dans ses paramètres', async () => {
    await activer('horizon', true);
    const b = await client.appeler('lireBanque', { jeton: jt.sa, chemin: { id: j.horizon.id } });
    expect(b.corps.enqueteSatisfaction).toBe(true);
    expect((await client.appeler('lireParametresBanque', { jeton: jt.awa })).corps.enqueteSatisfaction).toBe(true);
    expect((await client.appeler('lireParametresBanque', { jeton: jt.fatou })).corps.enqueteSatisfaction).toBe(false);
    const journal = await bd.enSysteme((tx) => tx.journalAudit.findFirst({ where: { action: 'plateforme.banque_modifiee', entiteId: j.horizon.id }, orderBy: { rang: 'desc' } }));
    expect(journal?.donnees).toMatchObject({ champs: ['enqueteSatisfaction'] });
  });
});

describe('ouverture et réponse', () => {
  let t: Ticket;
  let jc = '';

  it('confirmation : enquête ouverte 7 jours, lien dans le SMS (un segment) et l\'e-mail, sur le suivi et dans l\'espace client', async () => {
    t = await deposer('horizon');
    await resoudre(t, 'salif');
    jc = await confirmer(t);
    const e = await enquete(t);
    expect(e).toMatchObject({ creeLe: maintenant, reponduLe: null, note: null });
    expect(e!.expireLe.getTime() - maintenant.getTime()).toBe(7 * 24 * 3600 * 1000);

    const [email, sms] = await messagesCloture(t);
    expect(email!.canal).toBe('EMAIL');
    expect(email!.contenu).toContain(`/suivi/${t.jetonSuivi}/avis`);
    expect(email!.sujet).toContain('votre avis');
    expect(sms!.canal).toBe('SMS');
    expect(sms!.contenu).toBe(`Banque Horizon : réclamation ${t.numero} close. Votre avis : ${urlPortail(api.config, 'horizon')}/suivi/${t.jetonSuivi}/avis`);
    expect(segmentsSms(sms!.contenu)).toBe(1);

    const suivi = await client.appeler('lireSuivi', { chemin: { jetonSuivi: t.jetonSuivi } });
    expect(suivi.corps.avis).toEqual({ etat: 'A_DONNER', expireLe: e!.expireLe.toISOString() });
    const vue = await client.appeler('lireMaReclamation', { jeton: jc, chemin: { id: t.id } });
    expect(vue.corps.avis).toEqual({ etat: 'A_DONNER', expireLe: e!.expireLe.toISOString(), chemin: `/suivi/${t.jetonSuivi}/avis` });

    const avis = await lireAvis(t);
    expect(avis.statut).toBe(200);
    expect(avis.corps).toMatchObject({ numero: t.numero, categorie: 'Carte bancaire', etat: 'A_DONNER', reponse: null, banque: { nom: 'Banque Horizon', slug: 'horizon' } });
  });

  it('réponse : enregistrée une seule fois, commentaire nettoyé ; le journal n\'en garde ni les notes ni le texte', async () => {
    const r = await donnerAvis(t, { note: 4, recommandation: 9, commentaire: '  Conseiller très clair.  ' });
    expect(r.statut, JSON.stringify(r.corps)).toBe(200);
    expect(r.corps).toMatchObject({ etat: 'DONNE', reponse: { note: 4, recommandation: 9, commentaire: 'Conseiller très clair.', reponduLe: maintenant.toISOString() } });
    const encore = await donnerAvis(t, { note: 1, recommandation: 0 });
    expect(encore.statut).toBe(409);
    expect(encore.corps.code).toBe('AVIS_DEJA_DONNE');
    expect((await enquete(t))!.note).toBe(4);
    expect((await client.appeler('lireSuivi', { chemin: { jetonSuivi: t.jetonSuivi } })).corps.avis.etat).toBe('DONNE');
    expect((await client.appeler('lireMaReclamation', { jeton: jc, chemin: { id: t.id } })).corps.avis.etat).toBe('DONNE');

    const ligne = await bd.enSysteme((tx) => tx.journalAudit.findFirstOrThrow({ where: { action: 'client.avis_donne', entiteId: t.id } }));
    expect(ligne).toMatchObject({ acteurType: 'CLIENT', tenantId: j.horizon.id });
    expect(JSON.stringify(ligne.donnees ?? {})).not.toMatch(/clair|"note"|recommandation/);

    // La fiche du personnel montre l'avis, commentaire compris
    const fiche = await client.appeler('lireReclamation', { jeton: jt.didier, chemin: { id: t.id } });
    expect(fiche.corps.avis).toMatchObject({ etat: 'DONNE', reponse: { note: 4, recommandation: 9, commentaire: 'Conseiller très clair.' } });
  });

  it('refus : notes hors bornes ou manquantes (400), commentaire trop long (400), lien inconnu (404)', async () => {
    const t2 = await deposer('horizon');
    await resoudre(t2, 'salif');
    await confirmer(t2);
    for (const corps of [{ note: 6, recommandation: 5 }, { note: 0, recommandation: 5 }, { note: 3, recommandation: 11 }, { note: 3 }, { note: 3, recommandation: 5, commentaire: 'x'.repeat(1001) }]) {
      const r = await donnerAvis(t2, corps);
      expect(r.statut, JSON.stringify(corps)).toBe(400);
    }
    expect((await client.appeler('donnerAvis', { chemin: { jetonSuivi: 'X'.repeat(32) }, corps: { note: 3, recommandation: 5 } })).statut).toBe(404);
    expect((await enquete(t2))!.reponduLe).toBeNull();
  });

  it('clôture automatique : enquête ouverte ; clôture forcée : aucune', async () => {
    const auto = await deposer('horizon');
    await resoudre(auto, 'salif');
    const forcee = await deposer('horizon');
    await action('cloturerDeForce', jt.didier, forcee.id, { motif: 'DOUBLON', precision: 'Déjà déposée' });
    expect(await enquete(forcee)).toBeNull();
    expect((await lireAvis(forcee)).statut).toBe(404);

    const { clotureAutoPrevueLe } = await bd.enSysteme((tx) => tx.reclamation.findUniqueOrThrow({ where: { id: auto.id } }));
    const apres = new Date(clotureAutoPrevueLe!.getTime() + 60_000);
    await taches.cloturesAutomatiques(apres);
    const e = await enquete(auto);
    expect(e).toMatchObject({ creeLe: apres, reponduLe: null });
    expect((await messagesCloture(auto)).every((m) => m.contenu.includes('/avis'))).toBe(true);
  });

  it('après 7 jours : enquête terminée, réponse refusée (422 ENQUETE_TERMINEE)', async () => {
    const t3 = await deposer('horizon');
    await resoudre(t3, 'salif');
    await confirmer(t3);
    const e = await enquete(t3);
    await horlogeA(e!.expireLe);
    expect((await lireAvis(t3)).corps.etat).toBe('A_DONNER');
    await horlogeA(new Date(e!.expireLe.getTime() + 60_000));
    expect((await lireAvis(t3)).corps).toMatchObject({ etat: 'TERMINE', reponse: null });
    const r = await donnerAvis(t3, { note: 5, recommandation: 10 });
    expect(r.statut).toBe(422);
    expect(r.corps.code).toBe('ENQUETE_TERMINEE');
    // En base aussi : une réponse après la fin est refusée par le trigger
    await expect(bd.enBanque(j.horizon.id, (tx) => tx.enqueteSatisfaction.update({
      where: { id: e!.id }, data: { reponduLe: new Date(e!.expireLe.getTime() + 60_000), note: 5, recommandation: 10 },
    }))).rejects.toThrow(/terminée/);
  });
});

describe('indicateurs, fiche et export (critère de la phase 2)', () => {
  let categorie = '';
  const t: Record<'un' | 'deux' | 'trois', Ticket> = {} as never;

  beforeAll(async () => {
    await activer('alpha', true);
    const c = await client.appeler('creerCategorie', { jeton: jt.fatou, corps: { nom: 'Satisfaction e2e', delaiCibleMinutes: 480 } });
    expect(c.statut).toBe(201);
    categorie = c.corps.id;
    t.un = await deposer('alpha', categorie);
    t.deux = await deposer('alpha', categorie);
    t.trois = await deposer('alpha', categorie);
    await resoudre(t.un, 'aya');
    await resoudre(t.deux, 'aya');
    await resoudre(t.trois, 'mamadou');
    for (const x of Object.values(t)) await confirmer(x);
    expect((await donnerAvis(t.un, { note: 5, recommandation: 10, commentaire: 'Parfait, merci.' })).statut).toBe(200);
    expect((await donnerAvis(t.trois, { note: 2, recommandation: 3 })).statut).toBe(200);
  });

  const indicateurs = (jeton: string) => client.appeler('lireIndicateurs', {
    jeton, requete: { du: debut.toISOString(), au: new Date(maintenant.getTime() + 3600_000).toISOString(), categorieId: categorie },
  });

  it('tableau de bord : taux de réponse, satisfaits (CSAT), note moyenne, NPS, par agent, derniers commentaires', async () => {
    const r = await indicateurs(jt.serge);
    expect(r.statut).toBe(200);
    expect(r.corps.satisfaction).toEqual({
      enquetes: 3, reponses: 2, tauxReponse: 0.6667, tauxSatisfaits: 0.5, noteMoyenne: 3.5, nps: 0,
      promoteurs: 1, passifs: 0, detracteurs: 1,
      parAgent: [
        { cle: j.alpha.comptes.aya.id, libelle: 'Aya Konan', reponses: 1, tauxSatisfaits: 1, nps: 100 },
        { cle: j.alpha.comptes.mamadou.id, libelle: 'Mamadou Traoré', reponses: 1, tauxSatisfaits: 0, nps: -100 },
      ],
      commentaires: [{ reclamationId: t.un.id, numero: t.un.numero, note: 5, recommandation: 10, commentaire: 'Parfait, merci.', reponduLe: maintenant.toISOString() }],
    });
  });

  it('un agent ne voit que ses réclamations', async () => {
    const r = await indicateurs(jt.aya);
    expect(r.corps.satisfaction).toMatchObject({ enquetes: 2, reponses: 1, nps: 100, parAgent: [{ libelle: 'Aya Konan' }] });
    expect(r.corps.satisfaction.commentaires.map((c: { numero: string }) => c.numero)).toEqual([t.un.numero]);
    const m = await indicateurs(jt.mamadou);
    expect(m.corps.satisfaction).toMatchObject({ enquetes: 1, reponses: 1, commentaires: [] });
  });

  it('sans enquête activée ni enquête sur la période : pas de bloc satisfaction', async () => {
    const r = await client.appeler('lireIndicateurs', { jeton: jt.didier, requete: { du: '2026-01-01T00:00:00Z', au: '2026-02-01T00:00:00Z' } });
    expect(r.corps.satisfaction).toMatchObject({ enquetes: 0, reponses: 0, nps: null }); // Horizon les a activées
    await activer('horizon', false);
    const s = await client.appeler('lireIndicateurs', { jeton: jt.didier, requete: { du: '2026-01-01T00:00:00Z', au: '2026-02-01T00:00:00Z' } });
    expect(s.corps.satisfaction).toBeNull();
  });

  it('export CSV : notes de l\'enquête, jamais le commentaire', async () => {
    const r = await client.appeler('exporterReclamations', { jeton: jt.serge, requete: { categorieId: categorie } });
    expect(r.statut).toBe(200);
    const texte = r.octets.toString('utf8');
    const lignes = texte.slice(1).trim().split('\r\n');
    expect(lignes[0]!.endsWith(';Satisfaction (1 à 5);Recommandation (0 à 10)')).toBe(true);
    expect(lignes.find((l) => l.startsWith(t.un.numero))!.endsWith(';5;10')).toBe(true);
    expect(lignes.find((l) => l.startsWith(t.deux.numero))!.endsWith(';;')).toBe(true);
    expect(texte).not.toContain('Parfait');
  });

  it('Super Admin : totaux par banque, sans commentaire', async () => {
    const r = await client.appeler('lireIndicateursPlateforme', {
      jeton: jt.sa, requete: { du: debut.toISOString(), au: new Date(maintenant.getTime() + 3600_000).toISOString() },
    });
    expect(r.statut).toBe(200);
    const alpha = r.corps.banques.find((b: { banque: { id: string } }) => b.banque.id === j.alpha.id);
    expect(alpha.satisfaction).toMatchObject({ enquetes: 3, reponses: 2, tauxSatisfaits: 0.5, nps: 0 });
    const horizon = r.corps.banques.find((b: { banque: { id: string } }) => b.banque.id === j.horizon.id);
    expect(horizon.satisfaction.reponses).toBe(1);
    expect(JSON.stringify(r.corps)).not.toMatch(/Parfait|clair/);
  });
});
