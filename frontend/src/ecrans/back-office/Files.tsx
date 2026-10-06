/**
 * Files de traitement (§6.2) : listerReclamations avec le paramètre `file`, compteurs des
 * onglets et chrono de chaque réclamation (SlaResume), sans recalcul côté interface.
 */
import { useState, type ReactNode } from 'react';
import { ArrowDownUp, ChevronDown, ChevronLeft, ChevronRight, Download, Flame, QrCode, Globe, ArrowUpRight, Sparkles, X } from 'lucide-react';
import type { S } from '../../api/types';
import { Avatar, BadgeStatut, Bouton, Onglets, cx } from '../../ui/composants';
import { ChoixFiltre } from '../../ui/Filtre';
import { nombre, relatif } from '../../ui/format';
import { JaugeLigne } from '../../ui/JaugeSla';
import { IconeCanal } from '../../ui/Canaux';
import { CANAL, STATUT } from '../../ui/libelles';

export type File = 'recues' | 'assignees' | 'urgentes' | 'en-retard' | 'escaladees' | 'toutes';
export type TriFiles = '-creeLe' | 'creeLe' | 'echeanceSlaLe' | '-echeanceSlaLe' | '-priorite';
export type Periode = '7j' | '30j' | 'mois';

/** Critères de la file, portés par l'adresse de la page (étape 8) et envoyés à listerReclamations. */
export interface CriteresFiles {
  file: File;
  statut?: S<'StatutReclamation'>;
  categorieId?: string;
  agenceId?: string;
  canal?: S<'CanalDepot'>;
  agentId?: string;
  periode?: Periode;
  recherche?: string;
  tri: TriFiles;
  page: number;
}

const TRIS: Record<TriFiles, string> = {
  echeanceSlaLe: 'Échéance la plus proche',
  '-creeLe': 'Plus récentes',
  creeLe: 'Plus anciennes',
  '-priorite': 'Urgentes d\'abord',
  '-echeanceSlaLe': 'Échéance la plus lointaine',
};
const PERIODES: Record<Periode, string> = { '7j': '7 derniers jours', '30j': '30 derniers jours', mois: 'Ce mois-ci' };

const FILTRES: Record<File, (r: S<'ReclamationResume'>, moiId: string) => boolean> = {
  recues: (r) => r.agent === null && r.statut !== 'CLOTUREE',
  assignees: (r, moi) => r.agent?.id === moi && r.statut !== 'CLOTUREE',
  urgentes: (r) => r.priorite === 'URGENTE' && r.statut !== 'CLOTUREE',
  'en-retard': (r) => r.enRetard,
  escaladees: (r) => r.escaladee && r.statut !== 'CLOTUREE',
  toutes: () => true,
};

/** Tri « échéance la plus proche » (tri=echeanceSlaLe) : sans échéance en dernier. */
function parEcheance(a: S<'ReclamationResume'>, b: S<'ReclamationResume'>) {
  const cle = (r: S<'ReclamationResume'>) => r.echeanceSlaLe ?? (r.sla.etat === 'EN_PAUSE' ? '9998' : '9999');
  return cle(a).localeCompare(cle(b));
}

function Filtre({ libelle, valeur }: { libelle: string; valeur?: string }) {
  return (
    <button type="button" className={cx('inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm', valeur ? 'border-marque bg-marque-doux font-semibold' : 'border-trait-fort bg-surface text-encre-2 hover:border-encre-3')}>
      {libelle}
      {valeur && <span className="font-normal">: {valeur}</span>}
      <ChevronDown aria-hidden size={15} />
    </button>
  );
}

function Pastille({ children, surRetirer }: { children: ReactNode; surRetirer: () => void }) {
  return (
    <span className="inline-flex h-9 items-center gap-1 rounded-lg border border-marque bg-marque-doux pr-1 pl-3 text-sm font-semibold">
      {children}
      <button type="button" onClick={surRetirer} aria-label="Retirer la recherche" className="rounded p-1 hover:bg-marque-trait"><X size={14} /></button>
    </span>
  );
}

