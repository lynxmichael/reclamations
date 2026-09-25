/**
 * Composants de base, partagés par le portail, le back-office et la console.
 */
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { useId } from 'react';
import { encode } from 'uqr';
import { Archive, CircleCheck, CircleDot, Flame, Inbox, MessageCircleQuestionMark } from 'lucide-react';
import type { Priorite, StatutReclamation } from '../api/types';
import { STATUT, STATUT_CLIENT } from './libelles';
import { initiales } from './format';

export function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

/* ---------------------------------------------------------------- Boutons */

type VarianteBouton = 'principal' | 'secondaire' | 'discret' | 'danger' | 'console';
type TailleBouton = 'petit' | 'normal' | 'grand';

const VARIANTES: Record<VarianteBouton, string> = {
  principal: 'bg-marque text-sur-marque hover:brightness-95 shadow-[inset_0_-1px_0_rgb(0_0_0/0.12)]',
  secondaire: 'bg-surface text-encre border border-trait-fort hover:bg-fond',
  discret: 'text-encre-2 hover:bg-fond hover:text-encre',
  danger: 'bg-surface text-urgent border border-urgent/35 hover:bg-urgent-doux',
  console: 'bg-console text-white hover:brightness-110',
};
const TAILLES: Record<TailleBouton, string> = {
  petit: 'h-8 px-3 text-sm gap-1.5',
  normal: 'h-10 px-4 text-[15px] gap-2',
  grand: 'h-12 px-5 text-base gap-2',
};

export function Bouton({
  variante = 'secondaire',
  taille = 'normal',
  icone,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variante?: VarianteBouton; taille?: TailleBouton; icone?: ReactNode }) {
  return (
    <button
      type="button"
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-lg font-semibold whitespace-nowrap transition-[filter,background-color] disabled:cursor-not-allowed disabled:opacity-50',
        VARIANTES[variante],
        TAILLES[taille],
        className,
      )}
      {...props}
    >
      {icone}
      {children}
    </button>
  );
}

/* ---------------------------------------------------------------- Formulaires */

export function Champ({
  libelle,
  aide,
  erreur,
  facultatif,
  children,
  className,
}: {
  libelle: string;
  aide?: ReactNode;
  erreur?: string;
  facultatif?: boolean;
  children: (id: string, decrit: string | undefined) => ReactNode;
  className?: string;
}) {
  const id = useId();
  const decrit = erreur || aide ? `${id}-aide` : undefined;
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-[15px] font-semibold text-encre">
        {libelle}
        {facultatif && <span className="ml-1.5 font-normal text-encre-3">(facultatif)</span>}
      </label>
      {children(id, decrit)}
      {erreur ? (
        <p id={decrit} className="text-sm font-semibold text-urgent">
          {erreur}
        </p>
      ) : aide ? (
        <p id={decrit} className="text-sm text-encre-3">
          {aide}
        </p>
      ) : null}
    </div>
  );
}

const CONTROLE =
  'w-full rounded-lg border bg-surface px-3 text-[15px] text-encre placeholder:text-encre-3 focus:border-focus focus:outline-2 focus:outline-offset-0 focus:outline-focus/25';

export function Saisie({ invalide, className, ...props }: InputHTMLAttributes<HTMLInputElement> & { invalide?: boolean }) {
  return <input className={cx(CONTROLE, 'h-11', invalide ? 'border-urgent' : 'border-trait-fort', className)} aria-invalid={invalide || undefined} {...props} />;
}

export function Texte({ invalide, className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & { invalide?: boolean }) {
  return <textarea className={cx(CONTROLE, 'min-h-28 py-2.5 leading-relaxed', invalide ? 'border-urgent' : 'border-trait-fort', className)} aria-invalid={invalide || undefined} {...props} />;
}

export function Liste({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx(CONTROLE, 'h-11 appearance-none border-trait-fort bg-[length:16px] bg-[right_12px_center] bg-no-repeat pr-9', className)} style={{ backgroundImage: CHEVRON }} {...props}>
      {children}
    </select>
  );
}
const CHEVRON = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2369737f' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`;

export function Interrupteur({ actif, libelle }: { actif: boolean; libelle: string }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <span role="switch" aria-checked={actif} aria-label={libelle} className={cx('relative inline-block h-6 w-10 rounded-full transition-colors', actif ? 'bg-marque' : 'bg-trait-fort')}>
        <span className={cx('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-[left]', actif ? 'left-[18px]' : 'left-0.5')} />
      </span>
    </span>
  );
}

/* ---------------------------------------------------------------- Statuts */

const STYLE_STATUT: Record<StatutReclamation, string> = {
  OUVERTE: 'text-ouverte bg-ouverte-doux',
  EN_COURS: 'text-en-cours bg-en-cours-doux',
  EN_ATTENTE_CLIENT: 'text-attente bg-attente-doux',
  RESOLUE: 'text-resolue bg-resolue-doux',
  CLOTUREE: 'text-cloturee bg-cloturee-doux',
};
const ICONE_STATUT: Record<StatutReclamation, typeof Inbox> = {
  OUVERTE: Inbox,
  EN_COURS: CircleDot,
  EN_ATTENTE_CLIENT: MessageCircleQuestionMark,
  RESOLUE: CircleCheck,
  CLOTUREE: Archive,
};

