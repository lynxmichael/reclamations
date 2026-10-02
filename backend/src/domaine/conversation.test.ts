import { describe, expect, it } from 'vitest';
import {
  aRepondre, alerterAgent, avisClientDu, clientEnLigne, disponibilite, extrait, limiteAvisClient, marqueLaLecture,
  nonLueParLaBanque, nonLueParLeClient, reponseDue, type EtatConversation,
} from './conversation.js';
import { normaliserCalendrier } from './temps-ouvre/calendrier.js';

const T0 = new Date('2026-10-05T09:00:00Z');
const min = (n: number) => new Date(T0.getTime() + n * 60_000);
const VIDE: EtatConversation = { dernierMessageClientLe: null, dernierMessageBanqueLe: null, luClientLe: null, luBanqueLe: null, avisClientLe: null };

describe('conversation : qui doit répondre, qui doit lire', () => {
  it('à répondre quand le client a écrit en dernier', () => {
    expect(aRepondre(VIDE)).toBe(false);
    expect(aRepondre({ ...VIDE, dernierMessageClientLe: T0 })).toBe(true);
    expect(aRepondre({ ...VIDE, dernierMessageClientLe: T0, dernierMessageBanqueLe: min(1) })).toBe(false);
    expect(aRepondre({ ...VIDE, dernierMessageClientLe: min(2), dernierMessageBanqueLe: min(1) })).toBe(true);
  });

  it('réponse due sur une réclamation encore ouverte seulement', () => {
    const ecrit = { ...VIDE, dernierMessageClientLe: T0 };
    for (const statut of ['OUVERTE', 'EN_COURS', 'EN_ATTENTE_CLIENT']) expect(reponseDue(ecrit, statut)).toBe(true);
    for (const statut of ['RESOLUE', 'CLOTUREE']) expect(reponseDue(ecrit, statut)).toBe(false);
    expect(reponseDue(VIDE, 'EN_COURS')).toBe(false);
  });

  it('non lue par la banque tant que sa lecture précède le dernier message du client', () => {
    expect(nonLueParLaBanque({ dernierMessageClientLe: null, luBanqueLe: null })).toBe(false);
    expect(nonLueParLaBanque({ dernierMessageClientLe: T0, luBanqueLe: null })).toBe(true);
    expect(nonLueParLaBanque({ dernierMessageClientLe: T0, luBanqueLe: T0 })).toBe(false);
    expect(nonLueParLaBanque({ dernierMessageClientLe: min(1), luBanqueLe: T0 })).toBe(true);
  });

  it('non lue par le client tant qu\'il n\'a pas ouvert le chat après la réponse', () => {
    expect(nonLueParLeClient({ dernierMessageBanqueLe: null, luClientLe: null })).toBe(false);
    expect(nonLueParLeClient({ dernierMessageBanqueLe: T0, luClientLe: null })).toBe(true);
    expect(nonLueParLeClient({ dernierMessageBanqueLe: T0, luClientLe: min(1) })).toBe(false);
  });

  it('client en ligne : chat à l\'écran il y a moins de 2 minutes', () => {
    expect(clientEnLigne({ luClientLe: null }, T0)).toBe(false);
    expect(clientEnLigne({ luClientLe: T0 }, min(1))).toBe(true);
    expect(clientEnLigne({ luClientLe: T0 }, new Date(min(2).getTime() - 1))).toBe(true);
    expect(clientEnLigne({ luClientLe: T0 }, min(2))).toBe(false);
  });
});

