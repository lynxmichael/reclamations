/**
 * Connexion du personnel en deux étapes (décision C6) : e-mail et mot de passe (connexion),
 * puis le code de l'application d'authentification (validerCodeTotp). À la première connexion,
 * l'invité choisit son mot de passe et active le TOTP (accepterInvitation, activerTotp).
 *
 * Sans fonctions de rappel (maquettes), les écrans s'affichent remplis, comme à l'étape 6.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CircleAlert, Eye, EyeOff, KeyRound, MailCheck, ShieldCheck, Smartphone } from 'lucide-react';
import type { S } from '../../api/types';
import { Bouton, Champ, LogoBanque, QrCode, Saisie, cx } from '../../ui/composants';
import { styleMarque } from '../../ui/marque';

/** Banque affichée sur l'écran de connexion ; null : la console, commune à toutes les banques. */
type BanqueConnexion = S<'BanquePublique'> | null;

export function CadreConnexion({ banque, children }: { banque: BanqueConnexion; children: ReactNode }) {
  const nom = banque?.nom ?? 'Réclamations';
  return (
    <div style={styleMarque(banque?.couleurPrimaire)} className="flex min-h-full flex-col items-center bg-fond px-4 py-14">
      <div className="flex items-center gap-3">
        <LogoBanque nom={banque?.nom ?? 'Réclamations en ligne'} logoUrl={banque?.logoUrl ?? null} taille={40} />
        <div className="leading-tight">
          <div className="text-lg font-bold">{nom}</div>
          <div className="text-sm text-encre-3">Espace du personnel</div>
        </div>
      </div>
      <div className="mt-8 w-full max-w-[420px] rounded-2xl border border-trait bg-surface p-8 shadow-[0_1px_2px_rgb(23_33_43/0.06)]">{children}</div>
      <p className="mt-6 max-w-[420px] text-center text-sm leading-relaxed text-encre-3">
        Accès réservé au personnel {banque ? `de ${banque.nom}` : 'des banques clientes et de Makor Telecoms'}. Les connexions sont inscrites au journal d'audit.
      </p>
    </div>
  );
}

export function AlerteErreur({ erreur }: { erreur: S<'Probleme'> | null | undefined }) {
  if (!erreur) return null;
  return (
    <div role="alert" className="mt-5 flex gap-3 rounded-xl border border-urgent/30 bg-urgent-doux p-4 text-[15px]">
      <CircleAlert aria-hidden size={20} className="mt-0.5 shrink-0 text-urgent" />
      <div>
        <p className="font-bold text-urgent">{erreur.title}</p>
        {erreur.detail && <p className="mt-0.5 text-encre-2">{erreur.detail}</p>}
      </div>
    </div>
  );
}

function ChampMotDePasse({ id, nom, autoComplete, invalide, defaut, decrit }: { id: string; nom: string; autoComplete: string; invalide?: boolean; defaut?: string; decrit?: string }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Saisie id={id} name={nom} type={visible ? 'text' : 'password'} autoComplete={autoComplete} defaultValue={defaut} invalide={invalide} aria-describedby={decrit} className="pr-11" required />
      <button
        type="button"
        aria-label={visible ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
        aria-pressed={visible}
        onClick={() => setVisible((v) => !v)}
        className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1.5 text-encre-3 hover:bg-fond"
      >
        {visible ? <EyeOff size={18} /> : <Eye size={18} />}
      </button>
    </div>
  );
}

