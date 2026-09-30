import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { SmsHttp } from './adaptateurs.js';
import { contraste, emailHtml } from './gabarit-email.js';

interface Recu {
  entetes: IncomingMessage['headers'];
  corps: Record<string, unknown>;
}

let fermer: (() => void) | null = null;
afterEach(() => fermer?.());

/** Passerelle SMS de test : répond `statut` et `reponse` à chaque appel. */
async function passerelle(statut: number, reponse: string, delaiMs = 0): Promise<{ url: string; recus: Recu[] }> {
  const recus: Recu[] = [];
  const serveur = createServer((req, res) => {
    let corps = '';
    req.on('data', (m: Buffer) => (corps += m.toString()));
    req.on('end', () => {
      recus.push({ entetes: req.headers, corps: JSON.parse(corps) as Record<string, unknown> });
      setTimeout(() => res.writeHead(statut, { 'Content-Type': 'application/json' }).end(reponse), delaiMs);
    });
  });
  await new Promise<void>((r) => serveur.listen(0, '127.0.0.1', r));
  fermer = () => serveur.close();
  return { url: `http://127.0.0.1:${(serveur.address() as AddressInfo).port}/messages`, recus };
}

describe('passerelle SMS HTTP (étape 9)', () => {
  it('envoie expéditeur, numéro, texte et référence, avec la clé et une clé d\'idempotence', async () => {
    const p = await passerelle(202, '{"id":"msg-42","segments":2}');
    const sms = new SmsHttp({ url: p.url, cle: 'cle-secrete-de-test-0123', expediteur: 'Reclamation' });
    const r = await sms.envoyer({ destination: '+2250700000001', texte: 'Banque Alpha : réclamation ALP-2026-000001 enregistrée.', reference: 'notif-1' });
    expect(r).toEqual({ idFournisseur: 'msg-42', segments: 2 });
    expect(p.recus[0]!.entetes.authorization).toBe('Bearer cle-secrete-de-test-0123');
    expect(p.recus[0]!.entetes['idempotency-key']).toBe('notif-1');
    expect(p.recus[0]!.corps).toEqual({ from: 'Reclamation', to: '+2250700000001', text: 'Banque Alpha : réclamation ALP-2026-000001 enregistrée.', reference: 'notif-1' });
  });

  it('sans segments dans la réponse : comptés comme la passerelle les facturerait', async () => {
    const p = await passerelle(200, '{"id":7}');
    const r = await new SmsHttp({ url: p.url, cle: 'x'.repeat(16), expediteur: 'Reclamation' }).envoyer({ destination: '+2250700000001', texte: 'é'.repeat(170) });
    expect(r).toEqual({ idFournisseur: '7', segments: 2 });
  });

  it('refus de la passerelle ou délai dépassé : une erreur, pour que la boîte d\'envoi réessaie', async () => {
    const refus = await passerelle(401, '{"erreur":"clé invalide"}');
    await expect(new SmsHttp({ url: refus.url, cle: 'x'.repeat(16), expediteur: 'R' }).envoyer({ destination: '+225', texte: 't' }))
      .rejects.toThrow(/HTTP 401 \{"erreur":"clé invalide"\}/);
    fermer?.();
    const lente = await passerelle(200, '{}', 500);
    await expect(new SmsHttp({ url: lente.url, cle: 'x'.repeat(16), expediteur: 'R', delaiMs: 100 }).envoyer({ destination: '+225', texte: 't' }))
      .rejects.toThrow();
  });
});

describe('e-mail HTML aux couleurs de la banque', () => {
  const texte = 'Bonjour <Awa>,\n\nVotre réclamation ALP-2026-000001 est enregistrée.\nSuivez son avancement : https://alpha.reclamations.example/suivi/abc_DEF-123\n\nBanque Alpha';

  it('texte échappé, liens affichés tels qu\'ils s\'ouvrent, paragraphes', () => {
    const html = emailHtml('Réclamation ALP-2026-000001 enregistrée', texte, { nom: 'Banque Alpha', couleur: '#0B6E4F', client: true });
    expect(html).toContain('Bonjour &lt;Awa&gt;,');
    expect(html).not.toContain('<Awa>');
    expect(html).toContain('<a href="https://alpha.reclamations.example/suivi/abc_DEF-123" style="color:#0b6e4f;text-decoration:underline;word-break:break-all">https://alpha.reclamations.example/suivi/abc_DEF-123</a>');
    expect(html.match(/<p style/g)).toHaveLength(3);
    expect(html).toContain('<title>Réclamation ALP-2026-000001 enregistrée</title>');
    // Rappel de sécurité pour le client seulement
    expect(html).toContain('ne vous demandera jamais votre mot de passe');
    expect(emailHtml('x', 'y', { nom: 'Banque Alpha', couleur: null, client: false })).not.toContain('ne vous demandera jamais');
  });

  it('bandeau lisible quelle que soit la couleur ; liens assombris sur une couleur claire', () => {
    const jaune = emailHtml('x', 'Lien : https://a.example/b', { nom: 'Banque Soleil', couleur: '#FFD400', client: true });
    expect(jaune).toContain('background:#FFD400;color:#17212b');
    const lien = /<a href="[^"]+" style="color:(#[0-9a-f]{6})/.exec(jaune)![1]!;
    expect(contraste(lien, '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(emailHtml('x', 'y', { nom: 'Banque Nuit', couleur: '#1D2B53', client: false })).toContain('background:#1D2B53;color:#ffffff');
    // Couleur absente ou invalide : couleur par défaut
    expect(emailHtml('x', 'y', { nom: 'B', couleur: 'red', client: false })).toContain('background:#2f4858');
  });
});
