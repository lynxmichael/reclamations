/**
 * Adaptateurs d'envoi (arbitrage 1 : SMS derrière un adaptateur remplaçable).
 *
 * - E-mails par SMTP (Mailpit en développement, prestataire à choisir en production), en texte
 *   et en HTML aux couleurs de la banque (étape 9).
 * - SMS : « journal » (développement : écrits dans le journal du worker) ou « http » (étape 9) :
 *   la passerelle SMS de Makor Telecoms, appelée en HTTPS avec une clé d'API.
 */
import { Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { segmentsSms } from '../../domaine/sms.js';

export interface ResultatEnvoi {
  readonly idFournisseur: string | null;
  readonly segments?: number;
}

export interface MessageEmail {
  readonly destination: string;
  readonly sujet: string;
  readonly texte: string;
  readonly html?: string;
}

export interface AdaptateurEmail {
  envoyer(m: MessageEmail): Promise<ResultatEnvoi>;
  fermer?(): Promise<void>;
}

export interface MessageSms {
  readonly destination: string;
  readonly texte: string;
  /** Identifiant de la notification : clé d'idempotence pour la passerelle */
  readonly reference?: string;
  /** SMS d'une conversation (étape 20) : le numéro de la banque, pour que le client puisse répondre */
  readonly expediteur?: string | null;
}

export interface AdaptateurSms {
  envoyer(m: MessageSms): Promise<ResultatEnvoi>;
}

export class EmailSmtp implements AdaptateurEmail {
  private readonly transport: Transporter;

  constructor(url: string, private readonly expediteur: string) {
    this.transport = createTransport(url);
  }

  async envoyer(m: MessageEmail): Promise<ResultatEnvoi> {
    const info = await this.transport.sendMail({
      from: this.expediteur, to: m.destination, subject: m.sujet, text: m.texte, ...(m.html ? { html: m.html } : {}),
    });
    return { idFournisseur: (info.messageId as string | undefined)?.slice(0, 128) ?? null };
  }

  async fermer(): Promise<void> {
    this.transport.close();
  }
}

/** SMS de développement : écrits dans le journal du worker, comptés comme la passerelle les facturerait. */
export class SmsJournal implements AdaptateurSms {
  private readonly journal = new Logger('SMS');

  async envoyer(m: MessageSms): Promise<ResultatEnvoi> {
    const segments = segmentsSms(m.texte);
    this.journal.log(`→ ${m.destination}${m.expediteur ? ` (de ${m.expediteur})` : ''} (${segments} segment${segments > 1 ? 's' : ''}) : ${m.texte}`);
    return { idFournisseur: null, segments };
  }
}

export interface OptionsSmsHttp {
  readonly url: string;
  readonly cle: string;
  /** Nom d'expéditeur affiché sur le téléphone (11 caractères au plus) */
  readonly expediteur: string;
  readonly delaiMs?: number;
}

/**
 * Passerelle SMS HTTP (étape 9). Interface proposée à la passerelle de Makor Telecoms, à
 * confirmer avec son équipe (point ouvert) :
 *
 *   POST <SMS_URL>
 *   Authorization: Bearer <SMS_CLE>
 *   Idempotency-Key: <identifiant de la notification>
 *   { "from": "<expéditeur>", "to": "+225…", "text": "…", "reference": "<identifiant>" }
 *
 *   (étape 20 : « from » est le numéro de la banque pour les SMS d'une conversation, le nom
 *   d'expéditeur sinon)
 *
 *   2xx { "id": "<identifiant chez la passerelle>", "segments": 2 }   (segments facultatif)
 *
 * Toute autre réponse, ou aucune réponse en 10 s, est une erreur : la boîte d'envoi réessaie
 * (5 tentatives), la clé d'idempotence évitant un double envoi si la passerelle l'honore.
 */
export class SmsHttp implements AdaptateurSms {
  constructor(private readonly o: OptionsSmsHttp) {}

  async envoyer(m: MessageSms): Promise<ResultatEnvoi> {
    const reponse = await fetch(this.o.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.o.cle}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(m.reference ? { 'Idempotency-Key': m.reference } : {}),
      },
      body: JSON.stringify({ from: m.expediteur ?? this.o.expediteur, to: m.destination, text: m.texte, ...(m.reference ? { reference: m.reference } : {}) }),
      signal: AbortSignal.timeout(this.o.delaiMs ?? 10_000),
    });
    const texte = await reponse.text();
    if (!reponse.ok) throw new Error(`Passerelle SMS : HTTP ${reponse.status} ${texte.replace(/\s+/g, ' ').slice(0, 200)}`);
    let corps: { id?: unknown; segments?: unknown } = {};
    try {
      corps = texte ? (JSON.parse(texte) as typeof corps) : {};
    } catch {
      // réponse 2xx sans JSON : acceptée, sans identifiant
    }
    const segments = Number.isInteger(corps.segments) && (corps.segments as number) > 0 ? (corps.segments as number) : segmentsSms(m.texte);
    return { idFournisseur: corps.id === undefined || corps.id === null ? null : String(corps.id).slice(0, 128), segments };
  }
}

// Décompte des segments : code pur, partagé avec les écrans (étape 20)
export { segmentsSms } from '../../domaine/sms.js';
