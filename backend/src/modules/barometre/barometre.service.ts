/**
 * Baromètre mensuel de l'expérience client (étape 23) : lecture par l'Admin Entreprise et les
 * superviseurs, décision des recommandations par l'Admin Entreprise.
 *
 * Les baromètres sont publiés par le worker (application/barometre) et figés : la banque ne peut, en
 * base, que lire le baromètre et changer la décision de ses recommandations (droits par colonne).
 * Fonction ouverte banque par banque par Makor : fermée, ces opérations répondent 403
 * FONCTION_NON_OUVERTE ; les baromètres déjà publiés restent en base et reviennent à la réouverture.
 */
import { Inject, Injectable } from '@nestjs/common';
import { DateTime } from 'luxon';
import type { ContenuBarometre } from '../../application/barometre/barometres.js';
import { dateDuMois } from '../../application/barometre/barometres.js';
import { FORMAT_MOIS, peuDeReponses, type Irritant } from '../../domaine/barometre.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { journaliser } from '../../infrastructure/audit/journal.js';
import { BaseDonnees, type ClientTransaction } from '../../infrastructure/base-de-donnees/base-de-donnees.service.js';
import { personnelBanque, traceDe, type Appel, type Personnel } from '../../infrastructure/contrat/appel.js';
import { introuvable, Probleme } from '../../infrastructure/contrat/probleme.js';
import { HORLOGE, type Horloge } from '../../noyau/noyau.module.js';
import type { S } from '../commun.js';

type Moi = Personnel & { tenantId: string };
type Decision = S<'DecisionRecommandationValeur'>;

const fonctionFermee = () => new Probleme(403, 'FONCTION_NON_OUVERTE', 'Le baromètre n\'est pas ouvert à votre banque : adressez-vous à Makor');

const INCLUSION_RECOMMANDATION = {
  categorie: { select: { id: true, nom: true } },
  decideePar: { select: { id: true, prenom: true, nom: true } },
} satisfies Prisma.RecommandationBarometreInclude;

type RecommandationLue = Prisma.RecommandationBarometreGetPayload<{ include: typeof INCLUSION_RECOMMANDATION }>;

const moisDe = (d: Date) => d.toISOString().slice(0, 7);

export const vueRecommandation = (r: RecommandationLue): S<'RecommandationBarometre'> => ({
  id: r.id,
  ordre: r.ordre,
  titre: r.titre,
  constat: r.constat,
  action: r.action,
  categorie: r.categorie ? { id: r.categorie.id, nom: r.categorie.nom } : null,
  priorite: r.priorite as 'HAUTE' | 'MOYENNE',
  source: r.source as 'IA' | 'REGLES',
  decision: r.decision as Decision,
  commentaire: r.commentaire,
  decideePar: r.decideePar ? { id: r.decideePar.id, nom: `${r.decideePar.prenom} ${r.decideePar.nom}` } : null,
  decideeLe: r.decideeLe?.toISOString() ?? null,
});

const vueIrritant = (i: Irritant): S<'Irritant'> => ({
  id: i.cle, nom: i.libelle, score: i.score, reclamations: i.reclamations, precedent: i.precedent, resolues: i.resolues,
  horsDelai: i.horsDelai, contestees: i.contestees, reponses: i.reponses, insatisfaits: i.insatisfaits,
});

@Injectable()
export class ServiceBarometre {
  constructor(
    @Inject(BaseDonnees) private readonly bd: BaseDonnees,
    @Inject(HORLOGE) private readonly horloge: Horloge,
  ) {}

  private dans<T>(appel: Appel, travail: (tx: ClientTransaction, moi: Moi, fuseau: string) => Promise<T>): Promise<T> {
    const moi = personnelBanque(appel);
    return this.bd.enBanque(moi.tenantId, async (tx) => {
      const b = await tx.banque.findUniqueOrThrow({ where: { id: moi.tenantId }, select: { barometre: true, fuseauHoraire: true } });
      if (!b.barometre) throw fonctionFermee();
      return travail(tx, moi, b.fuseauHoraire);
    });
  }

