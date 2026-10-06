/**
 * WhatsApp Business et SMS entrant (étape 20, décisions I1, I2 et I7) : raccordement par le Super Admin,
 * ouverture banque par banque avec le chat, webhooks signés, dépôt guidé, messages rattachés à la
 * conversation de la réclamation, réponses des agents envoyées sur WhatsApp (fenêtre de 24 h) ou par
 * SMS du numéro de la banque, résolution confirmée ou contestée d'un mot, statuts et facturation de
 * Meta, échec rattrapé par un avis ordinaire, plafond des réponses automatiques, isolation.
 *
 * Meta est simulé par un petit serveur HTTP (envoi, médias) ; la boîte d'envoi du worker tourne dans
 * le test. La Banque Horizon sert de terrain ; à la fin, ses canaux et son chat sont refermés.
 */
import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CycleDeVie } from '../../src/application/reclamations/cycle-de-vie.js';
import { TachesSla } from '../../src/application/reclamations/taches-sla.js';
import { segmentsSms } from '../../src/domaine/sms.js';
import { REPONSES_AUTO_PAR_JOUR, SUITE_RESOLUTION, TEXTES_CANAL } from '../../src/domaine/canaux.js';
import { BaseDonnees } from '../../src/infrastructure/base-de-donnees/base-de-donnees.service.js';
import { signer, WhatsappMeta } from '../../src/infrastructure/canaux/whatsapp.js';
import type { AdaptateurEmail, AdaptateurSms, MessageEmail, MessageSms } from '../../src/infrastructure/envois/adaptateurs.js';
import { BoiteEnvoi, CONTENU_CONVERSATION } from '../../src/infrastructure/envois/boite-envoi.js';
import { hacherMotDePasse } from '../../src/infrastructure/securite/mots-de-passe.js';
import { MOT_DE_PASSE_DEMO } from '../../scripts/jeu-de-donnees.js';
import { ClientApi, connecter, demarrerApi, FICHIERS, fermerOutils, jeu, type ApiDeTest } from './environnement.js';

const j = jeu();
const h = j.horizon;
const SECRET_APP = 'secret-e2e-application-whatsapp';
const SECRET_SMS = 'secret-e2e-passerelle-sms-entrant';
const NUMERO_WA = { identifiant: '5550001112223', compte: '5550009998887', numero: '+2252722990000' };
const NUMERO_SMS = '+2252722990001';
/**
 * Horloge de l'API : le prochain mardi à 09:00 d'Abidjan (UTC), la Banque Horizon ouverte, sans jour férié
 * ce jour-là ni les deux suivants, dans un même mois jusqu'au vendredi. Après la création des banques
 * (heure réelle), pour que la facturation du mois, qui retient les banques existant à la fin du mois, la compte.
 */
function prochainMardi(): Date {
  const feries = ['01-01', '05-01', '08-07', '08-15', '11-01', '11-15', '12-25'];
  const d = new Date();
  d.setUTCHours(9, 0, 0, 0);
  const jour = (n: number) => new Date(d.getTime() + n * 86_400_000);
  do d.setUTCDate(d.getUTCDate() + 1);
  while (d.getUTCDay() !== 2 || [0, 1, 2].some((n) => feries.includes(jour(n).toISOString().slice(5, 10))) || jour(3).getUTCMonth() !== d.getUTCMonth());
  return d;
}
let maintenant = prochainMardi();
const MOIS = maintenant.toISOString().slice(0, 7);
let api: ApiDeTest;
let client: ClientApi;
let bd: BaseDonnees;
let boite: BoiteEnvoi;
let taches: TachesSla;
const jt: Record<string, string> = {};

// ---- Meta simulé ----------------------------------------------------------------------------

let meta: Server;
let urlMeta = '';
const envoyesWa: { de: string; a: string; texte: string; id: string }[] = [];
const enEchec = new Set<string>();
let numeroMessage = 0;

class EmailFactice implements AdaptateurEmail {
  envoyes: MessageEmail[] = [];
  async envoyer(m: MessageEmail) {
    this.envoyes.push(m);
    return { idFournisseur: `<e2e-${this.envoyes.length}@local>` };
  }
}
class SmsFactice implements AdaptateurSms {
  envoyes: MessageSms[] = [];
  async envoyer(m: MessageSms) {
    this.envoyes.push(m);
    return { idFournisseur: `sms-${this.envoyes.length}`, segments: segmentsSms(m.texte) };
  }
}
const sms = new SmsFactice();

function demarrerMeta(): Promise<void> {
  meta = createServer((req, res) => {
    let brut = '';
    req.on('data', (c) => { brut += c; });
    req.on('end', () => {
      const json = (statut: number, corps: unknown) => res.writeHead(statut, { 'Content-Type': 'application/json' }).end(JSON.stringify(corps));
      const envoi = /^\/v26\.0\/(\d+)\/messages$/.exec(req.url ?? '');
      if (req.method === 'POST' && envoi) {
        const m = JSON.parse(brut) as { to: string; text: { body: string } };
        if (req.headers.authorization !== 'Bearer jeton-e2e-horizon-0123456789') return json(401, { error: { message: 'Invalid OAuth access token', code: 190 } });
        if (enEchec.has(m.to)) return json(400, { error: { message: 'Re-engagement message', code: 131047 } });
        const id = `wamid.sortant.${++numeroMessage}`;
        envoyesWa.push({ de: envoi[1]!, a: m.to, texte: m.text.body, id });
        return json(200, { messaging_product: 'whatsapp', contacts: [{ wa_id: m.to.slice(1) }], messages: [{ id }] });
      }
      const media = /^\/v26\.0\/(media-\w+)$/.exec(req.url ?? '');
      if (media) {
        const nom = media[1]!.replace('media-', '');
        return json(200, { url: `${urlMeta}/fichiers/${nom}`, mime_type: nom === 'pdf' ? 'application/pdf' : 'image/png', file_size: 100 });
      }
      const fichier = /^\/fichiers\/(\w+)$/.exec(req.url ?? '');
      if (fichier) return res.writeHead(200).end(FICHIERS[fichier[1] as keyof typeof FICHIERS]);
      json(404, { error: { message: 'inconnu', code: 100 } });
    });
  });
  return new Promise((ok) => meta.listen(0, '127.0.0.1', () => {
    urlMeta = `http://127.0.0.1:${(meta.address() as { port: number }).port}`;
    ok();
  }));
}

