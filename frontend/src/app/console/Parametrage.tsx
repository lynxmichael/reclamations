/**
 * Paramétrage de la banque, personnel et journal d'audit (back-office). Chaque page lit ses
 * données dans l'API et passe ses écritures aux écrans de l'étape 6 par leurs `actions`.
 */
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { enregistrer, messageErreur } from '../../api/client';
import type { S } from '../../api/types';
import { Audit, type CriteresAudit, type PeriodeAudit } from '../../ecrans/back-office/Audit';
import { Banque } from '../../ecrans/back-office/Banque';
import { Categories } from '../../ecrans/back-office/Categories';
import { Horaires } from '../../ecrans/back-office/Horaires';
import { Personnel } from '../../ecrans/back-office/Personnel';
import { PointsDepot } from '../../ecrans/back-office/PointsDepot';
import { ReponsesAssistant } from '../../ecrans/back-office/ReponsesAssistant';
import { useAnnoncer } from '../commun/Annonces';
import { useEcriture } from '../commun/ecriture';
import { Chargement, ErreurChargement } from '../commun/Etats';
import { nomDe, useConsole, useParametres } from './contexte';

function useTitre(titre: string) {
  useEffect(() => {
    document.title = `${titre} — Réclamations`;
  }, [titre]);
}

const minutesDe = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

/* ------------------------------------------------------------------ Catégories */

export function PageCategories() {
  const { appeler } = useConsole();
  useTitre('Catégories et délais');
  const categories = useQuery({ queryKey: ['categories'], queryFn: () => appeler('listerCategories') });
  const horaires = useQuery({ queryKey: ['horaires'], queryFn: () => appeler('lireHoraires'), staleTime: 60_000 });
  const { ecrire, occupe, erreurs } = useEcriture([['categories']]);
  if (categories.isPending) return <Chargement />;
  if (categories.isError) return <ErreurChargement erreur={categories.error} surReessayer={() => void categories.refetch()} />;
  // Durée moyenne d'une journée d'ouverture, pour traduire un délai en jours
  const plages = horaires.data?.plages ?? [];
  const jours = new Set(plages.map((p) => p.jourSemaine)).size || 5;
  const minutesParJour = plages.length ? plages.reduce((s, p) => s + minutesDe(p.fin) - minutesDe(p.debut), 0) / jours : 480;
  const ordreSuivant = Math.max(0, ...categories.data.map((c) => c.ordre)) + 1;
  return (
    <Categories
      categories={categories.data}
      enEdition={null}
      minutesParJour={minutesParJour}
      actions={{
        occupe,
        erreurs,
        creer: (v) => ecrire(() => appeler('creerCategorie', { corps: { ...v, ordre: ordreSuivant } }), `Catégorie « ${v.nom} » créée : elle est proposée aux clients.`),
        modifier: (id, v) => ecrire(() => appeler('modifierCategorie', { chemin: { id }, corps: v }), v.ordre !== undefined && Object.keys(v).length === 1 ? undefined : 'Catégorie enregistrée.'),
      }}
    />
  );
}

/* ------------------------------------------------------------------ Assistant IA (étape 18) */

export function PageAssistant() {
  const { appeler } = useConsole();
  useTitre('Assistant IA');
  const reponses = useQuery({ queryKey: ['reponses-assistant'], queryFn: () => appeler('listerReponsesAssistant') });
  const { ecrire, occupe } = useEcriture([['reponses-assistant']]);
  if (reponses.isPending) return <Chargement />;
  if (reponses.isError) return <ErreurChargement erreur={reponses.error} surReessayer={() => void reponses.refetch()} />;
  const ordreSuivant = Math.max(0, ...reponses.data.map((r) => r.ordre)) + 10;
  return (
    <ReponsesAssistant
      reponses={reponses.data}
      actions={{
        occupe,
        creer: (v) => ecrire(() => appeler('creerReponseAssistant', { corps: { ...v, ordre: Math.min(1000, ordreSuivant) } }), 'Réponse ajoutée : l\'assistant peut la donner aux clients.'),
        modifier: (id, v) => ecrire(() => appeler('modifierReponseAssistant', { chemin: { id }, corps: v }), 'Réponse enregistrée.'),
        supprimer: (id) => ecrire(() => appeler('supprimerReponseAssistant', { chemin: { id } }), 'Réponse supprimée.'),
      }}
    />
  );
}

