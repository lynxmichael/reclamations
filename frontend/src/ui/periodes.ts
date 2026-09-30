/**
 * Périodes du tableau de bord (étape 9), calculées dans le fuseau de la banque sans bibliothèque
 * de dates : le décalage du fuseau à un instant est lu avec Intl.
 */

export type CodePeriode = 'mois' | 'mois-precedent' | '7j' | '30j' | '90j' | '12m' | 'annee';

export const PERIODES: Record<CodePeriode, string> = {
  mois: 'Ce mois-ci',
  'mois-precedent': 'Le mois dernier',
  '7j': 'Les 7 derniers jours',
  '30j': 'Les 30 derniers jours',
  '90j': 'Les 3 derniers mois',
  '12m': 'Les 12 derniers mois',
  annee: 'Cette année',
};

interface Locale {
  annee: number;
  mois: number;
  jour: number;
}

function locale(d: Date, fuseau: string): Locale & { heure: number; minute: number; seconde: number } {
  const parties = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: fuseau, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' })
      .formatToParts(d).filter((p) => p.type !== 'literal').map((p) => [p.type, Number(p.value)]),
  ) as Record<string, number>;
  return { annee: parties.year!, mois: parties.month!, jour: parties.day!, heure: parties.hour!, minute: parties.minute!, seconde: parties.second! };
}

/** Écart (ms) entre l'heure locale du fuseau et l'heure universelle, à l'instant `d`. */
function decalage(d: Date, fuseau: string): number {
  const l = locale(d, fuseau);
  return Date.UTC(l.annee, l.mois - 1, l.jour, l.heure, l.minute, l.seconde) - Math.floor(d.getTime() / 1000) * 1000;
}

/** Minuit local d'une date du calendrier (mois de 1 à 12 ; débordements acceptés, ex. mois 0). */
export function minuit(annee: number, mois: number, jour: number, fuseau: string): Date {
  const naif = Date.UTC(annee, mois - 1, jour);
  const premier = naif - decalage(new Date(naif), fuseau);
  // Changement d'heure entre les deux : second passage
  return new Date(naif - decalage(new Date(premier), fuseau));
}

/** Bornes d'une période : `au` absent = jusqu'à maintenant. */
export function bornes(code: CodePeriode, fuseau: string, maintenant = new Date()): { du: string; au?: string } {
  const l = locale(maintenant, fuseau);
  const iso = (d: Date) => d.toISOString();
  switch (code) {
    case 'mois':
      return { du: iso(minuit(l.annee, l.mois, 1, fuseau)) };
    case 'mois-precedent':
      return { du: iso(minuit(l.annee, l.mois - 1, 1, fuseau)), au: iso(minuit(l.annee, l.mois, 1, fuseau)) };
    case '7j':
      return { du: iso(minuit(l.annee, l.mois, l.jour - 6, fuseau)) };
    case '30j':
      return { du: iso(minuit(l.annee, l.mois, l.jour - 29, fuseau)) };
    case '90j':
      return { du: iso(minuit(l.annee, l.mois - 3, l.jour + 1, fuseau)) };
    case '12m':
      return { du: iso(minuit(l.annee, l.mois - 11, 1, fuseau)) };
    case 'annee':
      return { du: iso(minuit(l.annee, 1, 1, fuseau)) };
  }
}

/** Les 12 derniers mois civils (AAAA-MM), le plus récent d'abord. */
export function derniersMois(maintenant = new Date(), nombre = 12): string[] {
  return Array.from({ length: nombre }, (_, i) => {
    const d = new Date(Date.UTC(maintenant.getUTCFullYear(), maintenant.getUTCMonth() - i, 1));
    return d.toISOString().slice(0, 7);
  });
}

/** « septembre 2026 » */
export function nomMois(mois: string): string {
  return new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(new Date(`${mois}-01T00:00:00Z`));
}
