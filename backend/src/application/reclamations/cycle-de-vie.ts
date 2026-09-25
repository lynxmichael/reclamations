/**
 * Cycle de vie d'une réclamation (étape 4) : dépôt, traitement, clôture.
 *
 * Chaque action tient dans une transaction de la banque concernée :
 *   verrou du ticket → règles de la machine d'états → champs SLA → mise à jour →
 *   historique (reclamation_evenement) → notifications à envoyer → journal d'audit.
 * Tout réussit ou rien n'est écrit. L'horloge est injectable pour les tests.
 */
import { randomBytes } from 'node:crypto';
import { DateTime } from 'luxon';
import type { MotifClotureForcee, Priorite, StatutReclamation, TypeEvenement } from '../../generated/prisma/enums.js';
import type { Prisma, Reclamation } from '../../generated/prisma/client.js';
import { normaliserEmail, normaliserTelephone } from '../../domaine/contact.js';
import { verifierOperation, verifierTransition, type Acteur, type ActionStatut, type EtatTicket } from '../../domaine/reclamation/machine.js';
import { delaiPremiereReponse, slaALaReprise, slaALaResolution, slaAuDepot, slaEnPause } from '../../domaine/reclamation/sla.js';
import { contexte, transactionEn, type ClientBase, type ClientTransaction } from '../../infrastructure/base-de-donnees/index.js';
import { ErreurMetier, exiger, introuvable } from './erreurs.js';
import { adminsEntreprise, agent, Envois, superviseurs, type TicketNotifie } from './notifications.js';
import { chargerParametres, type ParametresBanque } from './parametres.js';

export interface OptionsCycleDeVie {
  /** Horloge ; remplacée dans les tests pour simuler le passage du temps */
  readonly horloge?: () => Date;
  /** Lien de suivi envoyé au client, ex. https://<slug>.<domaine>/suivi/<jeton> */
  readonly lienSuivi: (slugBanque: string, jetonSuivi: string) => string;
}

/** Adresse IP et navigateur de la requête, pour le journal d'audit. */
export interface Trace {
  readonly ip?: string;
  readonly userAgent?: string;
}

export interface EntreeDepot {
  readonly tenantId: string;
  readonly pointDepotId: string;
  readonly categorieId: string;
  readonly description: string;
  /** Agence choisie par le client quand le point de dépôt n'en a pas (lien web) */
  readonly agenceId?: string | null;
  readonly client: { readonly nom: string; readonly email?: string | null; readonly telephone?: string | null };
  readonly consentementVersion: string;
}

type Ticket = Reclamation & { categorie: { nom: string } };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Événements visibles dans la chronologie du client. */
const VISIBLES_CLIENT: ReadonlySet<TypeEvenement> = new Set<TypeEvenement>([
  'CREATION', 'PRISE_EN_CHARGE', 'QUESTION_AU_CLIENT', 'REPONSE_DU_CLIENT', 'RESOLUTION',
  'CONFIRMATION', 'CONTESTATION', 'CLOTURE_AUTOMATIQUE', 'CLOTURE_FORCEE',
]);

export class CycleDeVie {
  constructor(private readonly base: ClientBase, private readonly options: OptionsCycleDeVie) {}

  private maintenant(): Date {
    return this.options.horloge?.() ?? new Date();
  }

  // =========================================================================
  //  Dépôt (§6.1)
  // =========================================================================

