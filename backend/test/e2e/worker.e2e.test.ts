/**
 * Worker : tâches SLA planifiées, boîte d'envoi, purge, planification BullMQ.
 * Recette §10, critères 5 à 7 : délai en heures ouvrées ; alerte préventive à 75 % puis escalade au
 * dépassement, chacune une seule fois ; clôture automatique après 5 jours, contestation dans le délai.
 */
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CycleDeVie } from '../../src/application/reclamations/cycle-de-vie.js';
import { chargerParametres } from '../../src/application/reclamations/parametres.js';
import { TachesSla } from '../../src/application/reclamations/taches-sla.js';
import { ajouterMinutesOuvrees, minutesOuvreesEntre } from '../../src/domaine/temps-ouvre/calendrier.js';
import { BaseDonnees } from '../../src/infrastructure/base-de-donnees/base-de-donnees.service.js';
import { segmentsSms, SmsJournal, type AdaptateurEmail, type MessageEmail } from '../../src/infrastructure/envois/adaptateurs.js';
import { BoiteEnvoi, CONTENU_MASQUE } from '../../src/infrastructure/envois/boite-envoi.js';
import { CLE_BATTEMENT_WORKER } from '../../src/infrastructure/redis/redis.service.js';
import { executer, FILE, Planificateur, purger } from '../../src/worker/planification.js';
import { ClientApi, connecter, demarrerApi, fermerOutils, jeu, nouvelleIp, redisE2E, type ApiDeTest } from './environnement.js';

const j = jeu();
let maintenant = new Date();
let api: ApiDeTest;
let client: ClientApi;
let bd: BaseDonnees;
let taches: TachesSla;
const jt: Record<string, string> = {};
let numero = 10;

class EmailFactice implements AdaptateurEmail {
  envoyes: MessageEmail[] = [];
  enPanne = false;
  async envoyer(m: MessageEmail) {
    if (this.enPanne) throw new Error('SMTP indisponible');
    this.envoyes.push(m);
    return { idFournisseur: `<test-${this.envoyes.length}@local>` };
  }
}

/** Avance l'horloge de l'API et reconnecte le personnel (jetons d'accès de 15 minutes). */
async function horlogeA(t: Date) {
  maintenant = t;
  for (const [cle, email] of Object.entries({ serge: j.alpha.comptes.serge.email, aya: j.alpha.comptes.aya.email })) jt[cle] = (await connecter(client, email, () => maintenant)).jeton;
}

async function ticket(categorie: string) {
  const r = await client.appeler('deposerReclamation', {
    ip: nouvelleIp(), chemin: { code: j.alpha.points.qr },
    corps: { categorieId: j.alpha.categories[categorie], description: 'Test du worker', nom: 'Client Worker', telephone: `07000007${String(numero++).padStart(2, '0')}`, email: `worker${numero}@exemple.ci`, consentement: true, versionPolitique: '2026-09' },
  });
  expect(r.statut).toBe(201);
  return bd.enSysteme((tx) => tx.reclamation.findUniqueOrThrow({ where: { jetonSuivi: r.corps.jetonSuivi } }));
}

beforeAll(async () => {
  // Horloge de l'API pilotée par le test : un mardi à 09:00 (Abidjan = UTC)
  maintenant = new Date('2026-10-06T09:00:00Z');
  api = await demarrerApi({ horloge: () => maintenant });
  client = new ClientApi(api.url);
  bd = new BaseDonnees(api.config.baseDeDonneesUrl);
  taches = new TachesSla(bd.base, new CycleDeVie(bd.base, { lienSuivi: (s, t) => `https://${s}.test/suivi/${t}` }));
  await horlogeA(maintenant);
});

afterAll(async () => {
  await bd.fermer();
  await api.fermer();
  await fermerOutils();
});

