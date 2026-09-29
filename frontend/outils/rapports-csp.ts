/**
 * Politique de sécurité du contenu (CSP) pendant les tests navigateur (étape 8).
 *
 * `vite preview` sert les applications avec la CSP de production, lue dans docker/caddy/commun.caddy,
 * complétée d'un `report-uri` : le navigateur signale chaque ressource refusée, les signalements
 * sont ajoutés à un fichier, et la fin du lancement Playwright échoue s'il n'est pas vide.
 */
import { appendFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Plugin } from 'vite';

export const FICHIER_RAPPORTS_CSP = join(tmpdir(), 'reclamations-navigateur-csp.jsonl');
const ADRESSE_RAPPORTS = '/__rapports-csp';

/** En-têtes de sécurité de production, pour `vite preview`. */
export function entetesProduction(fichierCaddy: string): Record<string, string> {
  const csp = /header Content-Security-Policy "([^"]+)"/.exec(readFileSync(fichierCaddy, 'utf8'))?.[1];
  if (!csp) throw new Error(`Content-Security-Policy introuvable dans ${fichierCaddy}`);
  return {
    'Content-Security-Policy': `${csp}; report-uri ${ADRESSE_RAPPORTS}`,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  };
}

/** Reçoit les signalements du navigateur (POST application/csp-report) et les garde, un par ligne. */
export function rapportsCsp(): Plugin {
  return {
    name: 'rapports-csp',
    configurePreviewServer(serveur) {
      serveur.middlewares.use(ADRESSE_RAPPORTS, (req, res) => {
        let corps = '';
        req.on('data', (morceau: Buffer) => (corps += morceau.toString('utf8')));
        req.on('end', () => {
          appendFileSync(FICHIER_RAPPORTS_CSP, `${corps.replace(/\s*\n\s*/g, ' ')}\n`);
          res.statusCode = 204;
          res.end();
        });
      });
    },
  };
}

/** Ressources refusées depuis le début du lancement : « directive — adresse bloquée (page) ». */
export function violationsCsp(): string[] {
  let brut = '';
  try {
    brut = readFileSync(FICHIER_RAPPORTS_CSP, 'utf8');
  } catch {
    return [];
  }
  return brut
    .split('\n')
    .filter(Boolean)
    .map((ligne) => {
      try {
        const r = (JSON.parse(ligne) as { 'csp-report'?: Record<string, string> })['csp-report'] ?? {};
        return `${r['violated-directive'] ?? '?'} — ${r['blocked-uri'] ?? '?'} (${r['document-uri'] ?? '?'})`;
      } catch {
        return ligne;
      }
    });
}
