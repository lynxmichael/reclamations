/**
 * Session du personnel dans la console (décision B4) : le jeton d'accès (15 min) reste en
 * mémoire, jamais dans le stockage du navigateur ; le refresh token est un cookie httpOnly que
 * seule l'API lit. Au chargement de la page, la session est reprise par rafraichirSession.
 *
 * Le jeton est renouvelé une minute avant son expiration, et sur un 401. Entre onglets, les
 * renouvellements passent l'un après l'autre (verrou Web Locks) : chacun présente le dernier
 * cookie, et la rotation du refresh token ne ferme jamais la session d'un autre onglet.
 */
import { useSyncExternalStore } from 'react';
import type { S } from './types';
import { ErreurApi, creerClient, type Appeler } from './client';

export type EtatSession =
  | { statut: 'reprise' }
  | { statut: 'deconnecte'; motif: 'expiree' | 'volontaire' | null }
  | { statut: 'connecte'; moi: S<'Moi'> };

const MARGE_MS = 60_000;

export class SessionPersonnel {
  private etat: EtatSession = { statut: 'reprise' };
  private jeton: string | null = null;
  private expireLe = 0;
  private minuterie: number | undefined;
  private enCours: Promise<boolean> | null = null;
  private readonly abonnes = new Set<() => void>();
  readonly appeler: Appeler;
  /** Client sans jeton, pour rafraichirSession (cookie) : il ne doit jamais relancer un renouvellement */
  private readonly brut = creerClient();

  constructor() {
    this.appeler = creerClient({
      jeton: () => this.jeton,
      renouveler: () => this.renouveler(),
      surDeconnexion: () => this.terminer('expiree'),
    });
  }

  lire = (): EtatSession => this.etat;
  abonner = (f: () => void) => {
    this.abonnes.add(f);
    return () => this.abonnes.delete(f);
  };
  private changer(etat: EtatSession) {
    this.etat = etat;
    this.abonnes.forEach((f) => f());
  }

  /** Au chargement de la console : une session ouverte dans les 12 dernières heures continue. */
  async reprendre(): Promise<void> {
    if (!(await this.renouveler())) this.changer({ statut: 'deconnecte', motif: null });
  }

  /** Après validerCodeTotp ou activerTotp. */
  ouvrir(session: S<'SessionPersonnel'>): void {
    this.jeton = session.jetonAcces;
    this.expireLe = Date.now() + session.expireDans * 1000;
    window.clearTimeout(this.minuterie);
    this.minuterie = window.setTimeout(() => void this.renouveler(), Math.max(5_000, this.expireLe - Date.now() - MARGE_MS));
    if (this.etat.statut !== 'connecte' || this.etat.moi.id !== session.utilisateur.id || JSON.stringify(this.etat.moi) !== JSON.stringify(session.utilisateur)) {
      this.changer({ statut: 'connecte', moi: session.utilisateur });
    }
  }

  /** Nouveau jeton d'accès par le refresh token ; un seul renouvellement à la fois. */
  renouveler(): Promise<boolean> {
    if (!this.enCours) {
      const faire = async () => {
        try {
          this.ouvrir(await this.brut('rafraichirSession'));
          return true;
        } catch (e) {
          if (e instanceof ErreurApi && e.statut === 0) {
            // Réseau coupé : la session n'est pas perdue, on réessaie plus tard
            window.clearTimeout(this.minuterie);
            this.minuterie = window.setTimeout(() => void this.renouveler(), 15_000);
            return this.etat.statut === 'connecte' && Date.now() < this.expireLe;
          }
          this.terminer(this.etat.statut === 'connecte' ? 'expiree' : null);
          return false;
        }
      };
      const verrou = typeof navigator !== 'undefined' ? navigator.locks : undefined;
      const promesse: Promise<boolean> = verrou ? (verrou.request('reclamations-session', faire) as unknown as Promise<boolean>) : faire();
      this.enCours = promesse.finally(() => {
        this.enCours = null;
      });
    }
    return this.enCours!;
  }

  async deconnecter(): Promise<void> {
    try {
      if (this.jeton) await this.appeler('deconnexion');
    } catch {
      // Déjà fermée côté serveur : rien à faire
    }
    this.terminer('volontaire');
  }

  private terminer(motif: 'expiree' | 'volontaire' | null) {
    window.clearTimeout(this.minuterie);
    this.jeton = null;
    this.expireLe = 0;
    if (this.etat.statut !== 'deconnecte') this.changer({ statut: 'deconnecte', motif });
  }
}

export function useEtatSession(session: SessionPersonnel): EtatSession {
  return useSyncExternalStore(session.abonner, session.lire);
}
