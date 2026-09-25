/** Cadres de présentation : téléphone (390 × 844) et fenêtre de navigateur (1280 de large). */
import { useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { BatteryFull, LockKeyhole, SignalHigh, Wifi } from 'lucide-react';
import { styleMarque } from '../../ui/marque';

export const LARGEUR_TELEPHONE = 390;
export const HAUTEUR_TELEPHONE = 844;
export const LARGEUR_BUREAU = 1280;

export function Telephone({ couleur, children }: { couleur: string | null; children: ReactNode }) {
  return (
    <div className="max-w-full rounded-[56px] bg-[#1d2127] p-[11px] shadow-[0_30px_60px_-20px_rgb(23_33_43/0.45)] max-[440px]:rounded-none max-[440px]:p-0 max-[440px]:shadow-none" style={{ width: LARGEUR_TELEPHONE + 22 }}>
      <div className="relative flex flex-col overflow-hidden rounded-[45px] bg-white max-[440px]:rounded-none" style={{ height: HAUTEUR_TELEPHONE }}>
        <div style={styleMarque(couleur)} className="flex h-11 shrink-0 items-center justify-between bg-marque px-8 text-[15px] font-semibold text-sur-marque">
          <span className="chiffres">15:10</span>
          <span aria-hidden className="absolute top-2.5 left-1/2 h-[26px] w-[104px] -translate-x-1/2 rounded-full bg-[#1d2127]" />
          <span className="flex items-center gap-1.5" aria-hidden>
            <SignalHigh size={16} strokeWidth={2.6} />
            <Wifi size={16} strokeWidth={2.6} />
            <BatteryFull size={20} strokeWidth={2} />
          </span>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain [&>*]:shrink-0 [&>*]:grow">{children}</div>
      </div>
    </div>
  );
}

/** Réduit un contenu de largeur fixe pour qu'il tienne dans la place disponible. */
function AEchelle({ largeur, children }: { largeur: number; children: ReactNode }) {
  const exterieur = useRef<HTMLDivElement>(null);
  const interieur = useRef<HTMLDivElement>(null);
  const [echelle, setEchelle] = useState(1);
  const [hauteur, setHauteur] = useState<number | undefined>(undefined);
  useLayoutEffect(() => {
    const ext = exterieur.current;
    const int = interieur.current;
    if (!ext || !int) return;
    const mesurer = () => {
      const e = Math.min(1, ext.clientWidth / largeur);
      setEchelle(e);
      setHauteur(int.offsetHeight * e);
    };
    mesurer();
    const obs = new ResizeObserver(mesurer);
    obs.observe(ext);
    obs.observe(int);
    return () => obs.disconnect();
  }, [largeur]);
  return (
    <div ref={exterieur} className="w-full overflow-hidden" style={{ height: hauteur }}>
      <div ref={interieur} style={{ width: largeur, transform: `scale(${echelle})`, transformOrigin: 'top left' }}>
        {children}
      </div>
    </div>
  );
}

export function Navigateur({ adresse, children }: { adresse: string; children: ReactNode }) {
  return (
    <AEchelle largeur={LARGEUR_BUREAU}>
      <div className="overflow-hidden rounded-xl bg-white shadow-[0_24px_48px_-16px_rgb(23_33_43/0.35)] ring-1 ring-black/10">
        <div className="flex h-11 items-center gap-4 border-b border-trait bg-[#eef1f4] px-4">
          <span className="flex gap-2" aria-hidden>
            <span className="h-3 w-3 rounded-full bg-[#c9ced4]" />
            <span className="h-3 w-3 rounded-full bg-[#c9ced4]" />
            <span className="h-3 w-3 rounded-full bg-[#c9ced4]" />
          </span>
          <span className="flex h-7 flex-1 items-center justify-center gap-1.5 rounded-md bg-white text-[13px] text-encre-2">
            <LockKeyhole aria-hidden size={12} />
            {adresse}
          </span>
          <span className="w-12" />
        </div>
        <div className="flex min-h-[800px] flex-col [&>*]:grow">{children}</div>
      </div>
    </AEchelle>
  );
}
