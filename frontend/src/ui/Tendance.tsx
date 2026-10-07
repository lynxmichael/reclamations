/**
 * Petite tendance mensuelle (étape 23, baromètre) : une mesure sur les 6 derniers mois, en petits
 * multiples (un graphique par mesure, un seul axe chacun, jamais deux échelles sur le même).
 *
 * - Un volume (réclamations) en colonnes, un taux (délais respectés, clients satisfaits) en courbe :
 *   une seule série, nommée par le titre, couleur --color-serie-1 ; le dernier mois porte sa valeur.
 * - Colonnes de 4 px arrondies en haut, posées sur la ligne de base ; courbe de 2 px, points cerclés
 *   de la couleur du fond. Un mois sans mesure (aucune réponse) laisse un trou, jamais un zéro.
 * - Survol ou clavier (flèches) : la valeur du mois dans une bulle ; zones de survol de toute la largeur
 *   du mois. Le tableau de toutes les valeurs est donné à côté (Barometre.tsx, « Voir le tableau »).
 */
import { useLayoutEffect, useRef, useState } from 'react';
import { graduations } from './Evolution';
import { nombre } from './format';

export interface PointMensuel {
  readonly mois: string;
  readonly valeur: number | null;
}

const HAUTEUR = 150;
const MARGE = { haut: 18, droite: 12, bas: 26, gauche: 40 };
const COULEUR = 'var(--color-serie-1)';

/** « sept. » ; « sept. 2026 » en long */
export function moisCourt(mois: string, long = false): string {
  return new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', month: long ? 'long' : 'short', ...(long ? { year: 'numeric' } : {}) })
    .format(new Date(`${mois}-01T00:00:00Z`));
}

function useLargeur<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [largeur, setLargeur] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setLargeur(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const o = new ResizeObserver(([e]) => setLargeur(Math.round(e!.contentRect.width)));
    o.observe(el);
    return () => o.disconnect();
  }, []);
  return [ref, largeur];
}

