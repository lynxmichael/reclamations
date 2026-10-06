/**
 * WhatsApp Business et SMS entrant (étape 20, décisions I1, I2 et I7 de l'étape 14).
 *
 * Un message reçu au numéro d'une banque :
 *   1. routage : le numéro (phone_number_id chez Meta, numéro de réception SMS) désigne la banque ;
 *      un numéro inconnu, un canal que Makor n'a pas ouvert ou une banque suspendue : ignoré ;
 *   2. verrou par client (Redis) : ses messages se traitent un à un, dans l'ordre ;
 *   3. dédoublonnage : Meta et la passerelle réessaient, chaque message ne se traite qu'une fois
 *      (message_entrant ; effacé si le traitement échoue, pour que l'essai suivant le reprenne) ;
 *   4. décision (domaine/canaux.ts) : rattacher à sa réclamation, confirmer ou contester une
 *      résolution, préparer un dépôt, avec l'assistant IA (étape 18) s'il est ouvert, qui ne fait
 *      que trier, comme sur le portail ;
 *   5. action par le cycle de vie (mêmes règles, même journal que le portail), pièces jointes
 *      téléchargées chez Meta et contrôlées comme au dépôt ;
 *   6. réponses automatiques en boîte d'envoi (20 par client et par jour), session enregistrée.
 *
 * Statuts WhatsApp : remise, lecture (« Lu » dans la boîte de réception), facturation déclarée par
 * Meta ; un échec fait prévenir le client autrement (boîte d'envoi, apresEchecWhatsapp).
 */
import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { DateTime } from 'luxon';
import type { Prisma } from '../../generated/prisma/client.js';
import { MoteurIa } from '../../application/ia/moteur.js';
import { CycleDeVie, type FichierStocke } from '../../application/reclamations/cycle-de-vie.js';
import { ErreurMetier } from '../../application/reclamations/erreurs.js';
import type { FilClient } from '../../application/reclamations/conversations.js';
import { messageSurFil } from '../../application/reclamations/notifications.js';
import { chargerParametres } from '../../application/reclamations/parametres.js';
import { CONFIGURATION, urlPortail, type Configuration } from '../../configuration/configuration.js';
import {
  DUREE_SESSION_MS, finFenetre, nomValide, REPONSES_AUTO_PAR_JOUR, SESSION_VIDE, TEXTES_CANAL, traiter,
  type CanalMessagerie, type DonneesSession, type EntreeCanal, type EtapeSession, type Issue, type MediaRecu, type Session,
} from '../../domaine/canaux.js';
import { disponibilite } from '../../domaine/conversation.js';
import { decisionParRegles, texteReprise, TEXTES, type Decision } from '../../domaine/ia/assistant.js';
import { consignesTri } from '../../domaine/ia/consignes.js';
import { demandeHumain } from '../../domaine/ia/interdits.js';
import { masquer, mentionneCodeSecret } from '../../domaine/ia/masquage.js';
import type { Acteur } from '../../domaine/reclamation/machine.js';
import { BaseDonnees } from '../../infrastructure/base-de-donnees/base-de-donnees.service.js';
import { enSerie } from '../../infrastructure/base-de-donnees/index.js';
import { lireSmsEntrant } from '../../infrastructure/canaux/sms-entrant.js';
import { lireWebhookWhatsapp, signatureValide, type AdaptateurWhatsapp, type StatutWhatsapp } from '../../infrastructure/canaux/whatsapp.js';
import { lireRemiseSms } from '../../infrastructure/canaux/remise-sms.js';
import { MOTIF_DE_REMISE } from '../../domaine/envois.js';
import { signalerNonRemis } from '../../application/reclamations/envois.js';
import type { FichierRecu } from '../../infrastructure/contrat/appel.js';
import { interdit, Probleme } from '../../infrastructure/contrat/probleme.js';
import { apresEchecWhatsapp } from '../../infrastructure/envois/boite-envoi.js';
import { MAX_FICHIERS, MAX_OCTETS, nomPropre, TYPES_PIECES, typeReel } from '../../infrastructure/fichiers/fichiers.js';
import { ServiceRedis } from '../../infrastructure/redis/redis.service.js';
import { LIMITES, Limiteur } from '../../infrastructure/securite/limiteur.js';
import { dechiffrer } from '../../infrastructure/securite/totp.js';
import { ANTIVIRUS, ErreurAntivirus, type Antivirus } from '../../infrastructure/fichiers/antivirus.js';
import { TYPE_DOCX } from '../../infrastructure/fichiers/word.js';
import { STOCKAGE, type Stockage } from '../../infrastructure/stockage/stockage.js';
import { HORLOGE, type Horloge } from '../../noyau/noyau.module.js';
import { baseDeReponses } from '../assistant/assistant.service.js';
import { avecFichiers, stockerPiecesJointes, type S } from '../commun.js';
import { VERSION_POLITIQUE } from '../public/public.service.js';

