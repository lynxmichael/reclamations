import {
  contexte,
  clientEn,
  transactionEn,
  type ClientBase,
} from "../../infrastructure/base-de-donnees/index.js";
import { minutesAvantAlerte } from "../../domaine/reclamation/sla.js";
import {
  instantEscaladeAdmin,
  seuilEscaladeAdmin,
} from "../../domaine/reclamation/escalade.js";
import { avisClientDu, limiteAvisClient } from "../../domaine/conversation.js";
import { DUREE_SESSION_MS } from "../../domaine/canaux.js";
import type { Acteur } from "../../domaine/reclamation/machine.js";
import {
  banqueOuverte,
  chargerContexte,
  choisir,
  responsables,
} from "./attribution.js";
import { adminsEntreprise, agent, superviseurs } from "./notifications.js";
import type { CycleDeVie } from "./cycle-de-vie.js";
import { chargerParametres } from "./parametres.js";
import { ouvrirEnquete } from "./satisfaction.js";

const SYSTEME: Acteur = { type: "SYSTEME" };
const ACTIFS = ["OUVERTE", "EN_COURS"] as const;
const ENCORE_OUVERTES = ["OUVERTE", "EN_COURS", "EN_ATTENTE_CLIENT"] as const;
const LOT = 200;

const FENETRE_AVIS_MS = 7 * 86_400_000;

export interface BilanTaches {
  attributions: number;
  alertesPreventives: number;
  depassements: number;
  escaladesAdmin: number;
  cloturesAutomatiques: number;
  avisConversations: number;
  sessionsCanal: number;
}

export class TachesSla {
  private readonly systeme;

  constructor(
    private readonly base: ClientBase,
    private readonly cycle: CycleDeVie,
  ) {
    this.systeme = clientEn(base, contexte.systeme());
  }

  async toutes(maintenant: Date): Promise<BilanTaches> {
    return {
      attributions: await this.attributionsEnAttente(maintenant),
      alertesPreventives: await this.alertesPreventives(maintenant),
      depassements: await this.depassements(maintenant),
      escaladesAdmin: await this.escaladesAdmin(maintenant),
      cloturesAutomatiques: await this.cloturesAutomatiques(maintenant),
      avisConversations: await this.avisConversations(maintenant),
      sessionsCanal: await this.effacerSessionsCanal(maintenant),
    };
  }

  async attributionsEnAttente(maintenant: Date): Promise<number> {
    const banques = await this.systeme.banque.findMany({
      where: {
        attributionAutomatique: true,
        modeAttribution: "AUTOMATIQUE",
        suspendueLe: null,
      },
      select: { id: true },
    });
    let traites = 0;
    for (const b of banques) {
      const candidats = await this.systeme.reclamation.findMany({
        where: {
          tenantId: b.id,
          statut: "OUVERTE",
          agentId: null,
          OR: [
            { categorie: { groupeId: { not: null } } },
            { agence: { groupeId: { not: null } } },
          ],
        },
        select: { id: true, categorieId: true, agenceId: true },
        orderBy: [{ creeLe: "asc" }, { id: "asc" }],
        take: LOT,
      });
      // Une catégorie et une agence sans agent disponible : inutile de réessayer dans ce passage
      const sansAgent = new Set<string>();
      for (const c of candidats) {
        const cle = `${c.categorieId}:${c.agenceId}`;
        if (sansAgent.has(cle)) continue;
        const issue = await this.cycle.surTicket(
          b.id,
          c.id,
          async (tx, t, p) => {
            if (
              t.statut !== "OUVERTE" ||
              t.agentId ||
              p.banque.modeAttribution !== "AUTOMATIQUE"
            )
              return "ignoree";
            if (!banqueOuverte(maintenant, p.sla.calendrier)) return "fermee";
            const choix = choisir(
              await chargerContexte(tx, p, maintenant),
              t.categorieId,
              t.agenceId,
            );
            if (!choix) return "personne";
            await this.cycle.attribuer(tx, t, p, maintenant, choix);
            return "attribuee";
          },
          { sautSiVerrouille: true },
        );
        if (issue === "fermee") break;
        if (issue === "personne") sansAgent.add(cle);
        if (issue === "attribuee") traites++;
      }
    }
    return traites;
  }

