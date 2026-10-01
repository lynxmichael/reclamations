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
import type { ParametresBanque } from './parametres.js';

export type ModeleClient = 'client.depot' | 'client.statut' | 'client.reponse' | 'client.question' | 'client.resolution' | 'client.cloture';
export type ModelePersonnel =
  | 'agent.assignation' | 'agent.message_client' | 'agent.contestation'
  | 'sla.alerte_preventive' | 'sla.depassement' | 'reclamation.urgente' | 'superviseur.escalade';
export type ModelePlateforme = 'plateforme.urgente' | 'plateforme.plafond';

/**
 * Le SMS part toujours au dépôt et à la résolution ; aux autres changements de statut, selon l'option de
 * la banque, activée par défaut (décision du 01/10/2026 : un SMS à chaque changement de statut).
 */
const SMS_TOUJOURS: readonly ModeleClient[] = ['client.depot', 'client.resolution'];

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

  async client(modele: ModeleClient): Promise<void> {
    const client = await this.tx.clientFinal.findUniqueOrThrow({ where: { id: this.ticket.clientId } });
    const texte = this.texteClient(modele, client.nom);
    const lignes: { canal: CanalNotification; destination: string; sujet: string | null; contenu: string }[] = [];
    if (client.email) lignes.push({ canal: 'EMAIL', destination: client.email, sujet: texte.sujet, contenu: texte.corps });
    if (client.telephone && (SMS_TOUJOURS.includes(modele) || this.p.banque.smsChaqueChangementStatut)) {
      lignes.push({ canal: 'SMS', destination: client.telephone, sujet: null, contenu: texte.sms ?? texte.corps });
    }
    if (lignes.length === 0) return;
    await this.tx.notification.createMany({
      data: lignes.map((l) => ({
        ...l, tenantId: this.ticket.tenantId, modele, destinataireClientId: client.id, reclamationId: this.ticket.id,
      })),
    });
  }

  private texteClient(modele: ModeleClient, nom: string): Texte {
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
        };
      case 'client.statut':
        return {
          sujet: `Réclamation ${numero} en cours de traitement`,
          corps: `${bonjour}Votre réclamation ${numero} est prise en charge.\nSuivi : ${lien}${signature}`,
          sms: `${banque} : votre réclamation ${numero} est en cours de traitement.`,
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
        };
      case 'client.cloture':
        return {
          sujet: `Réclamation ${numero} clôturée`,
          corps: `${bonjour}Votre réclamation ${numero} est clôturée.\nHistorique : ${lien}${signature}`,
          sms: `${banque} : votre réclamation ${numero} est clôturée.`,
        };
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