export const ADAPTATEUR_WHATSAPP = Symbol('ADAPTATEUR_WHATSAPP');

/** Un message reçu, WhatsApp ou SMS, une fois lu. */
export interface MessageCanal {
  readonly canal: CanalMessagerie;
  readonly idExterne: string;
  /** Numéro de la banque : phone_number_id (WhatsApp) ou numéro de réception (SMS) */
  readonly identifiant: string;
  /** Numéro du client, E.164 */
  readonly de: string;
  readonly nomProfil: string | null;
  readonly recuLe: Date;
  readonly nature: 'lisible' | 'autre' | 'ignore';
  readonly texte: string;
  readonly medias: readonly MediaRecu[];
}

export type IssueReception = 'TRAITE' | 'DOUBLON' | 'INCONNU' | 'FERME' | 'IGNORE';

type IssueMessage = 'RATTACHE' | 'CONFIRMATION' | 'DEPOT' | 'ASSISTANT' | 'CHOIX' | 'NON_PRIS_EN_CHARGE' | 'LIMITE';

interface Route {
  readonly tenantId: string;
  readonly pointDepotId: string;
  readonly numero: string;
  readonly jetonChiffre: string | null;
}

/** Verrou d'un client : un message au plus en traitement ; au-delà de 15 s d'attente, Meta réessaiera. */
const VERROU_MS = 60_000;
const ATTENTE_VERROU_MS = 15_000;
const STATUTS_CLIENT = ['OUVERTE', 'EN_COURS', 'EN_ATTENTE_CLIENT', 'RESOLUE'] as const;
const EXTENSIONS: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf', [TYPE_DOCX]: 'docx' };

@Injectable()
export class ServiceCanaux {
  private readonly journal = new Logger('Canaux');

  constructor(
    @Inject(BaseDonnees) private readonly bd: BaseDonnees,
    @Inject(CycleDeVie) private readonly cycle: CycleDeVie,
    @Inject(MoteurIa) private readonly moteur: MoteurIa,
    @Inject(Limiteur) private readonly limiteur: Limiteur,
    @Inject(ServiceRedis) private readonly redis: ServiceRedis,
    @Inject(STOCKAGE) private readonly stockage: Stockage,
    @Inject(ANTIVIRUS) private readonly antivirus: Antivirus,
    @Inject(ADAPTATEUR_WHATSAPP) private readonly whatsapp: AdaptateurWhatsapp,
    @Inject(CONFIGURATION) private readonly config: Configuration,
    @Inject(HORLOGE) private readonly horloge: Horloge,
  ) {}

  // ---- Webhooks ------------------------------------------------------------------------

  /** Abonnement de l'adresse par Meta : le défi, si le jeton de vérification est le bon. */
  verifierWebhook(requete: Record<string, unknown>): string {
    const attendu = this.config.whatsapp.jetonVerification;
    if (!attendu || requete['hub.mode'] !== 'subscribe' || requete['hub.verify_token'] !== attendu) throw interdit();
    return String(requete['hub.challenge']);
  }

