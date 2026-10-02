/**
 * Boîte de réception (étape 17) : /conversations et /conversations/{id}?filtre=…
 * La liste se relit toutes les 10 secondes, la conversation ouverte toutes les 5 secondes, tant que
 * l'onglet est visible (pas de WebSocket : le proxy et la CSP restent ceux de la phase 1). La
 * conversation affichée est marquée lue ; l'API ne le retient que pour l'agent assigné (ou un
 * superviseur si la réclamation n'est pas assignée).
 */
import { useEffect, useRef } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ErreurApi } from '../../api/client';
import { Conversations, type FiltreConversations } from '../../ecrans/back-office/Conversations';
import { useEcriture } from '../commun/ecriture';
import { Chargement, ErreurChargement } from '../commun/Etats';
import { ROUTES_BANQUE, useConsole } from './contexte';

export const RAFRAICHISSEMENT_LISTE_MS = 10_000;
export const RAFRAICHISSEMENT_FIL_MS = 5_000;
const FILTRES: FiltreConversations[] = ['a-repondre', 'non-lues', 'toutes'];

export function PageConversations() {
  const { appeler } = useConsole();
  const navigate = useNavigate();
  const cache = useQueryClient();
  const { id } = useParams();
  const [params] = useSearchParams();
  const brut = params.get('filtre') as FiltreConversations | null;
  const filtre: FiltreConversations = brut && FILTRES.includes(brut) ? brut : 'a-repondre';

  useEffect(() => {
    document.title = 'Conversations — Réclamations';
  }, []);

  const page = useQuery({
    queryKey: ['conversations', filtre],
    queryFn: () => appeler('listerConversations', { requete: { filtre, parPage: 50 } }),
    refetchInterval: RAFRAICHISSEMENT_LISTE_MS,
  });
  const selection = useQuery({
    queryKey: ['conversation', id],
    queryFn: () => appeler('lireConversation', { chemin: { id: id! } }),
    enabled: !!id,
    refetchInterval: RAFRAICHISSEMENT_FIL_MS,
  });

  // Marquer lue la conversation affichée, une fois par nouvel état (pas à chaque relecture)
  const dejaMarquee = useRef('');
  const lue = useMutation({
    mutationFn: (c: string) => appeler('marquerConversationLue', { chemin: { id: c } }),
    onSuccess: () => {
      void cache.invalidateQueries({ queryKey: ['conversations'] });
      void cache.invalidateQueries({ queryKey: ['conversations-a-repondre'] });
    },
  });
  const c = selection.data;
  useEffect(() => {
    if (!c?.nonLue || document.visibilityState !== 'visible') return;
    const cle = `${c.id}:${c.messages.length}`;
    if (dejaMarquee.current === cle) return;
    dejaMarquee.current = cle;
    lue.mutate(c.id);
  }, [c, lue]);

  const { ecrire, occupe } = useEcriture([['conversations'], ['conversation'], ['conversations-a-repondre'], ['reclamations'], ['reclamation'], ['compteurs']]);

  // Conversation disparue (réclamation réassignée à un autre agent) : retour à la liste
  const disparue = !!id && selection.error instanceof ErreurApi && selection.error.statut === 404;
  useEffect(() => {
    if (disparue) void navigate(`${ROUTES_BANQUE.conversations}${filtre === 'a-repondre' ? '' : `?filtre=${filtre}`}`, { replace: true });
  }, [disparue, filtre, navigate]);

  if (page.isPending) return <Chargement />;
  if (page.isError) return <ErreurChargement erreur={page.error} surReessayer={() => void page.refetch()} />;

  const vers = (conversation: string | null, f = filtre) =>
    navigate(`${ROUTES_BANQUE.conversations}${conversation ? `/${conversation}` : ''}${f === 'a-repondre' ? '' : `?filtre=${f}`}`);

  return (
    <Conversations
      page={page.data}
      filtre={filtre}
      selection={c ?? null}
      maintenant={new Date().toISOString()}
      actions={{
        occupe,
        filtrer: (f) => void vers(id ?? null, f),
        ouvrir: (conversation) => void vers(conversation),
        ouvrirFiche: (reclamation) => void navigate(`${ROUTES_BANQUE.reclamations}/${reclamation}`),
        repondre: (contenu, attendreReponse, fichiers) =>
          c
            ? ecrire(
              () => appeler('repondreAuClient', { chemin: { id: c.reclamation.id }, corps: { contenu, attendreReponse, fichiers } }),
              attendreReponse ? 'Question envoyée : le chrono SLA est en pause jusqu\'à la réponse du client.' : 'Réponse envoyée dans le chat du client.',
            )
            : false,
      }}
    />
  );
}
