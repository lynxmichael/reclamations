/**
 * Travaux du worker (décision A8), planifiés par BullMQ dans Redis :
 *
 * | Travail     | Fréquence        | Rôle                                                        |
 * |-------------|------------------|-------------------------------------------------------------|
 * | taches-sla  | chaque minute    | alerte préventive, dépassement + escalade, clôture auto     |
 * | envois      | toutes les 5 s   | notifications nouvelles (e-mail, SMS, in-app)               |
 * | relances    | toutes les 5 min | notifications en échec temporaire (5 tentatives au plus)    |
 * | purge       | chaque nuit      | codes OTP, sessions et liens expirés                        |
 *
 * Chaque travail est planifié une seule fois dans Redis, quel que soit le nombre de workers :
 * deux workers ne le lancent jamais en double, et les tâches SLA sont de toute façon idempotentes.
 */
import { Logger } from '@nestjs/common';
import { Queue, Worker, type Job } from 'bullmq';
import type { TachesSla } from '../application/reclamations/taches-sla.js';
import type { BaseDonnees } from '../infrastructure/base-de-donnees/base-de-donnees.service.js';
import type { BoiteEnvoi } from '../infrastructure/envois/boite-envoi.js';

export const FILE = 'reclamations-planification';

export const TRAVAUX = {
  'taches-sla': { every: 60_000 },
  envois: { every: 5_000 },
  relances: { every: 5 * 60_000 },
  purge: { pattern: '17 3 * * *', tz: 'Africa/Abidjan' },
} as const;

export type NomTravail = keyof typeof TRAVAUX;

export interface Executants {
  readonly taches: TachesSla;
  readonly boite: BoiteEnvoi;
  readonly bd: BaseDonnees;
  readonly horloge?: () => Date;
}

/** Codes OTP expirés depuis un jour, sessions et liens finis depuis 30 jours. */
export async function purger(bd: BaseDonnees, maintenant: Date) {
  const jour = new Date(maintenant.getTime() - 86_400_000);
  const mois = new Date(maintenant.getTime() - 30 * 86_400_000);
  return bd.enSysteme(async (tx) => ({
    codes: (await tx.codeOtp.deleteMany({ where: { expireLe: { lt: jour } } })).count,
    sessions: (await tx.sessionUtilisateur.deleteMany({ where: { OR: [{ expireLe: { lt: mois } }, { revoqueLe: { lt: mois } }] } })).count,
    liens: (await tx.jetonUtilisateur.deleteMany({ where: { expireLe: { lt: mois } } })).count,
  }));
}

export async function executer(nom: NomTravail, e: Executants): Promise<unknown> {
  const maintenant = e.horloge?.() ?? new Date();
  switch (nom) {
    case 'taches-sla': return e.taches.toutes(maintenant);
    case 'envois': return e.boite.vider(false);
    case 'relances': return e.boite.vider(true);
    case 'purge': return purger(e.bd, maintenant);
  }
}

export class Planificateur {
  private readonly journal = new Logger('Worker');
  private file?: Queue;
  private worker?: Worker;

  constructor(private readonly redisUrl: string, private readonly e: Executants) {}

  async demarrer(): Promise<void> {
    const connexion = { url: this.redisUrl, maxRetriesPerRequest: null };
    this.file = new Queue(FILE, { connection: connexion });
    for (const [nom, repetition] of Object.entries(TRAVAUX)) {
      await this.file.upsertJobScheduler(nom, repetition, { name: nom, opts: { removeOnComplete: 100, removeOnFail: 500 } });
    }
    this.worker = new Worker(FILE, async (job: Job) => {
      const debut = Date.now();
      const bilan = await executer(job.name as NomTravail, this.e);
      const utile = bilan && Object.values(bilan as Record<string, number>).some((n) => n > 0);
      if (utile) this.journal.log(`${job.name} : ${JSON.stringify(bilan)} (${Date.now() - debut} ms)`);
      return bilan;
    }, { connection: connexion, concurrency: 1 });
    this.worker.on('failed', (job, err) => this.journal.error(`${job?.name} en échec : ${err.message}`));
    this.journal.log(`Travaux planifiés : ${Object.keys(TRAVAUX).join(', ')}`);
  }

  async arreter(): Promise<void> {
    await this.worker?.close();
    await this.file?.close();
  }
}
