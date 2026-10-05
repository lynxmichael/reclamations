/**
 * Certificats HTTPS à la demande (production) : Caddy obtient le certificat d'un portail
 * <slug>.<domaine> à sa première visite, après avoir demandé ici si ce nom est bien celui d'une
 * banque cliente. Route interne, hors du contrat : Caddy ne la publie pas (seul /api/* l'est).
 */
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import type { Configuration } from '../configuration/configuration.js';
import { BaseDonnees } from './base-de-donnees/base-de-donnees.service.js';

export function monterVerificationTls(app: INestApplication, config: Configuration): void {
  const bd = app.get(BaseDonnees);
  const routeur = (app as NestExpressApplication).getHttpAdapter().getInstance() as { get(c: string, f: (req: Request, res: Response) => void): void };
  const suffixe = `.${config.domaine}`;
  routeur.get('/interne/tls', (req, res) => {
    const domaine = String(req.query.domain ?? '').toLowerCase();
    const repondre = (ok: boolean) => res.status(ok ? 200 : 404).type('text/plain').send(ok ? 'ok' : 'inconnu');
    if (domaine === `console${suffixe}`) return repondre(true);
    if (!domaine.endsWith(suffixe)) return repondre(false);
    const slug = domaine.slice(0, -suffixe.length);
    if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(slug)) return repondre(false);
    bd.enSysteme((tx) => tx.banque.findUnique({ where: { slug }, select: { id: true } }))
      .then((b) => repondre(!!b), () => res.status(503).send('indisponible'));
  });
}