/* ------------------------------------------------------------------ Agences et QR codes */

export function PagePoints() {
  const { appeler, moi } = useConsole();
  const annoncer = useAnnoncer();
  useTitre('Agences et QR codes');
  const agences = useQuery({ queryKey: ['agences'], queryFn: () => appeler('listerAgences') });
  const points = useQuery({ queryKey: ['points'], queryFn: () => appeler('listerPointsDepot') });
  const { ecrire, occupe, erreurs } = useEcriture([['agences'], ['points']]);
  if (agences.isPending || points.isPending) return <Chargement />;
  if (agences.isError || points.isError) return <ErreurChargement erreur={agences.error ?? points.error} surReessayer={() => void Promise.all([agences.refetch(), points.refetch()])} />;
  return (
    <PointsDepot
      agences={agences.data}
      points={points.data}
      modifiable={moi.role === 'ADMIN_ENTREPRISE'}
      actions={{
        occupe,
        erreurs,
        creerAgence: (v) => ecrire(() => appeler('creerAgence', { corps: v }), `Agence ${v.nom} créée.`),
        modifierAgence: (id, v) => ecrire(() => appeler('modifierAgence', { chemin: { id }, corps: v }), 'Agence enregistrée.'),
        creerPoint: (v) => ecrire(() => appeler('creerPointDepot', { corps: v }), v.canal === 'QR_CODE' ? 'QR code créé : téléchargez-le pour l\'imprimer.' : 'Lien web créé.'),
        modifierPoint: (id, v) => ecrire(() => appeler('modifierPointDepot', { chemin: { id }, corps: v }), 'Point de dépôt enregistré.'),
        telechargerQr: (p, format) =>
          void appeler('telechargerQrCode', { chemin: { id: p.id }, requete: { format, ...(format === 'png' ? { taille: 1024 } : {}) } })
            .then((f) => enregistrer(f, `qr-${p.code}.${format}`))
            .catch((e: unknown) => annoncer(messageErreur(e), 'erreur')),
      }}
    />
  );
}

/* ------------------------------------------------------------------ Horaires */

export function PageHoraires() {
  const { appeler } = useConsole();
  useTitre('Horaires et jours fériés');
  const horaires = useQuery({ queryKey: ['horaires'], queryFn: () => appeler('lireHoraires') });
  const feries = useQuery({ queryKey: ['jours-feries'], queryFn: () => appeler('listerJoursFeries') });
  const { ecrire, occupe, erreurs } = useEcriture([['horaires'], ['jours-feries']]);
  if (horaires.isPending || feries.isPending) return <Chargement />;
  if (horaires.isError || feries.isError) return <ErreurChargement erreur={horaires.error ?? feries.error} surReessayer={() => void Promise.all([horaires.refetch(), feries.refetch()])} />;
  return (
    <Horaires
      key={JSON.stringify(horaires.data.plages)}
      horaires={horaires.data}
      feries={feries.data}
      aujourdhui={new Date().toISOString()}
      actions={{
        occupe,
        erreurs,
        enregistrer: (plages) => ecrire(() => appeler('remplacerHoraires', { corps: { plages } }), 'Semaine enregistrée : les échéances des nouvelles réclamations en tiennent compte.'),
        ajouterFerie: (v) => ecrire(() => appeler('ajouterJourFerie', { corps: v }), `${v.libelle} ajouté aux jours fériés.`),
        supprimerFerie: (f) => void ecrire(() => appeler('supprimerJourFerie', { chemin: { id: f.id } }), `${f.libelle} retiré des jours fériés.`),
      }}
    />
  );
}

