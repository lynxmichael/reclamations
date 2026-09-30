/**
 * Courbe du tableau de bord (étape 9, décision E7 de l'étape 6) : réclamations déposées et
 * résolues par jour, semaine ou mois, dans le fuseau de la banque.
 *
 * Deux séries sur un seul axe (même unité) ; traits de 2 px, points de fin cerclés de blanc,
 * grille en filets pleins. Survol ou clavier (flèches) : un réticule vertical et une bulle qui
 * donne les deux valeurs du pas. La légende nomme les séries ; « Voir le tableau » donne toutes
 * les valeurs sans survol.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { S } from '../api/types';
import { cx } from './composants';
import { FUSEAU_PAR_DEFAUT, nombre } from './format';

const SERIES = [
  { cle: 'deposees', libelle: 'Déposées', couleur: 'var(--color-serie-1)' },
  { cle: 'resolues', libelle: 'Résolues', couleur: 'var(--color-serie-2)' },
] as const;

const HAUTEUR = 220;
const MARGE = { haut: 14, droite: 48, bas: 30, gauche: 40 };

/** Pas de graduation « ronde » (1, 2, 2,5, 5 × 10ⁿ) pour environ 4 intervalles. */
export function graduations(max: number): number[] {
  if (max <= 0) return [0, 1, 2, 3, 4];
  const brut = max / 4;
  const puissance = 10 ** Math.floor(Math.log10(brut));
  const pas = [1, 2, 2.5, 5, 10].map((m) => m * puissance).find((p) => p >= brut)!;
  const pasEntier = Math.max(1, Math.ceil(pas));
  const haut = Math.ceil(max / pasEntier) * pasEntier;
  return Array.from({ length: haut / pasEntier + 1 }, (_, i) => i * pasEntier);
}