  async deposer(entree: EntreeDepot, trace?: Trace) {
    const maintenant = this.maintenant();
    const description = entree.description.trim();
    if (!description) throw new ErreurMetier('DESCRIPTION_REQUISE', 'La description est obligatoire', 422);
    let email: string | null;
    let telephone: string | null;
    try {
      email = normaliserEmail(entree.client.email);
      telephone = normaliserTelephone(entree.client.telephone);
    } catch (e) {
      throw new ErreurMetier('CONTACT_INVALIDE', (e as Error).message, 422);
    }
    if (!email && !telephone) throw new ErreurMetier('CONTACT_REQUIS', 'Un e-mail ou un téléphone est obligatoire', 422);

    return transactionEn(this.base, contexte.banque(entree.tenantId), async (tx) => {
      const p = await chargerParametres(tx, entree.tenantId);
      if (p.banque.suspendueLe) throw new ErreurMetier('BANQUE_SUSPENDUE', 'Le portail de cette banque est suspendu', 403);
      const point = await tx.pointDepot.findFirst({ where: { id: entree.pointDepotId, actif: true } });
      if (!point) throw new ErreurMetier('POINT_DE_DEPOT_INACTIF', 'Point de dépôt inconnu ou désactivé', 422);
      const categorie = await tx.categorie.findFirst({ where: { id: entree.categorieId, active: true } });
      if (!categorie) throw new ErreurMetier('CATEGORIE_INVALIDE', 'Catégorie inconnue ou désactivée', 422);

      const client = await this.trouverOuCreerClient(tx, entree.tenantId, entree.client.nom.trim(), email, telephone);
      const numero = await this.prochainNumero(tx, p, maintenant);
      const jetonSuivi = randomBytes(24).toString('base64url');

      const reclamation = await tx.reclamation.create({
        data: {
          tenantId: entree.tenantId,
          numero,
          jetonSuivi,
          clientId: client.id,
          categorieId: categorie.id,
          pointDepotId: point.id,
          agenceId: point.agenceId ?? entree.agenceId ?? null,
          canal: point.canal,
          description,
          priorite: categorie.prioriteParDefaut,
          consentementLe: maintenant,
          consentementVersion: entree.consentementVersion,
          delaiCibleMinutes: categorie.delaiCibleMinutes,
          ...slaAuDepot(maintenant, categorie.delaiCibleMinutes, p.sla),
          creeLe: maintenant,
        },
        include: { categorie: { select: { nom: true } } },
      });

      const acteur: Acteur = { type: 'CLIENT', clientId: client.id };
      await this.evenement(tx, reclamation, 'CREATION', acteur, maintenant, { statutApres: 'OUVERTE' });
      const envois = this.envois(tx, reclamation, p, maintenant);
      await envois.client('client.depot');
      if (reclamation.priorite === 'URGENTE') {
        await envois.alerteUrgente([...(await superviseurs(tx, null)), ...(await adminsEntreprise(tx))]);
      }
      await this.signalerPlafond(tx, envois, p, maintenant);
      await this.auditer(tx, reclamation, acteur, 'reclamation.depot', { canal: point.canal, priorite: reclamation.priorite }, trace);

      return {
        id: reclamation.id,
        numero,
        jetonSuivi,
        lienSuivi: this.options.lienSuivi(p.banque.slug, jetonSuivi),
        priorite: reclamation.priorite,
        echeanceSlaLe: reclamation.echeanceSlaLe,
      };
    });
  }

  private async trouverOuCreerClient(tx: ClientTransaction, tenantId: string, nom: string, email: string | null, telephone: string | null) {
    const trouver = async () =>
      (email ? await tx.clientFinal.findFirst({ where: { email } }) : null)
      ?? (telephone ? await tx.clientFinal.findFirst({ where: { telephone } }) : null);
    let client = await trouver();
    if (!client) {
      // ON CONFLICT DO NOTHING : deux dépôts simultanés du même nouveau client ne s'annulent pas
      await tx.clientFinal.createMany({ data: [{ tenantId, nom, email, telephone }], skipDuplicates: true });
      client = await trouver();
      if (!client) throw new Error('Client introuvable après création');
    } else {
      // Compléter une coordonnée manquante, si elle n'appartient pas déjà à un autre client
      const complement: { email?: string; telephone?: string } = {};
      if (!client.email && email && !(await tx.clientFinal.findFirst({ where: { email } }))) complement.email = email;
      if (!client.telephone && telephone && !(await tx.clientFinal.findFirst({ where: { telephone } }))) complement.telephone = telephone;
      if (Object.keys(complement).length) client = await tx.clientFinal.update({ where: { id: client.id }, data: complement });
    }
    return client;
  }

  /** PRÉFIXE-AAAA-NNNNNN, séquentiel par banque et par année civile de la banque. */
  private async prochainNumero(tx: ClientTransaction, p: ParametresBanque, maintenant: Date): Promise<string> {
    const annee = DateTime.fromJSDate(maintenant, { zone: p.banque.fuseauHoraire }).year;
    const [{ dernier }] = await tx.$queryRaw<{ dernier: number }[]>`
      INSERT INTO compteur_numero (tenant_id, annee, dernier) VALUES (${p.banque.id}::uuid, ${annee}, 1)
      ON CONFLICT (tenant_id, annee) DO UPDATE SET dernier = compteur_numero.dernier + 1
      RETURNING dernier`;
    return `${p.banque.prefixeTickets}-${annee}-${String(dernier).padStart(6, '0')}`;
  }

