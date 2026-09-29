/** Lectures de l'API avec TanStack Query : cache, relecture périodique, relecture après une action. */
import { QueryClient } from '@tanstack/react-query';
import { ErreurApi } from '../../api/client';

export function creerCache(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Une erreur de la requête elle-même (4xx) ne se corrige pas en réessayant
        retry: (essais, e) => !(e instanceof ErreurApi && e.statut >= 400 && e.statut < 500) && essais < 2,
        staleTime: 15_000,
        refetchOnWindowFocus: true,
      },
      mutations: { retry: false },
    },
  });
}

/** Nouvelle clé d'idempotence (décision B7) : une par envoi, gardée si le réseau a coupé. */
export function nouvelleCle(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}
