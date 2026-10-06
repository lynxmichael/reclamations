/**
 * Activité des agences (étape 19) : lireIndicateursAgences. Pour l'Admin Entreprise et les
 * superviseurs, ce que fait chaque agence sur la période : réclamations reçues, en cours et en
 * retard, délais, respect du SLA, premier contact, satisfaction ; en dépliant une agence, ses
 * catégories principales, les agents qui traitent ses réclamations, ses points de dépôt et son
 * groupe d'agents, avec des liens vers son tableau de bord et ses réclamations. Mêmes définitions
 * que le tableau de bord ; délais en temps ouvré. La comparaison s'exporte en CSV.
 */
import { Fragment, useState, type ReactNode } from 'react';
import { CalendarDays, ChartColumn, ChevronDown, ChevronRight, Download, Globe, Inbox, QrCode, Siren, Store, Trophy, Users } from 'lucide-react';
import type { S } from '../../api/types';
import { Bouton, cx } from '../../ui/composants';
import type { Cellule } from '../../ui/csv';
import { duree, nombre, pourcent } from '../../ui/format';
import { signe } from './TableauDeBord';

type Ligne = S<'ActiviteAgence'>;

/** Clé d'une ligne : l'agence, ou « aucune » pour les dépôts par lien web sans agence. */
export const cleAgence = (l: Ligne) => l.agence?.id ?? 'aucune';
const nomAgence = (l: Ligne) => l.agence?.nom ?? 'Sans agence (lien web, WhatsApp ou SMS)';

/** Lignes du fichier CSV de la comparaison (en-tête compris), sans aucune donnée personnelle. */
export function lignesCsvAgences(ind: S<'IndicateursAgences'>): Cellule[][] {
  return [
    ['Agence', 'Code', 'Ville', 'Active', 'Groupe d\'agents', 'Réclamations reçues', 'Urgentes', 'Résolues', 'À traiter', 'En attente du client', 'En alerte', 'En retard',
      'Première réponse (min ouvrées)', 'Résolution (min ouvrées)', 'SLA respecté (%)', 'Premier contact (%)', 'Enquêtes', 'Réponses', 'Clients satisfaits (%)', 'NPS'],
    ...ind.agences.map((l) => [
      nomAgence(l), l.agence?.code ?? null, l.agence?.ville ?? null, l.agence ? (l.agence.active ? 'Oui' : 'Non') : null, l.groupe?.nom ?? null,
      l.total, l.urgentes, l.resolues, l.charge.aTraiter, l.charge.enAttenteClient, l.charge.enAlerte, l.charge.enRetard,
      l.delaiPremiereReponseMoyenMinutes, l.delaiResolutionMoyenMinutes,
      l.tauxRespectSla === null ? null : Math.round(l.tauxRespectSla * 100), l.tauxResolutionPremierContact === null ? null : Math.round(l.tauxResolutionPremierContact * 100),
      l.satisfaction?.enquetes ?? null, l.satisfaction?.reponses ?? null,
      l.satisfaction?.tauxSatisfaits == null ? null : Math.round(l.satisfaction.tauxSatisfaits * 100), l.satisfaction?.nps ?? null,
    ]),
  ];
}

/** Ton d'un taux de respect du SLA : vert à 90 % et plus, orangé dès 75 %, rouge en dessous. */
function tonSla(t: number | null) {
  if (t === null) return 'text-encre-3';
  return t >= 0.9 ? 'text-resolue' : t >= 0.75 ? 'text-alerte' : 'text-urgent';
}

function Repere({ icone: Icone, libelle, valeur, detail }: { icone: typeof Inbox; libelle: string; valeur: ReactNode; detail: ReactNode }) {
  return (
    <div className="flex gap-3 px-5 py-4">
      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-marque-doux text-marque-texte">
        <Icone aria-hidden size={18} />
      </span>
      <div className="min-w-0">
        <dt className="text-sm font-semibold text-encre-2">{libelle}</dt>
        <dd className="mt-0.5 truncate text-[17px] font-bold text-encre">{valeur}</dd>
        <dd className="chiffres text-[13px] text-encre-3">{detail}</dd>
      </div>
    </div>
  );
}

