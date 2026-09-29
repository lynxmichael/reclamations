/**
 * Accès à la base pour l'API et le worker (décision A10 de l'étape 3) : chaque opération tient
 * dans une transaction, ouverte dans le contexte qui lui revient — la banque de l'utilisateur,
 * la plateforme (Super Admin) ou le système (authentification, résolution d'un lien public, worker).
 */
import { contexte, creerClientBase, transactionEn, type ClientBase, type ClientTransaction } from './contexte.js';

export class BaseDonnees {
  readonly base: ClientBase;

  constructor(url: string, options: { delaiTransaction?: number } = {}) {
    this.base = creerClientBase(url, options);
  }

  /** Personnel d'une banque ou portail client : la RLS ne laisse voir que cette banque. */
  enBanque<T>(tenantId: string, travail: (tx: ClientTransaction) => Promise<T>): Promise<T> {
    return transactionEn(this.base, contexte.banque(tenantId), travail);
  }

  /** Super Admin : toutes les banques, métadonnées seulement (arbitrage 7). */
  enPlateforme<T>(travail: (tx: ClientTransaction) => Promise<T>): Promise<T> {
    return transactionEn(this.base, contexte.plateforme(), travail);
  }

  /** Lecture ou écriture ciblée hors banque : authentification, lien public, worker. */
  enSysteme<T>(travail: (tx: ClientTransaction) => Promise<T>): Promise<T> {
    return transactionEn(this.base, contexte.systeme(), travail);
  }

  async fermer(): Promise<void> {
    await this.base.$disconnect();
  }
}

export type { ClientTransaction };
