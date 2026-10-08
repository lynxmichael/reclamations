import { hkdfSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ConfigurationAntivirus } from "../infrastructure/fichiers/antivirus.js";
import { MAXIMUM_PAR_DEFAUT } from "../infrastructure/securite/anti-robot.js";

export interface Configuration {
  readonly production: boolean;
  readonly version: string;
  readonly port: number;

  readonly trustProxy: string;
  readonly baseDeDonneesUrl: string;
  readonly redisUrl: string;

  readonly secretJwt: Uint8Array;

  readonly cleTotp: Buffer;

  readonly cleOtp: Buffer;
  readonly domaine: string;

  readonly modeleUrlPortail: string;

  readonly urlConsole: string;

  readonly cookieSecure: boolean;
  readonly stockageDossier: string;
  readonly contratChemin: string;
  readonly smtpUrl: string;
  readonly emailExpediteur: string;
  readonly sms: ConfigurationSms;

  readonly validerReponses: boolean;

  readonly antiRobotMaximum: number;

  readonly ia: ConfigurationIa;

  readonly whatsapp: ConfigurationWhatsapp;

  readonly smsEntrantSecret: string | null;

  readonly cleCanaux: Buffer;

  readonly antivirus: ConfigurationAntivirus;
}

export interface ConfigurationWhatsapp {
  readonly envoi: "meta" | "journal";
  readonly url: string;
  readonly version: string;

  readonly secretApp: string | null;

  readonly jetonVerification: string | null;
}

export type NomFournisseurIa = "anthropic" | "openai" | "mistral";
export const FOURNISSEURS_IA: readonly NomFournisseurIa[] = [
  "anthropic",
  "openai",
  "mistral",
];

export const URL_IA_PAR_DEFAUT: Record<NomFournisseurIa, string> = {
  anthropic: "https://api.anthropic.com/v1/messages",
  openai: "https://api.openai.com/v1/chat/completions",
  mistral: "https://api.mistral.ai/v1/chat/completions",
};

export interface ConfigurationFournisseurIa {
  readonly fournisseur: NomFournisseurIa;
  readonly modele: string;
  readonly cle: string;
  readonly url: string;

  readonly delaiMs: number;

  readonly prixEntree: number;
  readonly prixSortie: number;
}

export type ConfigurationIa = (
  | { readonly fournisseur: "regles" }
  | ConfigurationFournisseurIa
) & {
  readonly plafondJour: number;
};

export type ConfigurationSms =
  | { readonly mode: "journal" }
  | {
      readonly mode: "http";
      readonly url: string;
      readonly cle: string;
      readonly expediteur: string;
    };

const SECRETS_DE_DEVELOPPEMENT = [
  "developpement-uniquement-changer-en-production-0123456789",
  "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
  "developpement-uniquement-cle-otp-0123456789abcdef",
];

class ErreurConfiguration extends Error {
  constructor(erreurs: string[]) {
    super(`Configuration invalide :\n  - ${erreurs.join("\n  - ")}`);
    this.name = "ErreurConfiguration";
  }
}