export function BadgeStatut({ statut, pourClient, grand }: { statut: StatutReclamation; pourClient?: boolean; grand?: boolean }) {
  const Icone = ICONE_STATUT[statut];
  return (
    <span className={cx('inline-flex items-center gap-1.5 rounded-md font-semibold whitespace-nowrap', grand ? 'px-2.5 py-1 text-[15px]' : 'px-2 py-0.5 text-[13px]', STYLE_STATUT[statut])}>
      <Icone aria-hidden size={grand ? 16 : 14} strokeWidth={2.4} />
      {pourClient ? STATUT_CLIENT[statut] : STATUT[statut]}
    </span>
  );
}

export function BadgeUrgent({ priorite }: { priorite: Priorite }) {
  if (priorite !== 'URGENTE') return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-urgent-doux px-2 py-0.5 text-[13px] font-semibold text-urgent">
      <Flame aria-hidden size={14} strokeWidth={2.4} />
      Urgente
    </span>
  );
}

export function Pastille({ n, ton = 'neutre' }: { n: number; ton?: 'neutre' | 'urgent' | 'marque' }) {
  return (
    <span
      className={cx(
        'chiffres inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-bold',
        ton === 'urgent' ? 'bg-urgent text-white' : ton === 'marque' ? 'bg-marque text-sur-marque' : 'bg-trait text-encre-2',
      )}
    >
      {n}
    </span>
  );
}

/* ---------------------------------------------------------------- Identité */

export function Avatar({ nom, taille = 32, ton = 'neutre' }: { nom: string; taille?: number; ton?: 'neutre' | 'marque' | 'client' }) {
  return (
    <span
      aria-hidden
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-full font-bold',
        ton === 'marque' ? 'bg-marque text-sur-marque' : ton === 'client' ? 'bg-attente-doux text-attente' : 'bg-fond text-encre-2 ring-1 ring-trait',
      )}
      style={{ width: taille, height: taille, fontSize: taille * 0.38 }}
    >
      {initiales(nom)}
    </span>
  );
}

/** Logo de la banque, ou son monogramme quand elle n'en a pas encore déposé. */
export function LogoBanque({ nom, logoUrl, taille = 36, inverse }: { nom: string; logoUrl: string | null; taille?: number; inverse?: boolean }) {
  if (logoUrl) return <img src={logoUrl} alt={nom} style={{ height: taille }} />;
  const lettres = initiales(nom.replace(/^(Banque|Caisse)\s+/i, ''));
  return (
    <span
      aria-hidden
      className={cx('inline-flex shrink-0 items-center justify-center rounded-[10px] font-extrabold tracking-tight', inverse ? 'bg-sur-marque text-marque' : 'bg-marque text-sur-marque')}
      style={{ width: taille, height: taille, fontSize: taille * 0.42 }}
    >
      {lettres}
    </span>
  );
}

/* ---------------------------------------------------------------- Mise en page */

export function Panneau({ titre, action, children, className, sansMarge }: { titre?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; sansMarge?: boolean }) {
  return (
    <section className={cx('rounded-xl border border-trait bg-surface', className)}>
      {(titre || action) && (
        <header className="flex items-center justify-between gap-3 border-b border-trait px-5 py-3.5">
          <h2 className="text-[17px] font-bold text-encre">{titre}</h2>
          {action}
        </header>
      )}
      <div className={sansMarge ? undefined : 'p-5'}>{children}</div>
    </section>
  );
}

export function Onglets<T extends string>({
  onglets,
  actif,
  surChoix,
}: {
  onglets: { cle: T; libelle: string; compte?: number; ton?: 'neutre' | 'urgent' | 'marque' }[];
  actif: T;
  surChoix: (cle: T) => void;
}) {
  return (
    <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-trait">
      {onglets.map((o) => (
        <button
          key={o.cle}
          role="tab"
          type="button"
          aria-selected={o.cle === actif}
          onClick={() => surChoix(o.cle)}
          className={cx(
            '-mb-px inline-flex items-center gap-2 border-b-[3px] px-3 py-2.5 text-[15px] font-semibold whitespace-nowrap',
            o.cle === actif ? 'border-marque text-encre' : 'border-transparent text-encre-3 hover:text-encre',
          )}
        >
          {o.libelle}
          {o.compte !== undefined && <Pastille n={o.compte} ton={o.compte > 0 ? (o.ton ?? 'neutre') : 'neutre'} />}
        </button>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- QR code */

/** QR code dessiné en SVG (le vrai sera servi par l'API : telechargerQrCode). */
export function QrCode({ texte, taille = 160, couleur = '#17212b' }: { texte: string; taille?: number; couleur?: string }) {
  const { data, size } = encode(texte, { ecc: 'M', border: 2 });
  let d = '';
  data.forEach((ligne, y) => ligne.forEach((plein, x) => { if (plein) d += `M${x} ${y}h1v1h-1z`; }));
  return (
    <svg role="img" aria-label={`QR code : ${texte}`} width={taille} height={taille} viewBox={`0 0 ${size} ${size}`} shapeRendering="crispEdges">
      <rect width={size} height={size} fill="#fff" />
      <path d={d} fill={couleur} />
    </svg>
  );
}
