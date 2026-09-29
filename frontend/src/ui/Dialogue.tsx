/**
 * Fenêtre de dialogue (création, modification, confirmation) : fond assombri, fermeture par Échap
 * ou par la croix, focus placé dans la fenêtre à l'ouverture et rendu à l'élément d'origine ensuite.
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cx } from './composants';

export function Dialogue({
  titre,
  description,
  children,
  pied,
  surFermer,
  large,
  cote,
  cadre,
}: {
  titre: string;
  description?: ReactNode;
  children: ReactNode;
  /** Boutons du bas (Annuler, Enregistrer) */
  pied?: ReactNode;
  surFermer: () => void;
  large?: boolean;
  /** Panneau glissé depuis la droite plutôt que fenêtre centrée */
  cote?: boolean;
  /** Au-dessus du cadre de l'écran (galerie des maquettes) plutôt que de toute la fenêtre */
  cadre?: boolean;
}) {
  const boite = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const avant = document.activeElement as HTMLElement | null;
    const premier = boite.current?.querySelector<HTMLElement>('[autofocus], input:not([type=hidden]), textarea, select, button:not([aria-label="Fermer"])');
    (premier ?? boite.current)?.focus();
    const touche = (e: KeyboardEvent) => {
      if (e.key === 'Escape') surFermer();
    };
    document.addEventListener('keydown', touche);
    return () => {
      document.removeEventListener('keydown', touche);
      avant?.focus?.();
    };
  }, []);

  return (
    <div className={cx(cadre ? 'absolute' : 'fixed', 'inset-0 z-40 flex bg-encre/35', cote ? 'justify-end' : 'items-start justify-center overflow-auto px-4 pt-[8vh] pb-8')}>
      <div
        ref={boite}
        role="dialog"
        aria-modal="true"
        aria-label={titre}
        tabIndex={-1}
        className={cx(
          'flex flex-col bg-surface text-encre shadow-[0_24px_64px_rgb(23_33_43/0.28)] focus:outline-none',
          cote ? 'h-full w-full max-w-[520px]' : cx('w-full rounded-2xl', large ? 'max-w-[680px]' : 'max-w-[520px]'),
        )}
      >
        <div className={cx('flex items-start justify-between gap-4 px-6 pt-5', cote && 'border-b border-trait pb-4')}>
          <div>
            <h2 className="text-xl font-bold">{titre}</h2>
            {description && <div className="mt-1.5 text-[15px] leading-relaxed text-encre-2">{description}</div>}
          </div>
          <button type="button" aria-label="Fermer" onClick={surFermer} className="rounded p-1 text-encre-3 hover:bg-fond">
            <X size={20} />
          </button>
        </div>
        <div className={cx('px-6 py-5', cote && 'flex-1 overflow-auto')}>{children}</div>
        {pied && <div className={cx('flex justify-end gap-2 px-6 pb-5', cote && 'border-t border-trait pt-4')}>{pied}</div>}
      </div>
    </div>
  );
}
