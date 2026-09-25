/** Chronologie vue par le client : étapes franchies, puis celles qui restent. */
import { Check } from 'lucide-react';
import type { S } from '../../api/types';
import { cx } from '../../ui/composants';
import { dateLongue } from '../../ui/format';
import { EVENEMENT_CLIENT } from '../../ui/libelles';

export function Etapes({ etapes, statut, fuseau }: { etapes: S<'EtapeSuivi'>[]; statut: S<'StatutReclamation'>; fuseau?: string }) {
  const aVenir =
    statut === 'CLOTUREE' ? [] : statut === 'RESOLUE' ? ['Réclamation clôturée'] : ['Réclamation résolue', 'Réclamation clôturée'];
  const lignes = [
    ...etapes.map((e, i) => ({ libelle: EVENEMENT_CLIENT[e.type] ?? e.type, date: e.date, fait: true, actuel: i === etapes.length - 1 })),
    ...aVenir.map((libelle) => ({ libelle, date: null, fait: false, actuel: false })),
  ];
  return (
    <ol className="relative flex flex-col">
      {lignes.map((l, i) => (
        <li key={`${l.libelle}-${i}`} className="relative flex gap-4 pb-6 last:pb-0">
          {i < lignes.length - 1 && (
            <span aria-hidden className={cx('absolute top-7 bottom-1 left-[13px] w-0.5', lignes[i + 1]!.fait ? 'bg-marque' : 'border-l-2 border-dashed border-trait-fort')} />
          )}
          <span
            aria-hidden
            className={cx(
              'relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
              l.fait ? 'bg-marque text-sur-marque' : 'border-2 border-trait-fort bg-surface',
              l.actuel && 'ring-4 ring-marque-trait',
            )}
          >
            {l.fait && <Check size={15} strokeWidth={3} />}
          </span>
          <div className="pt-0.5">
            <p className={cx('text-[15px] leading-snug', l.fait ? 'font-semibold text-encre' : 'text-encre-3')}>{l.libelle}</p>
            {l.date && <p className="mt-0.5 text-sm text-encre-3 first-letter:uppercase">{dateLongue(l.date, fuseau)}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}
