/**
 * Files de traitement (§6.2) : listerReclamations avec le paramètre `file`, compteurs des
 * onglets et chrono de chaque réclamation (SlaResume), sans recalcul côté interface.
 */
import { useState } from 'react';
import { ArrowDownUp, ChevronDown, Download, Flame, QrCode, Globe, ArrowUpRight } from 'lucide-react';
import type { S } from '../../api/types';
import { Avatar, BadgeStatut, Bouton, Onglets, cx } from '../../ui/composants';
import { relatif } from '../../ui/format';
import { JaugeLigne } from '../../ui/JaugeSla';
import { CANAL } from '../../ui/libelles';

type File = 'recues' | 'assignees' | 'urgentes' | 'en-retard' | 'escaladees' | 'toutes';

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

export function Files({
  page,
  moi,
  maintenant,
  fileInitiale = 'toutes',
  seuil,
}: {
  page: S<'PageReclamations'>;
  moi: S<'Moi'>;
  maintenant: string;
  fileInitiale?: File;
  seuil: number;
}) {
  const [file, setFile] = useState<File>(fileInitiale);
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
  const lignes = page.donnees.filter((r) => FILTRES[file](r, moi.id)).sort(parEcheance);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">Réclamations</h1>
          <p className="mt-1 text-[15px] text-encre-3">
            {agent ? 'Les réclamations qui vous sont assignées.' : `Toute la banque : ${page.pagination.total} réclamations sur la période.`}
          </p>
        </div>
        {!agent && (
          <Bouton icone={<Download aria-hidden size={17} />}>Exporter en CSV</Bouton>
        )}
      </div>

      <div className="rounded-xl border border-trait bg-surface">
        <div className="px-4 pt-1">
          <Onglets onglets={onglets} actif={file} surChoix={setFile} />
        </div>
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

        <table className="w-full text-left text-[15px]">
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
              <tr key={r.id} className={cx('group border-b border-trait last:border-0 hover:bg-fond/70', r.statut === 'CLOTUREE' && 'text-encre-3')}>
                <td className="py-3 pr-3 pl-5 align-top">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <a href={`#${r.id}`} className="chiffres font-bold tracking-wide whitespace-nowrap text-encre group-hover:text-marque-texte group-hover:underline">
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
                    {r.canal === 'QR_CODE' ? <QrCode aria-hidden size={13} /> : <Globe aria-hidden size={13} />}
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
                  Aucune réclamation dans cette file. Les nouvelles arrivent ici dès leur dépôt.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <div className="flex items-center justify-between border-t border-trait px-5 py-3 text-sm text-encre-3">
          <span>
            {lignes.length} réclamation{lignes.length > 1 ? 's' : ''}
          </span>
          <span>Page 1 sur 1</span>
        </div>
      </div>
    </div>
  );
}
