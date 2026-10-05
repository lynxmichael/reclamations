/**
 * Portail client (<slug>.<domaine>), pensé d'abord pour le téléphone. Les écrans sont ceux de
 * l'étape 6 ; chaque page les alimente avec l'API :
 *
 *   /d/{code}                 dépôt depuis un QR code ou un lien web (lireFormulaireDepot, deposerReclamation) ;
 *                             assistant automatique d'abord quand la banque l'a (converserAvecAssistant, étape 18)
 *   /suivi/{jeton}            suivi public, puis code à usage unique (lireSuivi, demanderCodeOtp, verifierCodeOtp)
 *   /suivi/{jeton}/avis       enquête de satisfaction après la clôture (lireAvis, donnerAvis, étape 15)
 *
 * Le dépôt et la demande de code exigent un défi anti-robot résolu (lireDefiAntiRobot, étape 11).
 *   /mes-reclamations[/{id}]  espace client, 30 minutes (listerMesReclamations, lireMaReclamation…) ;
 *                             chat web quand la banque l'a (étape 17) : relu toutes les 5 secondes tant que
 *                             la page est visible (lireConversationClient, marquerConversationLueClient)
 *   /politique-donnees        politique de données (?point={code} pour les couleurs de la banque)
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { QrCode as IconeQr, MessageSquareText } from 'lucide-react';
import { useAntiRobot } from '../../api/anti-robot';
import { ErreurApi, enregistrer, messageErreur } from '../../api/client';
import { useSessionClientOuverte, type SessionClient } from '../../api/session-client';
import type { S } from '../../api/types';
import { Accuse } from '../../ecrans/portail/Accuse';
import { Assistant, type EchangeVu } from '../../ecrans/portail/Assistant';
import { Avis } from '../../ecrans/portail/Avis';
import { CadrePortail } from '../../ecrans/portail/CadrePortail';
import { CodeOtp } from '../../ecrans/portail/CodeOtp';
import { Depot, type SaisieDepot } from '../../ecrans/portail/Depot';
import { MaReclamation } from '../../ecrans/portail/MaReclamation';
import { MesReclamations } from '../../ecrans/portail/MesReclamations';
import { Suivi } from '../../ecrans/portail/Suivi';
import { LienPolitique, TelechargerPiece } from '../../ui/contextes';
import { useAnnoncer } from '../commun/Annonces';
import { Chargement, ErreurChargement, Introuvable } from '../commun/Etats';
import { nouvelleCle } from '../commun/requetes';
import { TextePolitique } from './Politique';

const SAISIE_VIDE: SaisieDepot = { categorieId: '', description: '', nom: '', telephone: '', email: '', consentement: false, fichiers: [] };

function useTitre(titre: string | null) {
  useEffect(() => {
    if (titre) document.title = titre;
  }, [titre]);
}

/** Politique de données aux couleurs de la banque du point de dépôt. */
function lienPolitique(url: string, code: string): string {
  try {
    const u = new URL(url, window.location.origin);
    return `${u.pathname}?point=${encodeURIComponent(code)}`;
  } catch {
    return `/politique-donnees?point=${encodeURIComponent(code)}`;
  }
}

function envoiPar(telephone: string, email: string): string {
  if (telephone.trim() && email.trim()) return 'par SMS et par e-mail';
  return telephone.trim() ? 'par SMS' : 'par e-mail';
}

/* ------------------------------------------------------------------ Dépôt */