describe('SLA en heures ouvrées (critères 5 et 6)', () => {
  it('l\'échéance ne compte que les heures ouvrées de la banque', async () => {
    const t = await ticket('Carte bancaire'); // 960 minutes ouvrées
    const p = await bd.enBanque(j.alpha.id, (tx) => chargerParametres(tx, j.alpha.id));
    expect(t.echeanceSlaLe).toEqual(ajouterMinutesOuvrees(maintenant, 960, p.sla.calendrier));
    // 7 h 30 ouvrées par jour (08:00–12:00, 14:00–17:30) : 960 minutes ≈ 2 jours ouvrés et 60 minutes
    expect(t.echeanceSlaLe!.toISOString()).toBe('2026-10-08T10:00:00.000Z');
    expect(Math.round(minutesOuvreesEntre(t.creeLe, t.echeanceSlaLe!, p.sla.calendrier))).toBe(960);
  });

  it('alerte préventive à 75 % puis dépassement et escalade au superviseur, chacun une seule fois', async () => {
    const t = await ticket('Banque mobile'); // 480 minutes ouvrées
    await client.appeler('assignerReclamation', { jeton: jt.serge, chemin: { id: t.id }, corps: { agentId: j.alpha.comptes.aya.id } });
    const alerte = new Date(t.alertePreventiveLe!.getTime() + 60_000);
    const avant = await executer('taches-sla', { taches, boite: null as never, bd, horloge: () => new Date(t.alertePreventiveLe!.getTime() - 60_000) }) as { alertesPreventives: number };
    const fiche = async () => (await client.appeler('lireReclamation', { jeton: jt.serge, chemin: { id: t.id } })).corps;
    expect((await bd.enSysteme((tx) => tx.reclamation.findUniqueOrThrow({ where: { id: t.id } }))).alertePreventiveEnvoyeeLe).toBeNull();
    expect(avant.alertesPreventives).toBeGreaterThanOrEqual(0);
    await taches.toutes(alerte);
    await taches.toutes(alerte);
    const notifs = await bd.enSysteme((tx) => tx.notification.findMany({ where: { reclamationId: t.id, modele: { in: ['sla.alerte_preventive', 'sla.depassement'] } } }));
    expect(notifs.filter((n) => n.modele === 'sla.alerte_preventive').map((n) => [n.destinataireUtilisateurId, n.canal]).sort()).toEqual([[j.alpha.comptes.aya.id, 'EMAIL'], [j.alpha.comptes.aya.id, 'IN_APP']]);
    await horlogeA(alerte);
    expect((await fiche()).sla.etat).toBe('ALERTE');

    const depasse = new Date(t.echeanceSlaLe!.getTime() + 60_000);
    await taches.toutes(depasse);
    await taches.toutes(depasse);
    await horlogeA(depasse);
    const f = await fiche();
    expect(f.sla).toMatchObject({ etat: 'DEPASSE', enRetard: true });
    expect(f.sla.minutesRestantes).toBeLessThan(0);
    expect(f.escaladeeVers.nom).toBe('Serge Kouadio');
    expect(f.chronologie.filter((e: { type: string }) => ['ALERTE_SLA_PREVENTIVE', 'DEPASSEMENT_SLA', 'ESCALADE'].includes(e.type)).map((e: { type: string }) => e.type))
      .toEqual(['ALERTE_SLA_PREVENTIVE', 'DEPASSEMENT_SLA', 'ESCALADE']);
    const depassements = await bd.enSysteme((tx) => tx.notification.count({ where: { reclamationId: t.id, modele: 'sla.depassement' } }));
    expect(depassements).toBe(4); // agent et superviseur, e-mail et in-app
    const retard = await client.appeler('listerReclamations', { jeton: jt.serge, requete: { file: 'en-retard', parPage: 100 } });
    expect(retard.corps.donnees.some((x: { id: string }) => x.id === t.id)).toBe(true);
    await horlogeA(new Date('2026-10-06T09:05:00Z'));
  });
});

