/**
 * Documentation Swagger de l'API à /api/docs (décision C14) : Swagger UI sert le contrat lui-même,
 * avec ce serveur en premier choix pour « Try it out ». Aucune dépendance externe (pas de CDN).
 */
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Response } from 'express';
import { getAbsoluteFSPath } from 'swagger-ui-dist';
import { parse, stringify } from 'yaml';
import type { Configuration } from '../../configuration/configuration.js';
import { contratApi } from './contrat.js';

const PAGE = `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>API Réclamations — documentation</title>
  <link rel="stylesheet" href="/api/docs/swagger-ui.css">
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="/api/docs/swagger-ui-bundle.js"></script>
  <script src="/api/docs/initialisation.js"></script>
</body>
</html>`;

const INITIALISATION = `window.ui = SwaggerUIBundle({
  url: '/api/docs/openapi.yaml',
  dom_id: '#swagger-ui',
  deepLinking: true,
  persistAuthorization: true,
  withCredentials: true,
  docExpansion: 'none',
  tryItOutEnabled: false,
});`;

export function monterDocumentation(app: INestApplication, _config: Configuration): void {
  const express = app as NestExpressApplication;
  const contrat = parse(contratApi().texte) as { servers?: unknown[] };
  contrat.servers = [{ url: '/api/v1', description: 'Ce serveur' }, ...(contrat.servers ?? [])];
  const texte = stringify(contrat, { lineWidth: 0 });
  const csp = "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'";
  const routeur = express.getHttpAdapter().getInstance() as { get(chemin: string, f: (req: unknown, res: Response) => void): void };
  const envoyer = (type: string, corps: string) => (_req: unknown, res: Response) => {
    res.setHeader('Content-Security-Policy', csp);
    res.type(type).send(corps);
  };
  routeur.get('/api/docs', envoyer('text/html', PAGE));
  routeur.get('/api/docs/', envoyer('text/html', PAGE));
  routeur.get('/api/docs/openapi.yaml', envoyer('application/yaml', texte));
  routeur.get('/api/docs/initialisation.js', envoyer('application/javascript', INITIALISATION));
  express.useStaticAssets(getAbsoluteFSPath(), { prefix: '/api/docs/', index: false, maxAge: '1h' });
}
