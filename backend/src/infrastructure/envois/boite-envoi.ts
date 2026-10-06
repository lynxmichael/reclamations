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
 *
 * Étape 20 : WhatsApp, avec le numéro et le jeton de la banque (déchiffré ici, en contexte système) ;
 * SMS d'une conversation, du numéro de la banque. Une erreur définitive de Meta (fenêtre de 24 h
 * fermée, numéro sans WhatsApp, jeton expiré) n'est pas réessayée : le client est alors prévenu
 * autrement (`apresEchecWhatsapp`). Le texte d'un message de conversation est effacé une fois envoyé.
 */
import { Logger } from '@nestjs/common';
import type { Notification } from '../../generated/prisma/client.js';
import { versGsm } from '../../domaine/sms.js';
import type { BaseDonnees } from '../base-de-donnees/base-de-donnees.service.js';
import type { ClientTransaction } from '../base-de-donnees/index.js';
import { ErreurWhatsapp, type AdaptateurWhatsapp } from '../canaux/whatsapp.js';
import { dechiffrer } from '../securite/totp.js';
import type { AdaptateurEmail, AdaptateurSms, ResultatEnvoi } from './adaptateurs.js';
import { emailHtml } from './gabarit-email.js';

export const TENTATIVES_MAX = 5;
const LOT = 50;
/** Modèles dont le contenu porte un secret à usage unique */
export const MODELES_SENSIBLES = ['client.otp', 'personnel.invitation', 'personnel.reinitialisation'];
export const CONTENU_MASQUE = '[contenu masqué après envoi : code ou lien à usage unique]';
/** Messages de conversation sur WhatsApp ou par SMS (étape 20) : le texte est dans la réclamation */
export const MODELES_CONVERSATION = ['conversation.reponse', 'canal.reponse_auto'];
export const CONTENU_CONVERSATION = '[message de conversation effacé après envoi]';
/** Signature des e-mails de la plateforme (Super Admin) */
export const NOM_PLATEFORME = 'Makor Telecoms · Réclamations';

export interface BilanEnvois {
  envoyees: number;
  echecs: number;
}

/** WhatsApp (étape 20) : l'adaptateur et la clé des jetons des banques */
export interface CanauxEnvoi {
  readonly whatsapp: AdaptateurWhatsapp;
  readonly cle: Buffer;
}

interface NumeroWhatsapp {
  readonly identifiant: string;
  readonly jeton: string;
}

const masque = (modele: string): { contenu: string } | Record<string, never> =>
  (MODELES_SENSIBLES.includes(modele) ? { contenu: CONTENU_MASQUE } : MODELES_CONVERSATION.includes(modele) ? { contenu: CONTENU_CONVERSATION } : {});

/**
 * WhatsApp n'a pas remis le message (étape 20) : le client est prévenu autrement.
 * - réponse d'un agent : l'avis différé de la conversation est rouvert ; le worker l'envoie par
 *   e-mail ou SMS ordinaire, sans le texte (taches-sla, avisConversations) ;
 * - étape de la réclamation (dépôt, résolution, clôture…) : le même texte part en SMS ordinaire ;
 * - réponse automatique : rien (le client écrit de nouveau s'il le souhaite).
 * À appeler en contexte système.
 */
export async function apresEchecWhatsapp(tx: ClientTransaction, n: Pick<Notification, 'tenantId' | 'modele' | 'reclamationId' | 'destination' | 'destinataireClientId' | 'contenu'>): Promise<void> {
  if (!n.tenantId) return;
  if (n.modele === 'conversation.reponse' && n.reclamationId) {
    await tx.conversation.updateMany({ where: { tenantId: n.tenantId, reclamationId: n.reclamationId }, data: { avisClientLe: null } });
  } else if (n.modele.startsWith('client.') && n.destination && n.contenu !== CONTENU_CONVERSATION) {
    await tx.notification.create({
      data: {
        tenantId: n.tenantId, canal: 'SMS', modele: n.modele, destination: n.destination,
        destinataireClientId: n.destinataireClientId, reclamationId: n.reclamationId, contenu: versGsm(n.contenu),
      },
    });
  }
}

export class BoiteEnvoi {
  private readonly journal = new Logger('Envois');

