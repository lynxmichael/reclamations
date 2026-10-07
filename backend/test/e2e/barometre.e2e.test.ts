/**
 * Baromètre mensuel de l'expérience client et recommandations (étape 23).
 *
 * Une banque à part, la Banque Céleste, créée en mai 2026 pour ce test : ses réclamations de juin,
 * juillet et août sont traitées de bout en bout par le cycle de vie, à l'heure choisie par le test
 * (délais respectés ou non, contestations, réponses à l'enquête avec des commentaires qui contiennent
 * un téléphone, un e-mail, le nom du client et celui d'un agent). Les autres banques ne sont pas touchées.
 *
 * - ouverture par Makor, banque par banque ; publication par le worker, le mois écoulé, une seule fois ;
 * - chiffres du mois calculés par la plateforme (définitions du contrat), tendance, irritants ;
 * - analyse par les règles sans l'accord pour l'IA (assistant fermé) : rien ne part chez le fournisseur ;
 * - analyse par l'IA : commentaires masqués, ni nom, ni numéro de réclamation, ni identifiant ; une
 *   réponse qui invente un chiffre est écartée (règles) ; une recommandation qui cite une étiquette de
 *   masquage aussi ;
 * - lecture par l'Admin Entreprise et les superviseurs, décision par l'Admin Entreprise, journal d'audit,
 *   notification, isolation entre banques, consommation de l'IA pour Makor.
 *
 * Le fournisseur d'IA est simulé par un serveur local qui parle l'API Messages d'Anthropic.
 */
import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BarometresMensuels } from '../../src/application/barometre/barometres.js';
import { MoteurIa } from '../../src/application/ia/moteur.js';
import { CycleDeVie } from '../../src/application/reclamations/cycle-de-vie.js';
import type { Acteur } from '../../src/domaine/reclamation/machine.js';
import { BaseDonnees } from '../../src/infrastructure/base-de-donnees/base-de-donnees.service.js';
import { creerFournisseur } from '../../src/infrastructure/ia/fournisseurs.js';
import { hacherMotDePasse } from '../../src/infrastructure/securite/mots-de-passe.js';
import { executer, type Executants } from '../../src/worker/planification.js';
import { MOT_DE_PASSE_DEMO } from '../../scripts/jeu-de-donnees.js';
import { ClientApi, connecter, demarrerApi, fermerOutils, jeu, type ApiDeTest } from './environnement.js';

const j = jeu();
const a = j.alpha;
// Mardi 1er septembre 2026, 00:05 à Abidjan (UTC) : le worker passe, août est écoulé
let maintenant = new Date('2026-09-01T00:05:00Z');
let api: ApiDeTest;
let client: ClientApi;
let bd: BaseDonnees;
let barometres: BarometresMensuels;
const jt: Record<string, string> = {};

// ---- Faux fournisseur ---------------------------------------------------------------------

let fournisseur: Server;
/** Corps des requêtes reçues par le fournisseur, dans l'ordre */
const recues: any[] = [];
/** Réponses à donner, dans l'ordre ; chacune voit la requête */
const aRepondre: ((requete: any, res: ServerResponse) => void)[] = [];

const analyse = (input: (requete: any) => unknown) => (requete: any, res: ServerResponse) => {
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ content: [{ type: 'tool_use', name: 'analyse_barometre', input: input(requete) }], usage: { input_tokens: 3000, output_tokens: 400 }, stop_reason: 'tool_use' }));
};

// ---- La Banque Céleste --------------------------------------------------------------------

const C = {
  id: '', point: '', categories: {} as Record<'carte' | 'virement' | 'frais', string>, agences: {} as Record<'plateau' | 'yopougon', string>,
  nadia: { id: '', email: 'nadia.kacou@banque-celeste.example' },
  olivier: { id: '', email: 'olivier.brou@banque-celeste.example' },
  rokia: { id: '', email: 'rokia.sangare@banque-celeste.example' },
};

