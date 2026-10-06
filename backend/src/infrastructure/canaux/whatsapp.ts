/**
 * WhatsApp Business Platform de Meta, API hébergée par Meta (« Cloud API », décision I7) : lecture des
 * webhooks, signature, envoi d'un texte, téléchargement d'un média. Derrière un adaptateur : un
 * fournisseur agréé pourra s'y brancher.
 *
 * - Webhook : un appel de Meta par lot d'événements (messages reçus, statuts des envois), signé par
 *   `X-Hub-Signature-256` (HMAC-SHA256 du corps avec le secret de l'application de Makor).
 * - Envoi : POST /<version>/<phone_number_id>/messages, avec le jeton de la banque.
 * - Développement : « journal » écrit les messages dans le journal du worker au lieu de les envoyer.
 */
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { MediaRecu } from '../../domaine/canaux.js';

/** Signature HMAC-SHA256 « sha256=<hex> » du corps brut, comparée en temps constant. */
export function signatureValide(corps: Buffer | undefined, entete: string | undefined, secret: string | null): boolean {
  if (!corps || !entete || !secret) return false;
  const m = /^sha256=([0-9a-f]{64})$/i.exec(entete.trim());
  if (!m) return false;
  const attendue = createHmac('sha256', secret).update(corps).digest();
  const recue = Buffer.from(m[1]!.toLowerCase(), 'hex');
  return recue.length === attendue.length && timingSafeEqual(recue, attendue);
}

