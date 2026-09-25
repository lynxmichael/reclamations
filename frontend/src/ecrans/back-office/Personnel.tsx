/**
 * Personnel de la banque (listerUtilisateurs, inviterUtilisateur, modifierUtilisateur,
 * desactiverUtilisateur, renvoyerInvitation, reinitialiserTotp). Le superviseur consulte ;
 * l'Admin Entreprise invite et modifie. Le plan limite les agents et superviseurs actifs.
 */
import { Ellipsis, LockKeyhole, ShieldCheck, ShieldOff, UserPlus } from 'lucide-react';
import type { S } from '../../api/types';
import { Avatar, Bouton, cx } from '../../ui/composants';
import { heure, relatif } from '../../ui/format';
import { ROLE, STATUT_UTILISATEUR } from '../../ui/libelles';

export function Personnel({
  page,
  plan,
  consommation,
  modifiable,
  maintenant,
}: {
  page: S<'PageUtilisateurs'>;
  plan: S<'ParametresBanque'>['plan'];
  consommation: S<'ParametresBanque'>['consommation'];
  modifiable: boolean;
  maintenant: string;
}) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">Personnel</h1>
          <p className="chiffres mt-1 text-[15px] text-encre-3">
            {consommation.agents} agents et superviseurs actifs ou invités
            {plan.plafondAgents !== null && ` sur ${plan.plafondAgents} prévus par le plan ${plan.nom}`}.
          </p>
        </div>
        {modifiable && <Bouton variante="principal" icone={<UserPlus aria-hidden size={17} />}>Inviter une personne</Bouton>}
      </div>

      <div className="overflow-hidden rounded-xl border border-trait bg-surface">
        <table className="w-full text-left text-[15px]">
          <thead>
            <tr className="border-b border-trait text-[13px] text-encre-3">
              <th scope="col" className="py-2.5 pr-3 pl-5 font-semibold">Personne</th>
              <th scope="col" className="px-3 py-2.5 font-semibold">Rôle</th>
              <th scope="col" className="px-3 py-2.5 font-semibold">Superviseur</th>
              <th scope="col" className="px-3 py-2.5 font-semibold">Dernière connexion</th>
              <th scope="col" className="px-3 py-2.5 font-semibold">Compte</th>
              <th scope="col" className="py-2.5 pr-4"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {page.donnees.map((u) => {
              const nom = `${u.prenom} ${u.nom}`;
              const verrouille = u.verrouilleJusquA !== null && u.verrouilleJusquA > maintenant;
              return (
                <tr key={u.id} className={cx('border-b border-trait last:border-0', u.statut === 'DESACTIVE' && 'text-encre-3')}>
                  <td className="py-3 pr-3 pl-5">
                    <div className="flex items-center gap-3">
                      <Avatar nom={nom} taille={34} />
                      <div className="leading-snug">
                        <div className="font-semibold">{nom}</div>
                        <div className="text-sm whitespace-nowrap text-encre-3">{u.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap">{ROLE[u.role]}</td>
                  <td className="px-3 py-3 whitespace-nowrap text-encre-2">{u.superviseur?.nom ?? '—'}</td>
                  <td className="chiffres px-3 py-3 text-sm whitespace-nowrap text-encre-2">{u.derniereConnexionLe ? relatif(u.derniereConnexionLe, maintenant) : 'Jamais'}</td>
                  <td className="px-3 py-3">
                    {verrouille ? (
                      <span className="inline-flex items-center gap-1.5 rounded-md bg-urgent-doux px-2 py-0.5 text-[13px] font-semibold whitespace-nowrap text-urgent">
                        <LockKeyhole aria-hidden size={13} />
                        Verrouillé jusqu'à {heure(u.verrouilleJusquA!)}
                      </span>
                    ) : (
                      <span
                        className={cx(
                          'inline-flex rounded-md px-2 py-0.5 text-[13px] font-semibold whitespace-nowrap',
                          u.statut === 'ACTIF' ? 'bg-resolue-doux text-resolue' : u.statut === 'INVITE' ? 'bg-ouverte-doux text-ouverte' : 'bg-cloturee-doux text-cloturee',
                        )}
                      >
                        {STATUT_UTILISATEUR[u.statut]}
                      </span>
                    )}
                    <div className="mt-1 flex items-start gap-1.5 text-sm text-encre-3">
                      {u.totpActif ? <ShieldCheck aria-hidden size={14} className="mt-0.5 shrink-0 text-resolue" /> : <ShieldOff aria-hidden size={14} className="mt-0.5 shrink-0" />}
                      {u.totpActif ? 'Double authentification active' : 'Double authentification à activer'}
                    </div>
                  </td>
                  <td className="py-3 pr-4 text-right">
                    {modifiable && (
                      <button type="button" aria-label={`Actions pour ${nom}`} className="rounded-lg p-2 text-encre-3 hover:bg-fond hover:text-encre">
                        <Ellipsis size={18} />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {modifiable && (
        <p className="text-sm leading-relaxed text-encre-3">
          Menu d'actions : modifier le rôle ou l'équipe, renvoyer l'invitation, réinitialiser la double authentification (téléphone perdu), désactiver. Un compte désactivé libère une place du plan.
        </p>
      )}
    </div>
  );
}
