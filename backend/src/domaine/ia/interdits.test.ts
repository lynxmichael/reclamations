import { describe, expect, it } from 'vitest';
import { demandeHumain, verifierInterdits } from './interdits.js';

const codes = (t: string) => verifierInterdits(t).map((a) => a.code);

describe('interdits de l\'IA (décision I4)', () => {
  it.each([
    ['Bonjour, vous serez remboursé intégralement.', 'REMBOURSEMENT_PROMIS'],
    ['Nous allons vous recréditer les 50 000 FCFA.', 'REMBOURSEMENT_PROMIS'],
    ['Le remboursement est garanti.', 'REMBOURSEMENT_PROMIS'],
    ['Votre argent sera rendu.', 'REMBOURSEMENT_PROMIS'],
    ['Nous traitons votre demande sous 48 h.', 'DELAI_PROMIS'],
    ['Vous aurez une réponse dans 2 jours ouvrés.', 'DELAI_PROMIS'],
    ['Tout sera réglé d\'ici demain.', 'DELAI_PROMIS'],
    ['Votre réclamation est résolue.', 'STATUT_ANNONCE'],
    ['Je clôture votre dossier.', 'STATUT_ANNONCE'],
    ['Je vous conseille d\'investir dans un placement à terme.', 'CONSEIL_FINANCIER'],
    ['Vous devriez emprunter auprès de nous.', 'CONSEIL_FINANCIER'],
    ['Merci de nous communiquer votre code secret pour vérifier.', 'CODE_SECRET_DEMANDE'],
    ['Envoyez-nous le code reçu par SMS.', 'CODE_SECRET_DEMANDE'],
    ['Quel est votre mot de passe ?', 'CODE_SECRET_DEMANDE'],
  ])('%s', (texte, code) => {
    expect(codes(texte)).toContain(code);
  });

  it.each([
    'Bonjour, nous avons bien reçu votre réclamation. Un conseiller l\'étudie et revient vers vous.',
    'Nous vérifions le journal du distributeur auprès de notre service monétique.',
    'Pour bloquer votre carte, appelez le centre d\'opposition, ouvert 24 h sur 24.',
    'Ne communiquez jamais votre code secret, même à un agent de la banque.',
    'Pouvez-vous préciser la date et le montant du retrait ?',
    'Nos agences sont ouvertes du lundi au vendredi, de 8 h à 17 h 30.',
  ])('rien à signaler : %s', (texte) => {
    expect(codes(texte)).toEqual([]);
  });

  it('chaque alerte cite les mots en cause', () => {
    expect(verifierInterdits('Nous allons vous rembourser sous 48 heures.')).toEqual([
      { code: 'REMBOURSEMENT_PROMIS', extrait: 'nous allons vous rembourser' },
      { code: 'DELAI_PROMIS', extrait: 'sous 48 heures' },
    ]);
  });
});

describe('demande à parler à un humain (décision I3)', () => {
  it.each([
    'Je veux parler à un conseiller', 'un conseillé svp', 'CONSEILER', 'je veux une conseillère', 'passez moi un agent',
    'parler à quelqu\'un svp', 'je veux une vraie personne', 'un humain stp', 'Rappelez-moi', 'service client',
  ])('oui : %s', (t) => expect(demandeHumain(t)).toBe(true));

  it.each([
    'J\'ai besoin d\'un conseil pour mon épargne', 'je vous conseille de vérifier', 'mon argent n\'est pas arrivé', 'l\'agence de Cocody',
    'Ma carte est bloquée',
  ])('non : %s', (t) => expect(demandeHumain(t)).toBe(false));
});
