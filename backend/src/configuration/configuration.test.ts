import { describe, expect, it } from 'vitest';
import { lireConfiguration, urlPortail } from './configuration.js';

const DEV = {
  APP_DATABASE_URL: 'postgresql://app:app@localhost:5432/reclamations_dev',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: 'developpement-uniquement-changer-en-production-0123456789',
  CLE_CHIFFREMENT_TOTP: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=',
  CLE_OTP: 'developpement-uniquement-cle-otp-0123456789abcdef',
};

describe('configuration', () => {
  it('développement : valeurs par défaut du domaine et des adresses', () => {
    const c = lireConfiguration(DEV);
    expect(c.cleTotp.length).toBe(32);
    expect(urlPortail(c, 'alpha')).toBe('https://alpha.reclamations.example');
    expect(c.urlConsole).toBe('https://console.reclamations.example');
    expect(c.cookieSecure).toBe(true);
  });

  it('variables manquantes : le démarrage s\'arrête avec la liste des erreurs', () => {
    expect(() => lireConfiguration({})).toThrow(/APP_DATABASE_URL est obligatoire[\s\S]*JWT_SECRET est obligatoire/);
  });

  it('production : les secrets de développement et le cookie non sécurisé sont refusés', () => {
    expect(() => lireConfiguration({ ...DEV, NODE_ENV: 'production' })).toThrow(/JWT_SECRET a la valeur de développement/);
    const prod = {
      ...DEV, NODE_ENV: 'production', JWT_SECRET: 'z'.repeat(48), CLE_OTP: 'w'.repeat(48),
      CLE_CHIFFREMENT_TOTP: 'ab'.repeat(32), DOMAINE_PLATEFORME: 'reclamations.makor.ci',
    };
    expect(lireConfiguration(prod).urlConsole).toBe('https://console.reclamations.makor.ci');
    expect(() => lireConfiguration({ ...prod, COOKIE_SECURE: 'false' })).toThrow(/COOKIE_SECURE=false est interdit/);
    expect(() => lireConfiguration({ ...prod, CLE_CHIFFREMENT_TOTP: 'trop-courte-mais-assez-longue-ici-00' })).toThrow(/32 octets/);
  });

  it('SMS : journal par défaut ; passerelle HTTP avec adresse, clé et expéditeur valides (étape 9)', () => {
    expect(lireConfiguration(DEV).sms).toEqual({ mode: 'journal' });
    const http = { ...DEV, SMS_MODE: 'http', SMS_URL: 'https://sms.makor.example/v1/messages', SMS_CLE: 'k'.repeat(32) };
    expect(lireConfiguration(http).sms).toEqual({ mode: 'http', url: 'https://sms.makor.example/v1/messages', cle: 'k'.repeat(32), expediteur: 'Reclamation' });
    expect(() => lireConfiguration({ ...DEV, SMS_MODE: 'http' })).toThrow(/SMS_URL est obligatoire[\s\S]*SMS_CLE est obligatoire/);
    expect(() => lireConfiguration({ ...http, SMS_EXPEDITEUR: 'Banque Alpha CI' })).toThrow(/SMS_EXPEDITEUR/);
    expect(() => lireConfiguration({ ...DEV, SMS_MODE: 'smpp' })).toThrow(/SMS_MODE doit valoir journal ou http/);
    const prod = {
      ...http, NODE_ENV: 'production', JWT_SECRET: 'z'.repeat(48), CLE_OTP: 'w'.repeat(48), CLE_CHIFFREMENT_TOTP: 'ab'.repeat(32),
      SMS_URL: 'http://sms.makor.example/v1/messages',
    };
    expect(() => lireConfiguration(prod)).toThrow(/SMS_URL doit être en https en production/);
  });
});
