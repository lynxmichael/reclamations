import { Logger } from "@nestjs/common";
import type { ConfigurationIa } from "../../configuration/configuration.js";
import type { Consignes } from "../../domaine/ia/consignes.js";
import type { FinaliteIa, IssueAppelIa } from "../../generated/prisma/enums.js";
import type { BaseDonnees } from "../../infrastructure/base-de-donnees/base-de-donnees.service.js";
import {
  coutMicroUsd,
  ErreurFournisseur,
  type FournisseurIa,
} from "../../infrastructure/ia/fournisseurs.js";

export interface ResultatIa<T> {
  readonly resultat: T;
  readonly source: "IA" | "REGLES";
  readonly issue: IssueAppelIa;
}

/** Issues qui ne comptent pas dans le plafond : rien n'a été envoyé. */
const SANS_ENVOI: IssueAppelIa[] = ["REGLES", "PLAFOND"];

export class MoteurIa {
  private readonly journal = new Logger("IA");

  constructor(
    private readonly bd: BaseDonnees,
    private readonly config: ConfigurationIa,
    private readonly fournisseur: FournisseurIa | null,
    private readonly horloge: () => Date,
  ) {}

  /** Le fournisseur configuré, pour l'écran de consommation */
  get configure(): { nom: string; modele: string | null } {
    return {
      nom: this.config.fournisseur,
      modele: this.fournisseur?.modele ?? null,
    };
  }

  async demander<T>(
    tenantId: string,
    finalite: FinaliteIa,
    consignes: Consignes<T> | null,
    repli: () => T,
  ): Promise<ResultatIa<T>> {
    const debut = performance.now();
    let issue: IssueAppelIa;
    let jetonsEntree = 0;
    let jetonsSortie = 0;
    let resultat: T | null = null;
    const f = this.fournisseur;
    if (!f || !consignes || this.config.fournisseur === "regles") {
      issue = "REGLES";
    } else if (await this.plafondAtteint(tenantId)) {
      issue = "PLAFOND";
    } else {
      try {
        const r = await f.demander(
          consignes as Consignes<unknown>,
          AbortSignal.timeout(this.config.delaiMs),
        );
        jetonsEntree = r.jetonsEntree;
        jetonsSortie = r.jetonsSortie;
        resultat = consignes.traduire(r.brute);
        issue = resultat === null ? "REPONSE_INVALIDE" : "OK";
        if (resultat === null)
          this.journal.warn(
            `${f.nom} (${finalite}) : réponse hors des valeurs attendues`,
          );
      } catch (e) {
        if (e instanceof ErreurFournisseur) {
          issue = e.issue;
          jetonsEntree = e.jetonsEntree;
          jetonsSortie = e.jetonsSortie;
        } else {
          issue = "ERREUR";
        }
        // Jamais le contenu : seulement le fournisseur, l'issue et la cause technique
        this.journal.warn(
          `${f.nom} (${finalite}) : ${issue} — ${(e as Error).message.slice(0, 200)}`,
        );
      }
    }
    const cout =
      this.config.fournisseur === "regles" || SANS_ENVOI.includes(issue)
        ? 0
        : coutMicroUsd(jetonsEntree, jetonsSortie, this.config);
    try {
      await this.bd.enBanque(tenantId, (tx) =>
        tx.appelIa.create({
          data: {
            tenantId,
            finalite,
            issue,
            fournisseur: issue === "REGLES" ? "regles" : f!.nom,
            modele: issue === "REGLES" ? null : f!.modele,
            jetonsEntree: SANS_ENVOI.includes(issue) ? 0 : jetonsEntree,
            jetonsSortie: SANS_ENVOI.includes(issue) ? 0 : jetonsSortie,
            coutMicroUsd: cout,
            dureeMs: Math.round(performance.now() - debut),
            creeLe: this.horloge(),
          },
        }),
      );
    } catch (e) {
      // Le journal ne doit pas priver le client de sa réponse
      this.journal.error(`Journal des appels à l'IA : ${(e as Error).message}`);
    }
    return resultat === null
      ? { resultat: repli(), source: "REGLES", issue }
      : { resultat, source: "IA", issue };
  }

  /** Appels envoyés aujourd'hui (jour UTC) par cette banque, comparés au plafond. */
  private async plafondAtteint(tenantId: string): Promise<boolean> {
    const jour = this.horloge();
    const debut = new Date(
      Date.UTC(jour.getUTCFullYear(), jour.getUTCMonth(), jour.getUTCDate()),
    );
    const n = await this.bd.enBanque(tenantId, (tx) =>
      tx.appelIa.count({
        where: { creeLe: { gte: debut }, issue: { notIn: SANS_ENVOI } },
      }),
    );
    return n >= this.config.plafondJour;
  }
}
