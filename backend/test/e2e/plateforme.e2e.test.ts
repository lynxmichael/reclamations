/**
 * Console de la plateforme (Super Admin) : banques, plans, suspension, journal de toutes les
 * banques, comptes Super Admin. Le Super Admin ne lit jamais le contenu d'une réclamation.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BaseDonnees } from '../../src/infrastructure/base-de-donnees/base-de-donnees.service.js';
import { contexte, transactionEn } from '../../src/infrastructure/base-de-donnees/index.js';
import { ClientApi, connecter, demarrerApi, fermerOutils, jeu, nouvelleIp, type ApiDeTest } from './environnement.js';

let api: ApiDeTest;
let client: ClientApi;
let bd: BaseDonnees;
const j = jeu();
let sa: string;

beforeAll(async () => {
  api = await demarrerApi();
  client = new ClientApi(api.url);
  bd = new BaseDonnees(api.config.baseDeDonneesUrl);
  sa = (await connecter(client, j.superAdmin.email)).jeton;
  // Une réclamation de la Banque Alpha, pour les statistiques et l'arbitrage 7
  const d = await client.appeler('deposerReclamation', {
    ip: nouvelleIp(), chemin: { code: j.alpha.points.qr },
    corps: { categorieId: j.alpha.categories['Crédit'], description: 'Secret bancaire', nom: 'Client Plateforme', telephone: '0700000601', consentement: true, versionPolitique: '2026-09' },
  });
  expect(d.statut).toBe(201);
});

afterAll(async () => {
  await bd.fermer();
  await api.fermer();
  await fermerOutils();
});

describe('plans et banques', () => {
  let planId: string;
  let banqueId: string;

  it('plans : création (code unique), modification, liste', async () => {
    const p = await client.appeler('creerPlan', { jeton: sa, corps: { code: 'DECOUVERTE', nom: 'Découverte', plafondAgents: 3, plafondTicketsMois: 100 } });
    expect(p.statut).toBe(201);
    planId = p.corps.id;
    expect((await client.appeler('creerPlan', { jeton: sa, corps: { code: 'DECOUVERTE', nom: 'Doublon' } })).corps.code).toBe('CODE_DEJA_UTILISE');
    expect((await client.appeler('modifierPlan', { jeton: sa, chemin: { id: planId }, corps: { plafondTicketsMois: 150 } })).corps.plafondTicketsMois).toBe(150);
    expect((await client.appeler('listerPlans', { jeton: sa })).corps.some((x: { code: string }) => x.code === 'DECOUVERTE')).toBe(true);
  });

  it('création d\'une banque : horaires par défaut lun–ven 08:00–17:00 et premier Admin Entreprise invité (C13)', async () => {
    const r = await client.appeler('creerBanque', {
      jeton: sa,
      corps: { nom: 'Banque Lagune', slug: 'lagune', prefixeTickets: 'LAG', planId, administrateur: { email: 'admin@banque-lagune.example', nom: 'Kacou', prenom: 'Ange' } },
    });
    expect(r.statut).toBe(201);
    expect(r.corps).toMatchObject({ nom: 'Banque Lagune', plan: { nom: 'Découverte' }, fuseauHoraire: 'Africa/Abidjan', consommation: { agents: 0, ticketsCeMois: 0 } });
    banqueId = r.corps.id;
    const horaires = await bd.enSysteme((tx) => tx.horaireOuvre.findMany({ where: { tenantId: banqueId } }));
    expect(horaires.map((h) => [h.jourSemaine, h.debutMinute, h.finMinute]).sort()).toEqual([1, 2, 3, 4, 5].map((jr) => [jr, 480, 1020]));
    const admin = await bd.enSysteme((tx) => tx.utilisateur.findUniqueOrThrow({ where: { email: 'admin@banque-lagune.example' } }));
    expect(admin).toMatchObject({ role: 'ADMIN_ENTREPRISE', statut: 'INVITE', tenantId: banqueId });
    const lien = await bd.enSysteme((tx) => tx.notification.findFirstOrThrow({ where: { destinataireUtilisateurId: admin.id, modele: 'personnel.invitation' } }));
    expect(lien.contenu).toContain('https://console.reclamations.example/invitation#jeton=');

    // L'administrateur invité active son compte et règle sa banque. Étape 19 : une nouvelle banque laisse
    // la double authentification facultative, son Admin Entreprise décide ; le mot de passe ouvre la session
    expect(lien.contenu).not.toContain('double authentification');
    expect(r.corps.doubleAuthentificationObligatoire).toBe(false);
    const jeton = /#jeton=([A-Za-z0-9_-]+)/.exec(lien.contenu)![1];
    const e = await client.appeler('accepterInvitation', { corps: { jeton, motDePasse: 'Plateau-Lagune-2026' } });
    expect(e.corps.etape).toBe('SESSION_OUVERTE');
    const s = e.corps.session;
    expect(s.utilisateur.banque.slug).toBe('lagune');
    expect((await client.appeler('creerCategorie', { jeton: s.jetonAcces, corps: { nom: 'Carte', delaiCibleMinutes: 480 } })).statut).toBe(201);
  });

  it('adresse, préfixe ou e-mail déjà pris : 409 ; plan inconnu ou fuseau invalide : 400', async () => {
    const base = { nom: 'Autre', slug: 'autre', prefixeTickets: 'AUT', planId, administrateur: { email: 'admin@autre.example', nom: 'A', prenom: 'B' } };
    expect((await client.appeler('creerBanque', { jeton: sa, corps: { ...base, slug: 'alpha' } })).corps.code).toBe('SLUG_DEJA_UTILISE');
    expect((await client.appeler('creerBanque', { jeton: sa, corps: { ...base, prefixeTickets: 'ALP' } })).corps.code).toBe('PREFIXE_DEJA_UTILISE');
    expect((await client.appeler('creerBanque', { jeton: sa, corps: { ...base, administrateur: { ...base.administrateur, email: j.alpha.comptes.aya.email } } })).corps.code).toBe('EMAIL_DEJA_UTILISE');
    expect((await client.appeler('creerBanque', { jeton: sa, corps: { ...base, fuseauHoraire: 'Afrique/Nulle-Part' } })).statut).toBe(400);
    expect((await client.appeler('creerBanque', { jeton: sa, corps: { ...base, planId: '0199aaaa-0000-7000-8000-000000000000' } })).statut).toBe(400);
  });

  it('liste, lecture, modification des réglages commerciaux (C12)', async () => {
    const liste = await client.appeler('listerBanques', { jeton: sa, requete: { recherche: 'lagune' } });
    expect(liste.corps.donnees.map((b: { slug: string }) => b.slug)).toEqual(['lagune']);
    const m = await client.appeler('modifierBanque', { jeton: sa, chemin: { id: banqueId }, corps: { seuilAlerteSlaPourcent: 80, delaiClotureAutoJours: 7, smsChaqueChangementStatut: false } });
    expect(m.corps).toMatchObject({ seuilAlerteSlaPourcent: 80, delaiClotureAutoJours: 7, smsChaqueChangementStatut: false });
    expect((await client.appeler('lireBanque', { jeton: sa, chemin: { id: j.alpha.id } })).corps.consommation.ticketsCeMois).toBeGreaterThan(0);
    expect((await client.appeler('modifierBanque', { jeton: sa, chemin: { id: banqueId }, corps: { seuilAlerteSlaPourcent: 100 } })).statut).toBe(400);
  });

  it('suspension : portail et console fermés ; réactivation', async () => {
    const didier = (await connecter(client, j.horizon.comptes.didier.email)).jeton;
    const s = await client.appeler('suspendreBanque', { jeton: sa, chemin: { id: j.horizon.id }, corps: { motif: 'Impayé' } });
    expect(s.corps.suspendueLe).not.toBeNull();
    const portail = await client.appeler('lireFormulaireDepot', { chemin: { code: j.horizon.points.qr } });
    expect(portail.statut).toBe(403);
    expect(portail.corps.code).toBe('BANQUE_SUSPENDUE');
    expect((await client.appeler('listerReclamations', { jeton: didier })).corps.code).toBe('BANQUE_SUSPENDUE');
    const connexion = await client.appeler('connexion', { ip: nouvelleIp(), corps: { email: j.horizon.comptes.didier.email, motDePasse: 'Makor-Demo-2026' } });
    expect(connexion.statut).toBe(403);
    const r = await client.appeler('reactiverBanque', { jeton: sa, chemin: { id: j.horizon.id } });
    expect(r.corps.suspendueLe).toBeNull();
    expect((await client.appeler('listerReclamations', { jeton: didier })).statut).toBe(200);
  });
});

describe('arbitrage 7 : métadonnées seulement', () => {
  it('le rôle de la plateforme ne peut pas lire la description d\'une réclamation, même en SQL', async () => {
    await expect(transactionEn(bd.base, contexte.plateforme(), (tx) => tx.$queryRaw`SELECT description FROM reclamation LIMIT 1`)).rejects.toThrow(/permission denied/i);
    const meta = await transactionEn(bd.base, contexte.plateforme(), (tx) => tx.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM reclamation`);
    expect(Number(meta[0].n)).toBeGreaterThan(0);
  });
});

describe('journal de la plateforme et Super Admins', () => {
  it('journal de toutes les chaînes, filtrable par banque ; vérification d\'une chaîne', async () => {
    const plateforme = await client.appeler('listerJournalPlateforme', { jeton: sa, requete: { banqueId: 'plateforme', action: 'plateforme.' } });
    expect(plateforme.corps.donnees.every((l: { chaine: string }) => l.chaine === 'plateforme')).toBe(true);
    expect(plateforme.corps.donnees.map((l: { action: string }) => l.action)).toContain('plateforme.banque_creee');
    const horizon = await client.appeler('listerJournalPlateforme', { jeton: sa, requete: { banqueId: j.horizon.id } });
    expect(horizon.corps.donnees.every((l: { chaine: string }) => l.chaine === `banque:${j.horizon.id}`)).toBe(true);
    expect((await client.appeler('listerJournalPlateforme', { jeton: sa, requete: { banqueId: 'nimporte' } })).statut).toBe(400);
    const v = await client.appeler('verifierJournalPlateforme', { jeton: sa, requete: { chaine: 'plateforme' } });
    expect(v.corps).toMatchObject({ chaine: 'plateforme', valide: true });
    expect((await client.appeler('verifierJournalPlateforme', { jeton: sa, requete: { chaine: `banque:${j.horizon.id}` } })).corps.valide).toBe(true);
    expect((await client.appeler('verifierJournalPlateforme', { jeton: sa, requete: { chaine: 'banque:xyz' } })).statut).toBe(400);
  });

  it('Super Admins : liste et invitation', async () => {
    const i = await client.appeler('inviterSuperAdmin', { jeton: sa, corps: { email: 'second.admin@makortelecoms.example', nom: 'Admin', prenom: 'Second' } });
    expect(i.statut).toBe(201);
    expect(i.corps).toMatchObject({ role: 'SUPER_ADMIN', statut: 'INVITE', superviseur: null });
    expect((await client.appeler('inviterSuperAdmin', { jeton: sa, corps: { email: 'second.admin@makortelecoms.example', nom: 'A', prenom: 'B' } })).statut).toBe(409);
    const liste = await client.appeler('listerSuperAdmins', { jeton: sa });
    expect(liste.corps.map((u: { email: string }) => u.email).sort()).toEqual([j.superAdmin.email, 'second.admin@makortelecoms.example'].sort());
  });
});
