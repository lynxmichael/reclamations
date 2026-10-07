/**
 * Activité de toutes les banques (lireIndicateursPlateforme) et facturation des SMS du mois
 * (lireFacturationSms). Métadonnées seulement : volumes, taux, compteurs. Étape 15 : totaux des
 * enquêtes de satisfaction par banque, jamais les commentaires des clients. Étape 18 : usage de
 * l'assistant IA par banque (lireConsommationIa), d'après un journal qui ne garde aucun message.
 * Étape 20 : messages WhatsApp (envoyés, facturés par Meta, échecs, reçus) et SMS reçus par banque
 * (lireFacturationCanaux), des totaux sans numéro ni texte.
 */
import type { ReactNode } from 'react';
import { CalendarDays, ChevronDown, Download } from 'lucide-react';
import type { S } from '../../api/types';
import { IconeCanal } from '../../ui/Canaux';
import { Bouton, Panneau, cx } from '../../ui/composants';
import { nombre, pourcent, relatif } from '../../ui/format';
import { signe } from '../back-office/TableauDeBord';
import { nomMois } from '../../ui/periodes';

const COULEURS = ['bg-ouverte', 'bg-en-cours', 'bg-attente', 'bg-resolue', 'bg-cloturee/45'];
const STATUTS = ['Ouverte', 'En cours', 'En attente client', 'Résolue', 'Clôturée'];

