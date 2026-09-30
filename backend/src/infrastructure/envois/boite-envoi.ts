/**
 * Boîte d'envoi du worker : les notifications écrites en EN_ATTENTE par l'API (dans la transaction
 * de l'action qui les provoque) sont envoyées ici, hors de toute requête HTTP.
 *
 * 1. réservation d'un lot (FOR UPDATE SKIP LOCKED, tentatives + 1) : deux workers ne prennent
 *    jamais la même notification ;
 * 2. envoi, hors transaction ;
 * 3. résultat : ENVOYEE (avec les segments SMS facturés) ou, après 5 tentatives, ECHEC.
 * Le contenu d'un code ou d'un lien à usage unique est masqué une fois envoyé.
 *
 * Étape 9 : chaque e-mail part aussi en HTML, au nom et aux couleurs de sa banque (celui de la
 * plateforme pour le Super Admin) ; la passerelle SMS reçoit l'identifiant de la notification.
 */
import { Logger } from '@nestjs/common';
import type { BaseDonnees } from '../base-de-donnees/base-de-donnees.service.js';
import type { AdaptateurEmail, AdaptateurSms } from './adaptateurs.js';
import { emailHtml } from './gabarit-email.js';

export const TENTATIVES_MAX = 5;
const LOT = 50;
/** Modèles dont le contenu porte un secret à usage unique */
export const MODELES_SENSIBLES = ['client.otp', 'personnel.invitation', 'personnel.reinitialisation'];
export const CONTENU_MASQUE = '[contenu masqué après envoi : code ou lien à usage unique]';
/** Signature des e-mails de la plateforme (Super Admin) */
export const NOM_PLATEFORME = 'Makor Telecoms · Réclamations';

export interface BilanEnvois {
  envoyees: number;
  echecs: number;
}

export class BoiteEnvoi {
  private readonly journal = new Logger('Envois');

  constructor(
    private readonly bd: BaseDonnees,
    private readonly email: AdaptateurEmail,
    private readonly sms: AdaptateurSms,
    private readonly horloge: () => Date = () => new Date(),
  ) {}

  /** `relances` : notifications déjà tentées (sinon, les nouvelles seulement). */
  async vider(relances = false): Promise<BilanEnvois> {
    const maintenant = this.horloge();
    const lot = await this.bd.enSysteme(async (tx) => {
      const ids = relances
        ? await tx.$queryRaw<{ id: string }[]>`
            SELECT id FROM notification WHERE statut = 'EN_ATTENTE' AND tentatives BETWEEN 1 AND ${TENTATIVES_MAX - 1}
              AND cree_le < ${new Date(maintenant.getTime() - 60_000)}
            ORDER BY cree_le LIMIT ${LOT} FOR UPDATE SKIP LOCKED`
        : await tx.$queryRaw<{ id: string }[]>`
            SELECT id FROM notification WHERE statut = 'EN_ATTENTE' AND tentatives = 0
            ORDER BY cree_le LIMIT ${LOT} FOR UPDATE SKIP LOCKED`;
      if (ids.length === 0) return { notifications: [], banques: [] };
      const liste = ids.map((l) => l.id);
      await tx.notification.updateMany({ where: { id: { in: liste } }, data: { tentatives: { increment: 1 } } });
      // L'in-app est livré par sa seule présence en base
      await tx.notification.updateMany({ where: { id: { in: liste }, canal: 'IN_APP' }, data: { statut: 'ENVOYEE', envoyeeLe: maintenant } });
      const notifications = await tx.notification.findMany({ where: { id: { in: liste }, canal: { not: 'IN_APP' } } });
      const tenants = [...new Set(notifications.map((n) => n.tenantId).filter((t): t is string => !!t))];
      const banques = tenants.length ? await tx.banque.findMany({ where: { id: { in: tenants } }, select: { id: true, nom: true, couleurPrimaire: true } }) : [];
      return { notifications, banques };
    });
    const banques = new Map(lot.banques.map((b) => [b.id, b]));

    const bilan: BilanEnvois = { envoyees: 0, echecs: 0 };
    for (const n of lot.notifications) {
      try {
        if (!n.destination) throw new Error('Destination absente');
        let r;
        if (n.canal === 'EMAIL') {
          const sujet = n.sujet ?? 'Notification';
          const banque = n.tenantId ? banques.get(n.tenantId) : undefined;
          const marque = { nom: banque?.nom ?? NOM_PLATEFORME, couleur: banque?.couleurPrimaire ?? null, client: !!n.destinataireClientId };
          r = await this.email.envoyer({ destination: n.destination, sujet, texte: n.contenu, html: emailHtml(sujet, n.contenu, marque) });
        } else {
          r = await this.sms.envoyer({ destination: n.destination, texte: n.contenu, reference: n.id });
        }
        await this.bd.enSysteme((tx) => tx.notification.update({
          where: { id: n.id },
          data: {
            statut: 'ENVOYEE', envoyeeLe: this.horloge(), idFournisseur: r.idFournisseur, derniereErreur: null,
            ...(n.canal === 'SMS' ? { segmentsSms: r.segments ?? 1 } : {}),
            ...(MODELES_SENSIBLES.includes(n.modele) ? { contenu: CONTENU_MASQUE } : {}),
          },
        }));
        bilan.envoyees++;
      } catch (e) {
        const message = (e as Error).message.slice(0, 500);
        const definitif = n.tentatives >= TENTATIVES_MAX;
        await this.bd.enSysteme((tx) => tx.notification.update({
          where: { id: n.id },
          data: { derniereErreur: message, ...(definitif ? { statut: 'ECHEC' } : {}), ...(definitif && MODELES_SENSIBLES.includes(n.modele) ? { contenu: CONTENU_MASQUE } : {}) },
        }));
        bilan.echecs++;
        this.journal.warn(`${n.canal} ${n.modele} (tentative ${n.tentatives}) : ${message}`);
      }
    }
    return bilan;
  }
}
