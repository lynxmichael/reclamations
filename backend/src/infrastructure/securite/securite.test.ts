import { describe, expect, it } from 'vitest';
import { typeReel, svgSain, nomPropre } from '../fichiers/fichiers.js';
import { Jetons } from './jetons.js';
import { hacherMotDePasse, raisonFaiblesse, verifierMotDePasse } from './mots-de-passe.js';
import { chiffrer, codeCourant, dechiffrer, nouveauSecret, pasDuCode } from './totp.js';

const CLE = Buffer.alloc(32, 7);

describe('mots de passe', () => {
  it('argon2id : le bon mot de passe passe, un autre non ; sans hash, toujours refusé', async () => {
    const h = await hacherMotDePasse('Lagune-Ebrie-2026');
    expect(h).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(await verifierMotDePasse(h, 'Lagune-Ebrie-2026')).toBe(true);
    expect(await verifierMotDePasse(h, 'lagune-ebrie-2026')).toBe(false);
    expect(await verifierMotDePasse(null, 'Lagune-Ebrie-2026')).toBe(false);
  });

  it('robustesse : longueur, mots de passe courants, répétitions, nom ou e-mail repris', () => {
    const c = { email: 'aya.konan@banque-alpha.example', nom: 'Konan', prenom: 'Aya' };
    expect(raisonFaiblesse('Court-1', c)).toBe('12 caractères au moins');
    expect(raisonFaiblesse('azertyuiop123', c)).toMatch(/plus utilisés/);
    expect(raisonFaiblesse('aaaaaaaaaaaaab', c)).toMatch(/répétés/);
    expect(raisonFaiblesse('Konan-Abidjan-2026', c)).toMatch(/nom ou votre e-mail/);
    expect(raisonFaiblesse('Lagune-Ebrie-2026', c)).toBeNull();
  });
});

describe('TOTP', () => {
  it('secret chiffré en AES-256-GCM : relu à l\'identique, une altération est détectée', () => {
    const secret = nouveauSecret();
    const chiffre = chiffrer(CLE, secret);
    expect(chiffre).toMatch(/^v1:/);
    expect(chiffre).not.toContain(secret);
    expect(dechiffrer(CLE, chiffre)).toBe(secret);
    const altere = chiffre.slice(0, -2) + (chiffre.endsWith('A') ? 'BB' : 'AA');
    expect(() => dechiffrer(CLE, altere)).toThrow();
  });

  it('code valide à un pas près (dérive des horloges), refusé au-delà', () => {
    const secret = nouveauSecret();
    const t = new Date('2026-09-28T10:00:05Z');
    const pas = Math.floor(t.getTime() / 30_000);
    expect(pasDuCode(secret, codeCourant(secret, t), t)).toBe(pas);
    expect(pasDuCode(secret, codeCourant(secret, new Date(t.getTime() - 30_000)), t)).toBe(pas - 1);
    expect(pasDuCode(secret, codeCourant(secret, new Date(t.getTime() + 90_000)), t)).toBeNull();
  });
});

describe('jetons', () => {
  it('chaque sorte de jeton a son audience ; un jeton expiré est refusé', async () => {
    let maintenant = new Date('2026-09-28T10:00:00Z');
    const j = new Jetons(new TextEncoder().encode('x'.repeat(40)), () => maintenant);
    const acces = await j.signerAcces({ utilisateurId: '0199aaaa-0000-7000-8000-000000000001', role: 'AGENT', tenantId: '0199aaaa-0000-7000-8000-000000000002', session: 's' });
    expect(await j.lireAcces(acces)).toMatchObject({ role: 'AGENT', session: 's' });
    expect(await j.lireClient(acces)).toBeNull();
    expect(await j.lireIntermediaire(acces, 'etape-totp')).toBeNull();
    const client = await j.signerClient({ clientId: 'c', tenantId: 't' });
    expect(await j.lireAcces(client)).toBeNull();
    maintenant = new Date(maintenant.getTime() + 16 * 60_000);
    expect(await j.lireAcces(acces)).toBeNull();
    expect(await j.lireClient(client)).not.toBeNull();
    const autreCle = new Jetons(new TextEncoder().encode('y'.repeat(40)), () => maintenant);
    expect(await autreCle.lireClient(client)).toBeNull();
  });
});

describe('fichiers', () => {
  it('type reconnu au contenu, pas au nom', () => {
    expect(typeReel(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(typeReel(Buffer.from('89504e470d0a1a0a00', 'hex'))).toBe('image/png');
    expect(typeReel(Buffer.from('RIFF\x00\x00\x00\x00WEBPVP8 ', 'latin1'))).toBe('image/webp');
    expect(typeReel(Buffer.from('%PDF-1.7\n'))).toBe('application/pdf');
    expect(typeReel(Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe('image/svg+xml');
    expect(typeReel(Buffer.from('MZ\x90\x00'))).toBeNull();
  });

  it('SVG : ni script, ni gestionnaire d\'événement, ni lien externe', () => {
    expect(svgSain(Buffer.from('<svg><circle r="4"/></svg>'))).toBe(true);
    expect(svgSain(Buffer.from('<svg><script>alert(1)</script></svg>'))).toBe(false);
    expect(svgSain(Buffer.from('<svg onload="alert(1)"/>'))).toBe(false);
    expect(svgSain(Buffer.from('<svg><image href="https://ailleurs.example/x.png"/></svg>'))).toBe(false);
    expect(svgSain(Buffer.from('<svg><use href="#forme"/></svg>'))).toBe(true);
  });

  it('nom de fichier sans chemin ni caractère spécial', () => {
    expect(nomPropre('C:\\Users\\yao\\relevé "mai".pdf')).toBe('relevé _mai_.pdf');
    expect(nomPropre('../../etc/passwd')).toBe('passwd');
    expect(nomPropre('')).toBe('fichier');
  });
});
