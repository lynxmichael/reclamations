/**
 * Catalogue des écrans de l'étape 6 : pour chacun, les opérations du contrat qui l'alimentent,
 * les rôles qui le voient, ce qu'il faut en retenir et ses variantes (rôle, état).
 */
import type { ReactNode } from 'react';
import type { S } from '../api/types';
import { Accuse } from '../ecrans/portail/Accuse';
import { CodeOtp } from '../ecrans/portail/CodeOtp';
import { Depot } from '../ecrans/portail/Depot';
import { MaReclamation } from '../ecrans/portail/MaReclamation';
import { MesReclamations } from '../ecrans/portail/MesReclamations';
import { Suivi } from '../ecrans/portail/Suivi';
import { Activation, CodeTotp, Connexion } from '../ecrans/connexion/Connexion';
import { Audit } from '../ecrans/back-office/Audit';
import { Banque } from '../ecrans/back-office/Banque';
import { CadreBackOffice, type PageBackOffice } from '../ecrans/back-office/CadreBackOffice';
import { Categories } from '../ecrans/back-office/Categories';
import { Files } from '../ecrans/back-office/Files';
import { Horaires } from '../ecrans/back-office/Horaires';
import { Personnel } from '../ecrans/back-office/Personnel';
import { PointsDepot } from '../ecrans/back-office/PointsDepot';
import { TableauDeBord } from '../ecrans/back-office/TableauDeBord';
import { Ticket, type Fenetre } from '../ecrans/back-office/Ticket';
import { Activite, Alertes } from '../ecrans/plateforme/Activite';
import { Banques } from '../ecrans/plateforme/Banques';
import { CadreConsole, type PageConsole } from '../ecrans/plateforme/Console';
import { ALPHA, DOMAINE, MAINTENANT } from './donnees/commun';
import { ENROLEMENT, ERREUR_CONNEXION, ETAPE_TOTP } from './donnees/auth';
import {
  AGENCES, AYA, CATEGORIES, FATOU, HORAIRES, JOURS_FERIES, PAGE_PERSONNEL, PARAMETRES, POINTS_DEPOT, SERGE, moi,
} from './donnees/parametrage';
import { ALERTES, FACTURATION_SMS, INDICATEURS_PLATEFORME, PAGE_BANQUES, PLANS } from './donnees/plateforme';
import {
  ERREUR_DEPOT, MA_RECLAMATION_EN_COURS, MA_RECLAMATION_RESOLUE, MES_RECLAMATIONS, OTP_ENVOYE, accuse, formulaire, suivi,
} from './donnees/portail';
import {
  AGENTS_ASSIGNABLES, FICHE_42, INDICATEURS, JOURNAL, NOTIFICATIONS_AGENT, PAGE_AGENT, PAGE_SUPERVISEUR, VERIFICATION_CHAINE,
} from './donnees/reclamations';

export type Groupe = 'portail' | 'connexion' | 'back-office' | 'plateforme';