describe('conversation : avis au client et alertes à l\'agent', () => {
  const repondu = { ...VIDE, dernierMessageClientLe: T0, dernierMessageBanqueLe: min(1) };

  it('avis par e-mail ou SMS 2 minutes après une réponse non lue, une seule fois', () => {
    expect(limiteAvisClient(min(3)).toISOString()).toBe(min(1).toISOString());
    expect(avisClientDu(VIDE, min(10))).toBe(false);
    expect(avisClientDu(repondu, new Date(min(3).getTime() - 1))).toBe(false);
    expect(avisClientDu(repondu, min(3))).toBe(true);
    // Lue dans le chat : pas d'avis
    expect(avisClientDu({ ...repondu, luClientLe: min(2) }, min(5))).toBe(false);
    // Déjà signalée : pas de second avis
    expect(avisClientDu({ ...repondu, avisClientLe: min(3) }, min(10))).toBe(false);
    // Une nouvelle réponse après l'avis : un nouvel avis
    expect(avisClientDu({ ...repondu, dernierMessageBanqueLe: min(6), avisClientLe: min(3) }, min(8))).toBe(true);
  });

  it('plusieurs réponses rapprochées : l\'avis attend 2 minutes après la dernière', () => {
    const rafale = { ...repondu, dernierMessageBanqueLe: min(2.5) };
    expect(avisClientDu(rafale, min(3))).toBe(false);
    expect(avisClientDu(rafale, min(4.5))).toBe(true);
  });

  it('alerte à l\'agent au premier message non lu d\'une rafale seulement', () => {
    expect(alerterAgent(null)).toBe(true);
    expect(alerterAgent({ dernierMessageClientLe: null, luBanqueLe: null })).toBe(true);
    expect(alerterAgent({ dernierMessageClientLe: T0, luBanqueLe: null })).toBe(false);
    expect(alerterAgent({ dernierMessageClientLe: T0, luBanqueLe: min(1) })).toBe(true);
  });

  it('lecture pour la banque : l\'agent assigné ; sans agent, un superviseur', () => {
    expect(marqueLaLecture({ id: 'a1', role: 'AGENT' }, 'a1')).toBe(true);
    expect(marqueLaLecture({ id: 'a2', role: 'AGENT' }, 'a1')).toBe(false);
    expect(marqueLaLecture({ id: 's1', role: 'SUPERVISEUR' }, 'a1')).toBe(false);
    expect(marqueLaLecture({ id: 'ad', role: 'ADMIN_ENTREPRISE' }, 'a1')).toBe(false);
    expect(marqueLaLecture({ id: 's1', role: 'SUPERVISEUR' }, null)).toBe(true);
    expect(marqueLaLecture({ id: 'ad', role: 'ADMIN_ENTREPRISE' }, null)).toBe(false);
  });
});

describe('conversation : affichage', () => {
  it('extrait sur une ligne, coupé au mot', () => {
    expect(extrait('  Bonjour,\n\nmon virement  ')).toBe('Bonjour, mon virement');
    const long = 'mot '.repeat(60);
    const e = extrait(long, 40);
    expect(e.length).toBeLessThanOrEqual(40);
    expect(e.endsWith('mot…')).toBe(true);
    expect(extrait('x'.repeat(50), 20)).toBe(`${'x'.repeat(19)}…`);
  });

  it('disponibilité : ouverte pendant les heures ouvrées, sinon heure de reprise', () => {
    const cal = normaliserCalendrier({
      fuseauHoraire: 'Africa/Abidjan',
      plages: [1, 2, 3, 4, 5].map((j) => ({ jourSemaine: j, debutMinute: 8 * 60, finMinute: 17 * 60 })),
      joursFeries: [],
    });
    // Lundi 5 octobre 2026, 9 h à Abidjan (UTC+0)
    expect(disponibilite(T0, cal)).toEqual({ ouverte: true, repriseLe: null });
    // Vendredi 9 octobre, 18 h : reprise lundi 12 à 8 h
    expect(disponibilite(new Date('2026-10-09T18:00:00Z'), cal)).toEqual({ ouverte: false, repriseLe: new Date('2026-10-12T08:00:00Z') });
    // Sans horaires : toujours ouverte
    expect(disponibilite(T0, normaliserCalendrier({ fuseauHoraire: 'Africa/Abidjan', plages: [], joursFeries: [] }))).toEqual({ ouverte: true, repriseLe: null });
  });
});
