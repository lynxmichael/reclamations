/**
 * Baromètre mensuel de l'expérience client (étape 23) : listerBarometres, lireBarometre,
 * deciderRecommandation. Pour l'Admin Entreprise et les superviseurs, quand Makor a ouvert la fonction.
 *
 * Publié le 1er de chaque mois pour le mois écoulé, puis figé : les chiffres sont calculés par la
 * plateforme (mêmes définitions que le tableau de bord, détaillées en bas de page) ; l'IA, si la
 * banque a l'assistant, ne fait que regrouper les commentaires des clients et rédiger les
 * recommandations, sans chiffre qui ne soit dans les données. L'Admin Entreprise retient ou écarte
 * chaque recommandation, avec un commentaire ; les superviseurs lisent. La page s'imprime telle quelle.
 *
 * Le baromètre parle de l'organisation (catégories, agences, délais), jamais d'un agent en particulier.
 */
import { useState, type ReactNode } from 'react';
import {
  ArrowDownRight, ArrowRight, ArrowUpRight, Bot, CalendarClock, Check, CircleAlert, Gauge, Info, MessageSquareQuote, Printer, RotateCcw, Sparkles, Star, Tag, TrendingDown,
  TrendingUp, X,
} from 'lucide-react';
import type { S } from '../../api/types';
import { Bouton, Liste, Panneau, Texte, cx } from '../../ui/composants';
import { date, duree, heure, nombre, pourcent } from '../../ui/format';
import { Tendance, moisCourt } from '../../ui/Tendance';
import { signe } from './TableauDeBord';

type Barometre = S<'Barometre'>;
type Recommandation = S<'RecommandationBarometre'>;
type Decision = S<'DecisionRecommandationValeur'>;

/** « septembre 2026 » */
export const libelleMois = (mois: string) => moisCourt(mois, true);
/** « 2026-11-01 » → « 1er novembre 2026 » */
export function jourEnLettres(jour: string): string {
  const [a, m, j] = jour.split('-').map(Number) as [number, number, number];
  const mois = new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', month: 'long' }).format(new Date(Date.UTC(a, m - 1, 1)));
  return `${j === 1 ? '1er' : j} ${mois} ${a}`;
}
/** « de septembre 2026 », « d'août 2026 » */
export const deMois = (mois: string) => {
  const l = libelleMois(mois);
  return /^[aeiouéèêâ]/i.test(l) ? `d'${l}` : `de ${l}`;
};

const SOURCE: Record<S<'SourceAnalyse'>, { libelle: string; detail: string }> = {
  IA: { libelle: 'Analyse par l\'IA', detail: 'Commentaires regroupés et recommandations rédigées par l\'IA, à partir des chiffres de la plateforme et des commentaires masqués (ni nom, ni coordonnées).' },
  REGLES: { libelle: 'Analyse par les règles', detail: 'Thèmes reconnus par mots-clés et recommandations tirées de règles simples sur les chiffres du mois.' },
};

// ---- Variations ---------------------------------------------------------------------------

function Variation({ actuel, precedent, type, mois }: { actuel: number | null; precedent: number | null | undefined; type: 'nombre' | 'taux' | 'nps'; mois: string }) {
  if (actuel === null || precedent === null || precedent === undefined) return <span className="text-encre-3">Pas de comparaison</span>;
  let ecart: number;
  let texte: string;
  if (type === 'taux') {
    ecart = Math.round((actuel - precedent) * 100);
    texte = `${signe(ecart)} point${Math.abs(ecart) > 1 ? 's' : ''}`;
  } else if (type === 'nps') {
    ecart = actuel - precedent;
    texte = signe(ecart);
  } else {
    ecart = actuel - precedent;
    texte = precedent > 0 ? `${signe(Math.round((ecart / precedent) * 100))} %` : signe(ecart);
  }
  const Icone = ecart > 0 ? ArrowUpRight : ecart < 0 ? ArrowDownRight : ArrowRight;
  return (
    <span className="inline-flex items-center gap-1 text-encre-2">
      <Icone aria-hidden size={15} className="text-encre-3" />
      <span className="chiffres font-semibold">{texte}</span>
      <span className="text-encre-3">sur {moisCourt(mois)}</span>
    </span>
  );
}

