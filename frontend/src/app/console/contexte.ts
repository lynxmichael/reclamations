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

/** Adresses des pages (décision F4) ; tableau de bord et activité depuis l'étape 9. */
export const ROUTES_BANQUE: Record<PageBackOffice, string> = {
  reclamations: '/reclamations',
  conversations: '/conversations',
  tableau: '/tableau-de-bord',
  agences: '/agences',
  categories: '/parametrage/categories',
  points: '/parametrage/agences',
  horaires: '/parametrage/horaires',
  banque: '/parametrage/banque',
  attribution: '/parametrage/attribution',
  assistant: '/parametrage/assistant',
  personnel: '/personnel',
  absences: '/absences',
  audit: '/journal-audit',
  compte: '/compte',
};
export const PAGES_BANQUE: PageBackOffice[] = [
  'reclamations', 'conversations', 'tableau', 'agences', 'categories', 'points', 'horaires', 'banque', 'attribution', 'assistant', 'personnel', 'absences', 'audit', 'compte',
];
/** Pages de l'attribution automatique (étape 16) : offertes quand Makor a ouvert la fonction à la banque. */
export const PAGES_ATTRIBUTION: PageBackOffice[] = ['attribution', 'absences'];
/** Boîte de réception du chat web (étape 17) : offerte quand Makor a ouvert le chat à la banque. */
export const PAGES_CHAT: PageBackOffice[] = ['conversations'];
/** Base de réponses de l'assistant IA (étape 18) : offerte quand Makor a ouvert l'assistant à la banque. */
export const PAGES_ASSISTANT: PageBackOffice[] = ['assistant'];
export const pagesBanque = (p: S<'ParametresBanque'>): PageBackOffice[] =>
  PAGES_BANQUE.filter((page) => (p.attributionAutomatique || !PAGES_ATTRIBUTION.includes(page)) && (p.chatWeb || !PAGES_CHAT.includes(page))
    && (p.assistantIa || !PAGES_ASSISTANT.includes(page)));

export const ROUTES_PLATEFORME: Record<PageConsole, string> = {
  banques: '/plateforme/banques',
  activite: '/plateforme/activite',
  plans: '/plateforme/plans',
  alertes: '/plateforme/alertes',
  audit: '/plateforme/journal-audit',
  administrateurs: '/plateforme/administrateurs',
};
export const PAGES_PLATEFORME: PageConsole[] = ['banques', 'activite', 'plans', 'alertes', 'audit', 'administrateurs'];

export function pageDe<T extends string>(routes: Record<T, string>, chemin: string): T | null {
  const trouvee = (Object.entries(routes) as [T, string][]).find(([, r]) => chemin === r || chemin.startsWith(`${r}/`));
  return trouvee?.[0] ?? null;
}

/** Le nom complet d'une personne (Moi, Utilisateur). */
export const nomDe = (p: { prenom: string; nom: string }) => `${p.prenom} ${p.nom}`;