  async escaladesAdmin(maintenant: Date): Promise<number> {
    const banques = await this.systeme.banque.findMany({
      where: { attributionAutomatique: true },
      select: { id: true },
    });
    let traites = 0;
    for (const b of banques) {
      const echues = await transactionEn(
        this.base,
        contexte.banque(b.id),
        async (tx) => {
          const p = await chargerParametres(tx, b.id);
          const seuilsBanque = p.banque.escaladeAdmin;
          if (!seuilsBanque) return [];
          const tickets = await tx.reclamation.findMany({
            where: {
              statut: { in: [...ACTIFS] },
              depassementSlaSignaleLe: { not: null },
              escaladeeAdminLe: null,
              echeanceSlaLe: { not: null },
            },
            select: {
              id: true,
              priorite: true,
              echeanceSlaLe: true,
              delaiCibleMinutes: true,
              categorie: {
                select: {
                  seuilEscaladeAdminPourcent: true,
                  seuilEscaladeAdminUrgentPourcent: true,
                },
              },
            },
            orderBy: { echeanceSlaLe: "asc" },
          });
          return tickets
            .filter((t) => {
              const seuil = seuilEscaladeAdmin(
                t.priorite,
                {
                  pourcent: t.categorie.seuilEscaladeAdminPourcent,
                  urgentPourcent: t.categorie.seuilEscaladeAdminUrgentPourcent,
                },
                seuilsBanque,
              );
              return (
                seuil !== null &&
                instantEscaladeAdmin(
                  t.echeanceSlaLe!,
                  t.delaiCibleMinutes,
                  seuil,
                  p.sla.calendrier,
                ) <= maintenant
              );
            })
            .slice(0, LOT)
            .map((t) => t.id);
        },
      );
      for (const id of echues) {
        const fait = await this.cycle.surTicket(
          b.id,
          id,
          async (tx, t, p) => {
            if (
              !ACTIFS.includes(t.statut as never) ||
              t.escaladeeAdminLe ||
              !t.depassementSlaSignaleLe ||
              !t.echeanceSlaLe ||
              !p.banque.escaladeAdmin
            )
              return false;
            const categorie = await tx.categorie.findUniqueOrThrow({
              where: { id: t.categorieId },
              select: {
                seuilEscaladeAdminPourcent: true,
                seuilEscaladeAdminUrgentPourcent: true,
              },
            });
            const seuil = seuilEscaladeAdmin(
              t.priorite,
              {
                pourcent: categorie.seuilEscaladeAdminPourcent,
                urgentPourcent: categorie.seuilEscaladeAdminUrgentPourcent,
              },
              p.banque.escaladeAdmin,
            );
            if (
              seuil === null ||
              instantEscaladeAdmin(
                t.echeanceSlaLe,
                t.delaiCibleMinutes,
                seuil,
                p.sla.calendrier,
              ) > maintenant
            )
              return false;
            const apres = await tx.reclamation.update({
              where: { id: t.id },
              data: { escaladeeAdminLe: maintenant },
              include: { categorie: { select: { nom: true } } },
            });
            await this.cycle.evenement(
              tx,
              t,
              "ESCALADE_ADMIN",
              SYSTEME,
              maintenant,
              { donnees: { seuil, echeance: t.echeanceSlaLe } },
            );
            await this.cycle
              .envois(tx, apres, p, maintenant)
              .personnel(
                "admin.escalade",
                await adminsEntreprise(tx),
                true,
                `${seuil} %`,
              );
            await this.cycle.auditer(tx, t, SYSTEME, "sla.escalade_admin", {
              seuil,
            });
            return true;
          },
          { sautSiVerrouille: true },
        );
        if (fait) traites++;
      }
    }
    return traites;
  }