  constructor(
    private readonly bd: BaseDonnees,
    private readonly email: AdaptateurEmail,
    private readonly sms: AdaptateurSms,
    private readonly horloge: () => Date = () => new Date(),
    private readonly canaux: CanauxEnvoi | null = null,
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
      // Ordre de création : les messages d'une conversation partent dans l'ordre où ils ont été écrits
      const notifications = await tx.notification.findMany({ where: { id: { in: liste }, canal: { not: 'IN_APP' } }, orderBy: [{ creeLe: 'asc' }, { id: 'asc' }] });
      const tenants = [...new Set(notifications.map((n) => n.tenantId).filter((t): t is string => !!t))];
      const banques = tenants.length ? await tx.banque.findMany({ where: { id: { in: tenants } }, select: { id: true, nom: true, couleurPrimaire: true } }) : [];
      return { notifications, banques };
    });
    const banques = new Map(lot.banques.map((b) => [b.id, b]));
    const numeros = new Map<string, NumeroWhatsapp | null>();

    const bilan: BilanEnvois = { envoyees: 0, echecs: 0 };
    for (const n of lot.notifications) {
      try {
        if (!n.destination) throw new Error('Destination absente');
        let r: ResultatEnvoi;
        if (n.canal === 'EMAIL') {
          const sujet = n.sujet ?? 'Notification';
          const banque = n.tenantId ? banques.get(n.tenantId) : undefined;
          const marque = { nom: banque?.nom ?? NOM_PLATEFORME, couleur: banque?.couleurPrimaire ?? null, client: !!n.destinataireClientId };
          r = await this.email.envoyer({ destination: n.destination, sujet, texte: n.contenu, html: emailHtml(sujet, n.contenu, marque) });
        } else if (n.canal === 'WHATSAPP') {
          const numero = await this.numeroWhatsapp(n.tenantId, numeros);
          r = await this.canaux!.whatsapp.envoyer({ phoneNumberId: numero.identifiant, jeton: numero.jeton, destination: n.destination, texte: n.contenu });
        } else {
          r = await this.sms.envoyer({ destination: n.destination, texte: n.contenu, reference: n.id, expediteur: n.expediteur });
        }
        await this.bd.enSysteme((tx) => tx.notification.update({
          where: { id: n.id },
          data: {
            statut: 'ENVOYEE', envoyeeLe: this.horloge(), idFournisseur: r.idFournisseur, derniereErreur: null,
            ...(n.canal === 'SMS' ? { segmentsSms: r.segments ?? 1 } : {}),
            ...masque(n.modele),
          },
        }));
        bilan.envoyees++;
      } catch (e) {
        const message = (e as Error).message.slice(0, 500);
        // WhatsApp : une erreur définitive de Meta ne se réessaie pas
        const definitif = n.tentatives >= TENTATIVES_MAX || (e instanceof ErreurWhatsapp && e.definitive);
        await this.bd.enSysteme(async (tx) => {
          await tx.notification.update({
            where: { id: n.id },
            data: { derniereErreur: message, ...(definitif ? { statut: 'ECHEC', ...masque(n.modele) } : {}) },
          });
          if (definitif && n.canal === 'WHATSAPP') await apresEchecWhatsapp(tx, n);
        });
        bilan.echecs++;
        this.journal.warn(`${n.canal} ${n.modele} (tentative ${n.tentatives}) : ${message}`);
      }
    }
    return bilan;
  }

  /** Numéro WhatsApp de la banque et son jeton, lus une fois par lot. */
  private async numeroWhatsapp(tenantId: string | null, cache: Map<string, NumeroWhatsapp | null>): Promise<NumeroWhatsapp> {
    if (!this.canaux) throw new ErreurWhatsapp('WhatsApp : envoi non configuré dans ce worker', null, false);
    if (!tenantId) throw new ErreurWhatsapp('WhatsApp : notification sans banque', null, true);
    if (!cache.has(tenantId)) {
      const c = await this.bd.enSysteme((tx) => tx.canalBanque.findUnique({
        where: { tenantId_canal: { tenantId, canal: 'WHATSAPP' } }, select: { identifiant: true, jetonChiffre: true },
      }));
      cache.set(tenantId, c?.jetonChiffre ? { identifiant: c.identifiant, jeton: dechiffrer(this.canaux.cle, c.jetonChiffre) } : null);
    }
    const numero = cache.get(tenantId);
    if (!numero) throw new ErreurWhatsapp('WhatsApp : numéro de la banque non raccordé', null, true);
    return numero;
  }
}
