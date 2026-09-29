/**
 * Cadres de la console une fois connecté : le back-office pour le personnel d'une banque, la
 * console de la plateforme pour le Super Admin. Sans session : retour à la connexion, avec
 * l'adresse demandée pour y revenir ensuite.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LockKeyhole } from 'lucide-react';
import { messageErreur } from '../../api/client';
import { useEtatSession, type SessionPersonnel } from '../../api/session-personnel';
import type { S } from '../../api/types';
import { CadreBackOffice, type PageBackOffice } from '../../ecrans/back-office/CadreBackOffice';
import { CadreConsole } from '../../ecrans/plateforme/Console';
import { ROLE } from '../../ui/libelles';
import { useAnnoncer } from '../commun/Annonces';
import { Chargement, ErreurChargement } from '../commun/Etats';
import { ContexteConsole, PAGES_BANQUE, PAGES_PLATEFORME, ROUTES_BANQUE, ROUTES_PLATEFORME, pageDe, useConsole, type Console } from './contexte';

/** Rafraîchissement des notifications et des compteurs (décision F6) */
export const INTERVALLE_MS = 30_000;

export function Protege({ session }: { session: SessionPersonnel }) {
  const etat = useEtatSession(session);
  const location = useLocation();
  if (etat.statut === 'reprise') return <Chargement pleinEcran texte="Ouverture de la console…" />;
  if (etat.statut === 'deconnecte') {
    const retour = location.pathname + location.search;
    const params = new URLSearchParams();
    if (retour !== '/') params.set('retour', retour);
    if (etat.motif === 'expiree') params.set('expiree', '1');
    const q = params.toString();
    return <Navigate to={`/connexion${q ? `?${q}` : ''}`} replace />;
  }
  return etat.moi.role === 'SUPER_ADMIN' ? <CadrePlateforme session={session} moi={etat.moi} /> : <CadreBanque session={session} moi={etat.moi} />;
}

function useDeconnexion(session: SessionPersonnel) {
  const cache = useQueryClient();
  const navigate = useNavigate();
  return async () => {
    await session.deconnecter();
    cache.clear();
    navigate('/connexion', { replace: true, state: { information: 'Vous êtes déconnecté.' } });
  };
}

