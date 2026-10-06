import { createServer, type IncomingMessage, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { lireSmsEntrant } from './sms-entrant.js';
import { ErreurWhatsapp, lireWebhookWhatsapp, signatureValide, signer, WhatsappMeta } from './whatsapp.js';

const maintenant = new Date('2026-10-06T09:00:00Z');

/** Notification de Meta telle qu'elle arrive (format de l'API hébergée, champ « messages ») */
const webhook = (value: Record<string, unknown>) => ({
  object: 'whatsapp_business_account',
  entry: [{ id: 'WABA', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { display_phone_number: '22527220000', phone_number_id: '1098' }, ...value } }] }],
});

describe('signature des webhooks (X-Hub-Signature-256)', () => {
  it('HMAC-SHA256 du corps brut avec le secret ; absente, fausse ou sans secret : refusée', () => {
    const corps = Buffer.from('{"object":"whatsapp_business_account","entry":[]}');
    const bonne = signer(corps, 'secret-app');
    expect(bonne).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(signatureValide(corps, bonne, 'secret-app')).toBe(true);
    expect(signatureValide(corps, bonne.toUpperCase().replace('SHA256', 'sha256'), 'secret-app')).toBe(true);
    expect(signatureValide(Buffer.from(`${corps} `), bonne, 'secret-app')).toBe(false);
    expect(signatureValide(corps, bonne, 'autre-secret')).toBe(false);
    expect(signatureValide(corps, undefined, 'secret-app')).toBe(false);
    expect(signatureValide(corps, 'sha256=abc', 'secret-app')).toBe(false);
    expect(signatureValide(corps, bonne, null)).toBe(false);
    expect(signatureValide(undefined, bonne, 'secret-app')).toBe(false);
  });
});

describe('lecture des webhooks de Meta', () => {
  it('texte, photo avec légende, document, bouton ; le nom du profil ; l\'heure de Meta', () => {
    const { messages, statuts } = lireWebhookWhatsapp(webhook({
      contacts: [{ wa_id: '2250707070707', profile: { name: 'Moussa' } }],
      messages: [
        { from: '2250707070707', id: 'wamid.1', timestamp: '1791277200', type: 'text', text: { body: 'Bonjour' } },
        { from: '2250707070707', id: 'wamid.2', timestamp: '1791277201', type: 'image', image: { id: 'm1', mime_type: 'image/jpeg', caption: 'Le ticket' } },
        { from: '2250707070707', id: 'wamid.3', timestamp: '1791277202', type: 'document', document: { id: 'm2', mime_type: 'application/pdf', filename: 'releve.pdf' } },
        { from: '2250707070707', id: 'wamid.4', timestamp: '1791277203', type: 'button', button: { text: 'OUI' } },
      ],
    }), maintenant);
    expect(statuts).toEqual([]);
    expect(messages.map((m) => [m.idExterne, m.nature, m.texte, m.medias.map((x) => x.id)])).toEqual([
      ['wamid.1', 'lisible', 'Bonjour', []], ['wamid.2', 'lisible', 'Le ticket', ['m1']], ['wamid.3', 'lisible', '', ['m2']], ['wamid.4', 'lisible', 'OUI', []],
    ]);
    expect(messages[0]).toMatchObject({ phoneNumberId: '1098', de: '+2250707070707', nomProfil: 'Moussa', recuLe: new Date(1791277200 * 1000) });
    expect(messages[2]!.medias[0]).toEqual({ id: 'm2', typeMime: 'application/pdf', nom: 'releve.pdf' });
  });

  it('son, vidéo, position : « autre » ; réaction : ignorée ; numéro invalide ou champ inconnu : écarté', () => {
    const { messages } = lireWebhookWhatsapp(webhook({
      messages: [
        { from: '2250707070707', id: 'a', type: 'audio', audio: { id: 'x' } },
        { from: '2250707070707', id: 'b', type: 'reaction', reaction: { emoji: '👍' } },
        { from: '12345', id: 'c', type: 'text', text: { body: 'court' } },
        { id: 'd', type: 'text', text: { body: 'sans numéro' } },
      ],
    }), maintenant);
    expect(messages.map((m) => [m.idExterne, m.nature])).toEqual([['a', 'autre'], ['b', 'ignore']]);
    expect(messages[0]!.recuLe).toEqual(maintenant);
    expect(lireWebhookWhatsapp({ entry: [{ changes: [{ field: 'account_update', value: {} }] }] }, maintenant)).toEqual({ messages: [], statuts: [] });
    expect(lireWebhookWhatsapp(null, maintenant)).toEqual({ messages: [], statuts: [] });
  });

  it('statuts : remise, lecture, échec ; facturation et catégorie de Meta', () => {
    const { statuts } = lireWebhookWhatsapp(webhook({
      statuses: [
        { id: 'wamid.A', status: 'delivered', timestamp: '1791277300', recipient_id: '2250707070707', pricing: { billable: true, category: 'service', pricing_model: 'PMP' } },
        { id: 'wamid.B', status: 'read', timestamp: '1791277400' },
        { id: 'wamid.C', status: 'failed', timestamp: '1791277500', errors: [{ code: 131047, title: 'Re-engagement message' }] },
        { id: 'wamid.D', status: 'deleted' },
      ],
    }), maintenant);
    expect(statuts).toEqual([
      { idExterne: 'wamid.A', phoneNumberId: '1098', statut: 'delivered', date: new Date(1791277300 * 1000), facturable: true, categorie: 'service', erreur: null },
      { idExterne: 'wamid.B', phoneNumberId: '1098', statut: 'read', date: new Date(1791277400 * 1000), facturable: null, categorie: null, erreur: null },
      { idExterne: 'wamid.C', phoneNumberId: '1098', statut: 'failed', date: new Date(1791277500 * 1000), facturable: null, categorie: null, erreur: '131047 Re-engagement message' },
    ]);
  });
});