// ---- Outils ---------------------------------------------------------------------------------

async function connexions() {
  for (const [cle, email] of Object.entries({ sa: j.superAdmin.email, awa: h.comptes.awa!.email, didier: h.comptes.didier!.email, salif: h.comptes.salif!.email })) {
    jt[cle] = (await connecter(client, email, () => maintenant)).jeton;
  }
}
async function horlogeA(t: Date) {
  maintenant = t;
  await connexions();
}
const heures = (n: number) => new Date(maintenant.getTime() + n * 3_600_000);

const appeler = (op: string, jeton: string, o: { chemin?: Record<string, string>; corps?: unknown; requete?: Record<string, string> } = {}) =>
  client.appeler(op, { jeton, ...o });
const ok = async (op: string, jeton: string, o: Parameters<typeof appeler>[2] = {}) => {
  const r = await appeler(op, jeton, o);
  expect(r.statut, `${op} : ${JSON.stringify(r.corps)}`).toBeLessThan(300);
  return r.corps;
};

/** Notification de Meta, signée comme Meta la signe. */
async function webhook(value: Record<string, unknown>, o: { signature?: string | null; identifiant?: string } = {}) {
  const corps = {
    object: 'whatsapp_business_account',
    entry: [{ id: NUMERO_WA.compte, changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { display_phone_number: '2252722990000', phone_number_id: o.identifiant ?? NUMERO_WA.identifiant }, ...value } }] }],
  };
  const signature = o.signature === undefined ? signer(JSON.stringify(corps), SECRET_APP) : o.signature;
  return client.appeler('recevoirWebhookWhatsapp', { corps, entetes: signature ? { 'X-Hub-Signature-256': signature } : {} });
}

let numeroRecu = 0;
const horodatage = () => String(Math.floor(maintenant.getTime() / 1000));

/** Un message du client sur WhatsApp ; `id` pour rejouer le même. */
async function wa(de: string, contenu: string | Record<string, unknown>, o: { id?: string; nom?: string } = {}) {
  const id = o.id ?? `wamid.entrant.${++numeroRecu}`;
  const message = typeof contenu === 'string'
    ? { from: de.slice(1), id, timestamp: horodatage(), type: 'text', text: { body: contenu } }
    : { from: de.slice(1), id, timestamp: horodatage(), ...contenu };
  const r = await webhook({ contacts: [{ wa_id: de.slice(1), profile: { name: o.nom ?? 'Awa Test' } }], messages: [message] });
  expect(r.statut, JSON.stringify(r.corps)).toBe(200);
  expect(r.corps).toEqual({ recu: true });
  return id;
}

/** Un SMS du client, signé comme la passerelle de Makor le signe. */
async function smsRecu(de: string, texte: string, signature?: string) {
  const corps = { id: `sms-entrant-${++numeroRecu}`, de, vers: NUMERO_SMS, texte };
  return client.appeler('recevoirSmsEntrant', { corps, entetes: { 'X-Signature': signature ?? signer(JSON.stringify(corps), SECRET_SMS) } });
}

/** Toute la boîte d'envoi, par lots de 50 (les fichiers précédents y ont laissé leurs notifications). */
async function viderTout() {
  for (let i = 0; i < 500; i++) {
    await boite.vider();
    if (!(await bd.enSysteme((tx) => tx.notification.count({ where: { statut: 'EN_ATTENTE', tentatives: 0 } })))) return;
  }
}

/** Messages WhatsApp remis à Meta pour ce numéro, depuis le dernier appel. */
const lus = new Map<string, number>();
async function recusWa(numero: string): Promise<string[]> {
  await viderTout();
  const tous = envoyesWa.filter((e) => e.a === numero);
  const deja = lus.get(numero) ?? 0;
  lus.set(numero, tous.length);
  return tous.slice(deja).map((e) => e.texte);
}
const lusSms = new Map<string, number>();
async function recusSms(numero: string): Promise<MessageSms[]> {
  await viderTout();
  const tous = sms.envoyes.filter((e) => e.destination === numero);
  const deja = lusSms.get(numero) ?? 0;
  lusSms.set(numero, tous.length);
  return tous.slice(deja);
}

const reclamationsDe = (telephone: string) => bd.enBanque(h.id, (tx) => tx.reclamation.findMany({
  where: { client: { telephone } }, orderBy: { creeLe: 'asc' }, include: { conversation: true, client: true },
}));
const dernierEntrant = () => bd.enSysteme((tx) => tx.messageEntrant.findFirstOrThrow({ where: { tenantId: h.id }, orderBy: [{ recuLe: 'desc' }, { id: 'desc' }] }));