/** Libellé d'un pas : « 12 sept. », « sem. du 7 sept. », « sept. 2026 ». */
export function libellePas(debut: string, regroupement: S<'Regroupement'>, fuseau = FUSEAU_PAR_DEFAUT, long = false): string {
  const d = new Date(debut);
  if (regroupement === 'MOIS') {
    return new Intl.DateTimeFormat('fr-FR', { timeZone: fuseau, month: long ? 'long' : 'short', year: 'numeric' }).format(d);
  }
  const jour = new Intl.DateTimeFormat('fr-FR', { timeZone: fuseau, day: 'numeric', month: long ? 'long' : 'short' }).format(d);
  return regroupement === 'SEMAINE' ? `${long ? 'Semaine du' : 'sem. du'} ${jour}` : long
    ? new Intl.DateTimeFormat('fr-FR', { timeZone: fuseau, weekday: 'long', day: 'numeric', month: 'long' }).format(d)
    : jour;
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

export function Evolution({ evolution, fuseau = FUSEAU_PAR_DEFAUT }: { evolution: S<'Evolution'>; fuseau?: string }) {
  const [ref, largeur] = useLargeur<HTMLDivElement>();
  const [actif, setActif] = useState<number | null>(null);
  const [tableau, setTableau] = useState(false);
  const { points, regroupement } = evolution;
  useEffect(() => setActif(null), [evolution]);

  const n = points.length;
  const max = Math.max(0, ...points.flatMap((p) => [p.deposees, p.resolues]));
  const ticks = graduations(max);
  const haut = ticks[ticks.length - 1]!;
  const l = Math.max(0, largeur - MARGE.gauche - MARGE.droite);
  const h = HAUTEUR - MARGE.haut - MARGE.bas;
  const x = (i: number) => MARGE.gauche + (n <= 1 ? l / 2 : (i / (n - 1)) * l);
  const y = (v: number) => MARGE.haut + h - (v / haut) * h;
  const chemin = (cle: 'deposees' | 'resolues') => points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[cle]).toFixed(1)}`).join('');
  // Au plus 7 dates sous l'axe, toujours la première
  const intervalle = Math.max(1, Math.ceil(n / 7));
  const totaux = { deposees: points.reduce((s, p) => s + p.deposees, 0), resolues: points.reduce((s, p) => s + p.resolues, 0) };
  const unite = regroupement === 'JOUR' ? 'par jour' : regroupement === 'SEMAINE' ? 'par semaine' : 'par mois';

  const dernier = points[n - 1];
  // Valeurs de fin de courbe : seulement si elles ne se chevauchent pas (sinon, légende et bulle)
  const etiquettesFin = !!dernier && Math.abs(y(dernier.deposees) - y(dernier.resolues)) >= 16;

  const indexDe = (clientX: number) => {
    const rect = ref.current!.getBoundingClientRect();
    const px = clientX - rect.left - MARGE.gauche;
    return n <= 1 ? 0 : Math.min(n - 1, Math.max(0, Math.round((px / Math.max(1, l)) * (n - 1))));
  };
  const clavier = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      setActif((i) => Math.min(n - 1, Math.max(0, (i ?? n - 1) + (e.key === 'ArrowRight' ? 1 : -1))));
    } else if (e.key === 'Escape') setActif(null);
  };
  const p = actif === null ? null : points[actif];
  const bulleADroite = actif !== null && x(actif) < MARGE.gauche + l / 2;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-encre-3">
          {nombre(totaux.deposees)} déposées et {nombre(totaux.resolues)} résolues, {unite}
        </p>
        <div className="flex items-center gap-5">
          <ul className="flex items-center gap-4 text-sm text-encre-2" aria-label="Légende">
            {SERIES.map((s) => (
              <li key={s.cle} className="flex items-center gap-2">
                <svg aria-hidden width="18" height="8"><line x1="1" y1="4" x2="17" y2="4" stroke={s.couleur} strokeWidth="2.5" strokeLinecap="round" /></svg>
                {s.libelle}
              </li>
            ))}
          </ul>
          <button type="button" onClick={() => setTableau((t) => !t)} className="text-sm font-semibold text-marque-texte underline-offset-2 hover:underline">
            {tableau ? 'Voir la courbe' : 'Voir le tableau'}
          </button>
        </div>
      </div>

      {tableau ? (
        <div className="max-h-[260px] overflow-y-auto rounded-lg border border-trait">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-surface">
              <tr className="border-b border-trait text-encre-3">
                <th scope="col" className="px-3 py-2 font-semibold">{regroupement === 'JOUR' ? 'Jour' : regroupement === 'SEMAINE' ? 'Semaine' : 'Mois'}</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Déposées</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Résolues</th>
              </tr>
            </thead>
            <tbody>
              {points.map((pt) => (
                <tr key={pt.debut} className="border-b border-trait last:border-0">
                  <td className="px-3 py-1.5 text-encre-2">{libellePas(pt.debut, regroupement, fuseau, true)}</td>
                  <td className="chiffres px-3 py-1.5 text-right">{nombre(pt.deposees)}</td>
                  <td className="chiffres px-3 py-1.5 text-right">{nombre(pt.resolues)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div
          ref={ref}
          className="relative rounded-md outline-offset-4 focus-visible:outline-2 focus-visible:outline-focus"
          style={{ height: HAUTEUR }}
          tabIndex={0}
          role="group"
          aria-label={`Évolution ${unite} : ${totaux.deposees} déposées, ${totaux.resolues} résolues. Flèches gauche et droite pour lire chaque ${regroupement === 'JOUR' ? 'jour' : regroupement === 'SEMAINE' ? 'semaine' : 'mois'}.`}
          onKeyDown={clavier}
          onFocus={() => setActif((i) => i ?? n - 1)}
          onBlur={() => setActif(null)}
          onPointerMove={(e) => n && setActif(indexDe(e.clientX))}
          onPointerLeave={() => setActif(null)}
        >
          {largeur > 0 && n > 0 && (
            <svg width={largeur} height={HAUTEUR} aria-hidden className="block overflow-visible">
              {ticks.map((t) => (
                <g key={t}>
                  <line x1={MARGE.gauche} x2={MARGE.gauche + l} y1={y(t)} y2={y(t)} stroke="var(--color-trait)" strokeWidth="1" shapeRendering="crispEdges" />
                  <text x={MARGE.gauche - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-encre-3 text-[12px] tabular-nums">{nombre(t)}</text>
                </g>
              ))}
              {points.map((pt, i) => (i % intervalle === 0 ? (
                <text key={pt.debut} x={x(i)} y={HAUTEUR - 8} textAnchor={i === 0 && n > 1 ? 'start' : 'middle'} className="fill-encre-3 text-[12px]">
                  {libellePas(pt.debut, regroupement, fuseau)}
                </text>
              ) : null))}
              {actif !== null && (
                <line x1={x(actif)} x2={x(actif)} y1={MARGE.haut} y2={MARGE.haut + h} stroke="var(--color-encre-3)" strokeWidth="1" shapeRendering="crispEdges" />
              )}
              {SERIES.map((s) => (
                <path key={s.cle} d={chemin(s.cle)} fill="none" stroke={s.couleur} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
              ))}
              {SERIES.map((s) => {
                const i = actif ?? n - 1;
                return (
                  <circle key={s.cle} cx={x(i)} cy={y(points[i]![s.cle])} r="4" fill={s.couleur} stroke="var(--color-surface)" strokeWidth="2" />
                );
              })}
              {etiquettesFin && actif === null && SERIES.map((s) => (
                <text key={s.cle} x={x(n - 1) + 9} y={y(dernier![s.cle])} dy="0.32em" className="fill-encre-2 text-[12px] font-semibold tabular-nums">
                  {nombre(dernier![s.cle])}
                </text>
              ))}
            </svg>
          )}
          {p && (
            <div
              className="pointer-events-none absolute top-1 z-10 min-w-40 rounded-lg border border-trait bg-surface px-3 py-2 text-sm shadow-[0_6px_18px_rgb(23_33_43/0.14)]"
              style={bulleADroite ? { left: x(actif!) + 12 } : { right: largeur - x(actif!) + 12 }}
              role="status"
            >
              <div className="mb-1 text-[13px] text-encre-3">{libellePas(p.debut, regroupement, fuseau, true)}</div>
              {SERIES.map((s) => (
                <div key={s.cle} className="flex items-center gap-2">
                  <svg aria-hidden width="14" height="8"><line x1="1" y1="4" x2="13" y2="4" stroke={s.couleur} strokeWidth="2.5" strokeLinecap="round" /></svg>
                  <span className={cx('chiffres font-bold text-encre')}>{nombre(p[s.cle])}</span>
                  <span className="text-encre-2">{s.libelle.toLowerCase()}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
