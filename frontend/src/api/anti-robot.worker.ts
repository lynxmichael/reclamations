/**
 * Web Worker de l'anti-robot (étape 11) : la recherche tourne hors du fil de l'interface, qui reste
 * fluide pendant que le client remplit le formulaire.
 */
import { chercher } from './anti-robot-calcul';

interface Demande {
  sel: string;
  defi: string;
  maximum: number;
}

const portee = self as unknown as { onmessage: ((e: MessageEvent<Demande>) => void) | null; postMessage(m: unknown): void };

portee.onmessage = (e) => {
  const { sel, defi, maximum } = e.data;
  portee.postMessage({ nombre: chercher(sel, defi, 0, maximum) });
};