function CadreBanque({ session, moi }: { session: SessionPersonnel; moi: S<'Moi'> }) {
  const appeler = session.appeler;
  const location = useLocation();
  const navigate = useNavigate();
  const cache = useQueryClient();
  const annoncer = useAnnoncer();
  const deconnecter = useDeconnexion(session);
  const [notifsOuvertes, setNotifsOuvertes] = useState(false);
  const parametres = useQuery({ queryKey: ['parametres'], queryFn: () => appeler('lireParametresBanque'), staleTime: 60_000 });
  const notifications = useQuery({ queryKey: ['notifications'], queryFn: () => appeler('listerNotifications', { requete: { parPage: 20 } }), refetchInterval: INTERVALLE_MS });
  const agent = moi.role === 'AGENT';
  const compteurs = useQuery({
    queryKey: ['compteurs'],
    queryFn: () => appeler('listerReclamations', { requete: { file: agent ? 'assignees' : 'recues', parPage: 1 } }),
    refetchInterval: INTERVALLE_MS,
    select: (p) => p.compteurs,
  });
  useEffect(() => setNotifsOuvertes(false), [location.pathname]);

  const lue = useMutation({
    mutationFn: (id: string) => appeler('marquerNotificationLue', { chemin: { id } }),
    onSettled: () => void cache.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const toutLire = useMutation({
    mutationFn: () => appeler('marquerToutesNotificationsLues'),
    onSuccess: () => void cache.invalidateQueries({ queryKey: ['notifications'] }),
    onError: (e) => annoncer(messageErreur(e), 'erreur'),
  });

  const contexte = useMemo<Console | null>(() => (parametres.data ? { session, appeler, moi, parametres: parametres.data } : null), [session, appeler, moi, parametres.data]);
  if (parametres.isPending) return <Chargement pleinEcran />;
  if (parametres.isError) return <ErreurChargement erreur={parametres.error} surReessayer={() => void parametres.refetch()} pleinEcran />;
  const p = parametres.data;
  const banque: S<'BanquePublique'> = { nom: p.nom, slug: p.slug, logoUrl: p.logoUrl, couleurPrimaire: p.couleurPrimaire, couleurSecondaire: p.couleurSecondaire };
  const page = pageDe(ROUTES_BANQUE, location.pathname) ?? 'reclamations';
  const recherche = page === 'reclamations' && !location.pathname.startsWith('/reclamations/') ? new URLSearchParams(location.search).get('recherche') ?? '' : '';

  return (
    <ContexteConsole.Provider value={contexte}>
      {/* Poste de travail (décision F9) : sous 1 180 px, la page défile plutôt que de s'écraser */}
      <div className="h-full min-w-[1180px]">
      <CadreBackOffice
        banque={banque}
        moi={moi}
        page={page}
        pages={PAGES_BANQUE}
        aTraiter={compteurs.data ? (agent ? compteurs.data.assignees : compteurs.data.recues) : undefined}
        notifications={notifications.data ?? { donnees: [], pagination: { page: 1, parPage: 20, total: 0 }, nonLues: 0 }}
        notificationsOuvertes={notifsOuvertes}
        maintenant={new Date().toISOString()}
        lienDe={(c) => ROUTES_BANQUE[c]}
        surNaviguer={(c: PageBackOffice) => navigate(ROUTES_BANQUE[c])}
        surRechercher={(texte) => navigate(texte ? `/reclamations?file=toutes&recherche=${encodeURIComponent(texte)}` : '/reclamations')}
        rechercheInitiale={recherche}
        surCloche={() => setNotifsOuvertes((o) => !o)}
        surOuvrirNotification={(reclamationId, notificationId) => {
          lue.mutate(notificationId);
          navigate(`/reclamations/${reclamationId}`);
        }}
        surToutLire={() => toutLire.mutate()}
        surDeconnexion={() => void deconnecter()}
      >
        <Outlet />
      </CadreBackOffice>
      </div>
    </ContexteConsole.Provider>
  );
}

function CadrePlateforme({ session, moi }: { session: SessionPersonnel; moi: S<'Moi'> }) {
  const location = useLocation();
  const navigate = useNavigate();
  const deconnecter = useDeconnexion(session);
  const alertes = useQuery({
    queryKey: ['alertes-non-lues'],
    queryFn: () => session.appeler('listerNotificationsPlateforme', { requete: { nonLues: true, parPage: 1 } }),
    refetchInterval: INTERVALLE_MS,
    select: (p) => p.nonLues,
  });
  const contexte = useMemo<Console>(() => ({ session, appeler: session.appeler, moi, parametres: null }), [session, moi]);
  const page = pageDe(ROUTES_PLATEFORME, location.pathname) ?? 'banques';
  return (
    <ContexteConsole.Provider value={contexte}>
      <div className="h-full min-w-[1180px]">
      <CadreConsole
        page={page}
        moi={moi}
        alertes={alertes.data ?? 0}
        pages={PAGES_PLATEFORME}
        lienDe={(c) => ROUTES_PLATEFORME[c]}
        surNaviguer={(c) => navigate(ROUTES_PLATEFORME[c])}
        surDeconnexion={() => void deconnecter()}
      >
        <Outlet />
      </CadreConsole>
      </div>
    </ContexteConsole.Provider>
  );
}

/** Page d'accueil selon le rôle. */
export function Accueil() {
  const { moi } = useConsole();
  return <Navigate to={moi.role === 'SUPER_ADMIN' ? ROUTES_PLATEFORME.banques : ROUTES_BANQUE.reclamations} replace />;
}

/** Page réservée à certains rôles (x-roles du contrat) ; l'API refuserait de toute façon. */
export function Reserve({ roles, children }: { roles: S<'RoleUtilisateur'>[]; children: ReactNode }) {
  const { moi } = useConsole();
  if (roles.includes(moi.role)) return <>{children}</>;
  return (
    <div className="flex flex-col items-center py-20 text-center">
      <LockKeyhole aria-hidden size={30} className="text-encre-3" />
      <h1 className="mt-3 text-xl font-bold">Page réservée</h1>
      <p className="mt-1 max-w-[52ch] text-[15px] text-encre-2">
        Elle est réservée aux rôles : {roles.map((r) => ROLE[r]).join(', ')}. Vous êtes connecté en tant que {ROLE[moi.role]}.
      </p>
    </div>
  );
}

