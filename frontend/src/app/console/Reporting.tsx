/**
 * Reporting (étape 9) : tableau de bord de la banque ou, pour un agent, le sien (étape 11)
 * (lireIndicateurs, export CSV) et activité de la plateforme (lireIndicateursPlateforme,
 * lireFacturationSms). Les filtres sont dans l'adresse.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { enregistrer, messageErreur, type FichierRecu } from '../../api/client';
import { Agences, lignesCsvAgences } from '../../ecrans/back-office/Agences';
import { TableauDeBord } from '../../ecrans/back-office/TableauDeBord';
import { Activite } from '../../ecrans/plateforme/Activite';
import { csv } from '../../ui/csv';
import { ChoixFiltre } from '../../ui/Filtre';
import { PERIODES, bornes, derniersMois, nomMois, type CodePeriode } from '../../ui/periodes';
import { useAnnoncer } from '../commun/Annonces';
import { Chargement, ErreurChargement } from '../commun/Etats';
import { INTERVALLE_MS } from './Cadre';
import { ROUTES_BANQUE, useConsole, useParametres } from './contexte';

function useTitre(titre: string) {
  useEffect(() => {
    document.title = `${titre} — Réclamations`;
  }, [titre]);
}

/** Téléchargement d'un export ; un refus de l'API (export trop volumineux…) devient un message. */
export function useExport() {
  const annoncer = useAnnoncer();
  const [enCours, setEnCours] = useState(false);
  const exporter = async (faire: () => Promise<FichierRecu>) => {
    setEnCours(true);
    try {
      enregistrer(await faire(), 'reclamations.csv');
      annoncer('Export CSV téléchargé.');
    } catch (e) {
      annoncer(messageErreur(e), 'erreur');
    } finally {
      setEnCours(false);
    }
  };
  return { exporter, enCours };
}

// ---- Tableau de bord de la banque -------------------------------------------------------

const CANAUX = { QR_CODE: 'QR code en agence', LIEN_WEB: 'Lien web' } as const;

export function PageTableau() {
  const { appeler, moi } = useConsole();
  const navigate = useNavigate();
  const parametres = useParametres();
  const [params, setParams] = useSearchParams();
  useTitre('Tableau de bord');
  const fuseau = parametres.fuseauHoraire;
  const val = <T extends string>(cle: string, permis?: readonly T[]) => {
    const v = params.get(cle) ?? undefined;
    return v && (!permis || permis.includes(v as T)) ? (v as T) : undefined;
  };
  const periode = val('periode', Object.keys(PERIODES) as CodePeriode[]) ?? 'mois';
  const filtres = { agenceId: val('agenceId'), categorieId: val('categorieId'), canal: val('canal', ['QR_CODE', 'LIEN_WEB'] as const) };
  // Bornes recalculées à chaque rendu : « maintenant » avance, la clé du cache reste stable
  const cle = ['indicateurs', periode, filtres];
  const requete = () => ({ ...bornes(periode, fuseau), ...filtres });

  const indicateurs = useQuery({
    queryKey: cle,
    queryFn: () => appeler('lireIndicateurs', { requete: requete() }),
    placeholderData: keepPreviousData,
    refetchInterval: INTERVALLE_MS,
  });
  const categories = useQuery({ queryKey: ['categories'], queryFn: () => appeler('listerCategories'), staleTime: 60_000 });
  const agences = useQuery({ queryKey: ['agences'], queryFn: () => appeler('listerAgences'), staleTime: 60_000 });
  const { exporter, enCours } = useExport();

  const changer = (cle: string, v: string | undefined) => {
    const p = new URLSearchParams(params);
    if (v && !(cle === 'periode' && v === 'mois')) p.set(cle, v);
    else p.delete(cle);
    setParams(p, { replace: true });
  };

  if (indicateurs.isPending) return <Chargement />;
  if (indicateurs.isError) return <ErreurChargement erreur={indicateurs.error} surReessayer={() => void indicateurs.refetch()} />;
  return (
    <TableauDeBord
      indicateurs={indicateurs.data}
      // Étape 11 : l'agent a le sien, limité par l'API aux réclamations qui lui sont assignées
      agent={moi.role === 'AGENT'}
      surOuvrirRetard={() => navigate(`${ROUTES_BANQUE.reclamations}?file=en-retard`)}
      surOuvrirReclamation={(id) => navigate(`${ROUTES_BANQUE.reclamations}/${id}`)}
      fuseau={fuseau}
      chargement={indicateurs.isFetching && indicateurs.isPlaceholderData}
      exportEnCours={enCours}
      surExporter={() => void exporter(() => appeler('exporterReclamations', { requete: { file: 'toutes', ...requete() } }))}
      filtres={(
        <>
          <ChoixFiltre
            libelle="Période"
            obligatoire
            valeur={periode}
            options={(Object.entries(PERIODES) as [CodePeriode, string][]).map(([valeur, libelle]) => ({ valeur, libelle }))}
            surChoix={(v) => changer('periode', v)}
          />
          <ChoixFiltre
            libelle="Agence"
            valeur={filtres.agenceId}
            options={(agences.data ?? []).map((a) => ({ valeur: a.id, libelle: a.nom }))}
            surChoix={(v) => changer('agenceId', v)}
          />
          <ChoixFiltre
            libelle="Catégorie"
            valeur={filtres.categorieId}
            options={(categories.data ?? []).map((c) => ({ valeur: c.id, libelle: c.nom }))}
            surChoix={(v) => changer('categorieId', v)}
          />
          <ChoixFiltre
            libelle="Canal"
            valeur={filtres.canal}
            options={(Object.entries(CANAUX) as ['QR_CODE' | 'LIEN_WEB', string][]).map(([valeur, libelle]) => ({ valeur, libelle }))}
            surChoix={(v) => changer('canal', v)}
          />
        </>
      )}
    />
  );
}

