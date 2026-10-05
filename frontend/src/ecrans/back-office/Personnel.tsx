/**
 * Personnel de la banque (listerUtilisateurs, inviterUtilisateur, modifierUtilisateur,
 * desactiverUtilisateur, reactiverUtilisateur, renvoyerInvitation, reinitialiserTotp). Le
 * superviseur consulte ; l'Admin Entreprise invite et modifie. Le plan limite les agents et
 * superviseurs actifs.
 *
 * Étape 19 (modifierSecuriteBanque) : l'Admin Entreprise rend la double authentification
 * obligatoire pour tout le personnel, ou la laisse facultative ; il doit l'avoir activée lui-même.
 */
import { useState } from 'react';
import { Ellipsis, LockKeyhole, ShieldCheck, ShieldHalf, ShieldOff, UserPlus } from 'lucide-react';
import type { S } from '../../api/types';
import { Dialogue } from '../../ui/Dialogue';
import { MenuActions, type ChoixMenu } from '../../ui/Menu';
import { Avatar, Bouton, Champ, Liste, Saisie, cx } from '../../ui/composants';
import { heure, relatif } from '../../ui/format';
import { ROLE, STATUT_UTILISATEUR } from '../../ui/libelles';

type Issue = void | boolean | Promise<boolean>;
type RoleBanque = S<'RoleBanque'>;

export interface SaisiePersonne {
  prenom: string;
  nom: string;
  email: string;
  telephone: string | null;
  role: RoleBanque;
  superviseurId: string | null;
}

export interface ActionsPersonnel {
  inviter: (v: SaisiePersonne) => Issue;
  modifier: (id: string, v: Omit<SaisiePersonne, 'email'>) => Issue;
  desactiver: (u: S<'Utilisateur'>) => Issue;
  reactiver: (u: S<'Utilisateur'>) => Issue;
  renvoyerInvitation: (u: S<'Utilisateur'>) => void;
  reinitialiserTotp: (u: S<'Utilisateur'>) => Issue;
  /** Étape 19 : double authentification obligatoire ou facultative */
  changerDoubleAuthentification?: (obligatoire: boolean) => Issue;
  occupe?: boolean;
  erreurs?: Record<string, string>;
  /** L'utilisateur connecté : il ne peut pas se désactiver lui-même */
  moiId: string;
}

const ROLES: RoleBanque[] = ['AGENT', 'SUPERVISEUR', 'ADMIN_ENTREPRISE'];

