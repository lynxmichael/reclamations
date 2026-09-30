/**
 * Cloisonnement et garde-fous de l'API.
 * Recette §10, critère 4 : un agent de la banque A qui demande un ticket de la banque B reçoit 404 ;
 * la même lecture, faite directement en SQL, ne renvoie rien.
 */
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { urlsE2E } from '../../scripts/base-de-test.js';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import { BaseDonnees } from '../../src/infrastructure/base-de-donnees/base-de-donnees.service.js';
import { CLE_BATTEMENT_WORKER } from '../../src/infrastructure/redis/redis.service.js';
import { transactionEn, contexte } from '../../src/infrastructure/base-de-donnees/index.js';
import { ClientApi, connecter, demarrerApi, FICHIERS, fermerOutils, jeu, nouvelleIp, redisE2E, type ApiDeTest } from './environnement.js';

let api: ApiDeTest;
let client: ClientApi;
let bd: BaseDonnees;
const j = jeu();
const jetons: Record<string, string> = {};

const deposer = (code: string, categorieId: string, telephone: string, extra: Record<string, unknown> = {}, ip = nouvelleIp()) =>
  client.appeler('deposerReclamation', {
    ip, chemin: { code },
    corps: { categorieId, description: 'Opération inconnue sur mon compte', nom: 'Client Test', telephone, consentement: true, versionPolitique: '2026-09', ...extra },
  });

beforeAll(async () => {
  api = await demarrerApi();
  client = new ClientApi(api.url);
  bd = new BaseDonnees(api.config.baseDeDonneesUrl);
  for (const [cle, email] of Object.entries({
    agentA: j.alpha.comptes.aya.email, agentA2: j.alpha.comptes.mamadou.email, supA: j.alpha.comptes.serge.email,
    adminA: j.alpha.comptes.fatou.email, supB: j.horizon.comptes.didier.email, superAdmin: j.superAdmin.email,
  })) jetons[cle] = (await connecter(client, email)).jeton;
});

afterAll(async () => {
  await bd.fermer();
  await api.fermer();
  await fermerOutils();
});

describe('cloisonnement entre banques (arbitrage 2)', () => {
  let ticketB: string;

  beforeAll(async () => {
    const r = await deposer(j.horizon.points.qr, j.horizon.categories['Carte bancaire'], '0700000101');
    expect(r.statut).toBe(201);
    ticketB = (await bd.enSysteme((tx) => tx.reclamation.findUniqueOrThrow({ where: { jetonSuivi: r.corps.jetonSuivi } }))).id;
  });

  it('un agent ou un superviseur de la banque A qui demande un ticket de la banque B reçoit 404', async () => {
    for (const jeton of [jetons.agentA, jetons.supA, jetons.adminA]) {
      const r = await client.appeler('lireReclamation', { jeton, chemin: { id: ticketB } });
      expect(r.statut).toBe(404);
      expect(r.corps.code).toBe('INTROUVABLE');
    }
    const action = await client.appeler('assignerReclamation', { jeton: jetons.supA, chemin: { id: ticketB }, corps: { agentId: j.alpha.comptes.aya.id } });
    expect(action.statut).toBe(404);
  });

  it('la même lecture, faite directement en SQL dans le contexte de la banque A, ne renvoie rien', async () => {
    const lignes = await transactionEn(bd.base, contexte.banque(j.alpha.id), (tx) => tx.$queryRaw<unknown[]>`SELECT id FROM reclamation WHERE id = ${ticketB}::uuid`);
    expect(lignes).toEqual([]);
  });

  it('la banque B voit son ticket ; la recherche de la banque A ne le trouve pas', async () => {
    expect((await client.appeler('lireReclamation', { jeton: jetons.supB, chemin: { id: ticketB } })).statut).toBe(200);
    const liste = await client.appeler('listerReclamations', { jeton: jetons.supA, requete: { recherche: 'HOR-' } });
    expect(liste.corps.donnees).toEqual([]);
  });

  it('un agent ne voit pas le ticket d\'un autre agent de sa banque (404, pas 403)', async () => {
    const r = await deposer(j.alpha.points.qr, j.alpha.categories['Crédit'], '0700000102');
    const id = (await bd.enSysteme((tx) => tx.reclamation.findUniqueOrThrow({ where: { jetonSuivi: r.corps.jetonSuivi } }))).id;
    await client.appeler('assignerReclamation', { jeton: jetons.supA, chemin: { id }, corps: { agentId: j.alpha.comptes.aya.id } });
    expect((await client.appeler('lireReclamation', { jeton: jetons.agentA, chemin: { id } })).statut).toBe(200);
    expect((await client.appeler('lireReclamation', { jeton: jetons.agentA2, chemin: { id } })).statut).toBe(404);
    expect((await client.appeler('prendreEnCharge', { jeton: jetons.agentA2, chemin: { id } })).statut).toBe(404);
    const liste = await client.appeler('listerReclamations', { jeton: jetons.agentA2, requete: { parPage: 100 } });
    expect(liste.corps.donnees.some((t: { id: string }) => t.id === id)).toBe(false);
  });
});