beforeAll(async () => {
  await demarrerMeta();
  api = await demarrerApi({
    horloge: () => maintenant,
    env: {
      WHATSAPP_ENVOI: 'meta', WHATSAPP_URL: urlMeta, WHATSAPP_VERSION: 'v26.0', WHATSAPP_SECRET_APP: SECRET_APP,
      WHATSAPP_JETON_VERIFICATION: 'verification-e2e-0123456789', SMS_ENTRANT_SECRET: SECRET_SMS,
    },
  });
  client = new ClientApi(api.url);
  bd = new BaseDonnees(api.config.baseDeDonneesUrl);
  boite = new BoiteEnvoi(bd, new EmailFactice(), sms, () => maintenant, { whatsapp: new WhatsappMeta({ url: urlMeta, version: 'v26.0' }), cle: api.config.cleCanaux });
  taches = new TachesSla(bd.base, new CycleDeVie(bd.base, { horloge: () => maintenant, lienSuivi: (s, t) => `https://${s}.reclamations.example/suivi/${t}` }));
  // authentification.e2e change le mot de passe de Salif (mot de passe oublié) : on remet celui du jeu
  const hash = await hacherMotDePasse(MOT_DE_PASSE_DEMO);
  await bd.enSysteme((tx) => tx.utilisateur.update({ where: { id: h.comptes.salif!.id }, data: { motDePasseHash: hash } }));
  await viderTout();
  await connexions();
});

afterAll(async () => {
  await connexions();
  // Fermer le chat ferme WhatsApp et le SMS entrant ; rien ne reste dans la boîte d'envoi
  await ok('modifierBanque', jt.sa!, { chemin: { id: h.id }, corps: { chatWeb: false } });
  await viderTout();
  await bd.fermer();
  await api.fermer();
  await fermerOutils();
  await new Promise<void>((fin) => meta.close(() => fin()));
});

// ---------------------------------------------------------------------------------------------

describe('raccordement et ouverture par le Super Admin (décision I2)', () => {
  it('WhatsApp : identifiants de Meta et jeton, chiffré, jamais relu ; le point de dépôt du canal est créé', async () => {
    const sansJeton = await appeler('raccorderCanal', jt.sa!, { chemin: { id: h.id, canal: 'WHATSAPP' }, corps: { numero: NUMERO_WA.numero, identifiant: NUMERO_WA.identifiant, compte: NUMERO_WA.compte } });
    expect(sansJeton.statut).toBe(400);
    expect(sansJeton.corps.erreurs[0].champ).toBe('jeton');
    const b = await ok('raccorderCanal', jt.sa!, {
      chemin: { id: h.id, canal: 'WHATSAPP' },
      corps: { numero: '+225 27 22 99 00 00', identifiant: NUMERO_WA.identifiant, compte: NUMERO_WA.compte, jeton: 'jeton-e2e-horizon-0123456789' },
    });
    expect(b.raccordements).toEqual({ whatsapp: NUMERO_WA, sms: null });
    expect(JSON.stringify(b)).not.toContain('jeton-e2e');
    expect(b.whatsapp).toBe(false);
    const ligne = await bd.enSysteme((tx) => tx.canalBanque.findFirstOrThrow({ where: { tenantId: h.id, canal: 'WHATSAPP' } }));
    expect(ligne.jetonChiffre).toMatch(/^v1:/);
    expect(ligne.jetonChiffre).not.toContain('jeton-e2e');
    // Ni le personnel de la banque ni la plateforme ne lisent le jeton (droits par colonne)
    await expect(bd.enBanque(h.id, (tx) => tx.$queryRaw`SELECT jeton_chiffre FROM canal_banque`)).rejects.toThrow(/permission/i);
    await expect(bd.enPlateforme((tx) => tx.$queryRaw`SELECT jeton_chiffre FROM canal_banque`)).rejects.toThrow(/permission/i);
    const audit = await bd.enSysteme((tx) => tx.journalAudit.findFirstOrThrow({ where: { action: 'plateforme.canal_raccorde', entiteId: h.id }, orderBy: { id: 'desc' } }));
    expect(audit.donnees).toEqual({ canal: 'WHATSAPP', premier: true, jetonRemplace: false });
    // Modification sans jeton : le jeton reste
    await ok('raccorderCanal', jt.sa!, { chemin: { id: h.id, canal: 'WHATSAPP' }, corps: { numero: NUMERO_WA.numero, identifiant: NUMERO_WA.identifiant, compte: NUMERO_WA.compte } });
    expect((await bd.enSysteme((tx) => tx.canalBanque.findFirstOrThrow({ where: { tenantId: h.id, canal: 'WHATSAPP' } }))).jetonChiffre).toBe(ligne.jetonChiffre);
  });

  it('un numéro déjà raccordé à une autre banque : 409 ; SMS : le numéro de réception', async () => {
    const pris = await appeler('raccorderCanal', jt.sa!, {
      chemin: { id: j.alpha.id, canal: 'WHATSAPP' }, corps: { numero: '+2252722550000', identifiant: NUMERO_WA.identifiant, compte: '1234567', jeton: 'jeton-e2e-alpha-0123456789' },
    });
    expect(pris.statut).toBe(409);
    expect(pris.corps.code).toBe('NUMERO_DEJA_UTILISE');
    expect((await appeler('raccorderCanal', jt.sa!, { chemin: { id: h.id, canal: 'SMS' }, corps: { numero: 'abc12345' } })).statut).toBe(400);
    const b = await ok('raccorderCanal', jt.sa!, { chemin: { id: h.id, canal: 'SMS' }, corps: { numero: NUMERO_SMS } });
    expect(b.raccordements.sms).toEqual({ numero: NUMERO_SMS });
    expect((await appeler('raccorderCanal', jt.awa!, { chemin: { id: h.id, canal: 'SMS' }, corps: { numero: NUMERO_SMS } })).statut).toBe(403);
  });

  it('ouverture : exige le chat web et le numéro raccordé ; la banque voit ses numéros, le portail propose WhatsApp', async () => {
    const sansChat = await appeler('modifierBanque', jt.sa!, { chemin: { id: h.id }, corps: { whatsapp: true } });
    expect(sansChat.statut).toBe(422);
    expect(sansChat.corps.code).toBe('CHAT_WEB_REQUIS');
    const nonRaccorde = await appeler('modifierBanque', jt.sa!, { chemin: { id: j.alpha.id }, corps: { chatWeb: true, smsEntrant: true } });
    expect(nonRaccorde.corps.code).toBe('CANAL_NON_RACCORDE');
    expect((await ok('lireBanque', jt.sa!, { chemin: { id: j.alpha.id } })).chatWeb).toBe(false);
    const b = await ok('modifierBanque', jt.sa!, { chemin: { id: h.id }, corps: { chatWeb: true, whatsapp: true, smsEntrant: true } });
    expect([b.whatsapp, b.smsEntrant]).toEqual([true, true]);
    const p = await ok('lireParametresBanque', jt.awa!);
    expect([p.whatsapp, p.smsEntrant]).toEqual([NUMERO_WA.numero, NUMERO_SMS]);
    const points = await ok('listerPointsDepot', jt.awa!);
    expect(points.filter((x: { canal: string }) => ['WHATSAPP', 'SMS'].includes(x.canal)).map((x: { urlDepot: string; agence: unknown }) => [x.urlDepot, x.agence]))
      .toEqual([['https://wa.me/2252722990000', null], [`sms:${NUMERO_SMS}`, null]]);
    const wa = points.find((x: { canal: string }) => x.canal === 'WHATSAPP');
    expect((await appeler('modifierPointDepot', jt.awa!, { chemin: { id: wa.id }, corps: { actif: false } })).statut).toBe(400);
    const portail = await client.appeler('lireFormulaireDepot', { chemin: { code: h.points.qr } });
    expect(portail.corps.banque.whatsapp).toBe(NUMERO_WA.numero);
  });
});

