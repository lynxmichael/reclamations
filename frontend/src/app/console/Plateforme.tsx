/** Console de la plateforme (Super Admin) : banques, plans, alertes, journal, Super Admins. */
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { messageErreur } from '../../api/client';
import { Audit } from '../../ecrans/back-office/Audit';
import { Administrateurs } from '../../ecrans/plateforme/Administrateurs';
import { Alertes } from '../../ecrans/plateforme/Activite';
import { Banques } from '../../ecrans/plateforme/Banques';
import { Plans } from '../../ecrans/plateforme/Plans';
import { useAnnoncer } from '../commun/Annonces';
import { useEcriture } from '../commun/ecriture';
import { Chargement, ErreurChargement } from '../commun/Etats';
import { useConsole } from './contexte';
import { adressePortail, debutAudit, ecrireCriteresAudit, lireCriteresAudit } from './Parametrage';

function useTitre(titre: string) {
  useEffect(() => {
    document.title = `${titre} — Console de la plateforme`;
  }, [titre]);
}

export function PageBanques() {
  const { appeler } = useConsole();
  useTitre('Banques');
  const banques = useQuery({ queryKey: ['banques'], queryFn: () => appeler('listerBanques', { requete: { parPage: 100 } }) });
  const plans = useQuery({ queryKey: ['plans'], queryFn: () => appeler('listerPlans') });
  const { ecrire, occupe, erreurs } = useEcriture([['banques']]);
  if (banques.isPending || plans.isPending) return <Chargement />;
  if (banques.isError || plans.isError) return <ErreurChargement erreur={banques.error ?? plans.error} surReessayer={() => void Promise.all([banques.refetch(), plans.refetch()])} />;
  return (
    <Banques
      page={banques.data}
      plans={plans.data}
      adresse={adressePortail}
      actions={{
        occupe,
        erreurs,
        creer: (v) => ecrire(() => appeler('creerBanque', { corps: v }), `${v.nom} créée : ${v.administrateur.email} reçoit son invitation.`),
        modifier: (id, v) => ecrire(() => appeler('modifierBanque', { chemin: { id }, corps: v }), 'Réglages enregistrés.'),
        suspendre: (id, motif) => ecrire(() => appeler('suspendreBanque', { chemin: { id }, corps: { motif } }), 'Banque suspendue : son portail et sa console sont fermés.'),
        reactiver: (id) => ecrire(() => appeler('reactiverBanque', { chemin: { id } }), 'Banque réactivée.'),
        // Étape 20 : le numéro WhatsApp (jeton chiffré par l'API) ou SMS de la banque
        raccorder: (id, canal, v) => ecrire(
          () => appeler('raccorderCanal', { chemin: { id, canal }, corps: v }),
          canal === 'WHATSAPP' ? 'Numéro WhatsApp raccordé : ouvrez maintenant le canal à la banque.' : 'Numéro SMS raccordé : ouvrez maintenant le canal à la banque.',
        ),
      }}
    />
  );
}

export function PagePlans() {
  const { appeler } = useConsole();
  useTitre('Plans');
  const plans = useQuery({ queryKey: ['plans'], queryFn: () => appeler('listerPlans') });
  const { ecrire, occupe, erreurs } = useEcriture([['plans'], ['banques']]);
  if (plans.isPending) return <Chargement />;
  if (plans.isError) return <ErreurChargement erreur={plans.error} surReessayer={() => void plans.refetch()} />;
  return (
    <Plans
      plans={plans.data}
      actions={{
        occupe,
        erreurs,
        creer: (v) => ecrire(() => appeler('creerPlan', { corps: v }), `Plan ${v.nom} créé.`),
        modifier: (id, v) => ecrire(() => appeler('modifierPlan', { chemin: { id }, corps: v }), 'Plan enregistré.'),
      }}
    />
  );
}

