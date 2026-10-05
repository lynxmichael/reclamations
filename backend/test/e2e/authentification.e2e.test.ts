/**
 * Authentification du personnel (décision C6) : mot de passe + TOTP, verrouillage, anti-rejeu,
 * refresh token avec rotation et détection de réutilisation, invitation et enrôlement TOTP,
 * mot de passe oublié, réinitialisation du TOTP par l'Admin Entreprise.
 *
 * Étape 19 : double authentification au choix de la banque. La Banque Alpha la laisse facultative
 * (réglage par défaut), la Banque Horizon l'exige ; « Mon compte » pour l'activer ou la désactiver.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MOT_DE_PASSE_DEMO } from '../../scripts/jeu-de-donnees.js';
import { BaseDonnees } from '../../src/infrastructure/base-de-donnees/base-de-donnees.service.js';
import { codeCourant } from '../../src/infrastructure/securite/totp.js';
import { ClientApi, codeTotp, connecter, demarrerApi, fermerOutils, jeu, nouvelleIp, type ApiDeTest } from './environnement.js';

let api: ApiDeTest;
let client: ClientApi;
let bd: BaseDonnees;
const j = jeu();
let admin: string;
let adminHorizon: string;

async function rafraichir(cookie: string) {
  const r = await client.appeler('rafraichirSession', { cookie, ip: nouvelleIp() });
  const brut = r.entetes.get('set-cookie') ?? '';
  return { statut: r.statut, corps: r.corps, cookie: brut.split(';')[0], brut };
}

const jetonDuLien = async (utilisateurId: string, modele: string) => {
  const n = await bd.enSysteme((tx) => tx.notification.findFirstOrThrow({ where: { destinataireUtilisateurId: utilisateurId, modele }, orderBy: { creeLe: 'desc' } }));
  return /#jeton=([A-Za-z0-9_-]+)/.exec(n.contenu)![1];
};

beforeAll(async () => {
  api = await demarrerApi();
  client = new ClientApi(api.url);
  bd = new BaseDonnees(api.config.baseDeDonneesUrl);
  admin = (await connecter(client, j.alpha.comptes.fatou.email)).jeton;
  adminHorizon = (await connecter(client, j.horizon.comptes.awa.email)).jeton;
});

/** Au début d'un pas de 30 s : les codes des pas précédent, courant et suivant restent valables le temps du test. */
async function debutDePas() {
  const reste = 30_000 - (Date.now() % 30_000);
  if (reste < 15_000) await new Promise((r) => setTimeout(r, reste + 500));
}

const cookieDe = (r: { entetes: Headers }) => (r.entetes.get('set-cookie') ?? '').split(';')[0];

/** Invitation acceptée dans une banque où la double authentification est facultative : session ouverte. */
async function compteSansTotp(jetonAdmin: string, email: string, role: 'AGENT' | 'SUPERVISEUR' | 'ADMIN_ENTREPRISE' = 'AGENT') {
  const inv = await client.appeler('inviterUtilisateur', { jeton: jetonAdmin, corps: { email, nom: 'Test', prenom: 'Compte', role } });
  expect(inv.statut).toBe(201);
  crees.push({ id: inv.corps.id, banque: 'alpha' });
  const jeton = await jetonDuLien(inv.corps.id, 'personnel.invitation');
  const motDePasse = 'Riviera-Golf-2026!';
  const e = await client.appeler('accepterInvitation', { corps: { jeton, motDePasse } });
  expect(e.corps.etape).toBe('SESSION_OUVERTE');
  return { id: inv.corps.id as string, email, motDePasse, jeton: e.corps.session.jetonAcces as string, cookie: cookieDe(e) };
}

/** Comptes créés ici, désactivés à la fin : les suites suivantes comptent le personnel des deux banques. */
const crees: { id: string; banque: 'alpha' | 'horizon' }[] = [];

afterAll(async () => {
  for (const c of crees) {
    const r = await client.appeler('desactiverUtilisateur', { jeton: c.banque === 'alpha' ? admin : adminHorizon, chemin: { id: c.id } });
    expect(r.statut).toBe(200);
  }
  await bd.fermer();
  await api.fermer();
  await fermerOutils();
});