describe('webhooks : abonnement et signature', () => {
  it('Meta vérifie l\'adresse avec le jeton de vérification', async () => {
    const r = await client.appeler('verifierWebhookWhatsapp', { requete: { 'hub.mode': 'subscribe', 'hub.verify_token': 'verification-e2e-0123456789', 'hub.challenge': '1158201444' } });
    expect(r.statut).toBe(200);
    expect(r.octets.toString()).toBe('1158201444');
    expect((await client.appeler('verifierWebhookWhatsapp', { requete: { 'hub.mode': 'subscribe', 'hub.verify_token': 'faux', 'hub.challenge': '1' } })).statut).toBe(403);
  });

  it('sans signature, ou fausse : 401, rien n\'est lu ; un numéro raccordé à aucune banque : ignoré', async () => {
    const avant = await bd.enSysteme((tx) => tx.messageEntrant.count());
    const message = { messages: [{ from: '2250701010199', id: 'wamid.pirate', timestamp: horodatage(), type: 'text', text: { body: 'Bonjour' } }] };
    for (const signature of [null, 'sha256=00', signer('{}', SECRET_APP)]) {
      const r = await webhook(message, { signature });
      expect(r.statut).toBe(401);
      expect(r.corps.code).toBe('SIGNATURE_INVALIDE');
    }
    expect((await webhook(message, { identifiant: '999999999' })).statut).toBe(200);
    expect(await bd.enSysteme((tx) => tx.messageEntrant.count())).toBe(avant);
    expect((await smsRecu('0701010199', 'Bonjour', 'sha256=faux')).statut).toBe(401);
  });
});

const AWA = '+2250701010101';
let premiere: { id: string; numero: string };

describe('dépôt guidé sur WhatsApp', () => {
  it('accueil, description, catégorie déduite, OUI : la réclamation part, avec le nom du profil', async () => {
    await wa(AWA, 'Bonjour');
    expect(await recusWa(AWA)).toEqual([TEXTES_CANAL.ACCUEIL('Banque Horizon')]);
    await wa(AWA, 'Le distributeur de l\'agence a avalé ma carte hier soir, impossible de la récupérer.');
    const [proposition] = await recusWa(AWA);
    expect(proposition).toContain('- Sujet : Carte bancaire');
    expect(proposition).toContain('https://horizon.reclamations.example/politique-donnees');
    const oui = await wa(AWA, 'OUI');
    const [r] = await reclamationsDe(AWA);
    expect(r).toMatchObject({ canal: 'WHATSAPP', description: 'Le distributeur de l\'agence a avalé ma carte hier soir, impossible de la récupérer.', consentementVersion: '2026-09' });
    expect(r!.client).toMatchObject({ nom: 'Awa Test', telephone: AWA, email: null });
    expect(r!.conversation).toMatchObject({ canal: 'WHATSAPP', dernierMessageClientLe: maintenant });
    premiere = { id: r!.id, numero: r!.numero };
    // L'accusé part sur WhatsApp, avec le lien de suivi
    const [accuse] = await recusWa(AWA);
    expect(accuse).toMatch(new RegExp(`^Votre reclamation ${r!.numero} est enregistree\\. Un conseiller vous repond ici\\. Suivi : https://horizon\\.`));
    expect(await dernierEntrant()).toMatchObject({ canal: 'WHATSAPP', idExterne: oui, issue: 'DEPOT', commentaireId: null });
    // Meta renvoie le même message : traité une seule fois
    await wa(AWA, 'OUI', { id: oui });
    expect(await reclamationsDe(AWA)).toHaveLength(1);
    expect(await recusWa(AWA)).toEqual([]);
  });
});

