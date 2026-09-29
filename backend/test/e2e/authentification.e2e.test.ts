/**
 * Authentification du personnel (décision C6) : mot de passe + TOTP, verrouillage, anti-rejeu,
 * refresh token avec rotation et détection de réutilisation, invitation et enrôlement TOTP,
 * mot de passe oublié, réinitialisation du TOTP par l'Admin Entreprise.
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
});

afterAll(async () => {
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
  it('invitation : mot de passe robuste exigé, enrôlement TOTP, puis session ; le lien ne sert qu\'une fois', async () => {
    const inv = await client.appeler('inviterUtilisateur', {
      jeton: admin, corps: { email: 'nouvel.agent@banque-alpha.example', nom: 'Agent', prenom: 'Nouvel', role: 'AGENT', superviseurId: j.alpha.comptes.serge.id },
    });
    expect(inv.statut).toBe(201);
    expect(inv.corps).toMatchObject({ statut: 'INVITE', totpActif: false, superviseur: { nom: 'Serge Kouadio' } });
    const jeton = await jetonDuLien(inv.corps.id, 'personnel.invitation');
    const faible = await client.appeler('accepterInvitation', { corps: { jeton, motDePasse: 'azertyuiop123' } });
    expect(faible.statut).toBe(400);
    expect(faible.corps.code).toBe('MOT_DE_PASSE_TROP_FAIBLE');
    const e = await client.appeler('accepterInvitation', { corps: { jeton, motDePasse: 'Lagune-Ebrie-2026!' } });
    expect(e.statut).toBe(200);
    expect(e.corps.otpauthUrl).toMatch(/^otpauth:\/\/totp\//);
    expect(e.corps.qrCodeDataUrl).toMatch(/^data:image\/png;base64,/);
    expect((await client.appeler('accepterInvitation', { corps: { jeton, motDePasse: 'Lagune-Ebrie-2026!' } })).statut).toBe(401);
    const s = await client.appeler('activerTotp', { corps: { jetonIntermediaire: e.corps.jetonIntermediaire, code: codeCourant(e.corps.secret) } });
    expect(s.statut).toBe(200);
    expect(s.corps.utilisateur.role).toBe('AGENT');
    const u = await client.appeler('lireUtilisateur', { jeton: admin, chemin: { id: inv.corps.id } });
    expect(u.corps).toMatchObject({ statut: 'ACTIF', totpActif: true });
    // Le compte fonctionne ensuite avec son nouveau mot de passe
    const c = await client.appeler('connexion', { corps: { email: 'nouvel.agent@banque-alpha.example', motDePasse: 'Lagune-Ebrie-2026!' } });
    expect(c.corps.etape).toBe('TOTP_REQUIS');
  });

  it('réinitialisation du TOTP par l\'Admin Entreprise : sessions fermées, nouvel enrôlement à la connexion', async () => {
    const cible = j.alpha.comptes.mamadou;
    const { jeton } = await connecter(client, cible.email);
    const r = await client.appeler('reinitialiserTotp', { jeton: admin, chemin: { id: cible.id } });
    expect(r.corps.totpActif).toBe(false);
    expect((await client.appeler('lireMoi', { jeton })).statut).toBe(401);
    const e = await client.appeler('connexion', { corps: { email: cible.email, motDePasse: MOT_DE_PASSE_DEMO } });
    expect(e.corps.etape).toBe('ENROLEMENT_TOTP_REQUIS');
    const s = await client.appeler('activerTotp', { corps: { jetonIntermediaire: e.corps.jetonIntermediaire, code: codeCourant(e.corps.enrolement.secret) } });
    expect(s.statut).toBe(200);
    // Remettre le secret du jeu de démonstration pour les autres tests
    const { chiffrer } = await import('../../src/infrastructure/securite/totp.js');
    const { secretTotpDemo } = await import('../../scripts/jeu-de-donnees.js');
    await bd.enSysteme((tx) => tx.utilisateur.update({ where: { id: cible.id }, data: { totpSecretChiffre: chiffrer(api.config.cleTotp, secretTotpDemo(cible.email)) } }));
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
