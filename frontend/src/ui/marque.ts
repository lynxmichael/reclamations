/**
 * Couleurs de la banque (décision E2). La couleur primaire vient de l'API (BanquePublique,
 * ParametresBanque) ; le texte posé dessus est choisi pour rester lisible, quelle que soit la
 * couleur choisie par la banque.
 */
import type { CSSProperties } from 'react';

export const COULEUR_PAR_DEFAUT = '#2f4858';
export const ENCRE = '#17212b';
export const BLANC = '#ffffff';

function canaux(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255) as [number, number, number];
}

/** Luminance relative (WCAG 2.2). */
export function luminance(hex: string): number {
  const [r, g, b] = canaux(hex).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Rapport de contraste WCAG entre deux couleurs (1 à 21). */
export function contraste(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (l1 + 0.05) / (l2 + 0.05);
}

/** Blanc ou encre, celui qui contraste le plus avec la couleur de la banque. */
export function texteSur(fond: string): string {
  return contraste(fond, BLANC) >= contraste(fond, ENCRE) ? BLANC : ENCRE;
}

function versHex(c: [number, number, number]): string {
  return `#${c.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * La couleur de la banque, assombrie juste assez pour servir de texte ou de lien sur fond blanc
 * (contraste 4,5:1 au moins). Une banque au jaune vif garde ainsi des liens lisibles.
 */
export function marquePourTexte(couleur: string): string {
  const base = canaux(couleur);
  for (let t = 0; t <= 1; t += 0.04) {
    const c = versHex(base.map((v) => v * (1 - t)) as [number, number, number]);
    if (contraste(c, BLANC) >= 4.5) return c;
  }
  return ENCRE;
}

export function couleurValide(couleur: string | null | undefined): string {
  return couleur && /^#[0-9a-f]{6}$/i.test(couleur) ? couleur : COULEUR_PAR_DEFAUT;
}

export function styleMarque(couleur: string | null | undefined): CSSProperties {
  const marque = couleurValide(couleur);
  return { '--marque': marque, '--sur-marque': texteSur(marque), '--marque-texte': marquePourTexte(marque) } as CSSProperties;
}