  /** Plafond de tickets du plan : jamais bloquant, dépassement signalé une fois par mois (§6.7). */
  private async signalerPlafond(tx: ClientTransaction, envois: Envois, p: ParametresBanque, maintenant: Date) {
    const plafond = p.banque.plafondTicketsMois;
    if (!plafond) return;
    const mois = DateTime.fromJSDate(maintenant, { zone: p.banque.fuseauHoraire }).startOf('month');
    const n = await tx.reclamation.count({ where: { creeLe: { gte: mois.toJSDate() } } });
    if (n <= plafond) return;
    await envois.plateforme(
      'plateforme.plafond',
      `${p.banque.nom} a dépassé le plafond de ${plafond} tickets de son plan en ${mois.setLocale('fr').toFormat('LLLL yyyy')}.`,
      `plafond:${p.banque.id}:${mois.toFormat('yyyy-MM')}`,
    );
  }

  // =========================================================================
  //  Traitement (§6.2, §6.3)
  // =========================================================================

  async prendreEnCharge(tenantId: string, reclamationId: string, acteur: Acteur, trace?: Trace) {
    return this.surTicket(tenantId, reclamationId, async (tx, t, p, maintenant) => {
      await this.transition(tx, t, 'PRENDRE_EN_CHARGE', acteur, maintenant, { prisEnChargeLe: maintenant });
      await this.envois(tx, t, p, maintenant).client('client.statut');
      await this.auditer(tx, t, acteur, 'reclamation.prise_en_charge', {}, trace);
    });
  }

  async assigner(tenantId: string, reclamationId: string, acteur: Acteur, agentId: string, trace?: Trace) {
    return this.surTicket(tenantId, reclamationId, async (tx, t, p, maintenant) => {
      exiger(verifierOperation('ASSIGNER', etat(t), acteur));
      const cible = await tx.utilisateur.findFirst({ where: { id: agentId, role: 'AGENT', statut: 'ACTIF' } });
      if (!cible) throw new ErreurMetier('AGENT_INVALIDE', 'L\'agent doit être un agent actif de la banque', 422);
      if (t.agentId === agentId) return;
      const apres = await tx.reclamation.update({ where: { id: t.id }, data: { agentId }, include: { categorie: { select: { nom: true } } } });
      await this.evenement(tx, t, 'ASSIGNATION', acteur, maintenant, { donnees: { agentAvant: t.agentId, agentApres: agentId } });
      const envois = this.envois(tx, apres, p, maintenant);
      await envois.personnel('agent.assignation', await agent(tx, agentId));
      // Un ticket urgent : le nouvel agent reçoit l'alerte (les autres destinataires l'ont déjà)
      if (apres.priorite === 'URGENTE') await envois.personnel('reclamation.urgente', await agent(tx, agentId), true);
      await this.auditer(tx, t, acteur, 'reclamation.assignation', { agentAvant: t.agentId, agentApres: agentId }, trace);
    });
  }

  /**
   * Réponse au client. Depuis « Ouverte », l'agent prend d'abord le ticket en charge.
   * Avec `attendreReponse`, le ticket passe « En attente client » et le chrono SLA s'arrête.
   */
  async repondreAuClient(tenantId: string, reclamationId: string, acteur: Acteur, contenu: string, options: { attendreReponse?: boolean } = {}, trace?: Trace) {
    return this.surTicket(tenantId, reclamationId, async (tx, t, p, maintenant) => {
      exiger(verifierOperation('REPONDRE_AU_CLIENT', etat(t), acteur));
      if (t.statut === 'OUVERTE') t = await this.transition(tx, t, 'PRENDRE_EN_CHARGE', acteur, maintenant, { prisEnChargeLe: maintenant });
      const message = await this.commentaire(tx, t, 'REPONSE_AU_CLIENT', acteur, contenu);
      await this.evenement(tx, t, 'MESSAGE', acteur, maintenant, { visibleClient: true, donnees: { commentaireId: message.id } });
      t = await this.noterPremiereReponse(tx, t, p, maintenant);
      if (options.attendreReponse && t.statut === 'EN_COURS') {
        t = await this.transition(tx, t, 'QUESTIONNER_CLIENT', acteur, maintenant, { ...slaEnPause(maintenant, t, p.sla), passeEnAttenteClient: true });
        await this.envois(tx, t, p, maintenant).client('client.question');
      } else {
        await this.envois(tx, t, p, maintenant).client('client.reponse');
      }
      await this.auditer(tx, t, acteur, 'reclamation.reponse_client', { attendreReponse: !!options.attendreReponse }, trace);
      return { commentaireId: message.id, statut: t.statut };
    });
  }