  async webhookWhatsapp(corpsBrut: Buffer | undefined, signature: string | undefined, corps: unknown): Promise<{ recu: true }> {
    if (!signatureValide(corpsBrut, signature, this.config.whatsapp.secretApp)) {
      throw new Probleme(401, 'SIGNATURE_INVALIDE', 'Signature du webhook absente ou fausse');
    }
    const { messages, statuts } = lireWebhookWhatsapp(corps, this.horloge());
    // Un à un : une erreur répond 500, Meta renvoie tout le lot, et ce qui est fait n'est pas refait
    for (const m of messages) {
      await this.recevoir({
        canal: 'WHATSAPP', idExterne: m.idExterne, identifiant: m.phoneNumberId, de: m.de, nomProfil: m.nomProfil,
        recuLe: m.recuLe, nature: m.nature, texte: m.texte, medias: m.medias,
      });
    }
    for (const s of statuts) await this.statut(s);
    return { recu: true };
  }

  async webhookSms(corpsBrut: Buffer | undefined, signature: string | undefined, corps: Record<string, unknown>): Promise<{ recu: true }> {
    if (!signatureValide(corpsBrut, signature, this.config.smsEntrantSecret)) {
      throw new Probleme(401, 'SIGNATURE_INVALIDE', 'Signature absente ou fausse');
    }
    const sms = lireSmsEntrant(corps as unknown as S<'SmsEntrant'>, this.horloge());
    if (!sms) {
      this.journal.warn('SMS entrant ignoré : numéro illisible');
      return { recu: true };
    }
    await this.recevoir({
      canal: 'SMS', idExterne: sms.idExterne, identifiant: sms.vers, de: sms.de, nomProfil: null, recuLe: sms.recuLe,
      nature: sms.texte.trim() ? 'lisible' : 'ignore', texte: sms.texte, medias: [],
    });
    return { recu: true };
  }

  /**
   * Étape 22 : accusé de remise d'un SMS envoyé. REMIS : le SMS est remis ; NON_REMIS, EXPIRE, REJETE :
   * il ne l'est pas, avec son motif, et l'agent est prévenu. Seul un SMS en attente ou envoyé change :
   * un accusé tardif ou en double ne revient pas sur un état final.
   */
  async webhookRemiseSms(corpsBrut: Buffer | undefined, signature: string | undefined, corps: Record<string, unknown>): Promise<{ recu: true }> {
    if (!signatureValide(corpsBrut, signature, this.config.smsEntrantSecret)) {
      throw new Probleme(401, 'SIGNATURE_INVALIDE', 'Signature absente ou fausse');
    }
    const maintenant = this.horloge();
    const r = lireRemiseSms(corps as unknown as Parameters<typeof lireRemiseSms>[0], maintenant);
    const statut = r.statut;
    if (statut === 'EN_COURS' || (!r.reference && !r.id)) return { recu: true };
    const nonRemis = await this.bd.enSysteme(async (tx) => {
      const n = await tx.notification.findFirst({
        where: { canal: 'SMS', OR: [...(r.reference ? [{ id: r.reference }] : []), ...(r.id ? [{ idFournisseur: r.id }] : [])] },
      });
      if (!n || (n.statut !== 'EN_ATTENTE' && n.statut !== 'ENVOYEE')) return null;
      if (statut === 'REMIS') {
        await tx.notification.update({ where: { id: n.id }, data: { statut: 'DELIVREE', remiseLe: r.recuLe } });
        return null;
      }
      const motif = MOTIF_DE_REMISE[statut];
      await tx.notification.update({
        where: { id: n.id },
        data: { statut: 'ECHEC', motifEchec: motif, prochaineTentativeLe: null, derniereErreur: `Accusé de remise : ${r.statut}${r.code ? ` (${r.code})` : ''}` },
      });
      return { ...n, motifEchec: motif };
    });
    if (nonRemis) await signalerNonRemis(this.bd, nonRemis, maintenant);
    return { recu: true };
  }

  // ---- Réception d'un message ---------------------------------------------------------------

