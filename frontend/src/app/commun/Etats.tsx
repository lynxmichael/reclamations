/** Chargement, erreur de chargement et page introuvable, communs au portail et à la console. */
import type { ReactNode } from 'react';
import { CircleAlert, LoaderCircle, SearchX } from 'lucide-react';
import { ErreurApi, messageErreur } from '../../api/client';
import { Bouton, cx } from '../../ui/composants';

export function Chargement({ texte = 'Chargement…', pleinEcran }: { texte?: string; pleinEcran?: boolean }) {
  return (
    <div role="status" className={cx('flex items-center justify-center gap-2.5 text-[15px] text-encre-3', pleinEcran ? 'min-h-dvh' : 'py-16')}>
      <LoaderCircle aria-hidden size={20} className="animate-spin" />
      {texte}
    </div>
  );
}

export function ErreurChargement({ erreur, surReessayer, pleinEcran }: { erreur: unknown; surReessayer?: () => void; pleinEcran?: boolean }) {
  const titre = erreur instanceof ErreurApi ? erreur.probleme.title : 'Impossible d\'afficher cette page';
  return (
    <div role="alert" className={cx('flex flex-col items-center justify-center px-6 text-center', pleinEcran ? 'min-h-dvh' : 'py-16')}>
      <CircleAlert aria-hidden size={32} className="text-urgent" />
      <p className="mt-3 text-lg font-bold">{titre}</p>
      <p className="mt-1 max-w-[46ch] text-[15px] leading-relaxed text-encre-2">{messageErreur(erreur)}</p>
      {surReessayer && (
        <Bouton className="mt-5" onClick={surReessayer}>
          Réessayer
        </Bouton>
      )}
    </div>
  );
}

export function Introuvable({ titre = 'Page introuvable', children }: { titre?: string; children?: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-fond px-6 text-center text-encre">
      <SearchX aria-hidden size={36} className="text-encre-3" />
      <h1 className="mt-4 text-2xl font-bold tracking-tight">{titre}</h1>
      <div className="mt-2 max-w-[48ch] text-[15px] leading-relaxed text-encre-2">{children ?? 'L\'adresse ne correspond à aucune page. Vérifiez le lien reçu.'}</div>
    </div>
  );
}
