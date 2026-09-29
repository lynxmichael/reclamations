/** Avant chaque lancement : oubli des codes TOTP présentés et des signalements CSP précédents. */
import { rmSync } from 'node:fs';
import { FICHIER_RAPPORTS_CSP } from '../../outils/rapports-csp';
import { FICHIER_PAS } from './outils';

export default function preparer() {
  rmSync(FICHIER_PAS, { force: true });
  rmSync(FICHIER_RAPPORTS_CSP, { force: true });
}
