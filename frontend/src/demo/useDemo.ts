/**
 * L'état de la démo et toutes ses actions : ce que montre le téléphone du client, ce que montre
 * le back-office (qui est connecté, quelle page), l'horloge, les messages de retour.
 * Chaque action appelle le moteur, qui applique les règles du backend.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { S } from '../api/types';
import type { PageBackOffice } from '../ecrans/back-office/CadreBackOffice';
import type { ActionsFiche } from '../ecrans/back-office/Ticket';
import { fichierExemple, type SaisieDepot } from '../ecrans/portail/Depot';
import { CATEGORIES } from '../maquettes/donnees/parametrage';
import { CLIENT_DEMO, creerDemo, debutDemo } from './historique';
import { ErreurDemo, PERSONNES, type Envoi, type Moteur } from './moteur';
import { enregistrerProspect, versBanque, type Prospect } from './prospect';

export const POINT_QR = '7K3QX9P2MA';

export type EcranClient =
  | { e: 'depot'; erreur: S<'Probleme'> | null; saisie: SaisieDepot; version: number }
  | { e: 'accuse'; accuse: S<'AccuseDepot'> }
  | { e: 'suivi'; jeton: string }
  | { e: 'code'; jeton: string; otp: S<'OtpEnvoye'>; saisi: string; erreur: string | null }
  | { e: 'espace' }
  | { e: 'detail'; id: string };

export type Role = 'SUPERVISEUR' | 'AGENT' | 'ADMIN_ENTREPRISE';
export const UTILISATEUR: Record<Role, string> = {
  SUPERVISEUR: PERSONNES.superviseur.id,
  AGENT: PERSONNES.agent.id,
  ADMIN_ENTREPRISE: PERSONNES.admin.id,
};

export interface EtatBanque {
  role: Role;
  page: PageBackOffice;
  ficheId: string | null;
  notifs: boolean;
}

export interface Message {
  id: number;
  texte: string;
  ton: 'ok' | 'erreur' | 'info';
}

const CARTE = CATEGORIES.find((c) => c.nom === 'Carte bancaire')!;

export const SAISIE_EXEMPLE: SaisieDepot = {
  categorieId: CARTE.id,
  description: "Hier soir, j'ai voulu retirer 50 000 FCFA au distributeur de l'agence. Il n'a pas donné les billets, mais mon compte a été débité.",
  nom: CLIENT_DEMO.nom,
  telephone: CLIENT_DEMO.telephone,
  email: CLIENT_DEMO.email,
  consentement: true,
  fichiers: [fichierExemple('ticket-distributeur.jpg', 1_258_291)],
};

/** Réponses proposées dans la fiche pendant la visite guidée. */
export const SUGGESTIONS = {
  reponse: 'Bonjour, merci pour votre signalement. Nous vérifions le journal du distributeur et revenons vers vous dans la journée.',
  resolution: "Bonjour, le distributeur n'a pas délivré les billets lors de votre retrait. Les 50 000 FCFA ont été recrédités sur votre compte ce jour. Nous vous prions de nous excuser.",
};

/** Temps de réflexion simulé avant chaque action, en minutes : les chronologies restent crédibles. */
const DUREE = { depot: 3, lecture: 1, assignation: 6, prise: 3, reponse: 14, note: 3, resolution: 22, priorite: 1, escalade: 2, cloture: 3, client: 2 } as const;

