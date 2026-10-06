/**
 * Étape 22 : envois au client non remis et pièces jointes.
 *
 * Envois : SMS refusé par la passerelle (définitif) ou en échec temporaire (nouvel essai espacé),
 * accusés de remise signés de la passerelle, état de chaque message sur la fiche (coordonnée masquée,
 * jamais le texte), alerte in-app à l'agent, renvoi du message (une fois, 3 par heure), facturation des
 * SMS remis. Pièces jointes : Word (.docx) accepté, macros et ancien .doc refusés, virus refusé au
 * dépôt ; antivirus injoignable : fichier gardé « en analyse », analysé ensuite par le worker, effacé
 * s'il est infecté.
 *
 * La passerelle SMS est simulée dans le test, la boîte d'envoi du worker aussi ; ClamAV est simulé
 * (preparation.ts). La Banque Horizon sert de terrain, à une date future (après la création des
 * banques : la facturation du mois les compte).
 */
import { randomInt, randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AnalyseAntivirus, MODELE_FICHIER_INFECTE } from '../../src/application/fichiers/analyse.js';
import { MODELE_NON_REMIS, signalerNonRemis } from '../../src/application/reclamations/envois.js';
import { segmentsSms } from '../../src/domaine/sms.js';
import { BaseDonnees } from '../../src/infrastructure/base-de-donnees/base-de-donnees.service.js';
import { signer } from '../../src/infrastructure/canaux/whatsapp.js';
import { ErreurEnvoi, type AdaptateurEmail, type AdaptateurSms, type MessageEmail, type MessageSms } from '../../src/infrastructure/envois/adaptateurs.js';
import { BoiteEnvoi } from '../../src/infrastructure/envois/boite-envoi.js';
import { ClamAv, EICAR } from '../../src/infrastructure/fichiers/antivirus.js';
import { TYPE_DOCX } from '../../src/infrastructure/fichiers/word.js';
import { StockageDisque } from '../../src/infrastructure/stockage/stockage.js';
import { docx, docxRefuses } from '../outils/docx.js';
import { ClientApi, connecter, demarrerApi, FICHIERS, fermerOutils, jeu, nouvelleIp, type ApiDeTest, type Requete } from './environnement.js';

const j = jeu();
const h = j.horizon;
const SECRET = 'secret-e2e-passerelle-sms-remise';
/** Le prochain jeudi à 09:00 d'Abidjan (UTC), banque ouverte, sans jour férié, le lendemain dans le même mois. */
function prochainJeudi(): Date {
  const feries = ['01-01', '05-01', '08-07', '08-15', '11-01', '11-15', '12-25'];
  const d = new Date();
  d.setUTCHours(9, 0, 0, 0);
  const jour = (n: number) => new Date(d.getTime() + n * 86_400_000);
  do d.setUTCDate(d.getUTCDate() + 1);
  while (d.getUTCDay() !== 4 || [0, 1].some((n) => feries.includes(jour(n).toISOString().slice(5, 10))) || jour(1).getUTCMonth() !== d.getUTCMonth());
  return d;
}
let maintenant = prochainJeudi();
const MOIS = maintenant.toISOString().slice(0, 7);
const minutes = (n: number) => { maintenant = new Date(maintenant.getTime() + n * 60_000); };

let api: ApiDeTest;
let client: ClientApi;
let bd: BaseDonnees;
let boite: BoiteEnvoi;
const jt: Record<string, string> = {};
const id = { salif: h.comptes.salif!.id, didier: h.comptes.didier!.id };
const serie = String(randomInt(100, 999));
const tel = (n: number) => `05${serie}${String(n).padStart(5, '0')}`;
const e164 = (n: number) => `+225${tel(n)}`;
const masque = (n: number) => `+225 05 •• •• •• ${tel(n).slice(-2)}`;

// ---- Passerelle SMS et serveur d'e-mail simulés ---------------------------------------------