describe('la conversation de la réclamation', () => {
  it('photo avec légende : le message et sa pièce jointe entrent dans la conversation, canal WhatsApp', async () => {
    await ok('assignerReclamation', jt.didier!, { chemin: { id: premiere.id }, corps: { agentId: h.comptes.salif!.id } });
    await wa(AWA, { type: 'image', image: { id: 'media-png', mime_type: 'image/png', caption: 'Voici le ticket du distributeur' } });
    expect(await recusWa(AWA)).toEqual([]);
    const f = await ok('lireReclamation', jt.salif!, { chemin: { id: premiere.id } });
    const dernier = f.messages.at(-1);
    expect(dernier).toMatchObject({ type: 'MESSAGE_DU_CLIENT', contenu: 'Voici le ticket du distributeur', canal: 'WHATSAPP' });
    expect(dernier.piecesJointes).toHaveLength(1);
    expect(dernier.piecesJointes[0]).toMatchObject({ typeMime: 'image/png', nomFichier: 'whatsapp-1.png' });
    expect(f.conversation).toMatchObject({ canal: 'WHATSAPP', aRepondre: true, clientEnLigne: false, reponseVers: { canal: 'WHATSAPP', finFenetreLe: heures(24).toISOString() } });
    expect(await dernierEntrant()).toMatchObject({ issue: 'RATTACHE', commentaireId: dernier.id });
    const boiteSalif = await ok('listerConversations', jt.salif!);
    expect(boiteSalif.donnees.find((c: { reclamation: { id: string } }) => c.reclamation.id === premiere.id)).toMatchObject({ canal: 'WHATSAPP', aRepondre: true });
  });

  it('la réponse de l\'agent part sur WhatsApp, sans autre avis ; son texte est effacé de la notification une fois envoyé', async () => {
    await ok('repondreAuClient', jt.salif!, { chemin: { id: premiere.id }, corps: { contenu: 'Bonjour, nous avons demandé le journal du distributeur.' } });
    expect(await recusWa(AWA)).toEqual(['Bonjour, nous avons demandé le journal du distributeur.']);
    const n = await bd.enSysteme((tx) => tx.notification.findMany({ where: { reclamationId: premiere.id, modele: { in: ['conversation.reponse', 'client.reponse'] } } }));
    expect(n.map((x) => [x.canal, x.modele, x.statut, x.contenu])).toEqual([['WHATSAPP', 'conversation.reponse', 'ENVOYEE', CONTENU_CONVERSATION]]);
    const f = await ok('lireReclamation', jt.salif!, { chemin: { id: premiere.id } });
    expect(f.messages.at(-1)).toMatchObject({ type: 'REPONSE_AU_CLIENT', canal: 'WHATSAPP' });
    expect(f.conversation.aRepondre).toBe(false);
  });

  it('statuts de Meta : remise et facturation, puis lecture (« Lu » dans la boîte de réception)', async () => {
    const n = await bd.enSysteme((tx) => tx.notification.findFirstOrThrow({ where: { reclamationId: premiere.id, modele: 'conversation.reponse' } }));
    const lu = new Date(maintenant.getTime() + 60_000);
    const r = await webhook({
      statuses: [
        { id: n.idFournisseur, status: 'delivered', timestamp: horodatage(), recipient_id: AWA.slice(1), pricing: { billable: true, pricing_model: 'PMP', category: 'service' } },
        { id: n.idFournisseur, status: 'read', timestamp: String(lu.getTime() / 1000), recipient_id: AWA.slice(1) },
      ],
    });
    expect(r.statut).toBe(200);
    expect(await bd.enSysteme((tx) => tx.notification.findUniqueOrThrow({ where: { id: n.id } }))).toMatchObject({ statut: 'DELIVREE', facturable: true, categorieTarif: 'service', lueLe: lu });
    const c = await ok('lireConversation', jt.salif!, { chemin: { id: (await ok('lireReclamation', jt.salif!, { chemin: { id: premiere.id } })).conversation.id } });
    expect(c.luParLeClientLe).toBe(lu.toISOString());
    expect(c.reponseVers.canal).toBe('WHATSAPP');
  });

  it('son, vidéo : réponse fixe ; fichier refusé (ni image ni PDF) : le client en est averti', async () => {
    await wa(AWA, { type: 'audio', audio: { id: 'media-audio', mime_type: 'audio/ogg' } });
    expect(await recusWa(AWA)).toEqual([TEXTES_CANAL.NON_PRIS_EN_CHARGE]);
    expect((await dernierEntrant()).issue).toBe('NON_PRIS_EN_CHARGE');
    await wa(AWA, { type: 'document', document: { id: 'media-exe', mime_type: 'application/pdf', filename: 'releve.pdf' } });
    expect(await recusWa(AWA)).toEqual([TEXTES_CANAL.FICHIER_REFUSE]);
    expect((await dernierEntrant()).issue).toBe('NON_PRIS_EN_CHARGE');
    await wa(AWA, { type: 'reaction', reaction: { message_id: 'x', emoji: '👍' } });
    expect(await recusWa(AWA)).toEqual([]);
  });
});