function FenetrePersonne({ u, superviseurs, actions, surFermer, totpObligatoire }: {
  u: S<'Utilisateur'> | null; superviseurs: S<'ReferenceNommee'>[]; actions: ActionsPersonnel; surFermer: () => void; totpObligatoire: boolean;
}) {
  const [prenom, setPrenom] = useState(u?.prenom ?? '');
  const [nom, setNom] = useState(u?.nom ?? '');
  const [email, setEmail] = useState(u?.email ?? '');
  const [telephone, setTelephone] = useState(u?.telephone ?? '');
  const [role, setRole] = useState<RoleBanque>((u?.role as RoleBanque | undefined) ?? 'AGENT');
  const [superviseurId, setSuperviseurId] = useState(u?.superviseur?.id ?? '');
  const e = actions.erreurs ?? {};
  const valide = prenom.trim() && nom.trim() && (u || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()));
  const enregistrer = async () => {
    const v = { prenom: prenom.trim(), nom: nom.trim(), telephone: telephone.trim() || null, role, superviseurId: role === 'AGENT' ? superviseurId || null : null };
    const issue = await (u ? actions.modifier(u.id, v) : actions.inviter({ ...v, email: email.trim().toLowerCase() }));
    if (issue !== false) surFermer();
  };
  return (
    <Dialogue
      titre={u ? `Modifier ${u.prenom} ${u.nom}` : 'Inviter une personne'}
      description={!u && `Elle reçoit un e-mail pour choisir son mot de passe${totpObligatoire ? ' et activer la double authentification' : ''}. Le lien est valable 7 jours.`}
      surFermer={surFermer}
      pied={
        <>
          <Bouton variante="discret" onClick={surFermer}>Annuler</Bouton>
          <Bouton variante="principal" disabled={!valide || actions.occupe} onClick={() => void enregistrer()}>
            {u ? 'Enregistrer' : 'Envoyer l\'invitation'}
          </Bouton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Champ libelle="Prénom" erreur={e.prenom}>{(id) => <Saisie id={id} value={prenom} onChange={(x) => setPrenom(x.target.value)} maxLength={80} autoComplete="off" />}</Champ>
          <Champ libelle="Nom" erreur={e.nom}>{(id) => <Saisie id={id} value={nom} onChange={(x) => setNom(x.target.value)} maxLength={80} autoComplete="off" />}</Champ>
        </div>
        {!u && (
          <Champ libelle="E-mail professionnel" erreur={e.email}>
            {(id) => <Saisie id={id} type="email" value={email} onChange={(x) => setEmail(x.target.value)} autoComplete="off" invalide={!!e.email} />}
          </Champ>
        )}
        <Champ libelle="Téléphone" facultatif erreur={e.telephone}>{(id) => <Saisie id={id} type="tel" value={telephone} onChange={(x) => setTelephone(x.target.value)} invalide={!!e.telephone} />}</Champ>
        <fieldset>
          <legend className="text-[15px] font-semibold">Rôle</legend>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {ROLES.map((r) => (
              <label key={r} className={cx('flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2.5 text-[15px]', role === r ? 'border-marque bg-marque-doux font-semibold' : 'border-trait-fort')}>
                <input type="radio" name="role" checked={role === r} onChange={() => setRole(r)} className="h-4 w-4 accent-[var(--marque)]" />
                {ROLE[r]}
              </label>
            ))}
          </div>
          <p className="mt-1.5 text-sm text-encre-3">
            {role === 'AGENT' ? 'Traite les réclamations qui lui sont assignées.' : role === 'SUPERVISEUR' ? 'Répartit les réclamations, suit les délais, gère les QR codes.' : 'Paramètre la banque et son équipe ; consulte les réclamations sans les traiter.'}
          </p>
          {e.role && <p className="mt-1 text-sm font-semibold text-urgent">{e.role}</p>}
        </fieldset>
        {role === 'AGENT' && (
          <Champ libelle="Superviseur" facultatif aide="Il reçoit les escalades de cet agent." erreur={e.superviseurId}>
            {(id, d) => (
              <Liste id={id} aria-describedby={d} value={superviseurId} onChange={(x) => setSuperviseurId(x.target.value)}>
                <option value="">Aucun</option>
                {superviseurs.map((s) => (
                  <option key={s.id} value={s.id}>{s.nom}</option>
                ))}
              </Liste>
            )}
          </Champ>
        )}
      </div>
    </Dialogue>
  );
}

type Confirmation = { type: 'desactiver' | 'totp'; u: S<'Utilisateur'> } | { type: 'regle'; obligatoire: boolean };

/**
 * Étape 19 : la règle de double authentification de la banque, le nombre de comptes protégés et,
 * pour l'Admin Entreprise, le bouton qui la change (il doit l'avoir activée lui-même pour l'exiger).
 */