function Tuile({ libelle, valeur, detail, variation }: { libelle: string; valeur: string; detail: string; variation: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 bg-surface px-5 py-4">
      <dt className="text-sm font-semibold text-encre-2">{libelle}</dt>
      <dd className="chiffres text-[28px] leading-none font-bold tracking-tight text-encre">{valeur}</dd>
      <dd className="text-[13px] leading-snug text-encre-3">{detail}</dd>
      <dd className="mt-1 text-[13px]">{variation}</dd>
    </div>
  );
}

function Essentiel({ b }: { b: Barometre }) {
  const m = b.mesures;
  const p = b.precedent;
  const avant = b.tendance.at(-2)?.mois ?? b.mois;
  const v = (actuel: number | null, prec: number | null | undefined, type: 'nombre' | 'taux' | 'nps') => <Variation actuel={actuel} precedent={p ? prec : null} type={type} mois={avant} />;
  return (
    <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-trait bg-trait">
      <Tuile
        libelle="Réclamations reçues"
        valeur={nombre(m.reclamations)}
        detail={`${nombre(m.urgentes)} urgente${m.urgentes > 1 ? 's' : ''} ; ${nombre(m.resolues)} résolue${m.resolues > 1 ? 's' : ''} dans le mois`}
        variation={v(m.reclamations, p?.reclamations, 'nombre')}
      />
      <Tuile
        libelle="Délais respectés"
        valeur={pourcent(m.tauxRespectSla)}
        detail={`Résolues avant leur échéance${m.delaiResolutionMoyenMinutes !== null ? ` ; résolution en ${duree(m.delaiResolutionMoyenMinutes)} ouvrées en moyenne` : ''}`}
        variation={v(m.tauxRespectSla, p?.tauxRespectSla, 'taux')}
      />
      <Tuile
        libelle="Résolues au premier contact"
        valeur={pourcent(m.tauxPremierContact)}
        detail={`Sans question au client, sans escalade ni réouverture ; ${nombre(m.contestees)} contestée${m.contestees > 1 ? 's' : ''}`}
        variation={v(m.tauxPremierContact, p?.tauxPremierContact, 'taux')}
      />
      <Tuile
        libelle="Clients satisfaits"
        valeur={pourcent(m.tauxSatisfaits)}
        detail={m.reponses ? `Notes 4 et 5 sur ${nombre(m.reponses)} réponse${m.reponses > 1 ? 's' : ''} ; note moyenne ${m.noteMoyenne?.toLocaleString('fr-FR') ?? '—'} sur 5` : 'Aucune réponse à l\'enquête ce mois-ci'}
        variation={v(m.tauxSatisfaits, p?.tauxSatisfaits, 'taux')}
      />
      <Tuile
        libelle="NPS"
        valeur={m.nps === null ? '—' : signe(m.nps)}
        detail="Part des notes 9 et 10 moins part des notes 0 à 6, de −100 à +100"
        variation={v(m.nps, p?.nps, 'nps')}
      />
      <Tuile
        libelle="Réponse à l'enquête"
        valeur={pourcent(m.tauxReponse)}
        detail={m.enquetes ? `Sur ${nombre(m.enquetes)} enquête${m.enquetes > 1 ? 's' : ''} terminée${m.enquetes > 1 ? 's' : ''} ce mois-ci` : 'Aucune enquête terminée ce mois-ci'}
        variation={v(m.tauxReponse, p?.tauxReponse, 'taux')}
      />
    </dl>
  );
}

// ---- Faits marquants et tendance ------------------------------------------------------------