// ---- Activité des agences (étape 19) ---------------------------------------------------------

export function PageAgences() {
  const { appeler } = useConsole();
  const navigate = useNavigate();
  const parametres = useParametres();
  const annoncer = useAnnoncer();
  const [params, setParams] = useSearchParams();
  useTitre('Activité des agences');
  const fuseau = parametres.fuseauHoraire;
  const v = params.get('periode');
  const periode: CodePeriode = v && v in PERIODES ? (v as CodePeriode) : 'mois';
  const categorieId = params.get('categorieId') ?? undefined;
  const canalLu = params.get('canal');
  const canal = canalLu === 'QR_CODE' || canalLu === 'LIEN_WEB' ? canalLu : undefined;
  const indicateurs = useQuery({
    queryKey: ['indicateurs-agences', periode, categorieId, canal],
    queryFn: () => appeler('lireIndicateursAgences', { requete: { ...bornes(periode, fuseau), categorieId, canal } }),
    placeholderData: keepPreviousData,
    refetchInterval: INTERVALLE_MS,
  });
  const categories = useQuery({ queryKey: ['categories'], queryFn: () => appeler('listerCategories'), staleTime: 60_000 });
  const changer = (cle: string, valeur: string | undefined) => {
    const p = new URLSearchParams(params);
    if (valeur && !(cle === 'periode' && valeur === 'mois')) p.set(cle, valeur);
    else p.delete(cle);
    setParams(p, { replace: true });
  };
  // Le tableau de bord et la liste filtrés sur l'agence, pour la même période
  const versTableau = (agenceId: string) => `${ROUTES_BANQUE.tableau}?${new URLSearchParams({ agenceId, ...(periode !== 'mois' ? { periode } : {}) })}`;
  const versReclamations = (agenceId: string) => `${ROUTES_BANQUE.reclamations}?${new URLSearchParams({ file: 'toutes', agenceId })}`;

  if (indicateurs.isPending) return <Chargement />;
  if (indicateurs.isError) return <ErreurChargement erreur={indicateurs.error} surReessayer={() => void indicateurs.refetch()} />;
  return (
    <Agences
      indicateurs={indicateurs.data}
      chargement={indicateurs.isFetching && indicateurs.isPlaceholderData}
      lienTableau={versTableau}
      lienReclamations={versReclamations}
      surOuvrirTableau={(id) => navigate(versTableau(id))}
      surOuvrirReclamations={(id) => navigate(versReclamations(id))}
      surExporter={() => {
        enregistrer({ nom: `activite-agences-${periode}.csv`, type: 'text/csv', contenu: csv(lignesCsvAgences(indicateurs.data)) });
        annoncer('Activité des agences téléchargée.');
      }}
      filtres={(
        <>
          <ChoixFiltre
            libelle="Période"
            obligatoire
            valeur={periode}
            options={(Object.entries(PERIODES) as [CodePeriode, string][]).map(([valeur, libelle]) => ({ valeur, libelle }))}
            surChoix={(x) => changer('periode', x)}
          />
          <ChoixFiltre
            libelle="Catégorie"
            valeur={categorieId}
            options={(categories.data ?? []).map((c) => ({ valeur: c.id, libelle: c.nom }))}
            surChoix={(x) => changer('categorieId', x)}
          />
          <ChoixFiltre
            libelle="Canal"
            valeur={canal}
            options={(Object.entries(CANAUX) as ['QR_CODE' | 'LIEN_WEB', string][]).map(([valeur, libelle]) => ({ valeur, libelle }))}
            surChoix={(x) => changer('canal', x)}
          />
        </>
      )}
    />
  );
}

// ---- Activité de la plateforme ---------------------------------------------------------------

