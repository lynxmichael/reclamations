/**
 * Reporting (étape 9, §6.6) : tableau de bord et export CSV de la banque ; statistiques de toutes
 * les banques et facturation des SMS pour la plateforme.
 */
import { once } from 'node:events';
import { Controller, Inject, Injectable, Logger, Module, Res } from '@nestjs/common';
import type { Response } from 'express';
import { DateTime } from 'luxon';
import type { Prisma } from '../../generated/prisma/client.js';
import { journaliser } from '../../infrastructure/audit/journal.js';
import { BaseDonnees } from '../../infrastructure/base-de-donnees/base-de-donnees.service.js';
import { enSerie } from '../../infrastructure/base-de-donnees/index.js';
import { AppelCourant, EntreesValidees, personnelBanque, traceDe, type Appel, type Entrees } from '../../infrastructure/contrat/appel.js';
import { Operation } from '../../infrastructure/contrat/operation.decorator.js';
import { Probleme } from '../../infrastructure/contrat/probleme.js';
import { HORLOGE, type Horloge } from '../../noyau/noyau.module.js';
import { filtresReclamations } from '../reclamations/reclamations.controller.js';
import { BOM, ligne, type Cellule } from './csv.js';
import {
  CANAUX, MODES_CLOTURE, MOTIFS_CLOTURE, PRIORITES, STATUTS,
  facturationSms, filtresDe, indicateursBanque, indicateursPlateforme, periodeDe, regroupementDe,
} from './indicateurs.js';

/** Lignes d'un export au plus (contrat : 400 EXPORT_TROP_VOLUMINEUX au-delà) */
export const EXPORT_MAX = 50_000;
/** Lignes lues par transaction pendant l'export */
const LOT = 1_000;

const INCLUSION_EXPORT = {
  categorie: { select: { nom: true } },
  agence: { select: { nom: true } },
  agent: { select: { prenom: true, nom: true } },
} satisfies Prisma.ReclamationInclude;

type TicketExporte = Prisma.ReclamationGetPayload<{ include: typeof INCLUSION_EXPORT }>;

export const COLONNES_EXPORT = [
  'Numéro', 'Déposée le', 'Statut', 'Priorité', 'Catégorie', 'Agence', 'Canal', 'Agent',
  'Échéance SLA', 'Prise en charge le', 'Première réponse le', 'Délai de première réponse (min ouvrées)',
  'Résolue le', 'Délai de résolution (min ouvrées)', 'SLA respecté', 'Premier contact',
  'Réouvertures', 'Escaladée le', 'Clôturée le', 'Mode de clôture', 'Motif de clôture forcée',
] as const;

/**
 * Une ligne de l'export. Jamais la description, ni le nom ni les coordonnées du client : le
 * fichier sort de la plateforme (messagerie, poste de travail), le numéro suffit à retrouver
 * la réclamation dans la console.
 */
function valeursExport(t: TicketExporte, fuseau: string): Cellule[] {
  const date = (d: Date | null) => (d ? DateTime.fromJSDate(d, { zone: fuseau }).toFormat('dd/MM/yyyy HH:mm') : null);
  const ouiNon = (b: boolean | null) => (b === null ? null : b ? 'Oui' : 'Non');
  const resolue = t.slaRespecte !== null;
  return [
    t.numero,
    date(t.creeLe),
    STATUTS[t.statut],
    PRIORITES[t.priorite],
    t.categorie.nom,
    t.agence?.nom ?? null,
    CANAUX[t.canal],
    t.agent ? `${t.agent.prenom} ${t.agent.nom}` : null,
    date(t.echeanceSlaLe),
    date(t.prisEnChargeLe),
    date(t.premiereReponseLe),
    t.delaiPremiereReponseMinutes,
    date(t.resolueLe),
    t.delaiResolutionMinutes,
    ouiNon(t.slaRespecte),
    ouiNon(resolue ? !t.passeEnAttenteClient && !t.escaladeeLe && t.nbReouvertures === 0 : null),
    t.nbReouvertures,
    date(t.escaladeeLe),
    date(t.clotureLe),
    t.modeCloture ? MODES_CLOTURE[t.modeCloture] : null,
    t.motifClotureForcee ? MOTIFS_CLOTURE[t.motifClotureForcee] : null,
  ];
}

/** Filtres inscrits au journal : jamais le texte recherché (il peut contenir un nom ou un numéro). */
function filtresAudites(q: Record<string, unknown>): Record<string, unknown> {
  const f: Record<string, unknown> = {};
  for (const [cle, v] of Object.entries(q)) {
    if (v === undefined || v === '') continue;
    f[cle] = cle === 'recherche' ? true : v;
  }
  return f;
}

@Injectable()
export class ServiceReporting {
  private readonly journal = new Logger('Reporting');

  constructor(
    @Inject(BaseDonnees) private readonly bd: BaseDonnees,
    @Inject(HORLOGE) private readonly horloge: Horloge,
  ) {}

