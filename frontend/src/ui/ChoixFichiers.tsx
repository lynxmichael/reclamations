/**
 * Choix de pièces jointes : vrais fichiers du téléphone ou de l'ordinateur. Le nombre, la taille
 * et le type sont vérifiés tout de suite pour prévenir l'utilisateur ; l'API les revérifie au
 * contenu du fichier (décision B8).
 */
import { useId, useRef, useState } from 'react';
import { FileImage, FileText, Paperclip, X } from 'lucide-react';
import { octets } from './format';
import { cx } from './composants';

export const TYPES_PIECES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const NOMS_TYPES: Record<string, string> = { 'image/jpeg': 'JPEG', 'image/png': 'PNG', 'image/webp': 'WebP', 'application/pdf': 'PDF', 'image/svg+xml': 'SVG' };

export interface ReglesFichiers {
  max: number;
  maxOctets: number;
  types: string[];
}

export const REGLES_PIECES: ReglesFichiers = { max: 5, maxOctets: 5 * 1024 * 1024, types: TYPES_PIECES };

export function ChoixFichiers({
  fichiers,
  surChangement,
  regles = REGLES_PIECES,
  libelle = 'Ajouter une photo ou un PDF',
  compact,
}: {
  fichiers: File[];
  surChangement: (f: File[]) => void;
  regles?: ReglesFichiers;
  libelle?: string;
  /** Bouton discret (zone de réponse) plutôt que grande zone en pointillés (formulaire de dépôt) */
  compact?: boolean;
}) {
  const id = useId();
  const champ = useRef<HTMLInputElement>(null);
  const [refus, setRefus] = useState<string | null>(null);

  const ajouter = (liste: FileList | null) => {
    if (!liste) return;
    const nouveaux: File[] = [];
    const refuses: string[] = [];
    for (const f of Array.from(liste)) {
      if (!regles.types.includes(f.type)) refuses.push(`${f.name} : type non accepté`);
      else if (f.size > regles.maxOctets) refuses.push(`${f.name} : plus de ${octets(regles.maxOctets)}`);
      else if (fichiers.length + nouveaux.length >= regles.max) refuses.push(`${f.name} : ${regles.max} fichiers au plus`);
      else nouveaux.push(f);
    }
    setRefus(refuses.length ? refuses.join(' · ') : null);
    if (nouveaux.length) surChangement([...fichiers, ...nouveaux]);
    if (champ.current) champ.current.value = '';
  };

  return (
    <div className="flex flex-col gap-2">
      {fichiers.map((f, i) => {
        const Icone = f.type.startsWith('image/') ? FileImage : FileText;
        return (
          <div key={`${f.name}-${i}`} className="flex items-center gap-3 rounded-lg border border-trait bg-fond px-3 py-2">
            <Icone aria-hidden size={19} className="shrink-0 text-encre-3" />
            <span className="min-w-0 flex-1 truncate text-[15px]">{f.name}</span>
            <span className="chiffres text-sm text-encre-3">{octets(f.size)}</span>
            <button type="button" aria-label={`Retirer ${f.name}`} onClick={() => surChangement(fichiers.filter((_, j) => j !== i))} className="rounded p-1 text-encre-3 hover:bg-trait">
              <X size={17} />
            </button>
          </div>
        );
      })}
      <input
        ref={champ}
        id={id}
        type="file"
        multiple={regles.max > 1}
        accept={regles.types.join(',')}
        className="sr-only"
        onChange={(e) => ajouter(e.target.files)}
      />
      {fichiers.length < regles.max && (
        <label
          htmlFor={id}
          className={cx(
            'cursor-pointer font-semibold text-marque-texte focus-within:outline-2',
            compact
              ? 'inline-flex h-8 w-fit items-center gap-1.5 rounded-lg px-3 text-sm hover:bg-fond'
              : 'flex h-12 items-center justify-center gap-2 rounded-lg border-2 border-dashed border-trait-fort hover:border-marque',
          )}
        >
          <Paperclip aria-hidden size={compact ? 15 : 18} />
          {libelle}
        </label>
      )}
      {refus && <p role="alert" className="text-sm font-semibold text-urgent">{refus}</p>}
      {!compact && (
        <p className="text-sm text-encre-3">
          {regles.max} fichier{regles.max > 1 ? 's' : ''} au plus, {octets(regles.maxOctets)} chacun ({regles.types.map((t) => NOMS_TYPES[t] ?? t).join(', ')}).
        </p>
      )}
    </div>
  );
}