export function Connexion({
  banque,
  erreur,
  surConnexion,
  occupe,
  lienOubli = '#oubli',
  emailInitial,
  information,
}: {
  banque: BanqueConnexion;
  erreur?: S<'Probleme'> | null;
  surConnexion?: (email: string, motDePasse: string) => void;
  occupe?: boolean;
  lienOubli?: string;
  emailInitial?: string;
  /** Message au-dessus du formulaire (session expirée, mot de passe changé…) */
  information?: string | null;
}) {
  const demo = !surConnexion;
  return (
    <CadreConnexion banque={banque}>
      <h1 className="text-2xl font-bold tracking-tight">Connexion</h1>
      {information && !erreur && <p className="mt-4 rounded-xl bg-fond p-4 text-[15px] leading-relaxed text-encre-2">{information}</p>}
      <AlerteErreur erreur={erreur} />
      <form
        className="mt-6 flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          surConnexion?.(String(f.get('email') ?? '').trim(), String(f.get('motDePasse') ?? ''));
        }}
      >
        <Champ libelle="E-mail professionnel">
          {(id) => (
            <Saisie
              id={id}
              name="email"
              type="email"
              autoComplete="username"
              required
              autoFocus={!demo}
              defaultValue={emailInitial ?? (demo ? `serge.kouadio@banque-${banque?.slug ?? 'alpha'}.example` : '')}
            />
          )}
        </Champ>
        <Champ libelle="Mot de passe">
          {(id) => <ChampMotDePasse id={id} nom="motDePasse" autoComplete="current-password" defaut={demo ? 'motdepasse-long' : undefined} invalide={!!erreur} />}
        </Champ>
        <Bouton type="submit" variante="principal" taille="grand" className="mt-1 w-full" disabled={occupe}>
          {occupe ? 'Vérification…' : 'Continuer'}
        </Bouton>
        <a href={lienOubli} className="text-center text-[15px] font-semibold text-marque-texte hover:underline">
          Mot de passe oublié
        </a>
      </form>
    </CadreConnexion>
  );
}

/** Six cases pour un code : saisie chiffre par chiffre, ou collage du code entier. */
export function SaisieCode({ valeur, surChangement, invalide, surComplet }: { valeur: string; surChangement: (v: string) => void; invalide?: boolean; surComplet?: (v: string) => void }) {
  const cases = useRef<(HTMLInputElement | null)[]>([]);
  const chiffres = Array.from({ length: 6 }, (_, i) => valeur[i] ?? '');
  const changer = (v: string) => {
    surChangement(v);
    if (v.length === 6) surComplet?.(v);
  };
  const saisir = (i: number, brut: string) => {
    const propres = brut.replace(/\D/g, '');
    if (propres.length > 1) {
      changer(propres.slice(0, 6));
      cases.current[Math.min(5, propres.length)]?.focus();
      return;
    }
    changer((valeur.slice(0, i) + propres + valeur.slice(i + 1)).slice(0, 6));
    if (propres && i < 5) cases.current[i + 1]?.focus();
  };
  return (
    <fieldset>
      <legend className="sr-only">Code à 6 chiffres</legend>
      <div className="flex gap-2">
        {chiffres.map((c, i) => (
          <input
            key={i}
            ref={(el) => {
              cases.current[i] = el;
            }}
            aria-label={`Chiffre ${i + 1}`}
            inputMode="numeric"
            autoComplete={i === 0 ? 'one-time-code' : 'off'}
            autoFocus={i === 0 && valeur === ''}
            value={c}
            onChange={(e) => saisir(i, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Backspace' && !c && i > 0) cases.current[i - 1]?.focus();
            }}
            className={cx(
              'chiffres h-13 w-full min-w-0 rounded-lg border-2 text-center text-xl font-bold focus:border-marque focus:outline-none',
              invalide ? 'border-urgent' : i === valeur.length ? 'border-marque ring-4 ring-marque-trait' : c ? 'border-encre-3' : 'border-trait-fort bg-fond',
            )}
          />
        ))}
      </div>
    </fieldset>
  );
}

function useCode(initial: string, erreur: unknown) {
  const [code, setCode] = useState(initial);
  // Code refusé : on vide les cases pour la saisie suivante
  useEffect(() => {
    if (erreur) setCode('');
  }, [erreur]);
  return [code, setCode] as const;
}

