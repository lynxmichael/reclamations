/**
 * Catalogue des écrans de l'étape 6 : pour chacun, les opérations du contrat qui l'alimentent,
 * les rôles qui le voient, ce qu'il faut en retenir et ses variantes (rôle, état).
 */
import type { ReactNode } from 'react';
import type { S } from '../api/types';
import { Accuse } from '../ecrans/portail/Accuse';
import { Assistant } from '../ecrans/portail/Assistant';
import { Avis } from '../ecrans/portail/Avis';
import { CodeOtp } from '../ecrans/portail/CodeOtp';
import { Depot, fichierExemple } from '../ecrans/portail/Depot';
import { MaReclamation } from '../ecrans/portail/MaReclamation';
import { MesReclamations } from '../ecrans/portail/MesReclamations';
import { AccueilPortail, Retrouver } from '../ecrans/portail/Retrouver';
import { Suivi } from '../ecrans/portail/Suivi';
import { Activation, CodeTotp, Connexion } from '../ecrans/connexion/Connexion';
import { Absences } from '../ecrans/back-office/Absences';
import { Agences } from '../ecrans/back-office/Agences';
import { Attribution } from '../ecrans/back-office/Attribution';
import { Audit } from '../ecrans/back-office/Audit';
import { Banque } from '../ecrans/back-office/Banque';
import { CadreBackOffice, type PageBackOffice } from '../ecrans/back-office/CadreBackOffice';
import { Categories } from '../ecrans/back-office/Categories';
import { BandeauDoubleAuthentification, Compte } from '../ecrans/back-office/Compte';
import { Conversations } from '../ecrans/back-office/Conversations';
import { Files } from '../ecrans/back-office/Files';
import { Horaires } from '../ecrans/back-office/Horaires';
import { NouvelleReclamation } from '../ecrans/back-office/NouvelleReclamation';
import { Personnel } from '../ecrans/back-office/Personnel';
import { PointsDepot } from '../ecrans/back-office/PointsDepot';
import { ReponsesAssistant } from '../ecrans/back-office/ReponsesAssistant';
import { TableauDeBord } from '../ecrans/back-office/TableauDeBord';
import { Ticket, type Fenetre } from '../ecrans/back-office/Ticket';
import { REGLES_PIECES } from '../ui/ChoixFichiers';
import { Activite, Alertes } from '../ecrans/plateforme/Activite';
import { Banques } from '../ecrans/plateforme/Banques';
import { CadreConsole, type PageConsole } from '../ecrans/plateforme/Console';
import { ALPHA, DOMAINE, MAINTENANT } from './donnees/commun';
import { ENROLEMENT_COMPTE, INDICATEURS_AGENCES } from './donnees/agences';
import { CONSOMMATION_IA, REPONSES_BANQUE, SUGGESTION_42, conversationAssistant } from './donnees/assistant';
import { ENROLEMENT, ERREUR_CONNEXION, ETAPE_TOTP } from './donnees/auth';
import {
  ABSENCES, AGENCES, AGENTS_DES_GROUPES, AYA, CATEGORIES, FATOU, GROUPES as GROUPES_AGENTS, HORAIRES, IBRAHIM, JOURS_FERIES, PAGE_PERSONNEL, PARAMETRES, POINTS_DEPOT, REGLES, SERGE, moi,
} from './donnees/parametrage';
import { ALERTES, FACTURATION_CANAUX, FACTURATION_SMS, INDICATEURS_PLATEFORME, PAGE_BANQUES, PLANS } from './donnees/plateforme';
import {
  ERREUR_DEPOT, MA_RECLAMATION_EN_COURS, MA_RECLAMATION_RESOLUE, MES_RECLAMATIONS, OTP_ACCES, OTP_ENVOYE, accuse, avis, formulaire, maReclamationChat, suivi, suiviClos, suiviRattache,
} from './donnees/portail';
import {
  ACCUSE_SAISIE_54, AGENTS_ASSIGNABLES, CONVERSATION_42, CONVERSATION_WHATSAPP, CONVERSATIONS_AGENT, CONVERSATIONS_SUPERVISEUR, CONVERSATIONS_SUPERVISEUR_TOUTES, ERREUR_SAISIE, FICHE_42, FICHE_52,
  FICHE_53, FICHE_54, INDICATEURS, INDISPONIBLES, JOURNAL, NOTIFICATIONS_AGENT, PAGE_AGENT, PAGE_SUPERVISEUR, VERIFICATION_CHAINE,
} from './donnees/reclamations';

export type Groupe = 'portail' | 'connexion' | 'back-office' | 'plateforme';

export const GROUPES: { cle: Groupe; titre: string; resume: string; parcours?: boolean }[] = [
  { cle: 'portail', titre: 'Portail client', resume: 'Sur téléphone, aux couleurs de la banque, du QR code à la clôture.', parcours: true },
  { cle: 'connexion', titre: 'Connexion du personnel', resume: 'Mot de passe, puis code TOTP quand la double authentification est active ou exigée par la banque.', parcours: true },
  { cle: 'back-office', titre: 'Back-office de la banque', resume: 'Agents, superviseurs et Admin Entreprise, sur ordinateur.' },
  { cle: 'plateforme', titre: 'Console de la plateforme', resume: 'Super Admin de Makor Telecoms : banques, activité, alertes.' },
];

export interface Variante {
  cle: string;
  libelle: string;
  options: { valeur: string; libelle: string }[];
}

export interface Contexte {
  /** Valeur choisie pour chaque variante (première option par défaut) */
  v: Record<string, string>;
  /** Banque du portail : Alpha, ou Horizon pour montrer une autre marque */
  banque: S<'BanquePublique'>;
}

export interface Ecran {
  id: string;
  groupe: Groupe;
  titre: string;
  format: 'mobile' | 'bureau';
  /** Adresse affichée dans la barre du navigateur */
  adresse: (banque: S<'BanquePublique'>) => string;
  /** operationId du contrat appelés par l'écran */
  operations: string[];
  /** Qui voit l'écran */
  roles: string;
  notes: string[];
  variantes?: Variante[];
  /** L'écran peut prendre les couleurs d'une autre banque */
  marque?: boolean;
  rendu: (ctx: Contexte) => ReactNode;
}

const PREFIXES: Record<string, string> = { alpha: 'ALP', horizon: 'HZN' };

/** Les données fictives sont celles de la Banque Alpha ; pour une autre banque, on change nom et préfixe. */
function pour<T>(valeur: T, banque: S<'BanquePublique'>): T {
  if (banque.slug === ALPHA.slug) return valeur;
  const prefixe = PREFIXES[banque.slug] ?? banque.slug.slice(0, 3).toUpperCase();
  return JSON.parse(JSON.stringify(valeur).replaceAll('ALP-', `${prefixe}-`).replaceAll(ALPHA.nom, banque.nom)) as T;
}

const site = (b: S<'BanquePublique'>, chemin: string) => `${b.slug}.${DOMAINE}${chemin}`;
const console_ = (chemin: string) => `console.${DOMAINE}${chemin}`;

const SUPERVISEUR = moi(SERGE, 'SUPERVISEUR');
const AGENT = moi(AYA, 'AGENT');
const ADMIN = moi(FATOU, 'ADMIN_ENTREPRISE');
const SUPER_ADMIN = moi({ id: '0199ffff-0000-7000-8000-000000000001', prenom: 'Awa', nom: 'Koné' }, 'SUPER_ADMIN');
const PROFILS = { SUPERVISEUR, AGENT, ADMIN_ENTREPRISE: ADMIN } as const;
const VU_PAR = (options: (keyof typeof PROFILS)[]): Variante => ({
  cle: 'role',
  libelle: 'Vu par',
  options: options.map((o) => ({ valeur: o, libelle: o === 'AGENT' ? 'Agent assigné' : o === 'SUPERVISEUR' ? 'Superviseur' : 'Admin Entreprise' })),
});

/** Nombre de réclamations à traiter, pour la pastille du menu. */
const aTraiter = (u: S<'Moi'>) => (u.role === 'AGENT' ? PAGE_AGENT.compteurs.assignees : PAGE_SUPERVISEUR.compteurs.recues);
const MINUTES_PAR_JOUR = 450; // 08:00–12:00 et 14:00–17:30

