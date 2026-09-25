/**
 * Le chrono SLA (décision E5) : la jauge du temps ouvré consommé, avec le seuil d'alerte de la
 * banque. Même dessin dans les files (variante « ligne ») et en tête de la fiche (« fiche »).
 * Tout vient de l'API (SlaResume, EtatSla) : l'interface ne recalcule jamais le temps ouvré.
 */
import { CircleCheck, CirclePause, Clock, Siren, TriangleAlert, CircleSlash } from 'lucide-react';
import type { EtatChrono } from '../api/types';
import { cx } from './composants';
import { dateCourte, duree } from './format';
import { ETAT_CHRONO } from './libelles';

export interface Chrono {
  etat: EtatChrono;
  delaiCibleMinutes: number;
  minutesRestantes: number | null;
}

const COULEUR: Record<EtatChrono, { remplissage: string; texte: string; fond: string }> = {
  DANS_LES_DELAIS: { remplissage: 'bg-delai', texte: 'text-delai', fond: 'bg-resolue-doux' },
  ALERTE: { remplissage: 'bg-alerte', texte: 'text-alerte', fond: 'bg-alerte-doux' },
  DEPASSE: { remplissage: 'bg-urgent', texte: 'text-urgent', fond: 'bg-urgent-doux' },
  EN_PAUSE: { remplissage: 'bg-pause', texte: 'text-pause', fond: 'bg-cloturee-doux' },
  ARRETE: { remplissage: 'bg-trait-fort', texte: 'text-encre-3', fond: 'bg-cloturee-doux' },
};
const ICONE: Record<EtatChrono, typeof Clock> = {
  DANS_LES_DELAIS: Clock,
  ALERTE: TriangleAlert,
  DEPASSE: Siren,
  EN_PAUSE: CirclePause,
  ARRETE: CircleSlash,
};

function consomme(c: Chrono): number {
  if (c.minutesRestantes === null || c.delaiCibleMinutes === 0) return 1;
  return Math.min(1, Math.max(0, (c.delaiCibleMinutes - c.minutesRestantes) / c.delaiCibleMinutes));
}

/** « 9 h 42 restantes », « dépassé de 2 h 15 », « 9 h 30 figées » */
export function resteChrono(c: Chrono): string {
  if (c.minutesRestantes === null) return ETAT_CHRONO[c.etat];
  if (c.etat === 'DEPASSE' || c.minutesRestantes < 0) return `dépassé de ${duree(c.minutesRestantes)}`;
  if (c.etat === 'EN_PAUSE') return `${duree(c.minutesRestantes)} figées`;
  return `${duree(c.minutesRestantes)} restantes`;
}

function Piste({ c, seuil, epaisseur }: { c: Chrono; seuil: number; epaisseur: string }) {
  const part = consomme(c);
  const style = COULEUR[c.etat];
  return (
    <div className={cx('relative w-full rounded-full bg-trait', epaisseur)}>
      <div className={cx('absolute inset-y-0 left-0 rounded-full', style.remplissage)} style={{ width: `${part * 100}%` }} />
      {c.etat === 'EN_PAUSE' && (
        <div className="hachures absolute inset-y-0 right-0 rounded-r-full text-pause/45" style={{ left: `${part * 100}%` }} />
      )}
      {c.etat !== 'ARRETE' && (
        <div className="absolute -inset-y-1 w-[2px] rounded bg-encre/55" style={{ left: `calc(${seuil}% - 1px)` }} title={`Seuil d'alerte : ${seuil} %`} />
      )}
    </div>
  );
}