describe('rôles et authentification', () => {
  it('sans jeton : 401 ; jeton invalide : 401 JETON_INVALIDE', async () => {
    expect((await client.appeler('listerReclamations')).statut).toBe(401);
    const r = await client.appeler('listerReclamations', { jeton: 'abc.def.ghi' });
    expect(r.statut).toBe(401);
    expect(r.corps.code).toBe('JETON_INVALIDE');
  });

  it('un rôle absent de x-roles reçoit 403 INTERDIT', async () => {
    expect((await client.appeler('creerCategorie', { jeton: jetons.supA, corps: { nom: 'Test', delaiCibleMinutes: 60 } })).statut).toBe(403);
    expect((await client.appeler('assignerReclamation', { jeton: jetons.agentA, chemin: { id: randomUUID() }, corps: { agentId: randomUUID() } })).statut).toBe(403);
    expect((await client.appeler('listerBanques', { jeton: jetons.adminA })).statut).toBe(403);
  });

  it('le Super Admin n\'entre pas dans l\'espace d\'une banque (arbitrage 7)', async () => {
    const r = await client.appeler('listerReclamations', { jeton: jetons.superAdmin });
    expect(r.statut).toBe(403);
  });

  it('un jeton client n\'ouvre pas les routes du personnel, et inversement', async () => {
    const d = await deposer(j.alpha.points.qr, j.alpha.categories['Crédit'], '0700000103');
    await client.appeler('demanderCodeOtp', { chemin: { jetonSuivi: d.corps.jetonSuivi } });
    const sms = await bd.enSysteme((tx) => tx.notification.findFirstOrThrow({ where: { modele: 'client.otp', destination: '+2250700000103' } }));
    const s = await client.appeler('verifierCodeOtp', { chemin: { jetonSuivi: d.corps.jetonSuivi }, corps: { code: /(\d{6})/.exec(sms.contenu)![1] } });
    expect((await client.appeler('listerReclamations', { jeton: s.corps.jetonClient })).statut).toBe(401);
    expect((await client.appeler('listerMesReclamations', { jeton: jetons.agentA })).statut).toBe(401);
  });

  it('un client ne lit pas la réclamation d\'un autre client (404)', async () => {
    const autre = await deposer(j.alpha.points.qr, j.alpha.categories['Crédit'], '0700000104');
    const idAutre = (await bd.enSysteme((tx) => tx.reclamation.findUniqueOrThrow({ where: { jetonSuivi: autre.corps.jetonSuivi } }))).id;
    const moi = await deposer(j.alpha.points.qr, j.alpha.categories['Crédit'], '0700000105');
    await client.appeler('demanderCodeOtp', { chemin: { jetonSuivi: moi.corps.jetonSuivi } });
    const sms = await bd.enSysteme((tx) => tx.notification.findFirstOrThrow({ where: { modele: 'client.otp', destination: '+2250700000105' } }));
    const s = await client.appeler('verifierCodeOtp', { chemin: { jetonSuivi: moi.corps.jetonSuivi }, corps: { code: /(\d{6})/.exec(sms.contenu)![1] } });
    for (const op of ['lireMaReclamation', 'confirmerResolution'] as const) {
      expect((await client.appeler(op, { jeton: s.corps.jetonClient, chemin: { id: idAutre } })).statut).toBe(404);
    }
    expect((await client.appeler('envoyerMessageClient', { jeton: s.corps.jetonClient, chemin: { id: idAutre }, corps: { contenu: 'Bonjour' } })).statut).toBe(404);
  });
});