async function creerCeleste() {
  const hash = await hacherMotDePasse(MOT_DE_PASSE_DEMO);
  await bd.enSysteme(async (tx) => {
    const plan = await tx.plan.findUniqueOrThrow({ where: { code: 'PRO' } });
    // Créée en mai, avant les mois qu'on lui demande ; chat ouvert, assistant fermé, enquête active
    const b = await tx.banque.create({
      data: {
        nom: 'Banque Céleste', slug: 'celeste', prefixeTickets: 'CEL', planId: plan.id, creeLe: new Date('2026-05-20T10:00:00Z'),
        enqueteSatisfaction: true, chatWeb: true,
      },
    });
    C.id = b.id;
    for (const [i, [cle, nom]] of ([['carte', 'Carte bancaire'], ['virement', 'Virement'], ['frais', 'Frais bancaires']] as const).entries()) {
      C.categories[cle] = (await tx.categorie.create({ data: { tenantId: b.id, nom, prioriteParDefaut: 'NORMALE', delaiCibleMinutes: 960, ordre: i + 1 } })).id;
    }
    for (const [cle, code, nom] of [['plateau', 'CE01', 'Plateau'], ['yopougon', 'CE02', 'Yopougon']] as const) {
      C.agences[cle] = (await tx.agence.create({ data: { tenantId: b.id, code, nom, ville: 'Abidjan' } })).id;
    }
    C.point = (await tx.pointDepot.create({ data: { tenantId: b.id, code: 'CELESTE2026', canal: 'LIEN_WEB', libelle: 'Site web' } })).id;
    await tx.horaireOuvre.createMany({
      data: [1, 2, 3, 4, 5].flatMap((jour) => [{ tenantId: b.id, jourSemaine: jour, debutMinute: 480, finMinute: 720 }, { tenantId: b.id, jourSemaine: jour, debutMinute: 840, finMinute: 1050 }]),
    });
    // Double authentification facultative, non activée : le mot de passe suffit (étape 19)
    const compte = (prenom: string, nom: string, role: 'ADMIN_ENTREPRISE' | 'SUPERVISEUR' | 'AGENT', email: string, superviseurId: string | null = null) =>
      tx.utilisateur.create({ data: { tenantId: b.id, role, statut: 'ACTIF', email, prenom, nom, motDePasseHash: hash, superviseurId }, select: { id: true } });
    C.nadia.id = (await compte('Nadia', 'Kacou', 'ADMIN_ENTREPRISE', C.nadia.email)).id;
    C.olivier.id = (await compte('Olivier', 'Brou', 'SUPERVISEUR', C.olivier.email)).id;
    C.rokia.id = (await compte('Rokia', 'Sangaré', 'AGENT', C.rokia.email, C.olivier.id)).id;
  });
}

type Cle = 'carte' | 'virement' | 'frais';
interface Dossier {
  readonly jour: string;
  readonly cat: Cle;
  readonly agence: 'plateau' | 'yopougon' | null;
  /** Résolue une semaine après le dépôt : hors délai */
  readonly lent?: boolean;
  readonly contestee?: boolean;
  /** Note (1 à 5), recommandation (0 à 10), commentaire ; `{client}` : le nom du client */
  readonly avis?: readonly [number, number, string | null];
}

const HEURE = 3_600_000;
let numeroClient = 0;
/** Clients de la Banque Céleste, par numéro de réclamation (pour vérifier le masquage) */
const clients: string[] = [];
const PRENOMS = ['Kouassi', 'Adjoua', 'Yao', 'Akissi', 'Koffi', 'Amenan', 'Konan', 'Affoué', 'Brou', 'Ahou', 'Kouamé', 'Aya'];
const NOMS = ['Ehui', 'Gbagbo', 'Assoumou', 'Djédjé', 'Tanoh', 'Yapi', 'Lasme', 'Niamké', 'Zadi', 'Aké', 'Bléhoué', 'Tiémoko'];

async function traiter(cycle: CycleDeVie, regler: (d: Date) => void, d: Dossier, rang: number) {
  numeroClient++;
  const nom = `${PRENOMS[numeroClient % PRENOMS.length]} ${NOMS[(numeroClient * 5) % NOMS.length]}`;
  clients.push(nom);
  let t = new Date(`${d.jour}T09:00:00Z`).getTime() + rang * 20 * 60_000;
  const a = (delai: number) => regler(new Date((t += delai)));
  a(0);
  const r = await cycle.deposer({
    tenantId: C.id, pointDepotId: C.point, categorieId: C.categories[d.cat], agenceId: d.agence ? C.agences[d.agence] : null,
    description: 'Réclamation de test du baromètre.', client: { nom, telephone: `07${String(30_000_000 + numeroClient).slice(-8)}` }, consentementVersion: '2026-09',
  });
  const { clientId } = await bd.enSysteme((tx) => tx.reclamation.findUniqueOrThrow({ where: { id: r.id }, select: { clientId: true } }));
  const leClient: Acteur = { type: 'CLIENT', clientId };
  const agent: Acteur = { type: 'UTILISATEUR', id: C.rokia.id, role: 'AGENT', libelle: 'Rokia' };
  a(10 * 60_000);
  await cycle.assigner(C.id, r.id, { type: 'UTILISATEUR', id: C.olivier.id, role: 'SUPERVISEUR', libelle: 'Olivier' }, C.rokia.id);
  a(30 * 60_000);
  await cycle.repondreAuClient(C.id, r.id, agent, 'Nous traitons votre réclamation.');
  a(d.lent ? 7 * 24 * HEURE : 2 * HEURE);
  await cycle.resoudre(C.id, r.id, agent, 'Votre réclamation est traitée.');
  if (d.contestee) {
    a(HEURE);
    await cycle.contester(C.id, r.id, leClient, 'Le problème n\'est pas réglé.');
    a(HEURE);
    await cycle.resoudre(C.id, r.id, agent, 'Nous avons corrigé l\'opération restante.');
  }
  a(HEURE);
  await cycle.confirmer(C.id, r.id, leClient);
  if (d.avis) {
    a(2 * HEURE);
    const [note, recommandation, commentaire] = d.avis;
    await bd.enBanque(C.id, (tx) => tx.enqueteSatisfaction.updateMany({
      where: { reclamationId: r.id }, data: { reponduLe: new Date(t), note, recommandation, commentaire: commentaire?.replace('{client}', nom) ?? null },
    }));
  }
}