describe('fenêtre de 24 h de WhatsApp, et échec de Meta', () => {
  it('au-delà de 24 h, la réponse reste dans le suivi ; l\'avis part par SMS, sans le texte', async () => {
    await horlogeA(heures(25));
    const f = await ok('lireReclamation', jt.salif!, { chemin: { id: premiere.id } });
    expect(f.conversation.reponseVers).toEqual({ canal: 'WEB', finFenetreLe: null });
    await ok('repondreAuClient', jt.salif!, { chemin: { id: premiere.id }, corps: { contenu: 'Le journal confirme l\'incident.' } });
    expect(await recusWa(AWA)).toEqual([]);
    expect((await ok('lireReclamation', jt.salif!, { chemin: { id: premiere.id } })).messages.at(-1).canal).toBe('WEB');
    await horlogeA(new Date(maintenant.getTime() + 3 * 60_000));
    expect((await taches.toutes(maintenant)).avisConversations).toBeGreaterThanOrEqual(1);
    const [avis] = await recusSms(AWA);
    expect(avis!.texte).toContain('nouvelle réponse sur votre réclamation');
    expect(avis!.texte).not.toContain('journal');
    expect(avis!.expediteur ?? null).toBeNull();
  });

  it('Meta refuse le message (131047) : pas de nouvel essai, l\'avis part par SMS ordinaire', async () => {
    // Session effacée (plus de 24 h) : le message d'accueil de la réclamation revient
    await wa(AWA, 'Quand pourrai-je récupérer ma carte ?');
    expect(await recusWa(AWA)).toEqual([expect.stringContaining(`Message ajoute a votre reclamation ${premiere.numero}`)]);
    await horlogeA(new Date(maintenant.getTime() + 60_000));
    enEchec.add(AWA);
    await ok('repondreAuClient', jt.salif!, { chemin: { id: premiere.id }, corps: { contenu: 'Dès demain matin, à l\'accueil.' } });
    expect(await recusWa(AWA)).toEqual([]);
    const n = await bd.enSysteme((tx) => tx.notification.findFirstOrThrow({ where: { reclamationId: premiere.id, modele: 'conversation.reponse' }, orderBy: { creeLe: 'desc' } }));
    expect(n).toMatchObject({ statut: 'ECHEC', tentatives: 1, contenu: CONTENU_CONVERSATION });
    expect(n.derniereErreur).toContain('131047');
    await horlogeA(new Date(maintenant.getTime() + 3 * 60_000));
    await taches.toutes(maintenant);
    expect((await recusSms(AWA)).map((m) => m.texte)).toEqual([expect.stringContaining('nouvelle réponse sur votre réclamation')]);
    enEchec.delete(AWA);
  });
});

describe('résolution, confirmation et contestation d\'un mot', () => {
  it('la réponse finale part sur WhatsApp avec ce qu\'il peut répondre ; « Oui merci » clôture, le message de clôture y part', async () => {
    await wa(AWA, 'Merci, j\'attends.');
    await recusWa(AWA);
    await ok('resoudreReclamation', jt.salif!, { chemin: { id: premiere.id }, corps: { reponseFinale: 'Votre carte vous attend à l\'accueil de l\'agence.' } });
    expect(await recusWa(AWA)).toEqual([`Votre carte vous attend à l'accueil de l'agence.\n\n${SUITE_RESOLUTION}`]);
    expect(await bd.enSysteme((tx) => tx.notification.count({ where: { reclamationId: premiere.id, modele: 'client.resolution' } }))).toBe(0);
    await wa(AWA, 'Oui merci');
    const [r] = await reclamationsDe(AWA);
    expect(r!.statut).toBe('CLOTUREE');
    expect(r!.modeCloture).toBe('CONFIRMATION_CLIENT');
    expect(await recusWa(AWA)).toEqual([`Merci ! Votre reclamation ${premiere.numero} est cloturee.`]);
    expect((await dernierEntrant()).issue).toBe('CONFIRMATION');
  });

  it('« NOUVELLE » : un second dépôt ; résolue puis contestée par un message, elle est rouverte', async () => {
    await wa(AWA, 'nouvelle');
    expect(await recusWa(AWA)).toEqual([TEXTES_CANAL.NOUVELLE]);
    await wa(AWA, 'Des frais de tenue de compte ont été prélevés deux fois ce mois-ci.');
    expect((await recusWa(AWA))[0]).toContain('Frais et prélèvements');
    await wa(AWA, 'oui');
    const seconde = (await reclamationsDe(AWA))[1]!;
    expect(seconde.canal).toBe('WHATSAPP');
    await recusWa(AWA);
    await ok('assignerReclamation', jt.didier!, { chemin: { id: seconde.id }, corps: { agentId: h.comptes.salif!.id } });
    // La prise en charge est signalée dans le fil (option des SMS de la banque, active par défaut)
    await ok('prendreEnCharge', jt.salif!, { chemin: { id: seconde.id } });
    expect(await recusWa(AWA)).toEqual([`Votre reclamation ${seconde.numero} est prise en charge : un conseiller vous repond ici.`]);
    await ok('resoudreReclamation', jt.salif!, { chemin: { id: seconde.id }, corps: { reponseFinale: 'Le second prélèvement vous a été remboursé.' } });
    await recusWa(AWA);
    await wa(AWA, 'Toujours pas remboursé sur mon relevé');
    const apres = (await reclamationsDe(AWA))[1]!;
    expect(apres.statut).toBe('EN_COURS');
    expect(apres.nbReouvertures).toBe(1);
    expect(await recusWa(AWA)).toEqual([`Votre reclamation ${seconde.numero} est rouverte : un conseiller reprend votre dossier et vous repond ici.`]);
    const entrant = await dernierEntrant();
    expect(entrant.issue).toBe('RATTACHE');
    const motif = await bd.enBanque(h.id, (tx) => tx.commentaire.findUniqueOrThrow({ where: { id: entrant.commentaireId! } }));
    expect(motif).toMatchObject({ contenu: 'Toujours pas remboursé sur mon relevé', canal: 'WHATSAPP', type: 'MESSAGE_DU_CLIENT' });
    expect(await bd.enSysteme((tx) => tx.notification.count({ where: { reclamationId: seconde.id, modele: 'agent.contestation' } }))).toBe(2);
  });

  it('plusieurs réclamations en cours : il choisit par le numéro, et ses messages suivants y vont', async () => {
    await wa(AWA, 'nouvelle');
    await wa(AWA, 'L\'application mobile se ferme toute seule depuis la mise à jour de lundi.');
    await wa(AWA, 'oui');
    const [, seconde, troisieme] = await reclamationsDe(AWA);
    await recusWa(AWA);
    // Le lendemain, sa session est effacée : il désigne la réclamation
    await horlogeA(heures(25));
    await wa(AWA, 'Des nouvelles ?');
    expect(await recusWa(AWA)).toEqual([[
      'Votre message concerne quelle reclamation ? Repondez par son numero :',
      `1. ${troisieme!.numero} - Banque mobile`,
      `2. ${seconde!.numero} - Frais et prélèvements`,
      '0. Une nouvelle reclamation',
    ].join('\n')]);
    expect((await dernierEntrant()).issue).toBe('CHOIX');
    await wa(AWA, '2');
    expect((await recusWa(AWA))[0]).toContain(`reclamation ${seconde!.numero}`);
    await wa(AWA, 'Je passe à l\'agence jeudi.');
    const messages = await bd.enBanque(h.id, (tx) => tx.commentaire.findMany({ where: { reclamationId: seconde!.id, type: 'MESSAGE_DU_CLIENT' }, orderBy: { creeLe: 'asc' } }));
    expect(messages.slice(-2).map((m) => m.contenu)).toEqual(['Des nouvelles ?', 'Je passe à l\'agence jeudi.']);
  });
});