describe('SMS entrant', () => {
  it('numéros normalisés en E.164 ; illisible : null', () => {
    expect(lireSmsEntrant({ id: 's1', de: '07 07 07 07 07', vers: '+225 27 22 00 00 01', texte: 'Bonjour' }, maintenant))
      .toEqual({ idExterne: 's1', de: '+2250707070707', vers: '+2252722000001', texte: 'Bonjour', recuLe: maintenant });
    expect(lireSmsEntrant({ id: 's2', de: 'abc', vers: '+2252722000001', texte: 'x' }, maintenant)).toBeNull();
    expect(lireSmsEntrant({ id: 's3', de: '0707070707', vers: '0102030405', texte: 'x', recuLe: '2026-10-06T08:00:00Z' }, maintenant)!.recuLe)
      .toEqual(new Date('2026-10-06T08:00:00Z'));
  });
});

describe('adaptateur de l\'API de Meta', () => {
  let serveur: Server;
  let url = '';
  const recues: { url: string; auth: string | undefined; corps: string }[] = [];
  let reponse: { statut: number; corps: unknown } = { statut: 200, corps: {} };
  const lire = (req: IncomingMessage) => new Promise<string>((ok) => { let s = ''; req.on('data', (c) => { s += c; }); req.on('end', () => ok(s)); });

  beforeAll(async () => {
    serveur = createServer(async (req, res) => {
      recues.push({ url: req.url ?? '', auth: req.headers.authorization, corps: await lire(req) });
      if (req.url === '/fichier/m1') {
        res.writeHead(200, { 'Content-Type': 'image/png' }).end(Buffer.from('89504e47', 'hex'));
        return;
      }
      if (req.url === '/v26.0/m1') {
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ url: `${url}/fichier/m1`, mime_type: 'image/png', file_size: 4 }));
        return;
      }
      res.writeHead(reponse.statut, { 'Content-Type': 'application/json' }).end(JSON.stringify(reponse.corps));
    });
    await new Promise<void>((ok) => serveur.listen(0, '127.0.0.1', ok));
    url = `http://127.0.0.1:${(serveur.address() as { port: number }).port}`;
  });
  afterAll(() => new Promise<void>((ok) => serveur.close(() => ok())));

  it('envoi d\'un texte au numéro de la banque, avec son jeton ; l\'identifiant du message en retour', async () => {
    reponse = { statut: 200, corps: { messaging_product: 'whatsapp', contacts: [{ wa_id: '2250707070707' }], messages: [{ id: 'wamid.X' }] } };
    const meta = new WhatsappMeta({ url, version: 'v26.0' });
    expect(await meta.envoyer({ phoneNumberId: '1098', jeton: 'JETON', destination: '+2250707070707', texte: 'Bonjour' })).toEqual({ idFournisseur: 'wamid.X' });
    const r = recues.at(-1)!;
    expect(r.url).toBe('/v26.0/1098/messages');
    expect(r.auth).toBe('Bearer JETON');
    expect(JSON.parse(r.corps)).toEqual({ messaging_product: 'whatsapp', recipient_type: 'individual', to: '+2250707070707', type: 'text', text: { body: 'Bonjour', preview_url: true } });
  });

  it('erreurs : fenêtre fermée ou jeton expiré définitives, débit et panne passagères', async () => {
    const meta = new WhatsappMeta({ url, version: 'v26.0' });
    const essai = async (statut: number, code: number) => {
      reponse = { statut, corps: { error: { message: 'Erreur de Meta', code } } };
      return meta.envoyer({ phoneNumberId: '1098', jeton: 'J', destination: '+2250707070707', texte: 'x' }).then(() => null, (e: unknown) => e as ErreurWhatsapp);
    };
    expect(await essai(400, 131047)).toMatchObject({ code: 131047, definitive: true });
    expect(await essai(401, 190)).toMatchObject({ code: 190, definitive: true });
    expect(await essai(400, 130429)).toMatchObject({ code: 130429, definitive: false });
    expect(await essai(429, 4)).toMatchObject({ definitive: false });
    expect(await essai(503, 2)).toMatchObject({ definitive: false });
  });

  it('téléchargement d\'un média en deux temps (adresse, puis contenu), plafonné', async () => {
    const meta = new WhatsappMeta({ url, version: 'v26.0' });
    const m = await meta.telecharger('m1', 'JETON', 5 * 1024 * 1024);
    expect(m.typeMime).toBe('image/png');
    expect(m.contenu.toString('hex')).toBe('89504e47');
    expect(recues.at(-1)!.auth).toBe('Bearer JETON');
    await expect(meta.telecharger('m1', 'JETON', 2)).rejects.toMatchObject({ definitive: true });
  });
});
