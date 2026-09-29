/**
 * Journal d'audit chaîné (§6.8), en lecture seule : l'Admin Entreprise lit et vérifie la chaîne
 * de sa banque ; la console de la plateforme réutilise ces lectures pour toutes les chaînes.
 */
import { Controller, Inject, Injectable, Module } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import { BaseDonnees, type ClientTransaction } from '../../infrastructure/base-de-donnees/base-de-donnees.service.js';
import { enSerie } from '../../infrastructure/base-de-donnees/index.js';
import { AppelCourant, EntreesValidees, personnelBanque, type Appel, type Entrees } from '../../infrastructure/contrat/appel.js';
import { Operation } from '../../infrastructure/contrat/operation.decorator.js';
import { pageDe, pagination, type S } from '../commun.js';

export async function pageAudit(tx: ClientTransaction, base: Prisma.JournalAuditWhereInput, q: Record<string, unknown>): Promise<S<'PageAudit'>> {
  const where: Prisma.JournalAuditWhereInput = {
    ...base,
    ...(q.du || q.au ? { horodatage: { ...(q.du ? { gte: new Date(String(q.du)) } : {}), ...(q.au ? { lt: new Date(String(q.au)) } : {}) } } : {}),
    ...(q.action ? { action: { startsWith: String(q.action) } } : {}),
    ...(q.acteurId ? { acteurId: String(q.acteurId) } : {}),
    ...(q.entiteId ? { entiteId: String(q.entiteId) } : {}),
  };
  const { page, parPage, skip, take } = pagination(q);
  const [total, lignes] = await enSerie([
    () => tx.journalAudit.count({ where }),
    () => tx.journalAudit.findMany({ where, orderBy: [{ horodatage: 'desc' }, { id: 'desc' }], skip, take }),
  ]);
  return pageDe(lignes.map((l) => ({
    id: l.id.toString(),
    chaine: l.chaine,
    rang: Number(l.rang),
    horodatage: l.horodatage.toISOString(),
    acteur: { type: l.acteurType, id: l.acteurId, libelle: l.acteurLibelle, role: l.acteurRole },
    action: l.action,
    entite: l.entite,
    entiteId: l.entiteId,
    donnees: (l.donnees ?? null) as Record<string, unknown> | null,
    ip: l.ip,
  })), page, parPage, total);
}

/** Recalcule toute la chaîne (fonction SQL de l'étape 3, avec les droits de l'appelant). */
export async function verifierChaine(tx: ClientTransaction, chaine: string): Promise<S<'VerificationChaine'>> {
  const [r] = await tx.$queryRaw<{ valide: boolean; lignes: bigint; premiere_rupture: bigint | null }[]>`SELECT * FROM verifier_chaine_audit(${chaine})`;
  return { chaine, valide: r.valide, lignes: Number(r.lignes), premiereRupture: r.premiere_rupture === null ? null : Number(r.premiere_rupture) };
}

@Injectable()
export class ServiceAudit {
  constructor(@Inject(BaseDonnees) private readonly bd: BaseDonnees) {}

  lister(appel: Appel, q: Record<string, unknown>) {
    const moi = personnelBanque(appel);
    return this.bd.enBanque(moi.tenantId, (tx) => pageAudit(tx, { chaine: `banque:${moi.tenantId}` }, q));
  }

  verifier(appel: Appel) {
    const moi = personnelBanque(appel);
    return this.bd.enBanque(moi.tenantId, (tx) => verifierChaine(tx, `banque:${moi.tenantId}`));
  }
}

@Controller()
export class AuditControleur {
  constructor(@Inject(ServiceAudit) private readonly service: ServiceAudit) {}

  @Operation('listerJournalBanque')
  lister(@AppelCourant() a: Appel, @EntreesValidees() e: Entrees) {
    return this.service.lister(a, e.requete);
  }

  @Operation('verifierJournalBanque')
  verifier(@AppelCourant() a: Appel) {
    return this.service.verifier(a);
  }
}

@Module({ controllers: [AuditControleur], providers: [ServiceAudit] })
export class AuditModule {}
