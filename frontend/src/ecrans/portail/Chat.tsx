/**
 * Chat de la réclamation, dans l'espace client (étape 17, décision I8) : intégré au portail de la
 * banque, même domaine, même politique de sécurité du contenu, aucun script tiers. Les messages
 * arrivent par relecture toutes les 5 secondes (lireConversationClient) ; l'écran est pur.
 *
 * Le client parle à la banque, jamais à un agent nommé. Sous son dernier message : « Lu » quand la
 * banque l'a lu. En tête : la banque est-elle ouverte, et sinon quand elle reprend.
 */
import { useEffect, useRef, useState } from 'react';
import { Check, CheckCheck, SendHorizontal } from 'lucide-react';
import type { S } from '../../api/types';
import { ChoixFichiers } from '../../ui/ChoixFichiers';
import { LogoBanque, cx } from '../../ui/composants';
import { date, dateLongue, heure } from '../../ui/format';
import { PieceJointe } from './MaReclamation';

const jour = (iso: string) => date(iso);

export function Chat({
  banque,
  messages,
  chat,
  peutEcrire,
  statut,
  surEnvoyer,
  occupe,
}: {
  banque: S<'BanquePublique'>;
  messages: S<'MessageVisible'>[];
  chat: S<'EtatChat'>;
  peutEcrire: boolean;
  statut: S<'StatutReclamation'>;
  /** Renvoie false (ou une promesse de false) si l'envoi a échoué : le texte est alors conservé */
  surEnvoyer?: (texte: string, fichiers: File[]) => void | boolean | Promise<boolean>;
  occupe?: boolean;
}) {
  const [texte, setTexte] = useState('');
  const [fichiers, setFichiers] = useState<File[]>([]);
  const fil = useRef<HTMLOListElement>(null);
  const dernierClient = [...messages].reverse().find((m) => m.auteur === 'CLIENT');
  const lu = !!dernierClient && !!chat.luParLaBanqueLe && chat.luParLaBanqueLe >= dernierClient.creeLe;

  // Le fil défile jusqu'au dernier message quand il en arrive un
  useEffect(() => {
    const el = fil.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const envoyer = async () => {
    if (!texte.trim() || occupe) return;
    const ok = await surEnvoyer?.(texte, fichiers);
    if (ok !== false) {
      setTexte('');
      setFichiers([]);
    }
  };

  return (
    <section aria-labelledby="chat-titre" className="mt-8 overflow-hidden rounded-2xl border border-trait">
      <header className="flex items-center gap-3 border-b border-trait bg-fond px-4 py-3">
        <LogoBanque nom={banque.nom} logoUrl={banque.logoUrl} taille={30} />
        <div className="min-w-0">
          <h2 id="chat-titre" className="text-[16px] leading-tight font-bold">Discussion avec {banque.nom}</h2>
          <p className="mt-0.5 flex items-center gap-1.5 text-[13px] text-encre-2">
            <span aria-hidden className={cx('h-2 w-2 shrink-0 rounded-full', chat.ouvert ? 'bg-resolue' : 'bg-encre-3')} />
            {chat.ouvert
              ? 'Ouvert : un conseiller vous répond ici.'
              : chat.repriseLe
                ? `Fermé : réponse dès la réouverture, ${dateLongue(chat.repriseLe)}.`
                : 'Fermé : nous vous répondrons dès la réouverture.'}
          </p>
        </div>
      </header>

      <ol ref={fil} role="log" aria-label="Messages" className="flex max-h-[55vh] min-h-[160px] flex-col gap-3 overflow-y-auto bg-surface px-4 py-4">
        {messages.length === 0 && (
          <li className="my-auto text-center text-[15px] text-encre-3">
            Écrivez votre message : la banque le lit avec votre réclamation. Vous êtes prévenu par SMS ou e-mail si vous n'êtes plus là quand elle répond.
          </li>
        )}
        {messages.map((m, i) => {
          const banqueParle = m.auteur === 'BANQUE';
          const nouveauJour = i === 0 || jour(messages[i - 1]!.creeLe) !== jour(m.creeLe);
          return (
            <li key={m.id} className="flex flex-col gap-1">
              {nouveauJour && <p className="chiffres my-1 text-center text-xs font-semibold text-encre-3">{jour(m.creeLe)}</p>}
              <div className={cx('flex flex-col gap-1', banqueParle ? 'items-start pr-8' : 'items-end pl-8')}>
                <div className={cx('flex max-w-full flex-col gap-2 rounded-2xl px-3.5 py-2.5 text-[15px] leading-relaxed', banqueParle ? 'rounded-tl-md bg-marque-doux' : 'rounded-tr-md bg-fond')}>
                  <span className="sr-only">{banqueParle ? banque.nom : 'Vous'} :</span>
                  <p className="whitespace-pre-line [overflow-wrap:anywhere]">{m.contenu}</p>
                  {m.piecesJointes.map((p) => <PieceJointe key={p.id} piece={p} surFond />)}
                </div>
                <span className="chiffres inline-flex items-center gap-1.5 text-xs text-encre-3">
                  {heure(m.creeLe)}
                  {m === dernierClient && (lu
                    ? <span className="inline-flex items-center gap-0.5"><CheckCheck aria-hidden size={14} className="text-resolue" />Lu</span>
                    : <span className="inline-flex items-center gap-0.5"><Check aria-hidden size={14} />Envoyé</span>)}
                </span>
              </div>
            </li>
          );
        })}
      </ol>

      {peutEcrire ? (
        <form
          className="border-t border-trait bg-surface p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void envoyer();
          }}
        >
          <div className="flex items-end gap-2">
            <label htmlFor="message" className="sr-only">Écrire à la banque</label>
            <textarea
              id="message"
              rows={2}
              value={texte}
              enterKeyHint="send"
              placeholder="Votre message"
              onChange={(e) => setTexte(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void envoyer();
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
              <span className="sr-only">{occupe ? 'Envoi…' : 'Envoyer'}</span>
            </button>
          </div>
          <div className="mt-2">
            <ChoixFichiers fichiers={fichiers} surChangement={setFichiers} libelle="Joindre" compact />
          </div>
        </form>
      ) : (
        <p className="border-t border-trait bg-fond px-4 py-3 text-sm text-encre-2">
          {statut === 'RESOLUE'
            ? 'La banque a résolu votre réclamation : confirmez ou contestez la solution ci-dessus.'
            : 'Votre réclamation est clôturée : la discussion est fermée.'}
        </p>
      )}
    </section>
  );
}