  async recevoir(m: MessageCanal): Promise<IssueReception> {
    const lu = await this.bd.enSysteme((tx) => tx.canalBanque.findUnique({
      where: { canal_identifiant: { canal: m.canal, identifiant: m.identifiant } },
      select: {
        tenantId: true, pointDepotId: true, numero: true, jetonChiffre: true,
        banque: { select: { whatsapp: true, smsEntrant: true, chatWeb: true, suspendueLe: true } },
      },
    }));
    if (!lu) {
      this.journal.warn(`${m.canal} : message pour un numéro raccordé à aucune banque, ignoré`);
      return 'INCONNU';
    }
    const b = lu.banque;
    if (!(m.canal === 'WHATSAPP' ? b.whatsapp : b.smsEntrant) || !b.chatWeb || b.suspendueLe) return 'FERME';
    if (m.nature === 'ignore') return 'IGNORE';
    const route: Route = { tenantId: lu.tenantId, pointDepotId: lu.pointDepotId, numero: lu.numero, jetonChiffre: lu.jetonChiffre };

    return this.verrou(`${route.tenantId}:${m.canal}:${m.de}`, async () => {
      const idExterne = m.idExterne.slice(0, 160);
      const reserve = await this.bd.enBanque(route.tenantId, (tx) => tx.messageEntrant.createMany({
        data: [{ tenantId: route.tenantId, canal: m.canal, idExterne, issue: 'EN_COURS', recuLe: m.recuLe }],
        skipDuplicates: true,
      }));
      if (reserve.count === 0) return 'DOUBLON';
      try {
        const { issue, commentaireId } = await this.traiterMessage(route, m);
        await this.bd.enBanque(route.tenantId, (tx) => tx.messageEntrant.update({
          where: { canal_idExterne: { canal: m.canal, idExterne } }, data: { issue, commentaireId },
        }));
        return 'TRAITE';
      } catch (e) {
        // Le prochain essai de Meta ou de la passerelle reprendra ce message
        await this.bd.enSysteme((tx) => tx.messageEntrant.deleteMany({ where: { canal: m.canal, idExterne } })).catch(() => undefined);
        throw e;
      }
    });
  }

