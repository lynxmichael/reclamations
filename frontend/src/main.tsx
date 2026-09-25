import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createHashRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { Sommaire, VueEcran } from './maquettes/galerie/Galerie';
import './styles.css';

/** Routeur par ancre (#/…) : la page unique docs/maquettes/index.html s'ouvre sans serveur. */
const routeur = createHashRouter([
  { path: '/', element: <Sommaire /> },
  { path: '/:groupe/:ecran', element: <VueEcran /> },
  { path: '*', element: <Sommaire /> },
]);

createRoot(document.getElementById('racine')!).render(
  <StrictMode>
    <RouterProvider router={routeur} />
  </StrictMode>,
);