function FaitsMarquants({ faits }: { faits: S<'FaitMarquant'>[] }) {
  return (
    <Panneau titre="Faits marquants">
      {faits.length ? (
        <ul className="flex flex-col gap-2.5">
          {faits.map((f) => (
            <li key={f.texte} className="flex items-start gap-2.5 text-[15px]">
              {f.sens === 'MIEUX'
                ? <TrendingUp aria-hidden size={18} className="mt-0.5 shrink-0 text-resolue" />
                : <TrendingDown aria-hidden size={18} className="mt-0.5 shrink-0 text-urgent" />}
              <span>
                <span className={cx('mr-1.5 text-[13px] font-semibold', f.sens === 'MIEUX' ? 'text-resolue' : 'text-urgent')}>{f.sens === 'MIEUX' ? 'Mieux' : 'Moins bien'}</span>
                {f.texte}
              </span>
            </li>
          ))}
        </ul>
      ) : <p className="text-[15px] text-encre-3">Rien n'a nettement bougé depuis le mois précédent (ou pas assez de données pour le dire).</p>}
    </Panneau>
  );
}

function TendanceSixMois({ b }: { b: Barometre }) {
  const [tableau, setTableau] = useState(false);
  const t = b.tendance;
  return (
    <Panneau
      titre="Tendance sur 6 mois"
      action={(
        <button type="button" onClick={() => setTableau((x) => !x)} className="sans-impression text-sm font-semibold text-marque-texte underline-offset-2 hover:underline">
          {tableau ? 'Voir les graphiques' : 'Voir le tableau'}
        </button>
      )}
    >
      {tableau ? (
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Les 6 derniers mois</caption>
          <thead>
            <tr className="border-b border-trait text-encre-3">
              <th scope="col" className="py-2 pr-3 font-semibold">Mois</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">Réclamations</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">Délais respectés</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">Réponses</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">Clients satisfaits</th>
              <th scope="col" className="py-2 pl-3 text-right font-semibold">NPS</th>
            </tr>
          </thead>
          <tbody>
            {t.map((p) => (
              <tr key={p.mois} className="border-b border-trait last:border-0">
                <th scope="row" className="py-1.5 pr-3 font-normal text-encre-2">{libelleMois(p.mois)}</th>
                <td className="chiffres px-3 py-1.5 text-right">{nombre(p.reclamations)}</td>
                <td className="chiffres px-3 py-1.5 text-right">{pourcent(p.tauxRespectSla)}</td>
                <td className="chiffres px-3 py-1.5 text-right">{nombre(p.reponses)}</td>
                <td className="chiffres px-3 py-1.5 text-right">{pourcent(p.tauxSatisfaits)}</td>
                <td className="chiffres py-1.5 pl-3 text-right">{p.nps === null ? '—' : signe(p.nps)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="grid grid-cols-3 gap-6">
          <Tendance titre="Réclamations reçues" forme="colonnes" format={nombre} points={t.map((p) => ({ mois: p.mois, valeur: p.reclamations }))} />
          <Tendance titre="Délais respectés" forme="courbe" echelle="taux" format={(v) => pourcent(v)} points={t.map((p) => ({ mois: p.mois, valeur: p.tauxRespectSla }))} />
          <Tendance titre="Clients satisfaits" forme="courbe" echelle="taux" format={(v) => pourcent(v)} points={t.map((p) => ({ mois: p.mois, valeur: p.tauxSatisfaits }))} />
        </div>
      )}
    </Panneau>
  );
}

// ---- Recommandations ---------------------------------------------------------------------------

const DECISION: Record<Decision, { libelle: string; icone: typeof Check; style: string }> = {
  A_ETUDIER: { libelle: 'À étudier', icone: CircleAlert, style: 'bg-attente-doux text-attente' },
  RETENUE: { libelle: 'Retenue', icone: Check, style: 'bg-resolue-doux text-resolue' },
  ECARTEE: { libelle: 'Écartée', icone: X, style: 'bg-cloturee-doux text-cloturee' },
};

function CarteRecommandation({ r, peutDecider, enCours, fuseau, surDecider }: {
  r: Recommandation;
  peutDecider: boolean;
  enCours: boolean;
  fuseau: string;
  surDecider?: (decision: Decision, commentaire: string | null) => void;
}) {
  const [commentaire, setCommentaire] = useState(r.commentaire ?? '');
  const d = DECISION[r.decision];
  const decider = (decision: Decision) => surDecider?.(decision, commentaire.trim() || null);
  return (
    <li className="rounded-xl border border-trait bg-surface" data-recommandation={r.ordre}>
      <div className="flex items-start gap-4 px-5 pt-4">
        <span className="chiffres mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-marque-doux text-[15px] font-bold text-marque-texte">{r.ordre}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[17px] font-bold text-encre">{r.titre}</h3>
            {r.priorite === 'HAUTE' && (
              <span className="inline-flex items-center gap-1 rounded-full bg-urgent-doux px-2 py-0.5 text-[13px] font-semibold text-urgent">
                <CircleAlert aria-hidden size={13} />Priorité haute
              </span>
            )}
            <span className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[13px] font-semibold', d.style)}>
              <d.icone aria-hidden size={13} />{d.libelle}
            </span>
          </div>
          <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-[15px]">
            <dt className="font-semibold text-encre-3">Constat</dt>
            <dd className="text-encre">{r.constat}</dd>
            <dt className="font-semibold text-encre-3">Proposition</dt>
            <dd className="text-encre">{r.action}</dd>
          </dl>
          <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-encre-3">
            {r.categorie && <span className="inline-flex items-center gap-1"><Tag aria-hidden size={13} />{r.categorie.nom}</span>}
            <span className="inline-flex items-center gap-1">
              {r.source === 'IA' ? <Sparkles aria-hidden size={13} /> : <Gauge aria-hidden size={13} />}
              {r.source === 'IA' ? 'Proposée par l\'IA' : 'Proposée par les règles de la plateforme'}
            </span>
          </p>
        </div>
      </div>
      <div className="mt-3 border-t border-trait px-5 py-3">
        {r.decision !== 'A_ETUDIER' && (
          <div className="text-[15px]">
            <p className="text-encre-2">
              {d.libelle} par <span className="font-semibold text-encre">{r.decideePar?.nom ?? '—'}</span>
              {r.decideeLe && <> le {date(r.decideeLe, fuseau)}</>}
              {!peutDecider && r.commentaire === null && '.'}
            </p>
            {r.commentaire && !peutDecider && <p className="mt-1 border-l-[3px] border-trait-fort pl-3 text-encre">{r.commentaire}</p>}
          </div>
        )}
        {peutDecider ? (
          <div className={cx('sans-impression flex items-end gap-3', r.decision !== 'A_ETUDIER' && 'mt-2')}>
            <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
              <span className="font-semibold text-encre-2">Commentaire <span className="font-normal text-encre-3">(facultatif : l'action prévue, la raison)</span></span>
              <Texte
                rows={2}
                maxLength={1000}
                value={commentaire}
                onChange={(e) => setCommentaire(e.target.value)}
                className="py-2"
                style={{ minHeight: 0 }}
                placeholder={r.decision === 'A_ETUDIER' ? 'Par exemple : renfort de l\'équipe monétique dès lundi' : undefined}
              />
            </label>
            {r.decision === 'A_ETUDIER' ? (
              <>
                <Bouton variante="principal" icone={<Check aria-hidden size={17} />} disabled={enCours} onClick={() => decider('RETENUE')}>Retenir</Bouton>
                <Bouton icone={<X aria-hidden size={17} />} disabled={enCours} onClick={() => decider('ECARTEE')}>Écarter</Bouton>
              </>
            ) : (
              <>
                {commentaire.trim() !== (r.commentaire ?? '') && (
                  <Bouton variante="principal" disabled={enCours} onClick={() => decider(r.decision)}>Enregistrer le commentaire</Bouton>
                )}
                <Bouton variante="discret" icone={<RotateCcw aria-hidden size={16} />} disabled={enCours} onClick={() => decider('A_ETUDIER')}>Revenir sur la décision</Bouton>
              </>
            )}
          </div>
        ) : r.decision === 'A_ETUDIER' && <p className="text-[15px] text-encre-3">L'Admin Entreprise n'a pas encore décidé de cette recommandation.</p>}
        {peutDecider && r.decision !== 'A_ETUDIER' && r.commentaire && <p className="hidden pt-1 text-[15px] print:block">{r.commentaire}</p>}
        {peutDecider && r.decision === 'A_ETUDIER' && <p className="hidden text-[15px] text-encre-3 print:block">Pas encore décidée.</p>}
      </div>
    </li>
  );
}

function Recommandations({ b, peutDecider, decisionEnCours, fuseau, surDecider }: {
  b: Barometre;
  peutDecider: boolean;
  decisionEnCours?: string | null;
  fuseau: string;
  surDecider?: (id: string, decision: Decision, commentaire: string | null) => void;
}) {
  const aEtudier = b.recommandations.filter((r) => r.decision === 'A_ETUDIER').length;
  return (
    <section aria-labelledby="titre-recommandations">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="titre-recommandations" className="text-[20px] font-bold">Recommandations</h2>
        <p className="text-sm text-encre-3">
          {b.recommandations.length
            ? `${b.recommandations.length} proposée${b.recommandations.length > 1 ? 's' : ''}, ${aEtudier ? `${aEtudier} à étudier` : 'toutes décidées'}. `
            : ''}
          {peutDecider ? 'Vous retenez ou écartez chacune ; le texte publié ne change pas.' : 'L\'Admin Entreprise retient ou écarte chacune.'}
        </p>
      </div>
      {b.recommandations.length ? (
        <ol className="flex flex-col gap-3">
          {b.recommandations.map((r) => (
            <CarteRecommandation
              key={`${r.id}-${r.decision}-${r.commentaire ?? ''}`}
              r={r}
              peutDecider={peutDecider}
              enCours={decisionEnCours === r.id}
              fuseau={fuseau}
              surDecider={surDecider ? (decision, commentaire) => surDecider(r.id, decision, commentaire) : undefined}
            />
          ))}
        </ol>
      ) : (
        <p className="rounded-xl border border-trait bg-surface px-5 py-4 text-[15px] text-encre-3">
          Aucune recommandation ce mois-ci : aucun chiffre ne s'écartait assez des repères pour en justifier une.
        </p>
      )}
    </section>
  );
}

// ---- Irritants -----------------------------------------------------------------------------------

function TableIrritants({ titre, lignes, colonne, vide }: { titre: string; lignes: S<'Irritant'>[]; colonne: string; vide: string }) {
  const max = Math.max(1, ...lignes.map((l) => l.score));
  return (
    <Panneau titre={titre} sansMarge>
      {lignes.length ? (
        <table className="w-full text-left text-[15px]">
          <caption className="sr-only">{titre}, les plus irritants d'abord</caption>
          <thead>
            <tr className="border-b border-trait text-[13px] text-encre-3">
              <th scope="col" className="py-2.5 pr-3 pl-5 font-semibold">{colonne}</th>
              <th scope="col" className="px-3 py-2.5 text-right font-semibold">Reçues</th>
              <th scope="col" className="px-3 py-2.5 text-right font-semibold">Hors délai</th>
              <th scope="col" className="px-3 py-2.5 text-right font-semibold">Contestées</th>
              <th scope="col" className="px-3 py-2.5 text-right font-semibold">Insatisfaits</th>
              <th scope="col" className="py-2.5 pr-5 pl-3 font-semibold">Score</th>
            </tr>
          </thead>
          <tbody>
            {lignes.map((l) => (
              <tr key={l.id} className="border-b border-trait last:border-0">
                <th scope="row" className="py-2.5 pr-3 pl-5 font-semibold">{l.nom}</th>
                <td className="chiffres px-3 py-2.5 text-right">
                  {nombre(l.reclamations)}
                  <div className="text-[13px] text-encre-3">{nombre(l.precedent)} le mois d'avant</div>
                </td>
                <td className="chiffres px-3 py-2.5 text-right">
                  {nombre(l.horsDelai)}
                  {l.resolues > 0 && <div className="text-[13px] text-encre-3">sur {nombre(l.resolues)} résolues</div>}
                </td>
                <td className="chiffres px-3 py-2.5 text-right">{nombre(l.contestees)}</td>
                <td className="chiffres px-3 py-2.5 text-right">
                  {nombre(l.insatisfaits)}
                  {l.reponses > 0 && <div className="text-[13px] text-encre-3">sur {nombre(l.reponses)} avis</div>}
                </td>
                <td className="py-2.5 pr-5 pl-3">
                  <div className="flex items-center gap-2.5">
                    <span className="h-2.5 w-24 rounded-sm bg-fond"><span className="block h-full rounded-sm bg-marque" style={{ width: `${(l.score / max) * 100}%` }} /></span>
                    <span className="chiffres w-8 font-bold">{nombre(l.score)}</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <p className="px-5 py-4 text-[15px] text-encre-3">{vide}</p>}
    </Panneau>
  );
}

// ---- Ce que disent les clients ---------------------------------------------------------------

function Themes({ b, lienReclamation, surOuvrirReclamation }: {
  b: Barometre;
  lienReclamation?: (numero: string) => string;
  surOuvrirReclamation?: (numero: string) => void;
}) {
  return (
    <Panneau titre="Ce que disent les clients">
      <p className="mb-4 text-sm text-encre-3">
        {b.commentaires
          ? `${nombre(b.commentaires)} commentaire${b.commentaires > 1 ? 's' : ''} laissé${b.commentaires > 1 ? 's' : ''} dans l'enquête ce mois-ci. `
            + (b.source === 'IA' ? 'Thèmes regroupés par l\'IA ; mentions et notes comptées par la plateforme sur les commentaires eux-mêmes.' : 'Thèmes reconnus par mots-clés ; un commentaire peut relever de plusieurs thèmes.')
          : 'Aucun commentaire de client ce mois-ci.'}
      </p>
      {b.themes.length > 0 && (
        <ul className="grid grid-cols-2 gap-x-8 gap-y-5">
          {b.themes.map((t) => (
            <li key={t.libelle} className="min-w-0">
              <h3 className="font-bold text-encre">{t.libelle}</h3>
              <p className="chiffres text-[13px] text-encre-3">
                {nombre(t.mentions)} commentaire{t.mentions > 1 ? 's' : ''} · {nombre(t.negatifs)} insatisfait{t.negatifs > 1 ? 's' : ''} (notes 1 à 3) · {nombre(t.positifs)} satisfait{t.positifs > 1 ? 's' : ''}
              </p>
              <ul className="mt-2 flex flex-col gap-2">
                {t.exemples.map((e) => (
                  <li key={e.numero + e.texte} className="flex gap-2.5 text-[15px]">
                    <MessageSquareQuote aria-hidden size={17} className="mt-0.5 shrink-0 text-encre-3" />
                    <div className="min-w-0">
                      <q className="text-encre italic">{e.texte}</q>
                      <div className="mt-0.5 flex items-center gap-2 text-[13px] text-encre-3">
                        <span className="inline-flex items-center gap-0.5"><Star aria-hidden size={12} />{e.note}/5</span>
                        {lienReclamation || surOuvrirReclamation ? (
                          <a
                            href={lienReclamation?.(e.numero) ?? '#'}
                            onClick={(ev) => {
                              if (surOuvrirReclamation && !ev.metaKey && !ev.ctrlKey && !ev.shiftKey && ev.button === 0) {
                                ev.preventDefault();
                                surOuvrirReclamation(e.numero);
                              }
                            }}
                            className="chiffres font-semibold text-marque-texte hover:underline"
                          >
                            {e.numero}
                          </a>
                        ) : <span className="chiffres">{e.numero}</span>}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </Panneau>
  );
}

function Definitions() {
  return (
    <details className="rounded-xl border border-trait bg-surface px-5 py-3 text-[15px]">
      <summary className="cursor-pointer font-semibold text-encre-2">Comment lire ce baromètre</summary>
      <ul className="mt-3 flex list-disc flex-col gap-1.5 pl-5 text-encre-2">
        <li>Mois civil, dans le fuseau de la banque. Le baromètre est publié le 1<sup>er</sup> du mois suivant et ne change plus.</li>
        <li>Réclamations reçues : déposées pendant le mois. Délais, premier contact et contestations : réclamations résolues ou contestées pendant le mois.</li>
        <li>Satisfaction et NPS : réponses à l'enquête reçues pendant le mois. Taux de réponse : enquêtes dont le délai de réponse (7 jours) a pris fin pendant le mois.</li>
        <li>Score d'irritation d'une catégorie ou d'une agence : 1 par réclamation reçue, plus 1 par réclamation hors délai, par contestation et par client insatisfait (note de 1 à 3). 3 réclamations au moins pour figurer.</li>
        <li>Moins de 30 réponses à l'enquête : satisfaction et NPS sont donnés à titre indicatif.</li>
        <li>Le baromètre porte sur l'organisation (catégories, agences, délais), jamais sur un agent en particulier.</li>
      </ul>
    </details>
  );
}

// ---- Page ---------------------------------------------------------------------------------------

export function Barometre({
  liste,
  barometre: b,
  peutDecider,
  fuseau,
  decisionEnCours,
  chargement,
  surChoisirMois,
  surDecider,
  surImprimer,
  lienReclamation,
  surOuvrirReclamation,
}: {
  liste: S<'ListeBarometres'>;
  /** Le baromètre affiché ; vide quand aucun n'est encore publié */
  barometre: Barometre | null;
  /** Admin Entreprise : retenir ou écarter */
  peutDecider: boolean;
  fuseau: string;
  /** Recommandation dont la décision part à l'API */
  decisionEnCours?: string | null;
  chargement?: boolean;
  surChoisirMois?: (mois: string) => void;
  surDecider?: (id: string, decision: Decision, commentaire: string | null) => void;
  surImprimer?: () => void;
  lienReclamation?: (numero: string) => string;
  surOuvrirReclamation?: (numero: string) => void;
}) {
  const prochain = jourEnLettres(liste.prochainLe);
  return (
    <div className="barometre-imprimable flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">
            Baromètre de l'expérience client{b && <span className="text-encre-2"> · {libelleMois(b.mois)}</span>}
          </h1>
          <p className="mt-1 max-w-3xl text-[15px] text-encre-3">
            Ce que vivent vos clients, mois par mois : chiffres clés, irritants, ce qu'ils disent dans l'enquête de satisfaction, et des recommandations à étudier.
          </p>
        </div>
        {liste.donnees.length > 0 && (
          <div className="sans-impression flex items-end gap-2">
            <label className="flex flex-col gap-1 text-sm font-semibold text-encre-2">
              Mois
              <Liste value={b?.mois ?? ''} onChange={(e) => surChoisirMois?.(e.target.value)} className="w-64" aria-label="Mois du baromètre">
                {liste.donnees.map((x) => (
                  <option key={x.mois} value={x.mois}>
                    {libelleMois(x.mois)}{x.aEtudier ? ` — ${x.aEtudier} à étudier` : ''}
                  </option>
                ))}
              </Liste>
            </label>
            <Bouton icone={<Printer aria-hidden size={17} />} onClick={surImprimer} className="h-11">Imprimer</Bouton>
          </div>
        )}
      </div>

      {!b ? (
        <Panneau>
          <div className="flex flex-col items-center py-10 text-center">
            <CalendarClock aria-hidden size={30} className="text-encre-3" />
            <h2 className="mt-3 text-xl font-bold">Premier baromètre le {prochain}</h2>
            <p className="mt-1 max-w-[60ch] text-[15px] text-encre-2">
              Le baromètre est publié le 1<sup>er</sup> de chaque mois pour le mois écoulé. L'Admin Entreprise et les superviseurs reçoivent une notification dès qu'il est prêt.
            </p>
          </div>
        </Panneau>
      ) : (
        <div className={cx('flex flex-col gap-5 transition-opacity', chargement && 'opacity-60')} aria-busy={chargement || undefined}>
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-encre-3">
            <span>Du {date(b.du, fuseau)} au {date(new Date(new Date(b.au).getTime() - 1).toISOString(), fuseau)}</span>
            <span>Publié le {date(b.genereLe, fuseau)} à {heure(b.genereLe, fuseau)}</span>
            <span className="inline-flex items-center gap-1" title={SOURCE[b.source].detail}>
              {b.source === 'IA' ? <Bot aria-hidden size={15} /> : <Gauge aria-hidden size={15} />}
              {SOURCE[b.source].libelle}
            </span>
            <span className="sans-impression">Prochain baromètre le {prochain}</span>
          </p>
          {b.peuDeReponses && b.mesures.reponses > 0 && (
            <p role="note" className="flex items-start gap-2.5 rounded-xl border border-alerte/30 bg-alerte-doux px-4 py-3 text-[15px] text-encre">
              <Info aria-hidden size={18} className="mt-0.5 shrink-0 text-alerte" />
              <span>
                <span className="font-semibold">{nombre(b.mesures.reponses)} réponse{b.mesures.reponses > 1 ? 's' : ''} à l'enquête ce mois-ci</span> :
                {' '}moins de 30, la satisfaction et le NPS sont à lire avec prudence.
              </span>
            </p>
          )}

          <Essentiel b={b} />
          <Recommandations b={b} peutDecider={peutDecider} decisionEnCours={decisionEnCours} fuseau={fuseau} surDecider={surDecider} />
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-5 print:grid-cols-1">
            <FaitsMarquants faits={b.faitsMarquants} />
            <TendanceSixMois b={b} />
          </div>
          <TableIrritants titre="Irritants par catégorie" colonne="Catégorie" lignes={b.irritants} vide="Aucune catégorie n'a reçu 3 réclamations ou plus ce mois-ci." />
          <TableIrritants titre="Agences" colonne="Agence" lignes={b.agences} vide="Aucune agence n'a reçu 3 réclamations ou plus ce mois-ci." />
          <Themes b={b} lienReclamation={lienReclamation} surOuvrirReclamation={surOuvrirReclamation} />
          <Definitions />
        </div>
      )}
    </div>
  );
}
