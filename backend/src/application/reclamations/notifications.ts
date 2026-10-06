/**
 * Notifications à émettre (§6.5) : qui prévenir, par quel canal, avec quel texte.
 *
 * Chaque notification est une ligne de la table notification au statut EN_ATTENTE, écrite dans
 * la même transaction que l'action qui la provoque (boîte d'envoi). L'envoi réel — SMTP,
 * passerelle SMS, relances, segments facturés — est le travail du worker (étape 9).
 *
 * Les e-mails et SMS au client ne contiennent jamais le texte de la réclamation ni des messages :
 * seulement le numéro et le lien de suivi (le détail exige le code OTP).
 */
import { DateTime } from 'luxon';
import type { CanalNotification } from '../../generated/prisma/enums.js';
import { basculer, contexte, type ClientTransaction } from '../../infrastructure/base-de-donnees/index.js';
import { SEGMENTS_SMS_MAX, SUITE_RESOLUTION, texteAccuse, texteCloture } from '../../domaine/canaux.js';
import { disponibilite } from '../../domaine/conversation.js';
import { texteReprise } from '../../domaine/ia/assistant.js';
import { finEnquete } from '../../domaine/satisfaction.js';
import { couperSms, versGsm } from '../../domaine/sms.js';
import { canalDeReponse, FIL_WEB, type FilClient } from './conversations.js';
import type { ParametresBanque } from './parametres.js';

export type ModeleClient = 'client.depot' | 'client.statut' | 'client.reponse' | 'client.question' | 'client.resolution' | 'client.cloture'
  // Étape 21 : lien de suivi renvoyé par la banque, doublon joint à la réclamation principale
  | 'client.lien_suivi' | 'client.rattachement';
/**
 * Messages de la conversation sur WhatsApp ou par SMS (étape 20) : réponse d'un agent, réponse
 * automatique. Leur texte est effacé de la notification une fois envoyé (il est dans la réclamation).
 */
export type ModeleFil = 'conversation.reponse' | 'canal.reponse_auto';
export type ModelePersonnel =
  | 'agent.assignation' | 'agent.message_client' | 'agent.contestation'
  | 'sla.alerte_preventive' | 'sla.depassement' | 'reclamation.urgente' | 'superviseur.escalade' | 'admin.escalade';
export type ModelePlateforme = 'plateforme.urgente' | 'plateforme.plafond';

/**
 * Le SMS part toujours au dépôt et à la résolution ; aux autres changements de statut, selon l'option de
 * la banque, activée par défaut (décision du 01/10/2026 : un SMS à chaque changement de statut).
 */
const SMS_TOUJOURS: readonly ModeleClient[] = ['client.depot', 'client.resolution', 'client.lien_suivi', 'client.rattachement'];
/**
 * Étape 20 : le client qui écrit sur WhatsApp ou par SMS y reçoit le dépôt, la résolution et la
 * clôture (avec le lien de l'enquête), quel que soit l'option des SMS ; les autres étapes selon elle.
 */
const FIL_TOUJOURS: readonly ModeleClient[] = ['client.depot', 'client.resolution', 'client.cloture', 'client.lien_suivi', 'client.rattachement'];
/** Texte WhatsApp au-delà duquel le message est coupé (Meta : 4 096 caractères) */
const LONGUEUR_WHATSAPP = 4000;

export interface TicketNotifie {
  readonly id: string;
  readonly tenantId: string;
  readonly numero: string;
  readonly jetonSuivi: string;
  readonly clientId: string;
  readonly agentId: string | null;
  readonly categorieNom: string;
  readonly echeanceSlaLe: Date | null;
}

export interface Destinataire {
  readonly id: string;
  readonly email: string;
  readonly libelle: string;
}

interface Texte {
  readonly sujet: string;
  readonly corps: string;
  readonly sms?: string;
  /** Sur WhatsApp ou par SMS, dans le fil où écrit le client (étape 20) */
  readonly fil?: string;
}

export interface MessageFil {
  readonly tenantId: string;
  readonly fil: FilClient;
  /** Numéro du client, E.164 */
  readonly destination: string;
  readonly texte: string;
  readonly modele: ModeleFil | ModeleClient;
  readonly clientId?: string | null;
  readonly reclamationId?: string | null;
  /** Lien vers la suite d'un texte trop long (suivi de la réclamation) */
  readonly lienSuite?: string | null;
}