  async alertesPreventives(maintenant: Date): Promise<number> {
    const candidats = await this.systeme.reclamation.findMany({
      where: {
        statut: { in: [...ACTIFS] },
        alertePreventiveEnvoyeeLe: null,
        alertePreventiveLe: { lte: maintenant },
      },
      select: { id: true, tenantId: true },
      orderBy: { alertePreventiveLe: "asc" },
      take: LOT,
    });
    let traites = 0;
    for (const c of candidats) {
      const fait = await this.cycle.surTicket(
        c.tenantId,
        c.id,
        async (tx, t, p) => {
          if (
            !ACTIFS.includes(t.statut as never) ||
            t.alertePreventiveEnvoyeeLe ||
            !t.alertePreventiveLe ||
            t.alertePreventiveLe > maintenant
          )
            return false;
          const apres = await tx.reclamation.update({
            where: { id: t.id },
            data: { alertePreventiveEnvoyeeLe: maintenant },
            include: { categorie: { select: { nom: true } } },
          });
          await this.cycle.evenement(
            tx,
            t,
            "ALERTE_SLA_PREVENTIVE",
            SYSTEME,
            maintenant,
            { donnees: { echeance: t.echeanceSlaLe } },
          );
          const destinataires = await responsables(
            tx,
            p,
            maintenant,
            t.agentId,
          );
          const consomme = `${Math.round((minutesAvantAlerte(t.delaiCibleMinutes, p.sla.seuilAlertePourcent) / t.delaiCibleMinutes) * 100)} % du délai consommé`;
          await this.cycle
            .envois(tx, apres, p, maintenant)
            .personnel("sla.alerte_preventive", destinataires, true, consomme);
          await this.cycle.auditer(tx, t, SYSTEME, "sla.alerte_preventive", {});
          return true;
        },
        { sautSiVerrouille: true },
      );
      if (fait) traites++;
    }
    return traites;
  }


