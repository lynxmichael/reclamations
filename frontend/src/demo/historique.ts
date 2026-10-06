/**
 * Création d'une démo : le moteur, puis 30 jours d'activité rejoués avec les vraies règles
 * (dépôts, assignations, réponses, questions, résolutions, contestations, clôtures). Tableau de
 * bord, files, chronos et journal d'audit sont donc cohérents entre eux, et identiques à chaque
 * ouverture (tirage pseudo-aléatoire à graine fixe). Étape 15 : un client sur deux répond à
 * l'enquête de satisfaction, dans les 48 heures (tirage à part : le reste de l'historique ne change pas).
 * Étape 17 : le chat web s'ouvre une heure avant l'ouverture de la démo ; deux clients y écrivent.
 * Étape 20 : le second écrit sur WhatsApp, où partira la réponse de l'agent.
 */
import { DateTime } from 'luxon';
import { ajouterMinutesOuvrees, minutesOuvreesEntre } from '@domaine/temps-ouvre/calendrier';
import { CATEGORIES, JOURS_FERIES, PERSONNEL, POINTS_DEPOT } from '../maquettes/donnees/parametrage';
import { FUSEAU } from '../maquettes/donnees/commun';
import { Moteur, aleatoire, type BanqueDemo } from './moteur';

const MINUTE = 60_000;

/** Le téléphone de la démo : c'est le client qui dépose depuis le téléphone affiché. */
export const CLIENT_DEMO = { nom: 'Yao Kouassi', telephone: '07 08 09 10 11', telephoneE164: '+2250708091011', email: 'yao.kouassi@exemple.ci' };

/** La démo s'ouvre un jour ouvré à 09:30 : aujourd'hui, ou le prochain jour ouvré. */
export function debutDemo(reel: Date): Date {
  let d = DateTime.fromJSDate(reel, { zone: FUSEAU }).startOf('day');
  const feries = new Set(JOURS_FERIES.map((j) => (j.recurrent ? j.date.slice(5) : j.date)));
  for (let i = 0; i < 14; i++) {
    const iso = d.toISODate()!;
    if (d.weekday <= 5 && !feries.has(iso) && !feries.has(iso.slice(5))) break;
    d = d.plus({ days: 1 });
  }
  return d.set({ hour: 9, minute: 30 }).toJSDate();
}

const PRENOMS = ['Aïcha', 'Bintou', 'Kouassi', 'Éric', 'Ange', 'Arnaud', 'Christelle', 'Désiré', 'Fanta', 'Gisèle', 'Hamed', 'Inès', 'Jacques', 'Kadiatou',
  'Laetitia', 'Moussa', 'Nathalie', 'Olivier', 'Patricia', 'Rachel', 'Sékou', 'Tatiana', 'Valérie', 'Wilfried', 'Yasmine', 'Zié', 'Clarisse', 'Serge-Alain'];
const NOMS = ['Koné', 'Bamba', 'Diallo', 'Kouamé', "N'Dri", 'Brou', 'Tanoh', 'Yapi', 'Gnagne', 'Kacou', 'Soro', 'Touré', 'Sanogo', 'Assi', 'Ehui', 'Dosso',
  'Fofana', 'Kra', 'Lago', 'Méité', 'Oulaï', 'Sylla', 'Tiémoko', 'Zadi', 'Amani', 'Beugré'];

