/**
 * Écriture CSV pour Excel en français (étape 9) : UTF-8 avec BOM, séparateur « ; », fins de
 * ligne CRLF (RFC 4180), guillemets doublés.
 *
 * Injection de formule (CWE-1236) : une cellule texte qui commence par = + - @ ou une tabulation
 * serait exécutée par le tableur. Elle est préfixée d'une apostrophe, que le tableur n'affiche pas.
 * Les nombres ne sont jamais préfixés.
 */

export const BOM = '\uFEFF';
export const SEPARATEUR = ';';

export type Cellule = string | number | null | undefined;

const DEBUT_DE_FORMULE = /^[=+\-@\t\r]/;
const A_PROTEGER = /[;"\r\n]/;

export function cellule(v: Cellule): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  let texte = v;
  if (DEBUT_DE_FORMULE.test(texte)) texte = `'${texte}`;
  return A_PROTEGER.test(texte) || texte !== texte.trim() ? `"${texte.replaceAll('"', '""')}"` : texte;
}

export function ligne(valeurs: readonly Cellule[]): string {
  return `${valeurs.map(cellule).join(SEPARATEUR)}\r\n`;
}
