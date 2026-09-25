/**
 * Connexion du personnel en deux étapes (décision C6) : e-mail et mot de passe (connexion),
 * puis le code de l'application d'authentification (validerCodeTotp). À la première connexion,
 * l'invité choisit son mot de passe et active le TOTP (accepterInvitation, activerTotp).
 */
import type { ReactNode } from 'react';
import { CircleAlert, Eye, KeyRound, ShieldCheck, Smartphone } from 'lucide-react';
import type { S } from '../../api/types';
import { Bouton, Champ, LogoBanque, QrCode, Saisie, cx } from '../../ui/composants';
import { styleMarque } from '../../ui/marque';

function CadreConnexion({ banque, children }: { banque: S<'BanquePublique'>; children: ReactNode }) {
  return (
    <div style={styleMarque(banque.couleurPrimaire)} className="flex min-h-full flex-col items-center bg-fond px-4 py-14">
      <div className="flex items-center gap-3">
        <LogoBanque nom={banque.nom} logoUrl={banque.logoUrl} taille={40} />
        <div className="leading-tight">
          <div className="text-lg font-bold">{banque.nom}</div>
          <div className="text-sm text-encre-3">Espace du personnel</div>
        </div>
      </div>
      <div className="mt-8 w-full max-w-[420px] rounded-2xl border border-trait bg-surface p-8 shadow-[0_1px_2px_rgb(23_33_43/0.06)]">{children}</div>
      <p className="mt-6 max-w-[420px] text-center text-sm leading-relaxed text-encre-3">
        Accès réservé au personnel de {banque.nom}. Les connexions sont inscrites au journal d'audit.
      </p>
    </div>
  );
}

export function Connexion({ banque, erreur }: { banque: S<'BanquePublique'>; erreur?: S<'Probleme'> | null }) {
  return (
    <CadreConnexion banque={banque}>
      <h1 className="text-2xl font-bold tracking-tight">Connexion</h1>
      {erreur && (
        <div role="alert" className="mt-5 flex gap-3 rounded-xl border border-urgent/30 bg-urgent-doux p-4 text-[15px]">
          <CircleAlert aria-hidden size={20} className="mt-0.5 shrink-0 text-urgent" />
          <div>
            <p className="font-bold text-urgent">{erreur.title}</p>
            <p className="mt-0.5 text-encre-2">{erreur.detail}</p>
          </div>
        </div>
      )}
      <form className="mt-6 flex flex-col gap-5" onSubmit={(e) => e.preventDefault()}>
        <Champ libelle="E-mail professionnel">
          {(id) => <Saisie id={id} type="email" autoComplete="username" defaultValue={`serge.kouadio@banque-${banque.slug}.example`} />}
        </Champ>
        <Champ libelle="Mot de passe">
          {(id) => (
            <div className="relative">
              <Saisie id={id} type="password" autoComplete="current-password" defaultValue="motdepasse-long" invalide={!!erreur} className="pr-11" />
              <button type="button" aria-label="Afficher le mot de passe" className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1.5 text-encre-3 hover:bg-fond">
                <Eye size={18} />
              </button>
            </div>
          )}
        </Champ>
        <Bouton variante="principal" taille="grand" className="mt-1 w-full">
          Continuer
        </Bouton>
        <a href="#oubli" className="text-center text-[15px] font-semibold text-marque-texte hover:underline">
          Mot de passe oublié
        </a>
      </form>
    </CadreConnexion>
  );
}

function CaseCode({ saisi }: { saisi: string }) {
  return (
    <div className="flex gap-2">
      {Array.from({ length: 6 }, (_, i) => (
        <input
          key={i}
          aria-label={`Chiffre ${i + 1}`}
          inputMode="numeric"
          maxLength={1}
          defaultValue={saisi[i] ?? ''}
          className={cx(
            'chiffres h-13 w-full min-w-0 rounded-lg border-2 text-center text-xl font-bold focus:border-marque focus:outline-none',
            i === saisi.length ? 'border-marque ring-4 ring-marque-trait' : saisi[i] ? 'border-encre-3' : 'border-trait-fort bg-fond',
          )}
        />
      ))}
    </div>
  );
}

export function CodeTotp({ banque, etape }: { banque: S<'BanquePublique'>; etape: S<'EtapeTotp'> }) {
  return (
    <CadreConnexion banque={banque}>
      <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-marque-doux text-marque-texte">
        <Smartphone aria-hidden size={24} />
      </span>
      <h1 className="mt-5 text-2xl font-bold tracking-tight">Code de vérification</h1>
      <p className="mt-2 text-[15px] leading-relaxed text-encre-2">
        Ouvrez votre application d'authentification et saisissez le code affiché pour {banque.nom}. Il change toutes les 30 secondes.
      </p>
      <form className="mt-6 flex flex-col gap-5" onSubmit={(e) => e.preventDefault()}>
        <CaseCode saisi="3071" />
        <Bouton variante="principal" taille="grand" className="w-full" disabled>
          Se connecter
        </Bouton>
      </form>
      <p className="mt-5 text-sm leading-relaxed text-encre-3">
        Cette étape expire dans {Math.round(etape.expireDans / 60)} minutes. Téléphone perdu ? Demandez à votre Admin Entreprise de réinitialiser votre double authentification.
      </p>
    </CadreConnexion>
  );
}

export function Activation({ banque, enrolement }: { banque: S<'BanquePublique'>; enrolement: S<'EnrolementTotp'> }) {
  const groupes = enrolement.secret.match(/.{1,4}/g) ?? [];
  return (
    <CadreConnexion banque={banque}>
      <ol className="flex items-center gap-2 text-sm font-semibold">
        <li className="flex items-center gap-2 text-resolue">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-resolue text-white">
            <KeyRound aria-hidden size={13} />
          </span>
          Mot de passe
        </li>
        <li aria-hidden className="h-px flex-1 bg-trait-fort" />
        <li className="flex items-center gap-2 text-encre" aria-current="step">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-marque text-sur-marque">2</span>
          Double authentification
        </li>
      </ol>
      <h1 className="mt-6 text-2xl font-bold tracking-tight">Protégez votre compte</h1>
      <p className="mt-2 text-[15px] leading-relaxed text-encre-2">
        Scannez ce code avec une application d'authentification (Google Authenticator, Microsoft Authenticator…), puis saisissez le code qu'elle affiche.
      </p>
      <div className="mt-5 flex items-center gap-5 rounded-xl border border-trait p-4">
        <QrCode texte={enrolement.otpauthUrl} taille={132} />
        <div className="min-w-0 text-sm">
          <p className="text-encre-3">Saisie manuelle de la clé</p>
          <p className="chiffres mt-1 font-bold tracking-wider break-all text-encre">{groupes.join(' ')}</p>
        </div>
      </div>
      <form className="mt-5 flex flex-col gap-4" onSubmit={(e) => e.preventDefault()}>
        <span className="text-[15px] font-semibold">Code affiché par l'application</span>
        <CaseCode saisi="" />
        <Bouton variante="principal" taille="grand" className="w-full" icone={<ShieldCheck aria-hidden size={19} />}>
          Activer et me connecter
        </Bouton>
      </form>
    </CadreConnexion>
  );
}