describe('connexion en deux étapes', () => {
  it('mot de passe correct : étape TOTP ; code correct : session, cookie httpOnly SameSite=Strict, profil', async () => {
    const e = await client.appeler('connexion', { corps: { email: j.alpha.comptes.serge.email.toUpperCase(), motDePasse: MOT_DE_PASSE_DEMO } });
    expect(e.corps.etape).toBe('TOTP_REQUIS');
    const s = await client.appeler('validerCodeTotp', { corps: { jetonIntermediaire: e.corps.jetonIntermediaire, code: await codeTotp(j.alpha.comptes.serge.email) } });
    expect(s.statut).toBe(200);
    expect(s.corps.utilisateur).toMatchObject({ role: 'SUPERVISEUR', banque: { slug: 'alpha', fuseauHoraire: 'Africa/Abidjan' } });
    const cookie = s.entetes.get('set-cookie') ?? '';
    expect(cookie).toMatch(/^rt=[A-Za-z0-9_-]{40,};/);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Path=/api/v1/auth');
    const moi = await client.appeler('lireMoi', { jeton: s.corps.jetonAcces });
    expect(moi.corps.email).toBe(j.alpha.comptes.serge.email);
    // Le jeton intermédiaire ne sert qu'une fois
    const rejeu = await client.appeler('validerCodeTotp', { corps: { jetonIntermediaire: e.corps.jetonIntermediaire, code: '123456' } });
    expect(rejeu.statut).toBe(401);
  });

  it('mauvais mot de passe ou compte inconnu : même réponse 401 IDENTIFIANTS_INVALIDES', async () => {
    const a = await client.appeler('connexion', { corps: { email: j.alpha.comptes.serge.email, motDePasse: 'mauvais-mot-de-passe' } });
    const b = await client.appeler('connexion', { corps: { email: 'personne@nulle-part.example', motDePasse: 'mauvais-mot-de-passe' } });
    expect([a.statut, b.statut]).toEqual([401, 401]);
    expect(a.corps).toEqual(b.corps);
    expect(a.corps.code).toBe('IDENTIFIANTS_INVALIDES');
  });

  it('5 échecs verrouillent le compte 15 minutes (423 + Retry-After), même avec le bon mot de passe', async () => {
    const email = j.alpha.comptes.ibrahim.email;
    for (let i = 0; i < 5; i++) {
      expect((await client.appeler('connexion', { ip: nouvelleIp(), corps: { email, motDePasse: `faux-mot-de-passe-${i}` } })).statut).toBe(401);
    }
    const r = await client.appeler('connexion', { ip: nouvelleIp(), corps: { email, motDePasse: MOT_DE_PASSE_DEMO } });
    expect(r.statut).toBe(423);
    expect(r.corps.code).toBe('COMPTE_VERROUILLE');
    expect(Number(r.entetes.get('retry-after'))).toBeGreaterThan(800);
    const u = await client.appeler('lireUtilisateur', { jeton: admin, chemin: { id: j.alpha.comptes.ibrahim.id } });
    expect(u.corps.verrouilleJusquA).not.toBeNull();
    await bd.enSysteme((tx) => tx.utilisateur.update({ where: { id: j.alpha.comptes.ibrahim.id }, data: { verrouilleJusquA: null, echecsConnexion: 0 } }));
  });

  it('code TOTP faux : 401 CODE_TOTP_INVALIDE ; un code déjà utilisé est refusé', async () => {
    const email = j.alpha.comptes.mariam.email;
    const e = await client.appeler('connexion', { corps: { email, motDePasse: MOT_DE_PASSE_DEMO } });
    const faux = await client.appeler('validerCodeTotp', { corps: { jetonIntermediaire: e.corps.jetonIntermediaire, code: '000000' } });
    expect(faux.statut).toBe(401);
    expect(faux.corps.code).toBe('CODE_TOTP_INVALIDE');
    const code = await codeTotp(email);
    expect((await client.appeler('validerCodeTotp', { corps: { jetonIntermediaire: e.corps.jetonIntermediaire, code } })).statut).toBe(200);
    const e2 = await client.appeler('connexion', { corps: { email, motDePasse: MOT_DE_PASSE_DEMO } });
    const rejeu = await client.appeler('validerCodeTotp', { corps: { jetonIntermediaire: e2.corps.jetonIntermediaire, code } });
    expect(rejeu.statut).toBe(401);
  });

  it('10 échecs par quart d\'heure et par adresse IP : 429 (les connexions réussies ne comptent pas)', async () => {
    const ip = nouvelleIp();
    for (let i = 0; i < 10; i++) await client.appeler('connexion', { ip, corps: { email: `inconnu${i}@nulle-part.example`, motDePasse: 'x' } });
    expect((await client.appeler('connexion', { ip, corps: { email: 'inconnu@nulle-part.example', motDePasse: 'x' } })).statut).toBe(429);
  });
});