export function lireConfiguration(
  env: NodeJS.ProcessEnv = process.env,
): Configuration {
  const erreurs: string[] = [];
  const production = env.NODE_ENV === "production";

  const requise = (nom: string): string => {
    const v = env[nom]?.trim();
    if (!v) erreurs.push(`${nom} est obligatoire`);
    return v ?? "";
  };
  const secret = (nom: string, longueurMin: number): string => {
    const v = requise(nom);
    if (v && v.length < longueurMin)
      erreurs.push(`${nom} doit faire au moins ${longueurMin} caractères`);
    if (v && production && SECRETS_DE_DEVELOPPEMENT.includes(v))
      erreurs.push(
        `${nom} a la valeur de développement : interdit en production`,
      );
    return v;
  };
  const booleen = (nom: string, defaut: boolean): boolean => {
    const v = env[nom]?.trim().toLowerCase();
    if (!v) return defaut;
    if (["1", "true", "oui"].includes(v)) return true;
    if (["0", "false", "non"].includes(v)) return false;
    erreurs.push(`${nom} doit valoir true ou false`);
    return defaut;
  };

  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port <= 0 || port > 65535)
    erreurs.push("PORT invalide");

  const cleTotpTexte = secret("CLE_CHIFFREMENT_TOTP", 32);
  let cleTotp = Buffer.alloc(0);
  if (cleTotpTexte) {
    cleTotp = /^[0-9a-f]{64}$/i.test(cleTotpTexte)
      ? Buffer.from(cleTotpTexte, "hex")
      : Buffer.from(cleTotpTexte, "base64");
    if (cleTotp.length !== 32)
      erreurs.push(
        "CLE_CHIFFREMENT_TOTP doit faire 32 octets (64 caractères hexadécimaux ou base64)",
      );
  }

  const domaine = env.DOMAINE_PLATEFORME?.trim() || "reclamations.example";
  const modeleUrlPortail =
    env.URL_PORTAIL?.trim() || `https://{slug}.${domaine}`;
  if (!modeleUrlPortail.includes("{slug}"))
    erreurs.push("URL_PORTAIL doit contenir {slug}");
  const urlConsole = (
    env.URL_CONSOLE?.trim() || `https://console.${domaine}`
  ).replace(/\/+$/, "");
  const cookieSecure = booleen("COOKIE_SECURE", true);
  if (production && !cookieSecure)
    erreurs.push("COOKIE_SECURE=false est interdit en production");

  const antiRobotMaximum = Number(
    env.ANTI_ROBOT_MAXIMUM?.trim() || MAXIMUM_PAR_DEFAUT,
  );
  if (
    !Number.isInteger(antiRobotMaximum) ||
    antiRobotMaximum < 1 ||
    antiRobotMaximum > 10_000_000
  ) {
    erreurs.push("ANTI_ROBOT_MAXIMUM doit être un entier entre 1 et 10000000");
  }

  const contratChemin = resolve(
    env.CONTRAT_CHEMIN?.trim() ||
      resolve(process.cwd(), "../contrat/openapi.yaml"),
  );

  const config: Configuration = {
    production,
    // Étiquette de l'image construite (VERSION de .env.production), sinon version du package.json
    version: env.APP_VERSION?.trim() || lireVersion(),
    port,
    trustProxy: env.TRUST_PROXY?.trim() || "loopback, linklocal, uniquelocal",
    baseDeDonneesUrl: requise("APP_DATABASE_URL"),
    redisUrl: requise("REDIS_URL"),
    secretJwt: new TextEncoder().encode(secret("JWT_SECRET", 32)),
    cleTotp,
    cleOtp: Buffer.from(secret("CLE_OTP", 32)),
    domaine,
    modeleUrlPortail: modeleUrlPortail.replace(/\/+$/, ""),
    urlConsole,
    cookieSecure,
    stockageDossier: resolve(
      env.STOCKAGE_DOSSIER?.trim() || resolve(process.cwd(), "var/fichiers"),
    ),
    contratChemin,
    smtpUrl: env.SMTP_URL?.trim() || "smtp://localhost:1025",
    emailExpediteur:
      env.EMAIL_EXPEDITEUR?.trim() || `Réclamations <no-reply@${domaine}>`,
    sms: lireSms(env, production, erreurs),
    validerReponses: booleen("VALIDER_REPONSES", !production),
    antiRobotMaximum,
    ia: lireIa(env, production, erreurs),
    whatsapp: lireWhatsapp(env, production, erreurs),
    smsEntrantSecret: secretFacultatif(
      env,
      "SMS_ENTRANT_SECRET",
      production,
      erreurs,
    ),
    cleCanaux: cleTotp.length === 32 ? cleCanauxDe(cleTotp) : Buffer.alloc(0),
    antivirus: lireAntivirus(env, production, erreurs),
  };
  if (erreurs.length) throw new ErreurConfiguration(erreurs);
  return config;
}

