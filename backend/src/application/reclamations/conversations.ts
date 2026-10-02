/**
 * Conversation d'une réclamation (étape 17) : tenue à jour dans la transaction de chaque message.
 * Les règles (qui doit lire, qui alerter, quand prévenir le client) sont pures, dans
 * domaine/conversation.ts ; ce module les applique à la table conversation.
 *
 * Le chat est ouvert banque par banque par Makor (décision I2). Banque sans chat : rien ne change,
 * chaque réponse est signalée au client et chaque message du client alerte l'agent, comme avant.
 */
import { alerterAgent, marqueLaLecture, type Lecteur } from '../../domaine/conversation.js';
import type { ClientTransaction } from '../../infrastructure/base-de-donnees/index.js';
import type { ParametresBanque } from './parametres.js';

interface TicketCourant {
  readonly id: string;
  readonly tenantId: string;
}

/** Ouvre la conversation de la réclamation si besoin (le client a ouvert le chat ou y écrit). */
export async function ouvrirConversation(tx: ClientTransaction, t: TicketCourant, maintenant: Date) {
  await tx.conversation.createMany({
    data: [{ tenantId: t.tenantId, reclamationId: t.id, canal: 'WEB', creeLe: maintenant }],
    skipDuplicates: true,
  });
  return tx.conversation.findUniqueOrThrow({ where: { tenantId_reclamationId: { tenantId: t.tenantId, reclamationId: t.id } } });
}

/**
 * Message du client. Chat ouvert : il entre dans la conversation (canal WEB), et l'agent n'est alerté
 * que si rien n'attendait déjà sa lecture — une rafale de messages, une seule alerte.
 */
export async function messageDuClientDansConversation(
  tx: ClientTransaction, t: TicketCourant, p: ParametresBanque, maintenant: Date,
): Promise<{ alerterAgent: boolean }> {
  if (!p.banque.chatWeb) return { alerterAgent: true };
  const avant = await ouvrirConversation(tx, t, maintenant);
  await tx.conversation.update({
    where: { id: avant.id },
    data: { canal: 'WEB', dernierMessageClientLe: maintenant, luClientLe: maintenant },
  });
  return { alerterAgent: alerterAgent(avant) };
}

/**
 * Réponse de la banque. Si le client a ouvert le chat, l'avis par e-mail ou SMS est différé : le worker
 * ne l'envoie que si la réponse reste non lue 2 minutes (taches-sla.ts). Avec `avisDonne` (résolution),
 * la notification de l'action tient lieu d'avis. Répondre marque la conversation lue pour la banque.
 */
export async function reponseDansConversation(
  tx: ClientTransaction, t: TicketCourant, p: ParametresBanque, maintenant: Date, options: { avisDonne?: boolean } = {},
): Promise<{ avisDiffere: boolean }> {
  if (!p.banque.chatWeb) return { avisDiffere: false };
  const c = await tx.conversation.findUnique({ where: { tenantId_reclamationId: { tenantId: t.tenantId, reclamationId: t.id } } });
  if (!c) return { avisDiffere: false };
  await tx.conversation.update({
    where: { id: c.id },
    data: { dernierMessageBanqueLe: maintenant, luBanqueLe: maintenant, ...(options.avisDonne ? { avisClientLe: maintenant } : {}) },
  });
  return { avisDiffere: !options.avisDonne };
}

/** Le client a le chat à l'écran : messages lus, client en ligne. Le premier passage ouvre la conversation. */
export async function lectureClient(tx: ClientTransaction, t: TicketCourant, maintenant: Date): Promise<void> {
  const c = await ouvrirConversation(tx, t, maintenant);
  if (!c.luClientLe || c.luClientLe < maintenant) await tx.conversation.update({ where: { id: c.id }, data: { luClientLe: maintenant } });
}

/** Lecture par la banque : compte pour l'agent assigné, ou pour un superviseur si la réclamation n'est pas assignée. */
export async function lectureBanque(
  tx: ClientTransaction, conversationId: string, lecteur: Lecteur, agentId: string | null, maintenant: Date,
): Promise<boolean> {
  if (!marqueLaLecture(lecteur, agentId)) return false;
  await tx.conversation.update({ where: { id: conversationId }, data: { luBanqueLe: maintenant } });
  return true;
}