/**
 * Un message dans le fil WhatsApp ou SMS du client (étape 20), mis en boîte d'envoi. Le SMS part du
 * numéro de la banque, ramené à l'alphabet GSM et coupé au-delà de 4 segments.
 */
export async function messageSurFil(tx: ClientTransaction, m: MessageFil): Promise<void> {
  if (m.fil.canal === 'WEB') throw new Error('messageSurFil : canal WEB');
  const suite = m.lienSuite ? `Suite : ${m.lienSuite}` : '';
  const contenu = m.fil.canal === 'SMS'
    ? couperSms(versGsm(m.texte), suite, SEGMENTS_SMS_MAX)
    : m.texte.length > LONGUEUR_WHATSAPP ? `${m.texte.slice(0, LONGUEUR_WHATSAPP - 3).trimEnd()}...${suite ? ` ${suite}` : ''}` : m.texte;
  await tx.notification.create({
    data: {
      tenantId: m.tenantId,
      canal: m.fil.canal,
      modele: m.modele,
      destinataireClientId: m.clientId ?? null,
      reclamationId: m.reclamationId ?? null,
      destination: m.destination,
      expediteur: m.fil.canal === 'SMS' ? m.fil.expediteur : null,
      contenu,
    },
  });
}

export class Envois {
  constructor(
    private readonly tx: ClientTransaction,
    private readonly ticket: TicketNotifie,
    private readonly p: ParametresBanque,
    private readonly lienSuivi: string,
    private readonly maintenant: Date,
  ) {}

  private date(d: Date | null): string {
    return d ? DateTime.fromJSDate(d, { zone: this.p.banque.fuseauHoraire }).toFormat("dd/MM/yyyy 'à' HH:mm") : '—';
  }

  // ---- Client final --------------------------------------------------------

  /**
   * `avis` : une enquête de satisfaction vient d'être ouverte, son lien part avec la clôture (étape 15).
   * Étape 20 : le SMS part dans le fil WhatsApp ou SMS où écrit le client (`canalDeReponse`), sauf
   * `sansFil` (le fil a échoué : SMS ordinaire) ; `emailSeul` : le fil a déjà reçu le message.
   * Étape 21 : `principale`, la réclamation à laquelle un doublon est joint. Rend les envois écrits.
   */
  async client(
    modele: ModeleClient,
    options: { avis?: boolean; sansFil?: boolean; emailSeul?: boolean; principale?: { numero: string; lien: string } } = {},
  ): Promise<{ canal: CanalNotification; destination: string }[]> {
    const client = await this.tx.clientFinal.findUniqueOrThrow({ where: { id: this.ticket.clientId } });
    const texte = this.texteClient(modele, client.nom, options.avis ?? false, options.principale);
    const lignes: { canal: CanalNotification; destination: string; sujet: string | null; contenu: string; expediteur?: string | null }[] = [];
    if (client.email) lignes.push({ canal: 'EMAIL', destination: client.email, sujet: texte.sujet, contenu: texte.corps });
    const sms = SMS_TOUJOURS.includes(modele) || this.p.banque.smsChaqueChangementStatut;
    if (client.telephone && !options.emailSeul) {
      const fil = options.sansFil ? FIL_WEB : await canalDeReponse(this.tx, this.ticket, this.p, this.maintenant);
      const surFil = fil.canal !== 'WEB' && (sms || FIL_TOUJOURS.includes(modele));
      if (surFil && fil.canal === 'WHATSAPP') {
        lignes.push({ canal: 'WHATSAPP', destination: client.telephone, sujet: null, contenu: texte.fil ?? texte.sms ?? texte.corps });
      } else if (surFil && fil.canal === 'SMS') {
        lignes.push({ canal: 'SMS', destination: client.telephone, sujet: null, contenu: versGsm(texte.fil ?? texte.sms ?? texte.corps), expediteur: fil.expediteur });
      } else if (fil.canal === 'WEB' && sms) {
        lignes.push({ canal: 'SMS', destination: client.telephone, sujet: null, contenu: texte.sms ?? texte.corps });
      }
    }
    if (lignes.length === 0) return [];
    await this.tx.notification.createMany({
      data: lignes.map((l) => ({
        ...l, tenantId: this.ticket.tenantId, modele, destinataireClientId: client.id, reclamationId: this.ticket.id,
      })),
    });
    return lignes.map((l) => ({ canal: l.canal, destination: l.destination }));
  }

