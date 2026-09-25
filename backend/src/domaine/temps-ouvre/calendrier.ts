/**
 * Temps ouvré d'une banque (arbitrage 4, §6.4).
 *
 * Le délai cible d'une catégorie se compte en minutes ouvrées : seules comptent les plages
 * horaires de la banque, dans son fuseau, hors jours fériés. Module pur, sans base de données :
 * il reçoit le calendrier de la banque et travaille sur des instants (Date, UTC).
 */
import { DateTime } from 'luxon';

/** Plage ouvrée d'un jour de la semaine (1 = lundi … 7 = dimanche), en minutes depuis minuit. */
export interface PlageOuvree {
  jourSemaine: number;
  debutMinute: number;
  finMinute: number;
}

/** Jour férié : date AAAA-MM-JJ ; « recurrent » le répète chaque année au même jour et mois. */
export interface JourFerieCalendrier {
  date: string;
  recurrent: boolean;
}

export interface Calendrier {
  fuseauHoraire: string;
  plages: readonly PlageOuvree[];
  joursFeries: readonly JourFerieCalendrier[];
}

export interface CalendrierNormalise {
  readonly zone: string;
  /** Plages fusionnées et triées, par jour ISO (1–7) */
  readonly plagesParJour: ReadonlyMap<number, readonly (readonly [number, number])[]>;
  readonly feriesFixes: ReadonlySet<string>;
  readonly feriesRecurrents: ReadonlySet<string>;
  /** Aucune plage configurée : le temps s'écoule en continu, 24 h/24 (voir note d'étape 4, S7) */
  readonly continu: boolean;
  /**
   * Intervalles ouvrés déjà calculés, par jour civil (nombre de jours depuis le 01/01/1970).
   * Le passage par Luxon (fuseau, heure d'été) ne se fait qu'une fois par jour et par calendrier.
   */
  readonly cache: Map<number, readonly (readonly [number, number])[]>;
}

const MS_PAR_MINUTE = 60_000;
const MS_PAR_JOUR = 86_400_000;
/** Au-delà, on considère le calendrier comme vide de plages exploitables. */
const LIMITE_JOURS = 366 * 3;

export function normaliserCalendrier(cal: Calendrier): CalendrierNormalise {
  if (!DateTime.now().setZone(cal.fuseauHoraire).isValid) {
    throw new Error(`Fuseau horaire inconnu : ${cal.fuseauHoraire}`);
  }
  const parJour = new Map<number, [number, number][]>();
  for (const p of cal.plages) {
    if (p.jourSemaine < 1 || p.jourSemaine > 7 || p.debutMinute < 0 || p.finMinute > 1440 || p.debutMinute >= p.finMinute) {
      throw new Error(`Plage horaire invalide : ${JSON.stringify(p)}`);
    }
    const liste = parJour.get(p.jourSemaine) ?? [];
    liste.push([p.debutMinute, p.finMinute]);
    parJour.set(p.jourSemaine, liste);
  }
  // Fusion des plages qui se chevauchent ou se touchent (08:00–12:00 + 10:00–14:00 = 08:00–14:00)
  const fusionnees = new Map<number, (readonly [number, number])[]>();
  for (const [jour, plages] of parJour) {
    plages.sort((x, y) => x[0] - y[0]);
    const resultat: [number, number][] = [];
    for (const [debut, fin] of plages) {
      const derniere = resultat[resultat.length - 1];
      if (derniere && debut <= derniere[1]) derniere[1] = Math.max(derniere[1], fin);
      else resultat.push([debut, fin]);
    }
    fusionnees.set(jour, resultat);
  }
  return {
    zone: cal.fuseauHoraire,
    plagesParJour: fusionnees,
    feriesFixes: new Set(cal.joursFeries.filter((j) => !j.recurrent).map((j) => j.date)),
    feriesRecurrents: new Set(cal.joursFeries.filter((j) => j.recurrent).map((j) => j.date.slice(5))),
    continu: fusionnees.size === 0,
    cache: new Map(),
  };
}