  /** Toute la banque ; pour un agent (étape 11), ses réclamations seulement, comme sa file. */
  indicateurs(appel: Appel, q: Record<string, unknown>) {
    const moi = personnelBanque(appel);
    const maintenant = this.horloge();
    return this.bd.enBanque(moi.tenantId, async (tx) => {
      const { fuseauHoraire } = await tx.banque.findUniqueOrThrow({ where: { id: moi.tenantId }, select: { fuseauHoraire: true } });
      const p = periodeDe(q, fuseauHoraire, maintenant);
      const filtres = { ...filtresDe(q, p), ...(moi.role === 'AGENT' ? { agentId: moi.id } : {}) };
      return indicateursBanque(tx, filtres, fuseauHoraire, regroupementDe(p, q.regroupement), maintenant);
    });
  }

  /**
   * Export CSV diffusé par lots de 1 000 lignes (un agent n'exporte que ses réclamations : mêmes
   * règles que sa file, étape 11), du plus récent au plus ancien (curseur sur la
   * date de dépôt : une réclamation déposée pendant l'export ne décale rien). L'export est inscrit
   * au journal d'audit avant le premier octet envoyé.
   */
  async exporter(appel: Appel, q: Record<string, unknown>, res: Response): Promise<void> {
    const moi = personnelBanque(appel);
    const maintenant = this.horloge();
    const { where } = filtresReclamations(moi, q, maintenant);
    const banque = await this.bd.enBanque(moi.tenantId, async (tx) => {
      const [total, b] = await enSerie([
        () => tx.reclamation.count({ where }),
        () => tx.banque.findUniqueOrThrow({ where: { id: moi.tenantId }, select: { fuseauHoraire: true, prefixeTickets: true } }),
      ]);
      if (total > EXPORT_MAX) {
        throw new Probleme(400, 'EXPORT_TROP_VOLUMINEUX', `${total.toLocaleString('fr-FR')} réclamations correspondent à ces filtres : affinez-les (${EXPORT_MAX.toLocaleString('fr-FR')} au plus).`);
      }
      await journaliser(tx, {
        tenantId: moi.tenantId, acteur: moi, action: 'reclamation.export', entite: 'reclamation',
        donnees: { lignes: total, filtres: filtresAudites(q) }, trace: traceDe(appel),
      });
      return b;
    });

    const jour = DateTime.fromJSDate(maintenant, { zone: banque.fuseauHoraire }).toFormat('yyyy-MM-dd');
    res.status(200);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="reclamations-${banque.prefixeTickets.toLowerCase()}-${jour}.csv"`);
    res.setHeader('Cache-Control', 'no-store');
    const ecrire = async (texte: string) => {
      if (!res.write(texte)) await once(res, 'drain');
    };

    try {
      await ecrire(BOM + ligne(COLONNES_EXPORT));
      let curseur: { creeLe: Date; id: string } | null = null;
      for (;;) {
        const apres: Prisma.ReclamationWhereInput = curseur
          ? { OR: [{ creeLe: { lt: curseur.creeLe } }, { creeLe: curseur.creeLe, id: { lt: curseur.id } }] }
          : {};
        const lot: TicketExporte[] = await this.bd.enBanque(moi.tenantId, (tx) => tx.reclamation.findMany({
          where: { AND: [where, apres] }, include: INCLUSION_EXPORT, orderBy: [{ creeLe: 'desc' }, { id: 'desc' }], take: LOT,
        }));
        if (lot.length) await ecrire(lot.map((t) => ligne(valeursExport(t, banque.fuseauHoraire))).join(''));
        if (lot.length < LOT) break;
        const dernier = lot[lot.length - 1]!;
        curseur = { creeLe: dernier.creeLe, id: dernier.id };
      }
      res.end();
    } catch (e) {
      // En-têtes déjà partis : couper la connexion plutôt que livrer un fichier tronqué
      this.journal.error(`Export interrompu : ${(e as Error).message}`);
      res.destroy(e as Error);
    }
  }

  indicateursPlateforme(q: Record<string, unknown>) {
    return this.bd.enPlateforme((tx) =>
      indicateursPlateforme(tx, periodeDe(q, 'utc', this.horloge()), q.banqueId ? String(q.banqueId) : undefined));
  }

  facturationSms(q: Record<string, unknown>) {
    return this.bd.enPlateforme((tx) => facturationSms(tx, String(q.mois)));
  }
}

@Controller()
export class ReportingControleur {
  constructor(@Inject(ServiceReporting) private readonly service: ServiceReporting) {}

  @Operation('lireIndicateurs')
  indicateurs(@AppelCourant() a: Appel, @EntreesValidees() e: Entrees) {
    return this.service.indicateurs(a, e.requete);
  }

  @Operation('exporterReclamations')
  exporter(@AppelCourant() a: Appel, @EntreesValidees() e: Entrees, @Res() res: Response) {
    return this.service.exporter(a, e.requete, res);
  }

  @Operation('lireIndicateursPlateforme')
  indicateursPlateforme(@EntreesValidees() e: Entrees) {
    return this.service.indicateursPlateforme(e.requete);
  }

  @Operation('lireFacturationSms')
  facturationSms(@EntreesValidees() e: Entrees) {
    return this.service.facturationSms(e.requete);
  }
}

@Module({ controllers: [ReportingControleur], providers: [ServiceReporting] })
export class ReportingModule {}
