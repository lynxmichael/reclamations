/**
 * Assistant automatique du portail (étape 18, décisions I3 et I4) : accueille le client, répond aux
 * questions fréquentes avec les réponses écrites par la banque, prépare la réclamation et passe la
 * main à un conseiller. L'écran est pur ; l'application l'alimente avec converserAvecAssistant.
 *
 * Le client sait toujours qu'il parle à un assistant automatique (bandeau, nom des messages) et peut
 * toujours joindre une personne (« conseiller », suggestion en un toucher). L'assistant ne dépose
 * rien : sa proposition ouvre le formulaire prérempli, que le client relit, complète et envoie.
 */
import { useEffect, useRef, useState } from 'react';
import { Bot, FileText, SendHorizontal, UserRound } from 'lucide-react';
import type { S } from '../../api/types';
import { Bouton, cx } from '../../ui/composants';
import { CadrePortail } from './CadrePortail';

export interface EchangeVu {
  readonly auteur: 'CLIENT' | 'ASSISTANT';
  readonly texte: string;
  readonly code?: S<'CodeMessageAssistant'>;
}

export function Assistant({
  banque,
  agence,
  fil,
  suggestions,
  proposition,
  categorie,
  occupe,
  erreur,
  surEnvoyer,
  surProposition,
  surFormulaire,
}: {
  banque: S<'BanquePublique'>;
  /** Agence du QR code */
  agence?: string | null;
  fil: readonly EchangeVu[];
  suggestions: readonly string[];
  proposition: S<'ReponseAssistant'>['proposition'];
  /** Nom de la catégorie proposée */
  categorie?: string | null;
  /** L'assistant réfléchit */
  occupe?: boolean;
  erreur?: string | null;
  surEnvoyer?: (texte: string) => void;
  surProposition?: () => void;
  surFormulaire?: () => void;
}) {
  const [texte, setTexte] = useState('');
  const liste = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const el = liste.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [fil.length, occupe, proposition]);

  const envoyer = (t: string) => {
    if (!t.trim() || occupe) return;
    surEnvoyer?.(t.trim());
    setTexte('');
  };

  return (
    <CadrePortail
      banque={banque}
      contexte={
        <p className="inline-flex items-center gap-1.5 rounded-full bg-sur-marque/15 px-3 py-1.5 text-sm font-semibold">
          <Bot aria-hidden size={15} strokeWidth={2.4} />
          Assistant automatique{agence ? ` · Agence ${agence}` : ''}
        </p>
      }
      bas={
        <form
          onSubmit={(e) => {
            e.preventDefault();
            envoyer(texte);
          }}
        >
          {suggestions.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-2" aria-label="Réponses rapides">
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => envoyer(s)}
                  disabled={occupe}
                  className="rounded-full border border-marque/40 bg-marque-doux px-3.5 py-1.5 text-sm font-semibold text-marque-texte disabled:opacity-50"
                >
                  {s}
                </button>
              ))}
            </div>
          )}
          <div className="flex items-end gap-2">
            <label htmlFor="message-assistant" className="sr-only">Votre message à l'assistant</label>
            <textarea
              id="message-assistant"
              rows={1}
              value={texte}
              maxLength={1000}
              enterKeyHint="send"
              placeholder="Votre message"
              onChange={(e) => setTexte(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  envoyer(texte);
                }
              }}
              className="min-h-11 flex-1 resize-none rounded-xl border border-trait-fort bg-surface px-3 py-2.5 text-[16px] leading-snug placeholder:text-encre-3 focus:border-focus focus:outline-none"
            />
            <button
              type="submit"
              disabled={!texte.trim() || occupe}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-marque text-sur-marque disabled:opacity-40"
            >
              <SendHorizontal aria-hidden size={19} />
              <span className="sr-only">Envoyer</span>
            </button>
          </div>
          <button type="button" onClick={surFormulaire} className="mt-3 w-full text-center text-sm font-semibold text-marque-texte underline underline-offset-2">
            Remplir le formulaire sans l'assistant
          </button>
        </form>
      }
    >
      <div className="px-5 pt-5 pb-4">
        <h1 className="text-[22px] leading-tight font-bold tracking-tight">Réclamations et questions</h1>
        <p className="mt-1.5 text-sm leading-relaxed text-encre-2">
          Vous échangez avec un assistant automatique, pas avec une personne. Écrivez « conseiller » à tout moment pour qu'un conseiller de {banque.nom} prenne le relais.
          N'écrivez jamais votre code secret ni votre mot de passe.
        </p>
      </div>
      <ol ref={liste} role="log" aria-label="Conversation avec l'assistant" className="flex flex-col gap-3 px-5 pb-6">
        {fil.map((m, i) => {
          const assistant = m.auteur === 'ASSISTANT';
          const premier = i === 0 || fil[i - 1]!.auteur !== m.auteur;
          return (
            <li key={i} className={cx('flex flex-col gap-1', assistant ? 'items-start pr-8' : 'items-end pl-8')}>
              {premier && (
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-encre-3">
                  {assistant ? <Bot aria-hidden size={13} /> : <UserRound aria-hidden size={13} />}
                  {assistant ? 'Assistant automatique' : 'Vous'}
                </span>
              )}
              <p
                className={cx(
                  'max-w-full rounded-2xl px-3.5 py-2.5 text-[15px] leading-relaxed whitespace-pre-line [overflow-wrap:anywhere]',
                  assistant ? (m.code === 'CODE_SECRET' ? 'rounded-tl-md bg-urgent-doux text-encre' : 'rounded-tl-md bg-fond') : 'rounded-tr-md bg-marque text-sur-marque',
                )}
              >
                <span className="sr-only">{assistant ? 'Assistant automatique' : 'Vous'} : </span>
                {m.texte}
              </p>
            </li>
          );
        })}
        {occupe && (
          <li className="flex items-start pr-8" aria-live="polite">
            <span className="inline-flex items-center gap-1 rounded-2xl rounded-tl-md bg-fond px-4 py-3" aria-label="L'assistant écrit">
              {[0, 1, 2].map((k) => <span key={k} className="h-2 w-2 animate-pulse rounded-full bg-encre-3" style={{ animationDelay: `${k * 150}ms` }} />)}
            </span>
          </li>
        )}
        {erreur && <li role="alert" className="rounded-xl border border-urgent/30 bg-urgent-doux px-4 py-3 text-sm text-encre">{erreur}</li>}
        {proposition && !occupe && (
          <li className="mt-1 rounded-2xl border border-marque/40 bg-surface p-4 shadow-[0_2px_10px_rgb(23_33_43/0.06)]" data-testid="proposition">
            <p className="flex items-center gap-2 text-[15px] font-bold">
              <FileText aria-hidden size={18} className="text-marque-texte" />
              {proposition.motif === 'TRANSFERT' ? 'Votre demande au conseiller' : 'Votre réclamation, prête à envoyer'}
            </p>
            {categorie && <p className="mt-2 text-sm text-encre-2">Catégorie : <strong className="text-encre">{categorie}</strong></p>}
            {proposition.description && (
              <blockquote className="mt-2 line-clamp-4 border-l-[3px] border-marque/40 pl-3 text-sm leading-relaxed whitespace-pre-line text-encre-2">{proposition.description}</blockquote>
            )}
            <p className="mt-2 text-sm text-encre-3">Vous pourrez tout relire et compléter avant l'envoi : rien n'est envoyé sans vous.</p>
            <Bouton variante="principal" className="mt-3 w-full" onClick={surProposition} data-visite="proposition">
              {proposition.motif === 'TRANSFERT' ? 'Compléter et envoyer au conseiller' : 'Vérifier et envoyer'}
            </Bouton>
          </li>
        )}
      </ol>
    </CadrePortail>
  );
}
