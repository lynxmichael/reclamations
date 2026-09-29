/**
 * Paramétrage (Admin Entreprise), personnel, journal d'audit de la banque.
 * Recette §10, critère 9 : le journal d'audit restitue toutes les actions d'une réclamation ;
 * une ligne modifiée à la main est détectée par la vérification de la chaîne.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { urlsE2E } from '../../scripts/base-de-test.js';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import { BaseDonnees } from '../../src/infrastructure/base-de-donnees/base-de-donnees.service.js';
import { ClientApi, connecter, demarrerApi, FICHIERS, fermerOutils, jeu, nouvelleIp, type ApiDeTest } from './environnement.js';

let api: ApiDeTest;
let client: ClientApi;
let bd: BaseDonnees;
const j = jeu();
const jt: Record<string, string> = {};

beforeAll(async () => {
  api = await demarrerApi();
  client = new ClientApi(api.url);
  bd = new BaseDonnees(api.config.baseDeDonneesUrl);
  for (const [cle, email] of Object.entries({ fatou: j.alpha.comptes.fatou.email, serge: j.alpha.comptes.serge.email, aya: j.alpha.comptes.aya.email, awa: j.horizon.comptes.awa.email })) {
    jt[cle] = (await connecter(client, email)).jeton;
  }
});

afterAll(async () => {
  await bd.fermer();
  await api.fermer();
  await fermerOutils();
});

describe('paramètres et apparence', () => {
  it('lecture pour tout le personnel ; l\'Admin Entreprise règle couleurs et contact, pas le reste', async () => {
    const p = await client.appeler('lireParametresBanque', { jeton: jt.aya });
    expect(p.corps).toMatchObject({ nom: 'Banque Alpha', prefixeTickets: 'ALP', seuilAlerteSlaPourcent: 75, plan: { nom: 'Pro', plafondAgents: 40 } });
    expect(p.corps.consommation.agents).toBeGreaterThanOrEqual(5);
    const m = await client.appeler('modifierApparence', { jeton: jt.fatou, corps: { couleurPrimaire: '#0a5c50', emailContact: 'Contact@Banque-Alpha.example' } });
    expect(m.corps).toMatchObject({ couleurPrimaire: '#0A5C50', emailContact: 'contact@banque-alpha.example' });
    expect((await client.appeler('modifierApparence', { jeton: jt.fatou, corps: {} })).statut).toBe(400);
    expect((await client.appeler('modifierApparence', { jeton: jt.fatou, corps: { couleurPrimaire: 'vert' } })).statut).toBe(400);
  });

  it('logo PNG servi par son adresse publique, en cache ; un SVG avec script est refusé', async () => {
    const r = await client.appeler('televerserLogo', { jeton: jt.fatou, fichiers: [{ champ: 'logo', nom: 'logo.png', contenu: FICHIERS.png }] });
    expect(r.statut).toBe(200);
    expect(r.corps.logoUrl).toMatch(/^\/api\/v1\/public\/logos\/[A-Za-z0-9_-]{24}\.png$/);
    const fichier = r.corps.logoUrl.split('/').pop();
    const logo = await client.appeler('lireLogo', { chemin: { fichier } });
    expect(logo.octets.equals(FICHIERS.png)).toBe(true);
    expect(logo.entetes.get('cache-control')).toContain('immutable');
    const formulaire = await client.appeler('lireFormulaireDepot', { chemin: { code: j.alpha.points.qr } });
    expect(formulaire.corps.banque.logoUrl).toBe(r.corps.logoUrl);
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const refus = await client.appeler('televerserLogo', { jeton: jt.fatou, fichiers: [{ champ: 'logo', nom: 'logo.svg', contenu: svg }] });
    expect(refus.statut).toBe(415);
    const propre = await client.appeler('televerserLogo', { jeton: jt.fatou, fichiers: [{ champ: 'logo', nom: 'logo.svg', contenu: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="#0a5c50"/></svg>') }] });
    expect(propre.corps.logoUrl).toMatch(/\.svg$/);
    // L'ancien logo n'est plus servi
    expect((await client.appeler('lireLogo', { chemin: { fichier } })).statut).toBe(404);
    const tropGros = await client.appeler('televerserLogo', { jeton: jt.fatou, fichiers: [{ champ: 'logo', nom: 'gros.png', contenu: Buffer.concat([FICHIERS.png, Buffer.alloc(1024 * 1024)]) }] });
    expect(tropGros.statut).toBe(413);
  });
});

describe('catégories, agences, points de dépôt, horaires, jours fériés', () => {
  it('catégories : création, nom unique, modification sans effet sur les tickets en cours', async () => {
    const c = await client.appeler('creerCategorie', { jeton: jt.fatou, corps: { nom: 'Assurance', delaiCibleMinutes: 1200, prioriteParDefaut: 'NORMALE', ordre: 9 } });
    expect(c.statut).toBe(201);
    expect((await client.appeler('creerCategorie', { jeton: jt.fatou, corps: { nom: 'Assurance', delaiCibleMinutes: 60 } })).corps.code).toBe('NOM_DEJA_UTILISE');
    const m = await client.appeler('modifierCategorie', { jeton: jt.fatou, chemin: { id: c.corps.id }, corps: { delaiCibleMinutes: 600, active: false } });
    expect(m.corps).toMatchObject({ delaiCibleMinutes: 600, active: false });
    const liste = await client.appeler('listerCategories', { jeton: jt.aya });
    expect(liste.corps.find((x: { id: string }) => x.id === c.corps.id).active).toBe(false);
    const formulaire = await client.appeler('lireFormulaireDepot', { chemin: { code: j.alpha.points.qr } });
    expect(formulaire.corps.categories.some((x: { id: string }) => x.id === c.corps.id)).toBe(false);
    expect((await client.appeler('modifierCategorie', { jeton: jt.fatou, chemin: { id: j.horizon.categories['Crédit'] }, corps: { ordre: 1 } })).statut).toBe(404);
  });

  it('agences : code unique ; points : un QR code exige une agence, le code est généré et ne change pas', async () => {
    const a = await client.appeler('creerAgence', { jeton: jt.fatou, corps: { code: 'ag09', nom: 'San-Pédro Port', ville: 'San-Pédro' } });
    expect(a.corps.code).toBe('AG09');
    expect((await client.appeler('creerAgence', { jeton: jt.fatou, corps: { code: 'AG09', nom: 'Doublon' } })).corps.code).toBe('CODE_DEJA_UTILISE');
    expect((await client.appeler('modifierAgence', { jeton: jt.fatou, chemin: { id: a.corps.id }, corps: { adresse: 'Rue du Port' } })).corps.adresse).toBe('Rue du Port');
    expect((await client.appeler('listerAgences', { jeton: jt.serge })).corps.some((x: { code: string }) => x.code === 'AG09')).toBe(true);

    const sansAgence = await client.appeler('creerPointDepot', { jeton: jt.fatou, corps: { canal: 'QR_CODE', libelle: 'Guichet' } });
    expect(sansAgence.statut).toBe(422);
    expect(sansAgence.corps.code).toBe('QR_CODE_SANS_AGENCE');
    const p = await client.appeler('creerPointDepot', { jeton: jt.fatou, corps: { canal: 'QR_CODE', libelle: 'Guichet', agenceId: a.corps.id } });
    expect(p.statut).toBe(201);
    expect(p.corps.code).toMatch(/^[A-HJ-NP-Z2-9]{10}$/);
    expect(p.corps.urlDepot).toBe(`https://alpha.reclamations.example/d/${p.corps.code}`);
    const m = await client.appeler('modifierPointDepot', { jeton: jt.fatou, chemin: { id: p.corps.id }, corps: { actif: false } });
    expect(m.corps).toMatchObject({ actif: false, code: p.corps.code });
    expect((await client.appeler('lireFormulaireDepot', { chemin: { code: p.corps.code } })).corps.code).toBe('POINT_DE_DEPOT_INACTIF');
    expect((await client.appeler('modifierPointDepot', { jeton: jt.fatou, chemin: { id: p.corps.id }, corps: { agenceId: null } })).statut).toBe(422);
    expect((await client.appeler('listerPointsDepot', { jeton: jt.serge })).statut).toBe(200);

    const png = await client.appeler('telechargerQrCode', { jeton: jt.serge, chemin: { id: p.corps.id }, requete: { taille: 256 } });
    expect(png.entetes.get('content-type')).toBe('image/png');
    expect(png.octets.subarray(1, 4).toString()).toBe('PNG');
    const svg = await client.appeler('telechargerQrCode', { jeton: jt.serge, chemin: { id: p.corps.id }, requete: { format: 'svg' } });
    expect(svg.octets.toString()).toContain('<svg');
  });

  it('horaires : la semaine est remplacée d\'un bloc, les plages qui se touchent sont fusionnées', async () => {
    const r = await client.appeler('remplacerHoraires', {
      jeton: jt.awa,
      corps: { plages: [{ jourSemaine: 1, debut: '08:00', fin: '12:00' }, { jourSemaine: 1, debut: '11:30', fin: '13:00' }, { jourSemaine: 6, debut: '09:00', fin: '12:00' }] },
    });
    expect(r.corps).toEqual({ fuseauHoraire: 'Africa/Abidjan', plages: [{ jourSemaine: 1, debut: '08:00', fin: '13:00' }, { jourSemaine: 6, debut: '09:00', fin: '12:00' }] });
    expect((await client.appeler('remplacerHoraires', { jeton: jt.awa, corps: { plages: [{ jourSemaine: 2, debut: '12:00', fin: '08:00' }] } })).statut).toBe(400);
    expect((await client.appeler('lireHoraires', { jeton: jt.aya })).corps.plages.length).toBe(10);
  });

  it('jours fériés : ajout, doublon refusé, filtre par année (récurrents compris), retrait', async () => {
    const t = await client.appeler('ajouterJourFerie', { jeton: jt.fatou, corps: { date: '2027-03-20', libelle: 'Aïd el-Fitr' } });
    expect(t.statut).toBe(201);
    expect((await client.appeler('ajouterJourFerie', { jeton: jt.fatou, corps: { date: '2027-03-20', libelle: 'Doublon' } })).corps.code).toBe('JOUR_FERIE_EXISTANT');
    const annee = await client.appeler('listerJoursFeries', { jeton: jt.aya, requete: { annee: 2027 } });
    expect(annee.corps.map((x: { date: string }) => x.date)).toContain('2027-03-20');
    expect(annee.corps.map((x: { date: string }) => x.date)).toContain('2027-08-07');
    expect((await client.appeler('supprimerJourFerie', { jeton: jt.fatou, chemin: { id: t.corps.id } })).statut).toBe(204);
    expect((await client.appeler('supprimerJourFerie', { jeton: jt.fatou, chemin: { id: t.corps.id } })).statut).toBe(404);
  });
});

describe('personnel et équipes', () => {
  it('le superviseur liste le personnel ; seul l\'Admin Entreprise invite, modifie, désactive', async () => {
    const agents = await client.appeler('listerUtilisateurs', { jeton: jt.serge, requete: { role: 'AGENT', statut: 'ACTIF' } });
    expect(agents.corps.donnees.every((u: { role: string; statut: string }) => u.role === 'AGENT' && u.statut === 'ACTIF')).toBe(true);
    const recherche = await client.appeler('listerUtilisateurs', { jeton: jt.fatou, requete: { recherche: 'konan' } });
    expect(recherche.corps.donnees.map((u: { email: string }) => u.email)).toEqual([j.alpha.comptes.aya.email]);
    expect((await client.appeler('lireUtilisateur', { jeton: jt.serge, chemin: { id: j.alpha.comptes.aya.id } })).corps.superviseur.nom).toBe('Serge Kouadio');
    expect((await client.appeler('inviterUtilisateur', { jeton: jt.serge, corps: { email: 'x@y.example', nom: 'X', prenom: 'Y', role: 'AGENT' } })).statut).toBe(403);
  });

  it('e-mail déjà pris sur la plateforme : 409 ; superviseur invalide : 422', async () => {
    const pris = await client.appeler('inviterUtilisateur', { jeton: jt.fatou, corps: { email: j.horizon.comptes.didier.email, nom: 'X', prenom: 'Y', role: 'AGENT' } });
    expect(pris.statut).toBe(409);
    expect(pris.corps.code).toBe('EMAIL_DEJA_UTILISE');
    const sup = await client.appeler('inviterUtilisateur', { jeton: jt.fatou, corps: { email: 'z@banque-alpha.example', nom: 'Z', prenom: 'Z', role: 'AGENT', superviseurId: j.alpha.comptes.aya.id } });
    expect(sup.corps.code).toBe('SUPERVISEUR_INVALIDE');
  });

  it('changement de rôle, équipe, désactivation (sessions fermées) et réactivation', async () => {
    const u = await client.appeler('modifierUtilisateur', { jeton: jt.fatou, chemin: { id: j.alpha.comptes.ibrahim.id }, corps: { superviseurId: j.alpha.comptes.serge.id, telephone: '07 01 02 03 04' } });
    expect(u.corps).toMatchObject({ superviseur: { nom: 'Serge Kouadio' }, telephone: '+2250701020304' });
    expect((await client.appeler('modifierUtilisateur', { jeton: jt.fatou, chemin: { id: j.alpha.comptes.fatou.id }, corps: { role: 'AGENT' } })).statut).toBe(403);
    expect((await client.appeler('desactiverUtilisateur', { jeton: jt.fatou, chemin: { id: j.alpha.comptes.fatou.id } })).statut).toBe(403);
    const { jeton } = await connecter(client, j.alpha.comptes.ibrahim.email);
    const d = await client.appeler('desactiverUtilisateur', { jeton: jt.fatou, chemin: { id: j.alpha.comptes.ibrahim.id } });
    expect(d.corps.statut).toBe('DESACTIVE');
    expect((await client.appeler('lireMoi', { jeton })).statut).toBe(401);
    const r = await client.appeler('reactiverUtilisateur', { jeton: jt.fatou, chemin: { id: j.alpha.comptes.ibrahim.id } });
    expect(r.corps.statut).toBe('ACTIF');
  });

  it('invitation renvoyée seulement à un compte invité ; plafond d\'agents du plan (422)', async () => {
    expect((await client.appeler('renvoyerInvitation', { jeton: jt.fatou, chemin: { id: j.alpha.comptes.estelle.id } })).statut).toBe(202);
    const deja = await client.appeler('renvoyerInvitation', { jeton: jt.fatou, chemin: { id: j.alpha.comptes.aya.id } });
    expect(deja.statut).toBe(409);
    expect(deja.corps.code).toBe('INVITATION_DEJA_ACCEPTEE');
    // Horizon passe sur un plan de 3 agents : elle en a déjà 2 (superviseur + agent)
    const plan = await bd.enSysteme((tx) => tx.plan.create({ data: { code: 'TEST_3', nom: 'Test trois', plafondAgents: 3 } }));
    await bd.enSysteme((tx) => tx.banque.update({ where: { id: j.horizon.id }, data: { planId: plan.id } }));
    expect((await client.appeler('inviterUtilisateur', { jeton: jt.awa, corps: { email: 'troisieme@banque-horizon.example', nom: 'T', prenom: 'T', role: 'AGENT' } })).statut).toBe(201);
    const plafond = await client.appeler('inviterUtilisateur', { jeton: jt.awa, corps: { email: 'quatrieme@banque-horizon.example', nom: 'Q', prenom: 'Q', role: 'SUPERVISEUR' } });
    expect(plafond.statut).toBe(422);
    expect(plafond.corps.code).toBe('PLAFOND_AGENTS_ATTEINT');
    // Un Admin Entreprise ne compte pas dans le plafond
    expect((await client.appeler('inviterUtilisateur', { jeton: jt.awa, corps: { email: 'admin2@banque-horizon.example', nom: 'A', prenom: 'A', role: 'ADMIN_ENTREPRISE' } })).statut).toBe(201);
  });
});

describe('journal d\'audit de la banque (critère 9)', () => {
  it('restitue les actions d\'une réclamation ; une ligne modifiée à la main est détectée', async () => {
    const d = await client.appeler('deposerReclamation', {
      ip: nouvelleIp(), chemin: { code: j.alpha.points.qr },
      corps: { categorieId: j.alpha.categories['Crédit'], description: 'Audit', nom: 'Client Audit', telephone: '0700000501', consentement: true, versionPolitique: '2026-09' },
    });
    const id = (await bd.enSysteme((tx) => tx.reclamation.findUniqueOrThrow({ where: { jetonSuivi: d.corps.jetonSuivi } }))).id;
    await client.appeler('assignerReclamation', { jeton: jt.serge, chemin: { id }, corps: { agentId: j.alpha.comptes.aya.id } });
    const journal = await client.appeler('listerJournalBanque', { jeton: jt.fatou, requete: { entiteId: id } });
    expect(journal.corps.donnees.map((l: { action: string }) => l.action)).toEqual(['reclamation.assignation', 'reclamation.depot']);
    expect(journal.corps.donnees[0].acteur).toMatchObject({ type: 'UTILISATEUR', libelle: 'Serge Kouadio', role: 'SUPERVISEUR' });
    const parAction = await client.appeler('listerJournalBanque', { jeton: jt.fatou, requete: { action: 'parametrage.', parPage: 5 } });
    expect(parAction.corps.donnees.every((l: { action: string }) => l.action.startsWith('parametrage.'))).toBe(true);
    expect((await client.appeler('listerJournalBanque', { jeton: jt.serge })).statut).toBe(403);

    const avant = await client.appeler('verifierJournalBanque', { jeton: jt.fatou });
    expect(avant.corps).toMatchObject({ chaine: `banque:${j.alpha.id}`, valide: true, premiereRupture: null });

    // Altération par un superutilisateur qui désactive les triggers (hors application)
    const proprietaire = new PrismaClient({ adapter: new PrismaPg({ connectionString: urlsE2E().proprietaire }) });
    const ligne = journal.corps.donnees[1];
    await proprietaire.$transaction([
      proprietaire.$executeRawUnsafe('SET LOCAL session_replication_role = replica'),
      proprietaire.$executeRawUnsafe(`UPDATE journal_audit SET action = 'reclamation.effacee' WHERE id = ${Number(ligne.id)}`),
    ]);
    await proprietaire.$disconnect();
    const apres = await client.appeler('verifierJournalBanque', { jeton: jt.fatou });
    expect(apres.corps.valide).toBe(false);
    expect(apres.corps.premiereRupture).toBe(ligne.rang);
  });
});