  async noteInterne(tenantId: string, reclamationId: string, acteur: Acteur, contenu: string, trace?: Trace) {
    return this.surTicket(tenantId, reclamationId, async (tx, t, _p, maintenant) => {
      exiger(verifierOperation('NOTE_INTERNE', etat(t), acteur));
      const note = await this.commentaire(tx, t, 'NOTE_INTERNE', acteur, contenu);
      await this.evenement(tx, t, 'MESSAGE', acteur, maintenant, { visibleClient: false, donnees: { commentaireId: note.id } });
      await this.auditer(tx, t, acteur, 'reclamation.note_interne', {}, trace);
      return { commentaireId: note.id };
    });
  }

  /** Message du client. S'il était attendu, le ticket repart « En cours » et le chrono reprend. */
  async messageDuClient(tenantId: string, reclamationId: string, acteur: Acteur, contenu: string, trace?: Trace) {
    return this.surTicket(tenantId, reclamationId, async (tx, t, p, maintenant) => {
      exiger(verifierOperation('MESSAGE_DU_CLIENT', etat(t), acteur));
      const message = await this.commentaire(tx, t, 'MESSAGE_DU_CLIENT', acteur, contenu);
      await this.evenement(tx, t, 'MESSAGE', acteur, maintenant, { visibleClient: true, donnees: { commentaireId: message.id } });
      if (t.statut === 'EN_ATTENTE_CLIENT') {
        t = await this.transition(tx, t, 'REPRENDRE_SUR_REPONSE', acteur, maintenant, slaALaReprise(maintenant, t, p.sla));
      }
      await this.envois(tx, t, p, maintenant).personnel('agent.message_client', await agent(tx, t.agentId));
      await this.auditer(tx, t, acteur, 'reclamation.message_client', {}, trace);
      return { commentaireId: message.id, statut: t.statut };
    });
  }

  async resoudre(tenantId: string, reclamationId: string, acteur: Acteur, reponseFinale: string, trace?: Trace) {
    return this.surTicket(tenantId, reclamationId, async (tx, t, p, maintenant) => {
      exiger(verifierTransition('RESOUDRE', etat(t), acteur, maintenant));
      const message = await this.commentaire(tx, t, 'REPONSE_AU_CLIENT', acteur, reponseFinale);
      await this.evenement(tx, t, 'MESSAGE', acteur, maintenant, { visibleClient: true, donnees: { commentaireId: message.id } });
      t = await this.noterPremiereReponse(tx, t, p, maintenant);
      const champs = slaALaResolution(maintenant, t.creeLe, t, p.sla);
      t = await this.transition(tx, t, 'RESOUDRE', acteur, maintenant, champs, { slaRespecte: champs.slaRespecte });
      await this.envois(tx, t, p, maintenant).client('client.resolution');
      await this.auditer(tx, t, acteur, 'reclamation.resolution', { slaRespecte: champs.slaRespecte }, trace);
      return { statut: t.statut, slaRespecte: champs.slaRespecte, clotureAutoPrevueLe: champs.clotureAutoPrevueLe };
    });
  }

  async confirmer(tenantId: string, reclamationId: string, acteur: Acteur, trace?: Trace) {
    return this.surTicket(tenantId, reclamationId, async (tx, t, p, maintenant) => {
      t = await this.transition(tx, t, 'CONFIRMER', acteur, maintenant, {
        clotureLe: maintenant, modeCloture: 'CONFIRMATION_CLIENT', clotureAutoPrevueLe: null,
      });
      await this.envois(tx, t, p, maintenant).client('client.cloture');
      await this.auditer(tx, t, acteur, 'reclamation.confirmation', {}, trace);
    });
  }

