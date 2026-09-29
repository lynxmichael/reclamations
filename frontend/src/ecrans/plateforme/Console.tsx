/**
 * Console de la plateforme (Super Admin, Makor Telecoms), servie sur console.<domaine>.
 * Elle voit les banques et leurs métadonnées, jamais le contenu d'une réclamation ni un client
 * (arbitrage 4, droits par colonne de l'étape 3).
 */
import type { ReactNode } from 'react';
import { Bell, Building2, ChartColumn, Layers, LogOut, ScrollText, ShieldUser } from 'lucide-react';
import type { S } from '../../api/types';
import { Avatar, Pastille, cx } from '../../ui/composants';
import { styleMarque } from '../../ui/marque';

export type PageConsole = 'banques' | 'activite' | 'plans' | 'alertes' | 'audit' | 'administrateurs';
export const COULEUR_CONSOLE = '#3b3a8a';

const LIENS: { cle: PageConsole; libelle: string; icone: typeof Bell }[] = [
  { cle: 'banques', libelle: 'Banques', icone: Building2 },
  { cle: 'activite', libelle: 'Activité et SMS', icone: ChartColumn },
  { cle: 'plans', libelle: 'Plans', icone: Layers },
  { cle: 'alertes', libelle: 'Alertes', icone: Bell },
  { cle: 'audit', libelle: "Journal d'audit", icone: ScrollText },
  { cle: 'administrateurs', libelle: 'Super Admins', icone: ShieldUser },
];

export function CadreConsole({
  page,
  moi,
  alertes,
  children,
  pages,
  lienDe,
  surNaviguer,
  surDeconnexion,
}: {
  page: PageConsole;
  moi: S<'Moi'>;
  alertes: number;
  children: ReactNode;
  /** Pages offertes (étape 8 : sans « Activité et SMS », qui arrive avec le reporting de l'étape 9) */
  pages?: PageConsole[];
  lienDe?: (page: PageConsole) => string;
  surNaviguer?: (page: PageConsole) => void;
  surDeconnexion?: () => void;
}) {
  const nom = `${moi.prenom} ${moi.nom}`;
  return (
    <div style={styleMarque(COULEUR_CONSOLE)} className="relative flex min-h-full flex-col bg-fond text-encre">
      <header className="flex h-16 shrink-0 items-center gap-8 bg-marque px-6 text-sur-marque">
        <div className="leading-tight">
          <div className="font-bold">Console de la plateforme</div>
          <div className="text-xs opacity-80">Makor Telecoms</div>
        </div>
        <nav aria-label="Menu principal" className="flex h-full items-stretch gap-1">
          {LIENS.filter((l) => !pages || pages.includes(l.cle)).map((l) => (
            <a
              key={l.cle}
              href={lienDe ? lienDe(l.cle) : `#${l.cle}`}
              onClick={(e) => {
                if (surNaviguer && !e.metaKey && !e.ctrlKey && !e.shiftKey && e.button === 0) {
                  e.preventDefault();
                  surNaviguer(l.cle);
                }
              }}
              aria-current={l.cle === page ? 'page' : undefined}
              className={cx(
                'flex items-center gap-2 border-b-[3px] px-3 text-[15px]',
                l.cle === page ? 'border-sur-marque font-semibold' : 'border-transparent opacity-80 hover:opacity-100',
              )}
            >
              <l.icone aria-hidden size={17} />
              {l.libelle}
              {l.cle === 'alertes' && alertes > 0 && <Pastille n={alertes} ton="urgent" />}
            </a>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2.5">
          <Avatar nom={nom} taille={32} />
          <div className="leading-tight">
            <div className="text-[15px] font-semibold">{nom}</div>
            <div className="text-xs opacity-80">Super Admin</div>
          </div>
          {surDeconnexion && (
            <button type="button" onClick={surDeconnexion} aria-label="Se déconnecter" title="Se déconnecter" className="ml-1 rounded-lg p-2 opacity-80 hover:bg-white/10 hover:opacity-100">
              <LogOut size={18} />
            </button>
          )}
        </div>
      </header>
      <main className="min-w-0 flex-1 px-8 py-7">{children}</main>
    </div>
  );
}