  /**
   * Réponse d'un agent (ou résolution) dans le fil WhatsApp ou SMS du client (étape 20). Ses pièces
   * jointes restent dans le suivi, dont le lien est ajouté. Faux si le client n'a pas de téléphone.
   */
  async conversation(fil: FilClient, texte: string, piecesJointes = 0): Promise<boolean> {
    const client = await this.tx.clientFinal.findUniqueOrThrow({ where: { id: this.ticket.clientId }, select: { id: true, telephone: true } });
    if (fil.canal === 'WEB' || !client.telephone) return false;
    const pj = piecesJointes ? `\n\n${piecesJointes > 1 ? `${piecesJointes} pieces jointes` : 'Piece jointe'} : ${this.lienSuivi}` : '';
    await messageSurFil(this.tx, {
      tenantId: this.ticket.tenantId, fil, destination: client.telephone, texte: `${texte}${pj}`, modele: 'conversation.reponse',
      clientId: client.id, reclamationId: this.ticket.id, lienSuite: this.lienSuivi,
    });
    return true;
  }

  /** Réouverture de la banque, si elle est fermée : « demain à 8 h » */
  private reprise(): string | null {
    const d = disponibilite(this.maintenant, this.p.sla.calendrier);
    return d.repriseLe ? texteReprise(d.repriseLe, this.maintenant, this.p.banque.fuseauHoraire) : null;
  }

  private texteClient(modele: ModeleClient, nom: string, avis: boolean, principale?: { numero: string; lien: string }): Texte {
    const { numero } = this.ticket;
    const banque = this.p.banque.nom;
    const lien = this.lienSuivi;
    const bonjour = `Bonjour ${nom},\n\n`;
    const signature = `\n\n${banque}`;
    switch (modele) {
      case 'client.depot':
        return {
          sujet: `Réclamation ${numero} enregistrée`,
          corps: `${bonjour}Votre réclamation est enregistrée sous le numéro ${numero}.\nSuivez son avancement : ${lien}${signature}`,
          sms: `${banque} : réclamation ${numero} enregistrée. Suivi : ${lien}`,
          fil: texteAccuse(numero, lien, this.reprise()),
        };
      case 'client.statut':
        return {
          sujet: `Réclamation ${numero} en cours de traitement`,
          corps: `${bonjour}Votre réclamation ${numero} est prise en charge.\nSuivi : ${lien}${signature}`,
          sms: `${banque} : votre réclamation ${numero} est en cours de traitement.`,
          fil: `Votre reclamation ${numero} est prise en charge : un conseiller vous repond ici.`,
        };
      case 'client.reponse':
        return {
          sujet: `Nouvelle réponse — réclamation ${numero}`,
          corps: `${bonjour}Nous avons répondu à votre réclamation ${numero}.\nConsultez la réponse : ${lien}${signature}`,
          sms: `${banque} : nouvelle réponse sur votre réclamation ${numero}. ${lien}`,
        };
      case 'client.question':
        return {
          sujet: `Information demandée — réclamation ${numero}`,
          corps: `${bonjour}Pour traiter votre réclamation ${numero}, nous avons besoin d'une information.\nRépondez ici : ${lien}${signature}`,
          sms: `${banque} : une information est nécessaire pour votre réclamation ${numero}. ${lien}`,
        };
      case 'client.resolution':
        return {
          sujet: `Réclamation ${numero} résolue`,
          corps: `${bonjour}Votre réclamation ${numero} est résolue.\nConfirmez ou contestez la solution : ${lien}\n`
            + `Sans réaction de votre part sous ${this.p.sla.delaiClotureAutoJours} jours, elle sera clôturée.${signature}`,
          sms: `${banque} : réclamation ${numero} résolue. Confirmez ou contestez sous ${this.p.sla.delaiClotureAutoJours} jours : ${lien}`,
          fil: `Votre reclamation ${numero} est resolue. ${SUITE_RESOLUTION}`,
        };
      case 'client.cloture':
        // Avec l'enquête (étape 15), le SMS dit « close » : le « ô » de « clôturée », hors de l'alphabet GSM, doublerait son coût
        return avis
          ? {
            sujet: `Réclamation ${numero} clôturée : votre avis`,
            corps: `${bonjour}Votre réclamation ${numero} est clôturée.\n`
              + `Votre avis nous aide à mieux vous servir : deux questions, moins d'une minute, jusqu'au ${this.date(finEnquete(this.maintenant))} :\n`
              + `${lien}/avis\nHistorique : ${lien}${signature}`,
            sms: `${banque} : réclamation ${numero} close. Votre avis : ${lien}/avis`,
            fil: `${texteCloture(numero)} Votre avis nous aide : 2 questions, moins d'une minute : ${lien}/avis`,
          }
          : {
            sujet: `Réclamation ${numero} clôturée`,
            corps: `${bonjour}Votre réclamation ${numero} est clôturée.\nHistorique : ${lien}${signature}`,
            sms: `${banque} : votre réclamation ${numero} est clôturée.`,
            fil: texteCloture(numero),
          };
      case 'client.lien_suivi':
        return {
          sujet: `Suivi de votre réclamation ${numero}`,
          corps: `${bonjour}Voici le lien de suivi de votre réclamation ${numero} :\n${lien}\n`
            + `Il montre ses étapes ; pour le détail, un code vous est envoyé à vos coordonnées.${signature}`,
          sms: `${banque} : suivi de votre réclamation ${numero} : ${lien}`,
          fil: `Suivi de votre reclamation ${numero} : ${lien}`,
        };
      case 'client.rattachement': {
        const p = principale ?? { numero, lien };
        return {
          sujet: `Réclamation ${numero} jointe à ${p.numero}`,
          corps: `${bonjour}Votre réclamation ${numero} porte sur le même sujet que votre réclamation ${p.numero}, déjà en cours : `
            + `nous l'y avons jointe, pour la traiter en une seule fois.\nSuivez-la ici : ${p.lien}${signature}`,
          sms: `${banque} : votre réclamation ${numero} est jointe à ${p.numero}, déjà en cours. Suivi : ${p.lien}`,
          fil: `Votre reclamation ${numero} est jointe a ${p.numero}, deja en cours. Suivi : ${p.lien}`,
        };
      }
    }
  }

