/**
 * Horaires d'ouverture et jours fériés (lireHoraires, remplacerHoraires, listerJoursFeries,
 * ajouterJourFerie, supprimerJourFerie). La semaine est remplacée d'un bloc (décision C11).
 * Hors de ces plages, le chrono SLA ne compte pas.
 */
import { useState } from 'react';
import { Plus, RefreshCw, Trash2, X } from 'lucide-react';
import type { S } from '../../api/types';
import { Dialogue } from '../../ui/Dialogue';
import { Bouton, Champ, Panneau, Saisie } from '../../ui/composants';
import { date, duree } from '../../ui/format';
import { JOURS } from '../../ui/libelles';

type Issue = void | boolean | Promise<boolean>;

export interface ActionsHoraires {
  enregistrer: (plages: S<'Plage'>[]) => Issue;
  ajouterFerie: (v: { date: string; libelle: string; recurrent: boolean }) => Issue;
  supprimerFerie: (f: S<'JourFerie'>) => void;
  occupe?: boolean;
  erreurs?: Record<string, string>;
}

const DEBUT_AXE = 6 * 60;
const FIN_AXE = 20 * 60;
const HEURE = /^([01]\d|2[0-3]):[0-5]\d$/;
const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
const position = (m: number) => `${Math.min(100, Math.max(0, ((m - DEBUT_AXE) / (FIN_AXE - DEBUT_AXE)) * 100))}%`;
const valide = (p: S<'Plage'>) => HEURE.test(p.debut) && HEURE.test(p.fin) && minutes(p.debut) < minutes(p.fin);

function Plage({ p, surChangement, surRetirer }: { p: S<'Plage'>; surChangement?: (p: S<'Plage'>) => void; surRetirer?: () => void }) {
  const invalide = !valide(p);
  return (
    <span className={`chiffres inline-flex h-9 items-center gap-1 rounded-lg border bg-surface pr-1 pl-2.5 text-[15px] ${invalide ? 'border-urgent' : 'border-trait-fort'}`}>
      <input aria-label="Début" value={p.debut} onChange={(e) => surChangement?.({ ...p, debut: e.target.value })} readOnly={!surChangement} maxLength={5} className="w-[46px] bg-transparent text-center focus:outline-none" />
      <span className="text-encre-3">à</span>
      <input aria-label="Fin" value={p.fin} onChange={(e) => surChangement?.({ ...p, fin: e.target.value })} readOnly={!surChangement} maxLength={5} className="w-[46px] bg-transparent text-center focus:outline-none" />
      <button type="button" aria-label="Retirer la plage" onClick={surRetirer} className="rounded p-1 text-encre-3 hover:bg-fond"><X size={14} /></button>
    </span>
  );
}

