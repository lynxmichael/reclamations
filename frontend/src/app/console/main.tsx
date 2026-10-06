import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { SessionPersonnel } from '../../api/session-personnel';
import { Annonces } from '../commun/Annonces';
import { Introuvable } from '../commun/Etats';
import { creerCache } from '../commun/requetes';
import { PageConnexion, PageInvitation, PageMotDePasseOublie, PageReinitialisation } from './Authentification';
import { Accueil, Protege, Reserve } from './Cadre';
import { ROUTES_BANQUE, ROUTES_PLATEFORME } from './contexte';
import { PageAbsences, PageAttribution } from './Attribution';
import { PageConversations } from './Conversations';
import { PageAssistant, PageAudit, PageBanque, PageCategories, PageHoraires, PagePersonnel, PagePoints } from './Parametrage';
import { PageAdministrateurs, PageAlertes, PageBanques, PageJournalPlateforme, PagePlans } from './Plateforme';
import { PageFiche, PageFiles, PageNouvelle } from './Reclamations';
import { PageCompte } from './Compte';
import { PageActivite, PageAgences, PageTableau } from './Reporting';
import '../../styles.css';
import '../commun/cadre.css';

const session = new SessionPersonnel();
void session.reprendre();
const cache = creerCache();

const BANQUE = ['AGENT', 'SUPERVISEUR', 'ADMIN_ENTREPRISE'] as const;
const ENCADREMENT = ['SUPERVISEUR', 'ADMIN_ENTREPRISE'] as const;
const ADMIN = ['ADMIN_ENTREPRISE'] as const;
const PLATEFORME = ['SUPER_ADMIN'] as const;

const routeur = createBrowserRouter([
  { path: '/connexion', element: <PageConnexion session={session} /> },
  { path: '/invitation', element: <PageInvitation session={session} /> },
  { path: '/mot-de-passe-oublie', element: <PageMotDePasseOublie session={session} /> },
  { path: '/mot-de-passe', element: <PageReinitialisation session={session} /> },
  {
    element: <Protege session={session} />,
    children: [
      { path: '/', element: <Accueil /> },
      { path: ROUTES_BANQUE.reclamations, element: <Reserve roles={[...BANQUE]}><PageFiles /></Reserve> },
      { path: `${ROUTES_BANQUE.reclamations}/nouvelle`, element: <Reserve roles={['AGENT', 'SUPERVISEUR']}><PageNouvelle /></Reserve> },
      { path: `${ROUTES_BANQUE.reclamations}/:id`, element: <Reserve roles={[...BANQUE]}><PageFiche /></Reserve> },
      { path: ROUTES_BANQUE.conversations, element: <Reserve roles={[...BANQUE]}><PageConversations /></Reserve> },
      { path: `${ROUTES_BANQUE.conversations}/:id`, element: <Reserve roles={[...BANQUE]}><PageConversations /></Reserve> },
      { path: ROUTES_BANQUE.tableau, element: <Reserve roles={['AGENT', ...ENCADREMENT]}><PageTableau /></Reserve> },
      { path: ROUTES_BANQUE.agences, element: <Reserve roles={[...ENCADREMENT]}><PageAgences /></Reserve> },
      { path: ROUTES_BANQUE.compte, element: <Reserve roles={[...BANQUE]}><PageCompte /></Reserve> },
      { path: ROUTES_BANQUE.categories, element: <Reserve roles={[...ADMIN]}><PageCategories /></Reserve> },
      { path: ROUTES_BANQUE.points, element: <Reserve roles={[...ENCADREMENT]}><PagePoints /></Reserve> },
      { path: ROUTES_BANQUE.horaires, element: <Reserve roles={[...ADMIN]}><PageHoraires /></Reserve> },
      { path: ROUTES_BANQUE.banque, element: <Reserve roles={[...ADMIN]}><PageBanque /></Reserve> },
      { path: ROUTES_BANQUE.attribution, element: <Reserve roles={[...ENCADREMENT]}><PageAttribution /></Reserve> },
      { path: ROUTES_BANQUE.assistant, element: <Reserve roles={[...ADMIN]}><PageAssistant /></Reserve> },
      { path: ROUTES_BANQUE.personnel, element: <Reserve roles={[...ENCADREMENT]}><PagePersonnel /></Reserve> },
      { path: ROUTES_BANQUE.absences, element: <Reserve roles={[...ENCADREMENT]}><PageAbsences /></Reserve> },
      { path: ROUTES_BANQUE.audit, element: <Reserve roles={[...ADMIN]}><PageAudit /></Reserve> },
      { path: ROUTES_PLATEFORME.banques, element: <Reserve roles={[...PLATEFORME]}><PageBanques /></Reserve> },
      { path: ROUTES_PLATEFORME.activite, element: <Reserve roles={[...PLATEFORME]}><PageActivite /></Reserve> },
      { path: ROUTES_PLATEFORME.plans, element: <Reserve roles={[...PLATEFORME]}><PagePlans /></Reserve> },
      { path: ROUTES_PLATEFORME.alertes, element: <Reserve roles={[...PLATEFORME]}><PageAlertes /></Reserve> },
      { path: ROUTES_PLATEFORME.audit, element: <Reserve roles={[...PLATEFORME]}><PageJournalPlateforme /></Reserve> },
      { path: ROUTES_PLATEFORME.administrateurs, element: <Reserve roles={[...PLATEFORME]}><PageAdministrateurs /></Reserve> },
    ],
  },
  { path: '*', element: <Introuvable /> },
]);

createRoot(document.getElementById('racine')!).render(
  <StrictMode>
    <QueryClientProvider client={cache}>
      <Annonces>
        <RouterProvider router={routeur} />
      </Annonces>
    </QueryClientProvider>
  </StrictMode>,
);