const KOUAME = '+2250702020202';

describe('SMS entrant : même dialogue, réponses du numéro de la banque', () => {
  it('dépôt par SMS : le nom est demandé (pas de profil), l\'accusé part du numéro de la banque', async () => {
    expect((await smsRecu('07 02 02 02 02', 'Bonjour')).statut).toBe(200);
    const [accueil] = await recusSms(KOUAME);
    expect(accueil).toMatchObject({ texte: TEXTES_CANAL.ACCUEIL('Banque Horizon'), expediteur: NUMERO_SMS });
    await smsRecu(KOUAME, 'Mon virement de salaire du 25 n\'est toujours pas arrivé sur mon compte.');
    expect((await recusSms(KOUAME))[0]!.texte).toContain('Virement et transfert');
    await smsRecu(KOUAME, 'OUI');
    expect((await recusSms(KOUAME)).map((m) => m.texte)).toEqual([TEXTES_CANAL.NOM]);
    await smsRecu(KOUAME, 'Kouamé Yao');
    const [r] = await reclamationsDe(KOUAME);
    expect(r).toMatchObject({ canal: 'SMS', client: { nom: 'Kouamé Yao' }, conversation: { canal: 'SMS' } });
    const [accuse] = await recusSms(KOUAME);
    expect(accuse).toMatchObject({ expediteur: NUMERO_SMS });
    expect(accuse!.texte).toContain(`Votre reclamation ${r!.numero} est enregistree`);
  });

  it('réponse de l\'agent : le texte même, ramené à l\'alphabet GSM, coupé au-delà de 4 segments', async () => {
    const [r] = await reclamationsDe(KOUAME);
    await ok('assignerReclamation', jt.didier!, { chemin: { id: r!.id }, corps: { agentId: h.comptes.salif!.id } });
    expect((await ok('lireReclamation', jt.salif!, { chemin: { id: r!.id } })).conversation.reponseVers).toEqual({ canal: 'SMS', finFenetreLe: null });
    const long = `Bonjour, le virement a été reçu ce matin à 10 h : il apparaîtra sur votre compte d'ici ce soir. ${'Nous restons à votre écoute. '.repeat(30)}`;
    await ok('repondreAuClient', jt.salif!, { chemin: { id: r!.id }, corps: { contenu: long } });
    const [reponse] = await recusSms(KOUAME);
    expect(reponse).toMatchObject({ expediteur: NUMERO_SMS });
    expect(reponse!.texte).toMatch(/^Bonjour, le virement a été reçu|^Bonjour, le virement a été recu/);
    expect(reponse!.texte).not.toMatch(/[çâêîôûœ]/);
    expect(segmentsSms(reponse!.texte)).toBeLessThanOrEqual(4);
    expect(reponse!.texte).toMatch(/\.\.\. Suite : https:\/\/horizon\./);
    await smsRecu(KOUAME, 'Merci, bien reçu.');
    expect((await ok('lireReclamation', jt.salif!, { chemin: { id: r!.id } })).messages.at(-1)).toMatchObject({ canal: 'SMS', contenu: 'Merci, bien reçu.' });
  });
});

