/**
 * Banques clientes (listerBanques, suspendreBanque, reactiverBanque) et création d'une banque
 * avec son premier Admin Entreprise en une seule opération (creerBanque, décision C13).
 */
import { CirclePause, Info, Plus, X } from 'lucide-react';
import type { S } from '../../api/types';
import { Bouton, Champ, LogoBanque, Saisie, cx } from '../../ui/composants';
import { date, nombre } from '../../ui/format';

function Conso({ valeur, plafond }: { valeur: number; plafond: number | null }) {
  const depasse = plafond !== null && valeur > plafond;
  return (
    <div className="w-36">
      <div className="chiffres text-[15px]">
        <span className={cx('font-bold', depasse && 'text-urgent')}>{nombre(valeur)}</span>
        <span className="text-encre-3"> / {plafond === null ? 'illimité' : nombre(plafond)}</span>
      </div>
      {plafond !== null && (
        <div className="mt-1 h-1.5 rounded-full bg-fond">
          <div className={cx('h-full rounded-full', depasse ? 'bg-urgent' : 'bg-marque/70')} style={{ width: `${Math.min(100, (valeur / plafond) * 100)}%` }} />
        </div>
      )}
    </div>
  );
}

export function Banques({ page, plans, creation }: { page: S<'PageBanques'>; plans: S<'Plan'>[]; creation?: boolean }) {
  const plan = (id: string) => plans.find((p) => p.id === id);
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">Banques</h1>
          <p className="mt-1 text-[15px] text-encre-3">{page.pagination.total} banques clientes. Consommation du mois en cours.</p>
        </div>
        <Bouton variante="principal" icone={<Plus aria-hidden size={17} />}>Nouvelle banque</Bouton>
      </div>

      <div className="overflow-hidden rounded-xl border border-trait bg-surface">
        <table className="w-full text-left text-[15px]">
          <thead>
            <tr className="border-b border-trait text-[13px] text-encre-3">
              <th scope="col" className="py-2.5 pr-3 pl-5 font-semibold">Banque</th>
              <th scope="col" className="px-3 py-2.5 font-semibold">Plan</th>
              <th scope="col" className="px-3 py-2.5 font-semibold">Agents</th>
              <th scope="col" className="px-3 py-2.5 font-semibold">Réclamations ce mois</th>
              <th scope="col" className="px-3 py-2.5 font-semibold">Réglages</th>
              <th scope="col" className="px-3 py-2.5 font-semibold">État</th>
              <th scope="col" className="py-2.5 pr-5"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {page.donnees.map((b) => {
              const p = plan(b.plan.id);
              return (
                <tr key={b.id} className="border-b border-trait align-top last:border-0">
                  <td className="py-3.5 pr-3 pl-5">
                    <div className="flex items-center gap-3">
                      <LogoBanque nom={b.nom} logoUrl={null} taille={34} />
                      <div className="leading-snug">
                        <div className="font-semibold">{b.nom}</div>
                        <div className="text-sm text-encre-3">{b.slug}.reclamations.example</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3.5">{b.plan.nom}</td>
                  <td className="px-3 py-3.5"><Conso valeur={b.consommation.agents} plafond={p?.plafondAgents ?? null} /></td>
                  <td className="px-3 py-3.5"><Conso valeur={b.consommation.ticketsCeMois} plafond={p?.plafondTicketsMois ?? null} /></td>
                  <td className="px-3 py-3.5 text-sm leading-relaxed text-encre-2">
                    <div>Préfixe <span className="chiffres font-semibold text-encre">{b.prefixeTickets}</span>, alerte à {b.seuilAlerteSlaPourcent} %</div>
                    <div>Clôture après {b.delaiClotureAutoJours} jours, SMS {b.smsChaqueChangementStatut ? 'à chaque étape' : 'au dépôt et à la résolution'}</div>
                  </td>
                  <td className="px-3 py-3.5">
                    {b.suspendueLe ? (
                      <div className="text-sm">
                        <span className="inline-flex items-center gap-1 rounded-md bg-alerte-doux px-2 py-0.5 text-[13px] font-semibold whitespace-nowrap text-alerte">
                          <CirclePause aria-hidden size={13} />
                          Suspendue le {date(b.suspendueLe).slice(0, 5)}
                        </span>
                        <p className="mt-1 max-w-44 text-encre-3">{b.motifSuspension}</p>
                      </div>
                    ) : (
                      <span className="inline-flex rounded-md bg-resolue-doux px-2 py-0.5 text-[13px] font-semibold text-resolue">Active</span>
                    )}
                  </td>
                  <td className="py-3.5 pr-5 text-right">
                    <Bouton taille="petit" variante="discret">Ouvrir</Bouton>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {creation && <NouvelleBanque plans={plans} />}
    </div>
  );
}

function NouvelleBanque({ plans }: { plans: S<'Plan'>[] }) {
  return (
    <div className="absolute inset-0 z-30 flex justify-end bg-encre/30">
      <aside role="dialog" aria-modal="true" aria-label="Nouvelle banque" className="flex h-full w-[520px] flex-col bg-surface shadow-[-16px_0_48px_rgb(23_33_43/0.18)]">
        <div className="flex items-center justify-between border-b border-trait px-6 py-4">
          <h2 className="text-xl font-bold">Nouvelle banque</h2>
          <button type="button" aria-label="Fermer" className="rounded p-1 text-encre-3 hover:bg-fond"><X size={20} /></button>
        </div>
        <form className="flex flex-1 flex-col gap-6 overflow-auto px-6 py-5" onSubmit={(e) => e.preventDefault()}>
          <fieldset className="flex flex-col gap-4">
            <legend className="mb-1 text-[17px] font-bold">La banque</legend>
            <Champ libelle="Nom">{(id) => <Saisie id={id} defaultValue="Banque Kora" />}</Champ>
            <div className="grid grid-cols-[minmax(0,1fr)_130px] gap-3">
              <Champ libelle="Adresse du portail" aide="kora.reclamations.example">
                {(id, d) => <Saisie id={id} aria-describedby={d} defaultValue="kora" />}
              </Champ>
              <Champ libelle="Préfixe" aide="KOR-2026-000001">
                {(id, d) => <Saisie id={id} aria-describedby={d} defaultValue="KOR" className="chiffres uppercase" />}
              </Champ>
            </div>
            <fieldset>
              <legend className="text-[15px] font-semibold">Plan</legend>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {plans.map((p, i) => (
                  <label key={p.id} className={cx('flex cursor-pointer flex-col gap-0.5 rounded-lg border px-3 py-2.5', i === 0 ? 'border-marque bg-marque-doux ring-1 ring-marque' : 'border-trait-fort')}>
                    <input type="radio" name="plan" defaultChecked={i === 0} className="sr-only" />
                    <span className="font-semibold">{p.nom}</span>
                    <span className="chiffres text-sm text-encre-3">{p.plafondAgents === null ? 'Sans plafond' : `${p.plafondAgents} agents, ${nombre(p.plafondTicketsMois ?? 0)} récl./mois`}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          </fieldset>

          <fieldset className="flex flex-col gap-4">
            <legend className="mb-1 text-[17px] font-bold">Son premier Admin Entreprise</legend>
            <div className="grid grid-cols-2 gap-3">
              <Champ libelle="Prénom">{(id) => <Saisie id={id} defaultValue="Nathalie" />}</Champ>
              <Champ libelle="Nom">{(id) => <Saisie id={id} defaultValue="Yéo" />}</Champ>
            </div>
            <Champ libelle="E-mail professionnel">{(id) => <Saisie id={id} type="email" defaultValue="nathalie.yeo@banque-kora.example" />}</Champ>
            <Champ libelle="Téléphone" facultatif>{(id) => <Saisie id={id} type="tel" />}</Champ>
          </fieldset>

          <p className="flex gap-2.5 rounded-lg bg-fond p-3 text-sm leading-relaxed text-encre-2">
            <Info aria-hidden size={17} className="mt-0.5 shrink-0 text-encre-3" />
            La banque démarre avec les horaires lun–ven 08:00–17:00, le fuseau d'Abidjan, une alerte à 75 % et la clôture automatique après 5 jours. L'Admin reçoit une invitation par e-mail pour choisir son mot de passe.
          </p>
        </form>
        <div className="flex justify-end gap-2 border-t border-trait px-6 py-4">
          <Bouton variante="discret">Annuler</Bouton>
          <Bouton variante="principal">Créer la banque et inviter l'Admin</Bouton>
        </div>
      </aside>
    </div>
  );
}