describe('clôture automatique et contestation (critère 7)', () => {
  it('une résolution non contestée est clôturée après 5 jours ; contester après ce délai est refusé', async () => {
    const t = await ticket('Crédit');
    await client.appeler('assignerReclamation', { jeton: jt.serge, chemin: { id: t.id }, corps: { agentId: j.alpha.comptes.aya.id } });
    await client.appeler('prendreEnCharge', { jeton: jt.aya, chemin: { id: t.id } });
    const r = await client.appeler('resoudreReclamation', { jeton: jt.aya, chemin: { id: t.id }, corps: { reponseFinale: 'Échéancier corrigé.' } });
    const fin = new Date(r.corps.jalons.clotureAutoPrevueLe);
    expect(fin.getTime() - maintenant.getTime()).toBe(5 * 86_400_000);

    // Le client revient après l'échéance : nouveau code, nouvelle session
    await horlogeA(new Date(fin.getTime() + 60_000));
    await client.appeler('demanderCodeOtp', { chemin: { jetonSuivi: t.jetonSuivi } });
    const sms = await bd.enSysteme((tx) => tx.notification.findFirstOrThrow({ where: { reclamationId: t.id, modele: 'client.otp' }, orderBy: { creeLe: 'desc' } }));
    const jc = (await client.appeler('verifierCodeOtp', { chemin: { jetonSuivi: t.jetonSuivi }, corps: { code: /(\d{6})/.exec(sms.contenu)![1] } })).corps.jetonClient;
    // Contester n'est plus proposé ; confirmer reste possible tant que la clôture automatique n'est pas passée
    expect((await client.appeler('lireMaReclamation', { jeton: jc, chemin: { id: t.id } })).corps.actionsPossibles).toEqual(['CONFIRMER']);
    const tardive = await client.appeler('contesterResolution', { jeton: jc, chemin: { id: t.id }, corps: { motif: 'Trop tard ?' } });
    expect(tardive.statut).toBe(409);
    expect(tardive.corps.code).toBe('DELAI_DE_CONTESTATION_DEPASSE');
    const bilan = await taches.toutes(maintenant);
    expect(bilan.cloturesAutomatiques).toBeGreaterThanOrEqual(1);
    const f = await client.appeler('lireReclamation', { jeton: jt.serge, chemin: { id: t.id } });
    expect(f.corps.statut).toBe('CLOTUREE');
    expect(f.corps.cloture.mode).toBe('AUTOMATIQUE');
    expect(f.corps.chronologie.at(-1)).toMatchObject({ type: 'CLOTURE_AUTOMATIQUE', acteur: { type: 'SYSTEME', nom: null } });
    await horlogeA(new Date('2026-10-06T09:10:00Z'));
  });
});

