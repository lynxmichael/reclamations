/**
 * Ce que l'API sait d'un appel, une fois l'authentification et la validation passées :
 * l'opération du contrat, qui appelle, et les entrées validées.
 */
import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { Acteur } from '../../domaine/reclamation/machine.js';
import type { RoleUtilisateur } from '../../domaine/enumerations.js';

export interface Personnel {
  readonly id: string;
  readonly role: RoleUtilisateur;
  /** Vide pour un Super Admin */
  readonly tenantId: string | null;
  readonly email: string;
  readonly nom: string;
  readonly prenom: string;
  /** Session (famille de refresh tokens) qui a émis le jeton d'accès */
  readonly session: string;
}

export interface ClientConnecte {
  readonly id: string;
  readonly tenantId: string;
}

export interface FichierRecu {
  readonly champ: string;
  readonly nomOriginal: string;
  readonly taille: number;
  readonly contenu: Buffer;
}

export interface Entrees {
  readonly chemin: Record<string, string>;
  readonly requete: Record<string, unknown>;
  readonly entetes: Record<string, string>;
  readonly corps: Record<string, unknown>;
  readonly fichiers: readonly FichierRecu[];
}

export interface Appel {
  readonly operation: string;
  readonly ip: string;
  readonly userAgent?: string;
  personnel?: Personnel;
  client?: ClientConnecte;
  entrees?: Entrees;
}

export type RequeteApi = Request & { appel?: Appel };

export function appelDe(requete: RequeteApi): Appel {
  if (!requete.appel) throw new Error('Appel non initialisé : la garde du contrat n\'est pas passée');
  return requete.appel;
}

/** Paramètre de méthode : l'appel courant. */
export const AppelCourant = createParamDecorator((_: unknown, ctx: ExecutionContext): Appel =>
  appelDe(ctx.switchToHttp().getRequest<RequeteApi>()));

/** Paramètre de méthode : les entrées validées contre le contrat. */
export const EntreesValidees = createParamDecorator((_: unknown, ctx: ExecutionContext): Entrees => {
  const e = appelDe(ctx.switchToHttp().getRequest<RequeteApi>()).entrees;
  if (!e) throw new Error('Entrées non validées');
  return e;
});

// ---- Outils pour les services -----------------------------------------------

export function personnelDe(appel: Appel): Personnel {
  if (!appel.personnel) throw new Error('Opération réservée au personnel');
  return appel.personnel;
}

/** Personnel d'une banque (jamais un Super Admin : les espaces /banque l'excluent). */
export function personnelBanque(appel: Appel): Personnel & { tenantId: string } {
  const p = personnelDe(appel);
  if (!p.tenantId) throw new Error('Opération réservée au personnel d\'une banque');
  return p as Personnel & { tenantId: string };
}

export function clientDe(appel: Appel): ClientConnecte {
  if (!appel.client) throw new Error('Opération réservée au client');
  return appel.client;
}

export function acteurDe(appel: Appel): Acteur {
  if (appel.client) return { type: 'CLIENT', clientId: appel.client.id };
  const p = personnelDe(appel);
  return { type: 'UTILISATEUR', id: p.id, role: p.role, libelle: `${p.prenom} ${p.nom}` };
}

export function traceDe(appel: Appel) {
  return { ip: appel.ip, userAgent: appel.userAgent?.slice(0, 512) };
}
