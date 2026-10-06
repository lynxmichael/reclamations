/**
 * Envois au client non remis (étape 22) : l'agent assigné est prévenu dans l'application (son
 * superviseur s'il est absent ou désactivé, tous les superviseurs si la réclamation n'est à
 * personne), une fois par message, et seulement si le client ne l'a pas reçu autrement (l'e-mail
 * parti au même moment). Appelé par le worker (échec définitif) et par l'accusé de remise de la
 * passerelle SMS.
 */
import type { CanalNotification } from '../../generated/prisma/enums.js';
import { aSignaler, LIBELLES_MOTIF, masquerDestination, nonRemisEnSuspens, objetEnvoi, type MotifEchec, type StatutNotificationBrut } from '../../domaine/envois.js';
import type { BaseDonnees } from '../../infrastructure/base-de-donnees/base-de-donnees.service.js';
import { responsables } from './attribution.js';
import { chargerParametres } from './parametres.js';

export interface EnvoiNonRemis {
  readonly id: string;
  readonly tenantId: string | null;
  readonly canal: CanalNotification;
  readonly modele: string;
  readonly reclamationId: string | null;
  readonly destination: string | null;
  readonly motifEchec: MotifEchec;
}

export const MODELE_NON_REMIS = 'agent.envoi_non_remis';

export async function signalerNonRemis(bd: BaseDonnees, n: EnvoiNonRemis, maintenant: Date): Promise<number> {
  if (!n.tenantId || !n.reclamationId || !aSignaler(n.modele) || (n.canal !== 'SMS' && n.canal !== 'EMAIL')) return 0;
  const canalEnvoi = n.canal;
  const tenantId = n.tenantId;
  const reclamationId = n.reclamationId;
  return bd.enBanque(tenantId, async (tx) => {
    const r = await tx.reclamation.findFirst({ where: { id: reclamationId }, select: { numero: true, agentId: true } });
    if (!r) return 0;
    // Le client l'a reçu autrement (l'e-mail parti au même moment, un renvoi) : rien à signaler
    const memes = await tx.notification.findMany({
      where: { reclamationId, destinataireClientId: { not: null }, modele: n.modele, canal: { not: 'IN_APP' } },
      select: { id: true, modele: true, statut: true, creeLe: true },
    });
    if (!nonRemisEnSuspens(memes.map((m) => ({ ...m, statut: m.statut as StatutNotificationBrut }))).some((m) => m.id === n.id)) return 0;
    const p = await chargerParametres(tx, tenantId);
    const qui = await responsables(tx, p, maintenant, r.agentId);
    const canal = canalEnvoi === 'SMS' ? 'SMS' : 'E-mail';
    const vers = n.destination ? ` ${canalEnvoi === 'SMS' ? 'au' : 'à'} ${masquerDestination(canalEnvoi, n.destination)}` : '';
    const { count } = await tx.notification.createMany({
      data: qui.map((d) => ({
        tenantId, canal: 'IN_APP' as const, modele: MODELE_NON_REMIS, destinataireUtilisateurId: d.id, reclamationId,
        sujet: `${canal} non remis au client`,
        contenu: `${r.numero} : « ${objetEnvoi(n.modele)} » n'a pas été remis${vers} (${LIBELLES_MOTIF[n.motifEchec]}).`,
        cleDeduplication: `envoi_non_remis:${n.id}:${d.id}`,
      })),
      skipDuplicates: true,
    });
    return count;
  });
}