// Juin : 4 réclamations traitées dans les délais, sans avis
const JUIN: Dossier[] = [
  { jour: '2026-06-08', cat: 'carte', agence: 'plateau' }, { jour: '2026-06-09', cat: 'carte', agence: 'plateau' },
  { jour: '2026-06-10', cat: 'virement', agence: 'plateau' }, { jour: '2026-06-11', cat: 'virement', agence: 'plateau' },
];
// Juillet : 11 réclamations, 2 hors délai (carte, Yopougon, sur 5), 4 avis
const JUILLET: Dossier[] = [
  { jour: '2026-07-06', cat: 'carte', agence: 'yopougon', lent: true, avis: [2, 3, 'Attente trop longue au guichet'] },
  { jour: '2026-07-07', cat: 'carte', agence: 'yopougon', lent: true },
  { jour: '2026-07-08', cat: 'carte', agence: 'plateau', avis: [4, 8, null] }, { jour: '2026-07-09', cat: 'carte', agence: 'plateau' },
  { jour: '2026-07-10', cat: 'carte', agence: 'plateau' },
  { jour: '2026-07-10', cat: 'virement', agence: 'plateau', avis: [5, 9, null] }, { jour: '2026-07-13', cat: 'virement', agence: 'plateau' },
  { jour: '2026-07-14', cat: 'virement', agence: 'plateau', avis: [3, 6, null] }, { jour: '2026-07-15', cat: 'virement', agence: 'plateau' },
  { jour: '2026-07-14', cat: 'frais', agence: null }, { jour: '2026-07-15', cat: 'frais', agence: null },
];
// Août : 24 réclamations ; carte : 10 (4 hors délai, 2 contestées) ; 16 avis, 8 commentaires
const TROIS_SEMAINES = 'Trois semaines sans nouvelles de ma carte avalée au GAB, rappelez-moi au 07 45 12 33 90';
const AOUT: Dossier[] = [
  { jour: '2026-08-03', cat: 'carte', agence: 'yopougon', lent: true, avis: [1, 2, TROIS_SEMAINES] },
  { jour: '2026-08-03', cat: 'carte', agence: 'yopougon', lent: true, avis: [2, 3, 'Personne ne m\'a informé de l\'avancement, j\'ai dû relancer plusieurs fois'] },
  { jour: '2026-08-04', cat: 'carte', agence: 'yopougon', lent: true, avis: [1, 0, 'Je m\'appelle {client} et j\'attends toujours mon remboursement'] },
  { jour: '2026-08-04', cat: 'carte', agence: 'yopougon', avis: [3, 6, 'Délai trop long pour une simple opposition'] },
  { jour: '2026-08-05', cat: 'carte', agence: 'yopougon', avis: [4, 8, null] },
  { jour: '2026-08-05', cat: 'carte', agence: 'yopougon' },
  { jour: '2026-08-06', cat: 'carte', agence: 'plateau', lent: true, avis: [5, 9, null] },
  { jour: '2026-08-06', cat: 'carte', agence: 'plateau', contestee: true },
  { jour: '2026-08-07', cat: 'carte', agence: 'plateau', contestee: true },
  { jour: '2026-08-07', cat: 'carte', agence: 'plateau' },
  { jour: '2026-08-10', cat: 'virement', agence: 'plateau', avis: [5, 10, 'Rokia a été très aimable et rapide, merci'] },
  { jour: '2026-08-10', cat: 'virement', agence: 'plateau', avis: [4, 9, 'Virement régularisé rapidement, merci'] },
  { jour: '2026-08-11', cat: 'virement', agence: 'plateau', lent: true, avis: [4, 7, null] },
  { jour: '2026-08-11', cat: 'virement', agence: 'plateau', avis: [2, 5, null] },
  { jour: '2026-08-12', cat: 'virement', agence: 'yopougon', avis: [3, 6, null] },
  { jour: '2026-08-12', cat: 'virement', agence: 'yopougon' },
  { jour: '2026-08-13', cat: 'virement', agence: null }, { jour: '2026-08-13', cat: 'virement', agence: null },
  { jour: '2026-08-13', cat: 'frais', agence: 'plateau', avis: [2, 4, 'Frais prélevés deux fois, écrivez-moi à client.mecontent@exemple.ci'] },
  { jour: '2026-08-14', cat: 'frais', agence: 'plateau', avis: [5, 9, 'Bon accueil en agence'] },
  { jour: '2026-08-14', cat: 'frais', agence: 'plateau', avis: [4, 8, null] },
  { jour: '2026-08-14', cat: 'frais', agence: null, avis: [1, 1, null] },
  { jour: '2026-08-12', cat: 'frais', agence: null, avis: [5, 10, null] },
  { jour: '2026-08-11', cat: 'frais', agence: null },
];

