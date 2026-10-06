import { describe, expect, it } from 'vitest';
import { couperSms, segmentsSms, versGsm } from './sms.js';

describe('SMS : segments, alphabet GSM, coupe', () => {
  it('160 caractères GSM par SMS, 153 au-delà ; 70 et 67 avec un caractère hors GSM', () => {
    expect(segmentsSms('a'.repeat(160))).toBe(1);
    expect(segmentsSms('a'.repeat(161))).toBe(2);
    expect(segmentsSms('a'.repeat(306))).toBe(2);
    expect(segmentsSms('a'.repeat(307))).toBe(3);
    expect(segmentsSms('é'.repeat(160))).toBe(1);
    expect(segmentsSms(`${'a'.repeat(69)}ç`)).toBe(1);
    expect(segmentsSms(`${'a'.repeat(70)}ç`)).toBe(2);
    expect(segmentsSms('€'.repeat(80))).toBe(1);
    expect(segmentsSms('€'.repeat(81))).toBe(2);
  });

  it('les accents français hors GSM sont remplacés : un « ç » ne double plus le coût', () => {
    // « é », « è », « à » sont dans l'alphabet GSM : ils restent
    expect(versGsm('Reçu à l’agence — «clôturée», hôtel, Noël… Œuvre')).toBe('Recu à l\'agence - "cloturée", hotel, Noel... OEuvre');
    expect(segmentsSms(versGsm(`Votre réclamation est clôturée. ${'x'.repeat(120)}`))).toBe(1);
  });

  it('au-delà de 4 segments, coupé au mot avec le lien de la suite', () => {
    const long = Array.from({ length: 200 }, (_, i) => `mot${i}`).join(' ');
    const coupe = couperSms(long, 'Suite : https://alpha.example/suivi/x', 4);
    expect(segmentsSms(coupe)).toBeLessThanOrEqual(4);
    expect(coupe.endsWith('... Suite : https://alpha.example/suivi/x')).toBe(true);
    expect(coupe).toMatch(/^mot0 mot1 /);
    expect(couperSms('court', 'Suite', 4)).toBe('court');
  });
});
