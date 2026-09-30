/**
 * Filtre compact d'une liste : « Statut » tant que rien n'est choisi, « Statut : Ouverte » ensuite.
 * Une vraie liste de choix du navigateur (clavier, lecteurs d'écran, mobile) est posée, invisible,
 * sur l'étiquette : la largeur suit le texte affiché, pas la plus longue option.
 */
import { ChevronDown } from 'lucide-react';
import { cx } from './composants';

export function ChoixFiltre<T extends string>({
  libelle,
  valeur,
  options,
  surChoix,
  obligatoire,
}: {
  libelle: string;
  valeur: T | undefined;
  options: { valeur: T; libelle: string }[];
  surChoix: (v: T | undefined) => void;
  /** Toujours une valeur (période, mois) : pas de choix « tous », pas de mise en avant */
  obligatoire?: boolean;
}) {
  const choisie = options.find((o) => o.valeur === valeur);
  return (
    <span
      className={cx(
        'relative inline-flex h-9 max-w-72 items-center gap-1.5 rounded-lg border px-3 text-sm focus-within:outline-2 focus-within:outline-focus',
        choisie && !obligatoire ? 'border-marque bg-marque-doux font-semibold text-encre' : 'border-trait-fort bg-surface text-encre-2 hover:border-encre-3',
        obligatoire && 'font-semibold text-encre',
      )}
    >
      <span className="truncate">
        {libelle}
        {choisie && <span className="font-normal"> : {choisie.libelle}</span>}
      </span>
      <ChevronDown aria-hidden size={15} className="shrink-0" />
      <select
        aria-label={libelle}
        value={valeur ?? ''}
        onChange={(e) => surChoix((e.target.value || undefined) as T | undefined)}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
      >
        {!obligatoire && <option value="">{choisie ? `Tous (retirer le filtre)` : `${libelle} : tous`}</option>}
        {options.map((o) => (
          <option key={o.valeur} value={o.valeur}>{o.libelle}</option>
        ))}
      </select>
    </span>
  );
}