  /** Contestation pendant le délai de clôture : réouverture, le chrono reprend là où il s'était arrêté. */
  async contester(tenantId: string, reclamationId: string, acteur: Acteur, motif: string, trace?: Trace) {
    return this.surTicket(tenantId, reclamationId, async (tx, t, p, maintenant) => {
      exiger(verifierTransition('CONTESTER', etat(t), acteur, maintenant));
      const message = await this.commentaire(tx, t, 'MESSAGE_DU_CLIENT', acteur, motif);
      await this.evenement(tx, t, 'MESSAGE', acteur, maintenant, { visibleClient: true, donnees: { commentaireId: message.id } });
      t = await this.transition(tx, t, 'CONTESTER', acteur, maintenant, {
        ...slaALaReprise(maintenant, t, p.sla), clotureAutoPrevueLe: null, slaRespecte: null, nbReouvertures: t.nbReouvertures + 1,
      });
      await this.envois(tx, t, p, maintenant).personnel('agent.contestation', await agent(tx, t.agentId));
      await this.auditer(tx, t, acteur, 'reclamation.contestation', { reouverture: t.nbReouvertures }, trace);
      return { statut: t.statut, echeanceSlaLe: t.echeanceSlaLe };
    });
  }

  /** Clôture forcée par un superviseur, depuis n'importe quel statut, motif obligatoire (§6.3). */
  async cloturerDeForce(tenantId: string, reclamationId: string, acteur: Acteur, motif: MotifClotureForcee, precision: string, trace?: Trace) {
    if (!precision.trim()) throw new ErreurMetier('PRECISION_REQUISE', 'La clôture forcée exige une précision', 422);
    return this.surTicket(tenantId, reclamationId, async (tx, t, p, maintenant) => {
      if (acteur.type !== 'UTILISATEUR') throw new ErreurMetier('ACTEUR_NON_AUTORISE', 'Réservé au superviseur', 403);
      t = await this.transition(tx, t, 'CLOTURER_DE_FORCE', acteur, maintenant, {
        clotureLe: maintenant, modeCloture: 'FORCEE', motifClotureForcee: motif, commentaireCloture: precision.trim(), clotureParId: acteur.id,
        clotureAutoPrevueLe: null, echeanceSlaLe: null, alertePreventiveLe: null, slaSuspenduLe: null,
      }, { motif });
      await this.envois(tx, t, p, maintenant).client('client.cloture');
      await this.auditer(tx, t, acteur, 'reclamation.cloture_forcee', { motif }, trace);
    });
  }

  async changerPriorite(tenantId: string, reclamationId: string, acteur: Acteur, priorite: Priorite, trace?: Trace) {
    return this.surTicket(tenantId, reclamationId, async (tx, t, p, maintenant) => {
      exiger(verifierOperation('CHANGER_PRIORITE', etat(t), acteur));
      if (t.priorite === priorite) return;
      const apres = await tx.reclamation.update({ where: { id: t.id }, data: { priorite }, include: { categorie: { select: { nom: true } } } });
      await this.evenement(tx, t, 'CHANGEMENT_PRIORITE', acteur, maintenant, { donnees: { avant: t.priorite, apres: priorite } });
      if (priorite === 'URGENTE') {
        await this.envois(tx, apres, p, maintenant).alerteUrgente([
          ...(await agent(tx, apres.agentId)), ...(await superviseurs(tx, apres.agentId)), ...(await adminsEntreprise(tx)),
        ]);
      }
      await this.auditer(tx, t, acteur, 'reclamation.priorite', { avant: t.priorite, apres: priorite }, trace);
    });
  }