/** Quatre repères sur la période : agences sollicitées, la plus sollicitée, le meilleur SLA, les retards. */
function Reperes({ lignes }: { lignes: Ligne[] }) {
  const agences = lignes.filter((l) => l.agence);
  const sollicitees = agences.filter((l) => l.total > 0);
  const total = lignes.reduce((n, l) => n + l.total, 0);
  const premiere = [...agences].sort((a, b) => b.total - a.total)[0];
  // Meilleur SLA parmi les agences d'au moins 5 réclamations résolues (un taux sur 1 ou 2 ne dit rien)
  const sla = [...agences].filter((l) => l.tauxRespectSla !== null && l.resolues >= 5).sort((a, b) => b.tauxRespectSla! - a.tauxRespectSla! || b.resolues - a.resolues)[0];
  const enRetard = lignes.filter((l) => l.charge.enRetard > 0);
  const retards = enRetard.reduce((n, l) => n + l.charge.enRetard, 0);
  return (
    <dl className="grid grid-cols-4 divide-x divide-trait rounded-xl border border-trait bg-surface">
      <Repere icone={Store} libelle="Agences sollicitées" valeur={`${sollicitees.length} sur ${agences.length}`} detail={`${nombre(total)} réclamation${total > 1 ? 's' : ''} sur la période`} />
      <Repere
        icone={ChartColumn}
        libelle="La plus sollicitée"
        valeur={premiere && premiere.total > 0 ? nomAgence(premiere) : '—'}
        detail={premiere && premiere.total > 0 ? `${nombre(premiere.total)} réclamations, ${pourcent(premiere.total / Math.max(1, total))} du total` : 'Aucune réclamation'}
      />
      <Repere icone={Trophy} libelle="Meilleur respect du SLA" valeur={sla ? nomAgence(sla) : '—'} detail={sla ? `${pourcent(sla.tauxRespectSla)} sur ${nombre(sla.resolues)} résolues` : 'Pas assez de réclamations résolues'} />
      <Repere
        icone={Siren}
        libelle="En retard en ce moment"
        valeur={<span className={retards > 0 ? 'text-urgent' : undefined}>{nombre(retards)}</span>}
        detail={retards > 0 ? enRetard.map(nomAgence).join(', ') : 'Aucune agence en retard'}
      />
    </dl>
  );
}

