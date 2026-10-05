/**
 * « Mon compte » (étape 19) : preparerTotp, confirmerTotp, desactiverTotp. Le profil de la session
 * est mis à jour aussitôt (bandeau, page Personnel).
 */
import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ErreurApi, PROBLEME_RESEAU } from '../../api/client';
import type { S } from '../../api/types';
import { Compte } from '../../ecrans/back-office/Compte';
import { useAnnoncer } from '../commun/Annonces';
import { useConsole, useParametres } from './contexte';

const probleme = (e: unknown): S<'Probleme'> => (e instanceof ErreurApi ? e.probleme : PROBLEME_RESEAU);

export function PageCompte() {
  const { appeler, moi, session } = useConsole();
  const parametres = useParametres();
  const annoncer = useAnnoncer();
  const [erreur, setErreur] = useState<S<'Probleme'> | null>(null);
  useEffect(() => {
    document.title = 'Mon compte — Réclamations';
  }, []);

  const preparation = useMutation({ mutationFn: () => appeler('preparerTotp') });
  const confirmation = useMutation({ mutationFn: (code: string) => appeler('confirmerTotp', { corps: { code } }) });
  const desactivation = useMutation({ mutationFn: (code: string) => appeler('desactiverTotp', { corps: { code } }) });

  const finir = async (faire: () => Promise<S<'Moi'>>, message: string) => {
    setErreur(null);
    try {
      session.actualiser(await faire());
      annoncer(message);
      return true;
    } catch (e) {
      setErreur(probleme(e));
      return false;
    }
  };

  return (
    <Compte
      moi={moi}
      banque={parametres.nom}
      actions={{
        occupe: preparation.isPending || confirmation.isPending || desactivation.isPending,
        erreur,
        preparer: async () => {
          setErreur(null);
          try {
            return await preparation.mutateAsync();
          } catch (e) {
            annoncer(probleme(e).detail ?? probleme(e).title, 'erreur');
            return null;
          }
        },
        confirmer: (code) => finir(() => confirmation.mutateAsync(code), 'Double authentification activée : un code vous sera demandé à chaque connexion.'),
        desactiver: (code) => finir(() => desactivation.mutateAsync(code), 'Double authentification désactivée. Vos autres sessions sont fermées.'),
      }}
    />
  );
}