function RegleDoubleAuthentification({
  obligatoire, actifs, proteges, modifiable, moiActive, surChanger,
}: {
  obligatoire: boolean;
  actifs: number;
  proteges: number;
  modifiable: boolean;
  moiActive: boolean;
  surChanger?: (obligatoire: boolean) => void;
}) {
  return (
    <section aria-labelledby="regle-totp" className="flex items-start gap-4 rounded-xl border border-trait bg-surface px-5 py-4">
      <span className={cx('flex h-10 w-10 shrink-0 items-center justify-center rounded-full', obligatoire ? 'bg-resolue-doux text-resolue' : 'bg-marque-doux text-marque-texte')}>
        {obligatoire ? <ShieldCheck aria-hidden size={20} /> : <ShieldHalf aria-hidden size={20} />}
      </span>
      <div className="min-w-0 flex-1">
        <h2 id="regle-totp" className="text-[17px] font-bold">
          Double authentification : {obligatoire ? 'obligatoire' : 'facultative'}
        </h2>
        <p className="mt-0.5 text-[15px] leading-relaxed text-encre-2">
          {obligatoire
            ? 'Tout le personnel saisit un code de son application d\'authentification à chaque connexion. Qui ne l\'a pas encore activée le fait à sa prochaine connexion.'
            : 'Chacun l\'active depuis « Mon compte ». Qui l\'a activée saisit un code à chaque connexion ; les autres se connectent avec leur mot de passe.'}
        </p>
        <p className="chiffres mt-1 text-sm text-encre-3">{proteges} compte{proteges > 1 ? 's' : ''} sur {actifs} l'{proteges > 1 ? 'ont' : 'a'} activée.</p>
        {modifiable && !obligatoire && !moiActive && (
          <p className="mt-1 text-sm font-semibold text-encre-2">Pour l'exiger de tous, activez-la d'abord sur votre compte (Mon compte).</p>
        )}
      </div>
      {modifiable && surChanger && (
        <Bouton variante={obligatoire ? 'secondaire' : 'principal'} disabled={!obligatoire && !moiActive} onClick={() => surChanger(!obligatoire)}>
          {obligatoire ? 'Rendre facultative' : 'Rendre obligatoire'}
        </Bouton>
      )}
    </section>
  );
}

