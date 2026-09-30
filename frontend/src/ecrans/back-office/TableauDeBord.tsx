/**
 * Tableau de bord (§6.6) : lireIndicateurs, filtres identiques à la liste, export CSV
 * (exporterReclamations). Les délais sont en temps ouvré ; les taux suivent les définitions de
 * l'étape 4 (S5, S6). Étape 9 : courbe d'évolution, filtres réels (période, agence, catégorie).
 * Étape 11 : la charge du moment (hors période) et le tableau de bord de l'agent, limité aux
 * réclamations qui lui sont assignées.
 */
import type { ReactNode } from 'react';
import { CalendarDays, ChevronDown, ChevronRight, Download, Hourglass, Inbox, Siren, TriangleAlert } from 'lucide-react';
import type { S } from '../../api/types';
import { Bouton, Panneau, cx } from '../../ui/composants';
import { Evolution } from '../../ui/Evolution';
import { duree, nombre, pourcent } from '../../ui/format';

const COULEUR_STATUT: Record<string, string> = {
  OUVERTE: 'bg-ouverte',
  EN_COURS: 'bg-en-cours',
  EN_ATTENTE_CLIENT: 'bg-attente',
  RESOLUE: 'bg-resolue',
  CLOTUREE: 'bg-cloturee/45',
};

function Indicateur({ libelle, valeur, unite, detail }: { libelle: string; valeur: string; unite?: string; detail: string }) {
  return (
    <div className="flex flex-col gap-1 px-6 py-5 first:pl-6">
      <dt className="text-sm font-semibold text-encre-2">{libelle}</dt>
      <dd className="chiffres text-[30px] leading-none font-bold tracking-tight text-encre">
        {valeur}
        {unite && <span className="ml-1.5 text-[15px] font-semibold tracking-normal text-encre-3">{unite}</span>}
      </dd>
      <dd className="mt-1 text-[13px] leading-snug text-encre-3">{detail}</dd>
    </div>
  );
}

/** Un compteur de la charge du moment ; cliquable quand une file de réclamations y correspond. */
function Compteur({ libelle, valeur, icone: Icone, ton, surOuvrir }: {
  libelle: string;
  valeur: number;
  icone: typeof Inbox;
  ton: 'neutre' | 'attente' | 'alerte' | 'urgent';
  surOuvrir?: () => void;
}) {
  const tons = {
    neutre: 'text-encre-2',
    attente: 'text-attente',
    alerte: 'text-alerte',
    urgent: 'text-urgent',
  } as const;
  const actif = valeur > 0 && ton !== 'neutre' && ton !== 'attente';
  const contenu = (
    <>
      <span className={cx('flex items-center gap-2 text-sm font-semibold', actif ? tons[ton] : 'text-encre-2')}>
        <Icone aria-hidden size={16} />
        {libelle}
      </span>
      <span className={cx('chiffres text-[28px] leading-none font-bold tracking-tight', actif ? tons[ton] : 'text-encre')}>{nombre(valeur)}</span>
    </>
  );
  return surOuvrir && valeur > 0 ? (
    <button type="button" onClick={surOuvrir} className="group flex flex-col items-start gap-2 px-5 py-4 text-left hover:bg-fond">
      {contenu}
      <span className="flex items-center gap-1 text-[13px] font-semibold text-marque-texte group-hover:underline">
        Voir la file <ChevronRight aria-hidden size={14} />
      </span>
    </button>
  ) : (
    <div className="flex flex-col items-start gap-2 px-5 py-4">{contenu}</div>
  );
}

function Charge({ charge, surOuvrirRetard }: { charge: S<'Charge'>; surOuvrirRetard?: () => void }) {
  return (
    <section aria-labelledby="charge-titre" className="rounded-xl border border-trait bg-surface">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-trait px-5 py-3">
        <h2 id="charge-titre" className="text-[15px] font-bold">En ce moment</h2>
        <p className="text-[13px] text-encre-3">Réclamations non clôturées, quelle que soit la période</p>
      </div>
      <div className="grid grid-cols-2 divide-trait sm:grid-cols-4 sm:divide-x">
        <Compteur libelle="À traiter" valeur={charge.aTraiter} icone={Inbox} ton="neutre" />
        <Compteur libelle="En attente du client" valeur={charge.enAttenteClient} icone={Hourglass} ton="attente" />
        <Compteur libelle="En alerte" valeur={charge.enAlerte} icone={TriangleAlert} ton="alerte" />
        <Compteur libelle="En retard" valeur={charge.enRetard} icone={Siren} ton="urgent" surOuvrir={surOuvrirRetard} />
      </div>
    </section>
  );
}

function Vide() {
  return <p className="text-[15px] text-encre-3">Aucune réclamation sur la période.</p>;
}

