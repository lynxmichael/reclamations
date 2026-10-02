import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { SessionClient } from '../../api/session-client';
import { Annonces } from '../commun/Annonces';
import { Introuvable } from '../commun/Etats';
import { creerCache } from '../commun/requetes';
import { PageAccueil, PageAvis, PageDepot, PageMaReclamation, PageMesReclamations, PagePolitique, PageSuivi } from './Portail';
import '../../styles.css';
import '../commun/cadre.css';

const session = new SessionClient();
const cache = creerCache();

const routeur = createBrowserRouter([
  { path: '/', element: <PageAccueil /> },
  { path: '/d/:code', element: <PageDepot session={session} /> },
  { path: '/suivi/:jeton', element: <PageSuivi session={session} /> },
  { path: '/suivi/:jeton/avis', element: <PageAvis session={session} /> },
  { path: '/mes-reclamations', element: <PageMesReclamations session={session} /> },
  { path: '/mes-reclamations/:id', element: <PageMaReclamation session={session} /> },
  { path: '/politique-donnees', element: <PagePolitique session={session} /> },
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
