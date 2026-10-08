import { canalDuFil, type CanalMessagerie } from "../../domaine/canaux.js";
import {
  alerterAgent,
  marqueLaLecture,
  type Lecteur,
} from "../../domaine/conversation.js";
import type { CanalConversation } from "../../generated/prisma/enums.js";
import type { ClientTransaction } from "../../infrastructure/base-de-donnees/index.js";
import type { ParametresBanque } from "./parametres.js";

interface TicketCourant {
  readonly id: string;
  readonly tenantId: string;
}

/** Ouvre la conversation de la réclamation si besoin (le client a ouvert le chat ou y écrit). */
export async function ouvrirConversation(
  tx: ClientTransaction,
  t: TicketCourant,
  maintenant: Date,
  canal: CanalConversation = "WEB",
) {
  await tx.conversation.createMany({
    data: [
      { tenantId: t.tenantId, reclamationId: t.id, canal, creeLe: maintenant },
    ],
    skipDuplicates: true,
  });
  return tx.conversation.findUniqueOrThrow({
    where: {
      tenantId_reclamationId: { tenantId: t.tenantId, reclamationId: t.id },
    },
  });
}

export async function messageDuClientDansConversation(
  tx: ClientTransaction,
  t: TicketCourant,
  p: ParametresBanque,
  maintenant: Date,
  canal: CanalConversation = "WEB",
): Promise<{ alerterAgent: boolean }> {
  if (!p.banque.chatWeb) return { alerterAgent: true };
  const avant = await ouvrirConversation(tx, t, maintenant, canal);
  await tx.conversation.update({
    where: { id: avant.id },
    data: { canal, dernierMessageClientLe: maintenant, luClientLe: maintenant },
  });
  return { alerterAgent: alerterAgent(avant) };
}

export interface FilClient {
  readonly canal: CanalConversation;
  /** WhatsApp : fin de la fenêtre de 24 h */
  readonly finFenetreLe: Date | null;
  /** SMS : numéro de la banque, expéditeur des SMS de la conversation */
  readonly expediteur: string | null;
}

export const FIL_WEB: FilClient = {
  canal: "WEB",
  finFenetreLe: null,
  expediteur: null,
};

export async function canalDeReponse(
  tx: ClientTransaction,
  t: TicketCourant,
  p: ParametresBanque,
  maintenant: Date,
): Promise<FilClient> {
  if (!p.banque.whatsapp && !p.banque.smsEntrant) return FIL_WEB;
  const c = await tx.conversation.findUnique({
    where: {
      tenantId_reclamationId: { tenantId: t.tenantId, reclamationId: t.id },
    },
    select: { canal: true, dernierMessageClientLe: true },
  });
  return filDe(
    c,
    p,
    maintenant,
    async (canal) =>
      (
        await tx.canalBanque.findUnique({
          where: { tenantId_canal: { tenantId: t.tenantId, canal } },
          select: { numero: true },
        })
      )?.numero ?? null,
  );
}

/** Même règle (`canalDuFil`), le numéro d'expédition des SMS lu à la demande. */
export async function filDe(
  c: { canal: CanalConversation; dernierMessageClientLe: Date | null } | null,
  p: Pick<ParametresBanque, "banque">,
  maintenant: Date,
  numero: (canal: CanalMessagerie) => Promise<string | null>,
): Promise<FilClient> {
  const r = canalDuFil(c, p.banque, maintenant);
  if (r.canal === "WHATSAPP")
    return {
      canal: "WHATSAPP",
      finFenetreLe: r.finFenetreLe,
      expediteur: null,
    };
  if (r.canal === "SMS") {
    const expediteur = await numero("SMS");
    if (expediteur) return { canal: "SMS", finFenetreLe: null, expediteur };
  }
  return FIL_WEB;
}

export async function reponseDansConversation(
  tx: ClientTransaction,
  t: TicketCourant,
  p: ParametresBanque,
  maintenant: Date,
  options: { avisDonne?: boolean } = {},
): Promise<{ avisDiffere: boolean }> {
  if (!p.banque.chatWeb) return { avisDiffere: false };
  const c = await tx.conversation.findUnique({
    where: {
      tenantId_reclamationId: { tenantId: t.tenantId, reclamationId: t.id },
    },
  });
  if (!c) return { avisDiffere: false };
  await tx.conversation.update({
    where: { id: c.id },
    data: {
      dernierMessageBanqueLe: maintenant,
      luBanqueLe: maintenant,
      ...(options.avisDonne ? { avisClientLe: maintenant } : {}),
    },
  });
  return { avisDiffere: !options.avisDonne };
}

/** Le client a le chat à l'écran : messages lus, client en ligne. Le premier passage ouvre la conversation. */
export async function lectureClient(
  tx: ClientTransaction,
  t: TicketCourant,
  maintenant: Date,
): Promise<void> {
  const c = await ouvrirConversation(tx, t, maintenant);
  if (!c.luClientLe || c.luClientLe < maintenant)
    await tx.conversation.update({
      where: { id: c.id },
      data: { luClientLe: maintenant },
    });
}

/** Lecture par la banque : compte pour l'agent assigné, ou pour un superviseur si la réclamation n'est pas assignée. */
export async function lectureBanque(
  tx: ClientTransaction,
  conversationId: string,
  lecteur: Lecteur,
  agentId: string | null,
  maintenant: Date,
): Promise<boolean> {
  if (!marqueLaLecture(lecteur, agentId)) return false;
  await tx.conversation.update({
    where: { id: conversationId },
    data: { luBanqueLe: maintenant },
  });
  return true;
}
