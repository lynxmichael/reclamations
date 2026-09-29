/**
 * Écritures depuis un formulaire : l'appel, puis la relecture des listes touchées, un message de
 * réussite, ou les erreurs par champ de l'API (RFC 9457) pour les afficher sous chaque champ.
 */
import { useCallback, useState } from 'react';
import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { ErreurApi, messageErreur } from '../../api/client';
import { useAnnoncer } from './Annonces';

export function useEcriture(aRelire: QueryKey[]) {
  const cache = useQueryClient();
  const annoncer = useAnnoncer();
  const [erreurs, setErreurs] = useState<Record<string, string>>({});
  const mutation = useMutation({ mutationFn: (faire: () => Promise<unknown>) => faire() });
  const { mutateAsync } = mutation;
  const cles = JSON.stringify(aRelire);

  const ecrire = useCallback(
    async (faire: () => Promise<unknown>, succes?: string): Promise<boolean> => {
      setErreurs({});
      try {
        await mutateAsync(faire);
        await Promise.all((JSON.parse(cles) as QueryKey[]).map((queryKey) => cache.invalidateQueries({ queryKey })));
        if (succes) annoncer(succes);
        return true;
      } catch (e) {
        if (e instanceof ErreurApi && e.probleme.erreurs?.length) {
          setErreurs(Object.fromEntries(e.probleme.erreurs.map((x) => [x.champ.replace(/^\//, '').split(/[./]/).pop()!, x.message])));
        }
        annoncer(messageErreur(e), 'erreur');
        return false;
      }
    },
    [mutateAsync, cache, annoncer, cles],
  );
  return { ecrire, occupe: mutation.isPending, erreurs };
}