  private async traiterMessage(route: Route, m: MessageCanal): Promise<{ issue: IssueMessage; commentaireId: string | null }> {
    const maintenant = this.horloge();
    const { tenantId } = route;
    const ctx = await this.bd.enBanque(tenantId, async (tx) => {
      const p = await chargerParametres(tx, tenantId);
      const [client, sessionLue, base] = await enSerie([
        () => tx.clientFinal.findFirst({ where: { telephone: m.de }, select: { id: true, nom: true } }),
        () => tx.sessionCanal.findUnique({ where: { tenantId_canal_telephone: { tenantId, canal: m.canal, telephone: m.de } } }),
        () => baseDeReponses(tx),
      ]);
      // Réclamations où il peut encore écrire, ou confirmer et contester : les plus récentes d'abord
      const reclamations = client
        ? await tx.reclamation.findMany({
          where: { clientId: client.id, statut: { in: [...STATUTS_CLIENT] } },
          orderBy: [{ creeLe: 'desc' }, { id: 'desc' }], take: 9,
          select: { id: true, numero: true, statut: true, categorie: { select: { nom: true } } },
        })
        : [];
      return { p, client, sessionLue, base, reclamations };
    });
    const { p, client, sessionLue, base } = ctx;
    const fuseau = p.banque.fuseauHoraire;
    const jour = DateTime.fromJSDate(maintenant, { zone: fuseau }).toISODate()!;
    const active = sessionLue && sessionLue.dernierMessageLe.getTime() > maintenant.getTime() - DUREE_SESSION_MS;
    const session: Session = active
      ? { etape: sessionLue.etape as EtapeSession, reclamationId: sessionLue.reclamationId, donnees: (sessionLue.donnees ?? {}) as DonneesSession }
      : SESSION_VIDE;
    const dejaEnvoyees = sessionLue?.jourReponsesAuto === jour ? sessionLue.reponsesAuto : 0;
    const d = disponibilite(maintenant, p.sla.calendrier);
    const reprise = d.repriseLe ? texteReprise(d.repriseLe, maintenant, fuseau) : null;
    const fil: FilClient = m.canal === 'WHATSAPP'
      ? { canal: 'WHATSAPP', finFenetreLe: finFenetre(maintenant), expediteur: null }
      : { canal: 'SMS', finFenetreLe: null, expediteur: route.numero };

    // ---- Décision ----
    let issue: Issue;
    if (m.nature === 'autre') {
      issue = { action: { type: 'AUCUNE' }, reponses: [TEXTES_CANAL.NON_PRIS_EN_CHARGE], session, issue: 'RATTACHE' };
    } else {
      const entree: EntreeCanal = {
        canal: m.canal,
        texte: m.texte.slice(0, 4000),
        medias: m.medias,
        session,
        reclamations: ctx.reclamations.map((r) => ({ id: r.id, numero: r.numero, categorie: r.categorie.nom, statut: r.statut as (typeof STATUTS_CLIENT)[number] })),
        categories: base.categories,
        faq: base.faq,
        assistant: p.banque.assistantIa,
        nomConnu: !!client || !!nomValide(m.nomProfil ?? ''),
        banque: p.banque.nom,
        lienPolitique: `${urlPortail(this.config, p.banque.slug)}/politique-donnees`,
        reprise,
      };
      const premier = traiter(entree);
      if ('decisionRequise' in premier && premier.decisionRequise) {
        const decision = await this.trier(tenantId, premier.echanges, { banque: p.banque.nom, ...base }, m.texte);
        const second = traiter(entree, decision);
        issue = 'decisionRequise' in second && second.decisionRequise ? (traiter(entree, decisionParRegles(premier.echanges, base)) as Issue) : (second as Issue);
      } else {
        issue = premier as Issue;
      }
    }
    const nonPrisEnCharge = m.nature === 'autre';

    // ---- Action ----
    const acteur: Acteur | null = client ? { type: 'CLIENT', clientId: client.id } : null;
    let resultat: IssueMessage = nonPrisEnCharge ? 'NON_PRIS_EN_CHARGE' : issue.issue;
    let commentaireId: string | null = null;
    let sessionApres: Session = issue.session;
    let reponses: string[] = [...issue.reponses];
    if (!nonPrisEnCharge && (masquer(m.texte).codeSecret || mentionneCodeSecret(m.texte))) reponses.unshift(TEXTES.CODE_SECRET);
    try {
      const a = issue.action;
      switch (a.type) {
        case 'RATTACHER': {
          await this.limiteur.consommer(LIMITES.messagesClient, `${tenantId}:${a.reclamationId}`, 'Trop de messages en peu de temps : patientez quelques minutes.');
          const pj = await this.medias(route, m.canal, a.medias, maintenant);
          if (pj.refuses) reponses.push(TEXTES_CANAL.FICHIER_REFUSE);
          const contenu = a.texte || (pj.fichiers.length > 1 ? `${pj.fichiers.length} pièces jointes envoyées sur WhatsApp` : pj.fichiers.length ? 'Pièce jointe envoyée sur WhatsApp' : '');
          if (!contenu) {
            resultat = 'NON_PRIS_EN_CHARGE';
            break;
          }
          const r = await avecFichiers(pj.annuler, () => this.cycle.messageDuClient(tenantId, a.reclamationId, acteur!, contenu, undefined, pj.fichiers, m.canal));
          commentaireId = r?.commentaireId ?? null;
          break;
        }
        case 'CONFIRMER':
          await this.cycle.confirmer(tenantId, a.reclamationId, acteur!, undefined, m.canal);
          break;
        case 'CONTESTER':
          commentaireId = (await this.cycle.contester(tenantId, a.reclamationId, acteur!, a.motif, undefined, m.canal))?.commentaireId ?? null;
          break;
        case 'DEPOSER': {
          await this.limiteur.consommer(LIMITES.depotParTelephone, `${tenantId}:${m.de}`, 'Trop de réclamations pour ce numéro : réessayez dans une heure.');
          const pj = await this.medias(route, m.canal, a.medias, maintenant);
          if (pj.refuses) reponses.push(TEXTES_CANAL.FICHIER_REFUSE);
          const nom = a.nom ?? client?.nom ?? nomValide(m.nomProfil ?? '') ?? `Client ${m.canal === 'WHATSAPP' ? 'WhatsApp' : 'SMS'}`;
          // Le client a envoyé la réclamation en répondant OUI, après le lien de la politique de données
          const accuse = await avecFichiers(pj.annuler, () => this.cycle.deposer({
            tenantId, pointDepotId: route.pointDepotId, categorieId: a.categorieId, description: a.description,
            client: { nom, telephone: m.de }, consentementVersion: VERSION_POLITIQUE, fichiers: pj.fichiers,
          }));
          sessionApres = { etape: 'LIBRE', reclamationId: accuse.id, donnees: { accueilli: accuse.id } };
          break;
        }
        case 'AUCUNE':
          break;
      }
    } catch (e) {
      // Statut changé entre-temps, limite de débit : le client le lit, rien n'est rejoué
      if (!(e instanceof ErreurMetier) && !(e instanceof Probleme)) throw e;
      this.journal.warn(`${m.canal} : action ${issue.action.type} refusée (${e.code})`);
      resultat = 'NON_PRIS_EN_CHARGE';
      commentaireId = null;
      sessionApres = SESSION_VIDE;
      reponses = [e instanceof Probleme && e.status === 429 ? e.message : TEXTES_CANAL.ERREUR];
    }

    // ---- Réponses automatiques (plafond du jour) et session ----
    const permises = Math.max(0, REPONSES_AUTO_PAR_JOUR - dejaEnvoyees);
    const envoyees = reponses.slice(0, permises);
    if (envoyees.length < reponses.length && issue.action.type === 'AUCUNE' && resultat !== 'NON_PRIS_EN_CHARGE') {
      // Plafond atteint : le dialogue n'avance plus sans réponse
      resultat = 'LIMITE';
      sessionApres = session;
    }
    const donnees = sessionApres.donnees as Prisma.InputJsonValue;
    await this.bd.enBanque(tenantId, async (tx) => {
      for (const texte of envoyees) {
        await messageSurFil(tx, {
          tenantId, fil, destination: m.de, texte, modele: 'canal.reponse_auto',
          clientId: client?.id ?? null, reclamationId: sessionApres.reclamationId,
        });
      }
      const champs = {
        etape: sessionApres.etape, reclamationId: sessionApres.reclamationId, donnees,
        dernierMessageLe: maintenant, reponsesAuto: dejaEnvoyees + envoyees.length, jourReponsesAuto: jour,
      };
      await tx.sessionCanal.upsert({
        where: { tenantId_canal_telephone: { tenantId, canal: m.canal, telephone: m.de } },
        create: { tenantId, canal: m.canal, telephone: m.de, ...champs },
        update: champs,
      });
    });
    return { issue: resultat === 'RATTACHE' && !commentaireId ? 'NON_PRIS_EN_CHARGE' : resultat, commentaireId };
  }

