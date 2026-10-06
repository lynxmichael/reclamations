/**
 * Moteur de la démo : une API simulée, dans le navigateur, qui répond comme l'API réelle
 * (types du contrat) et applique les VRAIES règles du backend : machine d'états, chrono SLA en
 * temps ouvré et normalisation des coordonnées sont importés de backend/src/domaine.
 *
 * Rien ne quitte le navigateur. L'horloge est simulée : on peut l'avancer pour montrer l'alerte
 * à 75 %, le dépassement et l'escalade, puis la clôture automatique.
 * Étape 15 : la banque de démonstration a les enquêtes de satisfaction (règles de domaine/satisfaction).
 * Étape 16 : l'attribution en mode suggestion (règles de domaine/attribution), l'escalade à l'Admin Entreprise.
 * Étape 17 : le chat web et la boîte de réception (règles de domaine/conversation) ; une réponse non lue
 * dans le chat 2 minutes après part par SMS.
 */
import {
  OPERATIONS, TRANSITIONS, verifierOperation, verifierTransition,
  type Acteur, type ActionStatut, type EtatTicket, type Operation,
} from '@domaine/reclamation/machine';
import { delaiPremiereReponse, slaALaReprise, slaALaResolution, slaAuDepot, slaEnPause, type ParametresSla } from '@domaine/reclamation/sla';
import { dateLocale, minutesOuvreesEntre, normaliserCalendrier, prochainInstantOuvre, type CalendrierNormalise } from '@domaine/temps-ouvre/calendrier';
import { choisirAgent, estAbsent, type AgentDisponible, type Choix, type Groupe } from '@domaine/attribution';
import { instantEscaladeAdmin, seuilEscaladeAdmin } from '@domaine/reclamation/escalade';
import { normaliserEmail, normaliserTelephone } from '@domaine/contact';
import { bilanAvis, clotureAvecEnquete, estSatisfait, etatAvis, finEnquete, normaliserReponse, nps, type ModeClotureAvecEnquete } from '@domaine/satisfaction';
import {
  DELAI_AVIS_CLIENT_MS, alerterAgent, avisClientDu, clientEnLigne, disponibilite, extrait, marqueLaLecture, nonLueParLaBanque, nonLueParLeClient,
  reponseDue, type EtatConversation,
} from '@domaine/conversation';
import type { S } from '../api/types';
import { AGENCES, CATEGORIES, GROUPES, HORAIRES, JOURS_FERIES, PARAMETRES, PERSONNEL, POINTS_DEPOT, REGLES } from '../maquettes/donnees/parametrage';
import { DOMAINE } from '../maquettes/donnees/commun';
import { alertesDe, contexteAssistant, REPONSES_BANQUE, tourAssistant } from '../maquettes/donnees/assistant';
import { brouillonParRegles } from '@domaine/ia/consignes';
import { categorieParRegles, faqParRegles, texteReprise, urgenceParRegles } from '@domaine/ia/assistant';
import type { EchangeVu } from '../ecrans/portail/Assistant';
import { canalDuFil } from '@domaine/canaux';

/* ------------------------------------------------------------------ Types internes */

type Statut = S<'StatutReclamation'>;
type TypeEvt = S<'TypeEvenement'>;
type Qui = { type: 'CLIENT' | 'UTILISATEUR' | 'SYSTEME'; id: string | null };

interface Message {
  id: string;
  type: S<'TypeCommentaire'>;
  contenu: string;
  auteur: Qui;
  creeLe: Date;
  pieces: S<'PieceJointe'>[];
  /** Où le client a écrit, ou par où la réponse est partie (étape 20) */
  canal?: S<'CanalConversation'>;
}

/** Numéro WhatsApp de la banque de démonstration (étape 20), ouvert avec le chat */
export const WHATSAPP_DEMO = '+2252722000000';

interface Evenement {
  type: TypeEvt;
  statutAvant: Statut | null;
  statutApres: Statut | null;
  acteur: Qui;
  visibleClient: boolean;
  date: Date;
}

export interface Ticket {
  id: string;
  numero: string;
  jetonSuivi: string;
  statut: Statut;
  priorite: S<'Priorite'>;
  canal: S<'CanalDepot'>;
  categorieId: string;
  agenceId: string | null;
  pointId: string;
  agentId: string | null;
  escaladeeVersId: string | null;
  clientId: string;
  description: string;
  pieces: S<'PieceJointe'>[];
  creeLe: Date;
  delaiCibleMinutes: number;
  echeanceSlaLe: Date | null;
  alertePreventiveLe: Date | null;
  slaMinutesRestantes: number | null;
  slaSuspenduLe: Date | null;
  slaRespecte: boolean | null;
  prisEnChargeLe: Date | null;
  premiereReponseLe: Date | null;
  resolueLe: Date | null;
  clotureLe: Date | null;
  clotureAutoPrevueLe: Date | null;
  escaladeeLe: Date | null;
  /** Escalade à l'Admin Entreprise (étape 16) */
  escaladeeAdminLe: Date | null;
  cloture: { mode: S<'ModeCloture'>; motif: S<'MotifClotureForcee'> | null; precision: string | null; parId: string | null } | null;
  nbReouvertures: number;
  aEteQuestionne: boolean;
  alerteEnvoyee: boolean;
  depassementSignale: boolean;
  messages: Message[];
  evenements: Evenement[];
  /** Enquête de satisfaction ouverte à la clôture (étape 15) */
  enquete: Enquete | null;
  /** Conversation du chat web (étape 17), ouverte quand le client affiche le chat */
  conversation: Conversation | null;
  /** Préparée avec l'assistant du portail (étape 18) */
  viaAssistant?: boolean;
}

interface Conversation extends EtatConversation {
  id: string;
  /** Où le client a écrit en dernier : le portail, WhatsApp ou SMS (étape 20) */
  canal: S<'CanalConversation'>;
  dernierMessageClientLe: Date | null;
  dernierMessageBanqueLe: Date | null;
  luClientLe: Date | null;
  luBanqueLe: Date | null;
  avisClientLe: Date | null;
}

interface Enquete {
  ouverteLe: Date;
  expireLe: Date;
  reponse: { note: number; recommandation: number; commentaire: string | null; reponduLe: Date } | null;
}

interface Client {
  id: string;
  nom: string;
  email: string | null;
  telephone: string | null;
}

/** Message envoyé au client (SMS ou e-mail), affiché sur le téléphone de la démo. */
export interface Envoi {
  id: string;
  clientId: string;
  canal: 'SMS' | 'EMAIL';
  destination: string;
  texte: string;
  date: Date;
  /** Lien du message : le suivi, ou l'enquête de satisfaction (avis) */
  lien: { jeton: string; avis?: boolean } | null;
}

interface NotificationInterne {
  id: string;
  destinataireId: string;
  modele: string;
  sujet: string;
  contenu: string;
  reclamationId: string | null;
  creeLe: Date;
  lueLe: Date | null;
}

interface LigneJournal {
  rang: number;
  horodatage: Date;
  acteur: { type: 'CLIENT' | 'UTILISATEUR' | 'SYSTEME'; id: string | null; libelle: string | null; role: string | null };
  action: string;
  entite: string | null;
  entiteId: string | null;
  donnees: Record<string, unknown> | null;
}

export interface BanqueDemo {
  nom: string;
  slug: string;
  prefixe: string;
  couleur: string;
  logoUrl: string | null;
}

export interface EntreeDepot {
  categorieId: string;
  agenceId?: string | null;
  description: string;
  nom: string;
  telephone?: string;
  email?: string;
  consentement: boolean;
  fichiers?: { nom: string; taille: number; type: string }[];
  /** Préparée avec l'assistant du portail (étape 18) */
  viaAssistant?: boolean;
}

/* ------------------------------------------------------------------ Erreurs (RFC 9457) */

export class ErreurDemo extends Error {
  constructor(readonly probleme: S<'Probleme'>) {
    super(probleme.title);
  }
}

function erreur(status: number, code: S<'CodeErreur'>, title: string, detail?: string, erreurs?: S<'ErreurChamp'>[]): ErreurDemo {
  return new ErreurDemo({
    type: `/erreurs/${code.toLowerCase().replaceAll('_', '-')}`,
    title,
    status,
    code,
    ...(detail ? { detail } : {}),
    ...(erreurs ? { erreurs } : {}),
  });
}

const STATUT_REFUS: Record<string, number> = {
  TRANSITION_INTERDITE: 409,
  ACTEUR_NON_AUTORISE: 403,
  AUCUN_AGENT_ASSIGNE: 422,
  DELAI_DE_CONTESTATION_DEPASSE: 422,
  CLOTURE_AUTOMATIQUE_PREMATUREE: 422,
};

/* ------------------------------------------------------------------ Outils */

const MINUTE = 60_000;
const hex = (n: number, l: number) => n.toString(16).padStart(l, '0');

/** Générateur pseudo-aléatoire reproductible (mulberry32) : même historique à chaque ouverture. */
export function aleatoire(graine: number) {
  let a = graine >>> 0;
  const suivant = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    nombre: suivant,
    entier: (min: number, max: number) => min + Math.floor(suivant() * (max - min + 1)),
    parmi: <T,>(liste: readonly T[]) => liste[Math.floor(suivant() * liste.length)]!,
    pondere: <T,>(liste: readonly (readonly [T, number])[]) => {
      const total = liste.reduce((s, [, p]) => s + p, 0);
      let r = suivant() * total;
      for (const [v, p] of liste) if ((r -= p) < 0) return v;
      return liste[liste.length - 1]![0];
    },
  };
}

const minutesDe = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

/* ------------------------------------------------------------------ Le moteur */

export const PERSONNES = {
  admin: PERSONNEL.find((u) => u.role === 'ADMIN_ENTREPRISE')!,
  superviseur: PERSONNEL.find((u) => u.prenom === 'Serge')!,
  agent: PERSONNEL.find((u) => u.prenom === 'Aya')!,
};

export class Moteur {
  readonly banque: BanqueDemo;
  maintenant: Date;
  readonly calendrier: CalendrierNormalise;
  readonly sla: ParametresSla;

  private tickets: Ticket[] = [];
  private clients: Client[] = [];
  readonly envois: Envoi[] = [];
  private notifications: NotificationInterne[] = [];
  private journal: LigneJournal[] = [];
  private otp = new Map<string, { code: string; expire: Date; essais: number }>();
  private sessions = new Map<string, string>();
  private compteur: number;
  private seq = 0;
  private hasard = aleatoire(7);
  private abonnes = new Set<() => void>();
  version = 0;
  /** Pendant le rejeu de l'historique, on ne prévient personne. */
  private silencieux = false;
  /** Enquêtes de satisfaction activées pour la banque de démonstration (décision I2) */
  enquetesActives = true;
  /** Chat web ouvert pour la banque de démonstration (étape 17, décision I2) */
  chatActif = true;
  /** Assistant du portail ouvert (étape 18) ; dans la démo, ses décisions viennent des règles, sans IA */
  assistantActif = true;
  /** Rejeu de l'historique : appelé à l'ouverture de chaque enquête, pour simuler des réponses */
  apresOuvertureEnquete: ((t: Ticket) => void) | null = null;
  /** Attribution (étape 16) : mode suggestion par défaut, comme le jeu de démonstration */
  modeAttribution: S<'ModeAttribution'> = REGLES.mode;
  private derniereAttribution = new Map<string, Date>();
  private absences: { id: string; agentId: string; du: string; au: string; creeLe: Date }[] = [];