  async depassements(maintenant: Date): Promise<number> {
    const candidats = await this.systeme.reclamation.findMany({
      where: {
        statut: { in: [...ACTIFS] },
        depassementSlaSignaleLe: null,
        echeanceSlaLe: { lte: maintenant },
      },
      select: { id: true, tenantId: true },
      orderBy: { echeanceSlaLe: "asc" },
      take: LOT,
    });
    let traites = 0;
    for (const c of candidats) {
      const fait = await this.cycle.surTicket(
        c.tenantId,
        c.id,
        async (tx, t, p) => {
          if (
            !ACTIFS.includes(t.statut as never) ||
            t.depassementSlaSignaleLe ||
            !t.echeanceSlaLe ||
            t.echeanceSlaLe > maintenant
          )
            return false;
          const agentActuel = t.agentId
            ? await tx.utilisateur.findFirst({
                where: { id: t.agentId },
                select: { superviseurId: true },
              })
            : null;
          const apres = await tx.reclamation.update({
            where: { id: t.id },
            data: {
              depassementSlaSignaleLe: maintenant,
              escaladeeLe: t.escaladeeLe ?? maintenant,
              escaladeeVersId:
                t.escaladeeVersId ?? agentActuel?.superviseurId ?? null,
            },
            include: { categorie: { select: { nom: true } } },
          });
          await this.cycle.evenement(
            tx,
            t,
            "DEPASSEMENT_SLA",
            SYSTEME,
            maintenant,
            { donnees: { echeance: t.echeanceSlaLe } },
          );
          await this.cycle.evenement(tx, t, "ESCALADE", SYSTEME, maintenant, {
            donnees: { origine: "SLA", vers: apres.escaladeeVersId },
          });
       
            ...(await responsables(tx, p, maintenant, t.agentId)),
            ...(await superviseurs(tx, t.agentId)),
          ];
          const destinataires = prevenus.filter(
            (d, i) => prevenus.findIndex((x) => x.id === d.id) === i,
          );
          await this.cycle
            .envois(tx, apres, p, maintenant)
            .personnel("sla.depassement", destinataires, true);
          await this.cycle.auditer(tx, t, SYSTEME, "sla.depassement", {});
          return true;
        },
        { sautSiVerrouille: true },
      );
      if (fait) traites++;
    }
    return traites;
  }

  /** Résolue sans réaction du client pendant le délai de la banque (5 jours) : clôture. */
  async cloturesAutomatiques(maintenant: Date): Promise<number> {
    const candidats = await this.systeme.reclamation.findMany({
      where: { statut: "RESOLUE", clotureAutoPrevueLe: { lte: maintenant } },
      select: { id: true, tenantId: true },
      orderBy: { clotureAutoPrevueLe: "asc" },
      take: LOT,
    });
    let traites = 0;
    for (const c of candidats) {
      const fait = await this.cycle.surTicket(
        c.tenantId,
        c.id,
        async (tx, t, p) => {
          if (
            t.statut !== "RESOLUE" ||
            !t.clotureAutoPrevueLe ||
            t.clotureAutoPrevueLe > maintenant
          )
            return false;
          const apres = await this.cycle.transition(
            tx,
            t,
            "CLOTURER_AUTOMATIQUEMENT",
            SYSTEME,
            maintenant,
            {
              clotureLe: maintenant,
              modeCloture: "AUTOMATIQUE",
              clotureAutoPrevueLe: null,
            },
          );
          const avis = await ouvrirEnquete(
            tx,
            apres,
            p,
            "AUTOMATIQUE",
            maintenant,
          );
          await this.cycle
            .envois(tx, apres, p, maintenant)
            .client("client.cloture", { avis });
          await this.cycle.auditer(
            tx,
            t,
            SYSTEME,
            "reclamation.cloture_automatique",
            {},
          );
          return true;
        },
        { sautSiVerrouille: true },
      );
      if (fait) traites++;
    }
    return traites;
  }


  async avisConversations(maintenant: Date): Promise<number> {

    const candidats = await transactionEn(
      this.base,
      contexte.systeme(),
      (tx) => tx.$queryRaw<{ tenant_id: string; reclamation_id: string }[]>`
      SELECT tenant_id, reclamation_id FROM conversation
      WHERE dernier_message_banque_le <= ${limiteAvisClient(maintenant)}
        AND dernier_message_banque_le > ${new Date(maintenant.getTime() - FENETRE_AVIS_MS)}
        AND (lu_client_le IS NULL OR lu_client_le < dernier_message_banque_le)
        AND (avis_client_le IS NULL OR avis_client_le < dernier_message_banque_le)
      ORDER BY dernier_message_banque_le
      LIMIT ${LOT}`,
    );
    let traites = 0;
    for (const c of candidats) {
      const fait = await this.cycle.surTicket(
        c.tenant_id,
        c.reclamation_id,
        async (tx, t, p) => {
          const conversation = await tx.conversation.findUnique({
            where: {
              tenantId_reclamationId: {
                tenantId: t.tenantId,
                reclamationId: t.id,
              },
            },
          });
          if (!conversation || !avisClientDu(conversation, maintenant))
            return false;
          await tx.conversation.update({
            where: { id: conversation.id },
            data: { avisClientLe: maintenant },
          });
          if (!ENCORE_OUVERTES.includes(t.statut as never)) return false;
          await this.cycle
            .envois(tx, t, p, maintenant)
            .client(
              t.statut === "EN_ATTENTE_CLIENT"
                ? "client.question"
                : "client.reponse",
              { sansFil: true },
            );
          return true;
        },
        { sautSiVerrouille: true },
      );
      if (fait) traites++;
    }
    return traites;
  }


  async effacerSessionsCanal(maintenant: Date): Promise<number> {
    const { count } = await this.systeme.sessionCanal.deleteMany({
      where: {
        dernierMessageLe: {
          lt: new Date(maintenant.getTime() - DUREE_SESSION_MS),
        },
      },
    });
    return count;
  }
}
