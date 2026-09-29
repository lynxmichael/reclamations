/**
 * Notifications in-app du personnel d'une banque (§6.5) : les siennes seulement.
 */
import { Controller, Inject, Injectable, Module } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import { BaseDonnees, type ClientTransaction } from '../../infrastructure/base-de-donnees/base-de-donnees.service.js';
import { enSerie } from '../../infrastructure/base-de-donnees/index.js';
import { AppelCourant, EntreesValidees, personnelBanque, type Appel, type Entrees } from '../../infrastructure/contrat/appel.js';
import { Operation } from '../../infrastructure/contrat/operation.decorator.js';
import { introuvable } from '../../infrastructure/contrat/probleme.js';
import { HORLOGE, type Horloge } from '../../noyau/noyau.module.js';
import { pageDe, pagination, type S } from '../commun.js';

/** Page de notifications in-app d'un destinataire (utilisé aussi par la console de la plateforme). */
export async function pageNotifications(tx: ClientTransaction, destinataireId: string, q: Record<string, unknown>): Promise<S<'PageNotifications'>> {
  const base: Prisma.NotificationWhereInput = { destinataireUtilisateurId: destinataireId, canal: 'IN_APP' };
  const where: Prisma.NotificationWhereInput = q.nonLues === true ? { ...base, lueLe: null } : base;
  const { page, parPage, skip, take } = pagination(q);
  const [total, nonLues, lignes] = await enSerie([
    () => tx.notification.count({ where }),
    () => tx.notification.count({ where: { ...base, lueLe: null } }),
    () => tx.notification.findMany({
      where, orderBy: [{ creeLe: 'desc' }, { id: 'desc' }], skip, take,
      select: { id: true, modele: true, sujet: true, contenu: true, reclamationId: true, creeLe: true, lueLe: true },
    }),
  ]);
  return {
    ...pageDe(lignes.map((n) => ({ ...n, creeLe: n.creeLe.toISOString(), lueLe: n.lueLe?.toISOString() ?? null })), page, parPage, total),
    nonLues,
  };
}

export async function marquerLue(tx: ClientTransaction, destinataireId: string, id: string, maintenant: Date): Promise<void> {
  const n = await tx.notification.findFirst({ where: { id, destinataireUtilisateurId: destinataireId, canal: 'IN_APP' }, select: { lueLe: true } });
  if (!n) throw introuvable('Notification introuvable');
  if (!n.lueLe) await tx.notification.updateMany({ where: { id, lueLe: null }, data: { lueLe: maintenant } });
}

@Injectable()
export class ServiceNotifications {
  constructor(
    @Inject(BaseDonnees) private readonly bd: BaseDonnees,
    @Inject(HORLOGE) private readonly horloge: Horloge,
  ) {}

  lister(appel: Appel, q: Record<string, unknown>) {
    const moi = personnelBanque(appel);
    return this.bd.enBanque(moi.tenantId, (tx) => pageNotifications(tx, moi.id, q));
  }

  async lue(appel: Appel, id: string) {
    const moi = personnelBanque(appel);
    await this.bd.enBanque(moi.tenantId, (tx) => marquerLue(tx, moi.id, id, this.horloge()));
  }

  async toutesLues(appel: Appel) {
    const moi = personnelBanque(appel);
    await this.bd.enBanque(moi.tenantId, (tx) => tx.notification.updateMany({
      where: { destinataireUtilisateurId: moi.id, canal: 'IN_APP', lueLe: null }, data: { lueLe: this.horloge() },
    }));
  }
}

@Controller()
export class NotificationsControleur {
  constructor(@Inject(ServiceNotifications) private readonly service: ServiceNotifications) {}

  @Operation('listerNotifications')
  lister(@AppelCourant() a: Appel, @EntreesValidees() e: Entrees) {
    return this.service.lister(a, e.requete);
  }

  @Operation('marquerNotificationLue')
  async lue(@AppelCourant() a: Appel, @EntreesValidees() e: Entrees): Promise<void> {
    await this.service.lue(a, e.chemin.id);
  }

  @Operation('marquerToutesNotificationsLues')
  async toutes(@AppelCourant() a: Appel): Promise<void> {
    await this.service.toutesLues(a);
  }
}

@Module({ controllers: [NotificationsControleur], providers: [ServiceNotifications] })
export class NotificationsModule {}