export function Activite({
  indicateurs,
  sms,
  ia,
  canaux,
  choixMois,
  surExporterSms,
  surExporterIa,
  surExporterCanaux,
  chargement,
}: {
  indicateurs: S<'IndicateursPlateforme'>;
  sms: S<'FacturationSms'>;
  /** Étape 18 : usage de l'assistant IA du mois */
  ia?: S<'ConsommationIa'>;
  surExporterIa?: () => void;
  /** Étape 20 : WhatsApp et SMS reçus du mois */
  canaux?: S<'FacturationCanaux'>;
  surExporterCanaux?: () => void;
  /** Étape 9 : le choix du mois (sinon, celui de la maquette) */
  choixMois?: ReactNode;
  surExporterSms?: () => void;
  chargement?: boolean;
}) {
  const avecEnquetes = indicateurs.banques.filter((b) => b.satisfaction);
  const totalSms = sms.banques.reduce((s, b) => ({ sms: s.sms + b.sms, segments: s.segments + b.segments, remis: s.remis + b.remis, echecs: s.echecs + b.echecs }), { sms: 0, segments: 0, remis: 0, echecs: 0 });
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">Activité et SMS</h1>
          <p className="mt-1 text-[15px] text-encre-3">Volumes et taux par banque. Le contenu des réclamations reste dans chaque banque.</p>
        </div>
        {choixMois ?? (
          <button type="button" className="inline-flex h-10 items-center gap-2 rounded-lg border border-trait-fort bg-surface px-3.5 text-[15px] font-semibold">
            <CalendarDays aria-hidden size={17} className="text-encre-3" />
            Septembre 2026
            <ChevronDown aria-hidden size={16} className="text-encre-3" />
          </button>
        )}
      </div>

      <div className={cx('flex flex-col gap-5 transition-opacity', chargement && 'opacity-60')} aria-busy={chargement || undefined}>
      <Panneau titre="Réclamations par banque" sansMarge>
        <table className="w-full text-left text-[15px]">
          <thead>
            <tr className="border-b border-trait text-[13px] text-encre-3">
              <th scope="col" className="py-2.5 pr-3 pl-5 font-semibold">Banque</th>
              <th scope="col" className="px-3 py-2.5 text-right font-semibold">Total</th>
              <th scope="col" className="w-[34%] px-3 py-2.5 font-semibold">Par statut</th>
              <th scope="col" className="px-3 py-2.5 text-right font-semibold">Urgentes</th>
              <th scope="col" className="px-3 py-2.5 text-right font-semibold">SLA respecté</th>
              <th scope="col" className="py-2.5 pr-5 pl-3 text-right font-semibold">1er contact</th>
            </tr>
          </thead>
          <tbody>
            {indicateurs.banques.map((b) => (
              <tr key={b.banque.id} className="border-b border-trait last:border-0">
                <td className="py-3 pr-3 pl-5 font-semibold">{b.banque.nom}</td>
                <td className="chiffres px-3 py-3 text-right font-bold">{nombre(b.total)}</td>
                <td className="px-3 py-3">
                  <div className="flex h-3 overflow-hidden rounded-sm" role="img" aria-label={b.parStatut.map((v) => `${v.libelle} ${v.total}`).join(', ')}>
                    {b.parStatut.map((v, i) => (
                      <span key={v.cle} className={cx('h-full', COULEURS[i])} style={{ width: `${(v.total / Math.max(1, b.total)) * 100}%` }} />
                    ))}
                  </div>
                </td>
                <td className="chiffres px-3 py-3 text-right">{b.urgentes}</td>
                <td className={cx('chiffres px-3 py-3 text-right font-semibold', (b.tauxRespectSla ?? 1) < 0.75 && 'text-urgent')}>{pourcent(b.tauxRespectSla)}</td>
                <td className="chiffres py-3 pr-5 pl-3 text-right">{pourcent(b.tauxResolutionPremierContact)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <ul className="flex flex-wrap gap-x-5 gap-y-1.5 border-t border-trait px-5 py-3 text-sm text-encre-2">
          {STATUTS.map((libelle, i) => (
            <li key={libelle} className="flex items-center gap-2">
              <span aria-hidden className={cx('h-2.5 w-2.5 rounded-sm', COULEURS[i])} />
              {libelle}
            </li>
          ))}
        </ul>
      </Panneau>

      {avecEnquetes.length > 0 && (
        <Panneau titre="Satisfaction des clients" sansMarge>
          <table className="w-full text-left text-[15px]">
            <thead>
              <tr className="border-b border-trait text-[13px] text-encre-3">
                <th scope="col" className="py-2.5 pr-3 pl-5 font-semibold">Banque</th>
                <th scope="col" className="px-3 py-2.5 text-right font-semibold">Enquêtes</th>
                <th scope="col" className="px-3 py-2.5 text-right font-semibold">Réponses</th>
                <th scope="col" className="px-3 py-2.5 text-right font-semibold">Satisfaits</th>
                <th scope="col" className="py-2.5 pr-5 pl-3 text-right font-semibold">NPS</th>
              </tr>
            </thead>
            <tbody>
              {avecEnquetes.map(({ banque, satisfaction: e }) => (
                <tr key={banque.id} className="border-b border-trait last:border-0">
                  <td className="py-3 pr-3 pl-5 font-semibold">{banque.nom}</td>
                  <td className="chiffres px-3 py-3 text-right">{nombre(e!.enquetes)}</td>
                  <td className="chiffres px-3 py-3 text-right">
                    {nombre(e!.reponses)}
                    <span className="ml-2 text-sm text-encre-3">{pourcent(e!.enquetes ? e!.reponses / e!.enquetes : null)}</span>
                  </td>
                  <td className="chiffres px-3 py-3 text-right font-semibold">{pourcent(e!.tauxSatisfaits)}</td>
                  <td className="chiffres py-3 pr-5 pl-3 text-right font-semibold">{e!.nps === null ? '—' : signe(e!.nps)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t border-trait px-5 py-3 text-sm text-encre-3">
            Enquêtes ouvertes à la clôture sur la période. Satisfaits : notes 4 et 5 sur 5. NPS : part des notes 9 et 10 moins part des notes 0 à 6, sur 10. Les commentaires restent dans chaque banque.
          </p>
        </Panneau>
      )}

      <Panneau
        titre={`SMS de ${nomMois(sms.mois)}`}
        sansMarge
        action={surExporterSms && <Bouton icone={<Download aria-hidden size={17} />} onClick={surExporterSms}>Exporter en CSV</Bouton>}
      >
        <table className="w-full text-left text-[15px]">
          <thead>
            <tr className="border-b border-trait text-[13px] text-encre-3">
              <th scope="col" className="py-2.5 pr-3 pl-5 font-semibold">Banque</th>
              <th scope="col" className="px-3 py-2.5 text-right font-semibold">SMS envoyés</th>
              <th scope="col" className="px-3 py-2.5 text-right font-semibold">Segments facturés</th>
              <th scope="col" className="px-3 py-2.5 text-right font-semibold">Remis</th>
              <th scope="col" className="py-2.5 pr-5 pl-3 text-right font-semibold">Non remis</th>
            </tr>
          </thead>
          <tbody>
            {sms.banques.map((b) => (
              <tr key={b.banque.id} className="border-b border-trait">
                <td className="py-3 pr-3 pl-5 font-semibold">{b.banque.nom}</td>
                <td className="chiffres px-3 py-3 text-right">{nombre(b.sms)}</td>
                <td className="chiffres px-3 py-3 text-right font-semibold">{nombre(b.segments)}</td>
                <td className="chiffres px-3 py-3 text-right text-encre-2">{nombre(b.remis)}</td>
                <td className="chiffres py-3 pr-5 pl-3 text-right text-encre-2">{nombre(b.echecs)}</td>
              </tr>
            ))}
            <tr className="bg-fond/70 font-bold">
              <td className="py-3 pr-3 pl-5">Total</td>
              <td className="chiffres px-3 py-3 text-right">{nombre(totalSms.sms)}</td>
              <td className="chiffres px-3 py-3 text-right">{nombre(totalSms.segments)}</td>
              <td className="chiffres px-3 py-3 text-right">{nombre(totalSms.remis)}</td>
              <td className="chiffres py-3 pr-5 pl-3 text-right">{nombre(totalSms.echecs)}</td>
            </tr>
          </tbody>
        </table>
        <p className="border-t border-trait px-5 py-3 text-sm text-encre-3">
          Un long SMS, ou un SMS avec certains accents (ê, â, ô…), est découpé en plusieurs segments, chacun facturé, même si l'opérateur ne le remet pas.
          « Remis » : arrivés au téléphone d'après l'accusé de remise de la passerelle ; « Non remis » : refusés, abandonnés après 5 essais, ou non remis selon l'accusé.
        </p>
      </Panneau>

      {canaux && <FacturationCanaux f={canaux} surExporter={surExporterCanaux} />}
      {ia && <ConsommationIa ia={ia} surExporter={surExporterIa} />}
      </div>
    </div>
  );
}

export function Alertes({
  alertes,
  maintenant,
  surLire,
  surToutLire,
  occupe,
}: {
  alertes: S<'PageNotifications'>;
  maintenant: string;
  /** Étape 8 : marquerNotificationPlateformeLue */
  surLire?: (n: S<'PageNotifications'>['donnees'][number]) => void;
  surToutLire?: () => void;
  occupe?: boolean;
}) {
  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">Alertes</h1>
          <p className="mt-1 text-[15px] text-encre-3">Réclamations urgentes et plafonds dépassés, dans toutes les banques.</p>
        </div>
        <Bouton onClick={surToutLire} disabled={occupe || alertes.nonLues === 0}>Tout marquer comme lu</Bouton>
      </div>
      <ul className="overflow-hidden rounded-xl border border-trait bg-surface">
        {alertes.donnees.length === 0 && <li className="px-5 py-10 text-center text-[15px] text-encre-3">Aucune alerte pour l'instant.</li>}
        {alertes.donnees.map((n) => (
          <li key={n.id} className={cx('flex gap-4 border-b border-trait px-5 py-4 last:border-0', !n.lueLe && 'bg-marque-doux/50')}>
            <span aria-hidden className={cx('mt-2 h-2.5 w-2.5 shrink-0 rounded-full', n.lueLe ? 'bg-trait-fort' : n.modele === 'plateforme.urgente' ? 'bg-urgent' : 'bg-alerte')} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-3">
                <p className="font-semibold">{n.sujet}</p>
                <p className="chiffres shrink-0 text-sm text-encre-3">{relatif(n.creeLe, maintenant)}</p>
              </div>
              <p className="chiffres mt-0.5 text-[15px] text-encre-2">{n.contenu}</p>
            </div>
            {surLire && !n.lueLe && (
              <button type="button" onClick={() => surLire(n)} disabled={occupe} className="shrink-0 self-center rounded-lg px-2.5 py-1.5 text-sm font-semibold text-marque-texte hover:bg-surface">
                Marquer comme lue
              </button>
            )}
          </li>
        ))}
      </ul>
      <p className="text-sm leading-relaxed text-encre-3">
        Une alerte urgente donne la banque, le numéro, la catégorie et l'heure. Le détail reste visible seulement par le personnel de la banque.
      </p>
    </div>
  );
}

const dollars = (n: number) => `${n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })} $`;

/**
 * Usage de l'IA : l'assistant (étape 18) et l'analyse du baromètre mensuel (étape 23) ; les banques qui
 * ont l'assistant, ou qui s'en sont servies ce mois-là.
 */
function ConsommationIa({ ia, surExporter }: { ia: S<'ConsommationIa'>; surExporter?: () => void }) {
  const lignes = ia.banques.filter((b) => b.assistantIa || b.tours + b.suggestions + b.barometres > 0);
  return (
    <Panneau
      titre={`Assistant IA et baromètre de ${nomMois(ia.mois)}`}
      sansMarge
      action={surExporter && <Bouton icone={<Download aria-hidden size={17} />} onClick={surExporter}>Exporter l'usage en CSV</Bouton>}
    >
      <table className="w-full text-left text-[15px]">
        <thead>
          <tr className="border-b border-trait text-[13px] text-encre-3">
            <th scope="col" className="py-2.5 pr-3 pl-5 font-semibold">Banque</th>
            <th scope="col" className="px-3 py-2.5 text-right font-semibold">Tours du portail</th>
            <th scope="col" className="px-3 py-2.5 text-right font-semibold">Brouillons</th>
            <th scope="col" className="px-3 py-2.5 text-right font-semibold">Baromètres</th>
            <th scope="col" className="px-3 py-2.5 text-right font-semibold">Par l'IA</th>
            <th scope="col" className="px-3 py-2.5 text-right font-semibold">Par les règles</th>
            <th scope="col" className="px-3 py-2.5 text-right font-semibold">Jetons</th>
            <th scope="col" className="py-2.5 pr-5 pl-3 text-right font-semibold">Coût</th>
          </tr>
        </thead>
        <tbody>
          {lignes.length === 0 && (
            <tr><td colSpan={8} className="px-5 py-6 text-center text-encre-3">Aucune banque n'a utilisé l'IA ce mois-ci.</td></tr>
          )}
          {lignes.map((b) => (
            <tr key={b.banque.id} className="border-b border-trait last:border-0">
              <td className="py-3 pr-3 pl-5 font-semibold">
                {b.banque.nom}
                {!b.assistantIa && (
                  <span className="ml-2 text-sm font-normal text-encre-3">{b.tours + b.suggestions > 0 ? '(assistant fermé depuis)' : '(sans assistant)'}</span>
                )}
              </td>
              <td className="chiffres px-3 py-3 text-right">{nombre(b.tours)}</td>
              <td className="chiffres px-3 py-3 text-right">{nombre(b.suggestions)}</td>
              <td className="chiffres px-3 py-3 text-right">{nombre(b.barometres)}</td>
              <td className="chiffres px-3 py-3 text-right">{nombre(b.parIa)}</td>
              <td className="chiffres px-3 py-3 text-right text-encre-2">{nombre(b.regles)}</td>
              <td className="chiffres px-3 py-3 text-right text-encre-2">{nombre(b.jetonsEntree + b.jetonsSortie)}</td>
              <td className="chiffres py-3 pr-5 pl-3 text-right font-semibold">{dollars(b.coutUsd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="border-t border-trait px-5 py-3 text-sm text-encre-3">
        Fournisseur configuré : {ia.fournisseur.nom === 'regles' ? 'aucun (règles seules, rien n\'est envoyé)' : `${ia.fournisseur.nom}${ia.fournisseur.modele ? `, ${ia.fournisseur.modele}` : ''}`}.
        {' '}« Par les règles » : sans fournisseur, plafond du jour atteint, délai dépassé ou réponse hors format ; pour le baromètre, aussi sans l'assistant (pas d'accord de la banque pour l'IA). Le journal ne garde aucun message, seulement les volumes.
      </p>
    </Panneau>
  );
}

/** WhatsApp et SMS reçus (étape 20) : les banques qui ont eu du trafic ce mois-là. */
function FacturationCanaux({ f, surExporter }: { f: S<'FacturationCanaux'>; surExporter?: () => void }) {
  const lignes = f.banques.filter((b) => b.whatsappEnvoyes + b.whatsappRecus + b.whatsappEchecs + b.smsRecus > 0);
  const total = lignes.reduce((t, b) => ({
    envoyes: t.envoyes + b.whatsappEnvoyes, factures: t.factures + b.whatsappFactures, echecs: t.echecs + b.whatsappEchecs,
    recus: t.recus + b.whatsappRecus, sms: t.sms + b.smsRecus,
  }), { envoyes: 0, factures: 0, echecs: 0, recus: 0, sms: 0 });
  return (
    <Panneau
      titre={`WhatsApp et SMS reçus de ${nomMois(f.mois)}`}
      sansMarge
      action={surExporter && <Bouton icone={<Download aria-hidden size={17} />} onClick={surExporter}>Exporter les messages en CSV</Bouton>}
    >
      <table className="w-full text-left text-[15px]" data-testid="facturation-canaux">
        <thead>
          <tr className="border-b border-trait text-[13px] text-encre-3">
            <th scope="col" className="py-2.5 pr-3 pl-5 font-semibold">Banque</th>
            <th scope="col" className="px-3 py-2.5 text-right font-semibold"><span className="inline-flex items-center gap-1"><IconeCanal canal="WHATSAPP" taille={13} />WhatsApp envoyés</span></th>
            <th scope="col" className="px-3 py-2.5 text-right font-semibold">dont facturés par Meta</th>
            <th scope="col" className="px-3 py-2.5 text-right font-semibold">Échecs</th>
            <th scope="col" className="px-3 py-2.5 text-right font-semibold">WhatsApp reçus</th>
            <th scope="col" className="py-2.5 pr-5 pl-3 text-right font-semibold"><span className="inline-flex items-center gap-1"><IconeCanal canal="SMS" taille={13} />SMS reçus</span></th>
          </tr>
        </thead>
        <tbody>
          {lignes.length === 0 && (
            <tr><td colSpan={6} className="px-5 py-6 text-center text-encre-3">Aucun message WhatsApp ni SMS reçu ce mois-ci.</td></tr>
          )}
          {lignes.map((b) => (
            <tr key={b.banque.id} className="border-b border-trait">
              <td className="py-3 pr-3 pl-5 font-semibold">{b.banque.nom}</td>
              <td className="chiffres px-3 py-3 text-right">{nombre(b.whatsappEnvoyes)}</td>
              <td className="chiffres px-3 py-3 text-right font-semibold">{nombre(b.whatsappFactures)}</td>
              <td className="chiffres px-3 py-3 text-right text-encre-2">{nombre(b.whatsappEchecs)}</td>
              <td className="chiffres px-3 py-3 text-right">{nombre(b.whatsappRecus)}</td>
              <td className="chiffres py-3 pr-5 pl-3 text-right">{nombre(b.smsRecus)}</td>
            </tr>
          ))}
          {lignes.length > 1 && (
            <tr className="bg-fond/70 font-bold">
              <td className="py-3 pr-3 pl-5">Total</td>
              <td className="chiffres px-3 py-3 text-right">{nombre(total.envoyes)}</td>
              <td className="chiffres px-3 py-3 text-right">{nombre(total.factures)}</td>
              <td className="chiffres px-3 py-3 text-right">{nombre(total.echecs)}</td>
              <td className="chiffres px-3 py-3 text-right">{nombre(total.recus)}</td>
              <td className="chiffres py-3 pr-5 pl-3 text-right">{nombre(total.sms)}</td>
            </tr>
          )}
        </tbody>
      </table>
      <p className="border-t border-trait px-5 py-3 text-sm text-encre-3">
        Facturés : messages que Meta déclare payants, au-delà de ses gratuités, au tarif du pays du client. Les réponses par SMS d'une conversation sont comptées avec les SMS envoyés, ci-dessus. Ni numéro ni texte ne quitte la banque.
      </p>
    </Panneau>
  );
}