  /** Tri de l'assistant (étape 18) : IA sur les messages masqués, ou règles ; « conseiller » transfère toujours. */
  private async trier(tenantId: string, echanges: Parameters<typeof decisionParRegles>[0], ctx: Parameters<typeof consignesTri>[1], texte: string): Promise<Decision> {
    const humain = demandeHumain(texte);
    const pourIa = echanges.map((e) => (e.auteur === 'CLIENT' ? { ...e, texte: masquer(e.texte).texte } : e));
    const { resultat } = await this.moteur.demander(tenantId, 'ACCUEIL_PORTAIL', humain ? null : consignesTri(pourIa, ctx), () => decisionParRegles(echanges, ctx));
    return humain ? { ...resultat, intention: 'CONSEILLER' } : resultat;
  }

  /**
   * Pièces jointes d'un message WhatsApp : téléchargées chez Meta avec le jeton de la banque, puis
   * contrôlées comme au dépôt (type reconnu au contenu, 10 Mo, 5 au plus, antivirus : étape 22). Un
   * fichier refusé n'empêche pas le reste du message.
   */
  private async medias(route: Route, canal: CanalMessagerie, medias: readonly MediaRecu[], maintenant: Date) {
    const rien = { fichiers: [] as FichierStocke[], refuses: 0, annuler: async () => undefined };
    if (!medias.length) return rien;
    if (canal !== 'WHATSAPP' || !route.jetonChiffre || !this.config.cleCanaux.length) return { ...rien, refuses: medias.length };
    const jeton = dechiffrer(this.config.cleCanaux, route.jetonChiffre);
    const recus: FichierRecu[] = [];
    let refuses = Math.max(0, medias.length - MAX_FICHIERS);
    for (const [i, media] of medias.slice(0, MAX_FICHIERS).entries()) {
      try {
        const t = await this.whatsapp.telecharger(media.id, jeton, MAX_OCTETS);
        const type = typeReel(t.contenu);
        if (!type || !(TYPES_PIECES as readonly string[]).includes(type)) {
          refuses++;
          continue;
        }
        // Étape 22 : un fichier infecté est écarté ; antivirus injoignable, il sera analysé par le worker
        const analyse = await this.antivirus.analyser(t.contenu).catch((x: unknown) => {
          if (x instanceof ErreurAntivirus) return null;
          throw x;
        });
        if (analyse && !analyse.sain) {
          refuses++;
          continue;
        }
        recus.push({ champ: 'fichiers', nomOriginal: nomPropre(media.nom ?? `whatsapp-${i + 1}.${EXTENSIONS[type]}`), taille: t.contenu.length, contenu: t.contenu });
      } catch (e) {
        refuses++;
        this.journal.warn(`WhatsApp : média non téléchargé (${(e as Error).message.slice(0, 200)})`);
      }
    }
    if (!recus.length) return { ...rien, refuses };
    const { fichiers, annuler } = await stockerPiecesJointes(this.stockage, this.antivirus, route.tenantId, recus, maintenant);
    return { fichiers, refuses, annuler };
  }

