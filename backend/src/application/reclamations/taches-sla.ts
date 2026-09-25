/**
 * Tâches planifiées du SLA (§6.4) : alerte préventive, dépassement + escalade, clôture automatique.
 *
 * Le worker les lance chaque minute (branchement BullMQ à l'étape 7). Chaque passage :
 *   1. repère les tickets échus, toutes banques confondues (contexte système, lecture seule) ;
 *   2. traite chaque ticket dans une transaction de SA banque, verrouillé avec SKIP LOCKED,
 *      et revérifie la condition sous verrou.
 * Relancer une tâche, ou en lancer deux en parallèle, ne produit jamais une alerte en double.
 */
import { contexte, clientEn, type ClientBase } from '../../infrastructure/base-de-donnees/index.js';
import { minutesAvantAlerte } from '../../domaine/reclamation/sla.js';
import type { Acteur } from '../../domaine/reclamation/machine.js';
import { agent, superviseurs } from './notifications.js';
import type { CycleDeVie } from './cycle-de-vie.js';

const SYSTEME: Acteur = { type: 'SYSTEME' };
const ACTIFS = ['OUVERTE', 'EN_COURS'] as const;
const LOT = 200;

export interface BilanTaches {
  alertesPreventives: number;
  depassements: number;
  cloturesAutomatiques: number;
}

export class TachesSla {
  private readonly systeme;

  constructor(base: ClientBase, private readonly cycle: CycleDeVie) {
    this.systeme = clientEn(base, contexte.systeme());
  }

  async toutes(maintenant: Date): Promise<BilanTaches> {
    return {
      alertesPreventives: await this.alertesPreventives(maintenant),
      depassements: await this.depassements(maintenant),
      cloturesAutomatiques: await this.cloturesAutomatiques(maintenant),
    };
  }

  /** 75 % du délai consommé : l'agent (ou, sans agent, les superviseurs) est prévenu une fois. */
  async alertesPreventives(maintenant: Date): Promise<number> {
    const candidats = await this.systeme.reclamation.findMany({
      where: { statut: { in: [...ACTIFS] }, alertePreventiveEnvoyeeLe: null, alertePreventiveLe: { lte: maintenant } },
      select: { id: true, tenantId: true }, orderBy: { alertePreventiveLe: 'asc' }, take: LOT,
    });
    let traites = 0;
    for (const c of candidats) {
      const fait = await this.cycle.surTicket(c.tenantId, c.id, async (tx, t, p) => {
        if (!ACTIFS.includes(t.statut as never) || t.alertePreventiveEnvoyeeLe || !t.alertePreventiveLe || t.alertePreventiveLe > maintenant) return false;
        const apres = await tx.reclamation.update({
          where: { id: t.id }, data: { alertePreventiveEnvoyeeLe: maintenant }, include: { categorie: { select: { nom: true } } },
        });
        await this.cycle.evenement(tx, t, 'ALERTE_SLA_PREVENTIVE', SYSTEME, maintenant, { donnees: { echeance: t.echeanceSlaLe } });
        const destinataires = t.agentId ? await agent(tx, t.agentId) : await superviseurs(tx, null);
        const consomme = `${Math.round((minutesAvantAlerte(t.delaiCibleMinutes, p.sla.seuilAlertePourcent) / t.delaiCibleMinutes) * 100)} % du délai consommé`;
        await this.cycle.envois(tx, apres, p, maintenant).personnel('sla.alerte_preventive', destinataires, true, consomme);
        await this.cycle.auditer(tx, t, SYSTEME, 'sla.alerte_preventive', {});
        return true;
      }, { sautSiVerrouille: true });
      if (fait) traites++;
    }
    return traites;
  }

  /** Échéance dépassée : agent et superviseur prévenus une fois, ticket escaladé. */
  async depassements(maintenant: Date): Promise<number> {
    const candidats = await this.systeme.reclamation.findMany({
      where: { statut: { in: [...ACTIFS] }, depassementSlaSignaleLe: null, echeanceSlaLe: { lte: maintenant } },
      select: { id: true, tenantId: true }, orderBy: { echeanceSlaLe: 'asc' }, take: LOT,
    });
    let traites = 0;
    for (const c of candidats) {
      const fait = await this.cycle.surTicket(c.tenantId, c.id, async (tx, t, p) => {
        if (!ACTIFS.includes(t.statut as never) || t.depassementSlaSignaleLe || !t.echeanceSlaLe || t.echeanceSlaLe > maintenant) return false;
        const agentActuel = t.agentId ? await tx.utilisateur.findFirst({ where: { id: t.agentId }, select: { superviseurId: true } }) : null;
        const apres = await tx.reclamation.update({
          where: { id: t.id },
          data: {
            depassementSlaSignaleLe: maintenant,
            escaladeeLe: t.escaladeeLe ?? maintenant,
            escaladeeVersId: t.escaladeeVersId ?? agentActuel?.superviseurId ?? null,
          },
          include: { categorie: { select: { nom: true } } },
        });
        await this.cycle.evenement(tx, t, 'DEPASSEMENT_SLA', SYSTEME, maintenant, { donnees: { echeance: t.echeanceSlaLe } });
        await this.cycle.evenement(tx, t, 'ESCALADE', SYSTEME, maintenant, { donnees: { origine: 'SLA', vers: apres.escaladeeVersId } });
        const destinataires = [...(await agent(tx, t.agentId)), ...(await superviseurs(tx, t.agentId))];
        await this.cycle.envois(tx, apres, p, maintenant).personnel('sla.depassement', destinataires, true);
        await this.cycle.auditer(tx, t, SYSTEME, 'sla.depassement', {});
        return true;
      }, { sautSiVerrouille: true });
      if (fait) traites++;
    }
    return traites;
  }

  /** Résolue sans réaction du client pendant le délai de la banque (5 jours) : clôture. */
  async cloturesAutomatiques(maintenant: Date): Promise<number> {
    const candidats = await this.systeme.reclamation.findMany({
      where: { statut: 'RESOLUE', clotureAutoPrevueLe: { lte: maintenant } },
      select: { id: true, tenantId: true }, orderBy: { clotureAutoPrevueLe: 'asc' }, take: LOT,
    });
    let traites = 0;
    for (const c of candidats) {
      const fait = await this.cycle.surTicket(c.tenantId, c.id, async (tx, t, p) => {
        if (t.statut !== 'RESOLUE' || !t.clotureAutoPrevueLe || t.clotureAutoPrevueLe > maintenant) return false;
        const apres = await this.cycle.transition(tx, t, 'CLOTURER_AUTOMATIQUEMENT', SYSTEME, maintenant, {
          clotureLe: maintenant, modeCloture: 'AUTOMATIQUE', clotureAutoPrevueLe: null,
        });
        await this.cycle.envois(tx, apres, p, maintenant).client('client.cloture');
        await this.cycle.auditer(tx, t, SYSTEME, 'reclamation.cloture_automatique', {});
        return true;
      }, { sautSiVerrouille: true });
      if (fait) traites++;
    }
    return traites;
  }
}