class EmailFactice implements AdaptateurEmail {
  envoyes: MessageEmail[] = [];
  async envoyer(m: MessageEmail) {
    this.envoyes.push(m);
    return { idFournisseur: `<e2e-${this.envoyes.length}@local>` };
  }
}
class PasserelleSms implements AdaptateurSms {
  envoyes: MessageSms[] = [];
  /** Refus définitifs (numéro invalide, refusé…) ou pannes passagères, par numéro */
  readonly refus = new Map<string, ErreurEnvoi>();
  readonly pannes = new Set<string>();
  async envoyer(m: MessageSms) {
    const refus = this.refus.get(m.destination);
    if (refus) throw refus;
    if (this.pannes.has(m.destination)) throw new ErreurEnvoi('Passerelle SMS : HTTP 503', false, 'ERREUR_TECHNIQUE');
    this.envoyes.push(m);
    return { idFournisseur: `dlr-${serie}-${this.envoyes.length}`, segments: segmentsSms(m.texte) };
  }
}
const email = new EmailFactice();
const sms = new PasserelleSms();

// ---- Outils ---------------------------------------------------------------------------------

async function connexions() {
  for (const [cle, adresse] of Object.entries({ sa: j.superAdmin.email, awa: h.comptes.awa!.email, didier: h.comptes.didier!.email, salif: h.comptes.salif!.email, aya: j.alpha.comptes.aya!.email })) {
    jt[cle] = (await connecter(client, adresse, () => maintenant)).jeton;
  }
}
const appeler = async (op: string, jeton: string | undefined, o: Requete = {}) => client.appeler(op, { ...(jeton ? { jeton } : {}), ...o });
const ok = async (op: string, jeton: string | undefined, o: Requete = {}) => {
  const r = await appeler(op, jeton, o);
  expect(r.statut, `${op} : ${JSON.stringify(r.corps)}`).toBeLessThan(300);
  return r.corps;
};
const enBase = <T>(f: (tx: Parameters<Parameters<BaseDonnees['enSysteme']>[0]>[0]) => Promise<T>) => bd.enSysteme(f);

/** Saisie au téléphone par Salif (assignée à lui), ou par Didier (sans agent). */
async function saisir(jeton: string, corps: Record<string, unknown>) {
  const r = await appeler('saisirReclamation', jeton, {
    corps: { canal: 'TELEPHONE', categorieId: h.categories['Carte bancaire'], consentementInforme: true, description: 'Carte avalée par le distributeur de Cocody.', ...corps },
  });
  expect(r.statut, JSON.stringify(r.corps)).toBe(201);
  return r.corps as { id: string; numero: string; envoiPar: string[] };
}
const fiche = (jeton: string, ticket: string) => ok('lireReclamation', jeton, { chemin: { id: ticket } });
const envoisClient = (ticket: string, modele?: string) => enBase((tx) => tx.notification.findMany({
  where: { reclamationId: ticket, destinataireClientId: { not: null }, ...(modele ? { modele } : {}) }, orderBy: [{ creeLe: 'asc' }, { id: 'asc' }],
}));
const alertes = (ticket: string, modele = MODELE_NON_REMIS) => enBase((tx) => tx.notification.findMany({ where: { reclamationId: ticket, modele }, orderBy: { creeLe: 'asc' } }));
const accuse = (corps: Record<string, unknown>, signature?: string) =>
  client.appeler('recevoirRemiseSms', { corps, entetes: signature === '' ? {} : { 'X-Signature': signature ?? signer(JSON.stringify(corps), SECRET) } });
/** Dans la liste des réclamations de Salif, le badge « Message non remis » */
async function badge(ticket: string, jeton = jt.salif!): Promise<boolean> {
  const l = await ok('listerReclamations', jeton, { requete: { parPage: 100 } });
  return l.donnees.find((t: { id: string }) => t.id === ticket)!.envoiNonRemis;
}
const facturation = async () => (await ok('lireFacturationSms', jt.sa!, { requete: { mois: MOIS } })).banques.find((b: { banque: { id: string } }) => b.banque.id === h.id) as
  { sms: number; segments: number; remis: number; echecs: number };

/** Dépôt d'un client par le QR code de la Banque Horizon, avec des pièces jointes. */
const deposer = (c: ClientApi, telephone: string, fichiers: Requete['fichiers']) => c.appeler('deposerReclamation', {
  ip: nouvelleIp(), chemin: { code: h.points.qr }, fichiers,
  corps: { categorieId: h.categories['Carte bancaire'], description: 'Voici le courrier de la banque et mon relevé.', nom: 'Adjoua Kouassi', telephone, consentement: true, versionPolitique: '2026-09' },
});
const piege = () => Buffer.concat([FICHIERS.pdf, Buffer.from(`\n${EICAR}\n`)]);
const DOCX = docx('Madame, Monsieur, je conteste les frais de tenue de compte.');