/* ------------------------------------------------------------------ Banque et apparence */

/** <slug>.<domaine> d'après l'adresse de la console (console.<domaine>). */
export function adressePortail(slug: string): string {
  const hote = window.location.hostname;
  return hote.startsWith('console.') ? `${slug}.${hote.slice('console.'.length)}` : `${slug}.${hote}`;
}

export function PageBanque() {
  const { appeler } = useConsole();
  const parametres = useParametres();
  const cache = useQueryClient();
  useTitre('Banque et apparence');
  const { ecrire, occupe, erreurs } = useEcriture([['parametres']]);
  const banque: S<'BanquePublique'> = { nom: parametres.nom, slug: parametres.slug, logoUrl: parametres.logoUrl, couleurPrimaire: parametres.couleurPrimaire, couleurSecondaire: parametres.couleurSecondaire, whatsapp: parametres.whatsapp };
  return (
    <Banque
      key={`${parametres.couleurPrimaire}-${parametres.couleurSecondaire}-${parametres.emailContact}`}
      parametres={parametres}
      banque={banque}
      adressePortail={adressePortail(parametres.slug)}
      actions={{
        occupe,
        erreurs,
        enregistrer: (v) =>
          ecrire(async () => {
            const p = await appeler('modifierApparence', { corps: v });
            cache.setQueryData(['parametres'], p);
          }, 'Apparence enregistrée : le portail et le back-office prennent ces couleurs.'),
        televerserLogo: (logo) =>
          ecrire(async () => {
            const p = await appeler('televerserLogo', { corps: { logo } });
            cache.setQueryData(['parametres'], p);
          }, 'Logo enregistré.'),
      }}
    />
  );
}

/* ------------------------------------------------------------------ Personnel */

export function PagePersonnel() {
  const { appeler, moi } = useConsole();
  const parametres = useParametres();
  const annoncer = useAnnoncer();
  useTitre('Personnel');
  const personnel = useQuery({ queryKey: ['personnel'], queryFn: () => appeler('listerUtilisateurs', { requete: { parPage: 100 } }) });
  const { ecrire, occupe, erreurs } = useEcriture([['personnel'], ['agents'], ['parametres']]);
  const renvoi = useMutation({
    mutationFn: (u: S<'Utilisateur'>) => appeler('renvoyerInvitation', { chemin: { id: u.id } }),
    onSuccess: (_, u) => annoncer(`Invitation renvoyée à ${u.email}. L'ancien lien ne fonctionne plus.`),
    onError: (e) => annoncer(messageErreur(e), 'erreur'),
  });
  if (personnel.isPending) return <Chargement />;
  if (personnel.isError) return <ErreurChargement erreur={personnel.error} surReessayer={() => void personnel.refetch()} />;
  const superviseurs = personnel.data.donnees.filter((u) => u.role === 'SUPERVISEUR' && u.statut === 'ACTIF').map((u) => ({ id: u.id, nom: nomDe(u) }));
  const ordre: Record<string, number> = { ADMIN_ENTREPRISE: 0, SUPERVISEUR: 1, AGENT: 2 };
  const page = { ...personnel.data, donnees: [...personnel.data.donnees].sort((a, b) => Number(a.statut === 'DESACTIVE') - Number(b.statut === 'DESACTIVE') || (ordre[a.role] ?? 3) - (ordre[b.role] ?? 3) || nomDe(a).localeCompare(nomDe(b), 'fr')) };
  return (
    <Personnel
      page={page}
      plan={parametres.plan}
      consommation={parametres.consommation}
      modifiable={moi.role === 'ADMIN_ENTREPRISE'}
      maintenant={new Date().toISOString()}
      superviseurs={superviseurs}
      totpObligatoire={parametres.doubleAuthentificationObligatoire}
      moiTotpActif={moi.totpActif}
      actions={{
        moiId: moi.id,
        occupe: occupe || renvoi.isPending,
        erreurs,
        inviter: (v) => ecrire(() => appeler('inviterUtilisateur', { corps: v }), `Invitation envoyée à ${v.email}.`),
        modifier: (id, v) => ecrire(() => appeler('modifierUtilisateur', { chemin: { id }, corps: v }), 'Compte enregistré.'),
        desactiver: (u) => ecrire(() => appeler('desactiverUtilisateur', { chemin: { id: u.id } }), `Compte de ${nomDe(u)} désactivé : ses sessions sont fermées.`),
        reactiver: (u) => ecrire(() => appeler('reactiverUtilisateur', { chemin: { id: u.id } }), `Compte de ${nomDe(u)} réactivé.`),
        renvoyerInvitation: (u) => renvoi.mutate(u),
        reinitialiserTotp: (u) => ecrire(
          () => appeler('reinitialiserTotp', { chemin: { id: u.id } }),
          parametres.doubleAuthentificationObligatoire
            ? `Double authentification de ${nomDe(u)} réinitialisée : un nouveau QR code lui sera présenté à la connexion.`
            : `Double authentification de ${nomDe(u)} réinitialisée : ${u.prenom} pourra la réactiver depuis « Mon compte ».`,
        ),
        // Étape 19 : les paramètres relus (useEcriture) mettent à jour la règle affichée
        changerDoubleAuthentification: (obligatoire) => ecrire(
          () => appeler('modifierSecuriteBanque', { corps: { doubleAuthentificationObligatoire: obligatoire } }),
          obligatoire ? 'Double authentification obligatoire : qui ne l\'a pas activée le fera à sa prochaine connexion.' : 'Double authentification facultative : chacun choisit depuis « Mon compte ».',
        ),
      }}
    />
  );
}

