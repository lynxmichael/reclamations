/**
 * Baromètre mensuel (étape 23) : listerBarometres, lireBarometre, deciderRecommandation. Le mois
 * affiché est dans l'adresse (?mois=2026-09), le plus récent par défaut. Page offerte quand Makor a
 * ouvert la fonction ; sinon l'API répond FONCTION_NON_OUVERTE.
 */
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { S } from '../../api/types';
import { Barometre } from '../../ecrans/back-office/Barometre';
import { useEcriture } from '../commun/ecriture';
import { Chargement, ErreurChargement } from '../commun/Etats';
import { ROUTES_BANQUE, useConsole, useParametres } from './contexte';

const MESSAGE: Record<S<'DecisionRecommandationValeur'>, string> = {
  RETENUE: 'Recommandation retenue.',
  ECARTEE: 'Recommandation écartée.',
  A_ETUDIER: 'Recommandation remise à l\'étude.',
};

export function PageBarometre() {
  const { appeler, moi } = useConsole();
  const parametres = useParametres();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [enCours, setEnCours] = useState<string | null>(null);
  useEffect(() => {
    document.title = 'Baromètre — Réclamations';
  }, []);

  const liste = useQuery({ queryKey: ['barometres'], queryFn: () => appeler('listerBarometres') });
  const demande = params.get('mois');
  const mois = liste.data?.donnees.some((x) => x.mois === demande) ? demande! : liste.data?.donnees[0]?.mois ?? null;
  const barometre = useQuery({
    queryKey: ['barometre', mois],
    queryFn: () => appeler('lireBarometre', { chemin: { mois: mois! } }),
    enabled: !!mois,
    placeholderData: keepPreviousData,
  });
  const { ecrire } = useEcriture([['barometre', mois], ['barometres']]);

  if (liste.isPending || (mois && barometre.isPending)) return <Chargement />;
  if (liste.isError) return <ErreurChargement erreur={liste.error} surReessayer={() => void liste.refetch()} />;
  if (barometre.isError) return <ErreurChargement erreur={barometre.error} surReessayer={() => void barometre.refetch()} />;

  return (
    <Barometre
      liste={liste.data}
      barometre={mois ? barometre.data ?? null : null}
      peutDecider={moi.role === 'ADMIN_ENTREPRISE'}
      fuseau={parametres.fuseauHoraire}
      decisionEnCours={enCours}
      chargement={barometre.isFetching && barometre.isPlaceholderData}
      surChoisirMois={(m) => setParams(m === liste.data.donnees[0]?.mois ? {} : { mois: m }, { replace: true })}
      surDecider={(id, decision, commentaire) => {
        setEnCours(id);
        void ecrire(
          () => appeler('deciderRecommandation', { chemin: { mois: mois!, id }, corps: { decision, commentaire } }),
          MESSAGE[decision],
        ).finally(() => setEnCours(null));
      }}
      surImprimer={() => window.print()}
      lienReclamation={(numero) => `${ROUTES_BANQUE.reclamations}?file=toutes&recherche=${encodeURIComponent(numero)}`}
      surOuvrirReclamation={(numero) => navigate(`${ROUTES_BANQUE.reclamations}?file=toutes&recherche=${encodeURIComponent(numero)}`)}
    />
  );
}