/** Variante des files : une ligne de tableau. */
export function JaugeLigne({ c, echeanceLe, seuil = 75, fuseau }: { c: Chrono; echeanceLe: string | null; seuil?: number; fuseau?: string }) {
  const style = COULEUR[c.etat];
  const Icone = ICONE[c.etat];
  return (
    <div className="flex w-40 flex-col gap-1.5" aria-label={`${ETAT_CHRONO[c.etat]}, ${resteChrono(c)}`}>
      <div className={cx('flex items-center gap-1.5 text-[13px] font-semibold', style.texte)}>
        <Icone aria-hidden size={14} strokeWidth={2.4} />
        <span className="chiffres">{c.etat === 'ARRETE' ? 'Arrêté' : resteChrono(c)}</span>
      </div>
      <Piste c={c} seuil={seuil} epaisseur="h-1.5" />
      <div className="chiffres text-xs text-encre-3">
        {echeanceLe ? `échéance ${dateCourte(echeanceLe, fuseau)}` : c.etat === 'EN_PAUSE' ? 'reprend à la réponse du client' : ' '}
      </div>
    </div>
  );
}

/** Variante de la fiche d'un ticket : le chrono en grand. */
export function JaugeFiche({
  c,
  echeanceLe,
  alertePreventiveLe,
  enPauseDepuis,
  respecte,
  seuil = 75,
  fuseau,
}: {
  c: Chrono;
  echeanceLe: string | null;
  alertePreventiveLe: string | null;
  enPauseDepuis: string | null;
  respecte: boolean | null;
  seuil?: number;
  fuseau?: string;
}) {
  const style = COULEUR[c.etat];
  const Icone = ICONE[c.etat];
  const consommees = c.minutesRestantes === null ? null : c.delaiCibleMinutes - c.minutesRestantes;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className={cx('inline-flex items-center gap-2 rounded-md px-2.5 py-1 text-[15px] font-bold', style.texte, style.fond)}>
          <Icone aria-hidden size={17} strokeWidth={2.4} />
          {ETAT_CHRONO[c.etat]}
        </span>
        {c.etat === 'ARRETE' ? (
          respecte !== null && (
            <span className={cx('inline-flex items-center gap-1.5 text-[15px] font-semibold', respecte ? 'text-resolue' : 'text-urgent')}>
              {respecte ? <CircleCheck aria-hidden size={16} /> : <Siren aria-hidden size={16} />}
              {respecte ? 'SLA respecté' : 'SLA non respecté'}
            </span>
          )
        ) : (
          <span className="chiffres text-2xl font-bold tracking-tight text-encre">
            {c.minutesRestantes !== null && c.minutesRestantes < 0 ? `+${duree(c.minutesRestantes)}` : duree(c.minutesRestantes ?? 0)}
            <span className="ml-2 text-[15px] font-semibold text-encre-3">
              {c.etat === 'EN_PAUSE' ? 'ouvrées figées' : c.etat === 'DEPASSE' ? 'de dépassement' : 'ouvrées restantes'}
            </span>
          </span>
        )}
      </div>
      <Piste c={c} seuil={seuil} epaisseur="h-2.5" />
      <dl className="chiffres grid grid-cols-3 gap-3 text-sm">
        <div>
          <dt className="text-encre-3">Consommé</dt>
          <dd className="font-semibold text-encre">{consommees === null ? '—' : `${duree(Math.max(0, consommees))} sur ${duree(c.delaiCibleMinutes)}`}</dd>
        </div>
        <div>
          <dt className="text-encre-3">Alerte à {seuil}&nbsp;%</dt>
          <dd className="font-semibold text-encre">{alertePreventiveLe ? dateCourte(alertePreventiveLe, fuseau) : '—'}</dd>
        </div>
        <div className="text-right">
          <dt className="text-encre-3">{c.etat === 'EN_PAUSE' ? 'En pause depuis' : 'Échéance'}</dt>
          <dd className="font-semibold text-encre">
            {c.etat === 'EN_PAUSE' && enPauseDepuis ? dateCourte(enPauseDepuis, fuseau) : echeanceLe ? dateCourte(echeanceLe, fuseau) : '—'}
          </dd>
        </div>
      </dl>
    </div>
  );
}