export function PageDepot({ session }: { session: SessionClient }) {
  const { code = '' } = useParams();
  const appeler = session.appeler;
  const formulaire = useQuery({ queryKey: ['formulaire', code], queryFn: () => appeler('lireFormulaireDepot', { chemin: { code } }) });
  const [saisie, setSaisie] = useState<SaisieDepot>(SAISIE_VIDE);
  const [version, setVersion] = useState(0);
  const [erreur, setErreur] = useState<S<'Probleme'> | null>(null);
  const [accuse, setAccuse] = useState<{ accuse: S<'AccuseDepot'>; envoiPar: string; transfert: boolean } | null>(null);
  const cle = useRef(nouvelleCle());
  const navigate = useNavigate();
  // Assistant automatique (étape 18) : le fil est gardé ici, l'API ne garde rien entre deux tours
  const [mode, setMode] = useState<'assistant' | 'formulaire' | null>(null);
  const [fil, setFil] = useState<EchangeVu[]>([]);
  const [tour, setTour] = useState<S<'ReponseAssistant'> | null>(null);
  const [erreurAssistant, setErreurAssistant] = useState<string | null>(null);
  const [via, setVia] = useState<{ categorieProposeeId: string | null; transfert: boolean } | null>(null);
  // Défi anti-robot résolu en arrière-plan pendant la saisie (étape 11)
  const antiRobot = useAntiRobot(appeler);
  useTitre(formulaire.data ? `Réclamation — ${formulaire.data.banque.nom}` : null);

  const envoi = useMutation({
    mutationFn: (v: SaisieDepot & { agenceId: string | null }) => antiRobot.avec((jetonAntiRobot) =>
      appeler('deposerReclamation', {
        chemin: { code },
        entetes: { 'Idempotency-Key': cle.current },
        // Un champ vide n'est pas envoyé : l'API répond « Champ obligatoire » plutôt que « invalide »
        corps: {
          ...(v.categorieId ? { categorieId: v.categorieId } : ({} as { categorieId: string })),
          ...(v.agenceId ? { agenceId: v.agenceId } : {}),
          description: v.description,
          nom: v.nom.trim(),
          ...(v.telephone.trim() ? { telephone: v.telephone } : {}),
          ...(v.email.trim() ? { email: v.email } : {}),
          consentement: v.consentement as true,
          versionPolitique: formulaire.data!.politiqueDonnees.version,
          jetonAntiRobot,
          fichiers: v.fichiers,
          ...(via ? { viaAssistant: true, ...(via.categorieProposeeId ? { categorieProposeeId: via.categorieProposeeId } : {}) } : {}),
        },
      })),
    onSuccess: (a, v) => {
      cle.current = nouvelleCle();
      setErreur(null);
      setAccuse({ accuse: a, envoiPar: envoiPar(v.telephone, v.email), transfert: !!via?.transfert });
      window.scrollTo({ top: 0 });
    },
    onError: (e, v) => {
      // Requête traitée et refusée (4xx) : le prochain envoi est une nouvelle demande.
      // Réseau coupé ou panne (0, 5xx) : on garde la clé, l'API reconnaîtra un éventuel doublon.
      if (e instanceof ErreurApi && e.statut >= 400 && e.statut < 500) cle.current = nouvelleCle();
      setErreur(e instanceof ErreurApi ? e.probleme : { type: '/erreurs/inattendue', title: 'Envoi impossible', status: 0, code: 'ERREUR_INTERNE', detail: messageErreur(e) });
      setSaisie({ ...v });
      setVersion((n) => n + 1);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
  });

  const conversation = useMutation({
    mutationFn: (echanges: EchangeVu[]) => appeler('converserAvecAssistant', {
      chemin: { code },
      corps: { echanges: echanges.slice(-30).map((e) => (e.auteur === 'CLIENT' ? { auteur: 'CLIENT' as const, texte: e.texte } : { auteur: 'ASSISTANT' as const, ...(e.code ? { code: e.code } : {}) })) },
    }),
    onMutate: () => setErreurAssistant(null),
    onSuccess: (r) => {
      setFil((f) => [...f, ...r.messages.map((m) => ({ auteur: 'ASSISTANT' as const, texte: m.texte, code: m.code }))]);
      setTour(r);
    },
    onError: (e) => {
      // Assistant refermé entre-temps : le formulaire, comme avant
      if (e instanceof ErreurApi && e.code === 'FONCTION_NON_OUVERTE') setMode('formulaire');
      else setErreurAssistant(`${messageErreur(e)} Vous pouvez aussi remplir le formulaire.`);
    },
  });
  const avecAssistant = mode === 'assistant' || (mode === null && !!formulaire.data?.assistant);
  // Ouverture de l'assistant : il se présente une fois (sans message du client, rien n'est envoyé à l'IA)
  const presente = useRef(false);
  const { mutate: converser } = conversation;
  useEffect(() => {
    if (avecAssistant && fil.length === 0 && !presente.current) {
      presente.current = true;
      converser([]);
    }
  }, [avecAssistant, fil.length, converser]);
  const ecrire = (texte: string) => {
    const suite = [...fil, { auteur: 'CLIENT' as const, texte }];
    setFil(suite);
    setTour(null);
    conversation.mutate(suite);
  };

  if (formulaire.isPending) return <Chargement pleinEcran />;
  if (formulaire.isError) {
    if (formulaire.error instanceof ErreurApi && formulaire.error.statut === 404) {
      return <Introuvable titre="QR code ou lien inconnu">Ce point de dépôt n'existe pas ou n'est plus actif. Demandez un nouveau lien à votre banque.</Introuvable>;
    }
    if (formulaire.error instanceof ErreurApi && formulaire.error.code === 'BANQUE_SUSPENDUE') {
      return <Introuvable titre="Service momentanément fermé">Le dépôt de réclamations en ligne est suspendu pour cette banque. Adressez-vous à votre agence.</Introuvable>;
    }
    return <ErreurChargement erreur={formulaire.error} surReessayer={() => void formulaire.refetch()} pleinEcran />;
  }
  const f = formulaire.data;
  return (
    <LienPolitique.Provider value={lienPolitique(f.politiqueDonnees.url, code)}>
      {accuse ? (
        <Accuse
          banque={f.banque}
          accuse={accuse.accuse}
          envoiPar={accuse.envoiPar}
          conseiller={accuse.transfert}
          surSuivre={() => navigate(`/suivi/${encodeURIComponent(accuse.accuse.jetonSuivi)}`)}
          surAutre={() => {
            setAccuse(null);
            setSaisie(SAISIE_VIDE);
            setVia(null);
            setFil([]);
            setTour(null);
            setMode(null);
            presente.current = false;
            setVersion((n) => n + 1);
          }}
        />
      ) : avecAssistant ? (
        <Assistant
          banque={f.banque}
          agence={f.agence?.nom}
          fil={fil}
          suggestions={conversation.isPending ? [] : tour?.suggestions ?? []}
          proposition={tour?.proposition ?? null}
          categorie={f.categories.find((c) => c.id === tour?.proposition?.categorieId)?.nom}
          occupe={conversation.isPending}
          erreur={erreurAssistant}
          surEnvoyer={ecrire}
          surProposition={() => {
            const p = tour?.proposition;
            if (!p) return;
            setSaisie({ ...SAISIE_VIDE, categorieId: p.categorieId ?? '', description: p.description });
            setVia({ categorieProposeeId: p.categorieId, transfert: p.motif === 'TRANSFERT' });
            setErreur(null);
            setMode('formulaire');
            setVersion((n) => n + 1);
            window.scrollTo({ top: 0 });
          }}
          surFormulaire={() => {
            setMode('formulaire');
            window.scrollTo({ top: 0 });
          }}
        />
      ) : (
        <Depot
          key={version}
          formulaire={f}
          saisie={saisie}
          erreur={erreur}
          occupe={envoi.isPending}
          lienPolitique={lienPolitique(f.politiqueDonnees.url, code)}
          surEnvoyer={(v) => envoi.mutate(v)}
          assistant={f.assistant ? { prepare: !!via, surRetour: () => setMode('assistant') } : undefined}
        />
      )}
    </LienPolitique.Provider>
  );
}

/* ------------------------------------------------------------------ Suivi et code */

export function PageSuivi({ session }: { session: SessionClient }) {
  const { jeton = '' } = useParams();
  const appeler = session.appeler;
  const navigate = useNavigate();
  const annoncer = useAnnoncer();
  const cache = useQueryClient();
  const suivi = useQuery({ queryKey: ['suivi', jeton], queryFn: () => appeler('lireSuivi', { chemin: { jetonSuivi: jeton } }) });
  const [code, setCode] = useState<{ otp: S<'OtpEnvoye'>; erreur: string | null } | null>(null);
  useTitre(suivi.data ? `${suivi.data.numero} — ${suivi.data.banque.nom}` : null);

  /** Après le code : la réclamation de ce lien, dans l'espace client */
  const ouvrirEspace = async () => {
    const liste = await cache.fetchQuery({ queryKey: ['mes-reclamations'], queryFn: () => appeler('listerMesReclamations'), staleTime: 0 });
    const r = liste.donnees.find((x) => x.numero === suivi.data?.numero);
    navigate(r ? `/mes-reclamations/${r.id}` : '/mes-reclamations', { replace: true });
  };

  // Chaque code envoyé est un SMS facturé à la banque : défi anti-robot, préparé dès l'affichage
  const antiRobot = useAntiRobot(appeler);
  const demande = useMutation({
    mutationFn: (canal?: 'EMAIL') => antiRobot.avec((jetonAntiRobot) =>
      appeler('demanderCodeOtp', { chemin: { jetonSuivi: jeton }, corps: { jetonAntiRobot, ...(canal ? { canal } : {}) } })),
    onSuccess: (otp) => setCode({ otp, erreur: null }),
    onError: (e) => {
      if (code) setCode({ ...code, erreur: messageErreur(e) });
      else annoncer(messageErreur(e), 'erreur');
    },
  });
  const verification = useMutation({
    mutationFn: (saisi: string) => appeler('verifierCodeOtp', { chemin: { jetonSuivi: jeton }, corps: { code: saisi } }),
    onSuccess: async (s) => {
      session.ouvrir(s, suivi.data!.banque, jeton);
      await ouvrirEspace();
    },
    onError: (e) => setCode((c) => (c ? { ...c, erreur: messageErreur(e) } : c)),
  });

  if (suivi.isPending) return <Chargement pleinEcran />;
  if (suivi.isError) {
    if (suivi.error instanceof ErreurApi && suivi.error.statut === 404) {
      return <Introuvable titre="Lien de suivi inconnu">Vérifiez que vous avez ouvert le lien complet reçu par SMS ou par e-mail.</Introuvable>;
    }
    return <ErreurChargement erreur={suivi.error} surReessayer={() => void suivi.refetch()} pleinEcran />;
  }
  const s = suivi.data;
  const dejaOuverte = session.ouverte() && session.banque()?.slug === s.banque.slug;

  if (code) {
    return (
      <CodeOtp
        banque={s.banque}
        numero={s.numero}
        otp={code.otp}
        saisi=""
        erreur={code.erreur}
        surValider={(saisi) => verification.mutate(saisi)}
        surRenvoyer={() => demande.mutate(code.otp.canal === 'EMAIL' ? 'EMAIL' : undefined)}
        surRetour={() => setCode(null)}
      />
    );
  }
  return (
    <Suivi
      suivi={s}
      surAvis={() => navigate(`/suivi/${encodeURIComponent(jeton)}/avis`)}
      surDemanderCode={(canal) => {
        // Une session déjà ouverte dans cet onglet évite un nouveau SMS
        if (dejaOuverte) void ouvrirEspace().catch(() => demande.mutate(canal));
        else demande.mutate(canal);
      }}
    />
  );
}

/* ------------------------------------------------------------------ Enquête de satisfaction */

export function PageAvis({ session }: { session: SessionClient }) {
  const { jeton = '' } = useParams();
  const navigate = useNavigate();
  const cache = useQueryClient();
  const cle = ['avis', jeton];
  const avis = useQuery({ queryKey: cle, queryFn: () => session.appeler('lireAvis', { chemin: { jetonSuivi: jeton } }) });
  const [erreur, setErreur] = useState<string | null>(null);
  useTitre(avis.data ? `Votre avis — ${avis.data.banque.nom}` : null);

  const envoi = useMutation({
    mutationFn: (corps: S<'ReponseAvis'>) => session.appeler('donnerAvis', { chemin: { jetonSuivi: jeton }, corps }),
    onSuccess: (a) => {
      cache.setQueryData(cle, a);
      void cache.invalidateQueries({ queryKey: ['suivi', jeton] });
      void cache.invalidateQueries({ queryKey: ['ma-reclamation'] });
      setErreur(null);
      window.scrollTo({ top: 0 });
    },
    onError: (e) => {
      // Déjà répondu (autre onglet) ou enquête terminée entre-temps : l'écran suit le nouvel état
      if (e instanceof ErreurApi && (e.code === 'AVIS_DEJA_DONNE' || e.code === 'ENQUETE_TERMINEE')) void avis.refetch();
      setErreur(messageErreur(e));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
  });

  if (avis.isPending) return <Chargement pleinEcran />;
  if (avis.isError) {
    if (avis.error instanceof ErreurApi && avis.error.statut === 404) {
      return <Introuvable titre="Pas d'enquête pour ce lien">Vérifiez que vous avez ouvert le lien complet reçu après la clôture de votre réclamation.</Introuvable>;
    }
    return <ErreurChargement erreur={avis.error} surReessayer={() => void avis.refetch()} pleinEcran />;
  }
  return (
    <Avis
      avis={avis.data}
      erreur={avis.data.etat === 'A_DONNER' ? erreur : null}
      occupe={envoi.isPending}
      surEnvoyer={(r) => envoi.mutate(r)}
      surSuivi={() => navigate(`/suivi/${encodeURIComponent(jeton)}`)}
    />
  );
}

/* ------------------------------------------------------------------ Espace client */

function useEspace(session: SessionClient) {
  const ouverte = useSessionClientOuverte(session);
  const navigate = useNavigate();
  const annoncer = useAnnoncer();
  const retour = useRef(session.jetonSuivi());
  const avant = useRef(ouverte);
  const volontaire = useRef(false);
  const quitter = () => {
    volontaire.current = true;
    session.fermer();
    navigate(retour.current ? `/suivi/${encodeURIComponent(retour.current)}` : '/', { replace: true });
  };
  useEffect(() => {
    // Seulement quand la session expire pendant la visite, pas quand le client la quitte
    if (avant.current && !ouverte && !volontaire.current) annoncer('Votre session de 30 minutes est terminée. Demandez un nouveau code pour continuer.', 'info');
    avant.current = ouverte;
  }, [ouverte, annoncer]);
  return { ouverte, retour: retour.current, quitter };
}

export function PageMesReclamations({ session }: { session: SessionClient }) {
  const { ouverte, retour, quitter } = useEspace(session);
  const navigate = useNavigate();
  const liste = useQuery({ queryKey: ['mes-reclamations'], queryFn: () => session.appeler('listerMesReclamations'), enabled: ouverte });
  const banque = session.banque();
  useTitre(banque ? `Vos réclamations — ${banque.nom}` : null);
  if (!ouverte || !banque) return <Navigate to={retour ? `/suivi/${encodeURIComponent(retour)}` : '/'} replace />;
  if (liste.isPending) return <Chargement pleinEcran />;
  if (liste.isError) return <ErreurChargement erreur={liste.error} surReessayer={() => void liste.refetch()} pleinEcran />;
  return <MesReclamations banque={banque} reclamations={liste.data.donnees} surOuvrir={(id) => navigate(`/mes-reclamations/${id}`)} surQuitter={quitter} />;
}

/** Chat web (étape 17) : relecture des nouveaux messages, et marque « lu » au rythme de la page. */
export const RAFRAICHISSEMENT_CHAT_MS = 5_000;
export const BATTEMENT_CHAT_MS = 60_000;

/** Ajoute les nouveaux messages (dédoublonnés par id, la relecture repart de l'heure du dernier). */
export function fusionnerChat(r: S<'ReclamationClient'>, c: S<'ConversationClient'>): S<'ReclamationClient'> {
  const parId = new Map(r.messages.map((m) => [m.id, m]));
  for (const m of c.messages) parId.set(m.id, m);
  const messages = [...parId.values()].sort((a, b) => a.creeLe.localeCompare(b.creeLe) || a.id.localeCompare(b.id));
  return { ...r, messages, chat: c.chat };
}

function useChat(session: SessionClient, id: string, r: S<'ReclamationClient'> | undefined, actif: boolean) {
  const cache = useQueryClient();
  const appeler = session.appeler;
  const cle = ['ma-reclamation', id];
  const chat = actif && !!r?.chat;
  const curseur = r?.messages.at(-1)?.creeLe;
  useQuery({
    queryKey: ['chat', id],
    enabled: chat,
    refetchInterval: RAFRAICHISSEMENT_CHAT_MS,
    queryFn: async () => {
      const c = await appeler('lireConversationClient', { chemin: { id }, requete: curseur ? { apres: curseur } : {} });
      const avant = cache.getQueryData<S<'ReclamationClient'>>(cle);
      if (avant) {
        // Un changement de statut (résolution…) change les boutons et l'historique : relecture complète
        if (avant.statut !== c.statut) void cache.invalidateQueries({ queryKey: cle });
        else cache.setQueryData(cle, fusionnerChat(avant, c));
      }
      return c;
    },
  });

  // Lu et présent : à l'ouverture, à chaque nouvelle réponse de la banque, puis chaque minute à l'écran
  const reponses = r?.messages.filter((m) => m.auteur === 'BANQUE').length ?? 0;
  const lire = useCallback(() => {
    if (document.visibilityState === 'visible') void appeler('marquerConversationLueClient', { chemin: { id } }).catch(() => undefined);
  }, [appeler, id]);
  useEffect(() => {
    if (chat) lire();
  }, [chat, reponses, lire]);
  useEffect(() => {
    if (!chat) return;
    const minute = window.setInterval(lire, BATTEMENT_CHAT_MS);
    document.addEventListener('visibilitychange', lire);
    return () => {
      window.clearInterval(minute);
      document.removeEventListener('visibilitychange', lire);
    };
  }, [chat, lire]);
}

export function PageMaReclamation({ session }: { session: SessionClient }) {
  const { id = '' } = useParams();
  const { ouverte, retour, quitter } = useEspace(session);
  const navigate = useNavigate();
  const annoncer = useAnnoncer();
  const cache = useQueryClient();
  const appeler = session.appeler;
  const cle = ['ma-reclamation', id];
  const r = useQuery({ queryKey: cle, queryFn: () => appeler('lireMaReclamation', { chemin: { id } }), enabled: ouverte, refetchInterval: 60_000 });
  useChat(session, id, r.data, ouverte);
  const banque = session.banque();
  useTitre(r.data && banque ? `${r.data.numero} — ${banque.nom}` : null);

  const apres = (texte: string) => (maj: S<'ReclamationClient'>) => {
    cache.setQueryData(cle, maj);
    void cache.invalidateQueries({ queryKey: ['mes-reclamations'] });
    if (texte) annoncer(texte);
  };
  const echec = (e: unknown) => annoncer(messageErreur(e), 'erreur');
  const confirmer = useMutation({ mutationFn: () => appeler('confirmerResolution', { chemin: { id } }), onSuccess: apres('Merci : votre réclamation est clôturée.'), onError: echec });
  const contester = useMutation({
    mutationFn: (motif: string) => appeler('contesterResolution', { chemin: { id }, corps: { motif } }),
    onSuccess: apres('Contestation envoyée : la banque reprend votre réclamation.'),
    onError: echec,
  });
  const message = useMutation({
    mutationFn: ({ texte, fichiers }: { texte: string; fichiers: File[] }) => appeler('envoyerMessageClient', { chemin: { id }, corps: { contenu: texte, fichiers } }),
    // Dans le chat, le message s'affiche dans le fil (annoncé par lui) : pas de message de plus
    onSuccess: (maj) => (maj.chat ? apres('')(maj) : apres('Message envoyé à la banque.')(maj)),
    onError: echec,
  });

  if (!ouverte || !banque) return <Navigate to={retour ? `/suivi/${encodeURIComponent(retour)}` : '/'} replace />;
  if (r.isPending) return <Chargement pleinEcran />;
  if (r.isError) {
    if (r.error instanceof ErreurApi && r.error.statut === 404) return <Navigate to="/mes-reclamations" replace />;
    return <ErreurChargement erreur={r.error} surReessayer={() => void r.refetch()} pleinEcran />;
  }
  const telecharger = (piece: S<'PieceJointe'>) =>
    void appeler('telechargerPieceJointeClient', { chemin: { id, pieceId: piece.id } })
      .then((f) => enregistrer(f, piece.nomFichier))
      .catch(echec);
  const occupe = confirmer.isPending || contester.isPending || message.isPending;

  return (
    <TelechargerPiece.Provider value={telecharger}>
      <MaReclamation
        key={`${r.data.id}-${r.data.statut}`}
        banque={banque}
        reclamation={r.data}
        occupe={occupe}
        surRetour={() => navigate('/mes-reclamations')}
        surAvis={(chemin) => navigate(chemin)}
        surQuitter={quitter}
        surConfirmer={() => confirmer.mutate()}
        surContester={(motif) => contester.mutate(motif)}
        surEnvoyer={(texte, fichiers) =>
          message
            .mutateAsync({ texte, fichiers })
            .then(() => true)
            .catch(() => false)
        }
      />
    </TelechargerPiece.Provider>
  );
}

/* ------------------------------------------------------------------ Pages sans banque */

function CadreNeutre({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-surface text-encre">
      <header className="bg-[#2f4858] px-5 pt-4 pb-5 text-white">
        <div className="text-[17px] font-bold">Service réclamations</div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}

export function PageAccueil() {
  useTitre('Réclamations');
  return (
    <CadreNeutre>
      <div className="px-5 pt-8 pb-10">
        <h1 className="text-[26px] leading-tight font-bold tracking-tight">Déposer ou suivre une réclamation</h1>
        <ul className="mt-6 flex flex-col gap-5 text-[15px] leading-relaxed text-encre-2">
          <li className="flex gap-3">
            <IconeQr aria-hidden size={22} className="mt-0.5 shrink-0 text-encre-3" />
            <span>Pour déposer une réclamation, scannez le QR code affiché dans votre agence, ou ouvrez le lien donné par votre banque.</span>
          </li>
          <li className="flex gap-3">
            <MessageSquareText aria-hidden size={22} className="mt-0.5 shrink-0 text-encre-3" />
            <span>Pour suivre une réclamation, ouvrez le lien reçu par SMS ou par e-mail après votre dépôt.</span>
          </li>
        </ul>
      </div>
    </CadreNeutre>
  );
}

export function PagePolitique({ session }: { session: SessionClient }) {
  const [params] = useSearchParams();
  const point = params.get('point');
  const formulaire = useQuery({
    queryKey: ['formulaire', point],
    queryFn: () => session.appeler('lireFormulaireDepot', { chemin: { code: point! } }),
    enabled: !!point,
    retry: false,
  });
  const banque = formulaire.data?.banque ?? session.banque();
  useTitre(`Politique de données${banque ? ` — ${banque.nom}` : ''}`);
  if (point && formulaire.isPending) return <Chargement pleinEcran />;
  if (!banque) {
    return (
      <CadreNeutre>
        <TextePolitique banque={null} />
      </CadreNeutre>
    );
  }
  return (
    <CadrePortail banque={banque}>
      <TextePolitique banque={banque} />
    </CadrePortail>
  );
}
