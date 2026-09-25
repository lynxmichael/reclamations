/**
 * Activité de toutes les banques (lireIndicateursPlateforme) et facturation des SMS du mois
 * (lireFacturationSms). Métadonnées seulement : volumes, taux, compteurs.
 */
import { CalendarDays, ChevronDown } from 'lucide-react';
import type { S } from '../../api/types';
import { Bouton, Panneau, cx } from '../../ui/composants';
import { nombre, pourcent, relatif } from '../../ui/format';

const COULEURS = ['bg-ouverte', 'bg-en-cours', 'bg-attente', 'bg-resolue', 'bg-cloturee/45'];

export function Activite({ indicateurs, sms }: { indicateurs: S<'IndicateursPlateforme'>; sms: S<'FacturationSms'> }) {
  const totalSms = sms.banques.reduce((s, b) => ({ sms: s.sms + b.sms, segments: s.segments + b.segments, echecs: s.echecs + b.echecs }), { sms: 0, segments: 0, echecs: 0 });
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">Activité et SMS</h1>
          <p className="mt-1 text-[15px] text-encre-3">Volumes et taux par banque. Le contenu des réclamations reste dans chaque banque.</p>
        </div>
        <button type="button" className="inline-flex h-10 items-center gap-2 rounded-lg border border-trait-fort bg-surface px-3.5 text-[15px] font-semibold">
          <CalendarDays aria-hidden size={17} className="text-encre-3" />
          Septembre 2026
          <ChevronDown aria-hidden size={16} className="text-encre-3" />
        </button>
      </div>

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
          {indicateurs.banques[0]!.parStatut.map((v, i) => (
            <li key={v.cle} className="flex items-center gap-2">
              <span aria-hidden className={cx('h-2.5 w-2.5 rounded-sm', COULEURS[i])} />
              {v.libelle}
            </li>
          ))}
        </ul>
      </Panneau>

      <Panneau titre={`SMS de ${sms.mois === '2026-09' ? 'septembre 2026' : sms.mois}`} sansMarge>
        <table className="w-full text-left text-[15px]">
          <thead>
            <tr className="border-b border-trait text-[13px] text-encre-3">
              <th scope="col" className="py-2.5 pr-3 pl-5 font-semibold">Banque</th>
              <th scope="col" className="px-3 py-2.5 text-right font-semibold">SMS envoyés</th>
              <th scope="col" className="px-3 py-2.5 text-right font-semibold">Segments facturés</th>
              <th scope="col" className="py-2.5 pr-5 pl-3 text-right font-semibold">Échecs</th>
            </tr>
          </thead>
          <tbody>
            {sms.banques.map((b) => (
              <tr key={b.banque.id} className="border-b border-trait">
                <td className="py-3 pr-3 pl-5 font-semibold">{b.banque.nom}</td>
                <td className="chiffres px-3 py-3 text-right">{nombre(b.sms)}</td>
                <td className="chiffres px-3 py-3 text-right font-semibold">{nombre(b.segments)}</td>
                <td className="chiffres py-3 pr-5 pl-3 text-right text-encre-2">{nombre(b.echecs)}</td>
              </tr>
            ))}
            <tr className="bg-fond/70 font-bold">
              <td className="py-3 pr-3 pl-5">Total</td>
              <td className="chiffres px-3 py-3 text-right">{nombre(totalSms.sms)}</td>
              <td className="chiffres px-3 py-3 text-right">{nombre(totalSms.segments)}</td>
              <td className="chiffres py-3 pr-5 pl-3 text-right">{nombre(totalSms.echecs)}</td>
            </tr>
          </tbody>
        </table>
        <p className="border-t border-trait px-5 py-3 text-sm text-encre-3">Un long SMS, ou un SMS avec certains accents (ê, â, ô…), est découpé en plusieurs segments, chacun facturé.</p>
      </Panneau>
    </div>
  );
}

export function Alertes({ alertes, maintenant }: { alertes: S<'PageNotifications'>; maintenant: string }) {
  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">Alertes</h1>
          <p className="mt-1 text-[15px] text-encre-3">Réclamations urgentes et plafonds dépassés, dans toutes les banques.</p>
        </div>
        <Bouton>Tout marquer comme lu</Bouton>
      </div>
      <ul className="overflow-hidden rounded-xl border border-trait bg-surface">
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
          </li>
        ))}
      </ul>
      <p className="text-sm leading-relaxed text-encre-3">
        Une alerte urgente donne la banque, le numéro, la catégorie et l'heure. Le détail reste visible seulement par le personnel de la banque.
      </p>
    </div>
  );
}
