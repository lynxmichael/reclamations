import { GRAINE_TOTP_DEMO, MOT_DE_PASSE_DEMO } from "./jeu-de-donnees.js";

export interface ParametresDemonstration {
  readonly motDePasse: string;
  readonly graineTotp: string;
  /** Environnement de démonstration en ligne (production + DEMONSTRATION=1) */
  readonly enLigne: boolean;
}

export function parametresDemonstration(
  env: NodeJS.ProcessEnv = process.env,
): ParametresDemonstration {
  const production = env.NODE_ENV === "production";
  if (!production) {
    return {
      motDePasse: env.DEMO_MOT_DE_PASSE?.trim() || MOT_DE_PASSE_DEMO,
      graineTotp: env.DEMO_GRAINE_TOTP?.trim() || GRAINE_TOTP_DEMO,
      enLigne: false,
    };
  }
  if (env.DEMONSTRATION !== "1") {
    throw new Error(
      "Jeu de démonstration refusé en production (seul l'environnement de démonstration, DEMONSTRATION=1, le permet)",
    );
  }
  const motDePasse = env.DEMO_MOT_DE_PASSE?.trim() ?? "";
  const graineTotp = env.DEMO_GRAINE_TOTP?.trim() ?? "";
  const erreurs: string[] = [];
  if (motDePasse.length < 12 || motDePasse === MOT_DE_PASSE_DEMO)
    erreurs.push(
      "DEMO_MOT_DE_PASSE : 12 caractères au moins, différent de celui du dépôt",
    );
  if (graineTotp.length < 32 || graineTotp === GRAINE_TOTP_DEMO)
    erreurs.push(
      "DEMO_GRAINE_TOTP : 32 caractères au moins (openssl rand -hex 32)",
    );
  if (erreurs.length)
    throw new Error(
      `Environnement de démonstration mal configuré :\n  - ${erreurs.join("\n  - ")}`,
    );
  return { motDePasse, graineTotp, enLigne: true };
}