export function Personnel({
  page,
  plan,
  consommation,
  modifiable,
  maintenant,
  actions,
  superviseurs = [],
  totpObligatoire = false,
  moiTotpActif = true,
}: {
  page: S<'PageUtilisateurs'>;
  plan: S<'ParametresBanque'>['plan'];
  consommation: S<'ParametresBanque'>['consommation'];
  modifiable: boolean;
  maintenant: string;
  actions?: ActionsPersonnel;
  /** Superviseurs actifs, proposés comme responsables d'un agent */
  superviseurs?: S<'ReferenceNommee'>[];
  /** Étape 19 : règle de la banque, et si la personne connectée l'a activée sur son compte */
  totpObligatoire?: boolean;
  moiTotpActif?: boolean;
}) {
  const [fenetre, setFenetre] = useState<{ u: S<'Utilisateur'> | null } | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const edition = modifiable && !!actions;

  const choix = (u: S<'Utilisateur'>): ChoixMenu[] => {
    if (!actions) return [];
    const c: ChoixMenu[] = [];
    if (u.statut !== 'DESACTIVE') c.push({ libelle: 'Modifier le rôle ou l\'équipe', action: () => setFenetre({ u }) });
    if (u.statut === 'INVITE') c.push({ libelle: 'Renvoyer l\'invitation', action: () => actions.renvoyerInvitation(u) });
    if (u.statut === 'ACTIF' && u.totpActif) c.push({ libelle: 'Réinitialiser la double authentification', action: () => setConfirmation({ type: 'totp', u }) });
    if (u.statut !== 'DESACTIVE' && u.id !== actions.moiId) c.push({ libelle: 'Désactiver le compte', action: () => setConfirmation({ type: 'desactiver', u }), danger: true });
    if (u.statut === 'DESACTIVE') c.push({ libelle: 'Réactiver le compte', action: () => void actions.reactiver(u) });
    return c;
  };

  const enService = page.donnees.filter((u) => u.statut !== 'DESACTIVE');
  const sansTotp = enService.filter((u) => !u.totpActif).length;
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
        {modifiable && <Bouton variante="principal" icone={<UserPlus aria-hidden size={17} />} onClick={() => setFenetre({ u: null })}>Inviter une personne</Bouton>}
      </div>

      <RegleDoubleAuthentification
        obligatoire={totpObligatoire}
        actifs={enService.length}
        proteges={enService.length - sansTotp}
        modifiable={modifiable}
        moiActive={moiTotpActif}
        surChanger={edition && actions?.changerDoubleAuthentification ? (o) => setConfirmation({ type: 'regle', obligatoire: o }) : undefined}
      />

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
                      {u.totpActif ? 'Double authentification active' : totpObligatoire ? 'Double authentification à activer' : 'Sans double authentification'}
                    </div>
                  </td>
                  <td className="py-3 pr-4 text-right">
                    {edition ? (
                      <MenuActions libelle={`Actions pour ${nom}`} choix={choix(u)} />
                    ) : (
                      modifiable && (
                        <button type="button" aria-label={`Actions pour ${nom}`} className="rounded-lg p-2 text-encre-3 hover:bg-fond hover:text-encre">
                          <Ellipsis size={18} />
                        </button>
                      )
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

      {actions && fenetre && (
        <FenetrePersonne u={fenetre.u} superviseurs={superviseurs.filter((s) => s.id !== fenetre.u?.id)} actions={actions} totpObligatoire={totpObligatoire} surFermer={() => setFenetre(null)} />
      )}
      {actions && confirmation?.type === 'regle' && (
        <Dialogue
          titre={confirmation.obligatoire ? 'Exiger la double authentification\u00a0?' : 'Ne plus exiger la double authentification\u00a0?'}
          surFermer={() => setConfirmation(null)}
          pied={
            <>
              <Bouton variante="discret" onClick={() => setConfirmation(null)}>Annuler</Bouton>
              <Bouton
                variante="principal"
                disabled={actions.occupe}
                onClick={async () => {
                  const issue = await actions.changerDoubleAuthentification?.(confirmation.obligatoire);
                  if (issue !== false) setConfirmation(null);
                }}
              >
                {confirmation.obligatoire ? 'Rendre obligatoire' : 'Rendre facultative'}
              </Bouton>
            </>
          }
        >
          <p className="text-[15px] leading-relaxed text-encre-2">
            {confirmation.obligatoire
              ? sansTotp === 0
                ? 'Tout le personnel l\'a déjà activée : rien ne change pour personne, sauf qu\'elle ne pourra plus être désactivée.'
                : sansTotp === 1
                  ? 'Une personne ne l\'a pas activée : ses sessions ouvertes sont fermées maintenant, et elle l\'activera à sa prochaine connexion en scannant un QR code avec son téléphone.'
                  : `${sansTotp} personnes ne l'ont pas activée : leurs sessions ouvertes sont fermées maintenant, et elles l'activeront à leur prochaine connexion en scannant un QR code avec leur téléphone.`
              : 'Ceux qui l\'ont activée la gardent et peuvent la désactiver depuis « Mon compte ». Les autres se connecteront avec leur seul mot de passe.'}
          </p>
        </Dialogue>
      )}
      {actions && confirmation && confirmation.type !== 'regle' && (
        <Dialogue
          titre={confirmation.type === 'desactiver' ? `Désactiver ${confirmation.u.prenom} ${confirmation.u.nom} ?` : 'Réinitialiser la double authentification ?'}
          surFermer={() => setConfirmation(null)}
          pied={
            <>
              <Bouton variante="discret" onClick={() => setConfirmation(null)}>Annuler</Bouton>
              <Bouton
                variante={confirmation.type === 'desactiver' ? 'danger' : 'principal'}
                disabled={actions.occupe}
                onClick={async () => {
                  const issue = await (confirmation.type === 'desactiver' ? actions.desactiver(confirmation.u) : actions.reinitialiserTotp(confirmation.u));
                  if (issue !== false) setConfirmation(null);
                }}
              >
                {confirmation.type === 'desactiver' ? 'Désactiver' : 'Réinitialiser'}
              </Bouton>
            </>
          }
        >
          <p className="text-[15px] leading-relaxed text-encre-2">
            {confirmation.type === 'desactiver'
              ? 'Ses sessions sont fermées tout de suite et elle ne peut plus se connecter. Son historique reste dans les réclamations et le journal. Vous pourrez réactiver le compte.'
              : totpObligatoire
                ? `À sa prochaine connexion, ${confirmation.u.prenom} scannera un nouveau QR code avec son téléphone. Ses sessions ouvertes sont fermées.`
                : `${confirmation.u.prenom} se connectera avec son mot de passe et pourra réactiver la double authentification depuis « Mon compte ». Ses sessions ouvertes sont fermées.`}
          </p>
        </Dialogue>
      )}
    </div>
  );
}