export function CodeTotp({
  banque,
  etape,
  surValider,
  erreur,
  occupe,
  surRetour,
}: {
  banque: BanqueConnexion;
  etape: S<'EtapeConnexion'>;
  surValider?: (code: string) => void;
  erreur?: S<'Probleme'> | null;
  occupe?: boolean;
  surRetour?: () => void;
}) {
  const [code, setCode] = useCode(surValider ? '' : '3071', erreur);
  const nom = banque?.nom ?? 'Réclamations';
  return (
    <CadreConnexion banque={banque}>
      <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-marque-doux text-marque-texte">
        <Smartphone aria-hidden size={24} />
      </span>
      <h1 className="mt-5 text-2xl font-bold tracking-tight">Code de vérification</h1>
      <p className="mt-2 text-[15px] leading-relaxed text-encre-2">
        Ouvrez votre application d'authentification et saisissez le code affiché pour {nom}. Il change toutes les 30 secondes.
      </p>
      <AlerteErreur erreur={erreur} />
      <form
        className="mt-6 flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (code.length === 6) surValider?.(code);
        }}
      >
        <SaisieCode valeur={code} surChangement={setCode} invalide={!!erreur} surComplet={(c) => !occupe && surValider?.(c)} />
        <Bouton type="submit" variante="principal" taille="grand" className="w-full" disabled={code.length < 6 || occupe}>
          {occupe ? 'Vérification…' : 'Se connecter'}
        </Bouton>
      </form>
      <p className="mt-5 text-sm leading-relaxed text-encre-3">
        Cette étape expire dans {Math.round((etape.expireDans ?? 300) / 60)} minutes. Téléphone perdu ? Demandez à votre Admin Entreprise de réinitialiser votre double authentification.
      </p>
      {surRetour && (
        <button type="button" onClick={surRetour} className="mt-3 text-[15px] font-semibold text-marque-texte hover:underline">
          Revenir à la connexion
        </button>
      )}
    </CadreConnexion>
  );
}

/**
 * QR code et clé d'activation de la double authentification : à la première connexion, et depuis
 * « Mon compte » (étape 19).
 */
export function CleTotp({ enrolement, className }: { enrolement: { otpauthUrl: string; secret: string }; className?: string }) {
  const groupes = enrolement.secret.match(/.{1,4}/g) ?? [];
  return (
    <div className={cx('rounded-xl border border-trait p-4', className)}>
      {/* Assez grand pour être lu de loin par un téléphone d'entrée de gamme (étape 11) */}
      <div className="flex justify-center">
        <QrCode texte={enrolement.otpauthUrl} taille={216} libelle="QR code d'activation de la double authentification (clé à saisir ci-dessous)" />
      </div>
      <p className="mt-2 text-center text-sm text-encre-2">Dans l'application : « + », puis « Scanner un code QR ».</p>
      <div className="mt-4 border-t border-trait pt-3 text-sm">
        <p className="text-encre-3">Impossible de scanner ? Choisissez « Saisir une clé de configuration » et recopiez :</p>
        {/* Groupes de 4 jamais coupés : la clé se recopie groupe par groupe */}
        <p className="chiffres mt-1 flex flex-wrap gap-x-2 font-bold tracking-wider text-encre" data-secret={enrolement.secret}>
          {groupes.map((g, i) => <span key={i}>{g}</span>)}
        </p>
      </div>
    </div>
  );
}

export function Activation({
  banque,
  enrolement,
  surActiver,
  erreur,
  occupe,
}: {
  banque: BanqueConnexion;
  enrolement: S<'EnrolementTotp'>;
  surActiver?: (code: string) => void;
  erreur?: S<'Probleme'> | null;
  occupe?: boolean;
}) {
  const [code, setCode] = useCode('', erreur);
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
      <CleTotp enrolement={enrolement} className="mt-5" />
      <AlerteErreur erreur={erreur} />
      <form
        className="mt-5 flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (code.length === 6) surActiver?.(code);
        }}
      >
        <span className="text-[15px] font-semibold">Code affiché par l'application</span>
        <SaisieCode valeur={code} surChangement={setCode} invalide={!!erreur} />
        <Bouton type="submit" variante="principal" taille="grand" className="w-full" icone={<ShieldCheck aria-hidden size={19} />} disabled={(!!surActiver && code.length < 6) || occupe}>
          {occupe ? 'Activation…' : 'Activer et me connecter'}
        </Bouton>
      </form>
    </CadreConnexion>
  );
}

