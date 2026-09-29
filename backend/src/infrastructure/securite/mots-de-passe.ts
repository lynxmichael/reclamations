/**
 * Mots de passe du personnel : argon2id (paramètres OWASP : 19 Mio, 2 passes), 12 caractères au
 * moins, refusés s'ils sont trop courants ou s'ils reprennent l'e-mail ou le nom de la personne.
 */
import { hash, verify } from '@node-rs/argon2';
import { Probleme } from '../contrat/probleme.js';

const OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1, outputLen: 32 } as const;

/** Mots de passe parmi les plus utilisés (listes publiques de fuites), en minuscules. */
const COURANTS = new Set([
  '123456789012', '1234567890123', 'azertyuiopqs', 'azertyuiop123', 'motdepasse123', 'motdepasse1234',
  'password1234', 'password12345', 'passwordpassword', 'qwertyuiop12', 'qwertyuiop123', '111111111111',
  '000000000000', '123123123123', 'abcdefghijkl', 'abc123abc123', 'iloveyou1234', 'administrateur',
  'admin1234567', 'administrator', 'bienvenue123', 'bienvenue1234', 'soleil123456', 'motdepasse!1',
  'jetaime12345', 'azerty123456', 'azertyazerty', 'qwertyqwerty', 'changeme1234', 'welcome12345',
  'football1234', 'secret123456', 'banque123456', 'abidjan12345', 'cotedivoire1', 'cotedivoire2026',
  'reclamation1', 'reclamations', 'makortelecom', 'makortelecoms', 'password!234', 'p@ssw0rd1234',
]);

export interface ContexteMotDePasse {
  readonly email: string;
  readonly nom?: string;
  readonly prenom?: string;
}

/** Refuse un mot de passe faible : 400 MOT_DE_PASSE_TROP_FAIBLE avec la raison. */
export function exigerRobustesse(motDePasse: string, c: ContexteMotDePasse): void {
  const raison = raisonFaiblesse(motDePasse, c);
  if (raison) throw new Probleme(400, 'MOT_DE_PASSE_TROP_FAIBLE', raison, [{ champ: 'motDePasse', message: raison }]);
}

export function raisonFaiblesse(motDePasse: string, c: ContexteMotDePasse): string | null {
  const mdp = motDePasse.toLowerCase();
  if ([...motDePasse].length < 12) return '12 caractères au moins';
  if (COURANTS.has(mdp) || COURANTS.has(mdp.replace(/[^a-z0-9]/g, ''))) return 'Ce mot de passe fait partie des plus utilisés';
  if (new Set(mdp).size < 4) return 'Trop de caractères répétés';
  const morceaux = [c.email.split('@')[0], c.nom, c.prenom].filter((m): m is string => !!m && m.length >= 4);
  if (morceaux.some((m) => mdp.includes(m.toLowerCase()))) return 'Ne doit pas reprendre votre nom ou votre e-mail';
  return null;
}

export function hacherMotDePasse(motDePasse: string): Promise<string> {
  return hash(motDePasse, OPTIONS);
}

let hashFactice: Promise<string> | null = null;

/**
 * Vérifie un mot de passe. Sans hash (compte inconnu ou sans mot de passe), on vérifie quand même
 * contre un hash factice : le temps de réponse ne révèle pas si le compte existe.
 */
export async function verifierMotDePasse(hashStocke: string | null | undefined, motDePasse: string): Promise<boolean> {
  if (!hashStocke) {
    hashFactice ??= hash('mot-de-passe-factice-pour-egaliser-le-temps', OPTIONS);
    await verify(await hashFactice, motDePasse).catch(() => false);
    return false;
  }
  try {
    return await verify(hashStocke, motDePasse);
  } catch {
    return false;
  }
}
