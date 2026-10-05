import { describe, expect, it } from 'vitest';
import { masquer, mentionneCodeSecret } from './masquage.js';

describe('masquage avant envoi à l\'IA (décision I5)', () => {
  it.each([
    ['écrivez-moi à yao.kouassi@exemple.ci svp', 'écrivez-moi à [EMAIL] svp', 'EMAIL'],
    ['mon IBAN CI93 CI00 8011 1234 5678 9012 3456', 'mon IBAN [IBAN]', 'IBAN'],
    ['iban:CI93CI0080111234567890123456 merci', 'iban:[IBAN] merci', 'IBAN'],
    ['carte 4123 4567 8901 2345 avalée', 'carte [CARTE] avalée', 'CARTE'],
    ['carte 4123456789012345', 'carte [CARTE]', 'CARTE'],
    ['ma carte 4123 45XX XXXX 1234', 'ma carte [CARTE]', 'CARTE'],
    ['appelez le 07 08 09 10 11', 'appelez le [TELEPHONE]', 'TELEPHONE'],
    ['mon numéro +225 0708091011', 'mon numéro [TELEPHONE]', 'TELEPHONE'],
    ['whatsapp 0505060708', 'whatsapp [TELEPHONE]', 'TELEPHONE'],
    ['fixe 27-20-21-22-23', 'fixe [TELEPHONE]', 'TELEPHONE'],
    ['en France +33 6 12 34 56 78', 'en France [TELEPHONE]', 'TELEPHONE'],
    ['compte n° 012345678901', 'compte n° [NUMERO]', 'NUMERO'],
    ['mon code secret 1234', 'mon code secret [CODE]', 'CODE'],
    ["mon pin c'est 0000", "mon pin c'est [CODE]", 'CODE'],
    ['mdp : azerty12', 'mdp : [CODE]', 'CODE'],
    ['cvv 123', 'cvv [CODE]', 'CODE'],
  ])('%s', (brut, attendu, masque) => {
    const m = masquer(brut);
    expect(m.texte).toBe(attendu);
    expect(m.masques[masque as keyof typeof m.masques]).toBeGreaterThanOrEqual(1);
  });

  it('un RIB ivoirien ne laisse pas passer le numéro de compte', () => {
    const m = masquer('RIB CI008 01234 012345678901 23');
    expect(m.texte).not.toMatch(/0123456789/);
    expect(m.texte.startsWith('RIB CI008')).toBe(true);
  });

  it('garde montants, dates, heures et numéros de réclamation', () => {
    const t = 'Le 23/09/2026 à 19h10, retrait de 50 000 FCFA, puis 15 000 000 F de virement, et 2 500 000 francs : voir ALP-2026-000042.';
    const m = masquer(t);
    expect(m.texte).toBe(t);
    expect(m.masques).toEqual({});
    expect(m.codeSecret).toBe(false);
  });

  it('un code secret écrit en clair est signalé, même s\'il n\'a pas de chiffres reconnus', () => {
    expect(masquer('voici mon code secret 4321').codeSecret).toBe(true);
    expect(masquer('mon code est bloqué depuis hier').codeSecret).toBe(false);
    expect(masquer('mon code est bloqué depuis hier').texte).toBe('mon code est bloqué depuis hier');
    expect(mentionneCodeSecret('je vous donne mon mot de passe')).toBe(true);
    expect(mentionneCodeSecret('j\'ai oublié mon mot de passe')).toBe(false);
  });

  it('plusieurs données dans un même message', () => {
    const m = masquer('Carte 4123 4567 8901 2345, tel 0708091011, mail a@b.ci');
    expect(m.texte).toBe('Carte [CARTE], tel [TELEPHONE], mail [EMAIL]');
    expect(m.masques).toEqual({ CARTE: 1, TELEPHONE: 1, EMAIL: 1 });
  });
});

describe('masquage du nom du client, quand on le connaît', () => {
  it('chaque mot du nom, avec ou sans accents, sans toucher aux mots qui le contiennent', () => {
    const m = masquer('Bonjour, je suis Estelle GNAHORE (Gnahoré Estelle). Estellement vôtre.', { noms: ['Estelle Gnahoré'] });
    expect(m.texte).toBe('Bonjour, je suis [NOM] [NOM] ([NOM] [NOM]). Estellement vôtre.');
    expect(m.masques.NOM).toBe(4);
  });

  it('les mots de moins de 3 lettres et les noms absents ne changent rien', () => {
    expect(masquer('Le dossier de Yao', { noms: ['Yao Kouassi', 'N\'Da'] }).texte).toBe('Le dossier de [NOM]');
    expect(masquer('Rien à masquer', { noms: [] }).texte).toBe('Rien à masquer');
    // Le nom est cherché tel quel, pas comme une expression régulière
    expect(masquer('Le client axb', { noms: ['a.b'] }).texte).toBe('Le client axb');
  });
});
