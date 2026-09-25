/**
 * Horaires d'ouverture et jours fériés (lireHoraires, remplacerHoraires, listerJoursFeries,
 * ajouterJourFerie, supprimerJourFerie). La semaine est remplacée d'un bloc (décision C11).
 * Hors de ces plages, le chrono SLA ne compte pas.
 */
import { Plus, RefreshCw, Trash2, X } from 'lucide-react';
import type { S } from '../../api/types';
import { Bouton, Panneau } from '../../ui/composants';
import { date, duree } from '../../ui/format';
import { JOURS } from '../../ui/libelles';

const DEBUT_AXE = 6 * 60;
const FIN_AXE = 20 * 60;
const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
const position = (m: number) => `${((m - DEBUT_AXE) / (FIN_AXE - DEBUT_AXE)) * 100}%`;

function Plage({ p }: { p: S<'Plage'> }) {
  return (
    <span className="chiffres inline-flex h-9 items-center gap-1 rounded-lg border border-trait-fort bg-surface pr-1 pl-2.5 text-[15px]">
      <input aria-label="Début" defaultValue={p.debut} className="w-[46px] bg-transparent text-center focus:outline-none" />
      <span className="text-encre-3">à</span>
      <input aria-label="Fin" defaultValue={p.fin} className="w-[46px] bg-transparent text-center focus:outline-none" />
      <button type="button" aria-label="Retirer la plage" className="rounded p-1 text-encre-3 hover:bg-fond"><X size={14} /></button>
    </span>
  );
}

export function Horaires({ horaires, feries, aujourdhui }: { horaires: S<'Horaires'>; feries: S<'JourFerie'>[]; aujourdhui: string }) {
  const parJour = JOURS.map((_, i) => horaires.plages.filter((p) => p.jourSemaine === i + 1));
  const total = horaires.plages.reduce((s, p) => s + minutes(p.fin) - minutes(p.debut), 0);
  const aVenir = feries.filter((f) => f.recurrent || f.date >= aujourdhui.slice(0, 10));
  const graduations = [6, 8, 10, 12, 14, 16, 18, 20];

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-[26px] font-bold tracking-tight">Horaires et jours fériés</h1>
        <p className="mt-1 max-w-[72ch] text-[15px] text-encre-3">Le chrono SLA avance seulement pendant ces heures d'ouverture. La nuit, le week-end et les jours fériés ne comptent pas.</p>
      </div>

      <div className="flex flex-col gap-5">
        <Panneau
          titre="Semaine type"
          action={
            <span className="text-sm text-encre-3">
              Fuseau {horaires.fuseauHoraire.replace('Africa/', '')}, fixé à l'ouverture du service
            </span>
          }
        >
          <div className="grid grid-cols-[96px_330px_minmax(0,1fr)] items-center gap-x-6">
            <span />
            <span />
            <div className="relative mb-1 h-5 text-xs text-encre-3">
              {graduations.map((h) => (
                <span key={h} className="chiffres absolute -translate-x-1/2" style={{ left: position(h * 60) }}>{h}h</span>
              ))}
            </div>
            {JOURS.map((jour, i) => (
              <div key={jour} className="contents">
                <span className="py-2.5 text-[15px] font-semibold first-letter:uppercase">{jour}</span>
                <div className="flex items-center gap-2 py-2">
                  {parJour[i]!.length === 0 ? (
                    <span className="text-[15px] text-encre-3">Fermé</span>
                  ) : (
                    parJour[i]!.map((p) => <Plage key={p.debut} p={p} />)
                  )}
                  <button type="button" aria-label={`Ajouter une plage le ${jour}`} className="rounded-lg p-2 text-encre-3 hover:bg-fond hover:text-encre"><Plus size={16} /></button>
                </div>
                <div className="relative h-6 rounded bg-fond" aria-hidden>
                  {graduations.map((h) => (
                    <span key={h} className="absolute inset-y-0 w-px bg-trait" style={{ left: position(h * 60) }} />
                  ))}
                  {parJour[i]!.map((p) => (
                    <span
                      key={p.debut}
                      className="absolute inset-y-1 rounded-sm bg-marque"
                      style={{ left: position(minutes(p.debut)), width: `calc(${position(minutes(p.fin))} - ${position(minutes(p.debut))})` }}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-5 flex items-center justify-between border-t border-trait pt-4">
            <p className="chiffres text-[15px] text-encre-2">
              <span className="font-bold text-encre">{duree(total)}</span> d'ouverture par semaine
            </p>
            <Bouton variante="principal">Enregistrer la semaine</Bouton>
          </div>
        </Panneau>

        <Panneau titre="Jours fériés" action={<Bouton taille="petit" icone={<Plus aria-hidden size={14} />}>Ajouter</Bouton>} sansMarge>
          <ul className="grid grid-cols-2 gap-x-8 px-5 py-2">
            {aVenir.map((f) => (
              <li key={f.id} className="flex items-center gap-3 border-b border-trait py-2.5">
                <span className="chiffres w-[88px] shrink-0 text-[15px] font-semibold">{f.recurrent ? date(`${f.date}T12:00:00Z`).slice(0, 5) : date(`${f.date}T12:00:00Z`)}</span>
                <span className="min-w-0 flex-1 text-[15px]">
                  {f.libelle}
                  {f.recurrent && (
                    <span className="ml-2 inline-flex items-center gap-1 text-sm text-encre-3">
                      <RefreshCw aria-hidden size={12} />
                      chaque année
                    </span>
                  )}
                </span>
                <button type="button" aria-label={`Supprimer ${f.libelle}`} className="rounded p-1.5 text-encre-3 hover:bg-fond hover:text-urgent"><Trash2 size={16} /></button>
              </li>
            ))}
          </ul>
          <p className="px-5 pt-2 pb-4 text-sm leading-relaxed text-encre-3">
            Les fêtes à date variable (Pâques, Tabaski, Aïd el-Fitr…) s'ajoutent chaque année, une fois la date annoncée.
          </p>
        </Panneau>
      </div>
    </div>
  );
}