  constructor(banque: BanqueDemo, maintenant: Date, compteurInitial = 2000) {
    this.banque = banque;
    this.maintenant = new Date(maintenant);
    this.compteur = compteurInitial;
    this.calendrier = normaliserCalendrier({
      fuseauHoraire: HORAIRES.fuseauHoraire,
      plages: HORAIRES.plages.map((p) => ({ jourSemaine: p.jourSemaine, debutMinute: minutesDe(p.debut), finMinute: minutesDe(p.fin) })),
      joursFeries: JOURS_FERIES.map((j) => ({ date: j.date, recurrent: j.recurrent })),
    });
    this.sla = { calendrier: this.calendrier, seuilAlertePourcent: PARAMETRES.seuilAlerteSlaPourcent, delaiClotureAutoJours: PARAMETRES.delaiClotureAutoJours };
  }

  /** À l'ouverture de la démo : Adjoua est absente jusqu'à après-demain, Ibrahim le sera dans dix jours. */
  declarerAbsencesDeDemo() {
    const jour = (n: number) => dateLocale(new Date(this.maintenant.getTime() + n * 86_400_000), this.calendrier);
    const adjoua = PERSONNEL.find((u) => u.prenom === 'Adjoua')!.id;
    const ibrahim = PERSONNEL.find((u) => u.prenom === 'Ibrahim')!.id;
    this.absences = [
      { id: '01998888-0000-7000-8000-000000000001', agentId: adjoua, du: jour(-1), au: jour(2), creeLe: new Date(this.maintenant.getTime() - 2 * 86_400_000) },
      { id: '01998888-0000-7000-8000-000000000002', agentId: ibrahim, du: jour(10), au: jour(14), creeLe: new Date(this.maintenant.getTime() - 86_400_000) },
    ];
  }

  /* -------------------------------------------------------------- Abonnement (React) */

  abonner = (f: () => void) => {
    this.abonnes.add(f);
    return () => this.abonnes.delete(f);
  };
  lireVersion = () => this.version;
  private changer() {
    this.version++;
    if (!this.silencieux) for (const f of this.abonnes) f();
  }
  /** Exécute sans notifier à chaque étape (rejeu de l'historique), puis notifie une fois. */
  enSilence(f: () => void) {
    this.silencieux = true;
    try {
      f();
    } finally {
      this.silencieux = false;
      this.changer();
    }
  }

  /* -------------------------------------------------------------- Identifiants */

  private nouvelId(prefixe: string) {
    this.seq++;
    return `0199${prefixe}-${hex(this.seq >> 16, 4)}-7${hex(this.seq & 0xfff, 3)}-8000-${hex(this.seq * 2654435761 >>> 0, 12)}`;
  }

  /* -------------------------------------------------------------- Personnes et acteurs */

  personne(id: string | null) {
    return id ? PERSONNEL.find((u) => u.id === id) ?? null : null;
  }
  private nomDe(id: string | null) {
    const p = this.personne(id);
    return p ? `${p.prenom} ${p.nom}` : null;
  }
  private acteurUtilisateur(id: string): Acteur {
    const p = this.personne(id);
    if (!p || p.statut !== 'ACTIF') throw erreur(401, 'NON_AUTHENTIFIE', 'Session inconnue');
    return { type: 'UTILISATEUR', id: p.id, role: p.role, libelle: `${p.prenom} ${p.nom}` };
  }
  private superviseurs() {
    return PERSONNEL.filter((u) => u.role === 'SUPERVISEUR' && u.statut === 'ACTIF');
  }
  private superviseurDe(agentId: string | null) {
    const sup = this.personne(agentId)?.superviseur?.id;
    return sup ?? this.superviseurs()[0]!.id;
  }

  /* -------------------------------------------------------------- Horloge */

  /** Avance l'horloge, en déclenchant les tâches planifiées à l'instant exact où elles échoient. */
  avancer(minutes: number) {
    this.avancerJusqua(new Date(this.maintenant.getTime() + minutes * MINUTE));
    this.changer();
  }

  avancerJusqua(cible: Date) {
    for (let garde = 0; garde < 10_000; garde++) {
      const prochaine = this.prochaineEcheance();
      if (!prochaine || prochaine > cible) break;
      if (prochaine > this.maintenant) this.maintenant = prochaine;
      this.taches();
    }
    if (cible > this.maintenant) this.maintenant = new Date(cible);
    this.taches();
  }

  /** Prochain instant où une tâche planifiée a quelque chose à faire. */
  prochaineEcheance(): Date | null {
    let min: number | null = null;
    const voir = (d: Date | null) => {
      if (d && (min === null || d.getTime() < min)) min = d.getTime();
    };
    for (const t of this.tickets) {
      if (t.statut === 'OUVERTE' || t.statut === 'EN_COURS') {
        if (!t.alerteEnvoyee) voir(t.alertePreventiveLe);
        if (!t.depassementSignale) voir(t.echeanceSlaLe);
        else if (!t.escaladeeAdminLe) voir(this.instantEscaladeAdmin(t));
      }
      if (t.statut === 'RESOLUE') voir(t.clotureAutoPrevueLe);
      const c = t.conversation;
      if (c?.dernierMessageBanqueLe && nonLueParLeClient(c) && (!c.avisClientLe || c.avisClientLe < c.dernierMessageBanqueLe)) {
        voir(new Date(c.dernierMessageBanqueLe.getTime() + DELAI_AVIS_CLIENT_MS));
      }
    }
    return min === null ? null : new Date(min);
  }

  /** Prochain instant de l'alerte à 75 % ou de l'échéance d'une réclamation (pour la visite guidée). */
  jalonsDe(id: string) {
    const t = this.ticket(id);
    return { alerte: t.alerteEnvoyee ? null : t.alertePreventiveLe, echeance: t.depassementSignale ? null : t.echeanceSlaLe, clotureAuto: t.clotureAutoPrevueLe };
  }

  /** Tâches planifiées de l'étape 4 : alerte préventive, dépassement + escalade, clôture automatique. */
  private taches() {
    const now = this.maintenant;
    for (const t of this.tickets) {
      if ((t.statut === 'OUVERTE' || t.statut === 'EN_COURS') && !t.alerteEnvoyee && t.alertePreventiveLe && t.alertePreventiveLe <= now) {
        t.alerteEnvoyee = true;
        this.evenement(t, 'ALERTE_SLA_PREVENTIVE', null, null, { type: 'SYSTEME', id: null }, false);
        const pour = t.agentId ? [t.agentId] : this.superviseurs().map((s) => s.id);
        for (const d of pour)
          this.notifier(d, 'sla.alerte_preventive', 'Seuil d\'alerte atteint', `${t.numero} : ${PARAMETRES.seuilAlerteSlaPourcent} % du délai consommé.`, t.id);
        this.auditer(null, 'sla.alerte_preventive', t, { seuil: PARAMETRES.seuilAlerteSlaPourcent });
      }
      if ((t.statut === 'OUVERTE' || t.statut === 'EN_COURS') && !t.depassementSignale && t.echeanceSlaLe && t.echeanceSlaLe <= now) {
        t.depassementSignale = true;
        this.evenement(t, 'DEPASSEMENT_SLA', null, null, { type: 'SYSTEME', id: null }, false);
        if (!t.escaladeeVersId) {
          t.escaladeeVersId = this.superviseurDe(t.agentId);
          t.escaladeeLe = new Date(now);
          this.evenement(t, 'ESCALADE', null, null, { type: 'SYSTEME', id: null }, false);
        }
        for (const d of new Set([t.agentId, t.escaladeeVersId].filter((x): x is string => !!x)))
          this.notifier(d, 'sla.depassement', 'Délai SLA dépassé', `${t.numero} a dépassé son échéance et a été escaladée.`, t.id);
        this.auditer(null, 'sla.depassement', t, { escaladeeVers: t.escaladeeVersId });
      }
      // Second niveau (étape 16) : toujours en retard au-delà du seuil, l'Admin Entreprise est prévenu
      const escaladeAdmin = (t.statut === 'OUVERTE' || t.statut === 'EN_COURS') && t.depassementSignale && !t.escaladeeAdminLe ? this.instantEscaladeAdmin(t) : null;
      if (escaladeAdmin && escaladeAdmin <= now) {
        t.escaladeeAdminLe = new Date(now);
        this.evenement(t, 'ESCALADE_ADMIN', null, null, { type: 'SYSTEME', id: null }, false);
        const seuil = this.seuilEscalade(t);
        this.notifier(PERSONNES.admin.id, 'admin.escalade', `${t.numero} : retard important`, `${t.numero} (${this.categorie(t.categorieId).nom}) : ${seuil} % du délai cible atteint. Escaladée à l'Admin Entreprise.`, t.id);
        this.auditer(null, 'sla.escalade_admin', t, { seuil });
      }
      // Chat web (étape 17) : réponse restée non lue 2 minutes, le client est prévenu par SMS
      if (t.conversation && avisClientDu(t.conversation, now)) {
        t.conversation.avisClientLe = new Date(now);
        if (t.statut === 'EN_ATTENTE_CLIENT') this.envoyer(t, 'attend votre réponse.');
        else if (t.statut === 'OUVERTE' || t.statut === 'EN_COURS') this.envoyer(t, 'a reçu une réponse de la banque.');
      }
      if (t.statut === 'RESOLUE' && t.clotureAutoPrevueLe && t.clotureAutoPrevueLe <= now) {
        const v = verifierTransition('CLOTURER_AUTOMATIQUEMENT', this.etat(t), { type: 'SYSTEME' }, now);
        if (!v.ok) continue;
        this.passer(t, 'CLOTURER_AUTOMATIQUEMENT', { type: 'SYSTEME', id: null });
        t.clotureLe = new Date(now);
        t.cloture = { mode: 'AUTOMATIQUE', motif: null, precision: null, parId: null };
        this.cloturerAvecEnquete(t, 'AUTOMATIQUE');
        this.auditer(null, 'reclamation.cloture_automatique', t, { statut: 'CLOTUREE' });
      }
    }
  }

  /* -------------------------------------------------------------- Attribution et escalade (étape 16) */

  private seuilEscalade(t: Ticket): number | null {
    const c = REGLES.categories.find((x) => x.categorie.id === t.categorieId);
    return seuilEscaladeAdmin(
      t.priorite,
      { pourcent: c?.seuilEscaladeAdminPourcent ?? null, urgentPourcent: c?.seuilEscaladeAdminUrgentPourcent ?? null },
      { pourcent: REGLES.seuilEscaladeAdminPourcent, urgentPourcent: REGLES.seuilEscaladeAdminUrgentPourcent },
    );
  }

  private instantEscaladeAdmin(t: Ticket): Date | null {
    const seuil = this.seuilEscalade(t);
    return seuil && t.echeanceSlaLe ? instantEscaladeAdmin(t.echeanceSlaLe, t.delaiCibleMinutes, seuil, this.calendrier) : null;
  }

  private aTraiter(agentId: string) {
    return this.tickets.filter((t) => t.agentId === agentId && (t.statut === 'OUVERTE' || t.statut === 'EN_COURS')).length;
  }

  /** Jour de traitement : aujourd'hui pendant les heures d'ouverture, sinon le prochain jour ouvré. */
  private jourDeTraitement() {
    return dateLocale(prochainInstantOuvre(this.maintenant, this.calendrier), this.calendrier);
  }

  /** Aujourd'hui (AAAA-MM-JJ) dans le fuseau de la banque. */
  aujourdhui() {
    return dateLocale(this.maintenant, this.calendrier);
  }

