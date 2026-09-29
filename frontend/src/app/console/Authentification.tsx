/**
 * Entrée dans la console : connexion en deux étapes, première connexion (invitation), mot de passe
 * oublié. Les jetons d'invitation et de réinitialisation arrivent après « # » dans le lien reçu
 * par e-mail : lus une fois, puis retirés de l'adresse.
 */
import { useEffect, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import { ErreurApi, PROBLEME_RESEAU } from '../../api/client';
import { useEtatSession, type SessionPersonnel } from '../../api/session-personnel';
import type { S } from '../../api/types';
import { Activation, CadreConnexion, CodeTotp, Connexion, DefinitionMotDePasse, OubliMotDePasse } from '../../ecrans/connexion/Connexion';
import { Chargement } from '../commun/Etats';

function probleme(e: unknown): S<'Probleme'> {
  return e instanceof ErreurApi ? e.probleme : PROBLEME_RESEAU;
}

function useTitre(titre: string) {
  useEffect(() => {
    document.title = `${titre} — Réclamations`;
  }, [titre]);
}

/** Jeton du lien reçu par e-mail (#jeton=…), retiré de l'adresse dès sa lecture. */
function useJetonDuLien(): string | null {
  const [jeton] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get('jeton'));
  useEffect(() => {
    if (window.location.hash) window.history.replaceState(window.history.state, '', window.location.pathname);
  }, []);
  return jeton;
}

/** Adresse de retour après connexion : seulement une page de la console. */
function retourSur(params: URLSearchParams): string {
  const r = params.get('retour');
  return r && r.startsWith('/') && !r.startsWith('//') ? r : '/';
}

export function PageConnexion({ session }: { session: SessionPersonnel }) {
  const etat = useEtatSession(session);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const location = useLocation();
  const [etape, setEtape] = useState<S<'EtapeTotp'> | null>(null);
  const [erreur, setErreur] = useState<S<'Probleme'> | null>(null);
  const [email, setEmail] = useState<string | undefined>(undefined);
  useTitre('Connexion');
  const information = (location.state as { information?: string } | null)?.information ?? (params.get('expiree') ? 'Votre session a expiré. Reconnectez-vous pour continuer.' : null);

  const connexion = useMutation({
    mutationFn: (v: { email: string; motDePasse: string }) => session.appeler('connexion', { corps: v }),
    onSuccess: (e) => {
      setErreur(null);
      setEtape(e);
    },
    onError: (e) => setErreur(probleme(e)),
  });
  const ouvrir = (s: S<'SessionPersonnel'>) => {
    session.ouvrir(s);
    navigate(retourSur(params), { replace: true });
  };
  const totp = useMutation({
    mutationFn: (code: string) => session.appeler('validerCodeTotp', { corps: { jetonIntermediaire: etape!.jetonIntermediaire, code } }),
    onSuccess: ouvrir,
    onError: (e) => {
      // Étape de 5 minutes dépassée : on recommence depuis le mot de passe
      if (e instanceof ErreurApi && e.code === 'JETON_INVALIDE') {
        setEtape(null);
        setErreur({ ...e.probleme, title: 'Étape expirée', detail: 'Plus de 5 minutes se sont écoulées. Saisissez à nouveau votre mot de passe.' });
      } else setErreur(probleme(e));
    },
  });
  const activation = useMutation({
    mutationFn: (code: string) => session.appeler('activerTotp', { corps: { jetonIntermediaire: etape!.enrolement!.jetonIntermediaire, code } }),
    onSuccess: ouvrir,
    onError: (e) => setErreur(probleme(e)),
  });

  if (etat.statut === 'reprise') return <Chargement pleinEcran />;
  if (etat.statut === 'connecte') return <Navigate to={retourSur(params)} replace />;

  if (etape?.etape === 'ENROLEMENT_TOTP_REQUIS' && etape.enrolement) {
    return <Activation banque={null} enrolement={etape.enrolement} erreur={erreur} occupe={activation.isPending} surActiver={(c) => activation.mutate(c)} />;
  }
  if (etape) {
    return (
      <CodeTotp
        banque={null}
        etape={etape}
        erreur={erreur}
        occupe={totp.isPending}
        surValider={(c) => totp.mutate(c)}
        surRetour={() => {
          setEtape(null);
          setErreur(null);
        }}
      />
    );
  }
  return (
    <Connexion
      banque={null}
      erreur={erreur}
      information={information}
      occupe={connexion.isPending}
      lienOubli="/mot-de-passe-oublie"
      emailInitial={email}
      surConnexion={(e, motDePasse) => {
        setEmail(e);
        connexion.mutate({ email: e, motDePasse });
      }}
    />
  );
}

function LienInvalide({ titre, texte }: { titre: string; texte: string }) {
  return (
    <CadreConnexion banque={null}>
      <h1 className="text-2xl font-bold tracking-tight">{titre}</h1>
      <p className="mt-2 text-[15px] leading-relaxed text-encre-2">{texte}</p>
      <Link to="/connexion" className="mt-5 block text-[15px] font-semibold text-marque-texte hover:underline">
        Aller à la connexion
      </Link>
    </CadreConnexion>
  );
}