/** Textes de réclamation par catégorie (ordre de CATEGORIES). */
const TEXTES: Record<string, string[]> = {
  'Carte bancaire': [
    "Ma carte a été avalée par le distributeur de l'agence ce matin. J'en ai besoin pour mes paiements.",
    "Un paiement de 35 000 FCFA apparaît deux fois sur mon relevé pour le même achat.",
    "Le distributeur n'a pas donné les billets mais mon compte a été débité de 20 000 FCFA.",
  ],
  'Virement et transfert': [
    "Mon virement vers un compte d'une autre banque, fait il y a 4 jours, n'est toujours pas arrivé.",
    "J'ai envoyé un virement au mauvais bénéficiaire, je voudrais l'annuler.",
    "Le salaire de ce mois n'apparaît pas sur mon compte alors que mon employeur l'a envoyé.",
  ],
  'Banque mobile': [
    "Je n'arrive plus à me connecter à l'application depuis la mise à jour : code refusé.",
    "Un transfert vers mon compte mobile money a été débité mais n'est pas arrivé.",
    "Je ne reçois plus les codes de validation par SMS pour mes opérations.",
  ],
  'Frais et prélèvements': [
    "Des frais de tenue de compte ont été prélevés deux fois ce mois-ci.",
    "Un prélèvement que je n'ai pas autorisé apparaît sur mon compte.",
    "On m'a facturé des frais de découvert alors que mon compte était créditeur.",
  ],
  'Fraude suspectée': [
    "Trois paiements en ligne que je n'ai pas faits apparaissent sur ma carte cette nuit.",
    "Quelqu'un a retiré de l'argent avec ma carte à Bouaké alors que je suis à Abidjan.",
  ],
  'Accueil en agence': [
    "J'ai attendu plus d'une heure et demie à l'agence sans être reçu.",
    "Le guichet était fermé à 15 h alors que les horaires affichés indiquent 17 h 30.",
  ],
  'Crédit': [
    "Mon échéance de prêt a été prélevée deux fois ce mois-ci.",
    "J'ai demandé le décompte pour un remboursement anticipé il y a deux semaines, sans réponse.",
  ],
};

const REPONSES = [
  'Bonjour, nous avons bien identifié le problème et lancé la régularisation. Vous serez informé dès qu\'elle sera faite.',
  'Bonjour, merci pour votre signalement. Nos équipes vérifient l\'opération auprès du service concerné.',
];
const QUESTIONS = [
  'Bonjour, pour retrouver l\'opération, pouvez-vous nous indiquer la date et le montant exacts ?',
  'Bonjour, pouvez-vous nous envoyer une photo du ticket ou du relevé concerné ?',
];
const REPONSES_CLIENT = ['Bonjour, c\'était le mardi vers 18 h, pour 20 000 FCFA.', 'Voici les informations demandées, merci.'];
const RESOLUTIONS = [
  'Bonjour, la régularisation est faite : le montant a été recrédité sur votre compte ce jour.',
  'Bonjour, le problème est corrigé. Nous vous prions de nous excuser pour ce désagrément.',
  'Bonjour, les frais ont été remboursés et l\'incident a été signalé au service concerné.',
];

/** Commentaires laissés dans les enquêtes simulées, du plus positif au plus critique. */
const COMMENTAIRES_AVIS = [
  'Réponse rapide et montant recrédité le lendemain. Merci à la conseillère.',
  'Très bon suivi, j\'étais informé à chaque étape.',
  'Problème réglé, mais il a fallu attendre plusieurs jours.',
  'Il a fallu relancer deux fois avant d\'avoir une vraie réponse.',
  'On ne m\'a pas expliqué pourquoi l\'opération avait été bloquée.',
];

/** Avis simulé : plutôt satisfait, la recommandation suit la note ; un commentaire une fois sur trois. */
function avisSimule(h: ReturnType<typeof aleatoire>) {
  const note = h.pondere([[5, 34], [4, 32], [3, 14], [2, 10], [1, 10]] as const);
  const base = [0, 1, 3, 6, 8, 9][note]!;
  const recommandation = Math.min(10, base + h.entier(0, note >= 4 ? 2 : 3));
  const commentaire = h.nombre() < 0.35 ? COMMENTAIRES_AVIS[note >= 4 ? h.entier(0, 1) : note === 3 ? 2 : h.entier(3, 4)]! : undefined;
  return { note, recommandation, ...(commentaire ? { commentaire } : {}) };
}

const AGENTS = PERSONNEL.filter((u) => u.role === 'AGENT' && u.statut === 'ACTIF');
const POIDS_CATEGORIES = [30, 22, 17, 12, 5, 8, 6];
const QR = POINTS_DEPOT.filter((p) => p.actif && p.canal === 'QR_CODE');
const WEB = POINTS_DEPOT.filter((p) => p.actif && p.canal === 'LIEN_WEB');
const POIDS_QR = [22, 12, 22, 20, 12];