function FenetreFerie({ actions, surFermer }: { actions: ActionsHoraires; surFermer: () => void }) {
  const [jour, setJour] = useState('');
  const [libelle, setLibelle] = useState('');
  const [recurrent, setRecurrent] = useState(false);
  const e = actions.erreurs ?? {};
  const ajouter = async () => {
    if ((await actions.ajouterFerie({ date: jour, libelle: libelle.trim(), recurrent })) !== false) surFermer();
  };
  return (
    <Dialogue
      titre="Ajouter un jour férié"
      surFermer={surFermer}
      pied={
        <>
          <Bouton variante="discret" onClick={surFermer}>Annuler</Bouton>
          <Bouton variante="principal" disabled={!jour || !libelle.trim() || actions.occupe} onClick={() => void ajouter()}>Ajouter</Bouton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-[170px_minmax(0,1fr)] gap-3">
          <Champ libelle="Date" erreur={e.date}>{(id) => <Saisie id={id} type="date" value={jour} onChange={(x) => setJour(x.target.value)} invalide={!!e.date} />}</Champ>
          <Champ libelle="Libellé" erreur={e.libelle}>{(id) => <Saisie id={id} value={libelle} onChange={(x) => setLibelle(x.target.value)} maxLength={120} placeholder="Ex. Tabaski" />}</Champ>
        </div>
        <label className="flex items-start gap-2.5 text-[15px]">
          <input type="checkbox" checked={recurrent} onChange={(x) => setRecurrent(x.target.checked)} className="mt-1 h-4 w-4 accent-[var(--marque)]" />
          <span>
            Chaque année à la même date
            <span className="block text-sm text-encre-3">Pour les fêtes à date fixe (1er janvier, 7 août…). Les fêtes religieuses changent de date chaque année.</span>
          </span>
        </label>
      </div>
    </Dialogue>
  );
}

export function Horaires({ horaires, feries, aujourdhui, actions }: { horaires: S<'Horaires'>; feries: S<'JourFerie'>[]; aujourdhui: string; actions?: ActionsHoraires }) {
  const [plages, setPlages] = useState<S<'Plage'>[]>(horaires.plages);
  const [ajout, setAjout] = useState(false);
  const modifiee = JSON.stringify(plages) !== JSON.stringify(horaires.plages);
  const toutesValides = plages.every(valide);
  const parJour = JOURS.map((_, i) => plages.map((p, index) => ({ p, index })).filter(({ p }) => p.jourSemaine === i + 1));
  const total = plages.filter(valide).reduce((s, p) => s + minutes(p.fin) - minutes(p.debut), 0);
  const aVenir = [...feries].filter((f) => f.recurrent || f.date >= aujourdhui.slice(0, 10)).sort((a, b) => a.date.slice(5).localeCompare(b.date.slice(5)) || a.date.localeCompare(b.date));
  const graduations = [6, 8, 10, 12, 14, 16, 18, 20];
  const changer = (index: number, p: S<'Plage'>) => setPlages(plages.map((x, i) => (i === index ? p : x)));
  const ajouterPlage = (jour: number) => {
    const duJour = plages.filter((p) => p.jourSemaine === jour).sort((a, b) => a.fin.localeCompare(b.fin));
    const derniere = duJour.at(-1);
    const nouvelle = derniere ? { jourSemaine: jour, debut: '14:00' > derniere.fin ? '14:00' : derniere.fin, fin: '17:30' > derniere.fin ? '17:30' : '18:00' } : { jourSemaine: jour, debut: '08:00', fin: '12:00' };
    setPlages([...plages, nouvelle]);
  };

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
                <div className="flex flex-wrap items-center gap-2 py-2">
                  {parJour[i]!.length === 0 ? (
                    <span className="text-[15px] text-encre-3">Fermé</span>
                  ) : (
                    parJour[i]!.map(({ p, index }) => (
                      <Plage
                        key={index}
                        p={p}
                        surChangement={actions ? (n) => changer(index, n) : undefined}
                        surRetirer={actions ? () => setPlages(plages.filter((_, j) => j !== index)) : undefined}
                      />
                    ))
                  )}
                  <button type="button" aria-label={`Ajouter une plage le ${jour}`} onClick={() => actions && ajouterPlage(i + 1)} className="rounded-lg p-2 text-encre-3 hover:bg-fond hover:text-encre"><Plus size={16} /></button>
                </div>
                <div className="relative h-6 rounded bg-fond" aria-hidden>
                  {graduations.map((h) => (
                    <span key={h} className="absolute inset-y-0 w-px bg-trait" style={{ left: position(h * 60) }} />
                  ))}
                  {parJour[i]!.filter(({ p }) => valide(p)).map(({ p, index }) => (
                    <span
                      key={index}
                      className="absolute inset-y-1 rounded-sm bg-marque"
                      style={{ left: position(minutes(p.debut)), width: `calc(${position(minutes(p.fin))} - ${position(minutes(p.debut))})` }}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-5 flex items-center justify-between gap-4 border-t border-trait pt-4">
            <p className="chiffres text-[15px] text-encre-2">
              <span className="font-bold text-encre">{duree(total)}</span> d'ouverture par semaine
              {!toutesValides && <span className="ml-3 font-semibold text-urgent">Une plage est incomplète : heures au format 08:00, début avant la fin.</span>}
              {actions?.erreurs?.plages && <span className="ml-3 font-semibold text-urgent">{actions.erreurs.plages}</span>}
            </p>
            <div className="flex gap-2">
              {actions && modifiee && <Bouton variante="discret" onClick={() => setPlages(horaires.plages)}>Annuler</Bouton>}
              <Bouton variante="principal" disabled={!!actions && (!modifiee || !toutesValides || actions.occupe)} onClick={() => actions?.enregistrer(plages)}>
                Enregistrer la semaine
              </Bouton>
            </div>
          </div>
        </Panneau>

        <Panneau titre="Jours fériés" action={<Bouton taille="petit" icone={<Plus aria-hidden size={14} />} onClick={() => setAjout(true)}>Ajouter</Bouton>} sansMarge>
          <ul className="grid grid-cols-2 gap-x-8 px-5 py-2">
            {aVenir.length === 0 && <li className="col-span-2 py-4 text-[15px] text-encre-3">Aucun jour férié à venir.</li>}
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
                <button type="button" aria-label={`Supprimer ${f.libelle}`} onClick={() => actions?.supprimerFerie(f)} className="rounded p-1.5 text-encre-3 hover:bg-fond hover:text-urgent"><Trash2 size={16} /></button>
              </li>
            ))}
          </ul>
          <p className="px-5 pt-2 pb-4 text-sm leading-relaxed text-encre-3">
            Les fêtes à date variable (Pâques, Tabaski, Aïd el-Fitr…) s'ajoutent chaque année, une fois la date annoncée.
          </p>
        </Panneau>
      </div>
      {actions && ajout && <FenetreFerie actions={actions} surFermer={() => setAjout(false)} />}
    </div>
  );
}