export function signer(corps: Buffer | string, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(corps).digest('hex')}`;
}

export interface MessageWhatsapp {
  readonly idExterne: string;
  /** Numéro de la banque chez Meta : il désigne la banque */
  readonly phoneNumberId: string;
  /** Numéro du client, E.164 */
  readonly de: string;
  readonly nomProfil: string | null;
  readonly recuLe: Date;
  /** texte et médias lisibles ; « autre » : son, vidéo, position, contact… ; « ignore » : réaction */
  readonly nature: 'lisible' | 'autre' | 'ignore';
  readonly texte: string;
  readonly medias: readonly MediaRecu[];
}

export interface StatutWhatsapp {
  readonly idExterne: string;
  readonly phoneNumberId: string;
  readonly statut: 'sent' | 'delivered' | 'read' | 'failed';
  readonly date: Date;
  readonly facturable: boolean | null;
  readonly categorie: string | null;
  readonly erreur: string | null;
}

type Objet = Record<string, unknown>;
const objet = (v: unknown): Objet => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Objet) : {});
const liste = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const texte = (v: unknown): string => (typeof v === 'string' ? v : '');
const date = (v: unknown, defaut: Date): Date => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000) : defaut;
};
const e164 = (v: string): string => (v.startsWith('+') ? v : `+${v.replace(/\D/g, '')}`);

const MEDIAS = new Set(['image', 'document']);
const IGNORES = new Set(['reaction', 'system', 'ephemeral', 'request_welcome']);

/** Les événements d'un webhook : ce qui n'est pas compris est ignoré (Meta ajoute des champs). */
export function lireWebhookWhatsapp(corps: unknown, maintenant: Date): { messages: MessageWhatsapp[]; statuts: StatutWhatsapp[] } {
  const messages: MessageWhatsapp[] = [];
  const statuts: StatutWhatsapp[] = [];
  for (const entree of liste(objet(corps).entry)) {
    for (const changement of liste(objet(entree).changes)) {
      const c = objet(changement);
      if (c.field !== undefined && c.field !== 'messages') continue;
      const v = objet(c.value);
      const phoneNumberId = texte(objet(v.metadata).phone_number_id);
      if (!phoneNumberId) continue;
      const profils = new Map(liste(v.contacts).map((x) => [texte(objet(x).wa_id), texte(objet(objet(x).profile).name) || null]));
      for (const brut of liste(v.messages)) {
        const m = objet(brut);
        const id = texte(m.id);
        const de = texte(m.from);
        // Numéro international (E.164) : 8 à 15 chiffres, sans zéro en tête
        if (!id || !/^\+?[1-9]\d{7,14}$/.test(de)) continue;
        const type = texte(m.type);
        const base = { idExterne: id, phoneNumberId, de: e164(de), nomProfil: profils.get(de) ?? null, recuLe: date(m.timestamp, maintenant) };
        if (type === 'text') {
          messages.push({ ...base, nature: 'lisible', texte: texte(objet(m.text).body), medias: [] });
        } else if (MEDIAS.has(type)) {
          const media = objet(m[type]);
          messages.push({
            ...base, nature: 'lisible', texte: texte(media.caption),
            medias: texte(media.id) ? [{ id: texte(media.id), typeMime: texte(media.mime_type), nom: texte(media.filename) || null }] : [],
          });
        } else if (type === 'button') {
          messages.push({ ...base, nature: 'lisible', texte: texte(objet(m.button).text), medias: [] });
        } else if (type === 'interactive') {
          const i = objet(m.interactive);
          messages.push({ ...base, nature: 'lisible', texte: texte(objet(i.button_reply).title) || texte(objet(i.list_reply).title), medias: [] });
        } else {
          messages.push({ ...base, nature: IGNORES.has(type) ? 'ignore' : 'autre', texte: '', medias: [] });
        }
      }
      for (const brut of liste(v.statuses)) {
        const s = objet(brut);
        const statut = texte(s.status);
        if (!texte(s.id) || !['sent', 'delivered', 'read', 'failed'].includes(statut)) continue;
        const prix = objet(s.pricing);
        const erreur = objet(liste(s.errors)[0]);
        statuts.push({
          idExterne: texte(s.id),
          phoneNumberId,
          statut: statut as StatutWhatsapp['statut'],
          date: date(s.timestamp, maintenant),
          facturable: typeof prix.billable === 'boolean' ? prix.billable : null,
          categorie: texte(prix.category).slice(0, 30) || null,
          erreur: Object.keys(erreur).length ? `${texte(String(erreur.code ?? ''))} ${texte(erreur.title) || texte(erreur.message)}`.trim().slice(0, 500) : null,
        });
      }
    }
  }
  return { messages, statuts };
}

// ---------------------------------------------------------------------------
//  Envoi
// ---------------------------------------------------------------------------

export interface EnvoiWhatsapp {
  readonly phoneNumberId: string;
  readonly jeton: string;
  /** Numéro du client, E.164 */
  readonly destination: string;
  readonly texte: string;
}

export interface MediaTelecharge {
  readonly contenu: Buffer;
  readonly typeMime: string;
}

export interface AdaptateurWhatsapp {
  envoyer(m: EnvoiWhatsapp): Promise<{ idFournisseur: string }>;
  telecharger(mediaId: string, jeton: string, maxOctets: number): Promise<MediaTelecharge>;
}

/**
 * Erreur de Meta. `definitive` : réessayer ne changerait rien (fenêtre de 24 h fermée, numéro sans
 * WhatsApp, jeton expiré, paramètre refusé…) ; sinon (débit, panne), la boîte d'envoi réessaie.
 */
export class ErreurWhatsapp extends Error {
  constructor(message: string, readonly code: number | null, readonly definitive: boolean) {
    super(message);
    this.name = 'ErreurWhatsapp';
  }
}

/** Codes après lesquels un nouvel essai est utile : débit dépassé, indisponibilité passagère. */
const PASSAGERES = new Set([1, 2, 4, 17, 80007, 130429, 131000, 131016, 131056, 133004]);

export interface OptionsWhatsappMeta {
  /** https://graph.facebook.com (modifiable : fournisseur agréé, tests) */
  readonly url: string;
  /** Version de l'API Graph, ex. v26.0 */
  readonly version: string;
  readonly delaiMs?: number;
}

export class WhatsappMeta implements AdaptateurWhatsapp {
  constructor(private readonly o: OptionsWhatsappMeta) {}

  private base(): string {
    return `${this.o.url.replace(/\/+$/, '')}/${this.o.version}`;
  }

  private async erreur(reponse: Response): Promise<ErreurWhatsapp> {
    const brut = await reponse.text().catch(() => '');
    let code: number | null = null;
    let message = brut.replace(/\s+/g, ' ').slice(0, 300);
    try {
      const e = objet(objet(JSON.parse(brut)).error);
      code = typeof e.code === 'number' ? e.code : null;
      message = `${texte(e.message) || message}${e.error_subcode ? ` (${String(e.error_subcode)})` : ''}`;
    } catch {
      // corps non JSON
    }
    const definitive = reponse.status < 500 && reponse.status !== 429 && !(code !== null && PASSAGERES.has(code));
    return new ErreurWhatsapp(`WhatsApp : HTTP ${reponse.status}${code !== null ? `, code ${code}` : ''} — ${message}`, code, definitive);
  }

  async envoyer(m: EnvoiWhatsapp): Promise<{ idFournisseur: string }> {
    const reponse = await fetch(`${this.base()}/${encodeURIComponent(m.phoneNumberId)}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${m.jeton}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: m.destination, type: 'text', text: { body: m.texte, preview_url: true } }),
      signal: AbortSignal.timeout(this.o.delaiMs ?? 10_000),
    });
    if (!reponse.ok) throw await this.erreur(reponse);
    const corps = objet(await reponse.json().catch(() => ({})));
    const id = texte(objet(liste(corps.messages)[0]).id);
    if (!id) throw new ErreurWhatsapp('WhatsApp : réponse sans identifiant de message', null, false);
    return { idFournisseur: id.slice(0, 128) };
  }

  async telecharger(mediaId: string, jeton: string, maxOctets: number): Promise<MediaTelecharge> {
    const auth = { Authorization: `Bearer ${jeton}` };
    const r1 = await fetch(`${this.base()}/${encodeURIComponent(mediaId)}`, { headers: auth, signal: AbortSignal.timeout(this.o.delaiMs ?? 10_000) });
    if (!r1.ok) throw await this.erreur(r1);
    const info = objet(await r1.json().catch(() => ({})));
    const url = texte(info.url);
    if (!url) throw new ErreurWhatsapp('WhatsApp : média sans adresse', null, true);
    if (Number(info.file_size) > maxOctets) throw new ErreurWhatsapp('WhatsApp : média trop volumineux', null, true);
    const r2 = await fetch(url, { headers: auth, signal: AbortSignal.timeout(this.o.delaiMs ?? 20_000) });
    if (!r2.ok) throw await this.erreur(r2);
    const contenu = Buffer.from(await r2.arrayBuffer());
    if (contenu.length > maxOctets) throw new ErreurWhatsapp('WhatsApp : média trop volumineux', null, true);
    return { contenu, typeMime: texte(info.mime_type) };
  }
}

/** Développement : messages écrits dans le journal, rien n'est envoyé ; aucun média à télécharger. */
export class WhatsappJournal implements AdaptateurWhatsapp {
  private readonly journal = new Logger('WhatsApp');

  async envoyer(m: EnvoiWhatsapp): Promise<{ idFournisseur: string }> {
    this.journal.log(`→ ${m.destination} : ${m.texte}`);
    return { idFournisseur: `wamid.journal.${randomUUID()}` };
  }

  async telecharger(): Promise<MediaTelecharge> {
    throw new ErreurWhatsapp('WhatsApp (journal) : pas de média en développement', null, true);
  }
}

/** Adaptateur de la configuration (WHATSAPP_ENVOI) ; en production, le journal est signalé au démarrage. */
export function adaptateurWhatsapp(c: { envoi: 'meta' | 'journal'; url: string; version: string }, production: boolean): AdaptateurWhatsapp {
  const journal = new Logger('WhatsApp');
  if (c.envoi === 'meta') return new WhatsappMeta({ url: c.url, version: c.version });
  if (production) journal.warn('WHATSAPP_ENVOI=journal : aucun message WhatsApp n\'est envoyé (écrits dans le journal seulement)');
  return new WhatsappJournal();
}