function Barres({ volumes, total }: { volumes: S<'Volume'>[]; total: number }) {
  const max = Math.max(...volumes.map((v) => v.total));
  if (!total || !volumes.length) return <Vide />;
  return (
    <ul className="flex flex-col gap-3">
      {[...volumes].sort((a, b) => b.total - a.total).map((v) => (
        <li key={v.cle} className="grid grid-cols-[170px_minmax(0,1fr)_88px] items-center gap-3 text-[15px]">
          <span className="truncate text-encre-2">{v.libelle}</span>
          <span className="h-3.5 rounded-sm bg-fond">
            <span className="block h-full rounded-sm bg-marque" style={{ width: `${(v.total / max) * 100}%` }} />
          </span>
          <span className="chiffres text-right">
            <span className="font-bold">{nombre(v.total)}</span>
            <span className="ml-2 text-sm text-encre-3">{pourcent(v.total / total)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function Repartition({ volumes, total, couleurs }: { volumes: S<'Volume'>[]; total: number; couleurs: (cle: string, i: number) => string }) {
  if (!total) return <Vide />;
  return (
    <div>
      <div className="flex h-5 overflow-hidden rounded-md" role="img" aria-label={volumes.map((v) => `${v.libelle} ${v.total}`).join(', ')}>
        {volumes.map((v, i) => (
          <span key={v.cle} className={cx('h-full border-r-2 border-surface last:border-0', couleurs(v.cle, i))} style={{ width: `${(v.total / total) * 100}%` }} />
        ))}
      </div>
      <ul className="mt-3.5 flex flex-wrap gap-x-6 gap-y-2 text-sm">
        {volumes.map((v, i) => (
          <li key={v.cle} className="flex items-center gap-2">
            <span aria-hidden className={cx('h-3 w-3 rounded-sm', couleurs(v.cle, i))} />
            <span className="text-encre-2">{v.libelle}</span>
            <span className="chiffres font-bold">{nombre(v.total)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function TableauDeBord({
  indicateurs: ind,
  periode = 'Du 1er au 25 septembre 2026',
  surExporter,
  filtres,
  fuseau,
  chargement,
  exportEnCours,
  agent,
  surOuvrirRetard,
}: {
  indicateurs: S<'Indicateurs'>;
  periode?: string;
  surExporter?: () => void;
  /** Étape 9 : les vrais filtres (période, agence, catégorie) ; sinon, ceux de la maquette */
  filtres?: ReactNode;
  fuseau?: string;
  /** Nouveaux chiffres en chargement : les actuels restent affichés, atténués */
  chargement?: boolean;
  exportEnCours?: boolean;
  /** Tableau de bord d'un agent (étape 11) : ses réclamations seulement */
  agent?: boolean;
  /** Ouvre la file « En retard » */
  surOuvrirRetard?: () => void;
}) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">{agent ? 'Mon tableau de bord' : 'Tableau de bord'}</h1>
          <p className="mt-1 text-[15px] text-encre-3">
            {agent ? 'Les réclamations qui vous sont assignées. ' : ''}Délais en temps ouvré, selon les horaires de la banque.
          </p>
        </div>
        <Bouton icone={<Download aria-hidden size={17} />} onClick={surExporter} disabled={exportEnCours}>
          {exportEnCours ? 'Export…' : 'Exporter en CSV'}
        </Bouton>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {filtres ?? (
          <>
            <button type="button" className="inline-flex h-10 items-center gap-2 rounded-lg border border-trait-fort bg-surface px-3.5 text-[15px] font-semibold">
              <CalendarDays aria-hidden size={17} className="text-encre-3" />
              {periode}
              <ChevronDown aria-hidden size={16} className="text-encre-3" />
            </button>
            <button type="button" className="inline-flex h-10 items-center gap-2 rounded-lg border border-trait-fort bg-surface px-3.5 text-[15px] text-encre-2">
              Toutes les agences
              <ChevronDown aria-hidden size={16} className="text-encre-3" />
            </button>
          </>
        )}
      </div>

      <div className={cx('flex flex-col gap-5 transition-opacity', chargement && 'opacity-60')} aria-busy={chargement || undefined}>

      <Charge charge={ind.charge} surOuvrirRetard={surOuvrirRetard} />

      <dl className="grid grid-cols-5 divide-x divide-trait rounded-xl border border-trait bg-surface">
        {agent
          ? <Indicateur libelle="Réclamations assignées" valeur={nombre(ind.total)} detail="Qui vous sont assignées, déposées sur la période" />
          : <Indicateur libelle="Réclamations reçues" valeur={nombre(ind.total)} detail="Toutes les réclamations déposées sur la période" />}
        <Indicateur
          libelle="Première réponse"
          valeur={ind.delaiPremiereReponseMoyenMinutes === null ? '—' : duree(ind.delaiPremiereReponseMoyenMinutes)}
          unite="ouvrées"
          detail="En moyenne, du dépôt à la première réponse au client"
        />
        <Indicateur
          libelle="Résolution"
          valeur={ind.delaiResolutionMoyenMinutes === null ? '—' : duree(ind.delaiResolutionMoyenMinutes)}
          unite="ouvrées"
          detail="En moyenne, du dépôt à la dernière résolution, attente du client comprise"
        />
        <Indicateur libelle="SLA respecté" valeur={pourcent(ind.tauxRespectSla)} detail="Réclamations résolues avant leur échéance" />
        <Indicateur libelle="Premier contact" valeur={pourcent(ind.tauxResolutionPremierContact)} detail="Résolues sans question au client, sans escalade ni réouverture" />
      </dl>

      <Panneau titre="Évolution">
        <Evolution evolution={ind.evolution} fuseau={fuseau} />
      </Panneau>

      <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-5">
        <Panneau titre="Où en sont les réclamations">
          <Repartition volumes={ind.parStatut} total={ind.total} couleurs={(cle) => COULEUR_STATUT[cle] ?? 'bg-trait-fort'} />
        </Panneau>
        <Panneau titre="Par canal de dépôt">
          <Repartition volumes={ind.parCanal} total={ind.total} couleurs={(_c, i) => (i === 0 ? 'bg-marque' : 'bg-marque/40')} />
        </Panneau>
      </div>

      <div className="grid grid-cols-2 gap-5">
        <Panneau titre="Par catégorie">
          <Barres volumes={ind.parCategorie} total={ind.total} />
        </Panneau>
        <Panneau titre="Par agence">
          <Barres volumes={ind.parAgence} total={ind.total} />
        </Panneau>
      </div>
      </div>
    </div>
  );
}