async function semerCeleste() {
  let horloge = new Date();
  const cycle = new CycleDeVie(bd.base, { horloge: () => horloge, lienSuivi: (slug, jeton) => `https://${slug}.reclamations.example/suivi/${jeton}` });
  const regler = (d: Date) => { horloge = d; };
  for (const mois of [JUIN, JUILLET, AOUT]) {
    // Plusieurs dépôts le même jour : un toutes les 20 minutes
    const parJour = new Map<string, number>();
    for (const d of mois) {
      const rang = parJour.get(d.jour) ?? 0;
      parJour.set(d.jour, rang + 1);
      await traiter(cycle, regler, d, rang);
    }
  }
  // Notifications aux clients déjà parties (les autres tests vident la boîte d'envoi)
  await bd.enSysteme((tx) => tx.notification.updateMany({ where: { tenantId: C.id }, data: { statut: 'ENVOYEE', envoyeeLe: new Date('2026-08-31T12:00:00Z') } }));
}

// ---- Appels ---------------------------------------------------------------------------------

const appeler = (op: string, jeton: string, o: { chemin?: Record<string, string>; corps?: unknown; requete?: Record<string, string> } = {}) => client.appeler(op, { jeton, ...o });
const ok = async (op: string, jeton: string, o: Parameters<typeof appeler>[2] = {}) => {
  const r = await appeler(op, jeton, o);
  expect(r.statut, `${op} : ${JSON.stringify(r.corps)}`).toBeLessThan(300);
  return r.corps;
};
const refus = async (op: string, jeton: string, o: Parameters<typeof appeler>[2] = {}) => {
  const r = await appeler(op, jeton, o);
  return [r.statut, r.corps?.code];
};

async function connexionCeleste(email: string): Promise<string> {
  const r = await client.appeler('connexion', { corps: { email, motDePasse: MOT_DE_PASSE_DEMO } });
  expect(r.corps.etape).toBe('SESSION_OUVERTE');
  return r.corps.session.jetonAcces as string;
}

/** L'horloge avance : les jetons d'accès (15 minutes) ont expiré, on se reconnecte */
async function avancer(date: string) {
  maintenant = new Date(date);
  await connexions();
}

async function connexions() {
  jt.sa = (await connecter(client, j.superAdmin.email, () => maintenant)).jeton;
  jt.fatou = (await connecter(client, a.comptes.fatou!.email, () => maintenant)).jeton;
  jt.nadia = await connexionCeleste(C.nadia.email);
  jt.olivier = await connexionCeleste(C.olivier.email);
  jt.rokia = await connexionCeleste(C.rokia.email);
}

const appelsIa = () => bd.enBanque(C.id, (tx) => tx.appelIa.findMany({ where: { finalite: 'BAROMETRE' }, orderBy: { id: 'asc' } }));
const modifier = (id: string, corps: Record<string, boolean>) => ok('modifierBanque', jt.sa!, { chemin: { id }, corps });

beforeAll(async () => {
  fournisseur = createServer((req, res) => {
    let brut = '';
    req.on('data', (d) => (brut += d));
    req.on('end', () => {
      const requete = JSON.parse(brut);
      recues.push(requete);
      const r = aRepondre.shift();
      if (r) r(requete, res);
      else res.writeHead(500).end('{}');
    });
  });
  await new Promise<void>((fin) => fournisseur.listen(0, '127.0.0.1', fin));
  api = await demarrerApi({
    horloge: () => maintenant,
    env: {
      IA_FOURNISSEUR: 'anthropic', IA_MODELE: 'modele-de-test', IA_CLE: 'cle-de-test-0123456789abcdef',
      IA_URL: `http://127.0.0.1:${(fournisseur.address() as AddressInfo).port}/v1/messages`, IA_DELAI_MS: '2000', IA_PRIX_ENTREE: '1', IA_PRIX_SORTIE: '5',
    },
  });
  client = new ClientApi(api.url);
  bd = new BaseDonnees(api.config.baseDeDonneesUrl);
  // Le même moteur que le worker : plafond, journal des appels, repli sur les règles
  const ia = api.config.ia;
  barometres = new BarometresMensuels(bd, new MoteurIa(bd, ia, ia.fournisseur === 'regles' ? null : creerFournisseur(ia), () => maintenant), () => maintenant);
  await creerCeleste();
  await semerCeleste();
  await connexions();
}, 120_000);

afterAll(async () => {
  await modifier(a.id, { barometre: false }).catch(() => undefined);
  await bd.fermer();
  await api.fermer();
  await new Promise<void>((fin) => fournisseur.close(() => fin()));
  await fermerOutils();
});

// ---------------------------------------------------------------------------------------------

describe('ouverture par Makor, banque par banque', () => {
  it('fermé par défaut : 403 FONCTION_NON_OUVERTE, et le worker ne publie rien', async () => {
    expect((await ok('lireParametresBanque', jt.nadia!)).barometre).toBe(false);
    expect(await refus('listerBarometres', jt.nadia!)).toEqual([403, 'FONCTION_NON_OUVERTE']);
    expect(await barometres.publier()).toEqual({ publies: 0 });
  });

  it('le Super Admin l\'ouvre ; la banque le voit dans ses paramètres', async () => {
    expect((await appeler('modifierBanque', jt.nadia!, { chemin: { id: C.id }, corps: { barometre: true } })).statut).toBe(403);
    // Juin d'abord, à la main : l'assistant est fermé, le worker passera pour août
    expect((await modifier(C.id, { barometre: true })).barometre).toBe(true);
    expect((await ok('lireBanque', jt.sa!, { chemin: { id: C.id } })).barometre).toBe(true);
    expect((await ok('lireParametresBanque', jt.olivier!)).barometre).toBe(true);
    expect(await ok('listerBarometres', jt.nadia!)).toEqual({ prochainLe: '2026-10-01', donnees: [] });
  });
});