  // ---- Personnel de la banque ------------------------------------------------

  /**
   * E-mail + in-app pour chaque destinataire. Avec `unique`, une clé de déduplication garantit
   * qu'une même alerte ne part qu'une fois par destinataire et par canal (§6.4).
   */
  async personnel(modele: ModelePersonnel, destinataires: readonly Destinataire[], unique = false, precision?: string): Promise<void> {
    if (destinataires.length === 0) return;
    const texte = this.textePersonnel(modele, precision);
    await this.tx.notification.createMany({
      data: destinataires.flatMap((d) => (['EMAIL', 'IN_APP'] as const).map((canal) => ({
        tenantId: this.ticket.tenantId,
        canal,
        modele,
        destinataireUtilisateurId: d.id,
        destination: canal === 'EMAIL' ? d.email : null,
        reclamationId: this.ticket.id,
        sujet: texte.sujet,
        contenu: texte.corps,
        cleDeduplication: unique ? `${modele}:${this.ticket.id}:${d.id}:${canal}` : null,
      }))),
      skipDuplicates: true,
    });
  }

  private textePersonnel(modele: ModelePersonnel, precision?: string): Texte {
    const { numero, categorieNom } = this.ticket;
    const echeance = this.date(this.ticket.echeanceSlaLe);
    switch (modele) {
      case 'agent.assignation':
        return { sujet: `${numero} vous est assignée`, corps: `La réclamation ${numero} (${categorieNom}) vous est assignée. Échéance : ${echeance}.` };
      case 'agent.message_client':
        return { sujet: `${numero} : réponse du client`, corps: `Le client a écrit sur la réclamation ${numero}.` };
      case 'agent.contestation':
        return { sujet: `${numero} : résolution contestée`, corps: `Le client conteste la résolution de la réclamation ${numero}. Le ticket revient en cours, échéance : ${echeance}.` };
      case 'sla.alerte_preventive':
        return { sujet: `${numero} : échéance proche`, corps: `Réclamation ${numero} (${categorieNom}) : ${precision ?? 'seuil d\'alerte atteint'}, échéance ${echeance}.` };
      case 'sla.depassement':
        return { sujet: `${numero} : délai dépassé`, corps: `Réclamation ${numero} (${categorieNom}) : délai dépassé (échéance ${echeance}). Escaladée au superviseur.` };
      case 'reclamation.urgente':
        return { sujet: `Réclamation urgente ${numero}`, corps: `Réclamation urgente ${numero} (${categorieNom}), ${this.date(this.maintenant)}.` };
      case 'superviseur.escalade':
        return { sujet: `${numero} escaladée`, corps: `La réclamation ${numero} (${categorieNom}) vous est escaladée${precision ? ` par ${precision}` : ''}.` };
      case 'admin.escalade':
        return {
          sujet: `${numero} : retard important`,
          corps: `Réclamation ${numero} (${categorieNom}) toujours en retard : ${precision ?? 'seuil'} du délai cible atteint (échéance ${echeance}). Escaladée à l'Admin Entreprise.`,
        };
    }
  }