/* ------------------------------------------------------------------ Journal d'audit */

export function debutAudit(p: PeriodeAudit | undefined): string | undefined {
  if (!p) return undefined;
  return new Date(Date.now() - (p === '24h' ? 1 : p === '7j' ? 7 : 30) * 86_400_000).toISOString();
}

export function lireCriteresAudit(params: URLSearchParams): CriteresAudit {
  const periode = params.get('periode');
  return {
    action: params.get('action') ?? undefined,
    acteurId: params.get('acteurId') ?? undefined,
    banqueId: params.get('banqueId') ?? undefined,
    periode: periode === '24h' || periode === '7j' || periode === '30j' ? periode : undefined,
    page: Math.max(1, Number(params.get('page')) || 1),
  };
}

export function ecrireCriteresAudit(c: CriteresAudit): URLSearchParams {
  const p = new URLSearchParams();
  for (const [cle, v] of Object.entries(c)) if (v !== undefined && !(cle === 'page' && v === 1)) p.set(cle, String(v));
  return p;
}

export function PageAudit() {
  const { appeler } = useConsole();
  const [params, setParams] = useSearchParams();
  const criteres = useMemo(() => lireCriteresAudit(params), [params]);
  const [verifier, setVerifier] = useState(0);
  useTitre('Journal d\'audit');
  const journal = useQuery({
    queryKey: ['journal', criteres],
    queryFn: () =>
      appeler('listerJournalBanque', { requete: { action: criteres.action, acteurId: criteres.acteurId, du: debutAudit(criteres.periode), page: criteres.page, parPage: 50 } }),
    placeholderData: keepPreviousData,
  });
  const verification = useQuery({ queryKey: ['verification', verifier], queryFn: () => appeler('verifierJournalBanque'), staleTime: Infinity });
  const personnel = useQuery({ queryKey: ['personnel'], queryFn: () => appeler('listerUtilisateurs', { requete: { parPage: 100 } }), staleTime: 60_000 });
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
      personnes={(personnel.data?.donnees ?? []).map((u) => ({ id: u.id, nom: nomDe(u) }))}
    />
  );
}