export function PageActivite() {
  const { appeler } = useConsole();
  const [params, setParams] = useSearchParams();
  const annoncer = useAnnoncer();
  useTitre('Activité et SMS');
  const mois = useMemo(() => derniersMois(), []);
  const choisi = params.get('mois') && mois.includes(params.get('mois')!) ? params.get('mois')! : mois[0]!;
  const debut = `${choisi}-01T00:00:00Z`;
  const suivant = new Date(Date.UTC(Number(choisi.slice(0, 4)), Number(choisi.slice(5, 7)), 1)).toISOString();

  const indicateurs = useQuery({
    queryKey: ['indicateurs-plateforme', choisi],
    queryFn: () => appeler('lireIndicateursPlateforme', { requete: { du: debut, au: choisi === mois[0] ? undefined : suivant } }),
    placeholderData: keepPreviousData,
    refetchInterval: INTERVALLE_MS,
  });
  const sms = useQuery({
    queryKey: ['facturation-sms', choisi],
    queryFn: () => appeler('lireFacturationSms', { requete: { mois: choisi } }),
    placeholderData: keepPreviousData,
  });
  // Assistant IA (étape 18) : facultatif, la page reste utile s'il échoue
  const ia = useQuery({
    queryKey: ['consommation-ia', choisi],
    queryFn: () => appeler('lireConsommationIa', { requete: { mois: choisi } }),
    placeholderData: keepPreviousData,
  });

  // WhatsApp et SMS reçus (étape 20) : facultatif, comme l'assistant
  const canaux = useQuery({
    queryKey: ['facturation-canaux', choisi],
    queryFn: () => appeler('lireFacturationCanaux', { requete: { mois: choisi } }),
    placeholderData: keepPreviousData,
  });

  if (indicateurs.isPending || sms.isPending) return <Chargement />;
  if (indicateurs.isError || sms.isError) {
    return <ErreurChargement erreur={indicateurs.error ?? sms.error} surReessayer={() => void Promise.all([indicateurs.refetch(), sms.refetch()])} />;
  }
  return (
    <Activite
      indicateurs={indicateurs.data}
      sms={sms.data}
      ia={ia.data}
      canaux={canaux.data}
      surExporterCanaux={canaux.data ? () => {
        const lignes = canaux.data.banques.map((b) => [b.banque.nom, b.whatsappEnvoyes, b.whatsappFactures, b.whatsappEchecs, b.whatsappRecus, b.smsRecus] as const);
        enregistrer({
          nom: `whatsapp-sms-${choisi}.csv`,
          type: 'text/csv',
          contenu: csv([['Banque', 'WhatsApp envoyés', 'WhatsApp facturés par Meta', 'WhatsApp en échec', 'WhatsApp reçus', 'SMS reçus'], ...lignes]),
        });
        annoncer('Facturation WhatsApp et SMS téléchargée.');
      } : undefined}
      surExporterIa={ia.data ? () => {
        const lignes = ia.data.banques.map((b) => [b.banque.nom, b.tours, b.suggestions, b.barometres, b.parIa, b.regles, b.jetonsEntree, b.jetonsSortie, b.coutUsd] as const);
        enregistrer({
          nom: `assistant-ia-${choisi}.csv`,
          type: 'text/csv',
          contenu: csv([['Banque', 'Tours du portail', 'Brouillons', 'Baromètres', 'Par l\'IA', 'Par les règles', 'Jetons en entrée', 'Jetons en sortie', 'Coût (USD)'], ...lignes]),
        });
        annoncer('Consommation de l\'assistant IA téléchargée.');
      } : undefined}
      chargement={(indicateurs.isFetching && indicateurs.isPlaceholderData) || (sms.isFetching && sms.isPlaceholderData)}
      choixMois={(
        <ChoixFiltre
          libelle="Mois"
          obligatoire
          valeur={choisi}
          options={mois.map((m) => ({ valeur: m, libelle: nomMois(m) }))}
          surChoix={(v) => {
            const p = new URLSearchParams(params);
            if (v && v !== mois[0]) p.set('mois', v);
            else p.delete('mois');
            setParams(p, { replace: true });
          }}
        />
      )}
      surExporterSms={() => {
        const lignes = sms.data.banques.map((b) => [b.banque.nom, b.sms, b.segments, b.remis, b.echecs] as const);
        const total = sms.data.banques.reduce((t, b) => [t[0] + b.sms, t[1] + b.segments, t[2] + b.remis, t[3] + b.echecs], [0, 0, 0, 0]);
        enregistrer({
          nom: `facturation-sms-${choisi}.csv`,
          type: 'text/csv',
          contenu: csv([['Banque', 'SMS envoyés', 'Segments facturés', 'Remis', 'Non remis'], ...lignes, ['Total', ...total]]),
        });
        annoncer('Facturation SMS téléchargée.');
      }}
    />
  );
}
