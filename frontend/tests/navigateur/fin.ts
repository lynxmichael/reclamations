/**
 * Après le lancement : aucune ressource ne doit avoir été refusée par la CSP de production
 * (signalements reçus par `vite preview`, voir outils/rapports-csp.ts).
 */
import { violationsCsp } from '../../outils/rapports-csp';

export default async function terminer() {
  // Les signalements partent du navigateur en différé
  await new Promise((r) => setTimeout(r, 1_000));
  const violations = violationsCsp();
  if (violations.length) throw new Error(`CSP de production enfreinte :\n- ${[...new Set(violations)].join('\n- ')}`);
}
