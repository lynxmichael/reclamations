/**
 * Session du client sur le portail (décision F3) : le jeton obtenu avec le code à usage unique
 * (30 minutes, limité à ce client et à cette banque) est gardé dans le stockage de l'onglet
 * (sessionStorage). Recharger la page ne redemande pas de code, donc pas de nouveau SMS facturé à la
 * banque ; fermer l'onglet ou attendre 30 minutes, si.
 */
import { useSyncExternalStore } from 'react';
import type { S } from './types';
import { creerClient, type Appeler } from './client';

const CLE = 'reclamations.session-client';

interface Enregistree {
  jeton: string;
  expireLe: number;
  /** Couleurs et logo de la banque (les réponses de l'espace client ne les répètent pas) */
  banque: S<'BanquePublique'>;
  /** Le lien de suivi qui a ouvert la session : on y revient en quittant */
  jetonSuivi: string;
}

function lireStockage(): Enregistree | null {
  try {
    const brut = sessionStorage.getItem(CLE);
    if (!brut) return null;
    const s = JSON.parse(brut) as Enregistree;
    return typeof s.jeton === 'string' && s.expireLe > Date.now() && s.banque ? s : null;
  } catch {
    return null;
  }
}

export class SessionClient {
  private session: Enregistree | null = lireStockage();
  private readonly abonnes = new Set<() => void>();
  private minuterie: number | undefined;
  readonly appeler: Appeler = creerClient({ jeton: () => this.jeton(), surDeconnexion: () => this.fermer() });

  constructor() {
    this.programmerFin();
  }

  private valide(): boolean {
    return this.session !== null && this.session.expireLe > Date.now();
  }
  private jeton(): string | null {
    return this.valide() ? this.session!.jeton : null;
  }
  /** La session se ferme d'elle-même à son expiration : l'écran repasse au suivi. */
  private programmerFin() {
    window.clearTimeout(this.minuterie);
    if (this.session) this.minuterie = window.setTimeout(() => this.fermer(), Math.max(0, this.session.expireLe - Date.now()));
  }

  ouverte = (): boolean => this.valide();
  banque = (): S<'BanquePublique'> | null => (this.valide() ? this.session!.banque : null);
  jetonSuivi = (): string | null => this.session?.jetonSuivi ?? null;
  abonner = (f: () => void) => {
    this.abonnes.add(f);
    return () => this.abonnes.delete(f);
  };

  ouvrir(s: S<'SessionClient'>, banque: S<'BanquePublique'>, jetonSuivi: string): void {
    this.session = { jeton: s.jetonClient, expireLe: Date.now() + s.expireDans * 1000, banque, jetonSuivi };
    try {
      sessionStorage.setItem(CLE, JSON.stringify(this.session));
    } catch {
      // Navigation privée stricte : la session vit seulement en mémoire
    }
    this.programmerFin();
    this.abonnes.forEach((f) => f());
  }

  fermer(): void {
    const avait = this.session !== null;
    window.clearTimeout(this.minuterie);
    this.session = null;
    try {
      sessionStorage.removeItem(CLE);
    } catch {
      // rien à effacer
    }
    if (avait) this.abonnes.forEach((f) => f());
  }
}

export function useSessionClientOuverte(s: SessionClient): boolean {
  return useSyncExternalStore(s.abonner, s.ouverte);
}
