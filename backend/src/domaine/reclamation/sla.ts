/**
 * Règles SLA (arbitrage 4, §6.4) : échéance, alerte préventive, pause, reprise, résolution.
 *
 * Toutes les durées sont en minutes ouvrées de la banque. Module pur : chaque fonction rend
 * les champs du ticket à mettre à jour, que le service écrit dans la même transaction que
 * le changement de statut.
 */
import { DateTime } from 'luxon';
import { ajouterMinutesOuvrees, minutesOuvreesEntre, type CalendrierNormalise } from '../temps-ouvre/calendrier.js';

export interface ParametresSla {
  readonly calendrier: CalendrierNormalise;
  /** Alerte préventive quand ce pourcentage du délai est consommé (75 par défaut) */
  readonly seuilAlertePourcent: number;
  /** Clôture automatique après ce nombre de jours calendaires sans réaction (5 par défaut) */
  readonly delaiClotureAutoJours: number;
}

export interface EtatSla {
  readonly delaiCibleMinutes: number;
  readonly echeanceSlaLe: Date | null;
  readonly slaMinutesRestantes: number | null;
}

export interface ChampsSla {
  echeanceSlaLe: Date | null;
  alertePreventiveLe: Date | null;
  slaMinutesRestantes: number | null;
  slaSuspenduLe: Date | null;
}

/** Minutes ouvrées consommées au moment de l'alerte préventive (ex. 75 % de 960 = 720). */
export function minutesAvantAlerte(delaiCible: number, seuilPourcent: number): number {
  return Math.ceil((delaiCible * seuilPourcent) / 100);
}

/** Minutes restantes au moment de l'alerte (ex. 960 − 720 = 240). */
function margeAlerte(delaiCible: number, seuilPourcent: number): number {
  return delaiCible - minutesAvantAlerte(delaiCible, seuilPourcent);
}

/** Au dépôt : le chrono démarre avec le délai de la catégorie. */
export function slaAuDepot(maintenant: Date, delaiCibleMinutes: number, p: ParametresSla): ChampsSla {
  return {
    echeanceSlaLe: ajouterMinutesOuvrees(maintenant, delaiCibleMinutes, p.calendrier),
    alertePreventiveLe: ajouterMinutesOuvrees(maintenant, minutesAvantAlerte(delaiCibleMinutes, p.seuilAlertePourcent), p.calendrier),
    slaMinutesRestantes: null,
    slaSuspenduLe: null,
  };
}

/** Temps restant figé, arrondi à la minute inférieure, jamais négatif. */
function restantA(maintenant: Date, etat: EtatSla, p: ParametresSla): number {
  if (!etat.echeanceSlaLe) return etat.slaMinutesRestantes ?? 0;
  return Math.max(0, Math.floor(minutesOuvreesEntre(maintenant, etat.echeanceSlaLe, p.calendrier)));
}

/** « En attente client » : le temps restant est figé, l'échéance disparaît. */
export function slaEnPause(maintenant: Date, etat: EtatSla, p: ParametresSla): ChampsSla {
  return { echeanceSlaLe: null, alertePreventiveLe: null, slaMinutesRestantes: restantA(maintenant, etat, p), slaSuspenduLe: maintenant };
}

/** Reprise (réponse du client ou contestation) : l'échéance est recalculée depuis maintenant. */
export function slaALaReprise(maintenant: Date, etat: EtatSla, p: ParametresSla): ChampsSla {
  const restant = etat.slaMinutesRestantes ?? 0;
  const alerteDans = Math.max(0, restant - margeAlerte(etat.delaiCibleMinutes, p.seuilAlertePourcent));
  return {
    echeanceSlaLe: ajouterMinutesOuvrees(maintenant, restant, p.calendrier),
    alertePreventiveLe: ajouterMinutesOuvrees(maintenant, alerteDans, p.calendrier),
    slaMinutesRestantes: null,
    slaSuspenduLe: null,
  };
}

export interface ChampsResolution extends ChampsSla {
  slaRespecte: boolean;
  resolueLe: Date;
  delaiResolutionMinutes: number;
  clotureAutoPrevueLe: Date;
}

/**
 * Résolution : on note si l'échéance est tenue, on fige le temps restant (utile en cas de
 * contestation) et on programme la clôture automatique.
 */
export function slaALaResolution(maintenant: Date, creeLe: Date, etat: EtatSla, p: ParametresSla): ChampsResolution {
  return {
    echeanceSlaLe: null,
    alertePreventiveLe: null,
    slaMinutesRestantes: restantA(maintenant, etat, p),
    slaSuspenduLe: null,
    slaRespecte: etat.echeanceSlaLe ? maintenant.getTime() <= etat.echeanceSlaLe.getTime() : (etat.slaMinutesRestantes ?? 0) > 0,
    resolueLe: maintenant,
    delaiResolutionMinutes: Math.floor(minutesOuvreesEntre(creeLe, maintenant, p.calendrier)),
    clotureAutoPrevueLe: DateTime.fromJSDate(maintenant, { zone: p.calendrier.zone }).plus({ days: p.delaiClotureAutoJours }).toJSDate(),
  };
}

/** Délai de première réponse (§6.6), en minutes ouvrées depuis le dépôt. */
export function delaiPremiereReponse(maintenant: Date, creeLe: Date, p: ParametresSla): number {
  return Math.floor(minutesOuvreesEntre(creeLe, maintenant, p.calendrier));
}

/** File « en retard » (§6.2) : échéance passée, ou temps restant épuisé pendant une pause. */
export function estEnRetard(
  etat: Pick<EtatSla, 'echeanceSlaLe' | 'slaMinutesRestantes'> & { readonly slaSuspenduLe: Date | null },
  maintenant: Date,
): boolean {
  if (etat.echeanceSlaLe) return etat.echeanceSlaLe.getTime() < maintenant.getTime();
  return etat.slaSuspenduLe !== null && etat.slaMinutesRestantes === 0;
}