  // ---- Statuts des envois WhatsApp --------------------------------------------------------

  async statut(s: StatutWhatsapp): Promise<void> {
    await this.bd.enSysteme(async (tx) => {
      const n = await tx.notification.findFirst({ where: { canal: 'WHATSAPP', idFournisseur: s.idExterne } });
      if (!n) return;
      const data: Prisma.NotificationUpdateInput = {};
      if (s.facturable !== null) data.facturable = s.facturable;
      if (s.categorie) data.categorieTarif = s.categorie;
      if ((s.statut === 'delivered' || s.statut === 'read') && n.statut === 'ENVOYEE') data.statut = 'DELIVREE';
      // Étape 22 : l'heure de la remise, montrée sur la fiche
      if ((s.statut === 'delivered' || s.statut === 'read') && !n.remiseLe) data.remiseLe = s.date;
      if (s.statut === 'read' && !n.lueLe) data.lueLe = s.date;
      const echec = s.statut === 'failed' && n.statut !== 'ECHEC';
      if (echec) Object.assign(data, { statut: 'ECHEC', motifEchec: 'WHATSAPP_INDISPONIBLE', derniereErreur: (s.erreur ?? 'Message non remis par WhatsApp').slice(0, 500) });
      if (Object.keys(data).length) await tx.notification.update({ where: { id: n.id }, data });
      // Le client a lu la réponse de l'agent sur WhatsApp : « Lu » dans la boîte de réception
      if (s.statut === 'read' && n.modele === 'conversation.reponse' && n.tenantId && n.reclamationId) {
        await tx.conversation.updateMany({
          where: { tenantId: n.tenantId, reclamationId: n.reclamationId, OR: [{ luClientLe: null }, { luClientLe: { lt: s.date } }] },
          data: { luClientLe: s.date },
        });
      }
      if (echec) await apresEchecWhatsapp(tx, n);
    });
  }

  // ---- Verrou par client ------------------------------------------------------------------

  /** Sans Redis, le traitement continue sans verrou (le dédoublonnage reste assuré par la base). */
  private async verrou<T>(cle: string, travail: () => Promise<T>): Promise<T> {
    const k = `canal:verrou:${createHash('sha256').update(cle).digest('hex').slice(0, 32)}`;
    const jeton = randomUUID();
    const limite = Date.now() + ATTENTE_VERROU_MS;
    let detenu = false;
    for (;;) {
      try {
        detenu = (await this.redis.client.set(k, jeton, 'PX', VERROU_MS, 'NX')) === 'OK';
      } catch (e) {
        this.journal.warn(`Verrou non pris (Redis) : ${(e as Error).message}`);
        return travail();
      }
      if (detenu) break;
      if (Date.now() > limite) throw new Error('Message du même client encore en traitement : nouvel essai attendu');
      await new Promise((ok) => setTimeout(ok, 100));
    }
    try {
      return await travail();
    } finally {
      // Ne libère que son propre verrou
      await this.redis.client.eval('if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end', 1, k, jeton)
        .catch(() => undefined);
    }
  }
}