  private disponibles(): Map<string, AgentDisponible> {
    const jour = this.jourDeTraitement();
    return new Map(PERSONNEL
      .filter((u) => u.role === 'AGENT' && u.statut === 'ACTIF' && !estAbsent(this.absences.filter((a) => a.agentId === u.id), jour))
      .map((u) => [u.id, { id: u.id, nom: `${u.prenom} ${u.nom}`, aTraiter: this.aTraiter(u.id), derniereAttributionLe: this.derniereAttribution.get(u.id) ?? null }]));
  }

  private groupe(id: string | undefined): Groupe | null {
    const g = id ? GROUPES.find((x) => x.id === id) : undefined;
    return g ? { id: g.id, nom: g.nom, membres: g.membres.map((m) => m.id) } : null;
  }

  private choix(t: Ticket): Choix | null {
    const gc = REGLES.categories.find((c) => c.categorie.id === t.categorieId)?.groupe?.id;
    const ga = REGLES.agences.find((a) => a.agence.id === t.agenceId)?.groupe?.id;
    return choisirAgent(this.groupe(gc), this.groupe(ga), this.disponibles());
  }

  /** Mode suggestion : l'agent proposé au superviseur pour une réclamation non assignée. */
  private suggestion(t: Ticket, userId: string): Choix | null {
    if (this.modeAttribution !== 'SUGGESTION' || t.agentId || t.statut !== 'OUVERTE' || this.personne(userId)?.role !== 'SUPERVISEUR') return null;
    return this.choix(t);
  }

  changerModeAttribution(mode: S<'ModeAttribution'>) {
    this.modeAttribution = mode;
    this.auditer(PERSONNES.admin.id, 'parametrage.regles_traitement', null, { mode });
    this.changer();
  }

  regles(): S<'ReglesTraitement'> {
    return { ...REGLES, mode: this.modeAttribution };
  }

  groupes(): S<'GroupeAgents'>[] {
    const aujourdhui = this.aujourdhui();
    return GROUPES.map((g) => ({
      ...g,
      membres: g.membres.map((m) => ({ ...m, absent: estAbsent(this.absences.filter((a) => a.agentId === m.id), aujourdhui), aTraiter: this.aTraiter(m.id) })),
    }));
  }

  absencesAVenir(): S<'Absence'>[] {
    const aujourdhui = this.aujourdhui();
    return this.absences
      .filter((a) => a.au >= aujourdhui)
      .sort((a, b) => a.du.localeCompare(b.du) || a.au.localeCompare(b.au))
      .map((a) => ({ id: a.id, agent: { id: a.agentId, nom: this.nomDe(a.agentId)! }, du: a.du, au: a.au, creeLe: a.creeLe.toISOString() }));
  }

  ajouterAbsence(userId: string, v: S<'NouvelleAbsence'>) {
    const agent = this.personne(v.agentId);
    if (!agent || agent.role !== 'AGENT' || agent.statut === 'DESACTIVE') throw erreur(422, 'AGENT_INVALIDE', 'Seul un agent de la banque peut être déclaré absent');
    if (v.au < v.du) throw erreur(422, 'ABSENCE_INVALIDE', 'Le dernier jour précède le premier');
    if (v.au < this.aujourdhui()) throw erreur(422, 'ABSENCE_INVALIDE', 'Cette absence est déjà passée');
    const a = { id: this.nouvelId('8888'), agentId: v.agentId, du: v.du, au: v.au, creeLe: new Date(this.maintenant) };
    this.absences.push(a);
    this.auditer(userId, 'personnel.absence_ajoutee', null, { agentId: v.agentId, du: v.du, au: v.au });
    this.changer();
  }

  supprimerAbsence(userId: string, id: string) {
    const a = this.absences.find((x) => x.id === id);
    if (!a) throw erreur(404, 'INTROUVABLE', 'Absence introuvable');
    this.absences = this.absences.filter((x) => x !== a);
    this.auditer(userId, 'personnel.absence_retiree', null, { agentId: a.agentId });
    this.changer();
  }

  /** Mode automatique, pendant les heures d'ouverture : la réclamation part à l'agent le plus disponible. */
  private attribuerAutomatiquement(t: Ticket) {
    if (this.modeAttribution !== 'AUTOMATIQUE' || prochainInstantOuvre(this.maintenant, this.calendrier).getTime() !== this.maintenant.getTime()) return;
    const c = this.choix(t);
    if (!c) return;
    t.agentId = c.agent.id;
    this.derniereAttribution.set(c.agent.id, new Date(this.maintenant));
    this.evenement(t, 'ASSIGNATION', null, null, { type: 'SYSTEME', id: null }, false);
    this.notifier(c.agent.id, 'agent.assignation', 'Nouvelle réclamation assignée', `${t.numero} (${this.categorie(t.categorieId).nom}) vous a été attribuée automatiquement (groupe ${c.groupe.nom}).`, t.id);
    this.auditer(null, 'reclamation.attribution_automatique', t, { agentApres: c.agent.id, groupeId: c.groupe.id });
  }

  /* -------------------------------------------------------------- Écritures communes */

  private etat(t: Ticket): EtatTicket {
    return { statut: t.statut, agentId: t.agentId, clientId: t.clientId, clotureAutoPrevueLe: t.clotureAutoPrevueLe };
  }

  private exigerTransition(action: ActionStatut, t: Ticket, acteur: Acteur) {
    const v = verifierTransition(action, this.etat(t), acteur, this.maintenant);
    if (!v.ok) throw erreur(STATUT_REFUS[v.code] ?? 409, v.code, 'Action impossible', v.message);
  }
  private exigerOperation(op: Operation, t: Ticket, acteur: Acteur) {
    const v = verifierOperation(op, this.etat(t), acteur);
    if (!v.ok) throw erreur(STATUT_REFUS[v.code] ?? 409, v.code, 'Action impossible', v.message);
  }

  private passer(t: Ticket, action: ActionStatut, acteur: Qui) {
    const avant = t.statut;
    t.statut = TRANSITIONS[action].vers;
    this.evenement(t, TRANSITIONS[action].evenement, avant, t.statut, acteur, true);
  }

  private evenement(t: Ticket, type: TypeEvt, avant: Statut | null, apres: Statut | null, acteur: Qui, visibleClient: boolean) {
    t.evenements.push({ type, statutAvant: avant, statutApres: apres, acteur, visibleClient, date: new Date(this.maintenant) });
  }

  private message(t: Ticket, type: S<'TypeCommentaire'>, contenu: string, auteur: Qui, pieces: S<'PieceJointe'>[] = [], canal?: S<'CanalConversation'>) {
    t.messages.push({ id: this.nouvelId('3333'), type, contenu, auteur, creeLe: new Date(this.maintenant), pieces, canal: type === 'NOTE_INTERNE' ? undefined : canal ?? 'WEB' });
  }

  /** Étape 20 : par où partira la réponse (WhatsApp dans les 24 h, SMS, sinon le suivi), comme l'API. */
  private fil(t: Ticket) {
    const c = this.chatActif ? t.conversation : null;
    return canalDuFil(c, { whatsapp: this.chatActif, smsEntrant: this.chatActif }, this.maintenant);
  }
  private reponseVers(t: Ticket): S<'ReponseVers'> {
    const f = this.fil(t);
    return { canal: f.canal, finFenetreLe: f.finFenetreLe?.toISOString() ?? null };
  }

  private notifier(destinataireId: string, modele: string, sujet: string, contenu: string, reclamationId: string | null) {
    this.notifications.push({
      id: this.nouvelId('5555'), destinataireId, modele, sujet, contenu, reclamationId, creeLe: new Date(this.maintenant), lueLe: null,
    });
  }

  private urgente(t: Ticket) {
    const pour = new Set([t.agentId, ...this.superviseurs().map((s) => s.id), PERSONNES.admin.id].filter((x): x is string => !!x));
    for (const d of pour) this.notifier(d, 'reclamation.urgente', 'Réclamation urgente', `${t.numero}, ${this.categorie(t.categorieId).nom}.`, t.id);
  }

  lienSuivi(jeton: string) {
    return `https://${this.banque.slug}.${DOMAINE}/suivi/${jeton}`;
  }

  /** SMS et e-mail au client : numéro et lien seulement, jamais le contenu (décision S10). */
  private envoyer(t: Ticket, suite: string, avecLien = true) {
    const c = this.client(t.clientId);
    const texte = `${this.banque.nom} : votre réclamation ${t.numero} ${suite}${avecLien ? ` Suivi : ${this.lienSuivi(t.jetonSuivi).replace('https://', '')}` : ''}`;
    for (const [canal, destination] of [['SMS', c.telephone], ['EMAIL', c.email]] as const) {
      if (destination) this.envois.push({ id: this.nouvelId('6666'), clientId: c.id, canal, destination, texte, date: new Date(this.maintenant), lien: avecLien ? { jeton: t.jetonSuivi } : null });
    }
  }

  /**
   * Message de clôture : avec le lien de l'enquête si la banque les a activées (une seule fois,
   * sans SMS de plus), sinon le remerciement habituel.
   */
  private cloturerAvecEnquete(t: Ticket, mode: ModeClotureAvecEnquete) {
    if (!this.enquetesActives || !clotureAvecEnquete(mode)) {
      this.envoyer(t, 'est clôturée. Merci de votre confiance.', false);
      return;
    }
    t.enquete = { ouverteLe: new Date(this.maintenant), expireLe: finEnquete(this.maintenant), reponse: null };
    const c = this.client(t.clientId);
    const texte = `${this.banque.nom} : réclamation ${t.numero} close. Votre avis : ${this.lienSuivi(t.jetonSuivi).replace('https://', '')}/avis`;
    for (const [canal, destination] of [['SMS', c.telephone], ['EMAIL', c.email]] as const) {
      if (destination) this.envois.push({ id: this.nouvelId('6666'), clientId: c.id, canal, destination, texte, date: new Date(this.maintenant), lien: { jeton: t.jetonSuivi, avis: true } });
    }
    this.apresOuvertureEnquete?.(t);
  }

  private auditer(qui: string | null | 'CLIENT', action: string, t: Ticket | null, donnees: Record<string, unknown> | null = null) {
    const p = qui && qui !== 'CLIENT' ? this.personne(qui) : null;
    this.journal.push({
      rang: this.journal.length + 1,
      horodatage: new Date(this.maintenant),
      acteur: p
        ? { type: 'UTILISATEUR', id: p.id, libelle: `${p.prenom} ${p.nom}`, role: p.role }
        : qui === 'CLIENT'
          ? { type: 'CLIENT', id: t?.clientId ?? null, libelle: null, role: null }
          : { type: 'SYSTEME', id: null, libelle: null, role: null },
      action,
      entite: t ? 'reclamation' : null,
      entiteId: t?.id ?? null,
      donnees,
    });
  }

  /* -------------------------------------------------------------- Lectures de base */

  ticket(id: string) {
    const t = this.tickets.find((x) => x.id === id || x.numero === id);
    if (!t) throw erreur(404, 'INTROUVABLE', 'Réclamation introuvable');
    return t;
  }
  private client(id: string) {
    return this.clients.find((c) => c.id === id)!;
  }
  // ---- Assistant IA (étape 18) : dans la démo, les règles seules, comme sans fournisseur d'IA ----

  /** Un tour de l'assistant du portail (converserAvecAssistant). */
  converserAvecAssistant(codePoint: string, fil: readonly EchangeVu[]): S<'ReponseAssistant'> {
    this.formulaire(codePoint);
    const prochain = prochainInstantOuvre(this.maintenant, this.calendrier);
    const ouverte = prochain.getTime() === this.maintenant.getTime();
    return tourAssistant(contexteAssistant(this.banque.nom, ouverte, ouverte ? null : texteReprise(prochain, this.maintenant, HORAIRES.fuseauHoraire)), fil);
  }

