/**
 * Reporting (étape 9) : tableau de bord de la banque, export CSV, statistiques et facturation
 * SMS de la plateforme ; tableau de bord et export de l'agent, limités à ses réclamations (étape 11).
 * Recette §10, critère 8 : le taux de résolution au premier contact suit la définition du §6.6
 * (résolue sans attente du client, sans escalade, sans réouverture) ; critère 11 : les listes
 * s'exportent en CSV.
 *
 * Les réclamations du scénario sont déposées dans une catégorie créée pour ce fichier : le filtre
 * par catégorie les isole de celles des autres tests.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BaseDonnees } from '../../src/infrastructure/base-de-donnees/base-de-donnees.service.js';
import { COLONNES_EXPORT } from '../../src/modules/reporting/reporting.controller.js';
import { ClientApi, connecter, demarrerApi, fermerOutils, jeu, nouvelleIp, type ApiDeTest } from './environnement.js';

let api: ApiDeTest;
let client: ClientApi;
let bd: BaseDonnees;
const j = jeu();
const jt: Record<string, string> = {};
let categorie = '';
const debutTest = new Date(Date.now() - 60_000);
let compteur = 700;
const tickets: Record<'direct' | 'attente' | 'escalade' | 'reouverte' | 'ouverte', { id: string; numero: string; jetonSuivi: string }> = {} as never;

async function deposer(): Promise<{ id: string; numero: string; jetonSuivi: string }> {
  const r = await client.appeler('deposerReclamation', {
    ip: nouvelleIp(), chemin: { code: j.alpha.points.qr },
    corps: { categorieId: categorie, description: `Scénario reporting ${compteur}`, nom: 'Client Reporting', telephone: `0701000${compteur++}`, consentement: true, versionPolitique: '2026-09' },
  });
  expect(r.statut).toBe(201);
  const t = await bd.enSysteme((tx) => tx.reclamation.findUniqueOrThrow({ where: { jetonSuivi: r.corps.jetonSuivi } }));
  return { id: t.id, numero: t.numero, jetonSuivi: r.corps.jetonSuivi };
}

async function sessionClient(jetonSuivi: string, id: string): Promise<string> {
  expect((await client.appeler('demanderCodeOtp', { chemin: { jetonSuivi }, corps: { canal: 'SMS' } })).statut).toBe(202);
  const sms = await bd.enSysteme((tx) => tx.notification.findFirstOrThrow({ where: { reclamationId: id, modele: 'client.otp' }, orderBy: { creeLe: 'desc' } }));
  return (await client.appeler('verifierCodeOtp', { chemin: { jetonSuivi }, corps: { code: /(\d{6})/.exec(sms.contenu)![1] } })).corps.jetonClient;
}

const action = async (op: string, jeton: string, id: string, corps?: unknown) => {
  const r = await client.appeler(op, { jeton, chemin: { id }, ...(corps === undefined ? {} : { corps }) });
  expect(r.statut, `${op} : ${JSON.stringify(r.corps)}`).toBeLessThan(300);
  return r;
};

beforeAll(async () => {
  api = await demarrerApi();
  client = new ClientApi(api.url);
  bd = new BaseDonnees(api.config.baseDeDonneesUrl);
  for (const [cle, email] of Object.entries({
    aya: j.alpha.comptes.aya.email, mamadou: j.alpha.comptes.mamadou.email, serge: j.alpha.comptes.serge.email,
    fatou: j.alpha.comptes.fatou.email, sa: j.superAdmin.email,
  })) jt[cle] = (await connecter(client, email)).jeton;

  // Catégorie du scénario ; son nom commence par « = » : l'export doit la neutraliser
  const c = await client.appeler('creerCategorie', { jeton: jt.fatou, corps: { nom: '=Reporting e2e', delaiCibleMinutes: 480 } });
  expect(c.statut).toBe(201);
  categorie = c.corps.id;

  const aya = j.alpha.comptes.aya.id;
  for (const cle of ['direct', 'attente', 'escalade', 'reouverte', 'ouverte'] as const) tickets[cle] = await deposer();
  for (const cle of ['direct', 'attente', 'escalade', 'reouverte'] as const) {
    await action('assignerReclamation', jt.serge, tickets[cle].id, { agentId: aya });
  }

  // 1. Résolue au premier contact
  await action('repondreAuClient', jt.aya, tickets.direct.id, { contenu: 'Votre carte est débloquée.' });
  await action('resoudreReclamation', jt.aya, tickets.direct.id, { reponseFinale: 'Carte débloquée.' });

  // 2. Question au client (attente), réponse du client, résolution
  await action('repondreAuClient', jt.aya, tickets.attente.id, { contenu: 'Quelle est la date de l\'opération ?', attendreReponse: true });
  const c2 = await sessionClient(tickets.attente.jetonSuivi, tickets.attente.id);
  expect((await client.appeler('envoyerMessageClient', { jeton: c2, chemin: { id: tickets.attente.id }, corps: { contenu: 'Le 20 septembre.' } })).statut).toBe(201);
  await action('resoudreReclamation', jt.aya, tickets.attente.id, { reponseFinale: 'Opération remboursée.' });

  // 3. Escaladée au superviseur, puis résolue
  await action('repondreAuClient', jt.aya, tickets.escalade.id, { contenu: 'Nous étudions votre demande.' });
  await action('escaladerReclamation', jt.aya, tickets.escalade.id, { motif: 'Montant élevé' });
  await action('resoudreReclamation', jt.serge, tickets.escalade.id, { reponseFinale: 'Remboursement accordé.' });

  // 4. Résolue, contestée par le client (réouverture), résolue à nouveau
  await action('repondreAuClient', jt.aya, tickets.reouverte.id, { contenu: 'Frais annulés.' });
  await action('resoudreReclamation', jt.aya, tickets.reouverte.id, { reponseFinale: 'Frais annulés.' });
  const c4 = await sessionClient(tickets.reouverte.jetonSuivi, tickets.reouverte.id);
  expect((await client.appeler('contesterResolution', { jeton: c4, chemin: { id: tickets.reouverte.id }, corps: { motif: 'Les frais sont toujours là.' } })).statut).toBe(200);
  await action('resoudreReclamation', jt.aya, tickets.reouverte.id, { reponseFinale: 'Frais remboursés cette fois.' });
  // 5. « ouverte » reste sans traitement
}, 120_000);

afterAll(async () => {
  await bd.fermer();
  await api.fermer();
  await fermerOutils();
});

describe('tableau de bord de la banque (lireIndicateurs)', () => {
  it('critère 8 : premier contact = résolue sans attente client, sans escalade, sans réouverture', async () => {
    const r = await client.appeler('lireIndicateurs', { jeton: jt.serge, requete: { categorieId: categorie, du: debutTest.toISOString() } });
    expect(r.statut).toBe(200);
    const i = r.corps;
    expect(i.total).toBe(5);
    expect(Object.fromEntries(i.parStatut.map((v: { cle: string; total: number }) => [v.cle, v.total])))
      .toEqual({ OUVERTE: 1, EN_COURS: 0, EN_ATTENTE_CLIENT: 0, RESOLUE: 4, CLOTUREE: 0 });
    // 4 résolues, dont une seule sans attente, escalade ni réouverture
    expect(i.tauxResolutionPremierContact).toBe(0.25);
    expect(i.tauxRespectSla).toBe(1);
    expect(i.parCategorie).toEqual([{ cle: categorie, libelle: '=Reporting e2e', total: 5 }]);
    expect(i.parCanal).toEqual([{ cle: 'QR_CODE', libelle: 'QR code en agence', total: 5 }, { cle: 'LIEN_WEB', libelle: 'Lien web', total: 0 }]);
    expect(i.parAgence).toHaveLength(1);

    // Délais moyens : ceux que le cycle de vie a figés, en minutes ouvrées
    const lignes = await bd.enSysteme((tx) => tx.reclamation.findMany({ where: { categorieId: categorie } }));
    const moyenne = (v: number[]) => Math.round(v.reduce((a, b) => a + b, 0) / v.length);
    expect(i.delaiPremiereReponseMoyenMinutes).toBe(moyenne(lignes.filter((l) => l.delaiPremiereReponseMinutes !== null).map((l) => l.delaiPremiereReponseMinutes!)));
    expect(i.delaiResolutionMoyenMinutes).toBe(moyenne(lignes.filter((l) => l.slaRespecte !== null).map((l) => l.delaiResolutionMinutes!)));

    // Courbe : par jour (période courte) ; aujourd'hui, 5 déposées et 4 résolues
    expect(i.evolution.regroupement).toBe('JOUR');
    const total = (cle: 'deposees' | 'resolues') => i.evolution.points.reduce((n: number, p: Record<string, number>) => n + p[cle], 0);
    expect(total('deposees')).toBe(5);
    expect(total('resolues')).toBe(4);
  });

  it('filtres sans résultat : volumes à zéro, taux et délais vides', async () => {
    const r = await client.appeler('lireIndicateurs', { jeton: jt.fatou, requete: { categorieId: categorie, canal: 'LIEN_WEB', du: debutTest.toISOString() } });
    expect(r.corps.total).toBe(0);
    expect(r.corps.tauxRespectSla).toBeNull();
    expect(r.corps.tauxResolutionPremierContact).toBeNull();
    expect(r.corps.delaiResolutionMoyenMinutes).toBeNull();
    expect(r.corps.parCategorie).toEqual([]);
  });

  it('période par défaut : le mois en cours, dans le fuseau de la banque ; courbes par semaine et par mois', async () => {
    const r = await client.appeler('lireIndicateurs', { jeton: jt.serge });
    expect(new Date(r.corps.du).getUTCDate()).toBe(1);
    expect(r.corps.total).toBeGreaterThanOrEqual(5);

    const an = new Date().getUTCFullYear();
    const mois = new Date().getUTCMonth();
    const annee = await client.appeler('lireIndicateurs', {
      jeton: jt.serge, requete: { du: `${an}-01-01T00:00:00Z`, au: `${an + 1}-01-01T00:00:00Z`, categorieId: categorie },
    });
    expect(annee.corps.evolution.regroupement).toBe('MOIS');
    expect(annee.corps.evolution.points).toHaveLength(12);
    expect(annee.corps.evolution.points[mois]).toMatchObject({
      debut: `${an}-${String(mois + 1).padStart(2, '0')}-01T00:00:00Z`, deposees: 5, resolues: 4,
    });

    const semaines = await client.appeler('lireIndicateurs', {
      jeton: jt.serge, requete: { du: '2026-07-01T00:00:00Z', au: '2026-12-01T00:00:00Z', regroupement: 'SEMAINE' },
    });
    // Semaines du lundi, à minuit (Africa/Abidjan = UTC)
    for (const p of semaines.corps.evolution.points) expect(new Date(p.debut).getUTCDay()).toBe(1);
  });

  it('période invalide, pas trop fin', async () => {
    const inverse = await client.appeler('lireIndicateurs', { jeton: jt.serge, requete: { du: '2026-09-10T00:00:00Z', au: '2026-09-01T00:00:00Z' } });
    expect(inverse.statut).toBe(400);
    expect(inverse.corps.erreurs[0].champ).toBe('au');
    const fin = await client.appeler('lireIndicateurs', { jeton: jt.serge, requete: { du: '2024-01-01T00:00:00Z', au: '2026-01-01T00:00:00Z', regroupement: 'JOUR' } });
    expect(fin.statut).toBe(400);
    expect(fin.corps.erreurs[0].champ).toBe('regroupement');
  });
});

describe('export CSV (critère 11)', () => {
  const lire = (octets: Buffer) => {
    const texte = octets.toString('utf8');
    return { bom: texte.charCodeAt(0) === 0xfeff, lignes: texte.slice(1).split('\r\n').filter(Boolean).map((l) => l.split(';')) };
  };

  it('mêmes filtres que la liste ; UTF-8 avec BOM, « ; », une ligne par réclamation', async () => {
    const r = await client.appeler('exporterReclamations', { jeton: jt.serge, requete: { categorieId: categorie } });
    expect(r.statut).toBe(200);
    expect(r.entetes.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(r.entetes.get('content-disposition')).toMatch(/^attachment; filename="reclamations-alp-\d{4}-\d{2}-\d{2}\.csv"$/);
    const { bom, lignes } = lire(r.octets);
    expect(bom).toBe(true);
    expect(lignes[0]).toEqual([...COLONNES_EXPORT]);
    expect(lignes).toHaveLength(6);

    const liste = await client.appeler('listerReclamations', { jeton: jt.serge, requete: { categorieId: categorie, parPage: 100 } });
    expect(new Set(lignes.slice(1).map((l) => l[0]))).toEqual(new Set(liste.corps.donnees.map((t: { numero: string }) => t.numero)));

    const colonne = (nom: (typeof COLONNES_EXPORT)[number]) => COLONNES_EXPORT.indexOf(nom);
    const ligneDe = (numero: string) => lignes.find((l) => l[0] === numero)!;
    expect(ligneDe(tickets.direct.numero)[colonne('Premier contact')]).toBe('Oui');
    expect(ligneDe(tickets.attente.numero)[colonne('Premier contact')]).toBe('Non');
    expect(ligneDe(tickets.escalade.numero)[colonne('Escaladée le')]).toMatch(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/);
    expect(ligneDe(tickets.reouverte.numero)[colonne('Réouvertures')]).toBe('1');
    expect(ligneDe(tickets.ouverte.numero)[colonne('Statut')]).toBe('Ouverte');
    expect(ligneDe(tickets.ouverte.numero)[colonne('Premier contact')]).toBe('');
    // Nom de catégorie commençant par « = » : neutralisé pour le tableur
    expect(ligneDe(tickets.direct.numero)[colonne('Catégorie')]).toBe('\'=Reporting e2e');

    // Ni description, ni nom, ni téléphone du client
    const texte = r.octets.toString('utf8');
    for (const secret of ['Client Reporting', 'Scénario reporting', '0701000']) expect(texte).not.toContain(secret);
  });

  it('chaque export est inscrit au journal d\'audit, sans le texte recherché', async () => {
    const r = await client.appeler('exporterReclamations', { jeton: jt.fatou, requete: { categorieId: categorie, recherche: 'Client Reporting' } });
    expect(lire(r.octets).lignes).toHaveLength(6);
    const ligne = await bd.enSysteme((tx) => tx.journalAudit.findFirstOrThrow({ where: { action: 'reclamation.export', tenantId: j.alpha.id }, orderBy: { rang: 'desc' } }));
    expect(ligne.acteurId).toBe(j.alpha.comptes.fatou.id);
    expect(ligne.donnees).toEqual({ lignes: 5, filtres: { file: 'toutes', categorieId: categorie, recherche: true } });
  });

});

describe('plateforme (Super Admin)', () => {
  it('statistiques par banque : métadonnées seules, cohérentes avec la base', async () => {
    const r = await client.appeler('lireIndicateursPlateforme', { jeton: jt.sa, requete: { du: debutTest.toISOString() } });
    expect(r.statut).toBe(200);
    const alpha = r.corps.banques.find((b: { banque: { id: string } }) => b.banque.id === j.alpha.id);
    const attendu = await bd.enSysteme((tx) => tx.reclamation.count({ where: { tenantId: j.alpha.id, creeLe: { gte: debutTest } } }));
    expect(alpha.total).toBe(attendu);
    expect(alpha.parStatut.reduce((n: number, s: { total: number }) => n + s.total, 0)).toBe(attendu);
    // Réponse validée contre le contrat en mode strict : aucun champ de contenu ne peut s'y glisser
    expect(JSON.stringify(r.corps)).not.toContain('Client Reporting');

    const une = await client.appeler('lireIndicateursPlateforme', { jeton: jt.sa, requete: { banqueId: j.horizon.id } });
    expect(une.corps.banques.map((b: { banque: { nom: string } }) => b.banque.nom)).toEqual(['Banque Horizon']);
    expect((await client.appeler('lireIndicateursPlateforme', { jeton: jt.fatou })).statut).toBe(403);
  });

  it('facturation SMS : totaux par banque (SMS remis, segments, échecs), sans accès aux SMS', async () => {
    const mois = new Date().toISOString().slice(0, 7);
    const avant = await client.appeler('lireFacturationSms', { jeton: jt.sa, requete: { mois } });
    expect(avant.statut).toBe(200);
    const de = (corps: { banques: { banque: { id: string }; sms: number; segments: number; echecs: number }[] }, id: string) =>
      corps.banques.find((b) => b.banque.id === id)!;

    // Trois SMS remis à la passerelle (1 + 2 + 1 segments) et un abandonné, pour la Banque Alpha
    const maintenant = new Date();
    await bd.enSysteme((tx) => tx.notification.createMany({
      data: [
        ...[1, 2, 1].map((segmentsSms) => ({ tenantId: j.alpha.id, canal: 'SMS' as const, modele: 'client.statut', destination: '+2250700000000', contenu: 'Test', statut: 'ENVOYEE' as const, envoyeeLe: maintenant, segmentsSms })),
        { tenantId: j.alpha.id, canal: 'SMS' as const, modele: 'client.statut', destination: '+2250700000000', contenu: 'Test', statut: 'ECHEC' as const, tentatives: 5 },
        // Un e-mail ne compte pas
        { tenantId: j.alpha.id, canal: 'EMAIL' as const, modele: 'client.statut', destination: 'x@exemple.ci', contenu: 'Test', statut: 'ENVOYEE' as const, envoyeeLe: maintenant },
      ],
    }));
    const apres = await client.appeler('lireFacturationSms', { jeton: jt.sa, requete: { mois } });
    const a = de(avant.corps, j.alpha.id);
    const b = de(apres.corps, j.alpha.id);
    expect({ sms: b.sms - a.sms, segments: b.segments - a.segments, echecs: b.echecs - a.echecs }).toEqual({ sms: 3, segments: 4, echecs: 1 });
    expect(de(apres.corps, j.horizon.id)).toEqual(de(avant.corps, j.horizon.id));

    // Un mois antérieur à la création des banques : liste vide
    expect((await client.appeler('lireFacturationSms', { jeton: jt.sa, requete: { mois: '2020-01' } })).corps.banques).toEqual([]);
    expect((await client.appeler('lireFacturationSms', { jeton: jt.sa, requete: { mois: '2026-13' } })).statut).toBe(400);
  });
});

describe('tableau de bord et export de l\'agent (étape 11)', () => {
  const indicateurs = async (jeton: string) =>
    (await client.appeler('lireIndicateurs', { jeton, requete: { categorieId: categorie, du: debutTest.toISOString() } })).corps;

  it('l\'agent voit ses réclamations seulement ; un autre agent n\'en voit aucune', async () => {
    const aya = await indicateurs(jt.aya);
    // Les 4 réclamations assignées à Aya ; la 5e, jamais assignée, n'est que dans les chiffres de la banque
    expect(aya.total).toBe(4);
    expect(Object.fromEntries(aya.parStatut.map((v: { cle: string; total: number }) => [v.cle, v.total])))
      .toEqual({ OUVERTE: 0, EN_COURS: 0, EN_ATTENTE_CLIENT: 0, RESOLUE: 4, CLOTUREE: 0 });
    expect(aya.tauxResolutionPremierContact).toBe(0.25);
    expect((await indicateurs(jt.serge)).total).toBe(5);
    const mamadou = await indicateurs(jt.mamadou);
    expect(mamadou.total).toBe(0);
    expect(mamadou.evolution.points.every((p: { deposees: number; resolues: number }) => p.deposees + p.resolues === 0)).toBe(true);
  });

  it('charge du moment : à traiter, en attente du client, en alerte, en retard, quelle que soit la période', async () => {
    const alerte = await deposer();
    const retard = await deposer();
    for (const t of [alerte, retard]) await action('assignerReclamation', jt.serge, t.id, { agentId: j.alpha.comptes.aya.id });
    await action('prendreEnCharge', jt.aya, retard.id);
    const maintenant = Date.now();
    await bd.enSysteme((tx) => tx.reclamation.update({
      where: { id: alerte.id }, data: { alertePreventiveLe: new Date(maintenant - 60_000), echeanceSlaLe: new Date(maintenant + 3_600_000) },
    }));
    await bd.enSysteme((tx) => tx.reclamation.update({
      where: { id: retard.id }, data: { alertePreventiveLe: new Date(maintenant - 7_200_000), echeanceSlaLe: new Date(maintenant - 3_600_000) },
    }));

    expect((await indicateurs(jt.aya)).charge).toEqual({ aTraiter: 2, enAttenteClient: 0, enAlerte: 1, enRetard: 1 });
    // La banque compte aussi la réclamation jamais assignée
    expect((await indicateurs(jt.serge)).charge).toEqual({ aTraiter: 3, enAttenteClient: 0, enAlerte: 1, enRetard: 1 });
    expect((await indicateurs(jt.mamadou)).charge).toEqual({ aTraiter: 0, enAttenteClient: 0, enAlerte: 0, enRetard: 0 });
    // Hors période : la charge reste celle du moment
    const avant = await client.appeler('lireIndicateurs', { jeton: jt.aya, requete: { categorieId: categorie, du: '2025-01-01T00:00:00Z', au: '2025-02-01T00:00:00Z' } });
    expect(avant.corps.total).toBe(0);
    expect(avant.corps.charge.enRetard).toBe(1);
    // Même définition que la file « En retard » de l'agent
    const file = await client.appeler('listerReclamations', { jeton: jt.aya, requete: { file: 'en-retard', categorieId: categorie } });
    expect(file.corps.donnees.map((t: { id: string }) => t.id)).toEqual([retard.id]);
  });

  it('l\'agent exporte ses réclamations seulement, et l\'export est inscrit au journal', async () => {
    const lire = (octets: Buffer) => octets.toString('utf8').slice(1).split('\r\n').filter(Boolean).map((l) => l.split(';'));
    const r = await client.appeler('exporterReclamations', { jeton: jt.aya, requete: { categorieId: categorie } });
    expect(r.statut).toBe(200);
    const lignes = lire(r.octets).slice(1);
    const file = await client.appeler('listerReclamations', { jeton: jt.aya, requete: { categorieId: categorie, parPage: 100 } });
    expect(new Set(lignes.map((l) => l[0]))).toEqual(new Set(file.corps.donnees.map((t: { numero: string }) => t.numero)));
    expect(lignes).toHaveLength(6);
    for (const l of lignes) expect(l[COLONNES_EXPORT.indexOf('Agent')]).toBe('Aya Konan');
    expect(lignes.map((l) => l[0])).not.toContain(tickets.ouverte.numero);
    // Demander les réclamations d'un autre agent ne change rien
    const autre = await client.appeler('exporterReclamations', { jeton: jt.mamadou, requete: { categorieId: categorie, agentId: j.alpha.comptes.aya.id } });
    expect(lire(autre.octets)).toHaveLength(1);
    const ligne = await bd.enSysteme((tx) => tx.journalAudit.findFirstOrThrow({ where: { action: 'reclamation.export', tenantId: j.alpha.id }, orderBy: { rang: 'desc' } }));
    expect(ligne.acteurId).toBe(j.alpha.comptes.mamadou.id);
    expect(ligne.donnees).toMatchObject({ lignes: 0 });
  });
});
