/**
 * La banque présentée dans la démo : l'exemple (Banque Alpha) ou le prospect, saisi avant le
 * rendez-vous. Gardé dans le navigateur de la personne qui présente (localStorage), rien d'autre.
 */
import type { BanqueDemo } from './moteur';

export interface Prospect {
  nom: string;
  couleur: string;
  logoUrl: string | null;
  /** Ligne de contact affichée à la fin de la visite (nom, e-mail ou téléphone du commercial) */
  contact: string;
}

export const EXEMPLE: Prospect = { nom: 'Banque Alpha', couleur: '#0b6e5f', logoUrl: null, contact: '' };

export const COULEURS_PROPOSEES = ['#0b6e5f', '#1d4f91', '#8a1538', '#e0a526', '#00857c', '#5b2a86', '#c8102e', '#17212b'];

const CLE = 'demo-reclamations:prospect';

export function lireProspect(): Prospect {
  try {
    const brut = localStorage.getItem(CLE);
    if (!brut) return EXEMPLE;
    const p = JSON.parse(brut) as Partial<Prospect>;
    if (typeof p.nom !== 'string' || !p.nom.trim() || typeof p.couleur !== 'string') return EXEMPLE;
    return { nom: p.nom, couleur: p.couleur, logoUrl: typeof p.logoUrl === 'string' ? p.logoUrl : null, contact: typeof p.contact === 'string' ? p.contact : '' };
  } catch {
    return EXEMPLE;
  }
}

export function enregistrerProspect(p: Prospect | null) {
  try {
    if (p) localStorage.setItem(CLE, JSON.stringify(p));
    else localStorage.removeItem(CLE);
  } catch {
    // Stockage indisponible (navigation privée) : la démo reste utilisable, sans mémoire
  }
}

const ARTICLES = /^(de|du|des|la|le|les|et|d|l)$/i;
const GENERIQUES = /^(banque|bank|caisse)$/i;

/**
 * Préfixe des numéros et adresse du portail, tirés du nom :
 * « Société Ivoirienne de Banque » → SIB ; « Banque Horizon » → HOR ; « Coris Bank International » → CBI.
 * Formats du contrat : préfixe `^[A-Z0-9]{2,10}$`, slug `^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$`.
 */
export function versBanque(p: Prospect): BanqueDemo {
  const mots = p.nom
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const utiles = mots.filter((m) => !ARTICLES.test(m));
  const distinctifs = utiles.filter((m) => !GENERIQUES.test(m));
  // Plusieurs mots distinctifs : les initiales (sigle) ; sinon le début du nom propre
  const brut =
    distinctifs.length >= 2
      ? utiles.map((m) => m[0]).join('') + (utiles[utiles.length - 1] ?? '').slice(1)
      : (distinctifs[0] ?? utiles[0] ?? 'DEM');
  const prefixe = brut.slice(0, 3).toUpperCase().padEnd(3, 'X');
  const slug =
    (distinctifs.length ? distinctifs : utiles)
      .join('-')
      .toLowerCase()
      .slice(0, 24)
      .replace(/-+$/, '') || 'demo';
  return { nom: p.nom.trim(), slug, prefixe, couleur: p.couleur, logoUrl: p.logoUrl };
}