function backOffice(u: S<'Moi'>, page: PageBackOffice, contenu: ReactNode, notificationsOuvertes = false, bandeau?: ReactNode) {
  return (
    <CadreBackOffice
      bandeau={bandeau}
      banque={ALPHA}
      moi={u}
      page={page}
      aTraiter={aTraiter(u)}
      aRepondre={(u.role === 'AGENT' ? CONVERSATIONS_AGENT : CONVERSATIONS_SUPERVISEUR).compteurs.aRepondre}
      notifications={NOTIFICATIONS_AGENT}
      notificationsOuvertes={notificationsOuvertes}
      maintenant={MAINTENANT}
    >
      {contenu}
    </CadreBackOffice>
  );
}

function consoleSA(page: PageConsole, contenu: ReactNode) {
  return (
    <CadreConsole page={page} moi={SUPER_ADMIN} alertes={ALERTES.nonLues}>
      {contenu}
    </CadreConsole>
  );
}

export const ECRANS: Ecran[] = [
  /* ------------------------------------------------------------------ Portail client */
  {
    id: 'depot',
    groupe: 'portail',
    titre: 'Déposer une réclamation',
    format: 'mobile',
    adresse: (b) => site(b, '/d/7K3QX9P2MA'),
    operations: ['lireFormulaireDepot', 'lireDefiAntiRobot', 'deposerReclamation'],
    roles: 'Client, sans compte : il a scanné le QR code du hall de l\'agence Plateau.',
    notes: [
      'L\'agence vient du QR code : le client n\'a pas à la choisir. Avec un lien web, une liste « Agence concernée » facultative apparaît.',
      'Les catégories et leurs descriptions sont celles de la banque (paramétrage), dans son ordre.',
      'Un téléphone ou un e-mail au moins ; le téléphone est saisi librement et normalisé en +225 par l\'API.',
      'Variante « Erreurs » : la réponse 400 de l\'API (RFC 9457) s\'affiche en tête et sous chaque champ concerné.',
      'Le bouton reste visible en bas de l\'écran pendant le défilement.',
    ],
    variantes: [{ cle: 'etat', libelle: 'État', options: [{ valeur: 'saisie', libelle: 'Saisie' }, { valeur: 'erreurs', libelle: 'Erreurs' }] }],
    marque: true,
    rendu: ({ v, banque }) =>
      v.etat === 'erreurs' ? (
        <Depot
          formulaire={formulaire(banque)}
          erreur={ERREUR_DEPOT}
          saisie={{ categorieId: CATEGORIES[0]!.id, description: '', nom: 'Yao Kouassi', telephone: '07 08 09 10', email: '', consentement: true, fichiers: [] }}
        />
      ) : (
        <Depot
          formulaire={formulaire(banque)}
          saisie={{
            categorieId: CATEGORIES[0]!.id,
            description: "Mercredi soir vers 19 h, j'ai voulu retirer 50 000 FCFA au distributeur de l'agence. Il n'a pas donné les billets, mais mon compte a été débité.",
            nom: 'Yao Kouassi',
            telephone: '07 08 09 10 11',
            email: 'yao.kouassi@exemple.ci',
            consentement: true,
            fichiers: [fichierExemple('ticket-distributeur.jpg', 1_258_291)],
          }}
        />
      ),
  },
  {
    id: 'assistant',
    groupe: 'portail',
    titre: 'Assistant automatique',
    format: 'mobile',
    adresse: (b) => site(b, '/d/7K3QX9P2MA'),
    operations: ['lireFormulaireDepot', 'converserAvecAssistant'],
    roles: 'Client, sans compte, quand Makor a ouvert l\'assistant IA à la banque (étape 18, phase 2).',
    notes: [
      'L\'assistant se présente comme automatique et rappelle comment joindre une personne : « conseiller » transfère toujours, même sans IA (décision I3).',
      'Ce que lit le client vient de textes fixes et des réponses écrites par la banque : l\'IA ne fait que trier le message. Elle ne promet rien, ne change aucun statut, ne conseille pas (décision I4).',
      'Avant tout envoi à l\'IA, numéros de carte et de compte, IBAN, téléphones, e-mails et codes sont remplacés par des étiquettes (décision I5). Un code écrit en clair déclenche une mise en garde et n\'entre pas dans la réclamation.',
      'La proposition ouvre le formulaire prérempli : le client relit, ajoute ses coordonnées, accepte la politique de données et envoie lui-même.',
      'Sans fournisseur d\'IA, s\'il ne répond pas ou au-delà du plafond du jour, des règles de mots-clés répondent : le client ne voit pas la différence, sinon une compréhension moins fine.',
      'Variante « Conseiller, le soir » : la banque est fermée, l\'assistant donne l\'heure de reprise.',
    ],
    variantes: [{
      cle: 'etat',
      libelle: 'Conversation',
      options: [
        { valeur: 'faq', libelle: 'Question fréquente' },
        { valeur: 'depot', libelle: 'Réclamation préparée' },
        { valeur: 'conseiller', libelle: 'Conseiller, le soir' },
      ],
    }],
    marque: true,
    rendu: ({ v, banque }) => {
      const { fil, dernier } = v.etat === 'conseiller'
        ? conversationAssistant(banque.nom, ['Mon salaire de septembre n\'est pas arrivé', 'je veux parler à un conseiller'], false, 'demain à 8 h')
        : v.etat === 'depot'
          ? conversationAssistant(banque.nom, ['bjr', 'Le GAB de l\'agence a avalé ma carte hier soir vers 21h, je n\'ai pas pu la récupérer'])
          : conversationAssistant(banque.nom, ['Bonsoir, vous ouvrez à quelle heure le matin ?']);
      return (
        <Assistant
          key={v.etat}
          banque={banque}
          agence="Plateau"
          fil={fil}
          suggestions={dernier.suggestions}
          proposition={dernier.proposition}
          categorie={CATEGORIES.find((c) => c.id === dernier.proposition?.categorieId)?.nom}
        />
      );
    },
  },
  {
    id: 'accuse',
    groupe: 'portail',
    titre: 'Accusé de réception',
    format: 'mobile',
    adresse: (b) => site(b, '/d/7K3QX9P2MA/envoyee'),
    operations: ['deposerReclamation'],
    roles: 'Client, juste après l\'envoi.',
    notes: [
      'Le numéro est lisible à voix haute (chiffres bien distincts) : le client peut le donner au guichet ou au téléphone.',
      'Le même numéro et le lien de suivi partent par SMS et par e-mail. Ces messages ne contiennent jamais le texte de la réclamation (décision S10).',
    ],
    marque: true,
    rendu: ({ banque }) => <Accuse banque={banque} accuse={accuse(banque)} envoiPar="par SMS et par e-mail" />,
  },
  {
    id: 'suivi',
    groupe: 'portail',
    titre: 'Suivi par le lien reçu',
    format: 'mobile',
    adresse: (b) => site(b, '/suivi/Qm9uam91ckJhbnF1…'),
    operations: ['lireSuivi', 'lireDefiAntiRobot', 'demanderCodeOtp'],
    roles: 'Toute personne qui a le lien de suivi.',
    notes: [
      'Sans code, la page montre seulement le numéro, le statut, la catégorie et les étapes : ni description, ni messages, ni coordonnées.',
      'Les étapes restantes apparaissent en pointillé : le client voit ce qui l\'attend.',
      'Le code part par SMS si le client a donné un téléphone, sinon par e-mail (DemandeOtp).',
      'Variante « Close » (étape 15) : la banque a activé l\'enquête de satisfaction ; la page invite le client à donner son avis, sans code.',
      'Variante « Jointe à une autre » (étape 21) : ce doublon a été rattaché ; la page mène au suivi de la réclamation principale, sans enquête pour le doublon.',
    ],
    variantes: [{
      cle: 'etat',
      libelle: 'Réclamation',
      options: [{ valeur: 'en-cours', libelle: 'En cours' }, { valeur: 'close', libelle: 'Close, avis à donner' }, { valeur: 'rattachee', libelle: 'Jointe à une autre' }],
    }],
    marque: true,
    rendu: ({ v, banque }) => <Suivi suivi={v.etat === 'close' ? suiviClos(banque) : v.etat === 'rattachee' ? suiviRattache(banque) : suivi(banque)} />,
  },
  {
    id: 'retrouver',
    groupe: 'portail',
    titre: 'Retrouver mes réclamations',
    format: 'mobile',
    adresse: (b) => site(b, '/retrouver'),
    operations: ['lireBanquePortail', 'lireDefiAntiRobot', 'demanderCodeAcces', 'verifierCodeAcces'],
    roles: 'Le client qui a perdu son lien ou son numéro de suivi (étape 21).',
    notes: [
      'L\'accueil du portail (<slug>.<domaine>) et le formulaire de dépôt y mènent : « Lien perdu ? », « Déjà une réclamation ? Retrouvez-la ».',
      'Le client donne le téléphone ou l\'e-mail du dépôt, au portail comme au guichet. La réponse est la même que ce numéro soit connu ou non : le portail ne révèle pas qui a une réclamation.',
      'Défi anti-robot, 3 demandes par heure et par numéro ou adresse ; le code (6 chiffres, 10 minutes, 5 essais) ouvre l\'espace client avec toutes ses réclamations dans cette banque.',
      'Rien n\'est jamais envoyé ailleurs qu\'aux coordonnées du dossier ; aucun agent ne peut changer l\'adresse d\'envoi.',
    ],
    variantes: [{ cle: 'etape', libelle: 'Étape', options: [{ valeur: 'accueil', libelle: 'Accueil du portail' }, { valeur: 'contact', libelle: 'Téléphone ou e-mail' }, { valeur: 'code', libelle: 'Code reçu' }] }],
    marque: true,
    rendu: ({ v, banque }) =>
      v.etape === 'accueil' ? (
        <AccueilPortail banque={banque} />
      ) : v.etape === 'code' ? (
        <CodeOtp
          banque={banque}
          numero="07 08 09 10 11"
          otp={OTP_ACCES}
          saisi="27"
          aide="Rien reçu ? Ce numéro ou cette adresse n'a peut-être servi à aucune réclamation : essayez l'autre coordonnée donnée au dépôt."
        />
      ) : (
        <Retrouver banque={banque} contact="07 08 09 10 11" surRetour={() => undefined} />
      ),
  },
  {
    id: 'code',
    groupe: 'portail',
    titre: 'Code à usage unique',
    format: 'mobile',
    adresse: (b) => site(b, '/suivi/Qm9uam91ckJhbnF1…/code'),
    operations: ['verifierCodeOtp', 'lireDefiAntiRobot', 'demanderCodeOtp'],
    roles: 'Le client, avec le code reçu.',
    notes: [
      '6 chiffres, valable 10 minutes, 5 essais, 3 envois par heure (décision C7).',
      'Le téléphone propose le code reçu par SMS (autocomplete « one-time-code »).',
      'Le code ouvre une session de 30 minutes, limitée à ce client dans cette banque.',
    ],
    marque: true,
    rendu: ({ banque }) => <CodeOtp banque={banque} numero={accuse(banque).numero} otp={OTP_ENVOYE} saisi="4819" />,
  },
  {
    id: 'mes-reclamations',
    groupe: 'portail',
    titre: 'Espace client',
    format: 'mobile',
    adresse: (b) => site(b, '/espace'),
    operations: ['listerMesReclamations'],
    roles: 'Le client, après le code.',
    notes: [
      'Toutes les réclamations du client dans cette banque, reconnues par son téléphone ou son e-mail.',
      'Une réclamation résolue ressort : elle attend la confirmation du client.',
    ],
    marque: true,
    rendu: ({ banque }) => <MesReclamations banque={banque} reclamations={pour(MES_RECLAMATIONS, banque)} />,
  },
  {
    id: 'reclamation',
    groupe: 'portail',
    titre: 'Réponses et confirmation',
    format: 'mobile',
    adresse: (b) => site(b, '/espace/reclamations/2442'),
    operations: ['lireMaReclamation', 'envoyerMessageClient', 'confirmerResolution', 'contesterResolution', 'telechargerPieceJointeClient'],
    roles: 'Le client, après le code.',
    notes: [
      'Les boutons « Oui, clôturer » et « Non, je conteste » n\'apparaissent que si l\'API les renvoie dans actionsPossibles.',
      'La zone « Écrire à la banque » dépend de operationsPossibles (MESSAGE_DU_CLIENT) : fermée une fois la réclamation résolue (S11). Ce champ a été ajouté au contrat par cette étape.',
      'Le client ne voit ni les notes internes, ni le nom de l\'agent : les réponses sont signées par la banque.',
      'La date de clôture automatique est rappelée : sans réponse, la réclamation se ferme seule.',
    ],
    variantes: [{ cle: 'statut', libelle: 'Réclamation', options: [{ valeur: 'resolue', libelle: 'Résolue, à confirmer' }, { valeur: 'en-cours', libelle: 'En cours' }] }],
    marque: true,
    rendu: ({ v, banque }) => (
      <MaReclamation banque={banque} reclamation={pour(v.statut === 'en-cours' ? MA_RECLAMATION_EN_COURS : MA_RECLAMATION_RESOLUE, banque)} />
    ),
  },

  {
    id: 'chat',
    groupe: 'portail',
    titre: 'Chat avec la banque',
    format: 'mobile',
    adresse: (b) => site(b, '/espace/reclamations/2442'),
    operations: ['lireMaReclamation', 'lireConversationClient', 'marquerConversationLueClient', 'envoyerMessageClient'],
    roles: 'Le client, après le code, quand Makor a ouvert le chat web à la banque (étape 17, phase 2).',
    notes: [
      'Intégré au portail de la banque : même adresse, même politique de sécurité du contenu, aucun script ni service tiers (décision I8).',
      'Les nouveaux messages arrivent toutes les 5 secondes tant que la page est à l\'écran (lireConversationClient, à partir du dernier reçu).',
      'Le client parle à la banque, jamais à un agent nommé. « Lu » sous son dernier message quand la banque l\'a lu.',
      'En tête, la disponibilité : ouverte, ou fermée avec l\'heure de reprise (horaires et jours fériés de la banque).',
      'Une réponse lue dans le chat n\'envoie ni SMS ni e-mail ; non lue 2 minutes après, le client est prévenu.',
      'Entrée envoie, Maj + Entrée passe à la ligne ; le fil est un journal (role="log") lu par les lecteurs d\'écran.',
    ],
    variantes: [{ cle: 'etat', libelle: 'Banque', options: [{ valeur: 'ouverte', libelle: 'Ouverte' }, { valeur: 'fermee', libelle: 'Fermée (le soir)' }] }],
    marque: true,
    rendu: ({ v, banque }) => <MaReclamation key={v.etat} banque={banque} reclamation={pour(maReclamationChat(v.etat !== 'fermee'), banque)} />,
  },

  {
    id: 'avis',
    groupe: 'portail',
    titre: 'Enquête de satisfaction',
    format: 'mobile',
    adresse: (b) => site(b, '/suivi/Qm9uam91ckJhbnF1…/avis'),
    operations: ['lireAvis', 'donnerAvis'],
    roles: 'Le client, depuis le lien du message de clôture ou le bouton du suivi (étape 15, phase 2).',
    notes: [
      'Ouverte à la clôture confirmée par le client ou automatique, jamais à une clôture forcée ; seulement si le Super Admin l\'a activée pour la banque (décision I2).',
      'Deux questions : satisfaction sur le traitement, de 1 à 5 (CSAT), et recommandation de la banque, de 0 à 10 (NPS). Un commentaire facultatif, 1000 caractères au plus.',
      'Une seule réponse, pendant 7 jours ; elle ne se modifie plus (409 AVIS_DEJA_DONNE, 422 ENQUETE_TERMINEE).',
      'Les notes sont des boutons radio de 48 px : faciles à toucher, lus par les lecteurs d\'écran (« 4 sur 5, satisfait »).',
    ],
    variantes: [{
      cle: 'etat',
      libelle: 'Enquête',
      options: [{ valeur: 'A_DONNER', libelle: 'À donner' }, { valeur: 'DONNE', libelle: 'Avis donné' }, { valeur: 'TERMINE', libelle: 'Terminée' }],
    }],
    marque: true,
    rendu: ({ v, banque }) => <Avis key={v.etat} avis={avis(banque, v.etat as S<'EtatAvis'>)} />,
  },

  /* ------------------------------------------------------------------ Connexion */
  {
    id: 'connexion',
    groupe: 'connexion',
    titre: 'Connexion',
    format: 'bureau',
    adresse: (b) => site(b, '/back-office/connexion'),
    operations: ['connexion', 'demanderReinitialisation'],
    roles: 'Agents, superviseurs, Admin Entreprise.',
    notes: [
      'Le back-office est servi sur l\'adresse de la banque : même origine que l\'API, donc pas de CORS (décision C2).',
      'Variante « Erreur » : le message ne dit pas si l\'e-mail existe (pas d\'indice pour un attaquant) et rappelle le verrouillage après 5 échecs.',
    ],
    variantes: [{ cle: 'etat', libelle: 'État', options: [{ valeur: 'normal', libelle: 'Saisie' }, { valeur: 'erreur', libelle: 'Erreur' }] }],
    marque: true,
    rendu: ({ v, banque }) => <Connexion banque={banque} erreur={v.etat === 'erreur' ? ERREUR_CONNEXION : null} />,
  },
  {
    id: 'totp',
    groupe: 'connexion',
    titre: 'Code TOTP',
    format: 'bureau',
    adresse: (b) => site(b, '/back-office/connexion/code'),
    operations: ['validerCodeTotp'],
    roles: 'Le personnel dont la double authentification est active, à chaque connexion ; le Super Admin toujours.',
    notes: [
      'Seconde étape quand la personne a activé la double authentification (étape 19 : facultative par défaut, exigée si l\'Admin Entreprise l\'a décidé). Le jeton intermédiaire expire après 5 minutes.',
      'Sans double authentification, la connexion s\'ouvre directement après le mot de passe (SESSION_OUVERTE).',
      'En cas de téléphone perdu, l\'Admin Entreprise réinitialise le TOTP depuis l\'écran Personnel.',
    ],
    marque: true,
    rendu: ({ banque }) => <CodeTotp banque={banque} etape={ETAPE_TOTP} />,
  },
  {
    id: 'activation',
    groupe: 'connexion',
    titre: 'Première connexion',
    format: 'bureau',
    adresse: (b) => site(b, '/back-office/invitation'),
    operations: ['accepterInvitation', 'activerTotp'],
    roles: 'Une personne invitée, depuis le lien de son e-mail d\'invitation, quand sa banque exige la double authentification.',
    notes: [
      'Étape 1 : choix du mot de passe (12 caractères au moins, refusé s\'il est trop courant). Étape 2 ici, seulement si la banque exige la double authentification : activation du TOTP. Sinon, la console s\'ouvre et la personne l\'active quand elle veut depuis « Mon compte » (étape 19).',
      'Le QR code encode l\'adresse otpauth:// ; la clé est aussi donnée en clair, par groupes de 4, pour une saisie manuelle.',
    ],
    marque: true,
    rendu: ({ banque }) => <Activation banque={banque} enrolement={ENROLEMENT} />,
  },

  /* ------------------------------------------------------------------ Back-office */
  {
    id: 'files',
    groupe: 'back-office',
    titre: 'Files de traitement',
    format: 'bureau',
    adresse: () => site(ALPHA, '/back-office/reclamations'),
    operations: ['listerReclamations', 'exporterReclamations', 'listerNotifications', 'assignerReclamation'],
    roles: 'Agent (ses réclamations), superviseur et Admin Entreprise (toute la banque).',
    notes: [
      'Les onglets sont les files du §6.2. Leurs pastilles viennent du champ « compteurs », ajouté au contrat par cette étape : une seule requête suffit.',
      'Le chrono de chaque ligne vient du champ « sla » (SlaResume), aussi ajouté : l\'interface ne recalcule jamais le temps ouvré.',
      'Tri par défaut : échéance la plus proche. Les réclamations en retard remontent en tête.',
      'Le superviseur assigne depuis la file « Reçues » ; l\'agent n\'a pas cette file.',
      'Variante « Notifications » : le panneau des notifications in-app, avec les alertes SLA.',
      'Mode suggestion (étape 16) : pour une réclamation non assignée, le superviseur voit l\'agent proposé (agentSuggere) et valide d\'un clic.',
      'Étape 21 : « Nouvelle réclamation » pour un client au guichet ou au téléphone ; badge « Doublon possible » quand le même client a une autre réclamation de la même catégorie en cours (ici Yao Kouassi, 2442 et 2453).',
      'Étape 21 : l\'onglet « À réassigner » réunit les réclamations d\'un agent désactivé ou absent aujourd\'hui (ici Adjoua). Le superviseur coche et assigne à un agent, ou répartit entre les agents disponibles (assignerEnLot, 100 au plus).',
    ],
    variantes: [
      VU_PAR(['SUPERVISEUR', 'AGENT']),
      { cle: 'file', libelle: 'File', options: [{ valeur: 'defaut', libelle: 'Par défaut' }, { valeur: 'a-reassigner', libelle: 'À réassigner, sélection' }] },
      { cle: 'notifs', libelle: 'Notifications', options: [{ valeur: 'fermees', libelle: 'Fermées' }, { valeur: 'ouvertes', libelle: 'Ouvertes' }] },
    ],
    rendu: ({ v }) => {
      const u = PROFILS[v.role as keyof typeof PROFILS];
      const reassigner = v.file === 'a-reassigner' && u.role !== 'AGENT';
      const page = u.role === 'AGENT' ? PAGE_AGENT : PAGE_SUPERVISEUR;
      return backOffice(
        u,
        'reclamations',
        <Files
          key={`${v.role}-${v.file}`}
          page={page}
          moi={u}
          maintenant={MAINTENANT}
          seuil={PARAMETRES.seuilAlerteSlaPourcent}
          fileInitiale={reassigner ? 'a-reassigner' : 'toutes'}
          indisponibles={INDISPONIBLES}
          selectionInitiale={reassigner ? page.donnees.filter((r) => r.statut !== 'CLOTUREE' && r.agent && INDISPONIBLES.includes(r.agent.id)).map((r) => r.id) : undefined}
          references={{ categories: [], agences: [], agents: AGENTS_ASSIGNABLES.filter((a) => !INDISPONIBLES.includes(a.id)) }}
          surNouvelle={() => undefined}
          surAssignerEnLot={u.role === 'SUPERVISEUR' ? () => false : undefined}
        />,
        v.notifs === 'ouvertes',
      );
    },
  },
  {
    id: 'ticket',
    groupe: 'back-office',
    titre: 'Fiche d\'une réclamation',
    format: 'bureau',
    adresse: () => site(ALPHA, '/back-office/reclamations/ALP-2026-002442'),
    operations: [
      'lireReclamation', 'prendreEnCharge', 'assignerReclamation', 'repondreAuClient', 'ajouterNoteInterne', 'resoudreReclamation',
      'changerPriorite', 'escaladerReclamation', 'cloturerDeForce', 'telechargerPieceJointe',
    ],
    roles: 'Agent assigné et superviseurs agissent ; l\'Admin Entreprise consulte (décision S3).',
    notes: [
      'Chaque bouton vient de actionsPossibles ou operationsPossibles. Changez « Vu par » : l\'agent peut escalader, le superviseur assigner et clôturer de force, l\'Admin Entreprise lit seulement.',
      'Réponse au client et note interne sont deux onglets distincts ; la note est sur fond ambre, marquée « invisible du client ».',
      '« Attendre la réponse du client » transforme la réponse en question : le chrono SLA se met en pause (étape 4).',
      'Résoudre exige une réponse finale ; la clôture forcée exige un motif et une précision.',
      'Chat web (étape 17) : le panneau « Chat web » dit si le client est en ligne et s\'il attend une réponse ; « Ouvrir la conversation » mène à la boîte de réception.',
      'Étape 22 : « Messages au client » liste les e-mails et SMS envoyés au client, coordonnée masquée et état (remis, envoyé, non remis…), jamais leur texte.',
    ],
    variantes: [
      VU_PAR(['AGENT', 'SUPERVISEUR', 'ADMIN_ENTREPRISE']),
      {
        cle: 'fenetre',
        libelle: 'Fenêtre',
        options: [
          { valeur: 'aucune', libelle: 'Aucune' },
          { valeur: 'resoudre', libelle: 'Résoudre' },
          { valeur: 'cloturer', libelle: 'Clôture forcée' },
        ],
      },
    ],
    rendu: ({ v }) => {
      const role = v.role as keyof typeof FICHE_42;
      return backOffice(
        PROFILS[role],
        'reclamations',
        <Ticket
          key={`${role}-${v.fenetre}`}
          r={FICHE_42[role]}
          agents={AGENTS_ASSIGNABLES}
          fenetre={v.fenetre as Fenetre}
          delaiClotureJours={PARAMETRES.delaiClotureAutoJours}
          seuil={PARAMETRES.seuilAlerteSlaPourcent}
        />,
      );
    },
  },
  {
    id: 'ticket-suggestion',
    groupe: 'back-office',
    titre: 'Fiche à assigner, agent suggéré',
    format: 'bureau',
    adresse: () => site(ALPHA, '/back-office/reclamations/ALP-2026-002452'),
    operations: ['lireReclamation', 'assignerReclamation'],
    roles: 'Superviseur, quand la banque est en mode suggestion (étape 16).',
    notes: [
      'L\'API propose l\'agent disponible le moins chargé du groupe de la catégorie ou de l\'agence (attributionSuggeree) ; le superviseur valide ou choisit un autre agent.',
      'Ici, Adjoua est absente et Aya a plus de réclamations à traiter : Mamadou est proposé.',
      'En mode automatique, la réclamation part directement à cet agent au dépôt ; la chronologie montre « Attribution automatique », par le système.',
    ],
    rendu: () =>
      backOffice(
        SUPERVISEUR,
        'reclamations',
        <Ticket r={FICHE_52} agents={AGENTS_ASSIGNABLES} delaiClotureJours={PARAMETRES.delaiClotureAutoJours} seuil={PARAMETRES.seuilAlerteSlaPourcent} />,
      ),
  },
  {
    id: 'ticket-brouillon',
    groupe: 'back-office',
    titre: 'Fiche, brouillon de l\'assistant IA',
    format: 'bureau',
    adresse: () => site(ALPHA, '/back-office/reclamations/ALP-2026-002442'),
    operations: ['lireReclamation', 'suggererReponse', 'repondreAuClient', 'changerPriorite'],
    roles: 'Agent assigné et superviseurs, quand Makor a ouvert l\'assistant IA à la banque (étape 18).',
    notes: [
      '« Suggérer une réponse » remplit la zone de réponse avec un brouillon : rien ne part, rien ne change sur la réclamation. L\'agent relit, corrige et envoie lui-même (décision I4).',
      'Les interdits sont signalés en rouge et revérifiés à chaque frappe : ici, « vous serez remboursé sous 48 heures » promet un remboursement et un délai. Corriger le texte fait disparaître l\'alerte.',
      'Une catégorie plus juste et l\'urgence peuvent être suggérées, à titre indicatif ; « Passer en urgent » reste l\'action habituelle.',
      'Seuls partent, masqués, la description et les derniers messages publics : ni nom, ni coordonnées, ni notes internes, ni pièces jointes (décision I5).',
      'Sans IA (ou si elle ne répond pas), un brouillon type sûr, avec la réponse validée de la banque qui s\'applique.',
    ],
    rendu: () =>
      backOffice(
        AGENT,
        'reclamations',
        <Ticket
          r={{ ...FICHE_42.AGENT, depotAssistant: true }}
          agents={AGENTS_ASSIGNABLES}
          delaiClotureJours={PARAMETRES.delaiClotureAutoJours}
          seuil={PARAMETRES.seuilAlerteSlaPourcent}
          suggestions={{ ia: SUGGESTION_42 }}
          actions={{ suggerer: async () => SUGGESTION_42 }}
        />,
      ),
  },
  {
    id: 'ticket-doublon',
    groupe: 'back-office',
    titre: 'Doublon possible et rattachement',
    format: 'bureau',
    adresse: () => site(ALPHA, '/back-office/reclamations/ALP-2026-002453'),
    operations: ['lireReclamation', 'rattacherReclamation', 'renvoyerLienSuivi'],
    roles: 'Superviseur, ou agent assigné aux deux réclamations (étape 21).',
    notes: [
      'Doublon possible : même client (reconnu à son téléphone ou à son e-mail), même catégorie, toutes deux en cours, déposées à moins de 30 jours d\'écart. Rien n\'est fusionné de soi-même : c\'est signalé.',
      '« Du même client » liste ses 10 dernières réclamations ; un agent ne peut ouvrir que les siennes.',
      'Rattacher clôture ce doublon (motif « Doublon ») et le joint à la réclamation choisie, du même client et en cours. Ses messages et pièces jointes restent consultables ; le client reçoit un seul message, avec le lien de la principale, et pas d\'enquête.',
      '« Renvoyer le lien de suivi » : au téléphone ou à l\'e-mail du dossier seulement, 3 fois par heure.',
    ],
    variantes: [{ cle: 'fenetre', libelle: 'Fenêtre', options: [{ valeur: 'aucune', libelle: 'Aucune' }, { valeur: 'rattacher', libelle: 'Rattacher' }] }],
    rendu: ({ v }) =>
      backOffice(
        SUPERVISEUR,
        'reclamations',
        <Ticket
          key={v.fenetre}
          r={FICHE_53}
          agents={AGENTS_ASSIGNABLES}
          fenetre={v.fenetre as Fenetre}
          delaiClotureJours={PARAMETRES.delaiClotureAutoJours}
          seuil={PARAMETRES.seuilAlerteSlaPourcent}
        />,
      ),
  },
  {
    id: 'nouvelle-reclamation',
    groupe: 'back-office',
    titre: 'Saisie au guichet ou au téléphone',
    format: 'bureau',
    adresse: () => site(ALPHA, '/back-office/reclamations/nouvelle'),
    operations: ['listerCategories', 'listerAgences', 'saisirReclamation', 'lireReclamation'],
    roles: 'Agent et superviseur, pour un client sans smartphone ou qui préfère en parler (étape 21).',
    notes: [
      'Canal « Guichet » (agence obligatoire) ou « Téléphone » : deux canaux de plus, comptés à part dans le tableau de bord et l\'activité des agences.',
      'Mêmes règles qu\'au portail : un téléphone ou un e-mail au moins, pièces jointes contrôlées. Le client est informé de la politique de données ; son accord oral est inscrit au journal, au nom de l\'agent.',
      'L\'agent qui saisit se l\'assigne (sinon, les règles d\'attribution) ; « Urgente » au besoin.',
      'Le récépissé s\'imprime seul (numéro, date, QR code du suivi) ; le client reçoit aussi son numéro par SMS ou e-mail. Le lien n\'est montré qu\'une fois au personnel.',
      'Variante « Fiche » : la réclamation saisie, avec « Saisie par Aya Konan » dans le dépôt et la chronologie.',
    ],
    variantes: [{
      cle: 'etat',
      libelle: 'État',
      options: [{ valeur: 'saisie', libelle: 'Saisie' }, { valeur: 'erreurs', libelle: 'Erreurs' }, { valeur: 'recepisse', libelle: 'Récépissé' }, { valeur: 'fiche', libelle: 'Fiche' }],
    }],
    rendu: ({ v }) => {
      const saisie = {
        canal: 'GUICHET' as const, agenceId: AGENCES[0]!.id, categorieId: CATEGORIES[3]!.id,
        description: FICHE_54.description, nom: 'Ahou Kouamé', telephone: '01 01 02 03 04', email: '', consentementInforme: true, urgente: false, meLAssigner: true,
        fichiers: [fichierExemple('releve-aout.pdf', 412_000)],
      };
      if (v.etat === 'fiche') {
        return backOffice(
          AGENT,
          'reclamations',
          <Ticket r={FICHE_54} agents={AGENTS_ASSIGNABLES} delaiClotureJours={PARAMETRES.delaiClotureAutoJours} seuil={PARAMETRES.seuilAlerteSlaPourcent} />,
        );
      }
      return backOffice(
        AGENT,
        'reclamations',
        <NouvelleReclamation
          key={v.etat}
          banque={ALPHA}
          moi={AGENT}
          categories={CATEGORIES.filter((c) => c.active).map((c) => ({ id: c.id, nom: c.nom }))}
          agences={AGENCES.filter((a) => a.active).map((a) => ({ id: a.id, nom: a.nom }))}
          regles={REGLES_PIECES}
          lienPolitique={`https://${ALPHA.slug}.${DOMAINE}/politique-donnees`}
          saisie={v.etat === 'erreurs' ? { ...saisie, agenceId: '', telephone: '01 02 03 04' } : saisie}
          erreur={v.etat === 'erreurs' ? ERREUR_SAISIE : null}
          accuse={v.etat === 'recepisse' ? { accuse: ACCUSE_SAISIE_54, saisie } : null}
        />,
      );
    },
  },
  {
    id: 'ticket-envois',
    groupe: 'back-office',
    titre: 'Fiche : message non remis, pièces jointes analysées',
    format: 'bureau',
    adresse: () => site(ALPHA, '/back-office/reclamations/ALP-2026-002454'),
    operations: ['lireReclamation', 'renvoyerMessage', 'telechargerPieceJointe', 'listerReclamations'],
    roles: 'Agent assigné et superviseur renvoient un message ; l\'Admin Entreprise consulte (étape 22).',
    notes: [
      'Le téléphone d\'Ahou Kouamé était éteint : la passerelle a renvoyé un accusé « non remis ». Aya est prévenue dans l\'application, la file montre « Message non remis », la fiche le bandeau et « Renvoyer ».',
      'Renvoyer : le même message, à la même coordonnée (celle du dossier), 3 fois par heure. Seuls les messages dont le texte est gardé se renvoient (accusé, statut, réponse, résolution, clôture, lien de suivi), pas un code ni un message de conversation.',
      'Un SMS en échec passager est réessayé 1, 5, 30 puis 120 minutes après (« Nouvel essai prévu ») ; un numéro invalide ou refusé ne se réessaie pas. Un e-mail « Envoyé » est accepté par le serveur d\'envoi : il n\'a pas d\'accusé de remise.',
      'Pièces jointes : photos, PDF et documents Word (.docx sans macro), 10 Mo chacun, analysés par l\'antivirus. Antivirus indisponible : « Analyse en cours », non téléchargeable, analysé par le worker dès son retour. Virus trouvé ensuite : le fichier est effacé, l\'agent prévenu, le journal d\'audit le note.',
    ],
    variantes: [
      VU_PAR(['AGENT', 'ADMIN_ENTREPRISE']),
      {
        cle: 'pieces',
        libelle: 'Pièces jointes',
        options: [
          { valeur: 'saines', libelle: 'Analysées, saines' },
          { valeur: 'analyse', libelle: 'Analyse en cours' },
          { valeur: 'virus', libelle: 'Virus trouvé' },
        ],
      },
    ],
    rendu: ({ v }) => {
      const [releve, courrier] = FICHE_54.piecesJointes;
      const pieces = v.pieces === 'analyse'
        ? [releve!, { ...courrier!, antivirus: 'EN_ATTENTE' as const }]
        : v.pieces === 'virus' ? [releve!, { ...courrier!, nomFichier: 'facture-impayee.docx', antivirus: 'INFECTE' as const }] : [releve!, courrier!];
      const admin = v.role === 'ADMIN_ENTREPRISE';
      const r: S<'ReclamationDetail'> = {
        ...FICHE_54,
        piecesJointes: pieces,
        envois: FICHE_54.envois.map((e) => ({ ...e, renvoyable: e.renvoyable && !admin })),
        ...(admin ? { actionsPossibles: [], operationsPossibles: ['CONSULTER' as const] } : {}),
      };
      return backOffice(
        admin ? PROFILS.ADMIN_ENTREPRISE : AGENT,
        'reclamations',
        <Ticket key={`${v.role}-${v.pieces}`} r={r} agents={AGENTS_ASSIGNABLES} delaiClotureJours={PARAMETRES.delaiClotureAutoJours} seuil={PARAMETRES.seuilAlerteSlaPourcent} />,
      );
    },
  },
  {
    id: 'conversations',
    groupe: 'back-office',
    titre: 'Boîte de réception',
    format: 'bureau',
    adresse: () => site(ALPHA, '/back-office/conversations'),
    operations: ['listerConversations', 'lireConversation', 'marquerConversationLue', 'repondreAuClient'],
    roles: 'Agent (ses réclamations), superviseur et Admin Entreprise (toute la banque, l\'Admin en lecture) ; quand le chat web est ouvert (étape 17).',
    notes: [
      '« À répondre » : le client a écrit en dernier, la plus longue attente en tête. « Non lues » : un message attend la lecture de la banque.',
      'Une conversation est lue quand l\'agent assigné l\'ouvre (un superviseur si la réclamation n\'est pas assignée) ; un superviseur qui la regarde ne la marque pas lue à sa place.',
      'Le rond vert : le client a le chat à l\'écran. « Lu par le client » sous la dernière réponse.',
      'La réponse part par repondreAuClient, comme depuis la fiche : chrono SLA, première réponse et « Attendre sa réponse » sont les mêmes. Les notes internes restent sur la fiche.',
      'Une rafale de messages du client ne donne qu\'une alerte à l\'agent. La liste se relit toutes les 10 secondes, la conversation toutes les 5.',
      'Étape 20 : les messages écrits sur WhatsApp ou par SMS entrent dans la même boîte, avec leur canal. La réponse part là où le client a écrit en dernier : sur WhatsApp, telle quelle, tant que la fenêtre de 24 h de Meta est ouverte ; par SMS, du numéro de la banque (nombre de SMS facturés affiché) ; sinon dans son suivi, avec un avis par e-mail ou SMS (reponseVers).',
    ],
    variantes: [
      VU_PAR(['AGENT', 'SUPERVISEUR', 'ADMIN_ENTREPRISE']),
      { cle: 'filtre', libelle: 'Onglet', options: [{ valeur: 'a-repondre', libelle: 'À répondre' }, { valeur: 'toutes', libelle: 'Toutes' }] },
      { cle: 'canal', libelle: 'Conversation', options: [{ valeur: 'web', libelle: 'Chat du portail' }, { valeur: 'whatsapp', libelle: 'WhatsApp (étape 20)' }] },
    ],
    rendu: ({ v }) => {
      const role = v.role as keyof typeof PROFILS;
      const agent = role === 'AGENT';
      const page = agent ? CONVERSATIONS_AGENT : v.filtre === 'toutes' ? CONVERSATIONS_SUPERVISEUR_TOUTES : CONVERSATIONS_SUPERVISEUR;
      const selection = v.canal === 'whatsapp' ? CONVERSATION_WHATSAPP
        : role === 'ADMIN_ENTREPRISE' ? CONVERSATION_42.ADMIN_ENTREPRISE : role === 'SUPERVISEUR' ? CONVERSATION_42.SUPERVISEUR : CONVERSATION_42.AGENT;
      return backOffice(
        PROFILS[role],
        'conversations',
        <Conversations key={`${role}-${v.filtre}`} page={page} filtre={agent ? 'a-repondre' : (v.filtre as 'a-repondre' | 'toutes')} selection={selection} maintenant={MAINTENANT} />,
      );
    },
  },
  {
    id: 'tableau',
    groupe: 'back-office',
    titre: 'Tableau de bord',
    format: 'bureau',
    adresse: () => site(ALPHA, '/back-office/tableau-de-bord'),
    operations: ['lireIndicateurs', 'exporterReclamations'],
    roles: 'Superviseur et Admin Entreprise, sur toute la banque ; l\'agent a le sien, limité à ses réclamations (étape 11).',
    notes: [
      'Les indicateurs du §6.6, calculés par l\'API sur la période et les filtres choisis.',
      'En ce moment : les réclamations non clôturées à traiter, en attente du client, en alerte et en retard, quelle que soit la période (étape 11).',
      'Les délais sont en temps ouvré. Le délai de résolution inclut l\'attente du client ; le taux SLA ne compte pas les clôtures forcées sans résolution (S5, S6).',
      'Courbe d\'évolution par jour ou par semaine (étape 9).',
      'Satisfaction des clients (étape 15) : taux de réponse, satisfaits (notes 4 et 5), note moyenne, NPS, par agent et derniers commentaires ; seulement si la banque a des enquêtes.',
    ],
    rendu: () => backOffice(SUPERVISEUR, 'tableau', <TableauDeBord indicateurs={INDICATEURS} />),
  },
  {
    id: 'agences',
    groupe: 'back-office',
    titre: 'Activité des agences',
    format: 'bureau',
    adresse: () => site(ALPHA, '/back-office/agences'),
    operations: ['lireIndicateursAgences'],
    roles: 'Admin Entreprise et superviseur : toutes les agences de la banque (étape 19).',
    notes: [
      'Une ligne par agence sur la période : réclamations, urgentes, résolues, délais en temps ouvré, respect du SLA, charge en ce moment, satisfaction.',
      'En tête, des repères : agences sollicitées, la plus sollicitée, le meilleur respect du SLA, celles qui ont des réclamations en retard.',
      'Le détail d\'une agence : ses catégories les plus fréquentes, ses agents les plus sollicités et chacun de ses QR codes avec son volume ; liens vers le tableau de bord et les réclamations de l\'agence.',
      'Les dépôts par lien web sans agence forment la dernière ligne, « Sans agence » : la somme des lignes est le total du tableau de bord.',
      'Mêmes filtres que le tableau de bord (période, catégorie, canal) et export CSV.',
    ],
    variantes: [{ cle: 'detail', libelle: 'Détail', options: [{ valeur: 'plateau', libelle: 'Plateau déplié' }, { valeur: 'aucun', libelle: 'Liste' }] }],
    rendu: ({ v }) =>
      backOffice(ADMIN, 'agences', <Agences key={v.detail} indicateurs={INDICATEURS_AGENCES} ouverte={v.detail === 'plateau' ? AGENCES[0]!.id : null} />),
  },
  {
    id: 'categories',
    groupe: 'back-office',
    titre: 'Catégories et délais',
    format: 'bureau',
    adresse: () => site(ALPHA, '/back-office/parametrage/categories'),
    operations: ['listerCategories', 'creerCategorie', 'modifierCategorie'],
    roles: 'Admin Entreprise.',
    notes: [
      'Le délai s\'exprime en heures ouvrées, avec son équivalent en jours d\'ouverture de la banque.',
      'Une catégorie désactivée n\'est plus proposée au client mais reste sur les anciennes réclamations.',
      'Le panneau rappelle qu\'un nouveau délai ne touche pas les réclamations en cours (délai copié au dépôt).',
    ],
    rendu: () => backOffice(ADMIN, 'categories', <Categories categories={CATEGORIES} enEdition={CATEGORIES[2]!.id} minutesParJour={MINUTES_PAR_JOUR} />),
  },
  {
    id: 'points',
    groupe: 'back-office',
    titre: 'Agences et QR codes',
    format: 'bureau',
    adresse: () => site(ALPHA, '/back-office/parametrage/points-de-depot'),
    operations: ['listerAgences', 'creerAgence', 'listerPointsDepot', 'creerPointDepot', 'modifierPointDepot', 'telechargerQrCode'],
    roles: 'Admin Entreprise (crée, désactive) ; superviseur (télécharge les QR codes).',
    notes: [
      'Un QR code par emplacement physique, regroupés par agence. PNG pour l\'écran, SVG pour l\'impression.',
      'Un point désactivé refuse les dépôts (POINT_DE_DEPOT_INACTIF) : le QR code déjà affiché ne marche plus.',
      'Les liens web n\'ont pas d\'agence ; le client peut en indiquer une.',
      'Étape 20 : les numéros WhatsApp et SMS de la banque, raccordés et ouverts par Makor, avec l\'adresse qui ouvre la conversation (wa.me, sms:) et le QR code WhatsApp à afficher. La banque ne les crée ni ne les désactive.',
    ],
    variantes: [VU_PAR(['ADMIN_ENTREPRISE', 'SUPERVISEUR'])],
    rendu: ({ v }) => {
      const u = PROFILS[v.role as keyof typeof PROFILS];
      return backOffice(u, 'points', <PointsDepot agences={AGENCES} points={POINTS_DEPOT} modifiable={u.role === 'ADMIN_ENTREPRISE'} />);
    },
  },
  {
    id: 'horaires',
    groupe: 'back-office',
    titre: 'Horaires et jours fériés',
    format: 'bureau',
    adresse: () => site(ALPHA, '/back-office/parametrage/horaires'),
    operations: ['lireHoraires', 'remplacerHoraires', 'listerJoursFeries', 'ajouterJourFerie', 'supprimerJourFerie'],
    roles: 'Admin Entreprise ; les autres rôles consultent.',
    notes: [
      'Plusieurs plages par jour (pause de midi). La frise montre la semaine d\'un coup d\'œil.',
      'Toute la semaine est enregistrée d\'un bloc (PUT, décision C11).',
      'Le fuseau est fixé par le Super Admin (décision C12) : il est affiché, pas modifiable ici.',
    ],
    rendu: () => backOffice(ADMIN, 'horaires', <Horaires horaires={HORAIRES} feries={JOURS_FERIES} aujourdhui={MAINTENANT} />),
  },
  {
    id: 'banque',
    groupe: 'back-office',
    titre: 'Banque et apparence',
    format: 'bureau',
    adresse: () => site(ALPHA, '/back-office/parametrage/banque'),
    operations: ['lireParametresBanque', 'modifierApparence', 'televerserLogo'],
    roles: 'Admin Entreprise.',
    notes: [
      'La couleur principale habille le portail et le back-office. Le texte posé dessus, blanc ou foncé, est choisi automatiquement ; le contraste est vérifié (décision E2).',
      'Le plan, sa consommation et les réglages du contrat sont affichés en lecture : ils relèvent du Super Admin (décision C12).',
      'Étape 20 : les numéros WhatsApp et SMS de la banque, quand Makor les a ouverts.',
    ],
    rendu: () => backOffice(ADMIN, 'banque', <Banque parametres={PARAMETRES} banque={ALPHA} />),
  },
  {
    id: 'attribution',
    groupe: 'back-office',
    titre: 'Attribution et escalade',
    format: 'bureau',
    adresse: () => site(ALPHA, '/back-office/parametrage/attribution'),
    operations: ['lireReglesTraitement', 'modifierReglesTraitement', 'listerGroupes', 'creerGroupe', 'modifierGroupe', 'supprimerGroupe'],
    roles: 'Admin Entreprise (règle) ; superviseur (consulte). Seulement si Makor a ouvert la fonction à la banque (étape 16).',
    notes: [
      'Trois modes : manuel (comme en phase 1), suggestion (le superviseur valide), automatique (au dépôt, pendant les heures d\'ouverture).',
      'Un groupe réunit des agents ; il reçoit des catégories et des agences. Chaque membre montre sa charge et son absence du jour.',
      'Une réclamation va d\'abord à un agent des deux groupes (catégorie et agence), puis au groupe de la catégorie, puis à celui de l\'agence.',
      'Escalade : 75 % alerte, 100 % superviseur (inchangés), puis l\'Admin Entreprise au seuil de la banque ou de la catégorie ; les urgentes ont leur seuil.',
    ],
    variantes: [VU_PAR(['ADMIN_ENTREPRISE', 'SUPERVISEUR'])],
    rendu: ({ v }) => {
      const u = PROFILS[v.role as keyof typeof PROFILS];
      return backOffice(u, 'attribution', <Attribution regles={REGLES} groupes={GROUPES_AGENTS} agents={AGENTS_DES_GROUPES} modifiable={u.role === 'ADMIN_ENTREPRISE'} />);
    },
  },
  {
    id: 'reponses-assistant',
    groupe: 'back-office',
    titre: 'Assistant IA : base de réponses',
    format: 'bureau',
    adresse: () => site(ALPHA, '/back-office/parametrage/assistant'),
    operations: ['listerReponsesAssistant', 'creerReponseAssistant', 'modifierReponseAssistant', 'supprimerReponseAssistant'],
    roles: 'Admin Entreprise, quand Makor a ouvert l\'assistant IA à la banque (étape 18).',
    notes: [
      'La banque écrit et valide chaque réponse ; l\'assistant la montre telle quelle quand la question du client y correspond (décision I4).',
      'Les interdits sont signalés à la saisie, comme dans l\'API : un avertissement, la banque décide. Ici, une ancienne réponse qui promettait un délai a été retirée.',
      'Une réponse retirée n\'est plus utilisée, sans être perdue. Chaque création, modification ou suppression va au journal d\'audit.',
    ],
    variantes: [{ cle: 'edition', libelle: 'Panneau', options: [{ valeur: 'liste', libelle: 'Liste' }, { valeur: 'edition', libelle: 'Modifier une réponse' }] }],
    rendu: ({ v }) =>
      backOffice(ADMIN, 'assistant', <ReponsesAssistant key={v.edition} reponses={REPONSES_BANQUE} enEdition={v.edition === 'edition' ? REPONSES_BANQUE.at(-1)!.id : null} />),
  },
  {
    id: 'personnel',
    groupe: 'back-office',
    titre: 'Personnel',
    format: 'bureau',
    adresse: () => site(ALPHA, '/back-office/personnel'),
    operations: ['listerUtilisateurs', 'inviterUtilisateur', 'modifierUtilisateur', 'desactiverUtilisateur', 'renvoyerInvitation', 'reinitialiserTotp', 'modifierSecuriteBanque'],
    roles: 'Admin Entreprise (gère) ; superviseur (consulte).',
    notes: [
      'Le plan limite les agents et superviseurs non désactivés : l\'invitation est refusée au-delà (PLAFOND_AGENTS_ATTEINT).',
      'Un compte verrouillé (5 échecs) l\'est pour 15 minutes ; l\'heure de fin est affichée.',
      'Double authentification (étape 19) : facultative par défaut, chacun l\'active depuis « Mon compte ». L\'Admin Entreprise peut l\'exiger de tout le personnel, après avoir activé la sienne (DOUBLE_AUTHENTIFICATION_A_ACTIVER) : les sessions de ceux qui ne l\'ont pas activée sont fermées, et chacun l\'active à sa prochaine connexion.',
      'Chaque personne montre l\'état de sa double authentification ; ici, Ibrahim Coulibaly ne l\'a pas activée.',
      'Étape 21 : désactiver un agent qui a des réclamations en cours les met dans la file « À réassigner » ; ses superviseurs en sont prévenus.',
    ],
    variantes: [
      VU_PAR(['ADMIN_ENTREPRISE', 'SUPERVISEUR']),
      { cle: 'regle', libelle: 'Double authentification', options: [{ valeur: 'facultative', libelle: 'Facultative' }, { valeur: 'exigee', libelle: 'Exigée' }] },
    ],
    rendu: ({ v }) => {
      const u = PROFILS[v.role as keyof typeof PROFILS];
      return backOffice(
        u,
        'personnel',
        <Personnel
          page={PAGE_PERSONNEL}
          plan={PARAMETRES.plan}
          consommation={PARAMETRES.consommation}
          modifiable={u.role === 'ADMIN_ENTREPRISE'}
          maintenant={MAINTENANT}
          totpObligatoire={v.regle === 'exigee'}
        />,
      );
    },
  },
  {
    id: 'absences',
    groupe: 'back-office',
    titre: 'Absences',
    format: 'bureau',
    adresse: () => site(ALPHA, '/back-office/absences'),
    operations: ['listerAbsences', 'ajouterAbsence', 'supprimerAbsence'],
    roles: 'Superviseur et Admin Entreprise, si l\'attribution automatique est ouverte (étape 16).',
    notes: [
      'Un agent absent ne reçoit aucune nouvelle réclamation ces jours-là, ni en suggestion ni en automatique.',
      'Pas de motif : la cause d\'une absence ne regarde pas l\'outil. Une absence se retire et se redéclare, elle ne se modifie pas.',
      'Étape 21 : ses réclamations en cours restent à son nom ; pendant l\'absence, elles sont dans la file « À réassigner », et les alertes SLA et messages des clients vont à son superviseur.',
    ],
    rendu: () => backOffice(SUPERVISEUR, 'absences', <Absences absences={ABSENCES} agents={AGENTS_DES_GROUPES.map((a) => ({ id: a.id, nom: a.nom }))} aujourdhui="2026-09-25" />),
  },
  {
    id: 'audit',
    groupe: 'back-office',
    titre: 'Journal d\'audit',
    format: 'bureau',
    adresse: () => site(ALPHA, '/back-office/journal-audit'),
    operations: ['listerJournalBanque', 'verifierJournalBanque'],
    roles: 'Admin Entreprise.',
    notes: [
      'La vérification recalcule la chaîne d\'empreintes de la banque (étape 3) et indique la première ligne altérée s\'il y en a une.',
      'Le client n\'est jamais nommé dans le journal ; seuls des identifiants et des statuts y figurent.',
    ],
    rendu: () => backOffice(ADMIN, 'audit', <Audit journal={JOURNAL} verification={VERIFICATION_CHAINE} />),
  },
  {
    id: 'compte',
    groupe: 'back-office',
    titre: 'Mon compte',
    format: 'bureau',
    adresse: () => site(ALPHA, '/back-office/compte'),
    operations: ['lireMoi', 'preparerTotp', 'confirmerTotp', 'desactiverTotp'],
    roles: 'Tout le personnel de la banque, pour son propre compte (étape 19).',
    notes: [
      'Tant que la double authentification n\'est pas active, un bandeau le rappelle en haut de chaque page ; « Plus tard » le masque jusqu\'à la prochaine connexion.',
      'Activation : un nouveau secret, un QR code à scanner, puis un premier code pour confirmer. Le secret ne sert qu\'une fois confirmé.',
      'Désactivation : avec un code de l\'application, et seulement si la banque ne l\'exige pas. Les autres sessions de la personne sont fermées.',
      'Chaque activation et désactivation va au journal d\'audit de la banque.',
    ],
    variantes: [{
      cle: 'etat',
      libelle: 'État',
      options: [
        { valeur: 'inactive', libelle: 'Non activée' },
        { valeur: 'activation', libelle: 'Activation' },
        { valeur: 'active', libelle: 'Activée' },
        { valeur: 'exigee', libelle: 'Exigée par la banque' },
      ],
    }],
    rendu: ({ v }) => {
      const active = v.etat === 'active' || v.etat === 'exigee';
      const u = { ...moi(IBRAHIM, 'AGENT', active), totpObligatoire: v.etat === 'exigee' };
      return backOffice(
        u,
        'compte',
        <Compte key={v.etat} moi={u} banque={ALPHA.nom} enrolement={v.etat === 'activation' ? ENROLEMENT_COMPTE : undefined} />,
        false,
        v.etat === 'inactive' ? <BandeauDoubleAuthentification /> : undefined,
      );
    },
  },

  /* ------------------------------------------------------------------ Console de la plateforme */
  {
    id: 'banques',
    groupe: 'plateforme',
    titre: 'Banques clientes',
    format: 'bureau',
    adresse: () => console_('/banques'),
    operations: ['listerBanques', 'listerPlans', 'creerBanque', 'modifierBanque', 'raccorderCanal', 'suspendreBanque', 'reactiverBanque'],
    roles: 'Super Admin.',
    notes: [
      'Consommation du mois face aux plafonds du plan : un dépassement de tickets alerte mais ne bloque jamais un dépôt.',
      'Une banque suspendue n\'accepte plus de dépôts (BANQUE_SUSPENDUE) ; son personnel garde l\'accès aux réclamations en cours.',
      'Étape 20 : dans la fiche d\'une banque, le raccordement de son numéro WhatsApp (identifiants de l\'inscription intégrée de Meta et jeton d\'accès, chiffré et jamais réaffiché) et de son numéro SMS, puis leur ouverture, avec le chat web.',
    ],
    variantes: [{
      cle: 'creation', libelle: 'Écran',
      options: [{ valeur: 'non', libelle: 'Liste' }, { valeur: 'oui', libelle: 'Nouvelle banque' }, { valeur: 'fiche', libelle: 'Fiche, WhatsApp et SMS' }],
    }],
    rendu: ({ v }) => consoleSA('banques', <Banques page={PAGE_BANQUES} plans={PLANS} creation={v.creation === 'oui'} ouverteInitiale={v.creation === 'fiche' ? PAGE_BANQUES.donnees[0]!.id : null} />),
  },
  {
    id: 'activite',
    groupe: 'plateforme',
    titre: 'Activité et SMS',
    format: 'bureau',
    adresse: () => console_('/activite'),
    operations: ['lireIndicateursPlateforme', 'lireFacturationSms', 'lireFacturationCanaux', 'lireConsommationIa'],
    roles: 'Super Admin.',
    notes: [
      'Métadonnées seulement : volumes, taux, compteurs de SMS. Aucun texte ni client (arbitrage 4, droits par colonne de l\'étape 3).',
      'Les segments facturés servent à refacturer les SMS à chaque banque. Étape 22 : les SMS remis (accusé de remise de la passerelle) et non remis ; un SMS parti est facturé même s\'il n\'est pas remis.',
      'Satisfaction (étape 15) : totaux par banque (enquêtes, réponses, satisfaits, NPS), jamais les commentaires des clients.',
      'Assistant IA (étape 18) : tours du portail, brouillons, réponses par l\'IA ou par les règles, jetons et coût, d\'après un journal qui ne garde aucun message (décisions I2 et I5).',
      'WhatsApp et SMS reçus (étape 20) : messages remis à Meta, ceux que Meta déclare facturables, échecs, messages reçus ; des totaux, sans numéro ni texte.',
    ],
    rendu: () => consoleSA('activite', <Activite indicateurs={INDICATEURS_PLATEFORME} sms={FACTURATION_SMS} canaux={FACTURATION_CANAUX} ia={CONSOMMATION_IA} />),
  },
  {
    id: 'alertes',
    groupe: 'plateforme',
    titre: 'Alertes',
    format: 'bureau',
    adresse: () => console_('/alertes'),
    operations: ['listerNotificationsPlateforme', 'marquerNotificationPlateformeLue'],
    roles: 'Super Admin.',
    notes: ['Réclamations urgentes de toutes les banques (« banque · numéro · catégorie · heure ») et plafonds dépassés, une fois par mois et par banque.'],
    rendu: () => consoleSA('alertes', <Alertes alertes={ALERTES} maintenant={MAINTENANT} />),
  },
];
