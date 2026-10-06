/**
 * Analyse différée des pièces jointes (étape 22), par le worker chaque minute : les fichiers reçus
 * quand l'antivirus ne répondait pas, et ceux d'avant l'étape 22. Par lots de 20, les plus anciens
 * d'abord ; l'antivirus de nouveau injoignable, le lot s'arrête et reprendra au passage suivant.
 *
 * Sain : téléchargeable. Infecté : le fichier est effacé du stockage, la pièce garde son nom et celui
 * du virus ; l'agent assigné (ou son superviseur) est prévenu, et le journal d'audit le note.
 */
import { journaliser } from '../../infrastructure/audit/journal.js';
import type { BaseDonnees } from '../../infrastructure/base-de-donnees/base-de-donnees.service.js';
import { ErreurAntivirus, type Antivirus } from '../../infrastructure/fichiers/antivirus.js';
import type { Stockage } from '../../infrastructure/stockage/stockage.js';
import { responsables } from '../reclamations/attribution.js';
import { chargerParametres } from '../reclamations/parametres.js';

export const LOT_ANALYSE = 20;
export const MODELE_FICHIER_INFECTE = 'agent.fichier_infecte';

export interface BilanAnalyse {
  saines: number;
  infectees: number;
  enAttente: number;
}

export class AnalyseAntivirus {
  constructor(
    private readonly bd: BaseDonnees,
    private readonly stockage: Stockage,
    private readonly antivirus: Antivirus,
    private readonly horloge: () => Date = () => new Date(),
  ) {}

  async enAttente(): Promise<BilanAnalyse> {
    const bilan: BilanAnalyse = { saines: 0, infectees: 0, enAttente: 0 };
    const pieces = await this.bd.enSysteme((tx) => tx.pieceJointe.findMany({
      where: { antivirus: 'EN_ATTENTE' },
      select: { id: true, tenantId: true, reclamationId: true, cleStockage: true, nomFichier: true },
      orderBy: [{ creeLe: 'asc' }, { id: 'asc' }],
      take: LOT_ANALYSE,
    }));
    for (const p of pieces) {
      const contenu = await this.stockage.lire(p.cleStockage);
      let verdict: Awaited<ReturnType<Antivirus['analyser']>>;
      try {
        // Un fichier disparu du stockage ne peut plus être servi : il n'est pas à analyser
        verdict = contenu ? await this.antivirus.analyser(contenu) : { sain: true };
      } catch (e) {
        if (!(e instanceof ErreurAntivirus)) throw e;
        bilan.enAttente = pieces.length - bilan.saines - bilan.infectees;
        return bilan;
      }
      const maintenant = this.horloge();
      if (verdict.sain) {
        await this.bd.enSysteme((tx) => tx.pieceJointe.update({ where: { id: p.id }, data: { antivirus: 'SAIN', analyseeLe: maintenant } }));
        bilan.saines++;
        continue;
      }
      const virus = verdict.virus;
      await this.stockage.supprimer(p.cleStockage);
      await this.bd.enSysteme(async (tx) => {
        await tx.pieceJointe.update({ where: { id: p.id }, data: { antivirus: 'INFECTE', analyseeLe: maintenant, virus } });
        await journaliser(tx, {
          tenantId: p.tenantId, acteur: 'SYSTEME', action: 'piece_jointe.infectee', entite: 'reclamation', entiteId: p.reclamationId,
          donnees: { pieceJointeId: p.id, virus },
        });
      });
      await this.bd.enBanque(p.tenantId, async (tx) => {
        const r = await tx.reclamation.findFirst({ where: { id: p.reclamationId }, select: { numero: true, agentId: true } });
        if (!r) return;
        const qui = await responsables(tx, await chargerParametres(tx, p.tenantId), maintenant, r.agentId);
        await tx.notification.createMany({
          data: qui.map((d) => ({
            tenantId: p.tenantId, canal: 'IN_APP' as const, modele: MODELE_FICHIER_INFECTE, destinataireUtilisateurId: d.id, reclamationId: p.reclamationId,
            sujet: 'Pièce jointe infectée supprimée',
            contenu: `${r.numero} : l'antivirus a trouvé un virus dans « ${p.nomFichier} » (${virus}). Le fichier a été effacé.`,
            cleDeduplication: `fichier_infecte:${p.id}:${d.id}`,
          })),
          skipDuplicates: true,
        });
      });
      bilan.infectees++;
    }
    return bilan;
  }
}