export const GROUPES: { cle: Groupe; titre: string; resume: string; parcours?: boolean }[] = [
  { cle: 'portail', titre: 'Portail client', resume: 'Sur téléphone, aux couleurs de la banque, du QR code à la clôture.', parcours: true },
  { cle: 'connexion', titre: 'Connexion du personnel', resume: 'Mot de passe puis code TOTP, activation à la première connexion.', parcours: true },
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

function backOffice(u: S<'Moi'>, page: PageBackOffice, contenu: ReactNode, notificationsOuvertes = false) {
  return (
    <CadreBackOffice
      banque={ALPHA}
      moi={u}
      page={page}
      aTraiter={aTraiter(u)}
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
    operations: ['lireFormulaireDepot', 'deposerReclamation'],
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
            fichiers: [{ nom: 'ticket-distributeur.jpg', taille: 1_258_291 }],
          }}
        />
      ),
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
    operations: ['lireSuivi', 'demanderCodeOtp'],
    roles: 'Toute personne qui a le lien de suivi.',
    notes: [
      'Sans code, la page montre seulement le numéro, le statut, la catégorie et les étapes : ni description, ni messages, ni coordonnées.',
      'Les étapes restantes apparaissent en pointillé : le client voit ce qui l\'attend.',
      'Le code part par SMS si le client a donné un téléphone, sinon par e-mail (DemandeOtp).',
    ],
    marque: true,
    rendu: ({ banque }) => <Suivi suivi={suivi(banque)} />,
  },
  {
    id: 'code',
    groupe: 'portail',
    titre: 'Code à usage unique',
    format: 'mobile',
    adresse: (b) => site(b, '/suivi/Qm9uam91ckJhbnF1…/code'),
    operations: ['verifierCodeOtp', 'demanderCodeOtp'],
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
    roles: 'Tout le personnel, à chaque connexion.',
    notes: ['Seconde étape obligatoire (décision C6). Le jeton intermédiaire expire après 5 minutes.', 'En cas de téléphone perdu, l\'Admin Entreprise réinitialise le TOTP depuis l\'écran Personnel.'],
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
    roles: 'Une personne invitée, depuis le lien de son e-mail d\'invitation.',
    notes: [
      'Étape 1 : choix du mot de passe (12 caractères au moins, refusé s\'il est trop courant). Étape 2 ici : activation du TOTP.',
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
    ],
    variantes: [
      VU_PAR(['SUPERVISEUR', 'AGENT']),
      { cle: 'notifs', libelle: 'Notifications', options: [{ valeur: 'fermees', libelle: 'Fermées' }, { valeur: 'ouvertes', libelle: 'Ouvertes' }] },
    ],
    rendu: ({ v }) => {
      const u = PROFILS[v.role as keyof typeof PROFILS];
      return backOffice(
        u,
        'reclamations',
        <Files page={u.role === 'AGENT' ? PAGE_AGENT : PAGE_SUPERVISEUR} moi={u} maintenant={MAINTENANT} seuil={PARAMETRES.seuilAlerteSlaPourcent} />,
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
    id: 'tableau',
    groupe: 'back-office',
    titre: 'Tableau de bord',
    format: 'bureau',
    adresse: () => site(ALPHA, '/back-office/tableau-de-bord'),
    operations: ['lireIndicateurs', 'exporterReclamations'],
    roles: 'Superviseur et Admin Entreprise.',
    notes: [
      'Les indicateurs du §6.6, calculés par l\'API sur la période et les filtres choisis.',
      'Les délais sont en temps ouvré. Le délai de résolution inclut l\'attente du client ; le taux SLA ne compte pas les clôtures forcées sans résolution (S5, S6).',
      'Pas de courbe d\'évolution : le contrat ne fournit pas de série par jour ou par semaine (point à trancher, décision E7).',
    ],
    rendu: () => backOffice(SUPERVISEUR, 'tableau', <TableauDeBord indicateurs={INDICATEURS} />),
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
    ],
    rendu: () => backOffice(ADMIN, 'banque', <Banque parametres={PARAMETRES} banque={ALPHA} />),
  },
  {
    id: 'personnel',
    groupe: 'back-office',
    titre: 'Personnel',
    format: 'bureau',
    adresse: () => site(ALPHA, '/back-office/personnel'),
    operations: ['listerUtilisateurs', 'inviterUtilisateur', 'modifierUtilisateur', 'desactiverUtilisateur', 'renvoyerInvitation', 'reinitialiserTotp'],
    roles: 'Admin Entreprise (gère) ; superviseur (consulte).',
    notes: [
      'Le plan limite les agents et superviseurs non désactivés : l\'invitation est refusée au-delà (PLAFOND_AGENTS_ATTEINT).',
      'Un compte verrouillé (5 échecs) l\'est pour 15 minutes ; l\'heure de fin est affichée.',
    ],
    variantes: [VU_PAR(['ADMIN_ENTREPRISE', 'SUPERVISEUR'])],
    rendu: ({ v }) => {
      const u = PROFILS[v.role as keyof typeof PROFILS];
      return backOffice(
        u,
        'personnel',
        <Personnel page={PAGE_PERSONNEL} plan={PARAMETRES.plan} consommation={PARAMETRES.consommation} modifiable={u.role === 'ADMIN_ENTREPRISE'} maintenant={MAINTENANT} />,
      );
    },
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

  /* ------------------------------------------------------------------ Console de la plateforme */
  {
    id: 'banques',
    groupe: 'plateforme',
    titre: 'Banques clientes',
    format: 'bureau',
    adresse: () => console_('/banques'),
    operations: ['listerBanques', 'listerPlans', 'creerBanque', 'suspendreBanque', 'reactiverBanque'],
    roles: 'Super Admin.',
    notes: [
      'Consommation du mois face aux plafonds du plan : un dépassement de tickets alerte mais ne bloque jamais un dépôt.',
      'Une banque suspendue n\'accepte plus de dépôts (BANQUE_SUSPENDUE) ; son personnel garde l\'accès aux réclamations en cours.',
    ],
    variantes: [{ cle: 'creation', libelle: 'Création', options: [{ valeur: 'non', libelle: 'Liste' }, { valeur: 'oui', libelle: 'Nouvelle banque' }] }],
    rendu: ({ v }) => consoleSA('banques', <Banques page={PAGE_BANQUES} plans={PLANS} creation={v.creation === 'oui'} />),
  },
  {
    id: 'activite',
    groupe: 'plateforme',
    titre: 'Activité et SMS',
    format: 'bureau',
    adresse: () => console_('/activite'),
    operations: ['lireIndicateursPlateforme', 'lireFacturationSms'],
    roles: 'Super Admin.',
    notes: [
      'Métadonnées seulement : volumes, taux, compteurs de SMS. Aucun texte ni client (arbitrage 4, droits par colonne de l\'étape 3).',
      'Les segments facturés servent à refacturer les SMS à chaque banque.',
    ],
    rendu: () => consoleSA('activite', <Activite indicateurs={INDICATEURS_PLATEFORME} sms={FACTURATION_SMS} />),
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