describe('analyse par les règles, sans l\'accord de la banque pour l\'IA', () => {
  it('juin : assistant fermé, rien ne part chez le fournisseur ; les chiffres du mois', async () => {
    expect(await barometres.generer(C.id, '2026-06')).toBe(true);
    expect(recues).toHaveLength(0);
    const b = await ok('lireBarometre', jt.nadia!, { chemin: { mois: '2026-06' } });
    expect(b).toMatchObject({ mois: '2026-06', du: '2026-06-01T00:00:00.000Z', au: '2026-07-01T00:00:00.000Z', source: 'REGLES', precedent: null, peuDeReponses: true, commentaires: 0 });
    expect(b.mesures).toEqual({
      reclamations: 4, urgentes: 0, resolues: 4, tauxRespectSla: 1, tauxPremierContact: 1, delaiResolutionMoyenMinutes: expect.any(Number),
      contestees: 0, enquetes: 4, tauxReponse: 0, reponses: 0, tauxSatisfaits: null, noteMoyenne: null, nps: null,
    });
    expect(b.tendance.map((p: { mois: string; reclamations: number }) => [p.mois, p.reclamations]))
      .toEqual([['2026-01', 0], ['2026-02', 0], ['2026-03', 0], ['2026-04', 0], ['2026-05', 0], ['2026-06', 4]]);
    // Moins de 3 réclamations par catégorie ou par agence : pas d'irritant… sauf le Plateau (4)
    expect(b.irritants).toEqual([]);
    expect(b.agences.map((x: { nom: string }) => x.nom)).toEqual(['Plateau']);
    expect(b.recommandations.every((r: { source: string; decision: string }) => r.source === 'REGLES' && r.decision === 'A_ETUDIER')).toBe(true);
    // Le tour est journalisé (finalité BAROMETRE), sans envoi
    expect((await appelsIa()).map((l) => [l.issue, l.fournisseur, l.jetonsEntree])).toEqual([['REGLES', 'regles', 0]]);
  });
});

