/**
 * Toute erreur sort au format RFC 9457 (application/problem+json) avec un code du contrat.
 * Les refus métier de l'étape 4 (ErreurMetier) gardent leur code et leur statut ; une erreur
 * imprévue devient 500 ERREUR_INTERNE, sans détail technique pour l'appelant.
 */
import { Catch, HttpException, Logger, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ErreurMetier } from '../../application/reclamations/erreurs.js';
import { Probleme, type CodeErreur } from './probleme.js';

@Catch()
export class FiltreErreurs implements ExceptionFilter {
  private readonly journal = new Logger('Erreurs');

  catch(erreur: unknown, hote: ArgumentsHost): void {
    const http = hote.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const p = this.versProbleme(erreur, req);
    if (res.headersSent) return;
    for (const [nom, valeur] of Object.entries(p.entetes)) res.setHeader(nom, valeur);
    res.status(p.status).type('application/problem+json').send(JSON.stringify(p.corps(req.originalUrl.split('?')[0])));
  }

  private versProbleme(e: unknown, req: Request): Probleme {
    if (e instanceof Probleme) return e;
    if (e instanceof ErreurMetier) return new Probleme(e.statutHttp, e.code as CodeErreur, e.message);
    if (e instanceof HttpException) {
      const statut = e.getStatus();
      if (statut === 404) return new Probleme(404, 'INTROUVABLE', 'Adresse inconnue de l\'API');
      if (statut === 413) return new Probleme(413, 'VALIDATION', 'Corps de requête trop volumineux');
      if (statut === 400) return new Probleme(400, 'VALIDATION', 'Corps de requête illisible (JSON invalide ?)');
      if (statut === 401) return new Probleme(401, 'NON_AUTHENTIFIE');
      if (statut === 403) return new Probleme(403, 'INTERDIT');
      if (statut === 405) return new Probleme(404, 'INTROUVABLE', 'Adresse inconnue de l\'API');
    }
    const brute = e as { type?: string; status?: number; statusCode?: number };
    // Erreurs de body-parser (JSON mal formé, corps trop gros) levées avant Nest
    if (brute?.type === 'entity.parse.failed') return new Probleme(400, 'VALIDATION', 'JSON invalide');
    if (brute?.type === 'entity.too.large') return new Probleme(413, 'VALIDATION', 'Corps de requête trop volumineux');
    this.journal.error(`${req.method} ${req.originalUrl} : ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
    return new Probleme(500, 'ERREUR_INTERNE', 'Une erreur inattendue est survenue ; elle a été journalisée');
  }
}