export function PageAlertes() {
  const { appeler } = useConsole();
  const cache = useQueryClient();
  const annoncer = useAnnoncer();
  useTitre('Alertes');
  const alertes = useQuery({ queryKey: ['alertes'], queryFn: () => appeler('listerNotificationsPlateforme', { requete: { parPage: 50 } }), refetchInterval: 30_000 });
  const relire = () => Promise.all([cache.invalidateQueries({ queryKey: ['alertes'] }), cache.invalidateQueries({ queryKey: ['alertes-non-lues'] })]);
  const lecture = useMutation({
    mutationFn: async (ids: string[]) => {
      // Pas d'opération « tout lire » côté plateforme : une lecture par alerte
      for (const id of ids) await appeler('marquerNotificationPlateformeLue', { chemin: { id } });
    },
    onSettled: () => void relire(),
    onError: (e) => annoncer(messageErreur(e), 'erreur'),
  });
  if (alertes.isPending) return <Chargement />;
  if (alertes.isError) return <ErreurChargement erreur={alertes.error} surReessayer={() => void alertes.refetch()} />;
  return (
    <Alertes
      alertes={alertes.data}
      maintenant={new Date().toISOString()}
      occupe={lecture.isPending}
      surLire={(n) => lecture.mutate([n.id])}
      surToutLire={() => lecture.mutate(alertes.data.donnees.filter((n) => !n.lueLe).map((n) => n.id))}
    />
  );
}

export function PageJournalPlateforme() {
  const { appeler } = useConsole();
  const [params, setParams] = useSearchParams();
  const criteres = useMemo(() => lireCriteresAudit(params), [params]);
  const [verifier, setVerifier] = useState(0);
  useTitre('Journal d\'audit');
  const chaine = criteres.banqueId && criteres.banqueId !== 'plateforme' ? `banque:${criteres.banqueId}` : 'plateforme';
  const journal = useQuery({
    queryKey: ['journal-plateforme', criteres],
    queryFn: () => appeler('listerJournalPlateforme', { requete: { banqueId: criteres.banqueId, action: criteres.action, du: debutAudit(criteres.periode), page: criteres.page, parPage: 50 } }),
    placeholderData: keepPreviousData,
  });
  const verification = useQuery({ queryKey: ['verification-plateforme', chaine, verifier], queryFn: () => appeler('verifierJournalPlateforme', { requete: { chaine } }), staleTime: Infinity });
  const banques = useQuery({ queryKey: ['banques'], queryFn: () => appeler('listerBanques', { requete: { parPage: 100 } }), staleTime: 60_000 });
  if (journal.isPending) return <Chargement />;
  if (journal.isError) return <ErreurChargement erreur={journal.error} surReessayer={() => void journal.refetch()} />;
  return (
    <Audit
      journal={journal.data}
      verification={verification.data ?? null}
      verificationEnCours={verification.isFetching}
      surVerifier={() => setVerifier((n) => n + 1)}
      criteres={criteres}
      surCriteres={(c) => setParams(ecrireCriteresAudit(c))}
      chargement={journal.isFetching && journal.isPlaceholderData}
      banques={(banques.data?.donnees ?? []).map((b) => ({ id: b.id, nom: b.nom }))}
    />
  );
}

export function PageAdministrateurs() {
  const { appeler } = useConsole();
  useTitre('Super Admins');
  const liste = useQuery({ queryKey: ['administrateurs'], queryFn: () => appeler('listerSuperAdmins') });
  const { ecrire, occupe, erreurs } = useEcriture([['administrateurs']]);
  if (liste.isPending) return <Chargement />;
  if (liste.isError) return <ErreurChargement erreur={liste.error} surReessayer={() => void liste.refetch()} />;
  return (
    <Administrateurs
      administrateurs={liste.data}
      maintenant={new Date().toISOString()}
      actions={{ occupe, erreurs, inviter: (v) => ecrire(() => appeler('inviterSuperAdmin', { corps: v }), `Invitation envoyée à ${v.email}.`) }}
    />
  );
}
