/**
 * Cadre du back-office de la banque. La navigation suit le rôle (x-roles du contrat) :
 * l'agent ne voit que ses réclamations ; le superviseur ajoute le tableau de bord, les QR codes
 * et son équipe ; l'Admin Entreprise paramètre la banque et consulte le journal d'audit.
 * Étape 19 : l'activité des agences (superviseurs et Admin Entreprise) ; « Mon compte » depuis le
 * nom de la personne connectée, en haut à droite ; un bandeau au-dessus de la page.
 */
import type { ReactNode } from 'react';
import {
  Bell, Bot, Building2, CalendarClock, CalendarOff, ChartColumn, Inbox, ListChecks, LogOut, MessagesSquare, QrCode, ScrollText, Search, Store, Users, Waypoints,
} from 'lucide-react';
import type { S } from '../../api/types';
import { Avatar, LogoBanque, Pastille, cx } from '../../ui/composants';
import { relatif } from '../../ui/format';
import { ROLE } from '../../ui/libelles';
import { styleMarque } from '../../ui/marque';

export type PageBackOffice =
  | 'reclamations' | 'conversations' | 'tableau' | 'agences' | 'categories' | 'points' | 'horaires' | 'banque' | 'attribution' | 'assistant' | 'personnel' | 'absences' | 'audit'
  | 'compte';

const NAVIGATION: { titre: string | null; liens: { cle: PageBackOffice; libelle: string; icone: typeof Inbox; roles: S<'RoleUtilisateur'>[] }[] }[] = [
  {
    titre: null,
    liens: [
      { cle: 'reclamations', libelle: 'Réclamations', icone: Inbox, roles: ['AGENT', 'SUPERVISEUR', 'ADMIN_ENTREPRISE'] },
      // Étape 17 : seulement si Makor a ouvert le chat web à la banque (pages offertes)
      { cle: 'conversations', libelle: 'Conversations', icone: MessagesSquare, roles: ['AGENT', 'SUPERVISEUR', 'ADMIN_ENTREPRISE'] },
      { cle: 'tableau', libelle: 'Tableau de bord', icone: ChartColumn, roles: ['AGENT', 'SUPERVISEUR', 'ADMIN_ENTREPRISE'] },
      // Étape 19 : ce que fait chaque agence
      { cle: 'agences', libelle: 'Activité des agences', icone: Store, roles: ['SUPERVISEUR', 'ADMIN_ENTREPRISE'] },
    ],
  },
  {
    titre: 'Paramétrage',
    liens: [
      { cle: 'categories', libelle: 'Catégories et délais', icone: ListChecks, roles: ['ADMIN_ENTREPRISE'] },
      { cle: 'points', libelle: 'Agences et QR codes', icone: QrCode, roles: ['SUPERVISEUR', 'ADMIN_ENTREPRISE'] },
      { cle: 'horaires', libelle: 'Horaires et jours fériés', icone: CalendarClock, roles: ['ADMIN_ENTREPRISE'] },
      { cle: 'banque', libelle: 'Banque et apparence', icone: Building2, roles: ['ADMIN_ENTREPRISE'] },
      // Étape 16 : seulement si Makor a ouvert l'attribution automatique à la banque (pages offertes)
      { cle: 'attribution', libelle: 'Attribution et escalade', icone: Waypoints, roles: ['SUPERVISEUR', 'ADMIN_ENTREPRISE'] },
      // Étape 18 : seulement si Makor a ouvert l'assistant IA à la banque (pages offertes)
      { cle: 'assistant', libelle: 'Assistant IA', icone: Bot, roles: ['ADMIN_ENTREPRISE'] },
    ],
  },
  {
    titre: 'Équipe',
    liens: [
      { cle: 'personnel', libelle: 'Personnel', icone: Users, roles: ['SUPERVISEUR', 'ADMIN_ENTREPRISE'] },
      { cle: 'absences', libelle: 'Absences', icone: CalendarOff, roles: ['SUPERVISEUR', 'ADMIN_ENTREPRISE'] },
      { cle: 'audit', libelle: "Journal d'audit", icone: ScrollText, roles: ['ADMIN_ENTREPRISE'] },
    ],
  },
];