export function useDemo(prospectInitial: Prospect) {
  const [prospect, setProspect] = useState(prospectInitial);
  const fabriquer = useCallback((p: Prospect) => creerDemo({ banque: versBanque(p), debut: debutDemo(new Date()) }), []);
  const [moteur, setMoteur] = useState<Moteur>(() => fabriquer(prospectInitial));
  useSyncExternalStore(moteur.abonner, moteur.lireVersion);

  const [client, setClient] = useState<EcranClient>({ e: 'depot', erreur: null, saisie: SAISIE_EXEMPLE, version: 0 });
  const [banque, setBanque] = useState<EtatBanque>({ role: 'SUPERVISEUR', page: 'reclamations', ficheId: null, notifs: false });
  const [session, setSession] = useState<string | null>(null);
  const [demoId, setDemoId] = useState<string | null>(null);
  const [jetonDemo, setJetonDemo] = useState<string | null>(null);
  /** Le propriétaire du téléphone affiché : le client qui dépose depuis la démo */
  const [clientId, setClientId] = useState<string | null>(() => moteur.clientParTelephone(CLIENT_DEMO.telephoneE164)?.id ?? null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [smsVus, setSmsVus] = useState<Set<string>>(new Set());
  const compteurMessages = useRef(0);

  const informer = useCallback((texte: string, ton: Message['ton'] = 'ok') => {
    const id = ++compteurMessages.current;
    setMessages((m) => [...m.slice(-2), { id, texte, ton }]);
    window.setTimeout(() => setMessages((m) => m.filter((x) => x.id !== id)), ton === 'erreur' ? 6500 : 4200);
  }, []);

  /** Exécute une action du moteur ; une erreur de l'API devient un message lisible. */
  const tenter = useCallback(
    <T,>(f: () => T, succes?: string): T | undefined => {
      try {
        const r = f();
        if (succes) informer(succes);
        return r;
      } catch (e) {
        if (e instanceof ErreurDemo) informer(e.probleme.detail ? `${e.probleme.title} : ${e.probleme.detail}` : e.probleme.title, 'erreur');
        else throw e;
        return undefined;
      }
    },
    [informer],
  );

  const utilisateur = UTILISATEUR[banque.role];
  const avancer = (minutes: number) => moteur.avancer(minutes);

  /* -------------------------------------------------------------- Le téléphone du client */

  const version = moteur.version;
  const sms = useMemo(() => {
    if (!clientId) return [];
    const envois = moteur.envoisDe(clientId);
    // Un client sans téléphone reçoit tout par e-mail : le téléphone affiche alors ses e-mails
    return envois.some((e) => e.canal === 'SMS') ? envois.filter((e) => e.canal === 'SMS') : envois;
  }, [moteur, clientId, version]);
  const smsAffiche = [...sms].reverse().find((e) => !smsVus.has(e.id)) ?? null;
  useEffect(() => {
    if (!smsAffiche) return;
    const t = window.setTimeout(() => setSmsVus((v) => new Set(v).add(smsAffiche.id)), 9000);
    return () => window.clearTimeout(t);
  }, [smsAffiche]);

  const actionsClient = {
    deposer: (v: SaisieDepot & { agenceId: string | null }) => {
      avancer(DUREE.depot);
      try {
        const accuse = moteur.deposer(POINT_QR, {
          categorieId: v.categorieId,
          agenceId: v.agenceId,
          description: v.description,
          nom: v.nom,
          telephone: v.telephone,
          email: v.email,
          consentement: v.consentement,
          fichiers: v.fichiers.map((f) => ({ nom: f.name, taille: f.size, type: f.type || 'image/jpeg' })),
        });
        const t = moteur.ticket(accuse.numero);
        setClientId(t.clientId); // le téléphone de la démo appartient au client qui vient de déposer
        setDemoId(t.id);
        setJetonDemo(accuse.jetonSuivi);
        setSession(null);
        setClient({ e: 'accuse', accuse });
      } catch (e) {
        if (!(e instanceof ErreurDemo)) throw e;
        setClient((c) => (c.e === 'depot' ? { ...c, erreur: e.probleme, saisie: { ...v }, version: c.version + 1 } : c));
      }
    },
    suivre: (jeton?: string) => {
      const j = jeton ?? (client.e === 'accuse' ? client.accuse.jetonSuivi : jetonDemo);
      if (!j) return;
      if (session) {
        const id = moteur.toutesLesReclamations().find((t) => t.jetonSuivi === j)?.id;
        try {
          if (id && moteur.maReclamation(session, id)) return setClient({ e: 'detail', id });
        } catch {
          // session expirée ou autre client : on repasse par le code
        }
      }
      setClient({ e: 'suivi', jeton: j });
    },
    nouveauDepot: () => setClient({ e: 'depot', erreur: null, saisie: SAISIE_EXEMPLE, version: Date.now() }),
    demanderCode: (jeton: string, canal?: 'EMAIL') => {
      avancer(DUREE.lecture);
      const otp = tenter(() => moteur.demanderCode(jeton, canal));
      if (otp) setClient({ e: 'code', jeton, otp, saisi: '', erreur: null });
    },
    validerCode: (jeton: string, code: string) => {
      try {
        const s = moteur.verifierCode(jeton, code);
        setSession(s.jetonClient);
        const id = moteur.toutesLesReclamations().find((t) => t.jetonSuivi === jeton)!.id;
        setClient({ e: 'detail', id });
      } catch (e) {
        if (!(e instanceof ErreurDemo)) throw e;
        setClient((c) => (c.e === 'code' ? { ...c, erreur: e.probleme.detail ?? e.probleme.title } : c));
      }
    },
    ouvrirSms: (envoi: Envoi) => {
      setSmsVus((v) => new Set(v).add(envoi.id));
      const code = envoi.texte.match(/code est (\d{6})/)?.[1];
      if (code) {
        setClient((c) => (c.e === 'code' ? { ...c, saisi: code, erreur: null } : c));
        return;
      }
      if (envoi.lien) actionsClient.suivre(envoi.lien.jeton);
    },
    fermerSms: (envoi: Envoi) => setSmsVus((v) => new Set(v).add(envoi.id)),
    /** Visite guidée : ouvrir le lien, recevoir le code, le saisir. */
    ouvrirAvecCode: (jeton: string) => {
      avancer(DUREE.lecture);
      const otp = tenter(() => moteur.demanderCode(jeton));
      if (!otp) return;
      const dernier = moteur.envois.filter((e) => e.texte.includes('votre code est')).at(-1);
      const code = dernier?.texte.match(/code est (\d{6})/)?.[1] ?? '';
      if (dernier) setSmsVus((v) => new Set(v).add(dernier.id));
      try {
        const s = moteur.verifierCode(jeton, code);
        setSession(s.jetonClient);
        setClient({ e: 'detail', id: moteur.toutesLesReclamations().find((t) => t.jetonSuivi === jeton)!.id });
      } catch (e) {
        if (!(e instanceof ErreurDemo)) throw e;
      }
    },
    espace: () => setClient({ e: 'espace' }),
    ouvrir: (id: string) => setClient({ e: 'detail', id }),
    quitter: () => {
      setSession(null);
      setClient(jetonDemo ? { e: 'suivi', jeton: jetonDemo } : { e: 'depot', erreur: null, saisie: SAISIE_EXEMPLE, version: Date.now() });
    },
    confirmer: (id: string) => {
      if (!session) return;
      avancer(DUREE.client);
      tenter(() => moteur.confirmer(session, id), 'Réclamation clôturée : le client a confirmé la solution.');
    },
    contester: (id: string, motif: string) => {
      if (!session) return;
      avancer(DUREE.client);
      tenter(() => moteur.contester(session, id, motif), 'Contestation envoyée : la réclamation est rouverte et l\'agent est prévenu.');
    },
    envoyer: (id: string, texte: string) => {
      if (!session) return;
      avancer(DUREE.client);
      tenter(() => moteur.messageClient(session, id, texte), 'Message envoyé à la banque.');
    },
  };

  /* -------------------------------------------------------------- Le back-office */

  const actionsBanque = {
    role: (role: Role) =>
      setBanque((b) => {
        let ficheId = b.ficheId;
        if (ficheId) {
          try {
            moteur.fiche(UTILISATEUR[role], ficheId);
          } catch {
            ficheId = null; // cette personne ne voit pas la réclamation (un agent non assigné)
          }
        }
        const visibles: Record<Role, PageBackOffice[]> = {
          AGENT: ['reclamations', 'tableau'],
          SUPERVISEUR: ['reclamations', 'tableau', 'points', 'personnel'],
          ADMIN_ENTREPRISE: ['reclamations', 'tableau', 'categories', 'points', 'horaires', 'banque', 'personnel', 'audit'],
        };
        return { ...b, role, ficheId, notifs: false, page: visibles[role].includes(b.page) ? b.page : 'reclamations' };
      }),
    naviguer: (page: PageBackOffice) => setBanque((b) => ({ ...b, page, ficheId: null, notifs: false })),
    ouvrirFiche: (id: string) => setBanque((b) => ({ ...b, page: 'reclamations', ficheId: id, notifs: false })),
    fermerFiche: () => setBanque((b) => ({ ...b, ficheId: null })),
    cloche: () => setBanque((b) => ({ ...b, notifs: !b.notifs })),
    toutLire: () => moteur.toutLire(utilisateur),
    exporter: () => informer('Dans la version installée, l\'export CSV (séparateur « ; », accents lisibles dans Excel) se télécharge ici.', 'info'),
    couleur: (couleur: string) => {
      moteur.changerCouleur(couleur);
      const p = { ...prospect, couleur };
      setProspect(p);
      if (prospect.nom !== 'Banque Alpha' || couleur !== '#0b6e5f') enregistrerProspect(p);
      informer('Nouvelle couleur appliquée au portail et au back-office.');
    },
  };

  const nom = (id: string) => {
    const p = moteur.personne(id);
    return p ? `${p.prenom} ${p.nom}` : '';
  };

  function actionsFiche(id: string): ActionsFiche {
    return {
      retour: actionsBanque.fermerFiche,
      prendreEnCharge: () => {
        avancer(DUREE.prise);
        tenter(() => moteur.prendreEnCharge(utilisateur, id), 'Réclamation prise en charge : le client est prévenu par SMS.');
      },
      assigner: (agentId) => {
        avancer(DUREE.assignation);
        tenter(() => moteur.assigner(utilisateur, id, agentId), `Assignée à ${nom(agentId)}, prévenu(e) dans l'application et par e-mail.`);
      },
      repondre: (contenu, attendre) => {
        avancer(DUREE.reponse);
        tenter(
          () => moteur.repondre(utilisateur, id, contenu, attendre),
          attendre ? 'Question envoyée : le chrono SLA est en pause jusqu\'à la réponse du client.' : 'Réponse envoyée : le client reçoit un SMS avec le lien.',
        );
      },
      note: (contenu) => {
        avancer(DUREE.note);
        tenter(() => moteur.noteInterne(utilisateur, id, contenu), 'Note interne ajoutée, invisible du client.');
      },
      resoudre: (contenu) => {
        avancer(DUREE.resolution);
        tenter(() => moteur.resoudre(utilisateur, id, contenu), 'Réclamation résolue : le client peut confirmer ou contester.');
      },
      priorite: () => {
        avancer(DUREE.priorite);
        tenter(() => moteur.changerPriorite(utilisateur, id), 'Priorité changée.');
      },
      escalader: () => {
        avancer(DUREE.escalade);
        tenter(() => moteur.escalader(utilisateur, id), 'Réclamation escaladée au superviseur.');
      },
      cloturer: (motif, precision) => {
        avancer(DUREE.cloture);
        tenter(() => moteur.cloturerDeForce(utilisateur, id, motif, precision), 'Réclamation clôturée de force, motif inscrit au journal.');
      },
    };
  }

  /* -------------------------------------------------------------- Horloge */

  /** Avance l'horloge et dit ce que les tâches planifiées ont fait pendant ce temps. */
  const avancerHorloge = (minutes: number | Date) => {
    const compter = () => {
      let alertes = 0;
      let depassements = 0;
      let clotures = 0;
      for (const t of moteur.toutesLesReclamations()) {
        for (const e of t.evenements) {
          if (e.type === 'ALERTE_SLA_PREVENTIVE') alertes++;
          else if (e.type === 'DEPASSEMENT_SLA') depassements++;
          else if (e.type === 'CLOTURE_AUTOMATIQUE') clotures++;
        }
      }
      return { alertes, depassements, clotures };
    };
    const avant = compter();
    if (typeof minutes === 'number') moteur.avancer(minutes);
    else {
      moteur.avancerJusqua(minutes);
      moteur.avancer(0);
    }
    const apres = compter();
    const faits = [
      [apres.alertes - avant.alertes, 'alerte à 75 %', 'alertes à 75 %'],
      [apres.depassements - avant.depassements, 'dépassement escaladé', 'dépassements escaladés'],
      [apres.clotures - avant.clotures, 'clôture automatique', 'clôtures automatiques'],
    ]
      .filter(([n]) => (n as number) > 0)
      .map(([n, un, plusieurs]) => `${n} ${(n as number) > 1 ? plusieurs : un}`);
    informer(faits.length ? `Tâches planifiées : ${faits.join(', ')}.` : 'Rien à signaler pendant ce temps.', 'info');
  };

  /* -------------------------------------------------------------- Recommencer */

  const recommencer = (p: Prospect = prospect) => {
    const m = fabriquer(p);
    setProspect(p);
    setMoteur(m);
    setClientId(m.clientParTelephone(CLIENT_DEMO.telephoneE164)?.id ?? null);
    setClient({ e: 'depot', erreur: null, saisie: SAISIE_EXEMPLE, version: Date.now() });
    setBanque({ role: 'SUPERVISEUR', page: 'reclamations', ficheId: null, notifs: false });
    setSession(null);
    setDemoId(null);
    setJetonDemo(null);
    setSmsVus(new Set());
  };

  return {
    moteur,
    prospect,
    client,
    setClient,
    banque,
    setBanque,
    session,
    demoId,
    jetonDemo,
    utilisateur,
    sms: smsAffiche,
    messages,
    informer,
    actionsClient,
    actionsBanque,
    actionsFiche,
    avancerHorloge,
    recommencer,
  };
}

export type Demo = ReturnType<typeof useDemo>;
