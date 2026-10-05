/**
 * « Mon compte » (étape 19) : preparerTotp, confirmerTotp, desactiverTotp. Chacun voit son identité
 * et l'état de sa double authentification. Quand la banque la laisse facultative, il l'active en
 * scannant un QR code puis en saisissant un premier code, ou la désactive avec un code ; quand la
 * banque l'exige, elle reste active.
 */
import { useEffect, useState } from 'react';
import { KeyRound, ShieldCheck, ShieldOff, Smartphone } from 'lucide-react';
import type { S } from '../../api/types';
import { AlerteErreur, CleTotp, SaisieCode } from '../connexion/Connexion';
import { Avatar, Bouton, cx } from '../../ui/composants';
import { ROLE } from '../../ui/libelles';

type Issue = void | boolean | Promise<boolean>;

export interface ActionsCompte {
  /** Nouveau secret à scanner ; null si l'API a refusé */
  preparer: () => Promise<S<'EnrolementCompte'> | null> | S<'EnrolementCompte'> | null;
  confirmer: (code: string) => Issue;
  desactiver: (code: string) => Issue;
  occupe?: boolean;
  erreur?: S<'Probleme'> | null;
}

type Etape = { type: 'activation'; enrolement: S<'EnrolementCompte'> } | { type: 'desactivation' } | null;

function FormulaireCode({ libelle, bouton, danger, occupe, erreur, surValider, surAnnuler }: {
  libelle: string;
  bouton: string;
  danger?: boolean;
  occupe?: boolean;
  erreur?: S<'Probleme'> | null;
  surValider: (code: string) => void;
  surAnnuler: () => void;
}) {
  const [code, setCode] = useState('');
  useEffect(() => {
    if (erreur) setCode('');
  }, [erreur]);
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (code.length === 6) surValider(code);
      }}
    >
      <span className="text-[15px] font-semibold">{libelle}</span>
      <div className="max-w-[360px]">
        <SaisieCode valeur={code} surChangement={setCode} invalide={!!erreur} />
      </div>
      <AlerteErreur erreur={erreur} />
      <div className="flex gap-2">
        <Bouton type="submit" variante={danger ? 'danger' : 'principal'} disabled={code.length < 6 || occupe}>{occupe ? 'Vérification…' : bouton}</Bouton>
        <Bouton variante="discret" onClick={surAnnuler}>Annuler</Bouton>
      </div>
    </form>
  );
}

