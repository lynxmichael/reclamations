/**
 * Messages de retour après une action (« Réponse envoyée », « Cette réclamation a changé… ») :
 * en bas de l'écran, lus par les lecteurs d'écran (role=status), effacés tout seuls.
 */
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { CircleAlert, CircleCheck, Info, X } from 'lucide-react';
import { cx } from '../../ui/composants';

type Ton = 'ok' | 'erreur' | 'info';
interface Annonce {
  id: number;
  texte: string;
  ton: Ton;
}

const Contexte = createContext<(texte: string, ton?: Ton) => void>(() => undefined);

export function useAnnoncer() {
  return useContext(Contexte);
}

export function Annonces({ children }: { children: ReactNode }) {
  const [annonces, setAnnonces] = useState<Annonce[]>([]);
  const compteur = useRef(0);
  const retirer = useCallback((id: number) => setAnnonces((a) => a.filter((x) => x.id !== id)), []);
  const annoncer = useCallback(
    (texte: string, ton: Ton = 'ok') => {
      const id = ++compteur.current;
      setAnnonces((a) => [...a.filter((x) => x.texte !== texte).slice(-2), { id, texte, ton }]);
      window.setTimeout(() => retirer(id), ton === 'erreur' ? 8000 : 4500);
    },
    [retirer],
  );
  const valeur = useMemo(() => annoncer, [annoncer]);
  return (
    <Contexte.Provider value={valeur}>
      {children}
      <div aria-live="polite" role="status" data-annonces className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4">
        {annonces.map((a) => {
          const Icone = a.ton === 'erreur' ? CircleAlert : a.ton === 'info' ? Info : CircleCheck;
          return (
            <div
              key={a.id}
              className={cx(
                'pointer-events-auto flex max-w-xl items-start gap-3 rounded-xl px-4 py-3 text-[15px] shadow-[0_12px_32px_rgb(23_33_43/0.22)]',
                a.ton === 'erreur' ? 'bg-urgent text-white' : 'bg-encre text-white',
              )}
            >
              <Icone aria-hidden size={19} className="mt-0.5 shrink-0" />
              <span className="flex-1 leading-snug">{a.texte}</span>
              <button type="button" aria-label="Fermer le message" onClick={() => retirer(a.id)} className="-mr-1 rounded p-0.5 opacity-80 hover:opacity-100">
                <X size={17} />
              </button>
            </div>
          );
        })}
      </div>
    </Contexte.Provider>
  );
}