export function Tendance({
  titre,
  points,
  forme,
  format,
  echelle,
}: {
  titre: string;
  points: readonly PointMensuel[];
  forme: 'colonnes' | 'courbe';
  /** Valeur lisible : « 24 », « 79 % » */
  format: (v: number) => string;
  /** Taux : de 0 à 1 (axe 0 à 100 %) ; sinon, graduations rondes jusqu'au maximum */
  echelle?: 'taux';
}) {
  const [ref, largeur] = useLargeur<HTMLDivElement>();
  const [actif, setActif] = useState<number | null>(null);
  const n = points.length;
  const valeurs = points.map((p) => p.valeur).filter((v): v is number => v !== null);
  const ticks = echelle === 'taux' ? [0, 0.5, 1] : graduations(Math.max(0, ...valeurs));
  const haut = ticks[ticks.length - 1]!;
  const l = Math.max(0, largeur - MARGE.gauche - MARGE.droite);
  const h = HAUTEUR - MARGE.haut - MARGE.bas;
  const pas = n ? l / n : 0;
  const cx = (i: number) => MARGE.gauche + pas * (i + 0.5);
  const y = (v: number) => MARGE.haut + h - (v / haut) * h;
  const base = MARGE.haut + h;
  const largeurColonne = Math.max(6, Math.min(28, pas * 0.5));
  const dernier = n ? points[n - 1]! : null;

  // Courbe : un segment par suite de mois mesurés (un mois sans mesure coupe la courbe)
  const segments: string[] = [];
  let courant = '';
  points.forEach((p, i) => {
    if (p.valeur === null) {
      if (courant) segments.push(courant);
      courant = '';
    } else courant += `${courant ? 'L' : 'M'}${cx(i).toFixed(1)},${y(p.valeur).toFixed(1)}`;
  });
  if (courant) segments.push(courant);

  const libelleTick = (t: number) => (echelle === 'taux' ? `${Math.round(t * 100)}` : nombre(t));
  const clavier = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      setActif((i) => Math.min(n - 1, Math.max(0, (i ?? n - 1) + (e.key === 'ArrowRight' ? 1 : -1))));
    } else if (e.key === 'Escape') setActif(null);
  };
  const p = actif === null ? null : points[actif];
  const resume = points.map((pt) => `${moisCourt(pt.mois, true)} : ${pt.valeur === null ? 'non mesuré' : format(pt.valeur)}`).join(' ; ');

  return (
    <figure className="m-0 min-w-0">
      <figcaption className="text-sm font-semibold text-encre-2">
        {titre}
        {echelle === 'taux' && <span className="ml-1 font-normal text-encre-3">(%)</span>}
      </figcaption>
      <div
        ref={ref}
        className="relative mt-1 rounded-md outline-offset-4 focus-visible:outline-2 focus-visible:outline-focus"
        // Avant la mesure, la place du graphique ; ensuite, la hauteur du dessin (qui suit la largeur, à l'impression)
        style={largeur > 0 ? undefined : { height: HAUTEUR }}
        tabIndex={0}
        role="img"
        aria-label={`${titre}, 6 derniers mois : ${resume}. Flèches gauche et droite pour lire chaque mois.`}
        onKeyDown={clavier}
        onFocus={() => setActif((i) => i ?? n - 1)}
        onBlur={() => setActif(null)}
        onPointerLeave={() => setActif(null)}
      >
        {largeur > 0 && n > 0 && (
          <svg viewBox={`0 0 ${largeur} ${HAUTEUR}`} aria-hidden className="block h-auto w-full overflow-visible">
            {ticks.map((t) => (
              <g key={t}>
                <line x1={MARGE.gauche} x2={MARGE.gauche + l} y1={y(t)} y2={y(t)} stroke="var(--color-trait)" strokeWidth="1" shapeRendering="crispEdges" />
                <text x={MARGE.gauche - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-encre-3 text-[12px] tabular-nums">{libelleTick(t)}</text>
              </g>
            ))}
            {points.map((pt, i) => (
              <text key={pt.mois} x={cx(i)} y={HAUTEUR - 6} textAnchor="middle" className={actif === i ? 'fill-encre text-[12px] font-semibold' : 'fill-encre-3 text-[12px]'}>
                {moisCourt(pt.mois)}
              </text>
            ))}
            {actif !== null && <rect x={cx(actif) - pas / 2} y={MARGE.haut} width={pas} height={h} fill="var(--color-fond)" />}
            {forme === 'colonnes' && points.map((pt, i) => {
              if (pt.valeur === null || pt.valeur <= 0) return null;
              const top = y(pt.valeur);
              const r = Math.min(4, (base - top) / 2, largeurColonne / 2);
              const x0 = cx(i) - largeurColonne / 2;
              const x1 = cx(i) + largeurColonne / 2;
              // Haut arrondi, bas droit sur la ligne de base
              return (
                <path
                  key={pt.mois}
                  d={`M${x0},${base}V${top + r}Q${x0},${top} ${x0 + r},${top}H${x1 - r}Q${x1},${top} ${x1},${top + r}V${base}Z`}
                  fill={COULEUR}
                />
              );
            })}
            {forme === 'courbe' && (
              <>
                {segments.map((d) => <path key={d} d={d} fill="none" stroke={COULEUR} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />)}
                {points.map((pt, i) => (pt.valeur === null ? null : (
                  <circle key={pt.mois} cx={cx(i)} cy={y(pt.valeur)} r={actif === i || i === n - 1 ? 4.5 : 3} fill={COULEUR} stroke="var(--color-surface)" strokeWidth="2" />
                )))}
              </>
            )}
            {/* La valeur du dernier mois, en toutes lettres */}
            {actif === null && dernier && dernier.valeur !== null && (
              <text x={cx(n - 1)} y={(forme === 'colonnes' && dernier.valeur <= 0 ? base : y(dernier.valeur)) - 8} textAnchor="middle" className="fill-encre text-[12px] font-bold tabular-nums">
                {format(dernier.valeur)}
              </text>
            )}
            {/* Zones de survol : toute la largeur du mois */}
            {points.map((pt, i) => (
              <rect key={pt.mois} x={cx(i) - pas / 2} y={0} width={pas} height={HAUTEUR} fill="transparent" onPointerEnter={() => setActif(i)} className="pointer-events-auto" />
            ))}
          </svg>
        )}
        {p && (
          <div
            className="pointer-events-none absolute top-0 z-10 rounded-lg border border-trait bg-surface px-3 py-1.5 text-sm whitespace-nowrap shadow-[0_6px_18px_rgb(23_33_43/0.14)]"
            style={actif! < n / 2 ? { left: cx(actif!) + pas / 2 } : { right: largeur - cx(actif!) + pas / 2 }}
            role="status"
          >
            <span className="text-encre-3">{moisCourt(p.mois, true)}</span>
            <span className="chiffres ml-2 font-bold text-encre">{p.valeur === null ? 'non mesuré' : format(p.valeur)}</span>
          </div>
        )}
      </div>
    </figure>
  );
}