let avant: Awaited<ReturnType<typeof facturation>>;

beforeAll(async () => {
  api = await demarrerApi({ horloge: () => maintenant, env: { SMS_ENTRANT_SECRET: SECRET } });
  client = new ClientApi(api.url);
  bd = new BaseDonnees(api.config.baseDeDonneesUrl);
  boite = new BoiteEnvoi(bd, email, sms, () => maintenant, null, (n) => signalerNonRemis(bd, n, maintenant).then(() => undefined));
  await connexions();
  // Ce qui attend d'autres fichiers part d'abord : la suite ne voit que ses propres envois
  await boite.vider();
  avant = await facturation();
});

afterAll(async () => {
  // Rien ne reste dans la boîte d'envoi pour les fichiers suivants
  sms.refus.clear();
  sms.pannes.clear();
  await boite.vider().catch(() => undefined);
  await bd.fermer();
  await api.fermer();
  await fermerOutils();
});

const tickets: Record<string, string> = {};

describe('envois au client non remis (étape 22)', () => {
  it('SMS refusé par la passerelle : non remis, Salif prévenu, la fiche le montre sans le numéro', async () => {
    const t = await saisir(jt.salif!, { nom: 'Konan Adjoua', telephone: tel(1) });
    expect(t.envoiPar).toEqual(['SMS']);
    tickets.refuse = t.id;
    sms.refus.set(e164(1), new ErreurEnvoi('Passerelle SMS : HTTP 400 invalid destination', true, 'NUMERO_INVALIDE'));
    // Avant l'envoi : en attente
    expect((await fiche(jt.salif!, t.id)).envois[0]).toMatchObject({ canal: 'SMS', objet: 'Accusé de dépôt', etat: 'EN_ATTENTE', motif: null, renvoyable: false });

    await boite.vider();
    const [n] = await envoisClient(t.id, 'client.depot');
    // Définitif : pas de nouvel essai
    expect(n).toMatchObject({ statut: 'ECHEC', motifEchec: 'NUMERO_INVALIDE', tentatives: 1, prochaineTentativeLe: null });

    const f = await fiche(jt.salif!, t.id);
    expect(f.envois).toHaveLength(1);
    expect(f.envois[0]).toMatchObject({
      id: n!.id, canal: 'SMS', objet: 'Accusé de dépôt', destinationMasquee: masque(1), etat: 'NON_REMIS', motif: 'NUMERO_INVALIDE', tentatives: 1, renvoyable: true,
    });
    // Ni le numéro complet, ni le texte du message, ni le message technique
    const vu = JSON.stringify(f.envois);
    for (const secret of [tel(1).slice(2), n!.contenu.slice(0, 30), 'invalid destination']) expect(vu).not.toContain(secret);
    expect(await badge(t.id)).toBe(true);

    // Salif est prévenu dans l'application, une fois
    const [alerte, ...autres] = await alertes(t.id);
    expect(autres).toEqual([]);
    expect(alerte).toMatchObject({ destinataireUtilisateurId: id.salif, canal: 'IN_APP', sujet: 'SMS non remis au client' });
    expect(alerte!.contenu).toBe(`${t.numero} : « Accusé de dépôt » n'a pas été remis au ${masque(1)} (numéro invalide).`);
    const notifs = await ok('listerNotifications', jt.salif!, { requete: { nonLues: true } });
    expect(notifs.donnees.map((x: { id: string }) => x.id)).toContain(alerte!.id);
    await boite.vider(true);
    expect(await alertes(t.id)).toHaveLength(1);
  });

  it('renvoi : le même message au même numéro ; une fois en route, plus renvoyable ; remis selon la passerelle', async () => {
    const t = tickets.refuse!;
    const [echec] = await envoisClient(t, 'client.depot');
    // Seuls l'agent assigné et le superviseur renvoient ; une autre banque ne voit pas la réclamation
    expect(await appeler('renvoyerMessage', jt.awa!, { chemin: { id: t, envoiId: echec!.id } })).toMatchObject({ statut: 403 });
    expect(await appeler('renvoyerMessage', jt.aya!, { chemin: { id: t, envoiId: echec!.id } })).toMatchObject({ statut: 404 });
    expect(await appeler('renvoyerMessage', jt.salif!, { chemin: { id: t, envoiId: randomUUID() } })).toMatchObject({ statut: 404 });

    sms.refus.clear();
    minutes(3);
    const f = await ok('renvoyerMessage', jt.salif!, { chemin: { id: t, envoiId: echec!.id } });
    expect(f.envois.map((e: { etat: string; renvoyable: boolean }) => [e.etat, e.renvoyable])).toEqual([['EN_ATTENTE', false], ['NON_REMIS', false]]);
    const [, copie] = await envoisClient(t, 'client.depot');
    expect(copie).toMatchObject({ canal: 'SMS', destination: e164(1), contenu: echec!.contenu, statut: 'EN_ATTENTE', tentatives: 0 });
    const audit = await enBase((tx) => tx.journalAudit.findFirstOrThrow({ where: { entiteId: t, action: 'reclamation.message_renvoye' } }));
    expect(audit).toMatchObject({ acteurId: id.salif });
    // Déjà renvoyé : un second renvoi est refusé
    const encore = await appeler('renvoyerMessage', jt.salif!, { chemin: { id: t, envoiId: echec!.id } });
    expect(encore).toMatchObject({ statut: 422, corps: { code: 'MESSAGE_NON_RENVOYABLE' } });
    expect(await badge(t)).toBe(false);

    await boite.vider();
    expect(sms.envoyes.at(-1)).toMatchObject({ destination: e164(1), reference: copie!.id });
    expect((await fiche(jt.salif!, t)).envois[0]).toMatchObject({ etat: 'ENVOYE', envoyeLe: maintenant.toISOString(), remiseLe: null });

    // La passerelle confirme la remise, par la référence envoyée avec le SMS
    const recuLe = new Date(maintenant.getTime() + 20_000);
    minutes(1);
    expect(await accuse({ reference: copie!.id, statut: 'REMIS', recuLe: recuLe.toISOString() })).toMatchObject({ statut: 200, corps: { recu: true } });
    expect((await fiche(jt.salif!, t)).envois[0]).toMatchObject({ etat: 'REMIS', remiseLe: recuLe.toISOString() });

    // Trois tentatives par heure et par réclamation, refusées comprises (message inconnu, déjà renvoyé) : la quatrième attend
    expect(await appeler('renvoyerMessage', jt.salif!, { chemin: { id: t, envoiId: echec!.id } })).toMatchObject({ statut: 429 });
  });

  it('échec passager : nouvel essai 1 minute après, visible ; refus ensuite, mais l\'e-mail est parti : pas d\'alerte', async () => {
    const t = await saisir(jt.salif!, { nom: 'Bamba Issa', telephone: tel(2), email: `issa.${serie}@exemple.ci` });
    expect([...t.envoiPar].sort()).toEqual(['EMAIL', 'SMS']);
    sms.pannes.add(e164(2));
    await boite.vider();
    const f = await fiche(jt.salif!, t.id);
    const parCanal = Object.fromEntries(f.envois.map((e: { canal: string }) => [e.canal, e]));
    expect(parCanal.EMAIL).toMatchObject({ etat: 'ENVOYE', destinationMasquee: 'i••••@exemple.ci' });
    expect(parCanal.SMS).toMatchObject({ etat: 'NOUVEL_ESSAI', tentatives: 1, prochaineTentativeLe: new Date(maintenant.getTime() + 60_000).toISOString(), motif: null });

    // Pas avant l'heure ; à l'heure, la passerelle refuse le numéro : non remis, mais le client a eu l'e-mail
    sms.pannes.delete(e164(2));
    sms.refus.set(e164(2), new ErreurEnvoi('Passerelle SMS : HTTP 404 unknown subscriber', true, 'REFUSE'));
    await boite.vider(true);
    const smsDe = async () => (await envoisClient(t.id, 'client.depot')).find((x) => x.canal === 'SMS')!;
    expect(await smsDe()).toMatchObject({ statut: 'EN_ATTENTE', tentatives: 1 });
    minutes(1);
    await boite.vider(true);
    expect(await smsDe()).toMatchObject({ statut: 'ECHEC', tentatives: 2, motifEchec: 'REFUSE' });
    const apres = Object.fromEntries((await fiche(jt.salif!, t.id)).envois.map((e: { canal: string }) => [e.canal, e]));
    expect(apres.SMS).toMatchObject({ etat: 'NON_REMIS', motif: 'REFUSE', tentatives: 2, prochaineTentativeLe: null, renvoyable: false });
    expect(await alertes(t.id)).toEqual([]);
    expect(await badge(t.id)).toBe(false);
    sms.refus.clear();
  });

  it('accusés de remise : signature exigée, non remis par l\'identifiant de la passerelle, une fois ; inconnus ignorés', async () => {
    const t = await saisir(jt.didier!, { nom: 'Touré Mariam', telephone: tel(3) });
    tickets.injoignable = t.id;
    await boite.vider();
    const [n] = await envoisClient(t.id, 'client.depot');
    expect(n).toMatchObject({ statut: 'ENVOYEE' });
    const corps = { id: n!.idFournisseur!, statut: 'NON_REMIS', code: 'EC-27' };

    expect(await accuse(corps, '')).toMatchObject({ statut: 401 });
    expect(await accuse(corps, signer(JSON.stringify(corps), 'autre-secret'))).toMatchObject({ statut: 401 });
    expect(await accuse({ ...corps, statut: 'EN_COURS' })).toMatchObject({ statut: 200 });
    expect(await accuse({ reference: randomUUID(), statut: 'NON_REMIS' })).toMatchObject({ statut: 200 });
    expect(await accuse({ id: 'inconnu-0001', statut: 'REMIS' })).toMatchObject({ statut: 200 });
    expect((await envoisClient(t.id, 'client.depot'))[0]).toMatchObject({ statut: 'ENVOYEE', motifEchec: null });

    // Une demi-heure plus tard (sessions renouvelées)
    minutes(30);
    await connexions();
    expect(await accuse(corps)).toMatchObject({ statut: 200 });
    const [apres] = await envoisClient(t.id, 'client.depot');
    expect(apres).toMatchObject({ statut: 'ECHEC', motifEchec: 'INJOIGNABLE', derniereErreur: 'Accusé de remise : NON_REMIS (EC-27)' });
    // Réclamation à personne : le superviseur est prévenu
    const [alerte] = await alertes(t.id);
    expect(alerte).toMatchObject({ destinataireUtilisateurId: id.didier });
    expect(alerte!.contenu).toContain('(téléphone injoignable)');
    expect((await fiche(jt.didier!, t.id)).envois[0]).toMatchObject({ etat: 'NON_REMIS', motif: 'INJOIGNABLE', renvoyable: true });
    expect(await badge(t.id, jt.didier!)).toBe(true);

    // Le même accusé, ou un accusé contraire arrivé après : rien ne change, pas de seconde alerte
    expect(await accuse(corps)).toMatchObject({ statut: 200 });
    expect(await accuse({ ...corps, statut: 'REMIS' })).toMatchObject({ statut: 200 });
    expect((await envoisClient(t.id, 'client.depot'))[0]).toMatchObject({ statut: 'ECHEC' });
    expect(await alertes(t.id)).toHaveLength(1);
  });

  it('facturation : les SMS partis sont facturés, remis ou non ; les remis et les non remis à part', async () => {
    const apres = await facturation();
    // Envoyés : accusé de dépôt renvoyé (remis), celui de Touré Mariam (non remis selon l'accusé)
    // Non remis : le premier accusé de Konan Adjoua (refusé), le SMS de Bamba Issa, celui de Touré Mariam
    expect({ sms: apres.sms - avant.sms, remis: apres.remis - avant.remis, echecs: apres.echecs - avant.echecs }).toEqual({ sms: 2, remis: 1, echecs: 3 });
  });
});

