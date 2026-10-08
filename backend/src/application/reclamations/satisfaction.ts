import {
  clotureAvecEnquete,
  finEnquete,
  type ModeClotureAvecEnquete,
} from "../../domaine/satisfaction.js";
import type { ClientTransaction } from "../../infrastructure/base-de-donnees/index.js";
import type { ParametresBanque } from "./parametres.js";

export async function ouvrirEnquete(
  tx: ClientTransaction,
  t: { id: string; tenantId: string },
  p: ParametresBanque,
  mode: ModeClotureAvecEnquete,
  maintenant: Date,
): Promise<boolean> {
  if (!p.banque.enqueteSatisfaction || !clotureAvecEnquete(mode)) return false;
  await tx.enqueteSatisfaction.create({
    data: {
      tenantId: t.tenantId,
      reclamationId: t.id,
      creeLe: maintenant,
      expireLe: finEnquete(maintenant),
    },
  });
  return true;
}