export function Files({
  page,
  moi,
  maintenant,
  fileInitiale = 'toutes',
  seuil,
  surOuvrir,
  surExporter,
  enAvant,
  criteres,
  surCriteres,
  references,
  chargement,
  exportEnCours,
  surValiderSuggestion,
}: {
  page: S<'PageReclamations'>;
  moi: S<'Moi'>;
  maintenant: string;
  fileInitiale?: File;
  seuil: number;
  /** Démo cliquable : ouvrir une fiche, exporter */
  surOuvrir?: (id: string) => void;
  surExporter?: () => void;
  /** Réclamation à mettre en avant (celle que le prospect vient de déposer) */
  enAvant?: string | null;
  /** Étape 8 : file, filtres, tri et page viennent de l'API (listerReclamations) */
  criteres?: CriteresFiles;
  surCriteres?: (c: CriteresFiles) => void;
  references?: { categories: S<'ReferenceNommee'>[]; agences: S<'ReferenceNommee'>[]; agents: S<'ReferenceNommee'>[] };
  /** Nouvelle page en cours de chargement : les lignes actuelles restent visibles */
  chargement?: boolean;
  exportEnCours?: boolean;
  /** Mode suggestion (étape 16) : le superviseur assigne à l'agent proposé, sans ouvrir la fiche */
  surValiderSuggestion?: (r: S<'ReclamationResume'>, agent: S<'ReferenceNommee'>) => void;
}) {
  const [fileLocale, setFileLocale] = useState<File>(fileInitiale);
  const serveur = !!(criteres && surCriteres);
  const file = serveur ? criteres!.file : fileLocale;
  const changer = (c: Partial<CriteresFiles>) => surCriteres?.({ ...criteres!, page: 1, ...c });
  const setFile = (f: File) => (serveur ? changer({ file: f }) : setFileLocale(f));
  const agent = moi.role === 'AGENT';
  const c = page.compteurs;
  const onglets: { cle: File; libelle: string; compte?: number; ton?: 'urgent' | 'marque' }[] = [
    ...(agent ? [] : [{ cle: 'recues' as const, libelle: 'Reçues', compte: c.recues, ton: 'marque' as const }]),
    { cle: 'assignees', libelle: agent ? 'Mes réclamations' : 'Assignées à moi', compte: c.assignees },
    { cle: 'urgentes', libelle: 'Urgentes', compte: c.urgentes, ton: 'urgent' },
    { cle: 'en-retard', libelle: 'En retard', compte: c.enRetard, ton: 'urgent' },
    { cle: 'escaladees', libelle: 'Escaladées', compte: c.escaladees },
    { cle: 'toutes', libelle: 'Toutes' },
  ];
  const lignes = serveur ? page.donnees : page.donnees.filter((r) => FILTRES[file](r, moi.id)).sort(parEcheance);
  const { page: numero, parPage, total } = page.pagination;
  const pages = Math.max(1, Math.ceil(total / parPage));
  const filtres = serveur && (criteres!.statut || criteres!.categorieId || criteres!.agenceId || criteres!.canal || criteres!.agentId || criteres!.periode);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">Réclamations</h1>
          <p className="mt-1 text-[15px] text-encre-3">
            {agent ? 'Les réclamations qui vous sont assignées.' : serveur ? 'Toute la banque, les plus urgentes à portée de main.' : `Toute la banque : ${page.pagination.total} réclamations sur la période.`}
          </p>
        </div>
        {/* Étape 11 : l'agent exporte aussi, ses réclamations seulement */}
        {(!serveur || surExporter) && (
          <Bouton icone={<Download aria-hidden size={17} />} onClick={surExporter} disabled={exportEnCours}>{exportEnCours ? 'Export…' : 'Exporter en CSV'}</Bouton>
        )}
      </div>

      <div className="rounded-xl border border-trait bg-surface">
        <div className="px-4 pt-1">
          <Onglets onglets={onglets} actif={file} surChoix={setFile} />
        </div>
        {serveur ? (
          <div className="flex flex-wrap items-center gap-2 border-b border-trait px-4 py-3">
            {criteres!.recherche && <Pastille surRetirer={() => changer({ recherche: undefined })}>Recherche : {criteres!.recherche}</Pastille>}
            <ChoixFiltre libelle="Statut" valeur={criteres!.statut} options={(Object.keys(STATUT) as S<'StatutReclamation'>[]).map((v) => ({ valeur: v, libelle: STATUT[v] }))} surChoix={(v) => changer({ statut: v })} />
            <ChoixFiltre libelle="Catégorie" valeur={criteres!.categorieId} options={(references?.categories ?? []).map((c) => ({ valeur: c.id, libelle: c.nom }))} surChoix={(v) => changer({ categorieId: v })} />
            {(references?.agences.length ?? 0) > 0 && (
              <ChoixFiltre libelle="Agence" valeur={criteres!.agenceId} options={references!.agences.map((a) => ({ valeur: a.id, libelle: a.nom }))} surChoix={(v) => changer({ agenceId: v })} />
            )}
            <ChoixFiltre libelle="Canal" valeur={criteres!.canal} options={(Object.keys(CANAL) as S<'CanalDepot'>[]).map((v) => ({ valeur: v, libelle: CANAL[v] }))} surChoix={(v) => changer({ canal: v })} />
            {!agent && (references?.agents.length ?? 0) > 0 && (
              <ChoixFiltre libelle="Agent" valeur={criteres!.agentId} options={references!.agents.map((a) => ({ valeur: a.id, libelle: a.nom }))} surChoix={(v) => changer({ agentId: v })} />
            )}
            <ChoixFiltre libelle="Période" valeur={criteres!.periode} options={(Object.keys(PERIODES) as Periode[]).map((v) => ({ valeur: v, libelle: PERIODES[v] }))} surChoix={(v) => changer({ periode: v })} />
            {filtres && (
              <button type="button" onClick={() => changer({ statut: undefined, categorieId: undefined, agenceId: undefined, canal: undefined, agentId: undefined, periode: undefined })} className="h-9 rounded-lg px-2.5 text-sm font-semibold text-marque-texte hover:bg-fond">
                Effacer les filtres
              </button>
            )}
            <label className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm font-semibold text-encre-2 hover:bg-fond">
              <ArrowDownUp aria-hidden size={15} />
              <span className="sr-only">Trier par</span>
              <select value={criteres!.tri} onChange={(e) => changer({ tri: e.target.value as TriFiles })} className="cursor-pointer bg-transparent focus:outline-none">
                {(Object.keys(TRIS) as TriFiles[]).map((t) => (
                  <option key={t} value={t}>{TRIS[t]}</option>
                ))}
              </select>
            </label>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2 border-b border-trait px-4 py-3">
            <Filtre libelle="Statut" />
            <Filtre libelle="Catégorie" />
            <Filtre libelle="Agence" />
            <Filtre libelle="Canal" />
            {!agent && <Filtre libelle="Agent" />}
            <Filtre libelle="Période" valeur="septembre 2026" />
            <button type="button" className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm font-semibold text-encre-2 hover:bg-fond">
              <ArrowDownUp aria-hidden size={15} />
              Échéance la plus proche
            </button>
          </div>
        )}

        <table className={cx('w-full text-left text-[15px] transition-opacity', chargement && 'opacity-60')} aria-busy={chargement || undefined}>
          <thead>
            <tr className="border-b border-trait text-[13px] text-encre-3">
              <th scope="col" className="py-2.5 pr-3 pl-5 font-semibold">Réclamation</th>
              <th scope="col" className="px-3 py-2.5 font-semibold">Catégorie</th>
              <th scope="col" className="px-3 py-2.5 font-semibold">Statut</th>
              <th scope="col" className="px-3 py-2.5 font-semibold">Agent</th>
              <th scope="col" className="px-3 py-2.5 font-semibold">Chrono SLA</th>
              <th scope="col" className="py-2.5 pr-5 pl-3 text-right font-semibold">Déposée</th>
            </tr>
          </thead>
          <tbody>
            {lignes.map((r) => (
              <tr
                key={r.id}
                data-visite={r.id === enAvant ? 'ligne-en-avant' : undefined}
                onClick={() => surOuvrir?.(r.id)}
                className={cx(
                  'group border-b border-trait last:border-0 hover:bg-fond/70',
                  surOuvrir && 'cursor-pointer',
                  r.statut === 'CLOTUREE' && 'text-encre-3',
                  r.id === enAvant && 'bg-marque-doux/70 shadow-[inset_4px_0_0_var(--marque)]',
                )}
              >
                <td className="py-3 pr-3 pl-5 align-top">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <a
                      href={`#${r.id}`}
                      onClick={(e) => {
                        if (surOuvrir) {
                          e.preventDefault();
                          e.stopPropagation();
                          surOuvrir(r.id);
                        }
                      }}
                      className="chiffres font-bold tracking-wide whitespace-nowrap text-encre group-hover:text-marque-texte group-hover:underline">
                      {r.numero}
                    </a>
                    {r.priorite === 'URGENTE' && (
                      <span className="inline-flex items-center gap-0.5 text-sm font-semibold text-urgent">
                        <Flame aria-hidden size={14} strokeWidth={2.4} />
                        Urgente
                      </span>
                    )}
                    {r.escaladee && (
                      <span className="inline-flex items-center gap-0.5 text-sm font-semibold text-en-cours">
                        <ArrowUpRight aria-hidden size={14} strokeWidth={2.4} />
                        Escaladée
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-sm text-encre-2">{r.client.nom}</div>
                </td>
                <td className="px-3 py-3 align-top">
                  <div>{r.categorie.nom}</div>
                  <div className="mt-0.5 flex items-center gap-1 text-sm text-encre-3">
                    {r.canal === 'QR_CODE' ? <QrCode aria-hidden size={13} /> : r.canal === 'LIEN_WEB' ? <Globe aria-hidden size={13} /> : <IconeCanal canal={r.canal} taille={13} />}
                    {r.agence ? r.agence.nom : CANAL[r.canal]}
                  </div>
                </td>
                <td className="px-3 py-3 align-top">
                  <BadgeStatut statut={r.statut} />
                </td>
                <td className="px-3 py-3 align-top">
                  {r.agent ? (
                    <span className="inline-flex items-center gap-2">
                      <Avatar nom={r.agent.nom} taille={26} />
                      <span className={r.agent.id === moi.id ? 'font-semibold' : undefined}>{r.agent.id === moi.id ? 'Moi' : r.agent.nom}</span>
                    </span>
                  ) : agent ? (
                    <span className="text-encre-3">Non assignée</span>
                  ) : r.statut === 'CLOTUREE' ? (
                    <span className="text-encre-3">—</span>
                  ) : r.agentSuggere ? (
                    <span className="flex flex-col items-start gap-1.5">
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-marque bg-marque-doux/60 py-0.5 pr-2.5 pl-2 text-sm" title="Agent disponible le moins chargé du groupe">
                        <Sparkles aria-hidden size={13} className="text-marque-texte" />
                        <span className="sr-only">Suggéré :</span>
                        {r.agentSuggere.nom}
                      </span>
                      <Bouton
                        taille="petit"
                        variante="secondaire"
                        aria-label={`Assigner ${r.numero} à ${r.agentSuggere.nom}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          surValiderSuggestion?.(r, r.agentSuggere!);
                        }}
                      >
                        Valider
                      </Bouton>
                    </span>
                  ) : (
                    <Bouton taille="petit" variante="secondaire">Assigner</Bouton>
                  )}
                </td>
                <td className="px-3 py-3 align-top">
                  <JaugeLigne c={r.sla} echeanceLe={r.echeanceSlaLe} seuil={seuil} />
                </td>
                <td className="chiffres py-3 pr-5 pl-3 text-right align-top text-sm whitespace-nowrap text-encre-2">{relatif(r.creeLe, maintenant)}</td>
              </tr>
            ))}
            {lignes.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-12 text-center text-encre-3">
                  {serveur && (filtres || criteres!.recherche)
                    ? 'Aucune réclamation ne correspond à ces critères.'
                    : 'Aucune réclamation dans cette file. Les nouvelles arrivent ici dès leur dépôt.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <div className="flex items-center justify-between border-t border-trait px-5 py-3 text-sm text-encre-3">
          <span className="chiffres">
            {serveur ? `${nombre(total)} réclamation${total > 1 ? 's' : ''}` : `${lignes.length} réclamation${lignes.length > 1 ? 's' : ''}`}
          </span>
          {serveur ? (
            <span className="flex items-center gap-2">
              <Bouton taille="petit" variante="discret" aria-label="Page précédente" disabled={numero <= 1} onClick={() => surCriteres!({ ...criteres!, page: numero - 1 })} icone={<ChevronLeft aria-hidden size={16} />} />
              <span className="chiffres">Page {numero} sur {pages}</span>
              <Bouton taille="petit" variante="discret" aria-label="Page suivante" disabled={numero >= pages} onClick={() => surCriteres!({ ...criteres!, page: numero + 1 })} icone={<ChevronRight aria-hidden size={16} />} />
            </span>
          ) : (
            <span>Page 1 sur 1</span>
          )}
        </div>
      </div>
    </div>
  );
}