/** Choix du mot de passe : invitation (accepterInvitation) ou lien « mot de passe oublié ». */
export function DefinitionMotDePasse({
  titre,
  explication,
  erreur,
  surDefinir,
  occupe,
  etape,
}: {
  titre: string;
  explication: string;
  erreur?: S<'Probleme'> | null;
  surDefinir: (motDePasse: string) => void;
  occupe?: boolean;
  /** Première connexion : le TOTP suit */
  etape?: boolean;
}) {
  const [nonIdentiques, setNonIdentiques] = useState(false);
  const refus = erreur?.erreurs?.find((e) => e.champ === 'motDePasse')?.message;
  return (
    <CadreConnexion banque={null}>
      {etape && (
        <ol className="mb-6 flex items-center gap-2 text-sm font-semibold">
          <li className="flex items-center gap-2 text-encre" aria-current="step">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-marque text-sur-marque">1</span>
            Mot de passe
          </li>
          <li aria-hidden className="h-px flex-1 bg-trait-fort" />
          <li className="flex items-center gap-2 text-encre-3">
            <span className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-trait-fort">2</span>
            Double authentification
          </li>
        </ol>
      )}
      <h1 className="text-2xl font-bold tracking-tight">{titre}</h1>
      <p className="mt-2 text-[15px] leading-relaxed text-encre-2">{explication}</p>
      <AlerteErreur erreur={refus ? null : erreur} />
      <form
        className="mt-6 flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const mdp = String(f.get('motDePasse') ?? '');
          const confirmation = String(f.get('confirmation') ?? '');
          setNonIdentiques(mdp !== confirmation);
          if (mdp === confirmation) surDefinir(mdp);
        }}
      >
        <Champ libelle="Nouveau mot de passe" aide="12 caractères au moins. Une phrase facile à retenir fait un bon mot de passe." erreur={refus}>
          {(id, decrit) => <ChampMotDePasse id={id} nom="motDePasse" autoComplete="new-password" invalide={!!refus} decrit={decrit} />}
        </Champ>
        <Champ libelle="Confirmez-le" erreur={nonIdentiques ? 'Les deux saisies sont différentes' : undefined}>
          {(id, decrit) => <ChampMotDePasse id={id} nom="confirmation" autoComplete="new-password" invalide={nonIdentiques} decrit={decrit} />}
        </Champ>
        <Bouton type="submit" variante="principal" taille="grand" className="w-full" disabled={occupe}>
          {occupe ? 'Enregistrement…' : etape ? 'Continuer' : 'Enregistrer le mot de passe'}
        </Bouton>
      </form>
    </CadreConnexion>
  );
}

export function OubliMotDePasse({ envoye, surDemander, occupe, lienConnexion }: { envoye: boolean; surDemander: (email: string) => void; occupe?: boolean; lienConnexion: string }) {
  return (
    <CadreConnexion banque={null}>
      {envoye ? (
        <>
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-resolue-doux text-resolue">
            <MailCheck aria-hidden size={24} />
          </span>
          <h1 className="mt-5 text-2xl font-bold tracking-tight">Vérifiez vos e-mails</h1>
          <p className="mt-2 text-[15px] leading-relaxed text-encre-2">
            Si un compte existe à cette adresse, vous allez recevoir un lien pour choisir un nouveau mot de passe. Il est valable une heure.
          </p>
        </>
      ) : (
        <>
          <h1 className="text-2xl font-bold tracking-tight">Mot de passe oublié</h1>
          <p className="mt-2 text-[15px] leading-relaxed text-encre-2">Indiquez votre e-mail professionnel : nous vous envoyons un lien pour en choisir un nouveau.</p>
          <form
            className="mt-6 flex flex-col gap-5"
            onSubmit={(e) => {
              e.preventDefault();
              surDemander(String(new FormData(e.currentTarget).get('email') ?? '').trim());
            }}
          >
            <Champ libelle="E-mail professionnel">{(id) => <Saisie id={id} name="email" type="email" autoComplete="username" required autoFocus />}</Champ>
            <Bouton type="submit" variante="principal" taille="grand" className="w-full" disabled={occupe}>
              {occupe ? 'Envoi…' : 'Recevoir le lien'}
            </Bouton>
          </form>
        </>
      )}
      <a href={lienConnexion} className="mt-5 block text-center text-[15px] font-semibold text-marque-texte hover:underline">
        Revenir à la connexion
      </a>
    </CadreConnexion>
  );
}
