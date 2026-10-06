/**
 * Mise en forme française des dates, durées et nombres.
 * Les dates viennent de l'API en UTC ; elles s'affichent dans le fuseau de la banque.
 */
export const FUSEAU_PAR_DEFAUT = 'Africa/Abidjan';

const NBSP = ' '; // espace fine insécable, avant « % » et entre milliers

function morceaux(iso: string, fuseau: string, options: Intl.DateTimeFormatOptions) {
  const parts = new Intl.DateTimeFormat('fr-FR', { timeZone: fuseau, ...options }).formatToParts(new Date(iso));
  return Object.fromEntries(parts.map((p) => [p.type, p.value])) as Record<string, string>;
}

/** 10:00 */
export function heure(iso: string, fuseau = FUSEAU_PAR_DEFAUT): string {
  const m = morceaux(iso, fuseau, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return `${m.hour}:${m.minute}`;
}

/** 25/09/2026 */
export function date(iso: string, fuseau = FUSEAU_PAR_DEFAUT): string {
  const m = morceaux(iso, fuseau, { day: '2-digit', month: '2-digit', year: 'numeric' });
  return `${m.day}/${m.month}/${m.year}`;
}

/** ven. 25/09 10:00 */
export function dateCourte(iso: string, fuseau = FUSEAU_PAR_DEFAUT): string {
  const m = morceaux(iso, fuseau, { weekday: 'short', day: '2-digit', month: '2-digit' });
  return `${m.weekday} ${m.day}/${m.month} ${heure(iso, fuseau)}`;
}

/** 25/09/2026 à 10:00 */
export function dateHeure(iso: string, fuseau = FUSEAU_PAR_DEFAUT): string {
  return `${date(iso, fuseau)} à ${heure(iso, fuseau)}`;
}

/** vendredi 25 septembre à 10:00 */
export function dateLongue(iso: string, fuseau = FUSEAU_PAR_DEFAUT): string {
  const m = morceaux(iso, fuseau, { weekday: 'long', day: 'numeric', month: 'long' });
  return `${m.weekday} ${m.day} ${m.month} à ${heure(iso, fuseau)}`;
}

/** « il y a 12 min », « aujourd'hui 10:00 », « hier 18:02 », sinon « mer. 23/09 10:00 » */
export function relatif(iso: string, maintenant: string, fuseau = FUSEAU_PAR_DEFAUT): string {
  const ecart = (new Date(maintenant).getTime() - new Date(iso).getTime()) / 60_000;
  if (ecart >= 0 && ecart < 1) return "à l'instant";
  if (ecart >= 0 && ecart < 60) return `il y a ${Math.floor(ecart)}${NBSP}min`;
  const jour = (d: string) => date(d, fuseau);
  if (jour(iso) === jour(maintenant)) return `aujourd'hui ${heure(iso, fuseau)}`;
  const veille = new Date(new Date(maintenant).getTime() - 86_400_000).toISOString();
  if (jour(iso) === jour(veille)) return `hier ${heure(iso, fuseau)}`;
  return dateCourte(iso, fuseau);
}

/** Durée en minutes ouvrées : « 45 min », « 9 h 42 », « 16 h ». */
export function duree(minutes: number): string {
  const m = Math.round(Math.abs(minutes));
  if (m < 60) return `${m}${NBSP}min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r === 0 ? `${h}${NBSP}h` : `${h}${NBSP}h${NBSP}${String(r).padStart(2, '0')}`;
}

/** 0,87 → « 87 % » */
export function pourcent(taux: number | null, decimales = 0): string {
  if (taux === null) return '—';
  return `${(taux * 100).toLocaleString('fr-FR', { maximumFractionDigits: decimales, minimumFractionDigits: decimales })}${NBSP}%`;
}

/** 12345 → « 12 345 » */
export function nombre(n: number): string {
  return n.toLocaleString('fr-FR').replace(/\s/g, NBSP);
}

/** 1 258 291 → « 1,2 Mo » */
export function octets(n: number): string {
  if (n < 1024) return `${n}${NBSP}o`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)}${NBSP}Ko`;
  return `${(n / (1024 * 1024)).toLocaleString('fr-FR', { maximumFractionDigits: 1 })}${NBSP}Mo`;
}

/** Yao Kouassi → YK */
export function initiales(nom: string): string {
  return nom
    .split(/[\s-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((m) => m[0]!.toUpperCase())
    .join('');
}

/** Numéro E.164 lisible : +225 27 22 00 00 00 (Côte d'Ivoire), sinon tel quel. */
export function telephone(e164: string): string {
  const m = /^\+225(\d{10})$/.exec(e164);
  return m ? `+225 ${m[1]!.replace(/(\d{2})(?=\d)/g, '$1 ')}` : e164;
}