describe('analyse par l\'IA (assistant ouvert)', () => {
  it('juillet : une réponse qui invente un chiffre est écartée, les règles prennent le relais', async () => {
    await modifier(C.id, { assistantIa: true });
    aRepondre.push(analyse(() => ({
      themes: [{ titre: 'Attente au guichet', commentaires: [1] }],
      recommandations: [{
        titre: 'Ouvrir un guichet de plus', constat: 'Les clients attendent 47 minutes en moyenne au guichet.',
        action: 'Ouvrir un second guichet le matin.', categorieId: null, priorite: 'HAUTE',
      }],
    })));
    expect(await barometres.generer(C.id, '2026-07')).toBe(true);
    expect(recues).toHaveLength(1);
    const b = await ok('lireBarometre', jt.nadia!, { chemin: { mois: '2026-07' } });
    expect(b.source).toBe('REGLES');
    expect(JSON.stringify(b)).not.toContain('47 minutes');
    expect(b.recommandations.find((r: { titre: string }) => r.titre === 'Traiter plus vite les réclamations « Carte bancaire »'))
      .toMatchObject({ priorite: 'HAUTE', source: 'REGLES', categorie: { id: C.categories.carte, nom: 'Carte bancaire' } });
    expect(b.mesures).toMatchObject({ reclamations: 11, resolues: 11, tauxRespectSla: 0.8182, reponses: 4, tauxSatisfaits: 0.5, noteMoyenne: 3.5 });
    expect(b.precedent).toMatchObject({ reclamations: 4 });
    expect((await appelsIa()).at(-1)).toMatchObject({ issue: 'REPONSE_INVALIDE', fournisseur: 'anthropic', jetonsEntree: 3000 });
  });

  let requete: any;
  let carte = '';

  it('août, par le worker le 1er septembre : chiffres agrégés et commentaires masqués, sans nom ni identifiant', async () => {
    aRepondre.push(analyse((r) => {
      requete = r;
      const texte: string = r.messages[0].content;
      const numero = (debut: string) => Number(new RegExp(`^\\[(\\d+)\\] \\(\\d/5\\) ${debut}`, 'm').exec(texte)![1]);
      carte = /^- (C\d) « Carte bancaire »/m.exec(texte)![1]!;
      return {
        themes: [
          { titre: 'Attente et suivi du dossier', commentaires: [numero('Trois semaines'), numero('Personne ne'), numero('Délai trop long')] },
          { titre: 'Amabilité du personnel', commentaires: [numero('\\[NOM\\] a été'), numero('Bon accueil')] },
        ],
        recommandations: [
          {
            titre: 'Accélérer les réclamations carte bancaire', constat: '4 réclamations « Carte bancaire » sur 10 résolues l\'ont été hors délai.',
            action: 'Renforcer l\'équipe monétique et rappeler chaque client dont la carte est bloquée.', categorieId: carte, priorite: 'HAUTE',
          },
          {
            titre: 'Rappeler les clients sans nouvelles', constat: 'Le client [NOM] attend depuis longtemps.',
            action: 'L\'appeler.', categorieId: null, priorite: 'HAUTE',
          },
          {
            titre: 'Informer les clients de l\'avancement', constat: 'Plusieurs clients disent avoir dû relancer pour connaître l\'avancement de leur dossier.',
            action: 'Envoyer un message à chaque étape du traitement.', categorieId: null, priorite: 'MOYENNE',
          },
        ],
      };
    }));
    // Le travail du worker, tel que le planificateur le lance
    expect(await executer('barometre', { barometres, horloge: () => maintenant } as unknown as Executants)).toEqual({ publies: 1 });
    expect(recues).toHaveLength(2);
    const envoye = JSON.stringify(requete);
    expect(requete.messages[0].content).toContain('Baromètre d\'août 2026.');
    expect(requete.messages[0].content).toContain(`- ${carte} « Carte bancaire » : 10 réclamations (mois précédent : 5) ; résolues : 10, dont 4 hors délai`);
    expect(requete.messages[0].content).toContain('rappelez-moi au [TELEPHONE]');
    expect(requete.messages[0].content).toContain('écrivez-moi à [EMAIL]');
    expect(requete.messages[0].content).toContain('Je m\'appelle [NOM] [NOM] et j\'attends');
    expect(requete.messages[0].content).toContain('[NOM] a été très aimable');
    // Ni client, ni agent, ni numéro de réclamation, ni identifiant interne
    for (const nom of [...new Set(clients.flatMap((c) => c.split(' ')))]) expect(envoye).not.toContain(nom);
    for (const interdit of ['Rokia', 'Sangaré', 'Nadia', 'Olivier', '07 45 12 33 90', 'client.mecontent', 'CEL-2026', C.categories.carte, C.agences.yopougon, C.id]) {
      expect(envoye).not.toContain(interdit);
    }
  });

  it('août : le baromètre publié, recommandations de l\'IA vérifiées, thèmes comptés sur les vrais commentaires', async () => {
    const b = await ok('lireBarometre', jt.olivier!, { chemin: { mois: '2026-08' } });
    expect(b.source).toBe('IA');
    expect(b.mesures).toEqual({
      reclamations: 24, urgentes: 0, resolues: 24, tauxRespectSla: 0.7917, tauxPremierContact: 0.9167, delaiResolutionMoyenMinutes: expect.any(Number),
      contestees: 2, enquetes: 24, tauxReponse: 0.6667, reponses: 16, tauxSatisfaits: 0.5, noteMoyenne: 3.2, nps: -19,
    });
    expect(b.peuDeReponses).toBe(true);
    expect(b.precedent).toMatchObject({ reclamations: 11 });
    expect(b.tendance.map((p: { reclamations: number }) => p.reclamations)).toEqual([0, 0, 0, 4, 11, 24]);
    expect(b.irritants.map((i: { nom: string; score: number }) => [i.nom, i.score])).toEqual([['Carte bancaire', 20], ['Virement', 11], ['Frais bancaires', 8]]);
    expect(b.irritants[0]).toEqual({
      id: C.categories.carte, nom: 'Carte bancaire', score: 20, reclamations: 10, precedent: 5, resolues: 10, horsDelai: 4, contestees: 2, reponses: 6, insatisfaits: 4,
    });
    expect(b.agences.map((i: { nom: string; reclamations: number; horsDelai: number }) => [i.nom, i.reclamations, i.horsDelai])).toEqual([['Plateau', 11, 2], ['Yopougon', 8, 3]]);
    expect(b.faitsMarquants).toContainEqual({ sens: 'MOINS_BIEN', texte: 'Réclamations reçues : 24 (+118 %)' });
    expect(b.faitsMarquants).toContainEqual({ sens: 'MOINS_BIEN', texte: '« Carte bancaire » : 10 réclamations, contre 5 le mois précédent' });
    expect(b.commentaires).toBe(8);
    // Thèmes de l'IA : mentions et tonalité comptées sur les commentaires désignés ; exemples tels qu'écrits
    expect(b.themes.map((t: { libelle: string; mentions: number; negatifs: number; positifs: number }) => [t.libelle, t.mentions, t.negatifs, t.positifs]))
      .toEqual([['Attente et suivi du dossier', 3, 3, 0], ['Amabilité du personnel', 2, 0, 2]]);
    expect(b.themes[0].exemples[0]).toMatchObject({ note: 1, texte: TROIS_SEMAINES });
    expect(b.themes[0].exemples[0].numero).toMatch(/^CEL-2026-\d{6}$/);
    // La recommandation qui citait une étiquette de masquage est écartée ; la catégorie est retrouvée
    expect(b.recommandations.map((r: { ordre: number; titre: string; source: string; priorite: string; categorie: unknown }) => [r.ordre, r.titre, r.source, r.priorite, r.categorie])).toEqual([
      [1, 'Accélérer les réclamations carte bancaire', 'IA', 'HAUTE', { id: C.categories.carte, nom: 'Carte bancaire' }],
      [2, 'Informer les clients de l\'avancement', 'IA', 'MOYENNE', null],
    ]);
    expect((await appelsIa()).at(-1)).toMatchObject({ issue: 'OK', fournisseur: 'anthropic', modele: 'modele-de-test', jetonsEntree: 3000, jetonsSortie: 400 });
  });

  it('un seul baromètre par mois : le worker repasse sans rien publier, une seconde publication est sans effet', async () => {
    await avancer('2026-09-01T00:15:00Z');
    expect(await barometres.publier()).toEqual({ publies: 0 });
    expect(await barometres.generer(C.id, '2026-08')).toBe(false);
    expect(await bd.enBanque(C.id, (tx) => tx.barometre.count())).toBe(3);
    // Le 1er octobre, ce sera septembre (sans réclamation : les règles, sans envoi)
    expect(recues).toHaveLength(2);
  });
});