export function Compte({
  moi,
  banque,
  actions,
  enrolement,
}: {
  moi: S<'Moi'>;
  banque: string;
  actions?: ActionsCompte;
  /** Maquettes : l'activation en cours, QR code affiché */
  enrolement?: S<'EnrolementCompte'>;
}) {
  const [etape, setEtape] = useState<Etape>(enrolement ? { type: 'activation', enrolement } : null);
  const nom = `${moi.prenom} ${moi.nom}`;
  const active = moi.totpActif;

  const activer = async () => {
    const e = await actions?.preparer();
    if (e) setEtape({ type: 'activation', enrolement: e });
  };

  return (
    <div className="flex max-w-[860px] flex-col gap-5">
      <div>
        <h1 className="text-[26px] font-bold tracking-tight">Mon compte</h1>
        <p className="mt-1 text-[15px] text-encre-3">Votre identité dans la console et la protection de votre connexion.</p>
      </div>

      <section aria-labelledby="identite" className="rounded-xl border border-trait bg-surface">
        <h2 id="identite" className="border-b border-trait px-5 py-3.5 text-[17px] font-bold">Identité</h2>
        <div className="flex items-center gap-4 px-5 py-4">
          <Avatar nom={nom} taille={48} ton="marque" />
          <dl className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)_minmax(0,1fr)] gap-4 text-[15px]">
            <div><dt className="text-sm text-encre-3">Nom</dt><dd className="font-semibold">{nom}</dd></div>
            <div><dt className="text-sm text-encre-3">E-mail</dt><dd className="truncate font-semibold" title={moi.email}>{moi.email}</dd></div>
            <div><dt className="text-sm text-encre-3">Rôle</dt><dd className="font-semibold">{ROLE[moi.role]} · {banque}</dd></div>
          </dl>
        </div>
      </section>

      <section aria-labelledby="double-authentification" className="rounded-xl border border-trait bg-surface">
        <div className="flex items-center justify-between gap-3 border-b border-trait px-5 py-3.5">
          <h2 id="double-authentification" className="text-[17px] font-bold">Double authentification</h2>
          <span className={cx('inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[13px] font-semibold', active ? 'bg-resolue-doux text-resolue' : 'bg-alerte-doux text-alerte')}>
            {active ? <ShieldCheck aria-hidden size={14} /> : <ShieldOff aria-hidden size={14} />}
            {active ? 'Activée' : 'Non activée'}
          </span>
        </div>
        <div className="flex flex-col gap-4 px-5 py-4">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-marque-doux text-marque-texte">
              {active ? <Smartphone aria-hidden size={18} /> : <KeyRound aria-hidden size={18} />}
            </span>
            <p className="text-[15px] leading-relaxed text-encre-2">
              {active && moi.totpObligatoire && <>Votre banque exige la double authentification : un code de votre application d'authentification vous est demandé à chaque connexion. Téléphone perdu ? Demandez à votre Admin Entreprise de la réinitialiser.</>}
              {active && !moi.totpObligatoire && <>Un code de votre application d'authentification vous est demandé à chaque connexion : un mot de passe volé ne suffit pas pour ouvrir votre compte.</>}
              {!active && <>Votre compte n'est protégé que par votre mot de passe. Avec la double authentification, un code affiché par votre téléphone vous est aussi demandé à chaque connexion : un mot de passe volé ne suffit plus.</>}
            </p>
          </div>

          {etape?.type === 'activation' && (
            <div className="grid grid-cols-[300px_minmax(0,1fr)] gap-6 border-t border-trait pt-4">
              <CleTotp enrolement={etape.enrolement} />
              <div className="flex flex-col gap-3">
                <p className="text-[15px] leading-relaxed text-encre-2">
                  Scannez ce code avec une application d'authentification (Google Authenticator, Microsoft Authenticator…), puis saisissez le code qu'elle affiche.
                </p>
                <FormulaireCode
                  libelle="Code affiché par l'application"
                  bouton="Activer"
                  occupe={actions?.occupe}
                  erreur={actions?.erreur}
                  surValider={async (code) => {
                    if ((await actions?.confirmer(code)) !== false) setEtape(null);
                  }}
                  surAnnuler={() => setEtape(null)}
                />
              </div>
            </div>
          )}

          {etape?.type === 'desactivation' && (
            <div className="border-t border-trait pt-4">
              <FormulaireCode
                libelle="Pour confirmer, saisissez le code affiché par votre application"
                bouton="Désactiver"
                danger
                occupe={actions?.occupe}
                erreur={actions?.erreur}
                surValider={async (code) => {
                  if ((await actions?.desactiver(code)) !== false) setEtape(null);
                }}
                surAnnuler={() => setEtape(null)}
              />
              <p className="mt-2 text-sm text-encre-3">Vos autres sessions ouvertes seront fermées.</p>
            </div>
          )}

          {!etape && !active && (
            <div>
              <Bouton variante="principal" icone={<ShieldCheck aria-hidden size={17} />} disabled={actions?.occupe} onClick={() => void activer()}>
                Activer la double authentification
              </Bouton>
            </div>
          )}
          {!etape && active && !moi.totpObligatoire && (
            <div>
              <Bouton icone={<ShieldOff aria-hidden size={17} />} onClick={() => setEtape({ type: 'desactivation' })}>Désactiver</Bouton>
            </div>
          )}
        </div>
      </section>

      <section aria-labelledby="mot-de-passe" className="rounded-xl border border-trait bg-surface px-5 py-4">
        <h2 id="mot-de-passe" className="text-[17px] font-bold">Mot de passe</h2>
        <p className="mt-1 text-[15px] leading-relaxed text-encre-2">
          Pour en changer, déconnectez-vous puis choisissez « Mot de passe oublié » : un lien vous est envoyé par e-mail. Vos sessions ouvertes sont alors fermées.
        </p>
      </section>
    </div>
  );
}

/** Étape 19 : rappel en haut de la console, tant que la personne n'a pas activé la double authentification. */
export function BandeauDoubleAuthentification({ lien, surOuvrir, surMasquer }: { lien?: string; surOuvrir?: () => void; surMasquer?: () => void }) {
  return (
    <div role="status" className="mb-5 flex items-center gap-3 rounded-xl border border-alerte/30 bg-alerte-doux px-4 py-3 text-[15px]">
      <ShieldOff aria-hidden size={18} className="shrink-0 text-alerte" />
      <p className="flex-1 text-encre-2">
        <span className="font-semibold text-encre">Votre compte n'est protégé que par votre mot de passe.</span> Activez la double authentification en deux minutes avec votre téléphone.
      </p>
      <a
        href={lien ?? '#compte'}
        onClick={(e) => {
          if (surOuvrir && !e.metaKey && !e.ctrlKey && !e.shiftKey && e.button === 0) {
            e.preventDefault();
            surOuvrir();
          }
        }}
        className="font-semibold whitespace-nowrap text-marque-texte hover:underline"
      >
        Mon compte
      </a>
      {surMasquer && (
        <button type="button" onClick={surMasquer} className="rounded-lg px-2 py-1 text-sm font-semibold text-encre-3 hover:bg-surface hover:text-encre">
          Plus tard
        </button>
      )}
    </div>
  );
}
