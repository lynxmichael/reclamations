/**
 * Absences des agents (étape 16, phase 2) : listerAbsences, ajouterAbsence, supprimerAbsence.
 * Un agent absent ne reçoit pas de réclamation ces jours-là, en attribution automatique ou
 * suggérée. Le superviseur et l'Admin Entreprise les déclarent ; le motif ne regarde pas l'outil.
 */
import { useState } from 'react';
import { CalendarOff, Trash2 } from 'lucide-react';
import type { S } from '../../api/types';
import { Avatar, Bouton, Champ, Liste, Panneau, Saisie, cx } from '../../ui/composants';
import { date } from '../../ui/format';

type Issue = void | boolean | Promise<boolean>;

export interface ActionsAbsences {
  ajouter: (v: S<'NouvelleAbsence'>) => Issue;
  supprimer: (a: S<'Absence'>) => Issue;
  occupe?: boolean;
  erreurs?: Record<string, string>;
}

const jourLisible = (jour: string) => date(`${jour}T12:00:00Z`);
/** « vendredi 2 octobre », sous le champ : le format du sélecteur de date dépend du navigateur */
const EN_CLAIR = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const jourEnClair = (jour: string) => (/^\d{4}-\d{2}-\d{2}$/.test(jour) ? EN_CLAIR.format(new Date(`${jour}T12:00:00Z`)) : undefined);
/** Nombre de jours, bornes incluses (dates AAAA-MM-JJ). */
const jours = (du: string, au: string) => Math.round((Date.parse(`${au}T00:00:00Z`) - Date.parse(`${du}T00:00:00Z`)) / 86_400_000) + 1;

export function Absences({
  absences,
  agents,
  aujourdhui,
  actions,
  lectureSeule,
}: {
  absences: S<'Absence'>[];
  /** Agents de la banque, pour le choix (rôle Agent, compte non désactivé) */
  agents: S<'ReferenceNommee'>[];
  /** AAAA-MM-JJ dans le fuseau de la banque */
  aujourdhui: string;
  actions?: ActionsAbsences;
  /** Sans formulaire de déclaration (maquettes : vue d'un rôle qui ne déclare pas) */
  lectureSeule?: boolean;
}) {
  const [agentId, setAgentId] = useState('');
  const [du, setDu] = useState(aujourdhui);
  const [au, setAu] = useState(aujourdhui);
  const e = actions?.erreurs ?? {};
  const incoherent = !!du && !!au && au < du;
  const declarer = async () => {
    if ((await actions?.ajouter({ agentId, du, au })) !== false) {
      setAgentId('');
      setDu(aujourdhui);
      setAu(aujourdhui);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-[26px] font-bold tracking-tight">Absences</h1>
        <p className="mt-1 max-w-[80ch] text-[15px] text-encre-3">
          Un agent absent ne reçoit aucune nouvelle réclamation ces jours-là. Celles qu'il traite déjà restent les siennes : réassignez-les depuis leur fiche si besoin.
        </p>
      </div>

      {(actions || !lectureSeule) && (
        <Panneau titre="Déclarer une absence">
          <div className="flex flex-wrap items-start gap-3">
            <Champ libelle="Agent" erreur={e.agentId} className="w-[260px]">
              {(id) => (
                <Liste id={id} value={agentId} onChange={(x) => setAgentId(x.target.value)}>
                  <option value="">Choisir un agent</option>
                  {agents.map((a) => <option key={a.id} value={a.id}>{a.nom}</option>)}
                </Liste>
              )}
            </Champ>
            <Champ libelle="Premier jour" erreur={e.du} aide={du ? jourEnClair(du) : undefined} className="w-[180px]">
              {(id) => <Saisie id={id} type="date" value={du} min={aujourdhui} onChange={(x) => { setDu(x.target.value); if (au < x.target.value) setAu(x.target.value); }} invalide={!!e.du} />}
            </Champ>
            <Champ libelle="Dernier jour" erreur={e.au} aide={au ? jourEnClair(au) : undefined} className="w-[180px]">
              {(id) => <Saisie id={id} type="date" value={au} min={du || aujourdhui} onChange={(x) => setAu(x.target.value)} invalide={!!e.au || incoherent} />}
            </Champ>
            <Bouton variante="principal" className="mt-[29px] h-11" disabled={!!actions && (!agentId || !du || !au || incoherent || actions.occupe)} onClick={() => void declarer()}>
              Déclarer l'absence
            </Bouton>
          </div>
          {incoherent && <p className="mt-2 text-sm font-semibold text-urgent">Le dernier jour précède le premier.</p>}
        </Panneau>
      )}

      <Panneau titre="En cours et à venir" sansMarge>
        {absences.length === 0 ? (
          <p className="flex items-center gap-2.5 px-5 py-8 text-[15px] text-encre-3">
            <CalendarOff aria-hidden size={18} />
            Aucune absence déclarée : tous les agents des groupes peuvent recevoir des réclamations.
          </p>
        ) : (
          <table className="w-full text-left text-[15px]">
            <thead>
              <tr className="border-b border-trait text-[13px] text-encre-3">
                <th scope="col" className="py-2.5 pr-3 pl-5 font-semibold">Agent</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Du</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Au</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Durée</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">État</th>
                <th scope="col" className="py-2.5 pr-5 pl-3"><span className="sr-only">Retirer</span></th>
              </tr>
            </thead>
            <tbody>
              {absences.map((a) => {
                const enCours = a.du <= aujourdhui;
                return (
                  <tr key={a.id} className="border-b border-trait last:border-0">
                    <th scope="row" className="py-2.5 pr-3 pl-5 font-normal">
                      <span className="inline-flex items-center gap-2.5"><Avatar nom={a.agent.nom} taille={26} />{a.agent.nom}</span>
                    </th>
                    <td className="chiffres px-3 py-2.5">{jourLisible(a.du)}</td>
                    <td className="chiffres px-3 py-2.5">{jourLisible(a.au)}</td>
                    <td className="chiffres px-3 py-2.5 text-encre-2">{jours(a.du, a.au)} jour{jours(a.du, a.au) > 1 ? 's' : ''}</td>
                    <td className="px-3 py-2.5">
                      <span className={cx('rounded-md px-2 py-0.5 text-[13px] font-semibold', enCours ? 'bg-alerte-doux text-alerte' : 'bg-fond text-encre-2')}>
                        {enCours ? 'En cours' : 'À venir'}
                      </span>
                    </td>
                    <td className="py-2.5 pr-5 pl-3 text-right">
                      {!lectureSeule && (
                        <button
                          type="button"
                          aria-label={`Retirer l'absence de ${a.agent.nom} du ${jourLisible(a.du)}`}
                          disabled={actions?.occupe}
                          onClick={() => void actions?.supprimer(a)}
                          className="rounded p-1.5 text-encre-3 hover:bg-fond hover:text-urgent"
                        >
                          <Trash2 size={16} />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Panneau>
    </div>
  );
}