describe('lecture et décisions', () => {
  it('liste du plus récent au plus ancien, avec le prochain', async () => {
    const l = await ok('listerBarometres', jt.olivier!);
    expect(l.prochainLe).toBe('2026-10-01');
    expect(l.donnees.map((x: { mois: string; source: string; reclamations: number; recommandations: number; aEtudier: number }) => [x.mois, x.source, x.reclamations, x.aEtudier === x.recommandations]))
      .toEqual([['2026-08', 'IA', 24, true], ['2026-07', 'REGLES', 11, true], ['2026-06', 'REGLES', 4, true]]);
    expect(l.donnees[0]).toMatchObject({ tauxRespectSla: 0.7917, tauxSatisfaits: 0.5, recommandations: 2, genereLe: '2026-09-01T00:05:00.000Z' });
  });

  it('rôles : l\'agent n\'y a pas accès, le superviseur lit sans décider, le Super Admin n\'y a aucun accès', async () => {
    const b = await ok('lireBarometre', jt.nadia!, { chemin: { mois: '2026-08' } });
    const reco = b.recommandations[0].id as string;
    expect((await refus('listerBarometres', jt.rokia!))[0]).toBe(403);
    expect((await refus('lireBarometre', jt.rokia!, { chemin: { mois: '2026-08' } }))[0]).toBe(403);
    expect((await refus('deciderRecommandation', jt.olivier!, { chemin: { mois: '2026-08', id: reco }, corps: { decision: 'RETENUE' } }))[0]).toBe(403);
    expect((await refus('listerBarometres', jt.sa!))[0]).toBe(403);
    expect((await refus('lireBarometre', jt.sa!, { chemin: { mois: '2026-08' } }))[0]).toBe(403);
    expect(await refus('lireBarometre', jt.nadia!, { chemin: { mois: '2026-05' } })).toEqual([404, 'INTROUVABLE']);
    expect((await refus('lireBarometre', jt.nadia!, { chemin: { mois: '2026-13' } }))[0]).toBe(400);
  });

  it('l\'Admin Entreprise retient ou écarte, avec un commentaire ; journal d\'audit ; retour à « à étudier »', async () => {
    await avancer('2026-09-02T09:30:00Z');
    const b = await ok('lireBarometre', jt.nadia!, { chemin: { mois: '2026-08' } });
    const [r1, r2] = b.recommandations.map((r: { id: string }) => r.id) as [string, string];
    const retenue = await ok('deciderRecommandation', jt.nadia!, { chemin: { mois: '2026-08', id: r1 }, corps: { decision: 'RETENUE', commentaire: '  Renfort de deux agents monétique dès lundi  ' } });
    expect(retenue).toMatchObject({
      id: r1, decision: 'RETENUE', commentaire: 'Renfort de deux agents monétique dès lundi', decideePar: { id: C.nadia.id, nom: 'Nadia Kacou' }, decideeLe: '2026-09-02T09:30:00.000Z',
      titre: 'Accélérer les réclamations carte bancaire', source: 'IA',
    });
    expect((await ok('deciderRecommandation', jt.nadia!, { chemin: { mois: '2026-08', id: r2 }, corps: { decision: 'ECARTEE' } })).decision).toBe('ECARTEE');
    expect((await ok('listerBarometres', jt.nadia!)).donnees[0]).toMatchObject({ recommandations: 2, aEtudier: 0 });
    // Revenir sur sa décision : à étudier, sans auteur
    expect(await ok('deciderRecommandation', jt.nadia!, { chemin: { mois: '2026-08', id: r2 }, corps: { decision: 'A_ETUDIER' } }))
      .toMatchObject({ decision: 'A_ETUDIER', decideePar: null, decideeLe: null, commentaire: null });
    // Mauvais mois, valeur inconnue, commentaire trop long
    expect(await refus('deciderRecommandation', jt.nadia!, { chemin: { mois: '2026-07', id: r1 }, corps: { decision: 'ECARTEE' } })).toEqual([404, 'INTROUVABLE']);
    expect((await refus('deciderRecommandation', jt.nadia!, { chemin: { mois: '2026-08', id: r1 }, corps: { decision: 'PEUT_ETRE' } }))[0]).toBe(400);
    expect((await refus('deciderRecommandation', jt.nadia!, { chemin: { mois: '2026-08', id: r1 }, corps: { decision: 'ECARTEE', commentaire: 'x'.repeat(1001) } }))[0]).toBe(400);
    // Le texte publié n'a pas changé
    const apres = await ok('lireBarometre', jt.nadia!, { chemin: { mois: '2026-08' } });
    expect(apres.recommandations.map((r: { titre: string; constat: string }) => [r.titre, r.constat])).toEqual(b.recommandations.map((r: { titre: string; constat: string }) => [r.titre, r.constat]));
    const journal = await bd.enBanque(C.id, (tx) => tx.journalAudit.findMany({ where: { action: { startsWith: 'barometre.' } }, orderBy: { id: 'asc' } }));
    expect(journal.map((l) => [l.action, l.acteurLibelle])).toEqual([
      ['barometre.publie', 'Système'], ['barometre.publie', 'Système'], ['barometre.publie', 'Système'],
      ['barometre.recommandation', 'Nadia Kacou'], ['barometre.recommandation', 'Nadia Kacou'], ['barometre.recommandation', 'Nadia Kacou'],
    ]);
    expect(journal[2]!.donnees).toEqual({ mois: '2026-08', analyse: 'IA', recommandations: 2 });
    expect(journal[3]!.donnees).toEqual({ mois: '2026-08', avant: 'A_ETUDIER', apres: 'RETENUE', commentaire: true });
  });

  it('notification à l\'Admin Entreprise et aux superviseurs, une par baromètre ; pas aux agents', async () => {
    const page = await ok('listerNotifications', jt.nadia!);
    const siennes = page.donnees.filter((n: { modele: string }) => n.modele === 'barometre.pret');
    expect(siennes.map((n: { sujet: string }) => n.sujet)).toEqual(['Baromètre d\'août 2026', 'Baromètre de juillet 2026', 'Baromètre de juin 2026']);
    expect(siennes[0].contenu).toBe('Le baromètre d\'août 2026 est prêt : 2 recommandations à étudier, irritant principal « Carte bancaire ».');
    expect((await ok('listerNotifications', jt.olivier!)).donnees.filter((n: { modele: string }) => n.modele === 'barometre.pret')).toHaveLength(3);
    expect((await ok('listerNotifications', jt.rokia!)).donnees.filter((n: { modele: string }) => n.modele === 'barometre.pret')).toHaveLength(0);
  });
});

