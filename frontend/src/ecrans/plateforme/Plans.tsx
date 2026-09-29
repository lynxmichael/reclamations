/**
 * Plans commerciaux (listerPlans, creerPlan, modifierPlan) : plafonds d'agents et de réclamations
 * par mois. Le contenu des offres reste à fixer (point ouvert) ; un plafond dépassé alerte le
 * Super Admin sans bloquer la banque.
 */
import { useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import type { S } from '../../api/types';
import { Dialogue } from '../../ui/Dialogue';
import { Bouton, Champ, Saisie, Texte, cx } from '../../ui/composants';
import { nombre } from '../../ui/format';

type Issue = void | boolean | Promise<boolean>;

export interface ActionsPlans {
  creer: (v: S<'EcriturePlan'>) => Issue;
  modifier: (id: string, v: S<'ModificationPlan'>) => Issue;
  occupe?: boolean;
  erreurs?: Record<string, string>;
}

const entier = (v: string) => (v.trim() === '' ? null : Number(v));

function FenetrePlan({ plan, actions, surFermer }: { plan: S<'Plan'> | null; actions: ActionsPlans; surFermer: () => void }) {
  const [code, setCode] = useState(plan?.code ?? '');
  const [nom, setNom] = useState(plan?.nom ?? '');
  const [description, setDescription] = useState(plan?.description ?? '');
  const [agents, setAgents] = useState(plan?.plafondAgents?.toString() ?? '');
  const [tickets, setTickets] = useState(plan?.plafondTicketsMois?.toString() ?? '');
  const [actif, setActif] = useState(plan?.actif ?? true);
  const e = actions.erreurs ?? {};
  const valide = nom.trim().length >= 2 && (plan || /^[A-Z0-9_]{2,40}$/.test(code)) && (agents === '' || Number(agents) >= 1) && (tickets === '' || Number(tickets) >= 1);
  const enregistrer = async () => {
    const commun = { nom: nom.trim(), description: description.trim() || null, plafondAgents: entier(agents), plafondTicketsMois: entier(tickets) };
    const issue = await (plan ? actions.modifier(plan.id, { ...commun, actif }) : actions.creer({ code, ...commun }));
    if (issue !== false) surFermer();
  };
  return (
    <Dialogue
      titre={plan ? `Plan ${plan.nom}` : 'Nouveau plan'}
      surFermer={surFermer}
      pied={
        <>
          <Bouton variante="discret" onClick={surFermer}>Annuler</Bouton>
          <Bouton variante="principal" disabled={!valide || actions.occupe} onClick={() => void enregistrer()}>{plan ? 'Enregistrer' : 'Créer le plan'}</Bouton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-[160px_minmax(0,1fr)] gap-3">
          <Champ libelle="Code" aide={plan ? 'Ne change pas' : 'Ex. PRO'} erreur={e.code}>
            {(id, d) => <Saisie id={id} aria-describedby={d} value={code} disabled={!!plan} onChange={(x) => setCode(x.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''))} className="chiffres uppercase" invalide={!!e.code} />}
          </Champ>
          <Champ libelle="Nom" erreur={e.nom}>{(id) => <Saisie id={id} value={nom} onChange={(x) => setNom(x.target.value)} maxLength={120} />}</Champ>
        </div>
        <Champ libelle="Description" facultatif>{(id) => <Texte id={id} rows={2} className="min-h-0" value={description} onChange={(x) => setDescription(x.target.value)} />}</Champ>
        <div className="grid grid-cols-2 gap-3">
          <Champ libelle="Agents et superviseurs" aide="Vide : sans plafond" erreur={e.plafondAgents}>
            {(id, d) => <Saisie id={id} aria-describedby={d} inputMode="numeric" value={agents} onChange={(x) => setAgents(x.target.value.replace(/\D/g, ''))} className="chiffres" />}
          </Champ>
          <Champ libelle="Réclamations par mois" aide="Vide : sans plafond" erreur={e.plafondTicketsMois}>
            {(id, d) => <Saisie id={id} aria-describedby={d} inputMode="numeric" value={tickets} onChange={(x) => setTickets(x.target.value.replace(/\D/g, ''))} className="chiffres" />}
          </Champ>
        </div>
        {plan && (
          <label className="flex items-start gap-2.5 text-[15px]">
            <input type="checkbox" checked={actif} onChange={(x) => setActif(x.target.checked)} className="mt-1 h-4 w-4 accent-[var(--marque)]" />
            <span>
              Proposé aux nouvelles banques
              <span className="block text-sm text-encre-3">Retiré, il reste attribué aux banques qui l'ont déjà.</span>
            </span>
          </label>
        )}
      </div>
    </Dialogue>
  );
}

export function Plans({ plans, actions }: { plans: S<'Plan'>[]; actions?: ActionsPlans }) {
  const [fenetre, setFenetre] = useState<{ plan: S<'Plan'> | null } | null>(null);
  return (
    <div className="flex max-w-4xl flex-col gap-5">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">Plans</h1>
          <p className="mt-1 text-[15px] text-encre-3">Les offres attribuées aux banques. Un plafond dépassé déclenche une alerte, sans couper le service.</p>
        </div>
        <Bouton variante="principal" icone={<Plus aria-hidden size={17} />} onClick={() => setFenetre({ plan: null })}>Nouveau plan</Bouton>
      </div>
      <div className="overflow-hidden rounded-xl border border-trait bg-surface">
        <table className="w-full text-left text-[15px]">
          <thead>
            <tr className="border-b border-trait text-[13px] text-encre-3">
              <th scope="col" className="py-2.5 pr-3 pl-5 font-semibold">Plan</th>
              <th scope="col" className="px-3 py-2.5 font-semibold">Agents</th>
              <th scope="col" className="px-3 py-2.5 font-semibold">Réclamations par mois</th>
              <th scope="col" className="px-3 py-2.5 font-semibold">État</th>
              <th scope="col" className="py-2.5 pr-5"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {plans.map((p) => (
              <tr key={p.id} className={cx('border-b border-trait align-top last:border-0', !p.actif && 'text-encre-3')}>
                <td className="py-3 pr-3 pl-5">
                  <div className="font-semibold">{p.nom} <span className="chiffres ml-1 text-sm font-normal text-encre-3">{p.code}</span></div>
                  {p.description && <div className="mt-0.5 text-sm text-encre-3">{p.description}</div>}
                </td>
                <td className="chiffres px-3 py-3">{p.plafondAgents === null ? 'Sans plafond' : nombre(p.plafondAgents)}</td>
                <td className="chiffres px-3 py-3">{p.plafondTicketsMois === null ? 'Sans plafond' : nombre(p.plafondTicketsMois)}</td>
                <td className="px-3 py-3">
                  <span className={cx('inline-flex rounded-md px-2 py-0.5 text-[13px] font-semibold', p.actif ? 'bg-resolue-doux text-resolue' : 'bg-cloturee-doux text-cloturee')}>{p.actif ? 'Proposé' : 'Retiré'}</span>
                </td>
                <td className="py-3 pr-5 text-right">
                  <Bouton taille="petit" variante="discret" aria-label={`Modifier le plan ${p.nom}`} icone={<Pencil aria-hidden size={15} />} onClick={() => setFenetre({ plan: p })} />
                </td>
              </tr>
            ))}
            {plans.length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-10 text-center text-encre-3">Aucun plan : créez-en un avant la première banque.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {actions && fenetre && <FenetrePlan plan={fenetre.plan} actions={actions} surFermer={() => setFenetre(null)} />}
    </div>
  );
}
