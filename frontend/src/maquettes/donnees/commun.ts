/**
 * Données fictives des maquettes. Toutes sont typées par le contrat et validées contre ses
 * schémas JSON par tests/maquettes.test.ts : une maquette ne peut pas montrer un champ que
 * l'API ne fournira pas.
 *
 * Noms de banques, de personnes et adresses : fictifs.
 */
import type { S } from '../../api/types';

/** L'instant des maquettes : vendredi 25 septembre 2026, 15 h 10 à Abidjan (UTC+0). */
export const MAINTENANT = '2026-09-25T15:10:00Z';
export const FUSEAU = 'Africa/Abidjan';

const PREFIXES = {
  banque: 'a', plan: 'b', categorie: 'c', agence: 'd', point: 'e', utilisateur: 'f',
  client: '1', reclamation: '2', message: '3', piece: '4', notification: '5', ferie: '6',
} as const;

/** Identifiant UUID v7 lisible et stable : id('reclamation', 42). */
export function id(type: keyof typeof PREFIXES, n: number): string {
  const p = PREFIXES[type];
  return `0199${p.repeat(4)}-0000-7000-8000-${String(n).padStart(12, '0')}`;
}

/** Horodatage UTC (Abidjan = UTC) : t('25/09 15:10') */
export function t(jourHeure: string): string {
  const [j, h] = jourHeure.split(' ');
  const [jour, mois] = j!.split('/');
  return `2026-${mois}-${jour}T${h}:00Z`;
}

export const ALPHA: S<'BanquePublique'> = {
  nom: 'Banque Alpha',
  slug: 'alpha',
  logoUrl: null,
  couleurPrimaire: '#0b6e5f',
  couleurSecondaire: '#e3f1ed',
};

/** Seconde banque, pour montrer le portail aux couleurs d'une autre banque (décision E2). */
export const HORIZON: S<'BanquePublique'> = {
  nom: 'Banque Horizon',
  slug: 'horizon',
  logoUrl: null,
  couleurPrimaire: '#e0a526',
  couleurSecondaire: '#1f2a44',
};

export const DOMAINE = 'reclamations.example';