describe('isolation et fermeture', () => {
  it('une autre banque ne voit rien de la Banque Céleste ; créée après la fin du mois, elle n\'a pas de baromètre d\'août', async () => {
    await avancer('2026-09-02T10:00:00Z');
    const b = await ok('lireBarometre', jt.nadia!, { chemin: { mois: '2026-08' } });
    expect(await refus('listerBarometres', jt.fatou!)).toEqual([403, 'FONCTION_NON_OUVERTE']);
    await modifier(a.id, { barometre: true });
    expect(await barometres.publier()).toEqual({ publies: 0 });
    expect((await ok('listerBarometres', jt.fatou!)).donnees).toEqual([]);
    expect(await refus('lireBarometre', jt.fatou!, { chemin: { mois: '2026-08' } })).toEqual([404, 'INTROUVABLE']);
    expect(await refus('deciderRecommandation', jt.fatou!, { chemin: { mois: '2026-08', id: b.recommandations[0].id }, corps: { decision: 'ECARTEE' } })).toEqual([404, 'INTROUVABLE']);
    await modifier(a.id, { barometre: false });
  });

  it('fermé par Makor : plus d\'accès ni de publication ; les baromètres restent et reviennent à la réouverture', async () => {
    await modifier(C.id, { barometre: false });
    expect(await refus('lireBarometre', jt.nadia!, { chemin: { mois: '2026-08' } })).toEqual([403, 'FONCTION_NON_OUVERTE']);
    await avancer('2026-10-01T00:05:00Z');
    expect(await barometres.publier()).toEqual({ publies: 0 });
    await modifier(C.id, { barometre: true });
    // Rouvert le 1er octobre : septembre arrive au passage suivant (aucune réclamation : les règles)
    expect(await barometres.publier()).toEqual({ publies: 1 });
    const l = await ok('listerBarometres', jt.nadia!);
    expect(l.donnees.map((x: { mois: string }) => x.mois)).toEqual(['2026-09', '2026-08', '2026-07', '2026-06']);
    expect(l.prochainLe).toBe('2026-11-01');
    expect(recues).toHaveLength(2);
  });

  it('consommation de l\'IA pour Makor : les analyses du baromètre sont comptées', async () => {
    const c = await ok('lireConsommationIa', jt.sa!, { requete: { mois: '2026-09' } });
    expect(c.banques.find((b: { banque: { id: string } }) => b.banque.id === C.id)).toMatchObject({
      banque: { id: C.id, nom: 'Banque Céleste' }, assistantIa: true, tours: 0, suggestions: 0, barometres: 3, parIa: 1, regles: 2, jetonsEntree: 6000, jetonsSortie: 800,
    });
    const octobre = await ok('lireConsommationIa', jt.sa!, { requete: { mois: '2026-10' } });
    expect(octobre.banques.find((b: { banque: { id: string } }) => b.banque.id === C.id)).toMatchObject({ barometres: 1, parIa: 0, regles: 1 });
  });
});