  /** Brouillon de réponse pour l'agent (suggererReponse), par les règles. */
  suggererReponse(userId: string, id: string): S<'SuggestionReponse'> {
    const t = this.visibles(userId).find((x) => x.id === id);
    if (!t) throw erreur(404, 'INTROUVABLE', 'Réclamation introuvable');
    if (t.statut === 'CLOTUREE') throw erreur(409, 'RECLAMATION_CLOTUREE', 'Cette réclamation est clôturée : plus de réponse à rédiger');
    const ctx = contexteAssistant(this.banque.nom);
    const textes = [t.description, ...t.messages.filter((m) => m.type === 'MESSAGE_DU_CLIENT').map((m) => m.contenu)].join('\n');
    const proche = faqParRegles(textes, ctx.faq);
    const { brouillon } = brouillonParRegles(
      { banque: this.banque.nom, categorie: this.categorie(t.categorieId).nom, statut: t.statut, description: t.description, messages: [], faq: ctx.faq, categories: ctx.categories },
      proche ? ctx.faq.find((f) => f.id === proche.id) ?? null : null,
    );
    const categorieId = categorieParRegles(textes, ctx.categories);
    const categorie = categorieId && categorieId !== t.categorieId ? ctx.categories.find((c) => c.id === categorieId) : undefined;
    return {
      brouillon,
      alertes: alertesDe(brouillon),
      categorie: categorie ? { id: categorie.id, nom: categorie.nom } : null,
      urgente: urgenceParRegles(textes) && t.priorite !== 'URGENTE',
      source: 'REGLES',
    };
  }

  /** Base de réponses de la banque (listerReponsesAssistant). */
  reponsesAssistant(): S<'ReponseBanque'>[] {
    return REPONSES_BANQUE;
  }

  categorie(id: string) {
    const c = CATEGORIES.find((x) => x.id === id);
    if (!c) throw erreur(422, 'CATEGORIE_INVALIDE', 'Catégorie inconnue');
    return c;
  }
  private ticketParJeton(jeton: string) {
    const t = this.tickets.find((x) => x.jetonSuivi === jeton);
    if (!t) throw erreur(404, 'INTROUVABLE', 'Lien de suivi inconnu');
    return t;
  }

  /* ============================================================== Portail public */

  banquePublique(): S<'BanquePublique'> {
    return { nom: this.banque.nom, slug: this.banque.slug, logoUrl: this.banque.logoUrl, couleurPrimaire: this.banque.couleur, couleurSecondaire: null, whatsapp: this.chatActif ? WHATSAPP_DEMO : null };
  }

