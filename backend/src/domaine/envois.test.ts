import { describe, expect, it } from 'vitest';
import { ESPACEMENT_MINUTES, TENTATIVES_MAX, etatEnvoi, masquerDestination, nonRemisEnSuspens, prochaineTentative, renvoyable, aSignaler } from './envois.js';

const t0 = new Date('2026-10-08T09:00:00Z');
const min = (n: number) => new Date(t0.getTime() + n * 60_000);

describe('envois au client (étape 22)', () => {
  it('tentatives espacées : 1, 5, 30 puis 120 minutes, 5 au total', () => {
    expect(ESPACEMENT_MINUTES).toEqual([1, 5, 30, 120]);
    expect(TENTATIVES_MAX).toBe(5);
    expect([1, 2, 3, 4].map((n) => prochaineTentative(n, t0)?.toISOString())).toEqual([min(1), min(5), min(30), min(120)].map((d) => d.toISOString()));
    expect(prochaineTentative(5, t0)).toBeNull();
    expect(prochaineTentative(0, t0)).toBeNull();
  });

  it('état montré au personnel', () => {
    expect(etatEnvoi({ statut: 'EN_ATTENTE', tentatives: 0 })).toBe('EN_ATTENTE');
    expect(etatEnvoi({ statut: 'EN_ATTENTE', tentatives: 2 })).toBe('NOUVEL_ESSAI');
    expect(etatEnvoi({ statut: 'ENVOYEE', tentatives: 1 })).toBe('ENVOYE');
    expect(etatEnvoi({ statut: 'DELIVREE', tentatives: 1 })).toBe('REMIS');
    expect(etatEnvoi({ statut: 'DELIVREE', tentatives: 1, lueLe: t0 })).toBe('LU');
    expect(etatEnvoi({ statut: 'ECHEC', tentatives: 5 })).toBe('NON_REMIS');
  });

  it('non remis en suspens : tant qu\'aucun message du même modèle n\'est parvenu depuis', () => {
    const sms = { modele: 'client.resolution', statut: 'ECHEC' as const, creeLe: t0 };
    // L'e-mail parti en même temps l'a remplacé
    expect(nonRemisEnSuspens([sms, { modele: 'client.resolution', statut: 'ENVOYEE' as const, creeLe: t0 }])).toEqual([]);
    // Seul, ou suivi d'un autre modèle : en suspens
    expect(nonRemisEnSuspens([sms, { modele: 'client.depot', statut: 'DELIVREE' as const, creeLe: min(5) }])).toEqual([sms]);
    // Renvoyé et remis : remplacé
    expect(nonRemisEnSuspens([sms, { modele: 'client.resolution', statut: 'DELIVREE' as const, creeLe: min(60) }])).toEqual([]);
    // Renvoyé, encore dans la boîte d'envoi : plus en suspens (pas de second renvoi)
    expect(nonRemisEnSuspens([sms, { modele: 'client.resolution', statut: 'EN_ATTENTE' as const, creeLe: min(60) }])).toEqual([]);
    // Un message plus ancien du même modèle ne le remplace pas
    expect(nonRemisEnSuspens([sms, { modele: 'client.resolution', statut: 'DELIVREE' as const, creeLe: min(-10) }])).toEqual([sms]);
    // Un code non remis ne se signale pas
    expect(nonRemisEnSuspens([{ modele: 'client.otp', statut: 'ECHEC' as const, creeLe: t0 }])).toEqual([]);
  });

  it('modèles renvoyables et signalés ; coordonnées masquées', () => {
    expect(renvoyable('client.resolution')).toBe(true);
    expect(renvoyable('client.otp')).toBe(false);
    expect(renvoyable('conversation.reponse')).toBe(false);
    expect(aSignaler('conversation.reponse')).toBe(true);
    expect(masquerDestination('SMS', '+2250708091011')).toBe('+225 07 •• •• •• 11');
    expect(masquerDestination('EMAIL', 'yao.kouassi@exemple.ci')).toBe('y••••@exemple.ci');
  });
});