describe('sessions : rotation du refresh token, réutilisation, déconnexion', () => {
  it('chaque rafraîchissement change le refresh token ; rejouer un ancien jeton ferme toute la session', async () => {
    const { cookie } = await connecter(client, j.alpha.comptes.aya.email);
    const r1 = await rafraichir(cookie);
    expect(r1.statut).toBe(200);
    expect(r1.cookie).not.toBe(cookie);
    const r2 = await rafraichir(r1.cookie);
    expect(r2.statut).toBe(200);
    // L'ancien jeton revient (vol présumé) après le délai de tolérance : toute la famille est révoquée
    await bd.enSysteme((tx) => tx.sessionUtilisateur.updateMany({ where: { remplaceLe: { not: null } }, data: { remplaceLe: new Date(Date.now() - 60_000) } }));
    const vol = await rafraichir(cookie);
    expect(vol.statut).toBe(401);
    expect(vol.brut).toContain('rt=;');
    expect((await rafraichir(r2.cookie)).statut).toBe(401);
    expect((await client.appeler('lireMoi', { jeton: r2.corps.jetonAcces })).statut).toBe(401);
    const trace = await bd.enSysteme((tx) => tx.journalAudit.count({ where: { action: 'auth.reutilisation_refresh_token', entiteId: j.alpha.comptes.aya.id } }));
    expect(trace).toBe(1);
  });

  it('sans cookie : 401 ; déconnexion : le jeton d\'accès et le refresh token tombent', async () => {
    expect((await client.appeler('rafraichirSession')).statut).toBe(401);
    const { jeton, cookie } = await connecter(client, j.alpha.comptes.mamadou.email);
    expect((await client.appeler('deconnexion', { jeton })).statut).toBe(204);
    expect((await client.appeler('lireMoi', { jeton })).statut).toBe(401);
    expect((await rafraichir(cookie)).statut).toBe(401);
  });
});