function Detail({ l, lienTableau, lienReclamations, surOuvrirTableau, surOuvrirReclamations }: {
  l: Ligne;
  lienTableau?: string;
  lienReclamations?: string;
  surOuvrirTableau?: () => void;
  surOuvrirReclamations?: () => void;
}) {
  const lien = (href: string | undefined, faire: (() => void) | undefined, texte: string, icone: ReactNode) =>
    href || faire ? (
      <a
        href={href ?? '#'}
        onClick={(e) => {
          if (faire && !e.metaKey && !e.ctrlKey && !e.shiftKey && e.button === 0) {
            e.preventDefault();
            faire();
          }
        }}
        className="inline-flex items-center gap-1.5 text-[15px] font-semibold text-marque-texte hover:underline"
      >
        {icone}
        {texte}
      </a>
    ) : null;
  const max = Math.max(1, ...l.pointsDepot.map((p) => p.total));
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.3fr)] gap-6 bg-fond/60 px-5 py-4 text-[15px]">
      <div>
        <h3 className="text-sm font-semibold text-encre-3">Catégories principales</h3>
        {l.parCategorie.length ? (
          <ul className="mt-2 flex flex-col gap-1.5">
            {l.parCategorie.map((c) => (
              <li key={c.cle} className="flex justify-between gap-3">
                <span className="truncate">{c.libelle}</span>
                <span className="chiffres font-semibold">{nombre(c.total)}</span>
              </li>
            ))}
          </ul>
        ) : <p className="mt-2 text-encre-3">Aucune réclamation sur la période.</p>}
        <h3 className="mt-4 text-sm font-semibold text-encre-3">Groupe d'agents</h3>
        <p className="mt-1">{l.groupe?.nom ?? <span className="text-encre-3">Selon la catégorie</span>}</p>
      </div>
      <div>
        <h3 className="text-sm font-semibold text-encre-3">Agents qui traitent ses réclamations</h3>
        {l.agents.length ? (
          <ul className="mt-2 flex flex-col gap-1.5">
            {l.agents.map((a) => (
              <li key={a.cle} className="flex justify-between gap-3">
                <span className="truncate">{a.libelle}</span>
                <span className="chiffres font-semibold">{nombre(a.total)}</span>
              </li>
            ))}
          </ul>
        ) : <p className="mt-2 text-encre-3">Aucune réclamation assignée.</p>}
      </div>
      <div>
        <h3 className="text-sm font-semibold text-encre-3">Points de dépôt</h3>
        {l.pointsDepot.length ? (
          <ul className="mt-2 flex flex-col gap-2">
            {l.pointsDepot.map((p) => (
              <li key={p.id} className="grid grid-cols-[minmax(0,1fr)_90px_36px] items-center gap-3">
                <span className="flex min-w-0 items-center gap-2">
                  {p.canal === 'QR_CODE' ? <QrCode aria-hidden size={15} className="shrink-0 text-encre-3" /> : <Globe aria-hidden size={15} className="shrink-0 text-encre-3" />}
                  <span className="truncate">{p.libelle}</span>
                  {!p.actif && <span className="rounded bg-cloturee-doux px-1.5 text-xs font-semibold text-cloturee">Inactif</span>}
                </span>
                <span className="h-2.5 rounded-sm bg-surface"><span className="block h-full rounded-sm bg-marque/70" style={{ width: `${(p.total / max) * 100}%` }} /></span>
                <span className="chiffres text-right font-semibold">{nombre(p.total)}</span>
              </li>
            ))}
          </ul>
        ) : <p className="mt-2 text-encre-3">Aucun point de dépôt.</p>}
        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2">
          {lien(lienTableau, surOuvrirTableau, 'Son tableau de bord', <ChartColumn aria-hidden size={16} />)}
          {lien(lienReclamations, surOuvrirReclamations, 'Ses réclamations', <Inbox aria-hidden size={16} />)}
        </div>
      </div>
    </div>
  );
}

