/**
 * Super Admins de Makor Telecoms (listerSuperAdmins, inviterSuperAdmin). Le premier est créé par
 * le script d'installation ; les suivants sont invités ici et reçoivent un lien par e-mail.
 */
import { useState } from 'react';
import { ShieldCheck, ShieldOff, UserPlus } from 'lucide-react';
import type { S } from '../../api/types';
import { Dialogue } from '../../ui/Dialogue';
import { Avatar, Bouton, Champ, Saisie, cx } from '../../ui/composants';
import { relatif } from '../../ui/format';
import { STATUT_UTILISATEUR } from '../../ui/libelles';

type Issue = void | boolean | Promise<boolean>;

export interface ActionsAdministrateurs {
  inviter: (v: S<'IdentitePersonne'>) => Issue;
  occupe?: boolean;
  erreurs?: Record<string, string>;
}

function FenetreInvitation({ actions, surFermer }: { actions: ActionsAdministrateurs; surFermer: () => void }) {
  const [prenom, setPrenom] = useState('');
  const [nom, setNom] = useState('');
  const [email, setEmail] = useState('');
  const e = actions.erreurs ?? {};
  const valide = prenom.trim() && nom.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const inviter = async () => {
    if ((await actions.inviter({ prenom: prenom.trim(), nom: nom.trim(), email: email.trim().toLowerCase(), telephone: null })) !== false) surFermer();
  };
  return (
    <Dialogue
      titre="Inviter un Super Admin"
      description="Il voit toutes les banques et leurs métadonnées, jamais le contenu d'une réclamation ni les coordonnées d'un client."
      surFermer={surFermer}
      pied={
        <>
          <Bouton variante="discret" onClick={surFermer}>Annuler</Bouton>
          <Bouton variante="principal" disabled={!valide || actions.occupe} onClick={() => void inviter()}>Envoyer l'invitation</Bouton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Champ libelle="Prénom">{(id) => <Saisie id={id} value={prenom} onChange={(x) => setPrenom(x.target.value)} />}</Champ>
          <Champ libelle="Nom">{(id) => <Saisie id={id} value={nom} onChange={(x) => setNom(x.target.value)} />}</Champ>
        </div>
        <Champ libelle="E-mail professionnel" erreur={e.email}>{(id) => <Saisie id={id} type="email" value={email} onChange={(x) => setEmail(x.target.value)} invalide={!!e.email} />}</Champ>
      </div>
    </Dialogue>
  );
}

export function Administrateurs({ administrateurs, maintenant, actions }: { administrateurs: S<'Utilisateur'>[]; maintenant: string; actions?: ActionsAdministrateurs }) {
  const [invitation, setInvitation] = useState(false);
  return (
    <div className="flex max-w-4xl flex-col gap-5">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">Super Admins</h1>
          <p className="mt-1 text-[15px] text-encre-3">L'équipe Makor Telecoms qui administre la plateforme.</p>
        </div>
        <Bouton variante="principal" icone={<UserPlus aria-hidden size={17} />} onClick={() => setInvitation(true)}>Inviter</Bouton>
      </div>
      <ul className="overflow-hidden rounded-xl border border-trait bg-surface">
        {administrateurs.map((u) => (
          <li key={u.id} className="flex items-center gap-4 border-b border-trait px-5 py-3.5 last:border-0">
            <Avatar nom={`${u.prenom} ${u.nom}`} taille={36} />
            <div className="min-w-0 flex-1 leading-snug">
              <div className="font-semibold">{u.prenom} {u.nom}</div>
              <div className="text-sm text-encre-3">{u.email}</div>
            </div>
            <div className="text-right text-sm">
              <span className={cx('inline-flex rounded-md px-2 py-0.5 text-[13px] font-semibold', u.statut === 'ACTIF' ? 'bg-resolue-doux text-resolue' : u.statut === 'INVITE' ? 'bg-ouverte-doux text-ouverte' : 'bg-cloturee-doux text-cloturee')}>
                {STATUT_UTILISATEUR[u.statut]}
              </span>
              <div className="mt-1 flex items-center justify-end gap-1.5 text-encre-3">
                {u.totpActif ? <ShieldCheck aria-hidden size={14} className="text-resolue" /> : <ShieldOff aria-hidden size={14} />}
                {u.derniereConnexionLe ? `Connecté ${relatif(u.derniereConnexionLe, maintenant)}` : 'Jamais connecté'}
              </div>
            </div>
          </li>
        ))}
      </ul>
      {actions && invitation && <FenetreInvitation actions={actions} surFermer={() => setInvitation(false)} />}
    </div>
  );
}