describe('boîte d\'envoi', () => {
  it('envoie e-mails et SMS, compte les segments, livre l\'in-app et masque les codes après envoi', async () => {
    const t = await ticket('Crédit');
    await client.appeler('demanderCodeOtp', { chemin: { jetonSuivi: t.jetonSuivi } });
    const email = new EmailFactice();
    const boite = new BoiteEnvoi(bd, email, new SmsJournal());
    let bilan = { envoyees: 0, echecs: 0 };
    do bilan = await boite.vider(false); while (bilan.envoyees > 0);
    const notifs = await bd.enSysteme((tx) => tx.notification.findMany({ where: { reclamationId: t.id } }));
    expect(notifs.every((n) => n.statut === 'ENVOYEE')).toBe(true);
    const sms = notifs.filter((n) => n.canal === 'SMS');
    expect(sms.every((n) => (n.segmentsSms ?? 0) >= 1)).toBe(true);
    expect(notifs.find((n) => n.modele === 'client.otp')!.contenu).toBe(CONTENU_MASQUE);
    expect(notifs.find((n) => n.modele === 'client.depot' && n.canal === 'SMS')!.contenu).toContain('enregistrée');

    // E-mail au client : texte, et HTML au nom de la banque avec le lien de suivi (étape 9)
    const depot = email.envoyes.find((m) => m.sujet === `Réclamation ${t.numero} enregistrée`)!;
    expect(depot.texte).toContain(`/suivi/${t.jetonSuivi}`);
    expect(depot.html).toMatch(/<td style="background:#[0-9A-Fa-f]{6};color:#(ffffff|17212b)[^"]*">Banque Alpha<\/td>/);
    expect(depot.html).toContain(`>https://alpha.reclamations.example/suivi/${t.jetonSuivi}</a>`);
    expect(depot.html).toContain('ne vous demandera jamais votre mot de passe');
  });

  it('en cas de panne : nouvelles tentatives espacées de 1, 5, 30 puis 120 minutes, puis ECHEC après 5 (étape 22)', async () => {
    const t = await ticket('Crédit');
    const email = new EmailFactice();
    email.enPanne = true;
    const debut = new Date();
    let horloge = debut;
    const boite = new BoiteEnvoi(bd, email, new SmsJournal(), () => horloge);
    await boite.vider(false);
    const id = (await bd.enSysteme((tx) => tx.notification.findFirstOrThrow({ where: { reclamationId: t.id, canal: 'EMAIL' } }))).id;
    const lire = () => bd.enSysteme((tx) => tx.notification.findUniqueOrThrow({ where: { id } }));
    const a = (minutes: number) => new Date(debut.getTime() + minutes * 60_000);
    expect(await lire()).toMatchObject({ statut: 'EN_ATTENTE', tentatives: 1, prochaineTentativeLe: a(1) });
    // Avant l'heure : rien ; à l'heure : une tentative de plus, et la suivante plus loin
    for (const [avant, apres, tentatives, prochaine] of [[0.5, 1, 2, 6], [5.5, 6, 3, 36], [35, 36, 4, 156]] as const) {
      horloge = a(avant);
      await boite.vider(true);
      expect((await lire()).tentatives).toBe(tentatives - 1);
      horloge = a(apres);
      await boite.vider(true);
      expect(await lire()).toMatchObject({ statut: 'EN_ATTENTE', tentatives, prochaineTentativeLe: a(prochaine) });
    }
    horloge = a(156);
    await boite.vider(true);
    expect(await lire()).toMatchObject({ statut: 'ECHEC', tentatives: 5, derniereErreur: 'SMTP indisponible', motifEchec: 'ERREUR_TECHNIQUE', prochaineTentativeLe: null });
  });

  it('segments SMS : GSM 7 bits (160/153), UCS-2 pour les caractères hors GSM (70/67)', () => {
    expect(segmentsSms('a'.repeat(160))).toBe(1);
    expect(segmentsSms('a'.repeat(161))).toBe(2);
    expect(segmentsSms('é'.repeat(160))).toBe(1);
    expect(segmentsSms('ç'.repeat(70))).toBe(1);
    expect(segmentsSms('ç'.repeat(71))).toBe(2);
    expect(segmentsSms('€'.repeat(80))).toBe(1);
    expect(segmentsSms('€'.repeat(81))).toBe(2);
  });
});

describe('purge et planification', () => {
  it('la purge efface codes OTP, sessions et liens expirés', async () => {
    const r = await purger(bd, new Date(Date.now() + 60 * 86_400_000));
    expect(r.codes).toBeGreaterThan(0);
    expect(await bd.enSysteme((tx) => tx.codeOtp.count())).toBe(0);
  });

  it('BullMQ : les six travaux sont planifiés une seule fois, et s\'exécutent', async () => {
    const planif = new Planificateur(redisE2E(), { taches, boite: new BoiteEnvoi(bd, new EmailFactice(), new SmsJournal()), bd });
    const planif2 = new Planificateur(redisE2E(), { taches, boite: new BoiteEnvoi(bd, new EmailFactice(), new SmsJournal()), bd });
    await planif.demarrer();
    await planif2.demarrer();
    const file = new Queue(FILE, { connection: { url: redisE2E() } });
    const planifies = await file.getJobSchedulers();
    expect(planifies.map((p) => p.key).sort()).toEqual(['antivirus', 'barometre', 'envois', 'purge', 'relances', 'taches-sla']);
    // Un travail « envois » ou « taches-sla » s'exécute dans les secondes qui suivent
    for (let i = 0; i < 40 && (await file.getCompletedCount()) === 0; i++) await new Promise((ok) => setTimeout(ok, 250));
    expect(await file.getCompletedCount()).toBeGreaterThan(0);
    // Battement lu par lireSante (étape 10) : présent, expire après 2 minutes
    const redis = new Redis(redisE2E());
    expect(await redis.ttl(CLE_BATTEMENT_WORKER)).toBeGreaterThan(100);
    redis.disconnect();
    await planif.arreter();
    await planif2.arreter();
    await file.obliterate({ force: true });
    await file.close();
  });
});