/** File de priorité (tas binaire) : le prochain événement du rejeu en O(log n). */
class Tas<T> {
  private t: T[] = [];
  constructor(private avant: (a: T, b: T) => number) {}
  ajouter(x: T) {
    const t = this.t;
    t.push(x);
    for (let i = t.length - 1; i > 0; ) {
      const p = (i - 1) >> 1;
      if (this.avant(t[i]!, t[p]!) >= 0) break;
      [t[i], t[p]] = [t[p]!, t[i]!];
      i = p;
    }
  }
  retirer(): T | undefined {
    const t = this.t;
    if (t.length <= 1) return t.pop();
    const haut = t[0];
    t[0] = t.pop()!;
    for (let i = 0; ; ) {
      const g = 2 * i + 1;
      const d = g + 1;
      let m = i;
      if (g < t.length && this.avant(t[g]!, t[m]!) < 0) m = g;
      if (d < t.length && this.avant(t[d]!, t[m]!) < 0) m = d;
      if (m === i) break;
      [t[i], t[m]] = [t[m]!, t[i]!];
      i = m;
    }
    return haut;
  }
}

export interface OptionsDemo {
  banque: BanqueDemo;
  debut: Date;
  jours?: number;
  graine?: number;
}

export function creerDemo({ banque, debut, jours = 30, graine = 42 }: OptionsDemo): Moteur {
  const h = aleatoire(graine);
  const origine = new Date(debut.getTime() - jours * 86_400_000);
  const jourAnnee = DateTime.fromJSDate(origine, { zone: FUSEAU }).ordinal;
  const m = new Moteur(banque, origine, Math.floor((jourAnnee - 1) * 11.5));
  const ouvre = (depuis: Date, minutes: number) => ajouterMinutesOuvrees(depuis, minutes, m.calendrier);
  const categoriesActives = CATEGORIES.filter((c) => c.active);

  type Plan = { quand: number; ordre: number; faire: () => void };
  const plans = new Tas<Plan>((a, b) => a.quand - b.quand || a.ordre - b.ordre);
  let ordre = 0;
  const planifier = (quand: Date, faire: () => void) => plans.ajouter({ quand: quand.getTime(), ordre: ordre++, faire });

  /** Un dépôt et la suite de son traitement, à partir de l'instant du dépôt. */
  interface Choix {
    cat?: (typeof CATEGORIES)[number];
    point?: (typeof POINTS_DEPOT)[number];
    /** La file « Reçues » de l'ouverture : personne n'y a encore touché */
    sansAssignation?: boolean;
    /** L'agent n'a pas résolu à temps : la réclamation sera en retard et escaladée */
    sansResolution?: boolean;
    /** Chat web (étape 17) : le client écrit, tant de minutes avant l'ouverture de la démo */
    chat?: { avant: number; messages: string[]; canal?: 'WHATSAPP' | 'SMS' };
  }
  function reclamation(quand: Date, client: { nom: string; telephone: string; email?: string }, choix: Choix = {}) {
    const cat = choix.cat ?? h.pondere(categoriesActives.map((c, i) => [c, POIDS_CATEGORIES[i]!] as const));
    planifier(quand, () => {
      const qr = h.nombre() < 0.65;
      const point = choix.point ?? (qr ? h.pondere(QR.map((p, i) => [p, POIDS_QR[i] ?? 10] as const)) : h.parmi(WEB));
      const accuse = m.deposer(point.code, {
        categorieId: cat.id,
        description: h.parmi(TEXTES[cat.nom] ?? ['Réclamation sans détail.']),
        nom: client.nom,
        telephone: client.telephone,
        email: client.email,
        consentement: true,
      });
      const id = accuse.numero;
      if (choix.sansAssignation) return;
      const agent = h.pondere(AGENTS.map((a, i) => [a, [30, 25, 25, 20][i] ?? 20] as const));
      const superviseur = agent.superviseur!.id;
      let t = ouvre(m.maintenant, h.entier(5, 60));
      if (h.nombre() < 0.02) {
        planifier(t, () => m.cloturerDeForce(superviseur, id, 'DOUBLON', 'Même demande déposée deux fois par le client.'));
        return;
      }
      planifier(t, () => m.assigner(superviseur, id, agent.id));
      t = ouvre(t, h.entier(5, 40));
      planifier(t, () => m.prendreEnCharge(agent.id, id));
      let finTraitement = ouvre(m.maintenant, Math.round(cat.delaiCibleMinutes * (0.2 + h.nombre() * 0.95)));
      if (h.nombre() < 0.3) {
        const q = ouvre(t, h.entier(20, 120));
        planifier(q, () => m.repondre(agent.id, id, h.parmi(QUESTIONS), true));
        const r = new Date(q.getTime() + h.entier(60, 1800) * MINUTE);
        planifier(r, () => m.messageClient(sessionDe(id), id, h.parmi(REPONSES_CLIENT)));
        const apres = ouvre(r, h.entier(30, 240));
        if (apres > finTraitement) finTraitement = apres;
      } else if (h.nombre() < 0.85) {
        planifier(ouvre(t, h.entier(15, 90)), () => m.repondre(agent.id, id, h.parmi(REPONSES)));
      }
      if (choix.chat) {
        const { avant, messages, canal } = choix.chat;
        planifier(new Date(debut.getTime() - avant * MINUTE), () => {
          const s = sessionDe(id);
          if (!canal) m.lireChat(s, id);
          for (const texte of messages) m.messageClient(s, id, texte, canal);
        });
      }
      if (choix.sansResolution) return;
      if (finTraitement <= t) finTraitement = ouvre(t, 30);
      planifier(finTraitement, () => m.resoudre(agent.id, id, h.parmi(RESOLUTIONS)));
      const tirage = h.nombre();
      if (tirage < 0.06) {
        const c = new Date(finTraitement.getTime() + h.entier(60, 1440) * MINUTE);
        planifier(c, () => m.contester(sessionDe(id), id, 'Le montant n\'a pas été recrédité en totalité.'));
        const r2 = ouvre(c, h.entier(60, 600));
        planifier(r2, () => m.resoudre(agent.id, id, 'Bonjour, le complément a été recrédité. Toutes nos excuses.'));
        planifier(new Date(r2.getTime() + h.entier(60, 2000) * MINUTE), () => m.confirmer(sessionDe(id), id));
      } else if (tirage < 0.66) {
        planifier(new Date(finTraitement.getTime() + h.entier(30, 3000) * MINUTE), () => m.confirmer(sessionDe(id), id));
      }
      // sinon : clôture automatique, 5 jours après la résolution (tâche planifiée)
    });
  }

  /** Session client ouverte « comme si » le client avait saisi son code. */
  const sessions = new Map<string, string>();
  function sessionDe(numero: string) {
    const connue = sessions.get(numero);
    if (connue) return connue;
    const t = m.ticket(numero);
    m.demanderCode(t.jetonSuivi);
    const sms = m.envois[m.envois.length - 1]!.texte.match(/code est (\d{6})/)![1]!;
    const s = m.verifierCode(t.jetonSuivi, sms).jetonClient;
    sessions.set(numero, s);
    return s;
  }

  // 30 jours de dépôts : davantage en semaine, un peu la nuit et le week-end
  for (let j = 0; j < jours; j++) {
    const jour = DateTime.fromJSDate(origine, { zone: FUSEAU }).startOf('day').plus({ days: j });
    const semaine = jour.weekday <= 5;
    const n = semaine ? h.entier(10, 14) : h.entier(3, 5);
    for (let k = 0; k < n; k++) {
      const minute = semaine ? h.pondere([[h.entier(420, 480), 1], [h.entier(480, 1050), 7], [h.entier(1050, 1260), 2]] as const) : h.entier(540, 1140);
      const quand = jour.plus({ minutes: minute }).toJSDate();
      if (quand <= origine || quand >= debut) continue;
      const prenom = h.parmi(PRENOMS);
      const nom = h.parmi(NOMS);
      const tel = `${h.parmi(['07', '05', '01'])}${String(h.entier(0, 99_999_999)).padStart(8, '0')}`;
      reclamation(quand, {
        nom: `${prenom} ${nom}`,
        telephone: tel,
        email: h.nombre() < 0.5 ? `${prenom}.${nom}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ'\s]/g, '') + '@exemple.ci' : undefined,
      });
    }
  }
  // Une ancienne réclamation du client de la démo : son espace client a déjà un historique
  reclamation(new Date(debut.getTime() - 19 * 86_400_000 + 5 * 3_600_000), { nom: CLIENT_DEMO.nom, telephone: CLIENT_DEMO.telephone, email: CLIENT_DEMO.email }, { cat: categoriesActives[3] });

  // L'état des files à l'ouverture : une réclamation en retard (escaladée), une au seuil d'alerte,
  // et trois arrivées ce matin, dont une urgente, que personne n'a encore assignées
  const cat = (nom: string) => categoriesActives.find((c) => c.nom === nom)!;
  const point = (code: string) => POINTS_DEPOT.find((p) => p.code === code)!;
  const client = () => ({ nom: `${h.parmi(PRENOMS)} ${h.parmi(NOMS)}`, telephone: `07${String(h.entier(0, 99_999_999)).padStart(8, '0')}` });
  // Chat web : ouvert une heure avant ; le client en retard demande des nouvelles, l'autre écrit deux fois sur WhatsApp
  m.chatActif = false;
  planifier(new Date(debut.getTime() - 60 * MINUTE), () => {
    m.chatActif = true;
  });
  reclamation(ilYaOuvrees(1500), client(), {
    cat: cat('Carte bancaire'), point: point('B6N4TR8YQE'), sansResolution: true,
    chat: { avant: 24, messages: ['Bonjour, avez-vous des nouvelles ? Cela fait plusieurs jours que j\'attends.'] },
  });
  reclamation(ilYaOuvrees(380), client(), {
    cat: cat('Banque mobile'), point: point('W5Q9HB2MLC'), sansResolution: true,
    chat: { avant: 7, canal: 'WHATSAPP', messages: ['J\'ai réinstallé l\'application, toujours le même message d\'erreur.', 'Je peux vous envoyer une capture d\'écran si besoin.'] },
  });
  reclamation(new Date(debut.getTime() - 55 * MINUTE), client(), { cat: cat('Virement et transfert'), point: point('K4V8PZ3TRG'), sansAssignation: true });
  reclamation(new Date(debut.getTime() - 31 * MINUTE), client(), { cat: cat('Accueil en agence'), point: point('P9D2LK7VXR'), sansAssignation: true });
  reclamation(new Date(debut.getTime() - 12 * MINUTE), client(), { cat: cat('Fraude suspectée'), point: point('7K3QX9P2MA'), sansAssignation: true });

  /** L'instant à partir duquel `minutes` minutes ouvrées s'écoulent jusqu'à l'ouverture. */
  function ilYaOuvrees(minutes: number) {
    let x = debut.getTime();
    while (minutesOuvreesEntre(new Date(x), debut, m.calendrier) < minutes) x -= 5 * MINUTE;
    return new Date(x);
  }

  // Les réponses aux enquêtes, planifiées dès leur ouverture (clôture confirmée ou automatique)
  const ha = aleatoire(graine + 15);
  m.apresOuvertureEnquete = (t) => {
    if (ha.nombre() >= 0.5) return;
    const quand = new Date(t.enquete!.ouverteLe.getTime() + ha.entier(30, 48 * 60) * MINUTE);
    const r = avisSimule(ha);
    planifier(quand, () => m.donnerAvis(t.jetonSuivi, r));
  };

  m.enSilence(() => {
    for (let p = plans.retirer(); p; p = plans.retirer()) {
      if (p.quand >= debut.getTime()) continue;
      m.avancerJusqua(new Date(p.quand));
      try {
        p.faire();
      } catch {
        // Action devenue impossible (ex. clôture automatique survenue avant) : on l'ignore, comme un client qui ne revient pas
      }
    }
    m.avancerJusqua(debut);
    m.apresOuvertureEnquete = null;
    m.declarerAbsencesDeDemo();
    m.marquerHistoriqueLu(new Date(debut.getTime() - 60 * MINUTE));
    m.envois.length = 0;
  });
  return m;
}
