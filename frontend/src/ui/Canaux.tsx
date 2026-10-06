/**
 * WhatsApp et SMS entrant (étape 20) : où le client a écrit, et par où partira la réponse de la banque
 * (reponseVers, calculé par l'API). Le nombre de SMS facturés est compté comme le worker le comptera
 * (domaine/sms.ts, partagé avec l'API).
 */
import { Globe, MessageCircle, Phone, QrCode, Smartphone, Store } from 'lucide-react';
import { segmentsSms, versGsm } from '@domaine/sms';
import type { S } from '../api/types';
import { cx } from './composants';
import { dateHeure } from './format';
import { CANAL_CONVERSATION } from './libelles';

type Canal = S<'CanalConversation'>;

const STYLE: Record<Canal, string> = {
  WHATSAPP: 'bg-resolue-doux text-resolue',
  SMS: 'bg-ouverte-doux text-ouverte',
  WEB: 'bg-fond text-encre-2',
};

export function IconeCanal({ canal, taille = 14 }: { canal: Canal; taille?: number }) {
  const Icone = canal === 'WHATSAPP' ? MessageCircle : canal === 'SMS' ? Smartphone : Globe;
  return <Icone aria-hidden size={taille} strokeWidth={2.4} />;
}

/** Canal de dépôt d'une réclamation : QR code, lien web, WhatsApp, SMS, guichet ou téléphone (étape 21). */
export function IconeDepot({ canal, taille = 14 }: { canal: S<'CanalDepot'>; taille?: number }) {
  if (canal === 'WHATSAPP' || canal === 'SMS') return <IconeCanal canal={canal} taille={taille} />;
  const Icone = canal === 'QR_CODE' ? QrCode : canal === 'GUICHET' ? Store : canal === 'TELEPHONE' ? Phone : Globe;
  return <Icone aria-hidden size={taille} />;
}

/** Pastille du canal ; rien pour le portail, sauf `toujours` */
export function BadgeCanal({ canal, toujours, className }: { canal: Canal | null; toujours?: boolean; className?: string }) {
  if (!canal || (canal === 'WEB' && !toujours)) return null;
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] font-semibold whitespace-nowrap', STYLE[canal], className)}>
      <IconeCanal canal={canal} taille={13} />
      {canal === 'WEB' ? 'Portail' : CANAL_CONVERSATION[canal]}
    </span>
  );
}

/** Texte d'aide sous la zone de réponse, et l'invite de la zone. */
export function envoiDeLaReponse(c: { canal: Canal; reponseVers: S<'ReponseVers'> } | null, nomClient: string, texte: string) {
  const vers = c?.reponseVers.canal ?? 'WEB';
  if (vers === 'WHATSAPP') {
    return {
      invite: `Votre réponse à ${nomClient}, envoyée telle quelle sur WhatsApp`,
      aide: `Elle part sur WhatsApp, où ${nomClient} a écrit : fenêtre de 24 h ouverte jusqu'au ${dateHeure(c!.reponseVers.finFenetreLe!)}. Les pièces jointes restent dans son suivi, dont le lien est ajouté.`,
      ton: 'whatsapp' as const,
      canal: 'WHATSAPP' as Canal,
    };
  }
  if (vers === 'SMS') {
    const n = texte.trim() ? segmentsSms(versGsm(texte.trim())) : 0;
    return {
      invite: `Votre réponse à ${nomClient}, envoyée par SMS`,
      aide: `Elle part par SMS, du numéro de la banque : ${n ? `${n} SMS facturé${n > 1 ? 's' : ''}` : 'un SMS tous les 160 caractères'}${n > 4 ? ' — au-delà de 4, elle est coupée et le lien de son suivi ajouté' : ''}. Les caractères comme « ç » ou « ô » sont simplifiés.`,
      ton: n > 4 ? 'alerte' as const : 'sms' as const,
      canal: 'SMS' as Canal,
    };
  }
  if (c?.canal === 'WHATSAPP') {
    return {
      invite: `Votre réponse à ${nomClient}, dans son suivi`,
      aide: `${nomClient} a écrit sur WhatsApp il y a plus de 24 h : Meta n'y autorise plus de message libre. La réponse reste dans son suivi ; il en est averti par e-mail ou SMS, et retrouvera WhatsApp dès qu'il y écrira.`,
      ton: 'alerte' as const,
      canal: 'WHATSAPP' as Canal,
    };
  }
  return null;
}

export function AideEnvoi({ aide }: { aide: ReturnType<typeof envoiDeLaReponse> }) {
  if (!aide) return null;
  return (
    <p
      data-testid="aide-envoi"
      className={cx(
        'mt-2 flex items-start gap-1.5 text-[13px] leading-snug',
        aide.ton === 'whatsapp' ? 'text-resolue' : aide.ton === 'sms' ? 'text-ouverte' : 'text-alerte',
      )}
    >
      <span className="mt-px shrink-0"><IconeCanal canal={aide.canal} taille={14} /></span>
      <span>{aide.aide}</span>
    </p>
  );
}