function lireAntivirus(
  env: NodeJS.ProcessEnv,
  production: boolean,
  erreurs: string[],
): ConfigurationAntivirus {
  const mode = env.ANTIVIRUS?.trim() || (production ? "clamav" : "aucun");
  if (mode !== "clamav" && mode !== "aucun")
    erreurs.push("ANTIVIRUS doit valoir clamav ou aucun");
  if (mode === "aucun" && production)
    erreurs.push(
      "ANTIVIRUS=aucun est interdit en production : les pièces jointes doivent être analysées",
    );
  const port = Number(env.CLAMAV_PORT?.trim() || 3310);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    erreurs.push("CLAMAV_PORT doit être un port (1 à 65535)");
  return {
    mode: mode === "clamav" ? "clamav" : "aucun",
    hote: env.CLAMAV_HOTE?.trim() || "clamav",
    port,
  };
}

/** Clé des jetons WhatsApp des banques (étape 20), dérivée de la clé TOTP : un secret de moins à gérer */
export function cleCanauxDe(cleTotp: Buffer): Buffer {
  return Buffer.from(
    hkdfSync("sha256", cleTotp, "reclamations", "jetons-canaux", 32),
  );
}

const SECRETS_CANAUX_DE_DEVELOPPEMENT = [
  "developpement-whatsapp-secret-0123456789",
  "developpement-sms-entrant-0123456789",
  "developpement-verification",
];

/** Secret facultatif : 16 caractères au moins ; en production, jamais la valeur de développement. */
function secretFacultatif(
  env: NodeJS.ProcessEnv,
  nom: string,
  production: boolean,
  erreurs: string[],
): string | null {
  const v = env[nom]?.trim();
  if (!v) return null;
  if (v.length < 16) erreurs.push(`${nom} doit faire au moins 16 caractères`);
  if (production && SECRETS_CANAUX_DE_DEVELOPPEMENT.includes(v))
    erreurs.push(
      `${nom} a la valeur de développement : interdit en production`,
    );
  return v;
}

function lireWhatsapp(
  env: NodeJS.ProcessEnv,
  production: boolean,
  erreurs: string[],
): ConfigurationWhatsapp {
  const envoi = env.WHATSAPP_ENVOI?.trim() || (production ? "meta" : "journal");
  if (envoi !== "meta" && envoi !== "journal")
    erreurs.push("WHATSAPP_ENVOI doit valoir meta ou journal");
  const url = (
    env.WHATSAPP_URL?.trim() || "https://graph.facebook.com"
  ).replace(/\/+$/, "");
  try {
    const adresse = new URL(url);
    if (production && adresse.protocol !== "https:")
      erreurs.push("WHATSAPP_URL doit être en https en production");
  } catch {
    erreurs.push("WHATSAPP_URL invalide");
  }
  const version = env.WHATSAPP_VERSION?.trim() || "v26.0";
  if (!/^v\d{2,3}\.\d$/.test(version))
    erreurs.push("WHATSAPP_VERSION : version de l'API Graph, ex. v26.0");
  const jeton = env.WHATSAPP_JETON_VERIFICATION?.trim() || null;
  if (jeton && production && SECRETS_CANAUX_DE_DEVELOPPEMENT.includes(jeton))
    erreurs.push(
      "WHATSAPP_JETON_VERIFICATION a la valeur de développement : interdit en production",
    );
  return {
    envoi: envoi === "journal" ? "journal" : "meta",
    url,
    version,
    secretApp: secretFacultatif(
      env,
      "WHATSAPP_SECRET_APP",
      production,
      erreurs,
    ),
    jetonVerification: jeton,
  };
}

