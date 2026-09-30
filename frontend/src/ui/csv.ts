/**
 * CSV produit dans le navigateur (facturation SMS, étape 9), aux mêmes règles que l'export de
 * l'API : UTF-8 avec BOM, séparateur « ; », CRLF, cellule texte commençant par = + - @ ou une
 * tabulation préfixée d'une apostrophe (injection de formule).
 */
export type Cellule = string | number | null | undefined;

export function cellule(v: Cellule): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  const texte = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[;"\r\n]/.test(texte) || texte !== texte.trim() ? `"${texte.replaceAll('"', '""')}"` : texte;
}

export function csv(lignes: readonly (readonly Cellule[])[]): Blob {
  return new Blob(['\uFEFF' + lignes.map((l) => l.map(cellule).join(';')).join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' });
}