  // ---- Plateforme (Super Admin) : métadonnées seulement, arbitrage 7 --------

  /** Écrit en contexte système dans la même transaction, puis revient au contexte de la banque. */
  async plateforme(modele: ModelePlateforme, contenu: string, cle: string): Promise<void> {
    await basculer(this.tx, contexte.systeme());
    try {
      const superAdmins = await this.tx.utilisateur.findMany({
        where: { role: 'SUPER_ADMIN', statut: 'ACTIF' }, select: { id: true, email: true },
      });
      if (superAdmins.length === 0) return;
      await this.tx.notification.createMany({
        data: superAdmins.flatMap((sa) => (['EMAIL', 'IN_APP'] as const).map((canal) => ({
          tenantId: null,
          canal,
          modele,
          destinataireUtilisateurId: sa.id,
          destination: canal === 'EMAIL' ? sa.email : null,
          sujet: modele === 'plateforme.urgente' ? 'Réclamation urgente' : 'Plafond de tickets dépassé',
          contenu,
          cleDeduplication: `${cle}:${sa.id}:${canal}`,
        }))),
        skipDuplicates: true,
      });
    } finally {
      await basculer(this.tx, contexte.banque(this.ticket.tenantId));
    }
  }

  /** Alerte urgente (§6.4) : agent assigné, superviseur, Admin Entreprise, Super Admin. */
  async alerteUrgente(destinataires: readonly Destinataire[]): Promise<void> {
    await this.personnel('reclamation.urgente', destinataires, true);
    const heure = DateTime.fromJSDate(this.maintenant, { zone: this.p.banque.fuseauHoraire }).toFormat('dd/MM/yyyy HH:mm');
    await this.plateforme('plateforme.urgente', `${this.p.banque.nom} · ${this.ticket.numero} · ${this.ticket.categorieNom} · ${heure}`, `urgente:${this.ticket.id}`);
  }
}

// ---- Qui prévenir --------------------------------------------------------------

const ACTIF = { statut: 'ACTIF' } as const;
const CHAMPS = { id: true, email: true, nom: true, prenom: true } as const;
const versDestinataire = (u: { id: string; email: string; nom: string; prenom: string }): Destinataire =>
  ({ id: u.id, email: u.email, libelle: `${u.prenom} ${u.nom}` });

export async function agent(tx: ClientTransaction, agentId: string | null): Promise<Destinataire[]> {
  if (!agentId) return [];
  const u = await tx.utilisateur.findFirst({ where: { id: agentId, ...ACTIF }, select: CHAMPS });
  return u ? [versDestinataire(u)] : [];
}

/** Le superviseur de l'agent ; à défaut (ticket non assigné, agent sans équipe), tous les superviseurs. */
export async function superviseurs(tx: ClientTransaction, agentId: string | null): Promise<Destinataire[]> {
  if (agentId) {
    const a = await tx.utilisateur.findFirst({ where: { id: agentId }, select: { superviseurId: true } });
    if (a?.superviseurId) {
      const s = await tx.utilisateur.findFirst({ where: { id: a.superviseurId, ...ACTIF }, select: CHAMPS });
      if (s) return [versDestinataire(s)];
    }
  }
  return (await tx.utilisateur.findMany({ where: { role: 'SUPERVISEUR', ...ACTIF }, select: CHAMPS })).map(versDestinataire);
}

export async function adminsEntreprise(tx: ClientTransaction): Promise<Destinataire[]> {
  return (await tx.utilisateur.findMany({ where: { role: 'ADMIN_ENTREPRISE', ...ACTIF }, select: CHAMPS })).map(versDestinataire);
}
