/**
 * Adaptateurs d'envoi (arbitrage 1 : SMS derrière un adaptateur remplaçable).
 *
 * Étape 7 : e-mails par SMTP (Mailpit en développement, prestataire à choisir en production) ;
 * SMS journalisés, sans envoi réel. La passerelle SMS de Makor Telecoms arrive à l'étape 9.
 */
import { Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';

export interface ResultatEnvoi {
  readonly idFournisseur: string | null;
  readonly segments?: number;
}

export interface AdaptateurEmail {
  envoyer(m: { destination: string; sujet: string; texte: string }): Promise<ResultatEnvoi>;
  fermer?(): Promise<void>;
}

export interface AdaptateurSms {
  envoyer(m: { destination: string; texte: string }): Promise<ResultatEnvoi>;
}

export class EmailSmtp implements AdaptateurEmail {
  private readonly transport: Transporter;

  constructor(url: string, private readonly expediteur: string) {
    this.transport = createTransport(url);
  }

  async envoyer(m: { destination: string; sujet: string; texte: string }): Promise<ResultatEnvoi> {
    const info = await this.transport.sendMail({ from: this.expediteur, to: m.destination, subject: m.sujet, text: m.texte });
    return { idFournisseur: (info.messageId as string | undefined)?.slice(0, 128) ?? null };
  }

  async fermer(): Promise<void> {
    this.transport.close();
  }
}

/** SMS de développement : écrits dans le journal du worker, comptés comme la passerelle les facturerait. */
export class SmsJournal implements AdaptateurSms {
  private readonly journal = new Logger('SMS');

  async envoyer(m: { destination: string; texte: string }): Promise<ResultatEnvoi> {
    const segments = segmentsSms(m.texte);
    this.journal.log(`→ ${m.destination} (${segments} segment${segments > 1 ? 's' : ''}) : ${m.texte}`);
    return { idFournisseur: null, segments };
  }
}

// Alphabet GSM 03.38 : 7 bits par caractère ; les caractères de l'extension en comptent deux
const GSM_BASE = new Set([...'@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà']);
const GSM_EXTENSION = new Set([...'^{}\\[~]|€']);

/** Nombre de segments facturés : 160/153 caractères en GSM 7 bits, 70/67 en UCS-2 (accents hors GSM, emojis). */
export function segmentsSms(texte: string): number {
  const caracteres = [...texte];
  const gsm = caracteres.every((c) => GSM_BASE.has(c) || GSM_EXTENSION.has(c));
  if (gsm) {
    const longueur = caracteres.reduce((n, c) => n + (GSM_EXTENSION.has(c) ? 2 : 1), 0);
    return longueur <= 160 ? 1 : Math.ceil(longueur / 153);
  }
  // UCS-2 : les caractères hors plan de base (emojis) comptent deux unités
  const unites = texte.length;
  return unites <= 70 ? 1 : Math.ceil(unites / 67);
}