describe('invitation, enrôlement TOTP, mot de passe oublié', () => {
  it('invitation, double authentification exigée (Banque Horizon) : mot de passe robuste, enrôlement TOTP, puis session ; le lien ne sert qu\'une fois', async () => {
    const inv = await client.appeler('inviterUtilisateur', {
      jeton: adminHorizon, corps: { email: 'nouvel.agent@banque-horizon.example', nom: 'Agent', prenom: 'Nouvel', role: 'AGENT', superviseurId: j.horizon.comptes.didier.id },
    });
    expect(inv.statut).toBe(201);
    crees.push({ id: inv.corps.id, banque: 'horizon' });
    expect(inv.corps).toMatchObject({ statut: 'INVITE', totpActif: false, superviseur: { nom: 'Didier Yao' } });
    const lien = await bd.enSysteme((tx) => tx.notification.findFirstOrThrow({ where: { destinataireUtilisateurId: inv.corps.id, modele: 'personnel.invitation' } }));
    expect(lien.contenu).toContain('activez la double authentification');
    const jeton = await jetonDuLien(inv.corps.id, 'personnel.invitation');
    const faible = await client.appeler('accepterInvitation', { corps: { jeton, motDePasse: 'azertyuiop123' } });
    expect(faible.statut).toBe(400);
    expect(faible.corps.code).toBe('MOT_DE_PASSE_TROP_FAIBLE');
    const e = await client.appeler('accepterInvitation', { corps: { jeton, motDePasse: 'Lagune-Ebrie-2026!' } });
    expect(e.statut).toBe(200);
    expect(e.corps.etape).toBe('ENROLEMENT_TOTP_REQUIS');
    expect(e.entetes.get('set-cookie')).toBeNull();
    expect(e.corps.enrolement.otpauthUrl).toMatch(/^otpauth:\/\/totp\//);
    expect(e.corps.enrolement.qrCodeDataUrl).toMatch(/^data:image\/png;base64,/);
    expect((await client.appeler('accepterInvitation', { corps: { jeton, motDePasse: 'Lagune-Ebrie-2026!' } })).statut).toBe(401);
    const s = await client.appeler('activerTotp', { corps: { jetonIntermediaire: e.corps.enrolement.jetonIntermediaire, code: codeCourant(e.corps.enrolement.secret) } });
    expect(s.statut).toBe(200);
    expect(s.corps.utilisateur).toMatchObject({ role: 'AGENT', totpActif: true, totpObligatoire: true });
    const u = await client.appeler('lireUtilisateur', { jeton: adminHorizon, chemin: { id: inv.corps.id } });
    expect(u.corps).toMatchObject({ statut: 'ACTIF', totpActif: true });
    // Le compte fonctionne ensuite avec son nouveau mot de passe
    const c = await client.appeler('connexion', { corps: { email: 'nouvel.agent@banque-horizon.example', motDePasse: 'Lagune-Ebrie-2026!' } });
    expect(c.corps.etape).toBe('TOTP_REQUIS');
  });

  it('invitation, double authentification facultative (Banque Alpha) : le mot de passe ouvre la session, sans code', async () => {
    const inv = await client.appeler('inviterUtilisateur', {
      jeton: admin, corps: { email: 'nouvel.agent@banque-alpha.example', nom: 'Agent', prenom: 'Nouvel', role: 'AGENT', superviseurId: j.alpha.comptes.serge.id },
    });
    crees.push({ id: inv.corps.id, banque: 'alpha' });
    const lien = await bd.enSysteme((tx) => tx.notification.findFirstOrThrow({ where: { destinataireUtilisateurId: inv.corps.id, modele: 'personnel.invitation' } }));
    expect(lien.contenu).not.toContain('double authentification');
    const jeton = await jetonDuLien(inv.corps.id, 'personnel.invitation');
    const e = await client.appeler('accepterInvitation', { corps: { jeton, motDePasse: 'Lagune-Ebrie-2026!' } });
    expect(e.statut).toBe(200);
    expect(e.corps.etape).toBe('SESSION_OUVERTE');
    expect(e.corps.jetonIntermediaire).toBeUndefined();
    expect(e.corps.session.utilisateur).toMatchObject({ role: 'AGENT', totpActif: false, totpObligatoire: false });
    expect(e.entetes.get('set-cookie')).toMatch(/^rt=[A-Za-z0-9_-]{40,};.*HttpOnly/);
    expect((await client.appeler('lireMoi', { jeton: e.corps.session.jetonAcces })).statut).toBe(200);
    const u = await client.appeler('lireUtilisateur', { jeton: admin, chemin: { id: inv.corps.id } });
    expect(u.corps).toMatchObject({ statut: 'ACTIF', totpActif: false });
    // Connexion suivante : le mot de passe suffit, la session s'ouvre et le refresh token est posé
    const c = await client.appeler('connexion', { corps: { email: 'nouvel.agent@banque-alpha.example', motDePasse: 'Lagune-Ebrie-2026!' } });
    expect(c.corps.etape).toBe('SESSION_OUVERTE');
    expect(c.entetes.get('set-cookie')).toMatch(/^rt=/);
    expect((await rafraichir(cookieDe(c))).statut).toBe(200);
    const trace = await bd.enSysteme((tx) => tx.journalAudit.findFirstOrThrow({ where: { action: 'auth.connexion', entiteId: inv.corps.id }, orderBy: { rang: 'desc' } }));
    expect(trace.donnees).toEqual({ doubleAuthentification: false });
  });

  it('réinitialisation du TOTP par l\'Admin Entreprise : sessions fermées ; nouvel enrôlement si la banque l\'exige, sinon le mot de passe suffit', async () => {
    const { chiffrer } = await import('../../src/infrastructure/securite/totp.js');
    const { secretTotpDemo } = await import('../../scripts/jeu-de-donnees.js');
    // Banque Horizon (exigée) : nouvel enrôlement à la connexion
    const salif = j.horizon.comptes.salif;
    const { jeton: acces } = await connecter(client, salif.email);
    const r = await client.appeler('reinitialiserTotp', { jeton: adminHorizon, chemin: { id: salif.id } });
    expect(r.corps.totpActif).toBe(false);
    expect((await client.appeler('lireMoi', { jeton: acces })).statut).toBe(401);
    const e = await client.appeler('connexion', { corps: { email: salif.email, motDePasse: MOT_DE_PASSE_DEMO } });
    expect(e.corps.etape).toBe('ENROLEMENT_TOTP_REQUIS');
    expect((await client.appeler('activerTotp', { corps: { jetonIntermediaire: e.corps.jetonIntermediaire, code: codeCourant(e.corps.enrolement.secret) } })).statut).toBe(200);
    // Banque Alpha (facultative) : la personne se reconnecte avec son mot de passe et la réactivera si elle le souhaite
    const cible = j.alpha.comptes.mamadou;
    const { jeton } = await connecter(client, cible.email);
    expect((await client.appeler('reinitialiserTotp', { jeton: admin, chemin: { id: cible.id } })).corps.totpActif).toBe(false);
    expect((await client.appeler('lireMoi', { jeton })).statut).toBe(401);
    const s = await client.appeler('connexion', { corps: { email: cible.email, motDePasse: MOT_DE_PASSE_DEMO } });
    expect(s.corps.etape).toBe('SESSION_OUVERTE');
    expect(s.corps.session.utilisateur).toMatchObject({ totpActif: false, totpObligatoire: false });
    // Remettre le secret du jeu de démonstration pour les autres tests
    for (const c of [salif, cible]) {
      await bd.enSysteme((tx) => tx.utilisateur.update({ where: { id: c.id }, data: { totpSecretChiffre: chiffrer(api.config.cleTotp, secretTotpDemo(c.email)), totpActiveLe: new Date() } }));
    }
  });

  it('mot de passe oublié : toujours 202 ; le lien change le mot de passe et ferme les sessions', async () => {
    expect((await client.appeler('demanderReinitialisation', { corps: { email: 'inconnu@nulle-part.example' } })).statut).toBe(202);
    const cible = j.horizon.comptes.salif;
    const { jeton: acces } = await connecter(client, cible.email);
    expect((await client.appeler('demanderReinitialisation', { corps: { email: cible.email } })).statut).toBe(202);
    const jeton = await jetonDuLien(cible.id, 'personnel.reinitialisation');
    expect((await client.appeler('reinitialiserMotDePasse', { corps: { jeton, motDePasse: 'Nouveau-Depart-2026' } })).statut).toBe(204);
    expect((await client.appeler('reinitialiserMotDePasse', { corps: { jeton, motDePasse: 'Nouveau-Depart-2026' } })).statut).toBe(401);
    expect((await client.appeler('lireMoi', { jeton: acces })).statut).toBe(401);
    expect((await client.appeler('connexion', { corps: { email: cible.email, motDePasse: MOT_DE_PASSE_DEMO } })).statut).toBe(401);
    expect((await client.appeler('connexion', { corps: { email: cible.email, motDePasse: 'Nouveau-Depart-2026' } })).statut).toBe(200);
  });
});

describe('double authentification au choix de la banque (étape 19)', () => {
  it('facultative par défaut, exigée par la Banque Horizon ; toujours exigée du Super Admin ; lue par le personnel, Makor et le profil', async () => {
    expect((await client.appeler('lireParametresBanque', { jeton: admin })).corps.doubleAuthentificationObligatoire).toBe(false);
    expect((await client.appeler('lireParametresBanque', { jeton: adminHorizon })).corps.doubleAuthentificationObligatoire).toBe(true);
    const sa = (await connecter(client, j.superAdmin.email)).jeton;
    expect((await client.appeler('lireBanque', { jeton: sa, chemin: { id: j.alpha.id } })).corps.doubleAuthentificationObligatoire).toBe(false);
    expect((await client.appeler('lireBanque', { jeton: sa, chemin: { id: j.horizon.id } })).corps.doubleAuthentificationObligatoire).toBe(true);
    expect((await client.appeler('lireMoi', { jeton: admin })).corps).toMatchObject({ totpActif: true, totpObligatoire: false });
    expect((await client.appeler('lireMoi', { jeton: adminHorizon })).corps).toMatchObject({ totpActif: true, totpObligatoire: true });
    expect((await client.appeler('lireMoi', { jeton: sa })).corps).toMatchObject({ totpActif: true, totpObligatoire: true });
    // « Mon compte » est celui du personnel des banques ; le Super Admin la garde toujours
    expect((await client.appeler('preparerTotp', { jeton: sa })).statut).toBe(403);
    expect((await client.appeler('desactiverTotp', { jeton: sa, corps: { code: '123456' } })).statut).toBe(403);
    // Seul l'Admin Entreprise règle sa banque
    const serge = (await connecter(client, j.alpha.comptes.serge.email)).jeton;
    expect((await client.appeler('modifierSecuriteBanque', { jeton: serge, corps: { doubleAuthentificationObligatoire: true } })).statut).toBe(403);
  });

  it('Mon compte : activer avec un premier code, puis désactiver avec un code ; la connexion suit, les autres sessions tombent', async () => {
    const c = await compteSansTotp(admin, 'compte.totp@banque-alpha.example');
    // Activer sans avoir préparé : refusé
    expect((await client.appeler('confirmerTotp', { jeton: c.jeton, corps: { code: '123456' } })).corps.code).toBe('DOUBLE_AUTHENTIFICATION_NON_PREPAREE');
    const p = await client.appeler('preparerTotp', { jeton: c.jeton });
    expect(p.statut).toBe(200);
    expect(p.corps.otpauthUrl).toContain('compte.totp');
    expect(p.corps.qrCodeDataUrl).toMatch(/^data:image\/png;base64,/);
    const ip = nouvelleIp();
    await debutDePas();
    const faux = await client.appeler('confirmerTotp', { jeton: c.jeton, ip, corps: { code: '000000' } });
    expect(faux.statut).toBe(401);
    expect(faux.corps.code).toBe('CODE_TOTP_INVALIDE');
    const maintenant = Date.now();
    const ok = await client.appeler('confirmerTotp', { jeton: c.jeton, corps: { code: codeCourant(p.corps.secret, new Date(maintenant)) } });
    expect(ok.statut).toBe(200);
    expect(ok.corps).toMatchObject({ totpActif: true, totpObligatoire: false });
    expect((await client.appeler('preparerTotp', { jeton: c.jeton })).corps.code).toBe('DOUBLE_AUTHENTIFICATION_DEJA_ACTIVE');
    expect(await bd.enSysteme((tx) => tx.journalAudit.count({ where: { action: 'auth.totp_active', entiteId: c.id } }))).toBe(1);

    // Activée : le code est demandé à chaque connexion
    const e = await client.appeler('connexion', { corps: { email: c.email, motDePasse: c.motDePasse } });
    expect(e.corps.etape).toBe('TOTP_REQUIS');
    const s2 = await client.appeler('validerCodeTotp', { corps: { jetonIntermediaire: e.corps.jetonIntermediaire, code: codeCourant(p.corps.secret, new Date(maintenant + 30_000)) } });
    expect(s2.statut).toBe(200);

    // Désactiver depuis la seconde session : la première tombe, la courante reste
    const d = await client.appeler('desactiverTotp', { jeton: s2.corps.jetonAcces, corps: { code: codeCourant(p.corps.secret, new Date(maintenant - 30_000)) } });
    expect(d.statut).toBe(200);
    expect(d.corps).toMatchObject({ totpActif: false });
    expect((await client.appeler('lireMoi', { jeton: c.jeton })).statut).toBe(401);
    expect((await client.appeler('lireMoi', { jeton: s2.corps.jetonAcces })).statut).toBe(200);
    expect((await client.appeler('desactiverTotp', { jeton: s2.corps.jetonAcces, corps: { code: '123456' } })).corps.code).toBe('DOUBLE_AUTHENTIFICATION_INACTIVE');
    const trace = await bd.enSysteme((tx) => tx.journalAudit.findFirstOrThrow({ where: { action: 'auth.totp_desactive', entiteId: c.id } }));
    expect(trace.donnees).toEqual({ autresSessionsFermees: 1 });
    expect((await client.appeler('connexion', { corps: { email: c.email, motDePasse: c.motDePasse } })).corps.etape).toBe('SESSION_OUVERTE');
  });

  it('rendre obligatoire : l\'Admin Entreprise l\'a activée lui-même ; les sessions sans code tombent ; activation à la connexion ; désactivation refusée ; retour au facultatif', async () => {
    // Un Admin Entreprise sans double authentification ne peut pas l'exiger des autres
    const nouvelAdmin = await compteSansTotp(admin, 'admin.sans.totp@banque-alpha.example', 'ADMIN_ENTREPRISE');
    const refus = await client.appeler('modifierSecuriteBanque', { jeton: nouvelAdmin.jeton, corps: { doubleAuthentificationObligatoire: true } });
    expect(refus.statut).toBe(422);
    expect(refus.corps.code).toBe('DOUBLE_AUTHENTIFICATION_A_ACTIVER');

    const agent = await compteSansTotp(admin, 'agent.sans.totp@banque-alpha.example');
    const avant = await bd.enSysteme((tx) => tx.journalAudit.count({ where: { action: 'parametrage.double_authentification' } }));
    const r = await client.appeler('modifierSecuriteBanque', { jeton: admin, corps: { doubleAuthentificationObligatoire: true } });
    expect(r.statut).toBe(200);
    expect(r.corps.doubleAuthentificationObligatoire).toBe(true);
    // Les sessions ouvertes sans code tombent aussitôt ; celle de l'Admin Entreprise reste
    expect((await client.appeler('lireMoi', { jeton: agent.jeton })).statut).toBe(401);
    expect((await client.appeler('lireMoi', { jeton: nouvelAdmin.jeton })).statut).toBe(401);
    expect((await rafraichir(agent.cookie)).statut).toBe(401);
    expect((await client.appeler('lireMoi', { jeton: admin })).corps).toMatchObject({ totpObligatoire: true });
    const trace = await bd.enSysteme((tx) => tx.journalAudit.findFirstOrThrow({ where: { action: 'parametrage.double_authentification' }, orderBy: { rang: 'desc' } }));
    expect(trace.donnees).toMatchObject({ obligatoire: true });
    expect((trace.donnees as { sessionsFermees: number }).sessionsFermees).toBeGreaterThanOrEqual(2);
    // Même valeur : rien ne change, rien n'est journalisé
    expect((await client.appeler('modifierSecuriteBanque', { jeton: admin, corps: { doubleAuthentificationObligatoire: true } })).statut).toBe(200);
    expect(await bd.enSysteme((tx) => tx.journalAudit.count({ where: { action: 'parametrage.double_authentification' } }))).toBe(avant + 1);

    // L'agent sans double authentification l'active à sa prochaine connexion
    const e = await client.appeler('connexion', { corps: { email: agent.email, motDePasse: agent.motDePasse } });
    expect(e.corps.etape).toBe('ENROLEMENT_TOTP_REQUIS');
    // Une personne qui l'a activée ne peut plus la désactiver
    const refusDesactivation = await client.appeler('desactiverTotp', { jeton: admin, corps: { code: '123456' } });
    expect(refusDesactivation.statut).toBe(422);
    expect(refusDesactivation.corps.code).toBe('DOUBLE_AUTHENTIFICATION_OBLIGATOIRE');
    // Une invitation acceptée passe par l'activation
    const inv = await client.appeler('inviterUtilisateur', { jeton: admin, corps: { email: 'invite.obligatoire@banque-alpha.example', nom: 'Test', prenom: 'Invité', role: 'AGENT' } });
    crees.push({ id: inv.corps.id, banque: 'alpha' });
    const lien = await bd.enSysteme((tx) => tx.notification.findFirstOrThrow({ where: { destinataireUtilisateurId: inv.corps.id, modele: 'personnel.invitation' } }));
    expect(lien.contenu).toContain('activez la double authentification');
    const acceptation = await client.appeler('accepterInvitation', { corps: { jeton: await jetonDuLien(inv.corps.id, 'personnel.invitation'), motDePasse: 'Riviera-Golf-2026!' } });
    expect(acceptation.corps.etape).toBe('ENROLEMENT_TOTP_REQUIS');

    // Retour au facultatif : le mot de passe suffit de nouveau pour qui ne l'a pas activée
    const f = await client.appeler('modifierSecuriteBanque', { jeton: admin, corps: { doubleAuthentificationObligatoire: false } });
    expect(f.corps.doubleAuthentificationObligatoire).toBe(false);
    expect((await client.appeler('connexion', { corps: { email: agent.email, motDePasse: agent.motDePasse } })).corps.etape).toBe('SESSION_OUVERTE');
    // L'invité dont le mot de passe est choisi ouvre sa session, et son compte devient actif
    const invite = await client.appeler('connexion', { corps: { email: 'invite.obligatoire@banque-alpha.example', motDePasse: 'Riviera-Golf-2026!' } });
    expect(invite.corps.etape).toBe('SESSION_OUVERTE');
    expect((await client.appeler('lireUtilisateur', { jeton: admin, chemin: { id: inv.corps.id } })).corps.statut).toBe('ACTIF');
    expect((await client.appeler('lireParametresBanque', { jeton: admin })).corps.doubleAuthentificationObligatoire).toBe(false);
  });
});