describe('pièces jointes : Word et antivirus (étape 22)', () => {
  it('un document Word (.docx) est accepté, analysé et téléchargeable', async () => {
    const r = await deposer(client, tel(10), [
      { champ: 'fichiers', nom: 'courrier.docx', contenu: DOCX, type: TYPE_DOCX },
      { champ: 'fichiers', nom: 'releve.pdf', contenu: FICHIERS.pdf, type: 'application/pdf' },
    ]);
    expect(r.statut, JSON.stringify(r.corps)).toBe(201);
    const t = await enBase((tx) => tx.reclamation.findFirstOrThrow({ where: { numero: r.corps.numero } }));
    tickets.word = t.id;
    const f = await fiche(jt.didier!, t.id);
    expect(f.piecesJointes.map((p: { nomFichier: string; typeMime: string; antivirus: string }) => [p.nomFichier, p.typeMime, p.antivirus]).sort())
      .toEqual([['courrier.docx', TYPE_DOCX, 'SAIN'], ['releve.pdf', 'application/pdf', 'SAIN']]);
    const word = f.piecesJointes.find((p: { nomFichier: string }) => p.nomFichier === 'courrier.docx');
    const d = await appeler('telechargerPieceJointe', jt.didier!, { chemin: { id: t.id, pieceId: word.id } });
    expect(d.statut).toBe(200);
    expect(d.entetes.get('content-disposition')).toContain('attachment');
    expect(d.octets.equals(DOCX)).toBe(true);
  });

  it('macros, contrôles ActiveX, mot de passe, archive piégée, ancien .doc : refusés avec la raison', async () => {
    const cas: [Buffer, string, string][] = [
      [docxRefuses.macros(), 'courrier.docm', 'il contient des macros'],
      [docxRefuses.vbaCache(), 'courrier.docx', 'il contient des macros'],
      [docxRefuses.activeX(), 'formulaire.docx', 'contrôles ActiveX'],
      [docxRefuses.chiffre(), 'secret.docx', 'mot de passe'],
      [docxRefuses.bombe(), 'gros.docx', 'archive anormale'],
      [docxRefuses.ancienDoc(), 'lettre.doc', 'ancien format Word (.doc)'],
    ];
    for (const [i, [contenu, nom, raison]] of cas.entries()) {
      const r = await deposer(client, tel(20 + i), [{ champ: 'fichiers', nom, contenu, type: 'application/octet-stream' }]);
      expect(r, nom).toMatchObject({ statut: 415, corps: { code: 'TYPE_DE_FICHIER_NON_SUPPORTE' } });
      expect(r.corps.detail).toContain(raison);
      expect(await enBase((tx) => tx.clientFinal.count({ where: { tenantId: h.id, telephone: e164(20 + i) } }))).toBe(0);
    }
  });

  it('un virus est refusé au dépôt comme dans une réponse d\'agent : rien n\'est enregistré', async () => {
    const r = await deposer(client, tel(12), [{ champ: 'fichiers', nom: 'releve.pdf', contenu: piege(), type: 'application/pdf' }]);
    expect(r).toMatchObject({ statut: 422, corps: { code: 'FICHIER_INFECTE' } });
    expect(r.corps.detail).toBe('« releve.pdf » contient un virus (Win.Test.EICAR_HDB-1) : rien n\'a été enregistré. Retirez ce fichier, puis réessayez.');
    expect(await enBase((tx) => tx.clientFinal.count({ where: { tenantId: h.id, telephone: e164(12) } }))).toBe(0);

    const t = tickets.refuse!;
    const avantPieces = await enBase((tx) => tx.pieceJointe.count({ where: { reclamationId: t } }));
    const rep = await appeler('repondreAuClient', jt.salif!, {
      chemin: { id: t }, corps: { contenu: 'Voici le formulaire.' }, fichiers: [{ champ: 'fichiers', nom: 'formulaire.pdf', contenu: piege(), type: 'application/pdf' }],
    });
    expect(rep).toMatchObject({ statut: 422, corps: { code: 'FICHIER_INFECTE' } });
    expect(await enBase((tx) => tx.pieceJointe.count({ where: { reclamationId: t } }))).toBe(avantPieces);
    expect(await enBase((tx) => tx.commentaire.count({ where: { reclamationId: t, contenu: 'Voici le formulaire.' } }))).toBe(0);
  });

  it('antivirus injoignable : fichiers gardés en analyse, le worker les analyse ensuite ; infecté : effacé, superviseur prévenu', async () => {
    // Un port fermé : ClamAV ne répond pas
    const port = await new Promise<number>((ok) => {
      const s = createServer().listen(0, '127.0.0.1', () => {
        const p = (s.address() as { port: number }).port;
        s.close(() => ok(p));
      });
    });
    const api2 = await demarrerApi({ horloge: () => maintenant, env: { SMS_ENTRANT_SECRET: SECRET, CLAMAV_PORT: String(port) } });
    try {
      const client2 = new ClientApi(api2.url);
      expect((await client2.appeler('lireSante')).corps).toMatchObject({ statut: 'degrade', antivirus: 'indisponible' });
      const r = await deposer(client2, tel(13), [
        { champ: 'fichiers', nom: 'courrier.docx', contenu: DOCX, type: TYPE_DOCX },
        { champ: 'fichiers', nom: 'piege.pdf', contenu: piege(), type: 'application/pdf' },
      ]);
      expect(r.statut, JSON.stringify(r.corps)).toBe(201);
      const t = await enBase((tx) => tx.reclamation.findFirstOrThrow({ where: { numero: r.corps.numero } }));
      const pieces = Object.fromEntries((await fiche(jt.didier!, t.id)).piecesJointes.map((p: { nomFichier: string }) => [p.nomFichier, p]));
      expect([pieces['courrier.docx'].antivirus, pieces['piege.pdf'].antivirus]).toEqual(['EN_ATTENTE', 'EN_ATTENTE']);
      const telecharger = (nom: string) => client2.appeler('telechargerPieceJointe', { jeton: jt.didier!, chemin: { id: t.id, pieceId: pieces[nom].id } });
      expect(await telecharger('courrier.docx')).toMatchObject({ statut: 409, corps: { code: 'FICHIER_EN_ANALYSE' } });

      // Le travail « antivirus » du worker, ClamAV revenu
      minutes(1);
      const stockage = new StockageDisque(api2.config.stockageDossier);
      const analyse = new AnalyseAntivirus(bd, stockage, new ClamAv('127.0.0.1', api.config.antivirus.port), () => maintenant);
      const bilan = await analyse.enAttente();
      expect(bilan.infectees).toBe(1);
      expect(bilan.saines).toBeGreaterThanOrEqual(1);
      expect(bilan.enAttente).toBe(0);

      const enBd = Object.fromEntries((await enBase((tx) => tx.pieceJointe.findMany({ where: { reclamationId: t.id } }))).map((p) => [p.nomFichier, p]));
      expect(enBd['courrier.docx']).toMatchObject({ antivirus: 'SAIN', analyseeLe: maintenant, virus: null });
      expect(enBd['piege.pdf']).toMatchObject({ antivirus: 'INFECTE', analyseeLe: maintenant, virus: 'Win.Test.EICAR_HDB-1' });
      // Le fichier infecté est effacé du stockage, l'autre reste
      expect(await stockage.lire(enBd['piege.pdf']!.cleStockage)).toBeNull();
      expect((await telecharger('courrier.docx')).statut).toBe(200);
      expect(await telecharger('piege.pdf')).toMatchObject({ statut: 409, corps: { code: 'FICHIER_SUPPRIME' } });
      expect((await fiche(jt.didier!, t.id)).piecesJointes.find((p: { nomFichier: string }) => p.nomFichier === 'piege.pdf').antivirus).toBe('INFECTE');

      // Journal d'audit et alerte au superviseur (réclamation à personne)
      const audit = await enBase((tx) => tx.journalAudit.findFirstOrThrow({ where: { entiteId: t.id, action: 'piece_jointe.infectee' } }));
      expect(audit.acteurId).toBeNull();
      const [alerte, ...autres] = await alertes(t.id, MODELE_FICHIER_INFECTE);
      expect(autres).toEqual([]);
      expect(alerte).toMatchObject({ destinataireUtilisateurId: id.didier, canal: 'IN_APP' });
      expect(alerte!.contenu).toContain('piege.pdf');

      // Plus rien à analyser
      expect(await analyse.enAttente()).toMatchObject({ infectees: 0, enAttente: 0 });
    } finally {
      await api2.fermer();
    }
  });
});