export function Agences({
  indicateurs: ind,
  periode = 'Du 1er au 25 septembre 2026',
  filtres,
  surExporter,
  chargement,
  ouverte: ouverteInitiale = null,
  lienTableau,
  lienReclamations,
  surOuvrirTableau,
  surOuvrirReclamations,
}: {
  indicateurs: S<'IndicateursAgences'>;
  periode?: string;
  /** Les vrais filtres (période, catégorie, canal) ; sinon, ceux de la maquette */
  filtres?: ReactNode;
  surExporter?: () => void;
  /** Nouveaux chiffres en chargement : les actuels restent affichés, atténués */
  chargement?: boolean;
  /** Agence dépliée à l'ouverture (maquettes, captures) */
  ouverte?: string | null;
  lienTableau?: (agenceId: string) => string;
  lienReclamations?: (agenceId: string) => string;
  surOuvrirTableau?: (agenceId: string) => void;
  surOuvrirReclamations?: (agenceId: string) => void;
}) {
  const [ouverte, setOuverte] = useState<string | null>(ouverteInitiale);
  const max = Math.max(1, ...ind.agences.map((l) => l.total));
  const avecSatisfaction = ind.agences.some((l) => l.satisfaction);
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">Activité des agences</h1>
          <p className="mt-1 max-w-3xl text-[15px] text-encre-3">
            Ce que fait chaque agence sur la période : réclamations reçues, traitement, délais et satisfaction. Délais en temps ouvré, selon les horaires de la banque.
          </p>
        </div>
        <Bouton icone={<Download aria-hidden size={17} />} onClick={surExporter}>Exporter en CSV</Bouton>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {filtres ?? (
          <button type="button" className="inline-flex h-10 items-center gap-2 rounded-lg border border-trait-fort bg-surface px-3.5 text-[15px] font-semibold">
            <CalendarDays aria-hidden size={17} className="text-encre-3" />
            {periode}
            <ChevronDown aria-hidden size={16} className="text-encre-3" />
          </button>
        )}
      </div>

      <div className={cx('flex flex-col gap-5 transition-opacity', chargement && 'opacity-60')} aria-busy={chargement || undefined}>
        <Reperes lignes={ind.agences} />

        <div className="overflow-hidden rounded-xl border border-trait bg-surface">
          <table className="w-full text-left text-[15px]">
            <caption className="sr-only">Activité de chaque agence sur la période</caption>
            <thead>
              <tr className="border-b border-trait text-[13px] text-encre-3">
                <th scope="col" className="py-2.5 pr-3 pl-5 font-semibold">Agence</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Reçues</th>
                <th scope="col" className="px-3 py-2.5 text-right font-semibold">En cours</th>
                <th scope="col" className="px-3 py-2.5 text-right font-semibold">En retard</th>
                <th scope="col" className="px-3 py-2.5 text-right font-semibold">1<sup>re</sup> réponse</th>
                <th scope="col" className="px-3 py-2.5 text-right font-semibold">Résolution</th>
                <th scope="col" className="px-3 py-2.5 text-right font-semibold">SLA respecté</th>
                <th scope="col" className="px-3 py-2.5 text-right font-semibold">1<sup>er</sup> contact</th>
                {avecSatisfaction && <th scope="col" className="px-3 py-2.5 text-right font-semibold">Satisfaction</th>}
                <th scope="col" className="py-2.5 pr-4"><span className="sr-only">Détail</span></th>
              </tr>
            </thead>
            <tbody>
              {ind.agences.map((l) => {
                const cle = cleAgence(l);
                const deplie = ouverte === cle;
                const nom = nomAgence(l);
                const idAgence = l.agence?.id;
                return (
                  <Fragment key={cle}>
                    <tr className={cx('border-b border-trait last:border-0', deplie && 'bg-marque-doux/40')}>
                      <th scope="row" className="py-3 pr-3 pl-5 font-normal">
                        <button
                          type="button"
                          aria-expanded={deplie}
                          aria-controls={`detail-${cle}`}
                          onClick={() => setOuverte(deplie ? null : cle)}
                          className="flex items-center gap-2.5 text-left"
                        >
                          <ChevronRight aria-hidden size={16} className={cx('shrink-0 text-encre-3 transition-transform', deplie && 'rotate-90')} />
                          <span className="leading-snug">
                            <span className={cx('block font-semibold', !l.agence && 'text-encre-2 italic')}>
                              {nom}
                              {l.agence && !l.agence.active && <span className="ml-2 rounded bg-cloturee-doux px-1.5 text-xs font-semibold text-cloturee not-italic">Inactive</span>}
                            </span>
                            <span className="block text-[13px] text-encre-3">
                              {l.agence ? [l.agence.code, l.agence.ville].filter(Boolean).join(' · ') : 'Le client n\'a pas indiqué d\'agence'}
                              {l.groupe && <><Users aria-hidden size={12} className="mx-1.5 inline -translate-y-px" />{l.groupe.nom}</>}
                            </span>
                          </span>
                        </button>
                      </th>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2.5">
                          <span className="chiffres w-9 text-right font-bold">{nombre(l.total)}</span>
                          <span className="h-2.5 w-24 rounded-sm bg-fond"><span className="block h-full rounded-sm bg-marque" style={{ width: `${(l.total / max) * 100}%` }} /></span>
                        </div>
                        {l.urgentes > 0 && <div className="chiffres mt-0.5 pl-[46px] text-[13px] font-semibold text-urgent">{l.urgentes} urgente{l.urgentes > 1 ? 's' : ''}</div>}
                      </td>
                      <td className="chiffres px-3 py-3 text-right">
                        <span className="font-semibold">{nombre(l.charge.aTraiter + l.charge.enAttenteClient)}</span>
                        {l.charge.enAttenteClient > 0 && <div className="text-[13px] text-encre-3">dont {l.charge.enAttenteClient} chez le client</div>}
                      </td>
                      <td className={cx('chiffres px-3 py-3 text-right font-semibold', l.charge.enRetard > 0 ? 'text-urgent' : 'text-encre-3')}>{nombre(l.charge.enRetard)}</td>
                      <td className="chiffres px-3 py-3 text-right whitespace-nowrap">{l.delaiPremiereReponseMoyenMinutes === null ? '—' : duree(l.delaiPremiereReponseMoyenMinutes)}</td>
                      <td className="chiffres px-3 py-3 text-right whitespace-nowrap">{l.delaiResolutionMoyenMinutes === null ? '—' : duree(l.delaiResolutionMoyenMinutes)}</td>
                      <td className={cx('chiffres px-3 py-3 text-right font-bold', tonSla(l.tauxRespectSla))}>{pourcent(l.tauxRespectSla)}</td>
                      <td className="chiffres px-3 py-3 text-right">{pourcent(l.tauxResolutionPremierContact)}</td>
                      {avecSatisfaction && (
                        <td className="chiffres px-3 py-3 text-right whitespace-nowrap">
                          {l.satisfaction && l.satisfaction.reponses > 0 ? (
                            <>
                              <span className="font-semibold">{pourcent(l.satisfaction.tauxSatisfaits)}</span>
                              <div className="text-[13px] text-encre-3">NPS {signe(l.satisfaction.nps ?? 0)}</div>
                            </>
                          ) : <span className="text-encre-3">—</span>}
                        </td>
                      )}
                      <td className="py-3 pr-4 text-right">
                        {idAgence && (surOuvrirTableau || lienTableau) && (
                          <a
                            href={lienTableau?.(idAgence) ?? '#'}
                            onClick={(e) => {
                              if (surOuvrirTableau && !e.metaKey && !e.ctrlKey && !e.shiftKey && e.button === 0) {
                                e.preventDefault();
                                surOuvrirTableau(idAgence);
                              }
                            }}
                            aria-label={`Tableau de bord de l'agence ${nom}`}
                            title="Son tableau de bord"
                            className="inline-flex rounded-lg p-2 text-encre-3 hover:bg-fond hover:text-encre"
                          >
                            <ChartColumn size={17} />
                          </a>
                        )}
                      </td>
                    </tr>
                    {deplie && (
                      <tr id={`detail-${cle}`} className="border-b border-trait last:border-0">
                        <td colSpan={avecSatisfaction ? 10 : 9} className="p-0">
                          <Detail
                            l={l}
                            lienTableau={idAgence ? lienTableau?.(idAgence) : undefined}
                            lienReclamations={idAgence ? lienReclamations?.(idAgence) : undefined}
                            surOuvrirTableau={idAgence && surOuvrirTableau ? () => surOuvrirTableau(idAgence) : undefined}
                            surOuvrirReclamations={idAgence && surOuvrirReclamations ? () => surOuvrirReclamations(idAgence) : undefined}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-sm leading-relaxed text-encre-3">
          Reçues : réclamations déposées sur la période, par un QR code de l'agence ou par un lien web où le client l'a choisie. En cours et en retard : en ce moment, quelle que soit la période.
          SLA respecté et premier contact : parmi les réclamations résolues. Satisfaction : part des clients satisfaits (notes 4 et 5) et NPS.
        </p>
      </div>
    </div>
  );
}
