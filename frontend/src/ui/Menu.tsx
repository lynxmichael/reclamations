/** Menu d'actions d'une ligne (bouton « … ») : fermé par Échap, par un clic ailleurs ou après un choix. */
import { useEffect, useRef, useState } from 'react';
import { Ellipsis } from 'lucide-react';
import { cx } from './composants';

export interface ChoixMenu {
  libelle: string;
  action: () => void;
  danger?: boolean;
}

export function MenuActions({ libelle, choix }: { libelle: string; choix: ChoixMenu[] }) {
  const [ouvert, setOuvert] = useState(false);
  const zone = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ouvert) return;
    const clic = (e: MouseEvent) => {
      if (!zone.current?.contains(e.target as Node)) setOuvert(false);
    };
    const touche = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOuvert(false);
    };
    document.addEventListener('mousedown', clic);
    document.addEventListener('keydown', touche);
    return () => {
      document.removeEventListener('mousedown', clic);
      document.removeEventListener('keydown', touche);
    };
  }, [ouvert]);
  if (choix.length === 0) return null;
  return (
    <div ref={zone} className="relative inline-block text-left">
      <button type="button" aria-label={libelle} aria-haspopup="menu" aria-expanded={ouvert} onClick={() => setOuvert((o) => !o)} className="rounded-lg p-2 text-encre-3 hover:bg-fond hover:text-encre">
        <Ellipsis size={18} />
      </button>
      {ouvert && (
        <ul role="menu" className="absolute right-0 z-20 mt-1 min-w-[260px] overflow-hidden rounded-xl border border-trait bg-surface py-1 shadow-[0_12px_32px_rgb(23_33_43/0.16)]">
          {choix.map((c) => (
            <li key={c.libelle} role="none">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOuvert(false);
                  c.action();
                }}
                className={cx('block w-full px-4 py-2.5 text-left text-[15px] hover:bg-fond', c.danger ? 'text-urgent' : 'text-encre')}
              >
                {c.libelle}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
