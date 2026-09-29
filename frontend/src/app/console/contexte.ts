/** Ce que partagent les pages de la console : la session, le client d'API, la banque courante. */
import { createContext, useContext } from 'react';
import type { Appeler } from '../../api/client';
import type { SessionPersonnel } from '../../api/session-personnel';
import type { S } from '../../api/types';
import type { PageBackOffice } from '../../ecrans/back-office/CadreBackOffice';
import type { PageConsole } from '../../ecrans/plateforme/Console';

export interface Console {
  session: SessionPersonnel;
  appeler: Appeler;
  moi: S<'Moi'>;
  /** Personnel d'une banque : ses paramètres (couleurs, seuil d'alerte, délai de clôture, plan) */
  parametres: S<'ParametresBanque'> | null;
}

export const ContexteConsole = createContext<Console | null>(null);

export function useConsole(): Console {
  const c = useContext(ContexteConsole);
  if (!c) throw new Error('Page de la console hors de son cadre');
  return c;
}

/** Les paramètres de la banque, pour une page du back-office. */
export function useParametres(): S<'ParametresBanque'> {
  const c = useConsole();
  if (!c.parametres) throw new Error('Page du back-office sans banque');
  return c.parametres;
}

/** Adresses des pages (décision F4). Le tableau de bord et l'activité arrivent à l'étape 9. */
export const ROUTES_BANQUE: Record<PageBackOffice, string> = {
  reclamations: '/reclamations',
  tableau: '/tableau-de-bord',
  categories: '/parametrage/categories',
  points: '/parametrage/agences',
  horaires: '/parametrage/horaires',
  banque: '/parametrage/banque',
  personnel: '/personnel',
  audit: '/journal-audit',
};
export const PAGES_BANQUE: PageBackOffice[] = ['reclamations', 'categories', 'points', 'horaires', 'banque', 'personnel', 'audit'];

export const ROUTES_PLATEFORME: Record<PageConsole, string> = {
  banques: '/plateforme/banques',
  activite: '/plateforme/activite',
  plans: '/plateforme/plans',
  alertes: '/plateforme/alertes',
  audit: '/plateforme/journal-audit',
  administrateurs: '/plateforme/administrateurs',
};
export const PAGES_PLATEFORME: PageConsole[] = ['banques', 'plans', 'alertes', 'audit', 'administrateurs'];

export function pageDe<T extends string>(routes: Record<T, string>, chemin: string): T | null {
  const trouvee = (Object.entries(routes) as [T, string][]).find(([, r]) => chemin === r || chemin.startsWith(`${r}/`));
  return trouvee?.[0] ?? null;
}

/** Le nom complet d'une personne (Moi, Utilisateur). */
export const nomDe = (p: { prenom: string; nom: string }) => `${p.prenom} ${p.nom}`;
