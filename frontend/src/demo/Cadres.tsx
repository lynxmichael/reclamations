/**
 * Cadres de la démo, ajustés à l'écran de présentation : le téléphone est réduit pour tenir en
 * hauteur ; le navigateur du back-office est réduit pour tenir en largeur et défile à l'intérieur.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { LockKeyhole } from 'lucide-react';
import { HAUTEUR_TELEPHONE, LARGEUR_BUREAU, LARGEUR_TELEPHONE, Telephone } from '../maquettes/galerie/Cadres';

function useTaille<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [taille, setTaille] = useState({ l: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const mesurer = () => setTaille({ l: el.clientWidth, h: el.clientHeight });
    mesurer();
    const obs = new ResizeObserver(mesurer);
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return [ref, taille] as const;
}

export function TelephoneAjuste({
  couleur,
  heure,
  superposition,
  ecran,
  children,
}: {
  couleur: string;
  heure: string;
  superposition?: ReactNode;
  /** Change à chaque nouvel écran : on revient alors en haut */
  ecran: string;
  children: ReactNode;
}) {
  const [ref, { l, h }] = useTaille<HTMLDivElement>();
  useEffect(() => {
    ref.current?.querySelector('[data-ecran-telephone]')?.scrollTo({ top: 0 });
  }, [ecran, ref]);
  const largeur = LARGEUR_TELEPHONE + 22;
  const hauteur = HAUTEUR_TELEPHONE + 22;
  const echelle = l && h ? Math.min(1, h / hauteur, l / largeur) : 1;
  return (
    <div ref={ref} className="flex h-full min-h-0 w-full items-start justify-center">
      <div style={{ width: largeur * echelle, height: hauteur * echelle }}>
        <div style={{ width: largeur, transform: `scale(${echelle})`, transformOrigin: 'top left' }}>
          <Telephone couleur={couleur} heure={heure} superposition={superposition}>
            {children}
          </Telephone>
        </div>
      </div>
    </div>
  );
}

export function NavigateurAjuste({ adresse, children }: { adresse: string; children: ReactNode }) {
  const [ref, { l, h }] = useTaille<HTMLDivElement>();
  useEffect(() => {
    ref.current?.querySelector('[data-ecran-banque]')?.scrollTo({ top: 0 });
  }, [adresse, ref]);
  const echelle = l ? Math.min(1, l / LARGEUR_BUREAU) : 1;
  const barre = 44;
  return (
    <div ref={ref} className="h-full min-h-0 w-full overflow-hidden">
      {l > 0 && (
        <div
          className="overflow-hidden rounded-xl bg-white shadow-[0_24px_48px_-16px_rgb(23_33_43/0.35)] ring-1 ring-black/10"
          style={{ width: LARGEUR_BUREAU, height: h / echelle, transform: `scale(${echelle})`, transformOrigin: 'top left' }}
        >
          <div className="flex items-center gap-4 border-b border-trait bg-[#eef1f4] px-4" style={{ height: barre }}>
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
          <div className="overflow-y-auto overscroll-contain" style={{ height: h / echelle - barre }} data-ecran-banque>
            <div className="flex min-h-full flex-col [&>*]:grow">{children}</div>
          </div>
        </div>
      )}
    </div>
  );
}