  lister(appel: Appel): Promise<S<'ListeBarometres'>> {
    return this.dans(appel, async (tx, _moi, fuseau) => {
      const lignes = await tx.barometre.findMany({
        orderBy: { mois: 'desc' },
        select: { mois: true, source: true, genereLe: true, contenu: true, recommandations: { select: { decision: true } } },
      });
      return {
        prochainLe: DateTime.fromJSDate(this.horloge(), { zone: fuseau }).startOf('month').plus({ months: 1 }).toISODate()!,
        donnees: lignes.map((l) => {
          const c = l.contenu as unknown as ContenuBarometre;
          return {
            mois: moisDe(l.mois),
            source: l.source as 'IA' | 'REGLES',
            genereLe: l.genereLe.toISOString(),
            reclamations: c.mesures.reclamations,
            tauxRespectSla: c.mesures.tauxRespectSla,
            tauxSatisfaits: c.mesures.tauxSatisfaits,
            recommandations: l.recommandations.length,
            aEtudier: l.recommandations.filter((r) => r.decision === 'A_ETUDIER').length,
          };
        }),
      };
    });
  }

  lire(appel: Appel, mois: string): Promise<S<'Barometre'>> {
    if (!FORMAT_MOIS.test(mois)) throw introuvable('Baromètre introuvable');
    return this.dans(appel, async (tx, moi) => {
      const b = await tx.barometre.findUnique({
        where: { tenantId_mois: { tenantId: moi.tenantId, mois: dateDuMois(mois) } },
        include: { recommandations: { orderBy: { ordre: 'asc' }, include: INCLUSION_RECOMMANDATION } },
      });
      if (!b) throw introuvable('Pas de baromètre pour ce mois');
      const c = b.contenu as unknown as ContenuBarometre;
      return {
        mois,
        du: c.du,
        au: c.au,
        source: b.source as 'IA' | 'REGLES',
        genereLe: b.genereLe.toISOString(),
        mesures: c.mesures,
        precedent: c.precedent,
        peuDeReponses: peuDeReponses(c.mesures),
        tendance: [...c.tendance],
        irritants: c.irritants.map(vueIrritant),
        agences: c.agences.map(vueIrritant),
        themes: c.themes.map((t) => ({ libelle: t.libelle, mentions: t.mentions, negatifs: t.negatifs, positifs: t.positifs, exemples: [...t.exemples] })),
        commentaires: c.commentaires,
        faitsMarquants: [...c.faitsMarquants],
        recommandations: b.recommandations.map(vueRecommandation),
      };
    });
  }

  decider(appel: Appel, mois: string, id: string, d: { decision: Decision; commentaire?: string | null }): Promise<S<'RecommandationBarometre'>> {
    if (!FORMAT_MOIS.test(mois)) throw introuvable('Recommandation introuvable');
    return this.dans(appel, async (tx, moi) => {
      const r = await tx.recommandationBarometre.findFirst({
        where: { id, barometre: { mois: dateDuMois(mois) } }, select: { id: true, decision: true, barometreId: true },
      });
      if (!r) throw introuvable('Recommandation introuvable');
      const commentaire = d.commentaire === undefined ? undefined : d.commentaire?.trim() || null;
      const aEtudier = d.decision === 'A_ETUDIER';
      const maj = await tx.recommandationBarometre.update({
        where: { id },
        data: {
          decision: d.decision,
          ...(commentaire !== undefined ? { commentaire } : {}),
          // Revenir à « à étudier » efface qui a décidé ; sinon la dernière décision fait foi
          decideeParId: aEtudier ? null : moi.id,
          decideeLe: aEtudier ? null : this.horloge(),
        },
        include: INCLUSION_RECOMMANDATION,
      });
      await journaliser(tx, {
        tenantId: moi.tenantId, acteur: moi, action: 'barometre.recommandation', entite: 'recommandation_barometre', entiteId: id,
        donnees: { mois, avant: r.decision, apres: d.decision, commentaire: commentaire !== undefined && commentaire !== null },
        trace: traceDe(appel),
      });
      return vueRecommandation(maj);
    });
  }
}