export function PageInvitation({ session }: { session: SessionPersonnel }) {
  const jeton = useJetonDuLien();
  const navigate = useNavigate();
  const [enrolement, setEnrolement] = useState<S<'EnrolementTotp'> | null>(null);
  const [erreur, setErreur] = useState<S<'Probleme'> | null>(null);
  useTitre('Première connexion');

  const acceptation = useMutation({
    mutationFn: (motDePasse: string) => session.appeler('accepterInvitation', { corps: { jeton: jeton!, motDePasse } }),
    onSuccess: (e) => {
      setErreur(null);
      setEnrolement(e);
    },
    onError: (e) => setErreur(probleme(e)),
  });
  const activation = useMutation({
    mutationFn: (code: string) => session.appeler('activerTotp', { corps: { jetonIntermediaire: enrolement!.jetonIntermediaire, code } }),
    onSuccess: (s) => {
      session.ouvrir(s);
      navigate('/', { replace: true });
    },
    onError: (e) => setErreur(probleme(e)),
  });

  if (!jeton) return <LienInvalide titre="Lien d'invitation incomplet" texte="Ouvrez le lien complet reçu par e-mail. S'il a expiré (7 jours), demandez à votre administrateur de vous renvoyer l'invitation." />;
  if (enrolement && erreur?.code === 'JETON_INVALIDE') {
    // Le mot de passe est enregistré : la connexion normale reprend l'activation
    return <LienInvalide titre="Étape expirée" texte="Votre mot de passe est enregistré. Connectez-vous avec votre e-mail et ce mot de passe pour activer la double authentification." />;
  }
  if (erreur && (erreur.code === 'JETON_INVALIDE' || erreur.code === 'INVITATION_DEJA_ACCEPTEE')) {
    return (
      <LienInvalide
        titre={erreur.code === 'INVITATION_DEJA_ACCEPTEE' ? 'Invitation déjà acceptée' : 'Lien d\'invitation expiré'}
        texte={erreur.code === 'INVITATION_DEJA_ACCEPTEE' ? 'Votre compte est prêt : connectez-vous avec votre e-mail et votre mot de passe.' : 'Ce lien n\'est plus valable. Demandez à votre administrateur de vous renvoyer l\'invitation.'}
      />
    );
  }
  if (enrolement) return <Activation banque={null} enrolement={enrolement} erreur={erreur} occupe={activation.isPending} surActiver={(c) => activation.mutate(c)} />;
  return (
    <DefinitionMotDePasse
      etape
      titre="Bienvenue"
      explication="Choisissez votre mot de passe. Vous activerez ensuite la double authentification avec votre téléphone."
      erreur={erreur}
      occupe={acceptation.isPending}
      surDefinir={(m) => acceptation.mutate(m)}
    />
  );
}

export function PageMotDePasseOublie({ session }: { session: SessionPersonnel }) {
  const [envoye, setEnvoye] = useState(false);
  useTitre('Mot de passe oublié');
  const demande = useMutation({
    mutationFn: (email: string) => session.appeler('demanderReinitialisation', { corps: { email } }),
    // Même réponse que le compte existe ou non (l'API répond toujours 202)
    onSettled: () => setEnvoye(true),
  });
  return <OubliMotDePasse envoye={envoye} occupe={demande.isPending} surDemander={(e) => demande.mutate(e)} lienConnexion="/connexion" />;
}

export function PageReinitialisation({ session }: { session: SessionPersonnel }) {
  const jeton = useJetonDuLien();
  const navigate = useNavigate();
  const [erreur, setErreur] = useState<S<'Probleme'> | null>(null);
  useTitre('Nouveau mot de passe');
  const reinitialisation = useMutation({
    mutationFn: (motDePasse: string) => session.appeler('reinitialiserMotDePasse', { corps: { jeton: jeton!, motDePasse } }),
    onSuccess: () => navigate('/connexion', { replace: true, state: { information: 'Votre mot de passe est changé. Connectez-vous avec le nouveau.' } }),
    onError: (e) => setErreur(probleme(e)),
  });
  if (!jeton || erreur?.code === 'JETON_INVALIDE') {
    return <LienInvalide titre="Lien expiré ou incomplet" texte="Ce lien n'est plus valable (il dure une heure et ne sert qu'une fois). Demandez-en un nouveau depuis « Mot de passe oublié »." />;
  }
  return (
    <DefinitionMotDePasse
      titre="Nouveau mot de passe"
      explication="Choisissez un nouveau mot de passe. Vos sessions ouvertes sur d'autres appareils seront fermées."
      erreur={erreur}
      occupe={reinitialisation.isPending}
      surDefinir={(m) => reinitialisation.mutate(m)}
    />
  );
}