  /** Escalade manuelle de l'agent vers son superviseur (§6.2). */
  async escalader(tenantId: string, reclamationId: string, acteur: Acteur, motif?: string, trace?: Trace) {
    return this.surTicket(tenantId, reclamationId, async (tx, t, p, maintenant) => {
      exiger(verifierOperation('ESCALADER', etat(t), acteur));
      const destinataires = await superviseurs(tx, t.agentId);
      const agentActuel = await tx.utilisateur.findFirst({ where: { id: t.agentId ?? '' }, select: { superviseurId: true, prenom: true, nom: true } });
      const apres = await tx.reclamation.update({
        where: { id: t.id },
        data: { escaladeeLe: t.escaladeeLe ?? maintenant, escaladeeVersId: agentActuel?.superviseurId ?? t.escaladeeVersId },
        include: { categorie: { select: { nom: true } } },
      });
      await this.evenement(tx, t, 'ESCALADE', acteur, maintenant, { donnees: { origine: 'MANUELLE', vers: apres.escaladeeVersId } });
      if (motif?.trim()) {
        const note = await this.commentaire(tx, t, 'NOTE_INTERNE', acteur, motif);
        await this.evenement(tx, t, 'MESSAGE', acteur, maintenant, { visibleClient: false, donnees: { commentaireId: note.id } });
      }
      await this.envois(tx, apres, p, maintenant).personnel('superviseur.escalade', destinataires, false, agentActuel ? `${agentActuel.prenom} ${agentActuel.nom}` : undefined);
      await this.auditer(tx, t, acteur, 'reclamation.escalade', { origine: 'MANUELLE' }, trace);
    });
  }

  // =========================================================================
  //  Outils internes (partagés avec les tâches planifiées)
  // =========================================================================

  /** Verrouille le ticket (FOR UPDATE) dans une transaction de sa banque, puis applique `travail`. */
  async surTicket<T>(
    tenantId: string,
    reclamationId: string,
    travail: (tx: ClientTransaction, t: Ticket, p: ParametresBanque, maintenant: Date) => Promise<T>,
    options: { sautSiVerrouille?: boolean } = {},
  ): Promise<T | undefined> {
    if (!UUID.test(reclamationId)) throw introuvable();
    const maintenant = this.maintenant();
    return transactionEn(this.base, contexte.banque(tenantId), async (tx) => {
      const verrou = options.sautSiVerrouille
        ? await tx.$queryRaw<{ id: string }[]>`SELECT id FROM reclamation WHERE id = ${reclamationId}::uuid FOR UPDATE SKIP LOCKED`
        : await tx.$queryRaw<{ id: string }[]>`SELECT id FROM reclamation WHERE id = ${reclamationId}::uuid FOR UPDATE`;
      if (verrou.length === 0) {
        if (options.sautSiVerrouille) return undefined;
        throw introuvable();
      }
      const t = await tx.reclamation.findUniqueOrThrow({ where: { id: reclamationId }, include: { categorie: { select: { nom: true } } } });
      const p = await chargerParametres(tx, tenantId);
      return travail(tx, t, p, maintenant);
    });
  }

  /** Change le statut après vérification par la machine, et trace l'événement. */
  async transition(
    tx: ClientTransaction, t: Ticket, action: ActionStatut, acteur: Acteur, maintenant: Date,
    champs: Omit<Prisma.ReclamationUncheckedUpdateInput, 'statut'> = {}, donnees?: Record<string, unknown>,
  ): Promise<Ticket> {
    const verdict = verifierTransition(action, etat(t), acteur, maintenant);
    exiger(verdict);
    const vers = ({
      PRENDRE_EN_CHARGE: 'EN_COURS', QUESTIONNER_CLIENT: 'EN_ATTENTE_CLIENT', REPRENDRE_SUR_REPONSE: 'EN_COURS', RESOUDRE: 'RESOLUE',
      CONFIRMER: 'CLOTUREE', CONTESTER: 'EN_COURS', CLOTURER_AUTOMATIQUEMENT: 'CLOTUREE', CLOTURER_DE_FORCE: 'CLOTUREE',
    } as const satisfies Record<ActionStatut, StatutReclamation>)[action];
    const apres = await tx.reclamation.update({
      where: { id: t.id },
      data: { ...champs, statut: vers },
      include: { categorie: { select: { nom: true } } },
    });
    const type = ({
      PRENDRE_EN_CHARGE: 'PRISE_EN_CHARGE', QUESTIONNER_CLIENT: 'QUESTION_AU_CLIENT', REPRENDRE_SUR_REPONSE: 'REPONSE_DU_CLIENT',
      RESOUDRE: 'RESOLUTION', CONFIRMER: 'CONFIRMATION', CONTESTER: 'CONTESTATION',
      CLOTURER_AUTOMATIQUEMENT: 'CLOTURE_AUTOMATIQUE', CLOTURER_DE_FORCE: 'CLOTURE_FORCEE',
    } as const satisfies Record<ActionStatut, TypeEvenement>)[action];
    await this.evenement(tx, t, type, acteur, maintenant, { statutAvant: t.statut, statutApres: vers, donnees });
    return apres;
  }