describe('validation, fichiers, idempotence et limites de débit', () => {
  it('formulaire incomplet : 400 VALIDATION, erreurs par champ', async () => {
    const r = await client.appeler('deposerReclamation', {
      chemin: { code: j.alpha.points.qr },
      corps: { categorieId: 'pas-un-uuid', description: '', nom: 'A', telephone: '07 08', consentement: false, versionPolitique: '2026-09' },
    });
    expect(r.statut).toBe(400);
    expect(r.corps.code).toBe('VALIDATION');
    expect(r.corps.erreurs.map((e: { champ: string }) => e.champ).sort()).toEqual(['categorieId', 'consentement', 'description', 'nom']);
    const tel = await deposer(j.alpha.points.qr, j.alpha.categories['Crédit'], '07 08');
    expect(tel.statut).toBe(400);
    expect(tel.corps.erreurs).toEqual([{ champ: 'telephone', message: expect.stringContaining('4 chiffres') }]);
  });

  it('point inconnu : 404 ; catégorie d\'une autre banque : 422 CATEGORIE_INVALIDE', async () => {
    expect((await client.appeler('lireFormulaireDepot', { chemin: { code: 'ZZZZZZZZZZ' } })).statut).toBe(404);
    const r = await deposer(j.alpha.points.qr, j.horizon.categories['Crédit'], '0700000106');
    expect(r.statut).toBe(422);
    expect(r.corps.code).toBe('CATEGORIE_INVALIDE');
  });

  it('fichier d\'un type refusé : 415 ; plus de 5 fichiers : 422 ; plus de 5 Mo : 413', async () => {
    const base = { categorieId: j.alpha.categories['Crédit'], description: 'Test', nom: 'Client Test', telephone: '0700000107', consentement: true, versionPolitique: '2026-09' };
    const exe = await client.appeler('deposerReclamation', { chemin: { code: j.alpha.points.qr }, corps: base, fichiers: [{ champ: 'fichiers', nom: 'facture.pdf', contenu: FICHIERS.exe }] });
    expect(exe.statut).toBe(415);
    expect(exe.corps.code).toBe('TYPE_DE_FICHIER_NON_SUPPORTE');
    const six = await client.appeler('deposerReclamation', {
      chemin: { code: j.alpha.points.qr }, corps: base, fichiers: Array.from({ length: 6 }, (_, i) => ({ champ: 'fichiers', nom: `p${i}.png`, contenu: FICHIERS.png })),
    });
    expect(six.statut).toBe(422);
    expect(six.corps.code).toBe('TROP_DE_FICHIERS');
    const gros = await client.appeler('deposerReclamation', {
      chemin: { code: j.alpha.points.qr }, corps: base, fichiers: [{ champ: 'fichiers', nom: 'gros.pdf', contenu: Buffer.concat([FICHIERS.pdf, Buffer.alloc(5 * 1024 * 1024)]) }],
    });
    expect(gros.statut).toBe(413);
  });

  it('Idempotency-Key : le même envoi renvoie le même accusé, sans doublon ; une autre requête avec la clé : 409', async () => {
    const cle = randomUUID();
    const ip = nouvelleIp();
    const corps = { categorieId: j.alpha.categories['Crédit'], description: 'Double envoi sur réseau mobile', nom: 'Réseau Lent', telephone: '0700000108', consentement: true, versionPolitique: '2026-09' };
    const a = await client.appeler('deposerReclamation', { ip, chemin: { code: j.alpha.points.qr }, corps, entetes: { 'Idempotency-Key': cle } });
    const b = await client.appeler('deposerReclamation', { ip, chemin: { code: j.alpha.points.qr }, corps, entetes: { 'Idempotency-Key': cle } });
    expect(a.statut).toBe(201);
    expect(b.statut).toBe(201);
    expect(b.corps).toEqual(a.corps);
    const n = await bd.enSysteme((tx) => tx.reclamation.count({ where: { client: { telephone: '+2250700000108' } } }));
    expect(n).toBe(1);
    const c = await client.appeler('deposerReclamation', { ip, chemin: { code: j.alpha.points.qr }, corps: { ...corps, description: 'Autre chose' }, entetes: { 'Idempotency-Key': cle } });
    expect(c.statut).toBe(409);
    expect(c.corps.code).toBe('CONFLIT_IDEMPOTENCE');
  });

  it('5 dépôts par heure et par adresse IP, 3 par téléphone : 429 avec Retry-After', async () => {
    const ip = nouvelleIp();
    for (let i = 0; i < 5; i++) expect((await deposer(j.alpha.points.lien, j.alpha.categories['Crédit'], `07000002${10 + i}`, {}, ip)).statut).toBe(201);
    const sixieme = await deposer(j.alpha.points.lien, j.alpha.categories['Crédit'], '0700000299', {}, ip);
    expect(sixieme.statut).toBe(429);
    expect(Number(sixieme.entetes.get('retry-after'))).toBeGreaterThan(3000);
    for (let i = 0; i < 3; i++) expect((await deposer(j.alpha.points.lien, j.alpha.categories['Crédit'], '0700000300')).statut).toBe(201);
    expect((await deposer(j.alpha.points.lien, j.alpha.categories['Crédit'], '0700000300')).statut).toBe(429);
  });

  it('un lien web propose les agences ; l\'agence choisie est retenue', async () => {
    const f = await client.appeler('lireFormulaireDepot', { chemin: { code: j.alpha.points.lien } });
    expect(f.corps.agence).toBeNull();
    expect(f.corps.agences.map((a: { nom: string }) => a.nom)).toEqual(expect.arrayContaining(['Bouaké Commerce', 'Cocody Angré', 'Plateau']));
    const r = await deposer(j.alpha.points.lien, j.alpha.categories['Crédit'], '0700000109', { agenceId: j.alpha.agences['Cocody Angré'] });
    const t = await bd.enSysteme((tx) => tx.reclamation.findUniqueOrThrow({ where: { jetonSuivi: r.corps.jetonSuivi } }));
    expect(t.canal).toBe('LIEN_WEB');
    expect(t.agenceId).toBe(j.alpha.agences['Cocody Angré']);
  });

  it('identifiant mal formé : 404 ; adresse inconnue : 404 problem+json', async () => {
    expect((await client.appeler('lireReclamation', { jeton: jetons.supA, chemin: { id: 'abc' } })).statut).toBe(404);
    const r = await fetch(`${api.url}/rien/du/tout`);
    expect(r.status).toBe(404);
    expect(r.headers.get('content-type')).toContain('application/problem+json');
  });

  it('certificats à la demande : seuls la console et les portails des banques sont reconnus', async () => {
    const tls = (domaine: string) => fetch(api.url.replace('/api/v1', `/interne/tls?domain=${domaine}`)).then((r) => r.status);
    expect(await tls('alpha.reclamations.example')).toBe(200);
    expect(await tls('console.reclamations.example')).toBe(200);
    expect(await tls('inconnue.reclamations.example')).toBe(404);
    expect(await tls('alpha.ailleurs.example')).toBe(404);
  });

  it('santé et documentation Swagger (le contrat lui-même)', async () => {
    // Aucun worker pendant ces tests : dégradé (HTTP 200), puis ok dès qu'un battement est écrit
    const redis = new Redis(redisE2E());
    const proprietaire = new PrismaClient({ adapter: new PrismaPg({ connectionString: urlsE2E().proprietaire }) });
    await redis.del(CLE_BATTEMENT_WORKER);
    const s = await client.appeler('lireSante');
    expect(s.statut).toBe(200);
    expect(s.corps).toMatchObject({ statut: 'degrade', base: 'ok', redis: 'ok', worker: 'absent', envois: 'ok' });
    await redis.set(CLE_BATTEMENT_WORKER, new Date().toISOString(), 'EX', 60);
    const apres = await client.appeler('lireSante');
    expect(apres.corps).toMatchObject({ base: 'ok', redis: 'ok', worker: 'ok', envois: 'ok' });
    expect(apres.corps.statut).toBe(apres.corps.disque === 'ok' ? 'ok' : 'degrade');
    // Un e-mail en attente depuis 11 minutes : envois en retard
    const [n] = await proprietaire.$queryRaw<{ id: string }[]>`
      INSERT INTO notification (id, canal, modele, destination, sujet, contenu, cree_le)
      VALUES (gen_random_uuid(), 'EMAIL', 'essai.sante', 'x@exemple.ci', 'x', 'x', now() - interval '11 minutes') RETURNING id`;
    expect((await client.appeler('lireSante')).corps).toMatchObject({ statut: 'degrade', envois: 'en_retard' });
    await proprietaire.$executeRaw`DELETE FROM notification WHERE id = ${n!.id}::uuid`;
    await redis.del(CLE_BATTEMENT_WORKER);
    redis.disconnect();
    await proprietaire.$disconnect();
    const doc = await fetch(api.url.replace('/api/v1', '/api/docs/openapi.yaml'));
    expect(await doc.text()).toContain('operationId: lireLogo');
    expect((await fetch(api.url.replace('/api/v1', '/api/docs'))).status).toBe(200);
  });
});