function lireSms(
  env: NodeJS.ProcessEnv,
  production: boolean,
  erreurs: string[],
): ConfigurationSms {
  const mode = env.SMS_MODE?.trim() || "journal";
  if (mode === "journal") return { mode };
  if (mode !== "http") {
    erreurs.push("SMS_MODE doit valoir journal ou http");
    return { mode: "journal" };
  }
  const url = env.SMS_URL?.trim() ?? "";
  const cle = env.SMS_CLE?.trim() ?? "";
  const expediteur = env.SMS_EXPEDITEUR?.trim() || "Reclamation";
  let adresse: URL | null = null;
  try {
    adresse = new URL(url);
  } catch {
    erreurs.push(
      "SMS_URL est obligatoire avec SMS_MODE=http (adresse de la passerelle)",
    );
  }
  if (adresse && production && adresse.protocol !== "https:")
    erreurs.push("SMS_URL doit être en https en production");
  if (cle.length < 16)
    erreurs.push(
      "SMS_CLE est obligatoire avec SMS_MODE=http (16 caractères au moins)",
    );
  if (!/^[A-Za-z0-9 ]{1,11}$/.test(expediteur))
    erreurs.push(
      "SMS_EXPEDITEUR : 11 caractères au plus, lettres sans accent, chiffres et espaces",
    );
  return { mode, url, cle, expediteur };
}

function lireIa(
  env: NodeJS.ProcessEnv,
  production: boolean,
  erreurs: string[],
): ConfigurationIa {
  const entier = (nom: string, defaut: number, min: number, max: number) => {
    const v = Number(env[nom]?.trim() || defaut);
    if (!Number.isInteger(v) || v < min || v > max)
      erreurs.push(`${nom} doit être un entier entre ${min} et ${max}`);
    return v;
  };
  const prix = (nom: string) => {
    const v = Number(env[nom]?.trim() || 0);
    if (!Number.isFinite(v) || v < 0 || v > 1000)
      erreurs.push(
        `${nom} : tarif en dollars par million de jetons, entre 0 et 1000`,
      );
    return v;
  };
  const plafondJour = entier("IA_PLAFOND_JOUR", 2000, 1, 1_000_000);
  const fournisseur = env.IA_FOURNISSEUR?.trim().toLowerCase() || "regles";
  if (fournisseur === "regles") return { fournisseur, plafondJour };
  if (!FOURNISSEURS_IA.includes(fournisseur as NomFournisseurIa)) {
    erreurs.push(
      `IA_FOURNISSEUR doit valoir regles, ${FOURNISSEURS_IA.join(", ")}`,
    );
    return { fournisseur: "regles", plafondJour };
  }
  const nom = fournisseur as NomFournisseurIa;
  const modele = env.IA_MODELE?.trim() ?? "";
  if (!modele)
    erreurs.push(
      `IA_MODELE est obligatoire avec IA_FOURNISSEUR=${nom} (nom du modèle chez le fournisseur)`,
    );
  const cle = env.IA_CLE?.trim() ?? "";
  if (cle.length < 16)
    erreurs.push(
      `IA_CLE est obligatoire avec IA_FOURNISSEUR=${nom} (clé d'API du fournisseur)`,
    );
  const url = env.IA_URL?.trim() || URL_IA_PAR_DEFAUT[nom];
  let adresse: URL | null = null;
  try {
    adresse = new URL(url);
  } catch {
    erreurs.push("IA_URL invalide");
  }
  if (adresse && production && adresse.protocol !== "https:")
    erreurs.push("IA_URL doit être en https en production");
  return {
    fournisseur: nom,
    modele,
    cle,
    url,
    plafondJour,
    delaiMs: entier("IA_DELAI_MS", 8000, 1000, 30_000),
    prixEntree: prix("IA_PRIX_ENTREE"),
    prixSortie: prix("IA_PRIX_SORTIE"),
  };
}

function lireVersion(): string {
  try {
    const paquet = JSON.parse(
      readFileSync(resolve(__dirname, "../../package.json"), "utf8"),
    ) as { version?: string };
    if (paquet.version) return paquet.version;
  } catch {
    // dist/src/configuration : un niveau de plus
  }
  try {
    return (
      JSON.parse(
        readFileSync(resolve(__dirname, "../../../package.json"), "utf8"),
      ) as { version: string }
    ).version;
  } catch {
    return "0.0.0";
  }
}

/** Adresse publique d'un portail de banque. */
export function urlPortail(config: Configuration, slug: string): string {
  return config.modeleUrlPortail.replace("{slug}", slug);
}

export const CONFIGURATION = Symbol("CONFIGURATION");