/** Jour civil local (jours depuis le 01/01/1970) d'un instant, dans le fuseau de la banque. */
function jourCivil(instant: number, zone: string): number {
  const d = DateTime.fromMillis(instant, { zone });
  return Math.floor(Date.UTC(d.year, d.month - 1, d.day) / MS_PAR_JOUR);
}

/** Instant (ms) d'une heure locale d'un jour civil ; 1440 = minuit du lendemain. */
function instantLocal(annee: number, mois: number, jour: number, minute: number, zone: string): number {
  if (minute >= 1440) return DateTime.fromObject({ year: annee, month: mois, day: jour }, { zone }).plus({ days: 1 }).toMillis();
  return DateTime.fromObject({ year: annee, month: mois, day: jour, hour: Math.floor(minute / 60), minute: minute % 60 }, { zone }).toMillis();
}

/** Intervalles ouvrés [début, fin[ d'un jour civil local, en millisecondes depuis l'époque. */
function intervallesDuJour(civil: number, cal: CalendrierNormalise): readonly (readonly [number, number])[] {
  const connus = cal.cache.get(civil);
  if (connus) return connus;
  const date = new Date(civil * MS_PAR_JOUR); // minuit UTC du jour civil : sert à lire année, mois, jour
  const iso = date.toISOString().slice(0, 10);
  const jourSemaine = ((date.getUTCDay() + 6) % 7) + 1; // 1 = lundi … 7 = dimanche
  const ferie = cal.feriesFixes.has(iso) || cal.feriesRecurrents.has(iso.slice(5));
  const [annee, mois, jour] = [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()];
  const intervalles = ferie
    ? []
    : (cal.plagesParJour.get(jourSemaine) ?? []).map(
        ([debut, fin]) => [instantLocal(annee, mois, jour, debut, cal.zone), instantLocal(annee, mois, jour, fin, cal.zone)] as const,
      );
  cal.cache.set(civil, intervalles);
  return intervalles;
}

/**
 * Instant auquel `minutes` minutes ouvrées se sont écoulées depuis `debut`.
 * Un départ hors des heures ouvrées commence à la prochaine ouverture.
 */
export function ajouterMinutesOuvrees(debut: Date, minutes: number, cal: CalendrierNormalise): Date {
  if (minutes <= 0) return new Date(debut);
  if (cal.continu) return new Date(debut.getTime() + minutes * MS_PAR_MINUTE);
  let restant = minutes * MS_PAR_MINUTE;
  const depart = debut.getTime();
  const premier = jourCivil(depart, cal.zone);
  for (let jour = premier; jour < premier + LIMITE_JOURS; jour++) {
    for (const [a, b] of intervallesDuJour(jour, cal)) {
      const partir = Math.max(a, depart);
      if (partir >= b) continue;
      const disponible = b - partir;
      if (restant <= disponible) return new Date(partir + restant);
      restant -= disponible;
    }
  }
  throw new Error('Aucune plage ouvrée exploitable dans les trois prochaines années');
}

/** Minutes ouvrées écoulées entre deux instants (0 si fin <= début). Valeur décimale. */
export function minutesOuvreesEntre(debut: Date, fin: Date, cal: CalendrierNormalise): number {
  const a = debut.getTime();
  const b = fin.getTime();
  if (b <= a) return 0;
  if (cal.continu) return (b - a) / MS_PAR_MINUTE;
  let total = 0;
  const dernier = jourCivil(b, cal.zone);
  for (let jour = jourCivil(a, cal.zone); jour <= dernier; jour++) {
    for (const [ia, ib] of intervallesDuJour(jour, cal)) {
      const chevauchement = Math.min(b, ib) - Math.max(a, ia);
      if (chevauchement > 0) total += chevauchement;
    }
  }
  return total / MS_PAR_MINUTE;
}
