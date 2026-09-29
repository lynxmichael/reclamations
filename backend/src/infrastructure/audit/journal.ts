/**
 * Écriture dans le journal d'audit chaîné (§6.8) pour les actions hors cycle de vie :
 * connexions, paramétrage, personnel, plateforme. Identité de l'auteur figée au moment de
 * l'action ; jamais de secret, de contenu de réclamation ni de coordonnées de client.
 * La chaîne (banque ou plateforme) découle de tenantId : le trigger de l'étape 3 la calcule.
 */
import type { ClientTransaction } from '../base-de-donnees/index.js';
import type { Personnel } from '../contrat/appel.js';

export interface LigneAudit {
  /** Banque concernée ; vide = chaîne de la plateforme */
  readonly tenantId: string | null;
  readonly acteur: Personnel | 'SYSTEME' | { readonly clientId: string };
  readonly action: string;
  readonly entite?: string;
  readonly entiteId?: string | null;
  readonly donnees?: Record<string, unknown>;
  readonly trace?: { readonly ip?: string; readonly userAgent?: string };
}

export async function journaliser(tx: ClientTransaction, l: LigneAudit): Promise<void> {
  const personnel = typeof l.acteur === 'object' && 'role' in l.acteur ? l.acteur : null;
  const client = typeof l.acteur === 'object' && 'clientId' in l.acteur ? l.acteur : null;
  await tx.journalAudit.create({
    data: {
      tenantId: l.tenantId,
      acteurType: personnel ? 'UTILISATEUR' : client ? 'CLIENT' : 'SYSTEME',
      acteurId: personnel?.id ?? client?.clientId ?? null,
      acteurLibelle: personnel ? `${personnel.prenom} ${personnel.nom}` : client ? null : 'Système',
      acteurRole: personnel?.role ?? (client ? 'CLIENT' : 'SYSTEME'),
      action: l.action,
      entite: l.entite ?? null,
      entiteId: l.entiteId ?? null,
      donnees: (l.donnees ?? undefined) as never,
      ip: l.trace?.ip ?? null,
      userAgent: l.trace?.userAgent?.slice(0, 512) ?? null,
    },
  });
}