  private async noterPremiereReponse(tx: ClientTransaction, t: Ticket, p: ParametresBanque, maintenant: Date): Promise<Ticket> {
    if (t.premiereReponseLe) return t;
    return tx.reclamation.update({
      where: { id: t.id },
      data: { premiereReponseLe: maintenant, delaiPremiereReponseMinutes: delaiPremiereReponse(maintenant, t.creeLe, p.sla) },
      include: { categorie: { select: { nom: true } } },
    });
  }

  private async commentaire(tx: ClientTransaction, t: Ticket, type: 'NOTE_INTERNE' | 'REPONSE_AU_CLIENT' | 'MESSAGE_DU_CLIENT', acteur: Acteur, contenu: string) {
    const texte = contenu.trim();
    if (!texte) throw new ErreurMetier('MESSAGE_VIDE', 'Le message est vide', 422);
    return tx.commentaire.create({
      data: {
        tenantId: t.tenantId, reclamationId: t.id, type, contenu: texte,
        auteurUtilisateurId: type === 'MESSAGE_DU_CLIENT' ? null : acteur.type === 'UTILISATEUR' ? acteur.id : null,
      },
    });
  }

  async evenement(
    tx: ClientTransaction, t: { id: string; tenantId: string }, type: TypeEvenement, acteur: Acteur, maintenant: Date,
    o: { statutAvant?: StatutReclamation; statutApres?: StatutReclamation; visibleClient?: boolean; donnees?: Record<string, unknown> } = {},
  ) {
    await tx.reclamationEvenement.create({
      data: {
        tenantId: t.tenantId, reclamationId: t.id, type,
        statutAvant: o.statutAvant ?? null, statutApres: o.statutApres ?? null,
        acteurType: acteur.type, acteurUtilisateurId: acteur.type === 'UTILISATEUR' ? acteur.id : null,
        visibleClient: o.visibleClient ?? VISIBLES_CLIENT.has(type),
        donnees: (o.donnees ?? undefined) as never,
        creeLe: maintenant,
      },
    });
  }

  /** Journal d'audit : identifiants et statuts seulement, jamais de contenu ni de coordonnées (arbitrage 7). */
  async auditer(tx: ClientTransaction, t: { id: string; tenantId: string; numero: string }, acteur: Acteur, action: string, donnees: Record<string, unknown>, trace?: Trace) {
    await tx.journalAudit.create({
      data: {
        tenantId: t.tenantId,
        acteurType: acteur.type,
        acteurId: acteur.type === 'UTILISATEUR' ? acteur.id : acteur.type === 'CLIENT' ? acteur.clientId : null,
        acteurLibelle: acteur.type === 'UTILISATEUR' ? acteur.libelle : acteur.type === 'SYSTEME' ? 'Système' : null,
        acteurRole: acteur.type === 'UTILISATEUR' ? acteur.role : acteur.type,
        action,
        entite: 'reclamation',
        entiteId: t.id,
        donnees: { numero: t.numero, ...donnees } as never,
        ip: trace?.ip ?? null,
        userAgent: trace?.userAgent ?? null,
      },
    });
  }

  envois(tx: ClientTransaction, t: Ticket, p: ParametresBanque, maintenant: Date): Envois {
    return new Envois(tx, notifie(t), p, this.options.lienSuivi(p.banque.slug, t.jetonSuivi), maintenant);
  }
}

export function etat(t: Pick<Reclamation, 'statut' | 'agentId' | 'clientId' | 'clotureAutoPrevueLe'>): EtatTicket {
  return { statut: t.statut, agentId: t.agentId, clientId: t.clientId, clotureAutoPrevueLe: t.clotureAutoPrevueLe };
}

function notifie(t: Ticket): TicketNotifie {
  return {
    id: t.id, tenantId: t.tenantId, numero: t.numero, jetonSuivi: t.jetonSuivi, clientId: t.clientId,
    agentId: t.agentId, categorieNom: t.categorie.nom, echeanceSlaLe: t.echeanceSlaLe,
  };
}