  formulaire(codePoint: string): S<'FormulaireDepot'> {
    const p = POINTS_DEPOT.find((x) => x.code === codePoint && x.actif);
    if (!p) throw erreur(404, 'POINT_DE_DEPOT_INACTIF', 'Ce QR code n\'est plus actif');
    return {
      assistant: this.assistantActif && this.chatActif,
      banque: this.banquePublique(),
      canal: p.canal,
      agence: p.agence,
      agences: p.agence ? [] : AGENCES.filter((a) => a.active).map((a) => ({ id: a.id, nom: a.nom })),
      categories: CATEGORIES.filter((c) => c.active).map(({ id, nom, description }) => ({ id, nom, description })),
      politiqueDonnees: { version: '2026-09', url: '/politique-donnees' },
      fichiers: { maxFichiers: 5, maxOctets: 5_242_880, types: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] },
    };
  }

  deposer(codePoint: string, e: EntreeDepot): S<'AccuseDepot'> {
    const point = POINTS_DEPOT.find((x) => x.code === codePoint && x.actif);
    if (!point) throw erreur(404, 'POINT_DE_DEPOT_INACTIF', 'Ce QR code n\'est plus actif');
    const erreurs: S<'ErreurChamp'>[] = [];
    let telephone: string | null = null;
    let email: string | null = null;
    try {
      telephone = normaliserTelephone(e.telephone);
    } catch {
      const chiffres = (e.telephone ?? '').replace(/\D/g, '').length;
      erreurs.push({ champ: 'telephone', message: `Ce numéro a ${chiffres} chiffres ; un numéro ivoirien en compte 10, par exemple 07 08 09 10 11.` });
    }
    try {
      email = normaliserEmail(e.email);
    } catch {
      erreurs.push({ champ: 'email', message: 'Adresse e-mail invalide, par exemple nom@exemple.ci.' });
    }
    if (e.description.trim().length < 10) erreurs.push({ champ: 'description', message: 'Décrivez votre réclamation en quelques mots (10 caractères au moins).' });
    if (!e.nom.trim()) erreurs.push({ champ: 'nom', message: 'Indiquez votre nom pour que la banque puisse vous répondre.' });
    if (!telephone && !email && !erreurs.some((x) => x.champ === 'telephone' || x.champ === 'email'))
      erreurs.push({ champ: 'telephone', message: 'Un téléphone ou un e-mail au moins, pour recevoir votre numéro de suivi.' });
    if (!e.consentement) erreurs.push({ champ: 'consentement', message: 'Acceptez la politique de données pour envoyer votre réclamation.' });
    if (erreurs.length) throw erreur(400, 'VALIDATION', 'Formulaire incomplet', `${erreurs.length} champ${erreurs.length > 1 ? 's' : ''} à corriger`, erreurs);

    const cat = this.categorie(e.categorieId);
    const client = this.trouverOuCreerClient(e.nom.trim(), telephone, email);
    this.compteur++;
    const annee = this.maintenant.getUTCFullYear();
    const t: Ticket = {
      id: this.nouvelId('2222'),
      numero: `${this.banque.prefixe}-${annee}-${String(this.compteur).padStart(6, '0')}`,
      jetonSuivi: `S${hex(this.seq * 40503 >>> 0, 8)}${hex(this.compteur * 2246822519 >>> 0, 8)}`,
      statut: 'OUVERTE',
      priorite: cat.prioriteParDefaut,
      canal: point.canal,
      categorieId: cat.id,
      agenceId: point.agence?.id ?? e.agenceId ?? null,
      pointId: point.id,
      agentId: null,
      escaladeeVersId: null,
      clientId: client.id,
      description: e.description.trim(),
      pieces: (e.fichiers ?? []).map((f) => ({ id: this.nouvelId('4444'), nomFichier: f.nom, typeMime: f.type, tailleOctets: f.taille, creeLe: new Date(this.maintenant).toISOString() })),
      creeLe: new Date(this.maintenant),
      delaiCibleMinutes: cat.delaiCibleMinutes,
      ...slaAuDepot(this.maintenant, cat.delaiCibleMinutes, this.sla),
      slaRespecte: null,
      prisEnChargeLe: null,
      premiereReponseLe: null,
      resolueLe: null,
      clotureLe: null,
      clotureAutoPrevueLe: null,
      escaladeeLe: null,
      escaladeeAdminLe: null,
      cloture: null,
      nbReouvertures: 0,
      aEteQuestionne: false,
      alerteEnvoyee: false,
      depassementSignale: false,
      messages: [],
      evenements: [],
      enquete: null,
      conversation: null,
      viaAssistant: !!e.viaAssistant && this.assistantActif,
    };
    this.tickets.push(t);
    this.evenement(t, 'CREATION', null, 'OUVERTE', { type: 'CLIENT', id: client.id }, true);
    this.attribuerAutomatiquement(t);
    this.envoyer(t, 'est bien reçue.');
    if (t.priorite === 'URGENTE') this.urgente(t);
    this.auditer('CLIENT', 'reclamation.depot', t, { statut: 'OUVERTE', priorite: t.priorite });
    this.changer();
    return { numero: t.numero, lienSuivi: this.lienSuivi(t.jetonSuivi), jetonSuivi: t.jetonSuivi };
  }

  private trouverOuCreerClient(nom: string, telephone: string | null, email: string | null) {
    const connu = this.clients.find((c) => (telephone && c.telephone === telephone) || (email && c.email === email));
    if (connu) {
      connu.telephone ??= telephone;
      connu.email ??= email;
      return connu;
    }
    const c = { id: this.nouvelId('1111'), nom, telephone, email };
    this.clients.push(c);
    return c;
  }

  /** Étapes visibles du client : changements de statut seulement. */
  private etapesClient(t: Ticket): S<'EtapeSuivi'>[] {
    return t.evenements
      .filter((e) => e.visibleClient && e.statutApres)
      .map((e) => ({ type: e.type, statut: e.statutApres!, date: e.date.toISOString() }));
  }

  suivi(jeton: string): S<'SuiviPublic'> {
    const t = this.ticketParJeton(jeton);
    return {
      numero: t.numero,
      statut: t.statut,
      categorie: this.categorie(t.categorieId).nom,
      creeLe: t.creeLe.toISOString(),
      banque: this.banquePublique(),
      etapes: this.etapesClient(t),
      avis: t.enquete ? { etat: etatAvis({ reponduLe: t.enquete.reponse?.reponduLe ?? null, expireLe: t.enquete.expireLe }, this.maintenant), expireLe: t.enquete.expireLe.toISOString() } : null,
    };
  }

  /* ============================================================== Enquête de satisfaction (étape 15) */

  private etatEnquete(e: Enquete) {
    return etatAvis({ reponduLe: e.reponse?.reponduLe ?? null, expireLe: e.expireLe }, this.maintenant);
  }
  private reponseEnquete(e: Enquete) {
    return e.reponse ? { ...e.reponse, reponduLe: e.reponse.reponduLe.toISOString() } : null;
  }

  lireAvis(jeton: string): S<'Avis'> {
    const t = this.ticketParJeton(jeton);
    if (!t.enquete) throw erreur(404, 'INTROUVABLE', 'Pas d\'enquête pour cette réclamation');
    return {
      numero: t.numero,
      categorie: this.categorie(t.categorieId).nom,
      banque: this.banquePublique(),
      etat: this.etatEnquete(t.enquete),
      expireLe: t.enquete.expireLe.toISOString(),
      reponse: this.reponseEnquete(t.enquete),
    };
  }

  donnerAvis(jeton: string, r: S<'ReponseAvis'>): S<'Avis'> {
    const t = this.ticketParJeton(jeton);
    const reponse = normaliserReponse(r);
    if (typeof reponse === 'string') throw erreur(400, 'VALIDATION', 'Réponse invalide', reponse);
    const e = t.enquete;
    if (!e) throw erreur(404, 'INTROUVABLE', 'Pas d\'enquête pour cette réclamation');
    const etat = this.etatEnquete(e);
    if (etat === 'DONNE') throw erreur(409, 'AVIS_DEJA_DONNE', 'Avis déjà donné', 'Votre réponse a déjà été enregistrée ; elle ne se modifie plus.');
    if (etat === 'TERMINE') throw erreur(422, 'ENQUETE_TERMINEE', 'Enquête terminée', 'Les 7 jours pour répondre sont passés.');
    e.reponse = { ...reponse, reponduLe: new Date(this.maintenant) };
    this.auditer('CLIENT', 'client.avis_donne', t);
    this.changer();
    return this.lireAvis(jeton);
  }

  demanderCode(jeton: string, canal?: S<'CanalOtp'>): S<'OtpEnvoye'> {
    const t = this.ticketParJeton(jeton);
    const c = this.client(t.clientId);
    const choisi: S<'CanalOtp'> = canal ?? (c.telephone ? 'SMS' : 'EMAIL');
    const destination = choisi === 'SMS' ? c.telephone : c.email;
    if (!destination) throw erreur(422, 'CONTACT_REQUIS', choisi === 'SMS' ? 'Aucun téléphone pour cette réclamation' : 'Aucun e-mail pour cette réclamation');
    const code = String(this.hasard.entier(100000, 999999));
    this.otp.set(jeton, { code, expire: new Date(this.maintenant.getTime() + 10 * MINUTE), essais: 0 });
    this.envois.push({
      id: this.nouvelId('6666'), clientId: c.id, canal: choisi, destination, date: new Date(this.maintenant), lien: null,
      texte: `${this.banque.nom} : votre code est ${code}. Il expire dans 10 minutes. Ne le communiquez à personne.`,
    });
    this.changer();
    return {
      canal: choisi,
      destinationMasquee: choisi === 'SMS'
        ? destination.replace(/^\+225(\d{2})\d{6}(\d{2})$/, '+225 $1 •• •• •• $2')
        : destination.replace(/^(.).*(@.*)$/, '$1••••$2'),
      expireDans: 600,
    };
  }

  verifierCode(jeton: string, code: string): S<'SessionClient'> {
    const t = this.ticketParJeton(jeton);
    const o = this.otp.get(jeton);
    if (!o) throw erreur(422, 'CODE_OTP_INVALIDE', 'Demandez d\'abord un code');
    if (o.expire < this.maintenant) throw erreur(422, 'CODE_OTP_EXPIRE', 'Code expiré', 'Demandez un nouveau code.');
    if (++o.essais > 5) throw erreur(429, 'TROP_DE_TENTATIVES', 'Trop d\'essais', 'Demandez un nouveau code.');
    if (o.code !== code.replace(/\D/g, '')) throw erreur(422, 'CODE_OTP_INVALIDE', 'Code incorrect', `Vérifiez le code reçu. ${5 - o.essais} essai(s) restant(s).`);
    this.otp.delete(jeton);
    const jetonClient = `C${this.nouvelId('7777')}`;
    this.sessions.set(jetonClient, t.clientId);
    this.changer();
    return { jetonClient, expireDans: 1800 };
  }

  /* ============================================================== Espace client */

  private clientDeSession(jeton: string) {
    const id = this.sessions.get(jeton);
    if (!id) throw erreur(401, 'JETON_INVALIDE', 'Session expirée', 'Demandez un nouveau code.');
    return id;
  }
  private ticketDuClient(jeton: string, id: string) {
    const clientId = this.clientDeSession(jeton);
    const t = this.ticket(id);
    if (t.clientId !== clientId) throw erreur(404, 'INTROUVABLE', 'Réclamation introuvable');
    return { t, acteur: { type: 'CLIENT', clientId } as Acteur };
  }

  mesReclamations(jeton: string): S<'ReclamationClientResume'>[] {
    const clientId = this.clientDeSession(jeton);
    return this.tickets
      .filter((t) => t.clientId === clientId)
      .sort((a, b) => b.creeLe.getTime() - a.creeLe.getTime())
      .map((t) => ({ id: t.id, numero: t.numero, statut: t.statut, categorie: this.categorie(t.categorieId).nom, creeLe: t.creeLe.toISOString() }));
  }

  maReclamation(jeton: string, id: string): S<'ReclamationClient'> {
    const { t, acteur } = this.ticketDuClient(jeton, id);
    return {
      id: t.id,
      numero: t.numero,
      statut: t.statut,
      categorie: this.categorie(t.categorieId).nom,
      description: t.description,
      creeLe: t.creeLe.toISOString(),
      clotureAutoPrevueLe: t.statut === 'RESOLUE' && t.clotureAutoPrevueLe ? t.clotureAutoPrevueLe.toISOString() : null,
      messages: t.messages
        .filter((m) => m.type !== 'NOTE_INTERNE')
        .map((m) => ({
          id: m.id,
          type: m.type as 'REPONSE_AU_CLIENT' | 'MESSAGE_DU_CLIENT',
          contenu: m.contenu,
          canal: m.canal ?? null,
          auteur: m.type === 'MESSAGE_DU_CLIENT' ? 'CLIENT' : 'BANQUE',
          creeLe: m.creeLe.toISOString(),
          piecesJointes: m.pieces,
        })),
      piecesJointes: t.pieces,
      etapes: this.etapesClient(t),
      actionsPossibles: this.actions(t, acteur),
      operationsPossibles: this.operations(t, acteur),
      avis: t.enquete ? { etat: this.etatEnquete(t.enquete), expireLe: t.enquete.expireLe.toISOString(), chemin: `/suivi/${t.jetonSuivi}/avis` } : null,
      chat: this.chatActif ? this.etatChat(t) : null,
    };
  }

  /* -------------------------------------------------------------- Chat web (étape 17) */

  private etatChat(t: Ticket): S<'EtatChat'> {
    const d = disponibilite(this.maintenant, this.calendrier);
    return { ouvert: d.ouverte, repriseLe: d.repriseLe?.toISOString() ?? null, luParLaBanqueLe: t.conversation?.luBanqueLe?.toISOString() ?? null };
  }

  private ouvrirConversation(t: Ticket): Conversation {
    t.conversation ??= {
      id: this.nouvelId('7777'), canal: 'WEB', dernierMessageClientLe: null, dernierMessageBanqueLe: null, luClientLe: null, luBanqueLe: null, avisClientLe: null,
    };
    return t.conversation;
  }

  /**
   * Le téléphone affiche le chat : lecture et présence. Ne prévient l'interface que si quelque chose
   * change pour elle (conversation ouverte, réponse lue) : la démo l'appelle à chaque rendu.
   */
  lireChat(jeton: string, id: string) {
    if (!this.chatActif) return;
    const { t } = this.ticketDuClient(jeton, id);
    const nouvelle = !t.conversation;
    const c = this.ouvrirConversation(t);
    const reponseLue = nonLueParLeClient(c);
    c.luClientLe = new Date(this.maintenant);
    if (nouvelle || reponseLue) this.changer();
  }

  private conversationResume(t: Ticket): S<'ConversationResume'> {
    const c = t.conversation!;
    const publics = t.messages.filter((m) => m.type !== 'NOTE_INTERNE');
    const dernier = publics.at(-1);
    return {
      id: c.id,
      canal: c.canal,
      reclamation: { id: t.id, numero: t.numero, statut: t.statut, priorite: t.priorite, categorie: this.categorie(t.categorieId).nom },
      client: { nom: this.client(t.clientId).nom },
      agent: t.agentId ? { id: t.agentId, nom: this.nomDe(t.agentId)! } : null,
      dernierMessage: dernier
        ? { extrait: extrait(dernier.contenu), auteur: dernier.type === 'MESSAGE_DU_CLIENT' ? 'CLIENT' : 'BANQUE', date: dernier.creeLe.toISOString() }
        : { extrait: extrait(t.description), auteur: 'CLIENT', date: t.creeLe.toISOString() },
      aRepondre: reponseDue(c, t.statut),
      nonLue: nonLueParLaBanque(c),
      clientEnLigne: c.canal === 'WEB' && clientEnLigne(c, this.maintenant),
    };
  }

  /** Boîte de réception : comme listerConversations (l'agent ses réclamations, les autres toute la banque). */
  conversations(userId: string, filtre: 'a-repondre' | 'non-lues' | 'toutes' = 'a-repondre'): S<'PageConversations'> {
    const avecClient = this.visibles(userId).filter((t) => t.conversation?.dernierMessageClientLe);
    const lignes = avecClient.map((t) => ({ t, r: this.conversationResume(t) }));
    const choisies = lignes
      .filter(({ r }) => (filtre === 'a-repondre' ? r.aRepondre : filtre === 'non-lues' ? r.nonLue : true))
      .sort((a, b) => {
        const x = a.t.conversation!.dernierMessageClientLe!.getTime();
        const y = b.t.conversation!.dernierMessageClientLe!.getTime();
        return filtre === 'a-repondre' ? x - y : y - x;
      })
      .map(({ r }) => r);
    return {
      donnees: choisies,
      pagination: { page: 1, parPage: Math.max(choisies.length, 1), total: choisies.length },
      compteurs: { aRepondre: lignes.filter(({ r }) => r.aRepondre).length, nonLues: lignes.filter(({ r }) => r.nonLue).length },
    };
  }

  private ticketDeConversation(userId: string, id: string): Ticket {
    const t = this.visibles(userId).find((x) => x.conversation?.id === id);
    if (!t) throw erreur(404, 'INTROUVABLE', 'Conversation introuvable');
    return t;
  }

  conversation(userId: string, id: string): S<'ConversationDetail'> {
    const t = this.ticketDeConversation(userId, id);
    const r = this.conversationResume(t);
    const c = t.conversation!;
    return {
      id: r.id,
      canal: r.canal,
      reclamation: r.reclamation,
      client: r.client,
      agent: r.agent,
      description: t.description,
      deposeeLe: t.creeLe.toISOString(),
      messages: t.messages
        .filter((m) => m.type !== 'NOTE_INTERNE')
        .map((m) => ({
          id: m.id, type: m.type, contenu: m.contenu, canal: m.canal ?? null, creeLe: m.creeLe.toISOString(), piecesJointes: m.pieces,
          auteur: { type: m.auteur.type, nom: m.auteur.type === 'UTILISATEUR' ? this.nomDe(m.auteur.id) : null },
        })),
      aRepondre: r.aRepondre,
      nonLue: r.nonLue,
      clientEnLigne: r.clientEnLigne,
      luParLeClientLe: c.luClientLe?.toISOString() ?? null,
      reponseVers: this.reponseVers(t),
      operationsPossibles: this.operations(t, this.acteurUtilisateur(userId)),
    };
  }

  /** Lecture par la banque : l'agent assigné, ou un superviseur si la réclamation n'est pas assignée. */
  marquerConversationLue(userId: string, id: string) {
    const t = this.ticketDeConversation(userId, id);
    const c = t.conversation!;
    const p = this.personne(userId)!;
    if (!nonLueParLaBanque(c) || !marqueLaLecture({ id: userId, role: p.role }, t.agentId)) return;
    c.luBanqueLe = new Date(this.maintenant);
    this.changer();
  }

  messageClient(jeton: string, id: string, contenu: string, canal: S<'CanalConversation'> = 'WEB') {
    const { t, acteur } = this.ticketDuClient(jeton, id);
    if (!contenu.trim()) throw erreur(422, 'MESSAGE_VIDE', 'Écrivez votre message');
    this.exigerOperation('MESSAGE_DU_CLIENT', t, acteur);
    this.message(t, 'MESSAGE_DU_CLIENT', contenu.trim(), { type: 'CLIENT', id: t.clientId }, [], canal);
    if (t.statut === 'EN_ATTENTE_CLIENT') {
      this.exigerTransition('REPRENDRE_SUR_REPONSE', t, acteur);
      Object.assign(t, slaALaReprise(this.maintenant, t, this.sla));
      this.passer(t, 'REPRENDRE_SUR_REPONSE', { type: 'CLIENT', id: t.clientId });
    } else {
      this.evenement(t, 'MESSAGE', null, null, { type: 'CLIENT', id: t.clientId }, true);
    }
    // Chat web (étape 17) : une rafale de messages n'alerte l'agent qu'une fois
    let alerter = true;
    if (this.chatActif) {
      const c = this.ouvrirConversation(t);
      alerter = alerterAgent(c);
      c.canal = canal;
      c.dernierMessageClientLe = new Date(this.maintenant);
      c.luClientLe = new Date(this.maintenant);
    }
    if (t.agentId && alerter) this.notifier(t.agentId, 'agent.message_client', 'Message du client', `Le client a écrit sur ${t.numero}.`, t.id);
    this.auditer('CLIENT', 'reclamation.message_client', t);
    this.changer();
  }

  confirmer(jeton: string, id: string) {
    const { t, acteur } = this.ticketDuClient(jeton, id);
    this.exigerTransition('CONFIRMER', t, acteur);
    this.passer(t, 'CONFIRMER', { type: 'CLIENT', id: t.clientId });
    t.clotureLe = new Date(this.maintenant);
    t.cloture = { mode: 'CONFIRMATION_CLIENT', motif: null, precision: null, parId: null };
    this.cloturerAvecEnquete(t, 'CONFIRMATION_CLIENT');
    this.auditer('CLIENT', 'reclamation.confirmation', t, { statut: 'CLOTUREE' });
    this.changer();
  }

  contester(jeton: string, id: string, motif: string) {
    const { t, acteur } = this.ticketDuClient(jeton, id);
    if (!motif.trim()) throw erreur(422, 'MESSAGE_VIDE', 'Expliquez ce qui ne vous convient pas');
    this.exigerTransition('CONTESTER', t, acteur);
    this.message(t, 'MESSAGE_DU_CLIENT', motif.trim(), { type: 'CLIENT', id: t.clientId });
    Object.assign(t, slaALaReprise(this.maintenant, t, this.sla));
    t.clotureAutoPrevueLe = null;
    t.slaRespecte = null;
    t.nbReouvertures++;
    this.passer(t, 'CONTESTER', { type: 'CLIENT', id: t.clientId });
    if (t.agentId) this.notifier(t.agentId, 'agent.contestation', 'Résolution contestée', `Le client conteste la résolution de ${t.numero}.`, t.id);
    this.auditer('CLIENT', 'reclamation.contestation', t, { statut: 'EN_COURS' });
    this.changer();
  }

  /* ============================================================== Back-office */

  private actions(t: Ticket, acteur: Acteur): S<'ActionStatut'>[] {
    return (Object.keys(TRANSITIONS) as ActionStatut[]).filter((a) => verifierTransition(a, this.etat(t), acteur, this.maintenant).ok);
  }
  private operations(t: Ticket, acteur: Acteur): S<'OperationTicket'>[] {
    return (Object.keys(OPERATIONS) as Operation[]).filter((o) => verifierOperation(o, this.etat(t), acteur).ok);
  }

  /** Ce qu'un utilisateur voit : l'agent ses réclamations, les autres toute la banque. */
  private visibles(userId: string) {
    const u = this.acteurUtilisateur(userId);
    return this.tickets.filter((t) => !(u.type === 'UTILISATEUR' && u.role === 'AGENT' && t.agentId !== u.id));
  }

  private chrono(t: Ticket): { etat: S<'EtatChrono'>; minutesRestantes: number | null } {
    if (t.statut === 'RESOLUE' || t.statut === 'CLOTUREE') return { etat: 'ARRETE', minutesRestantes: t.statut === 'RESOLUE' ? t.slaMinutesRestantes : null };
    if (t.slaSuspenduLe) return { etat: 'EN_PAUSE', minutesRestantes: t.slaMinutesRestantes };
    if (!t.echeanceSlaLe) return { etat: 'DANS_LES_DELAIS', minutesRestantes: t.slaMinutesRestantes };
    const now = this.maintenant;
    const restantes = t.echeanceSlaLe > now
      ? Math.floor(minutesOuvreesEntre(now, t.echeanceSlaLe, this.calendrier))
      : -Math.ceil(minutesOuvreesEntre(t.echeanceSlaLe, now, this.calendrier));
    const etat = t.echeanceSlaLe <= now ? 'DEPASSE' : t.alertePreventiveLe && t.alertePreventiveLe <= now ? 'ALERTE' : 'DANS_LES_DELAIS';
    return { etat, minutesRestantes: restantes };
  }

  private resume(t: Ticket, userId: string): S<'ReclamationResume'> {
    const c = this.chrono(t);
    const suggeree = this.suggestion(t, userId);
    return {
      id: t.id,
      numero: t.numero,
      statut: t.statut,
      priorite: t.priorite,
      canal: t.canal,
      categorie: { id: t.categorieId, nom: this.categorie(t.categorieId).nom },
      agence: t.agenceId ? { id: t.agenceId, nom: AGENCES.find((a) => a.id === t.agenceId)!.nom } : null,
      agent: t.agentId ? { id: t.agentId, nom: this.nomDe(t.agentId)! } : null,
      agentSuggere: suggeree ? { id: suggeree.agent.id, nom: suggeree.agent.nom } : null,
      client: { nom: this.client(t.clientId).nom },
      creeLe: t.creeLe.toISOString(),
      echeanceSlaLe: t.echeanceSlaLe && c.etat !== 'EN_PAUSE' ? t.echeanceSlaLe.toISOString() : null,
      enRetard: c.etat === 'DEPASSE',
      escaladee: t.escaladeeVersId !== null,
      sla: { etat: c.etat, delaiCibleMinutes: t.delaiCibleMinutes, minutesRestantes: c.etat === 'ARRETE' ? null : c.minutesRestantes },
    };
  }

  /** Files : réclamations en cours de la personne, plus les dernières clôturées. */
  files(userId: string): S<'PageReclamations'> {
    const vus = this.visibles(userId);
    const actives = vus.filter((t) => t.statut !== 'CLOTUREE');
    const recentes = vus.filter((t) => t.statut === 'CLOTUREE').sort((a, b) => (b.clotureLe?.getTime() ?? 0) - (a.clotureLe?.getTime() ?? 0)).slice(0, 8);
    const donnees = [...actives, ...recentes].sort((a, b) => b.creeLe.getTime() - a.creeLe.getTime()).map((t) => this.resume(t, userId));
    const agent = this.personne(userId)?.role === 'AGENT';
    return {
      donnees,
      pagination: { page: 1, parPage: donnees.length, total: vus.length },
      compteurs: {
        recues: agent ? 0 : donnees.filter((r) => r.agent === null && r.statut !== 'CLOTUREE').length,
        assignees: donnees.filter((r) => r.agent?.id === userId && r.statut !== 'CLOTUREE').length,
        urgentes: donnees.filter((r) => r.priorite === 'URGENTE' && r.statut !== 'CLOTUREE').length,
        enRetard: donnees.filter((r) => r.enRetard).length,
        escaladees: donnees.filter((r) => r.escaladee && r.statut !== 'CLOTUREE').length,
      },
    };
  }

  fiche(userId: string, id: string): S<'ReclamationDetail'> {
    const t = this.ticket(id);
    const acteur = this.acteurUtilisateur(userId);
    if (!this.visibles(userId).includes(t)) throw erreur(404, 'INTROUVABLE', 'Réclamation introuvable');
    const c = this.client(t.clientId);
    const point = POINTS_DEPOT.find((p) => p.id === t.pointId)!;
    const chrono = this.chrono(t);
    const qui = (q: Qui): S<'ActeurVisible'> => ({ type: q.type, nom: q.type === 'UTILISATEUR' ? this.nomDe(q.id) : null });
    const iso = (d: Date | null) => (d ? d.toISOString() : null);
    return {
      id: t.id,
      numero: t.numero,
      statut: t.statut,
      priorite: t.priorite,
      canal: t.canal,
      description: t.description,
      categorie: { id: t.categorieId, nom: this.categorie(t.categorieId).nom },
      agence: t.agenceId ? { id: t.agenceId, nom: AGENCES.find((a) => a.id === t.agenceId)!.nom } : null,
      pointDepot: { id: point.id, libelle: point.libelle },
      agent: t.agentId ? { id: t.agentId, nom: this.nomDe(t.agentId)! } : null,
      escaladeeVers: t.escaladeeVersId ? { id: t.escaladeeVersId, nom: this.nomDe(t.escaladeeVersId)! } : null,
      client: { id: c.id, nom: c.nom, email: c.email, telephone: c.telephone },
      creeLe: t.creeLe.toISOString(),
      sla: {
        etat: chrono.etat,
        delaiCibleMinutes: t.delaiCibleMinutes,
        echeanceLe: chrono.etat === 'EN_PAUSE' ? null : iso(t.echeanceSlaLe),
        alertePreventiveLe: chrono.etat === 'EN_PAUSE' ? null : iso(t.alertePreventiveLe),
        enPauseDepuis: iso(t.slaSuspenduLe),
        minutesRestantes: chrono.minutesRestantes,
        enRetard: chrono.etat === 'DEPASSE',
        respecte: t.slaRespecte,
      },
      jalons: {
        prisEnChargeLe: iso(t.prisEnChargeLe),
        premiereReponseLe: iso(t.premiereReponseLe),
        resolueLe: iso(t.resolueLe),
        clotureLe: iso(t.clotureLe),
        clotureAutoPrevueLe: iso(t.clotureAutoPrevueLe),
        escaladeeLe: iso(t.escaladeeLe),
        escaladeeAdminLe: iso(t.escaladeeAdminLe),
      },
      cloture: t.cloture
        ? { mode: t.cloture.mode, motif: t.cloture.motif, precision: t.cloture.precision, par: t.cloture.parId ? { id: t.cloture.parId, nom: this.nomDe(t.cloture.parId)! } : null }
        : null,
      nbReouvertures: t.nbReouvertures,
      messages: t.messages.map((m) => ({ id: m.id, type: m.type, contenu: m.contenu, canal: m.canal ?? null, auteur: qui(m.auteur), creeLe: m.creeLe.toISOString(), piecesJointes: m.pieces })),
      piecesJointes: t.pieces,
      chronologie: t.evenements.map((e) => ({
        type: e.type, statutAvant: e.statutAvant, statutApres: e.statutApres, acteur: qui(e.acteur), visibleClient: e.visibleClient, date: e.date.toISOString(),
      })),
      actionsPossibles: this.actions(t, acteur),
      operationsPossibles: this.operations(t, acteur),
      avis: t.enquete
        ? { etat: this.etatEnquete(t.enquete), ouverteLe: t.enquete.ouverteLe.toISOString(), expireLe: t.enquete.expireLe.toISOString(), reponse: this.reponseEnquete(t.enquete) }
        : null,
      attributionSuggeree: ((c) => (c ? { agent: { id: c.agent.id, nom: c.agent.nom }, groupe: { id: c.groupe.id, nom: c.groupe.nom } } : null))(this.suggestion(t, userId)),
      depotAssistant: !!t.viaAssistant,
      conversation: this.chatActif && t.conversation
        ? {
          id: t.conversation.id, canal: t.conversation.canal, aRepondre: reponseDue(t.conversation, t.statut), nonLue: nonLueParLaBanque(t.conversation),
          clientEnLigne: t.conversation.canal === 'WEB' && clientEnLigne(t.conversation, this.maintenant), luParLeClientLe: t.conversation.luClientLe?.toISOString() ?? null,
          reponseVers: this.reponseVers(t),
        }
        : null,
    };
  }

  agentsAssignables(): S<'ReferenceNommee'>[] {
    return PERSONNEL.filter((u) => u.role === 'AGENT' && u.statut === 'ACTIF').map((u) => ({ id: u.id, nom: `${u.prenom} ${u.nom}` }));
  }

  prendreEnCharge(userId: string, id: string) {
    const t = this.ticket(id);
    const acteur = this.acteurUtilisateur(userId);
    this.exigerTransition('PRENDRE_EN_CHARGE', t, acteur);
    this.priseEnCharge(t, userId);
    this.changer();
  }

  private priseEnCharge(t: Ticket, userId: string) {
    this.passer(t, 'PRENDRE_EN_CHARGE', { type: 'UTILISATEUR', id: userId });
    t.prisEnChargeLe = new Date(this.maintenant);
    this.envoyer(t, 'est prise en charge par un conseiller.');
    this.auditer(userId, 'reclamation.prise_en_charge', t, { statut: 'EN_COURS' });
  }

  assigner(userId: string, id: string, agentId: string) {
    const t = this.ticket(id);
    this.exigerOperation('ASSIGNER', t, this.acteurUtilisateur(userId));
    const agent = this.personne(agentId);
    if (!agent || agent.role !== 'AGENT' || agent.statut !== 'ACTIF') throw erreur(422, 'AGENT_INVALIDE', 'Choisissez un agent actif');
    if (t.agentId === agentId) return;
    t.agentId = agentId;
    this.derniereAttribution.set(agentId, new Date(this.maintenant));
    this.evenement(t, 'ASSIGNATION', null, null, { type: 'UTILISATEUR', id: userId }, false);
    this.notifier(agentId, 'agent.assignation', 'Nouvelle réclamation assignée', `${t.numero} (${this.categorie(t.categorieId).nom}) vous a été assignée par ${this.nomDe(userId)}.`, t.id);
    this.auditer(userId, 'reclamation.assignation', t, { agentId });
    this.changer();
  }

  repondre(userId: string, id: string, contenu: string, attendreReponse = false) {
    const t = this.ticket(id);
    const acteur = this.acteurUtilisateur(userId);
    if (!contenu.trim()) throw erreur(422, 'MESSAGE_VIDE', 'Écrivez votre réponse');
    this.exigerOperation('REPONDRE_AU_CLIENT', t, acteur);
    if (t.statut === 'OUVERTE') {
      this.exigerTransition('PRENDRE_EN_CHARGE', t, acteur);
      this.priseEnCharge(t, userId);
    }
    if (attendreReponse) this.exigerTransition('QUESTIONNER_CLIENT', t, acteur);
    // Étape 20 : là où le client a écrit (WhatsApp dans les 24 h, SMS), la réponse elle-même part ; elle vaut avis
    const fil = this.fil(t).canal;
    this.message(t, 'REPONSE_AU_CLIENT', contenu.trim(), { type: 'UTILISATEUR', id: userId }, [], fil);
    t.premiereReponseLe ??= new Date(this.maintenant);
    // Chat web (étape 17) : le client a ouvert le chat, le SMS attend 2 minutes qu'il lise
    const differe = this.reponseDansConversation(t, fil !== 'WEB') || fil !== 'WEB';
    if (attendreReponse) {
      Object.assign(t, slaEnPause(this.maintenant, t, this.sla));
      t.aEteQuestionne = true;
      this.passer(t, 'QUESTIONNER_CLIENT', { type: 'UTILISATEUR', id: userId });
      if (!differe) this.envoyer(t, 'attend votre réponse.');
    } else {
      this.evenement(t, 'MESSAGE', null, null, { type: 'UTILISATEUR', id: userId }, true);
      if (!differe) this.envoyer(t, 'a reçu une réponse de la banque.');
    }
    this.auditer(userId, 'reclamation.reponse_client', t, { question: attendreReponse });
    this.changer();
  }

  /** Réponse de la banque dans la conversation : lue pour la banque ; avis différé, sauf `avisDonne` (résolution). */
  private reponseDansConversation(t: Ticket, avisDonne = false): boolean {
    const c = this.chatActif ? t.conversation : null;
    if (!c) return false;
    c.dernierMessageBanqueLe = new Date(this.maintenant);
    c.luBanqueLe = new Date(this.maintenant);
    if (avisDonne) c.avisClientLe = new Date(this.maintenant);
    return !avisDonne;
  }

  noteInterne(userId: string, id: string, contenu: string) {
    const t = this.ticket(id);
    if (!contenu.trim()) throw erreur(422, 'MESSAGE_VIDE', 'Écrivez votre note');
    this.exigerOperation('NOTE_INTERNE', t, this.acteurUtilisateur(userId));
    this.message(t, 'NOTE_INTERNE', contenu.trim(), { type: 'UTILISATEUR', id: userId });
    this.auditer(userId, 'reclamation.note_interne', t);
    this.changer();
  }

  resoudre(userId: string, id: string, contenu: string) {
    const t = this.ticket(id);
    const acteur = this.acteurUtilisateur(userId);
    if (!contenu.trim()) throw erreur(422, 'MESSAGE_VIDE', 'La réponse finale au client est obligatoire');
    this.exigerTransition('RESOUDRE', t, acteur);
    this.message(t, 'REPONSE_AU_CLIENT', contenu.trim(), { type: 'UTILISATEUR', id: userId }, [], this.fil(t).canal);
    t.premiereReponseLe ??= new Date(this.maintenant);
    this.reponseDansConversation(t, true);
    const r = slaALaResolution(this.maintenant, t.creeLe, t, this.sla);
    Object.assign(t, {
      echeanceSlaLe: r.echeanceSlaLe, alertePreventiveLe: r.alertePreventiveLe, slaMinutesRestantes: r.slaMinutesRestantes, slaSuspenduLe: null,
      slaRespecte: r.slaRespecte, resolueLe: r.resolueLe, clotureAutoPrevueLe: r.clotureAutoPrevueLe,
    });
    this.passer(t, 'RESOUDRE', { type: 'UTILISATEUR', id: userId });
    const fin = r.clotureAutoPrevueLe.toLocaleDateString('fr-FR', { timeZone: this.calendrier.zone, day: '2-digit', month: '2-digit' });
    this.envoyer(t, `est résolue. Confirmez ou contestez avant le ${fin}.`);
    this.auditer(userId, 'reclamation.resolution', t, { statut: 'RESOLUE', slaRespecte: r.slaRespecte });
    this.changer();
  }

  changerPriorite(userId: string, id: string) {
    const t = this.ticket(id);
    this.exigerOperation('CHANGER_PRIORITE', t, this.acteurUtilisateur(userId));
    t.priorite = t.priorite === 'URGENTE' ? 'NORMALE' : 'URGENTE';
    this.evenement(t, 'CHANGEMENT_PRIORITE', null, null, { type: 'UTILISATEUR', id: userId }, false);
    if (t.priorite === 'URGENTE') this.urgente(t);
    this.auditer(userId, 'reclamation.priorite', t, { priorite: t.priorite });
    this.changer();
  }

  escalader(userId: string, id: string) {
    const t = this.ticket(id);
    this.exigerOperation('ESCALADER', t, this.acteurUtilisateur(userId));
    t.escaladeeVersId = this.superviseurDe(t.agentId);
    t.escaladeeLe = new Date(this.maintenant);
    this.evenement(t, 'ESCALADE', null, null, { type: 'UTILISATEUR', id: userId }, false);
    this.notifier(t.escaladeeVersId, 'superviseur.escalade', 'Réclamation escaladée', `${this.nomDe(userId)} vous a escaladé ${t.numero}.`, t.id);
    this.auditer(userId, 'reclamation.escalade', t, { escaladeeVers: t.escaladeeVersId });
    this.changer();
  }

  cloturerDeForce(userId: string, id: string, motif: S<'MotifClotureForcee'>, precision: string) {
    const t = this.ticket(id);
    if (!precision.trim()) throw erreur(422, 'PRECISION_REQUISE', 'Précisez la raison de la clôture');
    this.exigerTransition('CLOTURER_DE_FORCE', t, this.acteurUtilisateur(userId));
    this.passer(t, 'CLOTURER_DE_FORCE', { type: 'UTILISATEUR', id: userId });
    Object.assign(t, { echeanceSlaLe: null, alertePreventiveLe: null, slaSuspenduLe: null, clotureLe: new Date(this.maintenant) });
    t.cloture = { mode: 'FORCEE', motif, precision: precision.trim(), parId: userId };
    this.envoyer(t, 'est clôturée par la banque.', false);
    this.auditer(userId, 'reclamation.cloture_forcee', t, { motif });
    this.changer();
  }

  /* -------------------------------------------------------------- Notifications in-app */

  notificationsDe(userId: string): S<'PageNotifications'> {
    const miennes = this.notifications.filter((n) => n.destinataireId === userId).sort((a, b) => b.creeLe.getTime() - a.creeLe.getTime());
    return {
      donnees: miennes.slice(0, 12).map((n) => ({
        id: n.id, modele: n.modele, sujet: n.sujet, contenu: n.contenu, reclamationId: n.reclamationId, creeLe: n.creeLe.toISOString(), lueLe: n.lueLe ? n.lueLe.toISOString() : null,
      })),
      pagination: { page: 1, parPage: 12, total: miennes.length },
      nonLues: miennes.filter((n) => !n.lueLe).length,
    };
  }

  toutLire(userId: string) {
    for (const n of this.notifications) if (n.destinataireId === userId && !n.lueLe) n.lueLe = new Date(this.maintenant);
    this.changer();
  }

  /** À l'ouverture de la démo, les notifications antérieures à `avant` sont considérées comme lues. */
  marquerHistoriqueLu(avant: Date) {
    for (const n of this.notifications) if (n.creeLe < avant) n.lueLe ??= new Date(n.creeLe.getTime() + 30 * MINUTE);
  }

  /* -------------------------------------------------------------- Indicateurs (§6.6) */

  /** Toute la banque ; pour un agent (étape 11), ses réclamations seulement. */
  indicateurs(jours = 30, agentId?: string): S<'Indicateurs'> {
    const au = this.maintenant;
    const du = new Date(au.getTime() - jours * 86_400_000);
    const siens = this.tickets.filter((t) => !agentId || t.agentId === agentId);
    const periode = siens.filter((t) => t.creeLe >= du && t.creeLe <= au);
    const actifs = siens.filter((t) => t.statut !== 'RESOLUE' && t.statut !== 'CLOTUREE');
    const etats = actifs.map((t) => this.chrono(t));
    const compte = <K extends string>(cle: (t: Ticket) => K, libelle: (k: K) => string) => {
      const m = new Map<K, number>();
      for (const t of periode) m.set(cle(t), (m.get(cle(t)) ?? 0) + 1);
      return [...m].map(([k, total]) => ({ cle: k, libelle: libelle(k), total }));
    };
    const LIBELLES: Record<Statut, string> = { OUVERTE: 'Ouverte', EN_COURS: 'En cours', EN_ATTENTE_CLIENT: 'En attente client', RESOLUE: 'Résolue', CLOTUREE: 'Clôturée' };
    const parStatut = (Object.keys(LIBELLES) as Statut[]).map((s) => ({ cle: s, libelle: LIBELLES[s], total: periode.filter((t) => t.statut === s).length }));
    const repondues = periode.filter((t) => t.premiereReponseLe);
    const resolues = periode.filter((t) => t.resolueLe && t.slaRespecte !== null);
    const moyenne = (l: number[]) => (l.length ? Math.round(l.reduce((a, b) => a + b, 0) / l.length) : null);
    return {
      du: du.toISOString(),
      au: au.toISOString(),
      total: periode.length,
      parStatut,
      parCategorie: compte((t) => t.categorieId, (k) => this.categorie(k).nom),
      parCanal: compte((t) => t.canal, (k) => (k === 'QR_CODE' ? 'QR code en agence' : 'Lien web')),
      parAgence: compte((t) => t.agenceId ?? 'aucune', (k) => (k === 'aucune' ? 'Sans agence (lien web, WhatsApp ou SMS)' : AGENCES.find((a) => a.id === k)!.nom)),
      delaiPremiereReponseMoyenMinutes: moyenne(repondues.map((t) => delaiPremiereReponse(t.premiereReponseLe!, t.creeLe, this.sla))),
      delaiResolutionMoyenMinutes: moyenne(resolues.map((t) => Math.floor(minutesOuvreesEntre(t.creeLe, t.resolueLe!, this.calendrier)))),
      tauxRespectSla: resolues.length ? resolues.filter((t) => t.slaRespecte).length / resolues.length : null,
      tauxResolutionPremierContact: resolues.length
        ? resolues.filter((t) => !t.aEteQuestionne && !t.escaladeeVersId && t.nbReouvertures === 0).length / resolues.length
        : null,
      charge: {
        aTraiter: actifs.filter((t) => t.statut === 'OUVERTE' || t.statut === 'EN_COURS').length,
        enAttenteClient: actifs.filter((t) => t.statut === 'EN_ATTENTE_CLIENT').length,
        enAlerte: etats.filter((c) => c.etat === 'ALERTE').length,
        enRetard: etats.filter((c) => c.etat === 'DEPASSE').length,
      },
      evolution: this.evolution(du, au, agentId),
      satisfaction: this.satisfaction(siens, du, au),
    };
  }

  /**
   * Activité des agences (étape 19), comme l'API : une ligne par agence (une agence inactive sans
   * activité n'en fait pas), une ligne sans agence en dernier ; mêmes définitions que le tableau de bord.
   */
  indicateursAgences(jours = 30): S<'IndicateursAgences'> {
    const au = this.maintenant;
    const du = new Date(au.getTime() - jours * 86_400_000);
    const taux = (n: number, d: number) => (d ? Math.round((n / d) * 10_000) / 10_000 : null);
    const moyenne = (l: number[]) => (l.length ? Math.round(l.reduce((a, b) => a + b, 0) / l.length) : null);
    const parTotal = (a: S<'Volume'>, b: S<'Volume'>) => b.total - a.total || a.libelle.localeCompare(b.libelle, 'fr');
    const groupes = this.groupes();
    const ligne = (agenceId: string | null): S<'ActiviteAgence'> | null => {
      const a = agenceId ? AGENCES.find((x) => x.id === agenceId)! : null;
      const siens = this.tickets.filter((t) => t.agenceId === agenceId);
      const periode = siens.filter((t) => t.creeLe >= du && t.creeLe <= au);
      const actifs = siens.filter((t) => t.statut !== 'RESOLUE' && t.statut !== 'CLOTUREE');
      if (!periode.length && !actifs.length && (!a || !a.active)) return null;
      const etats = actifs.map((t) => this.chrono(t));
      const repondues = periode.filter((t) => t.premiereReponseLe);
      const resolues = periode.filter((t) => t.resolueLe && t.slaRespecte !== null);
      const compter = (cle: (t: Ticket) => string | null) => {
        const m = new Map<string, number>();
        for (const t of periode) {
          const k = cle(t);
          if (k) m.set(k, (m.get(k) ?? 0) + 1);
        }
        return m;
      };
      const volumes = (m: Map<string, number>, libelle: (k: string) => string, n: number) =>
        [...m].map(([cle, total]) => ({ cle, libelle: libelle(cle), total })).sort(parTotal).slice(0, n);
      const enquetes = siens.filter((t) => t.enquete && t.enquete.ouverteLe >= du && t.enquete.ouverteLe <= au);
      const b = bilanAvis(enquetes.filter((t) => t.enquete!.reponse).map((t) => t.enquete!.reponse!));
      const points = compter((t) => t.pointId);
      const groupe = a ? groupes.find((g) => g.agences.some((x) => x.id === a.id)) : undefined;
      return {
        agence: a ? { id: a.id, code: a.code, nom: a.nom, ville: a.ville, active: a.active } : null,
        groupe: groupe ? { id: groupe.id, nom: groupe.nom } : null,
        total: periode.length,
        urgentes: periode.filter((t) => t.priorite === 'URGENTE').length,
        resolues: resolues.length,
        delaiPremiereReponseMoyenMinutes: moyenne(repondues.map((t) => delaiPremiereReponse(t.premiereReponseLe!, t.creeLe, this.sla))),
        delaiResolutionMoyenMinutes: moyenne(resolues.map((t) => Math.floor(minutesOuvreesEntre(t.creeLe, t.resolueLe!, this.calendrier)))),
        tauxRespectSla: taux(resolues.filter((t) => t.slaRespecte).length, resolues.length),
        tauxResolutionPremierContact: taux(resolues.filter((t) => !t.aEteQuestionne && !t.escaladeeVersId && t.nbReouvertures === 0).length, resolues.length),
        charge: {
          aTraiter: actifs.filter((t) => t.statut === 'OUVERTE' || t.statut === 'EN_COURS').length,
          enAttenteClient: actifs.filter((t) => t.statut === 'EN_ATTENTE_CLIENT').length,
          enAlerte: etats.filter((c) => c.etat === 'ALERTE').length,
          enRetard: etats.filter((c) => c.etat === 'DEPASSE').length,
        },
        satisfaction: !this.enquetesActives && !enquetes.length
          ? null
          : { enquetes: enquetes.length, reponses: b.reponses, tauxSatisfaits: taux(b.satisfaits, b.reponses), nps: nps(b.promoteurs, b.detracteurs, b.reponses) },
        parCategorie: volumes(compter((t) => t.categorieId), (k) => this.categorie(k).nom, 3),
        agents: volumes(compter((t) => t.agentId), (k) => this.nomDe(k) ?? 'Agent', 5),
        pointsDepot: POINTS_DEPOT
          .filter((p) => (p.agence?.id ?? null) === agenceId || points.has(p.id))
          .map((p) => ({ id: p.id, libelle: p.libelle, canal: p.canal, actif: p.actif, total: points.get(p.id) ?? 0 }))
          .sort((x, y) => y.total - x.total || x.libelle.localeCompare(y.libelle, 'fr')),
      };
    };
    const lignes = AGENCES.map((a) => ligne(a.id)).filter((l): l is S<'ActiviteAgence'> => l !== null)
      .sort((x, y) => y.total - x.total || x.agence!.nom.localeCompare(y.agence!.nom, 'fr'));
    const sans = ligne(null);
    return { du: du.toISOString(), au: au.toISOString(), agences: sans ? [...lignes, sans] : lignes };
  }

  /** Comme l'API : enquêtes ouvertes sur la période ; satisfaits = notes 4 et 5 ; NPS de -100 à 100. */
  private satisfaction(siens: Ticket[], du: Date, au: Date): S<'Satisfaction'> | null {
    const enquetes = siens.filter((t) => t.enquete && t.enquete.ouverteLe >= du && t.enquete.ouverteLe <= au);
    if (!this.enquetesActives && enquetes.length === 0) return null;
    const repondues = enquetes.filter((t) => t.enquete!.reponse);
    const reponses = repondues.map((t) => t.enquete!.reponse!);
    const b = bilanAvis(reponses);
    const taux = (n: number, d: number) => (d ? Math.round((n / d) * 10_000) / 10_000 : null);
    const parAgent = new Map<string, { note: number; recommandation: number }[]>();
    for (const t of repondues) if (t.agentId) parAgent.set(t.agentId, [...(parAgent.get(t.agentId) ?? []), t.enquete!.reponse!]);
    return {
      enquetes: enquetes.length,
      reponses: b.reponses,
      tauxReponse: taux(b.reponses, enquetes.length),
      tauxSatisfaits: taux(b.satisfaits, b.reponses),
      noteMoyenne: b.reponses ? Math.round((b.sommeNotes / b.reponses) * 10) / 10 : null,
      nps: nps(b.promoteurs, b.detracteurs, b.reponses),
      promoteurs: b.promoteurs,
      passifs: b.passifs,
      detracteurs: b.detracteurs,
      parAgent: [...parAgent]
        .map(([agentId, l]) => {
          const a = bilanAvis(l);
          return { cle: agentId, libelle: this.nomDe(agentId)!, reponses: a.reponses, tauxSatisfaits: taux(l.filter((x) => estSatisfait(x.note)).length, a.reponses)!, nps: nps(a.promoteurs, a.detracteurs, a.reponses)! };
        })
        .sort((x, y) => y.reponses - x.reponses || x.libelle.localeCompare(y.libelle, 'fr')),
      commentaires: repondues
        .filter((t) => t.enquete!.reponse!.commentaire)
        .sort((x, y) => y.enquete!.reponse!.reponduLe.getTime() - x.enquete!.reponse!.reponduLe.getTime())
        .slice(0, 10)
        .map((t) => {
          const r = t.enquete!.reponse!;
          return { reclamationId: t.id, numero: t.numero, note: r.note, recommandation: r.recommandation, commentaire: r.commentaire!, reponduLe: r.reponduLe.toISOString() };
        }),
    };
  }

  /** Courbe par jour (étape 9) : déposées ce jour-là, résolues ce jour-là (quelle que soit la date de dépôt). */
  private evolution(du: Date, au: Date, agentId?: string): S<'Evolution'> {
    const JOUR = 86_400_000;
    const points: S<'Evolution'>['points'] = [];
    const tickets = this.tickets.filter((t) => !agentId || t.agentId === agentId);
    // Fuseau de la banque de démonstration : Abidjan, à l'heure universelle
    for (let d = Math.floor(du.getTime() / JOUR) * JOUR; d < au.getTime(); d += JOUR) {
      const dans = (x: Date | null | undefined) => !!x && x.getTime() >= d && x.getTime() < d + JOUR;
      points.push({
        debut: new Date(d).toISOString().replace('.000Z', 'Z'),
        deposees: tickets.filter((t) => dans(t.creeLe)).length,
        resolues: tickets.filter((t) => t.slaRespecte !== null && dans(t.resolueLe)).length,
      });
    }
    return { regroupement: 'JOUR', points };
  }

  /* -------------------------------------------------------------- Journal d'audit */

  journalAudit(parPage = 40): S<'PageAudit'> {
    const chaine = `banque:${this.banque.slug}`;
    return {
      donnees: [...this.journal].reverse().slice(0, parPage).map((l) => ({
        id: String(l.rang), chaine, rang: l.rang, horodatage: l.horodatage.toISOString(), acteur: l.acteur, action: l.action,
        entite: l.entite, entiteId: l.entiteId, donnees: l.donnees, ip: l.acteur.type === 'SYSTEME' ? null : l.acteur.type === 'CLIENT' ? '102.67.12.9' : '10.20.4.17',
      })),
      pagination: { page: 1, parPage, total: this.journal.length },
    };
  }

  verificationJournal(): S<'VerificationChaine'> {
    return { chaine: `banque:${this.banque.slug}`, valide: true, lignes: this.journal.length, premiereRupture: null };
  }

  /* -------------------------------------------------------------- Pour la démo */

  /** La couleur choisie dans « Banque et apparence » s'applique aussitôt (modifierApparence). */
  changerCouleur(couleur: string) {
    this.banque.couleur = couleur;
    this.auditer(PERSONNES.admin.id, 'banque.apparence', null, { couleurPrimaire: couleur });
    this.changer();
  }

  /** Réclamations d'un client, par son téléphone (le téléphone de la démo). */
  clientParTelephone(telephone: string) {
    return this.clients.find((c) => c.telephone === telephone) ?? null;
  }
  envoisDe(clientId: string) {
    return this.envois.filter((e) => e.clientId === clientId);
  }
  toutesLesReclamations() {
    return this.tickets;
  }

  /** Date de clôture automatique prévue (visite guidée). */
  finDeContestation(id: string) {
    return this.ticket(id).clotureAutoPrevueLe;
  }
}
