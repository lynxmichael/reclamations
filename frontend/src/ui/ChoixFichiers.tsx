/**
 * Choix de pièces jointes : vrais fichiers du téléphone ou de l'ordinateur. Le nombre, la taille
 * et le type sont vérifiés tout de suite pour prévenir l'utilisateur ; l'API les revérifie au
 * contenu du fichier (décision B8), refuse un document Word à macros et passe chaque fichier à
 * l'antivirus (étape 22).
 */
import { useId, useRef, useState } from 'react';
import { FileImage, FileText, Paperclip, X } from 'lucide-react';
import { octets } from './format';
import { cx } from './composants';

export const TYPE_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const TYPES_PIECES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf', TYPE_DOCX];
const NOMS_TYPES: Record<string, string> = {
  'image/jpeg': 'JPEG', 'image/png': 'PNG', 'image/webp': 'WebP', 'application/pdf': 'PDF', 'image/svg+xml': 'SVG', [TYPE_DOCX]: 'Word .docx sans macro',
};
/** Un ordinateur sans Word ne connaît pas toujours le type d'un .docx : son extension en tient lieu */
const PAR_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf', svg: 'image/svg+xml', docx: TYPE_DOCX,
};

export interface ReglesFichiers {
  max: number;
  maxOctets: number;
  types: string[];
}

export const REGLES_PIECES: ReglesFichiers = { max: 5, maxOctets: 10 * 1024 * 1024, types: TYPES_PIECES };

const extension = (nom: string) => (nom.includes('.') ? nom.split('.').pop()!.toLowerCase() : '');

/** Le type du fichier, d'après le navigateur ou, à défaut, son extension. */
export function typeDe(f: { name: string; type: string }): string {
  return f.type && f.type !== 'application/octet-stream' ? f.type : PAR_EXTENSION[extension(f.name)] ?? f.type;
}

/** Pourquoi ce fichier ne peut pas être joint (null : il peut l'être), en mots de l'utilisateur. */
export function refusFichier(f: { name: string; type: string; size: number }, regles: ReglesFichiers): string | null {
  const ext = extension(f.name);
  if (regles.types.includes(TYPE_DOCX)) {
    if (ext === 'doc' || ext === 'dot') return `${f.name} : ancien format Word, à enregistrer en .docx ou en PDF`;
    if (ext === 'docm' || ext === 'dotm') return `${f.name} : document Word à macros, à enregistrer en .docx sans macro ou en PDF`;
  }
  if (!regles.types.includes(typeDe(f))) return `${f.name} : type non accepté`;
  if (f.size > regles.maxOctets) return `${f.name} : plus de ${octets(regles.maxOctets)}`;
  return null;
}

/** Pour le sélecteur du système : les types, et l'extension .docx (Windows sans Word) */
const accepte = (types: string[]) => [...types, ...(types.includes(TYPE_DOCX) ? ['.docx'] : [])].join(',');

export function ChoixFichiers({
  fichiers,
  surChangement,
  regles = REGLES_PIECES,
  libelle = 'Ajouter une photo, un PDF ou un document Word',
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
      const raison = refusFichier(f, regles);
      if (raison) refuses.push(raison);
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
        accept={accepte(regles.types)}
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
          {regles.types.includes(TYPE_DOCX) && ' Chaque fichier est vérifié par un antivirus.'}
        </p>
      )}
    </div>
  );
}
