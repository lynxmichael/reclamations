import type { ModeAttribution } from "../../domaine/attribution.js";
import { normaliserCalendrier } from "../../domaine/temps-ouvre/calendrier.js";
import type { ParametresSla } from "../../domaine/reclamation/sla.js";
import {
  enSerie,
  type ClientTransaction,
} from "../../infrastructure/base-de-donnees/index.js";

export interface ParametresBanque {
  readonly banque: {
    readonly id: string;
    readonly nom: string;
    readonly slug: string;
    readonly prefixeTickets: string;
    readonly fuseauHoraire: string;
    readonly smsChaqueChangementStatut: boolean;

    readonly enqueteSatisfaction: boolean;

    readonly modeAttribution: ModeAttribution;

    readonly attributionOuverte: boolean;

    readonly escaladeAdmin: {
      readonly pourcent: number | null;
      readonly urgentPourcent: number | null;
    } | null;

    readonly chatWeb: boolean;

    readonly assistantIa: boolean; /** WhatsApp Business et SMS entrant (étape 20), ouverts par Makor (exigent le chat) */
    readonly whatsapp: boolean;
    readonly smsEntrant: boolean;

    readonly barometre: boolean;
    readonly suspendueLe: Date | null;
    readonly plafondTicketsMois: number | null;
  };
  readonly sla: ParametresSla;
}

/** Paramètres de la banque courante (contexte banque : la RLS ne laisse voir que la sienne). */
export async function chargerParametres(
  tx: ClientTransaction,
  tenantId: string,
): Promise<ParametresBanque> {
  const [banque, plages, joursFeries] = await enSerie([
    () =>
      tx.banque.findUniqueOrThrow({
        where: { id: tenantId },
        include: { plan: { select: { plafondTicketsMois: true } } },
      }),
    () =>
      tx.horaireOuvre.findMany({
        select: { jourSemaine: true, debutMinute: true, finMinute: true },
      }),
    () => tx.jourFerie.findMany({ select: { date: true, recurrent: true } }),
  ]);
  return {
    banque: {
      id: banque.id,
      nom: banque.nom,
      slug: banque.slug,
      prefixeTickets: banque.prefixeTickets,
      fuseauHoraire: banque.fuseauHoraire,
      smsChaqueChangementStatut: banque.smsChaqueChangementStatut,
      enqueteSatisfaction: banque.enqueteSatisfaction,
      modeAttribution: banque.attributionAutomatique
        ? banque.modeAttribution
        : "MANUELLE",
      attributionOuverte: banque.attributionAutomatique,
      escaladeAdmin: banque.attributionAutomatique
        ? {
            pourcent: banque.seuilEscaladeAdminPourcent,
            urgentPourcent: banque.seuilEscaladeAdminUrgentPourcent,
          }
        : null,
      chatWeb: banque.chatWeb,
      assistantIa: banque.assistantIa && banque.chatWeb,
      whatsapp: banque.whatsapp && banque.chatWeb,
      smsEntrant: banque.smsEntrant && banque.chatWeb,
      barometre: banque.barometre,
      suspendueLe: banque.suspendueLe,
      plafondTicketsMois: banque.plan.plafondTicketsMois,
    },
    sla: {
      calendrier: normaliserCalendrier({
        fuseauHoraire: banque.fuseauHoraire,
        plages,
        joursFeries: joursFeries.map((j) => ({
          date: j.date.toISOString().slice(0, 10),
          recurrent: j.recurrent,
        })),
      }),
      seuilAlertePourcent: banque.seuilAlerteSlaPourcent,
      delaiClotureAutoJours: banque.delaiClotureAutoJours,
    },
  };
}