export function CadreBackOffice({
  banque,
  moi,
  page,
  aTraiter,
  aRepondre,
  notifications,
  notificationsOuvertes,
  maintenant,
  children,
  surNaviguer,
  surCloche,
  surOuvrirNotification,
  surToutLire,
  pages,
  lienDe,
  surRechercher,
  rechercheInitiale,
  surDeconnexion,
  bandeau,
}: {
  banque: S<'BanquePublique'>;
  moi: S<'Moi'>;
  page: PageBackOffice;
  /** Pastille du menu Réclamations : les réclamations à traiter de l'utilisateur */
  aTraiter?: number;
  /** Pastille du menu Conversations : les clients qui attendent une réponse (étape 17) */
  aRepondre?: number;
  notifications: S<'PageNotifications'>;
  notificationsOuvertes?: boolean;
  maintenant: string;
  children: ReactNode;
  /** Démo cliquable : navigation, notifications */
  surNaviguer?: (page: PageBackOffice) => void;
  surCloche?: () => void;
  /** reclamationId vide : une alerte sans réclamation (étape 21 : dossiers à réassigner) */
  surOuvrirNotification?: (reclamationId: string | null, notificationId: string) => void;
  surToutLire?: () => void;
  /** Pages offertes (étape 8 : sans le tableau de bord, qui arrive à l'étape 9) */
  pages?: PageBackOffice[];
  /** Adresse de chaque page (clic milieu, nouvel onglet) */
  lienDe?: (page: PageBackOffice) => string;
  /** Recherche par numéro, nom ou téléphone du client */
  surRechercher?: (texte: string) => void;
  rechercheInitiale?: string;
  surDeconnexion?: () => void;
  /** Étape 19 : message au-dessus de la page (double authentification à activer) */
  bandeau?: ReactNode;
}) {
  const nom = `${moi.prenom} ${moi.nom}`;
  return (
    <div style={styleMarque(banque.couleurPrimaire)} className="relative flex min-h-full bg-fond text-encre">
      <nav aria-label="Menu principal" className="w-60 shrink-0 border-r border-trait bg-surface">
        <div className="sticky top-0">
        <div className="flex h-16 items-center gap-2.5 border-b border-trait px-4">
          <LogoBanque nom={banque.nom} logoUrl={banque.logoUrl} taille={32} />
          <div className="leading-tight">
            <div className="font-bold">{banque.nom}</div>
            <div className="text-xs text-encre-3">Réclamations</div>
          </div>
        </div>
        <div className="flex flex-col gap-5 px-3 py-4">
          {NAVIGATION.map((groupe) => {
            const liens = groupe.liens.filter((l) => l.roles.includes(moi.role) && (!pages || pages.includes(l.cle)));
            if (liens.length === 0) return null;
            return (
              <div key={groupe.titre ?? 'principal'}>
                {groupe.titre && <p className="mb-1.5 px-3 text-[13px] font-semibold text-encre-3">{groupe.titre}</p>}
                <ul className="flex flex-col gap-0.5">
                  {liens.map((l) => {
                    const actif = l.cle === page;
                    return (
                      <li key={l.cle}>
                        <a
                          href={lienDe ? lienDe(l.cle) : `#${l.cle}`}
                          data-visite={`menu-${l.cle}`}
                          onClick={(e) => {
                            if (surNaviguer && !e.metaKey && !e.ctrlKey && !e.shiftKey && e.button === 0) {
                              e.preventDefault();
                              surNaviguer(l.cle);
                            }
                          }}
                          aria-current={actif ? 'page' : undefined}
                          className={cx(
                            'relative flex items-center gap-3 rounded-lg px-3 py-2 text-[15px]',
                            actif ? 'bg-marque-doux font-semibold text-encre' : 'text-encre-2 hover:bg-fond hover:text-encre',
                          )}
                        >
                          {actif && <span aria-hidden className="absolute top-1.5 bottom-1.5 -left-3 w-1 rounded-r bg-marque" />}
                          <l.icone aria-hidden size={18} strokeWidth={2.1} className={actif ? 'text-marque-texte' : undefined} />
                          <span className="flex-1">{l.libelle}</span>
                          {l.cle === 'reclamations' && aTraiter !== undefined && <Pastille n={aTraiter} />}
                          {l.cle === 'conversations' && aRepondre !== undefined && aRepondre > 0 && <Pastille n={aRepondre} ton="marque" />}
                        </a>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
        </div>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="relative flex h-16 shrink-0 items-center gap-4 border-b border-trait bg-surface px-6">
          <form
            role="search"
            className="relative w-full max-w-md"
            onSubmit={(e) => {
              e.preventDefault();
              surRechercher?.(String(new FormData(e.currentTarget).get('recherche') ?? '').trim());
            }}
          >
            <label>
              <span className="sr-only">Rechercher une réclamation</span>
              <Search aria-hidden size={18} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-encre-3" />
              <input
                key={rechercheInitiale ?? ''}
                type="search"
                name="recherche"
                defaultValue={rechercheInitiale}
                placeholder="Numéro, nom ou téléphone du client"
                className="h-10 w-full rounded-lg border border-trait bg-fond pr-3 pl-10 text-[15px] placeholder:text-encre-3 focus:border-focus focus:bg-surface focus:outline-none"
              />
            </label>
          </form>
          <div className="ml-auto flex items-center gap-2">
            <button type="button" onClick={surCloche} data-visite="cloche" aria-label={`Notifications, ${notifications.nonLues} non lues`} aria-expanded={notificationsOuvertes} className={cx('relative rounded-lg p-2.5 text-encre-2 hover:bg-fond', notificationsOuvertes && 'bg-fond text-encre')}>
              <Bell size={20} />
              {notifications.nonLues > 0 && (
                <span className="absolute top-1 right-1">
                  <Pastille n={notifications.nonLues} ton="urgent" />
                </span>
              )}
            </button>
            <div className="ml-2 flex items-center gap-2.5 border-l border-trait pl-4">
              {/* Étape 19 : « Mon compte », depuis le nom de la personne connectée */}
              <a
                href={lienDe ? lienDe('compte') : '#compte'}
                data-visite="menu-compte"
                title="Mon compte"
                aria-current={page === 'compte' ? 'page' : undefined}
                onClick={(e) => {
                  if (surNaviguer && !e.metaKey && !e.ctrlKey && !e.shiftKey && e.button === 0) {
                    e.preventDefault();
                    surNaviguer('compte');
                  }
                }}
                className="-my-1 flex items-center gap-2.5 rounded-lg py-1 pr-2 pl-1 hover:bg-fond"
              >
                <Avatar nom={nom} taille={34} ton="marque" />
                <span className="leading-tight">
                  <span className="block text-[15px] font-semibold">{nom}</span>
                  <span className="block text-[13px] text-encre-3">{ROLE[moi.role]} · Mon compte</span>
                </span>
              </a>
              {surDeconnexion && (
                <button type="button" onClick={surDeconnexion} aria-label="Se déconnecter" title="Se déconnecter" className="ml-1 rounded-lg p-2 text-encre-3 hover:bg-fond hover:text-encre">
                  <LogOut size={18} />
                </button>
              )}
            </div>
          </div>
          {notificationsOuvertes && (
            <PanneauNotifications notifications={notifications} maintenant={maintenant} surOuvrir={surOuvrirNotification} surToutLire={surToutLire} />
          )}
        </header>
        <main className="min-w-0 flex-1 px-8 py-7">
          {bandeau}
          {children}
        </main>
      </div>
    </div>
  );
}

function PanneauNotifications({
  notifications,
  maintenant,
  surOuvrir,
  surToutLire,
}: {
  notifications: S<'PageNotifications'>;
  maintenant: string;
  surOuvrir?: (reclamationId: string | null, notificationId: string) => void;
  surToutLire?: () => void;
}) {
  return (
    <div role="dialog" aria-label="Notifications" className="absolute top-14 right-40 z-20 w-[400px] overflow-hidden rounded-xl border border-trait bg-surface shadow-[0_12px_32px_rgb(23_33_43/0.16)]">
      <div className="flex items-center justify-between border-b border-trait px-4 py-3">
        <p className="font-bold">Notifications</p>
        <button type="button" onClick={surToutLire} className="text-sm font-semibold text-marque-texte hover:underline">
          Tout marquer comme lu
        </button>
      </div>
      <ul className="max-h-[420px] overflow-auto">
        {notifications.donnees.length === 0 && <li className="px-4 py-8 text-center text-sm text-encre-3">Aucune notification pour l'instant.</li>}
        {notifications.donnees.map((n) => (
          <li key={n.id} className="border-b border-trait last:border-0">
            <button
              type="button"
              disabled={!surOuvrir || (!n.reclamationId && n.modele !== 'superviseur.reassignation')}
              onClick={() => surOuvrir?.(n.reclamationId, n.id)}
              className={cx('flex w-full gap-3 px-4 py-3 text-left enabled:hover:bg-fond', !n.lueLe && 'bg-marque-doux/60')}
            >
              <span aria-hidden className={cx('mt-2 h-2 w-2 shrink-0 rounded-full', n.lueLe ? 'bg-transparent' : 'bg-urgent')} />
              <span className="min-w-0 text-sm">
                <span className="block font-semibold text-encre">{n.sujet}</span>
                <span className="mt-0.5 block leading-snug text-encre-2">{n.contenu}</span>
                <span className="mt-1 block text-encre-3">{relatif(n.creeLe, maintenant)}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