describe('plafond, facturation, sessions', () => {
  it(`${REPONSES_AUTO_PAR_JOUR} réponses automatiques par client et par jour, puis plus rien`, async () => {
    const BAVARD = '+2250703030303';
    for (let i = 0; i <= REPONSES_AUTO_PAR_JOUR; i++) await wa(BAVARD, 'Bonjour', { nom: 'Bavard' });
    expect(await recusWa(BAVARD)).toHaveLength(REPONSES_AUTO_PAR_JOUR);
    expect((await dernierEntrant()).issue).toBe('LIMITE');
  });

  it('facturation du mois pour Makor : totaux par banque, d\'après les statuts de Meta et les messages reçus', async () => {
    const f = await ok('lireFacturationCanaux', jt.sa!, { requete: { mois: MOIS } });
    const ligne = f.banques.find((b: { banque: { id: string } }) => b.banque.id === h.id);
    // Les échecs comptent au mois où le message a été créé (heure réelle de la base), le reste à l'heure de l'API
    const debut = new Date(`${MOIS}-01T00:00:00Z`);
    const mois = { gte: debut, lt: new Date(Date.UTC(debut.getUTCFullYear(), debut.getUTCMonth() + 1, 1)) };
    const [recusWaBd, recusSmsBd, envoyes, factures, echecs] = await bd.enSysteme((tx) => Promise.all([
      tx.messageEntrant.count({ where: { tenantId: h.id, canal: 'WHATSAPP', recuLe: mois } }),
      tx.messageEntrant.count({ where: { tenantId: h.id, canal: 'SMS', recuLe: mois } }),
      tx.notification.count({ where: { tenantId: h.id, canal: 'WHATSAPP', statut: { in: ['ENVOYEE', 'DELIVREE'] }, envoyeeLe: mois } }),
      tx.notification.count({ where: { tenantId: h.id, canal: 'WHATSAPP', facturable: true, envoyeeLe: mois } }),
      tx.notification.count({ where: { tenantId: h.id, canal: 'WHATSAPP', statut: 'ECHEC', creeLe: mois } }),
    ]));
    expect(ligne).toEqual({ banque: { id: h.id, nom: 'Banque Horizon' }, whatsappRecus: recusWaBd, smsRecus: recusSmsBd, whatsappEnvoyes: envoyes, whatsappFactures: factures, whatsappEchecs: echecs });
    expect([factures, recusSmsBd]).toEqual([1, 5]);
    expect(envoyes).toBeGreaterThan(20);
    const ceMois = new Date().toISOString().slice(0, 7);
    const actuel = await ok('lireFacturationCanaux', jt.sa!, { requete: { mois: ceMois } });
    expect(actuel.banques.find((b: { banque: { id: string } }) => b.banque.id === h.id).whatsappEchecs).toBeGreaterThanOrEqual(1);
    expect(f.banques.find((b: { banque: { id: string } }) => b.banque.id === j.alpha.id)).toMatchObject({ whatsappRecus: 0, whatsappEnvoyes: 0 });
    expect((await appeler('lireFacturationCanaux', jt.awa!, { requete: { mois: MOIS } })).statut).toBe(403);
  });

  it('un échec signalé après coup par Meta : l\'étape de la réclamation part par SMS ordinaire', async () => {
    const accuse = await bd.enSysteme((tx) => tx.notification.findFirstOrThrow({ where: { reclamationId: premiere.id, modele: 'client.depot', canal: 'WHATSAPP' } }));
    await webhook({ statuses: [{ id: accuse.idFournisseur, status: 'failed', timestamp: horodatage(), errors: [{ code: 131026, title: 'Message undeliverable' }] }] });
    expect(await bd.enSysteme((tx) => tx.notification.findUniqueOrThrow({ where: { id: accuse.id } }))).toMatchObject({ statut: 'ECHEC', derniereErreur: '131026 Message undeliverable' });
    const [secours] = await recusSms(AWA);
    expect(secours!.texte).toContain(`Votre reclamation ${premiere.numero} est enregistree`);
    expect(secours!.expediteur ?? null).toBeNull();
  });

  it('les sessions sont effacées 24 h après le dernier message du client', async () => {
    const avant = await bd.enSysteme((tx) => tx.sessionCanal.count({ where: { tenantId: h.id } }));
    expect(avant).toBeGreaterThanOrEqual(3);
    await horlogeA(heures(25));
    expect(await taches.effacerSessionsCanal(maintenant)).toBeGreaterThanOrEqual(avant);
    expect(await bd.enSysteme((tx) => tx.sessionCanal.count({ where: { tenantId: h.id } }))).toBe(0);
  });

  it('fermer le chat ferme WhatsApp et le SMS ; un message reçu ensuite est ignoré', async () => {
    const b = await ok('modifierBanque', jt.sa!, { chemin: { id: h.id }, corps: { chatWeb: false } });
    expect([b.chatWeb, b.whatsapp, b.smsEntrant]).toEqual([false, false, false]);
    expect(b.raccordements.whatsapp).toEqual(NUMERO_WA);
    const avant = await bd.enSysteme((tx) => tx.messageEntrant.count());
    await wa(AWA, 'Encore moi');
    expect(await bd.enSysteme((tx) => tx.messageEntrant.count())).toBe(avant);
    expect((await client.appeler('lireFormulaireDepot', { chemin: { code: h.points.qr } })).corps.banque.whatsapp).toBeNull();
  });
});
