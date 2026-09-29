/**
 * Accusé de réception, juste après le dépôt (réponse 201 de deposerReclamation).
 * Le même numéro et le lien de suivi partent par SMS et/ou par e-mail (notification client.depot).
 */
import { Check, Copy, MessageSquareText } from 'lucide-react';
import type { S } from '../../api/types';
import { Bouton } from '../../ui/composants';
import { CadrePortail } from './CadrePortail';

export function Accuse({
  banque,
  accuse,
  envoiPar,
  surSuivre,
  surAutre,
}: {
  banque: S<'BanquePublique'>;
  accuse: S<'AccuseDepot'>;
  envoiPar: string;
  surSuivre?: () => void;
  surAutre?: () => void;
}) {
  return (
    <CadrePortail banque={banque}>
      <div className="flex flex-col items-center px-6 pt-10 pb-10 text-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-marque-doux text-marque-texte ring-8 ring-marque-doux/50">
          <Check aria-hidden size={34} strokeWidth={3} />
        </span>
        <h1 className="mt-6 text-[26px] leading-tight font-bold tracking-tight">Réclamation envoyée</h1>
        <p className="mt-2 max-w-[30ch] text-[15px] leading-relaxed text-encre-2">Un conseiller de {banque.nom} va l'étudier et vous répondre.</p>

        <div className="mt-8 w-full rounded-2xl border border-trait bg-fond px-5 py-5">
          <p className="text-sm font-semibold text-encre-3">Votre numéro de suivi</p>
          <p className="chiffres mt-1 text-[28px] font-bold tracking-wide text-encre select-all">{accuse.numero}</p>
          <Bouton
            taille="petit"
            variante="discret"
            className="mt-2"
            icone={<Copy aria-hidden size={15} />}
            onClick={() => navigator.clipboard?.writeText(accuse.numero).catch(() => undefined)}
          >
            Copier le numéro
          </Bouton>
        </div>

        <p className="mt-6 flex items-start gap-2.5 text-left text-[15px] leading-relaxed text-encre-2">
          <MessageSquareText aria-hidden size={20} className="mt-0.5 shrink-0 text-marque-texte" />
          <span>
            Vous allez recevoir ce numéro et un lien de suivi {envoiPar}. Gardez-les : ils vous permettent de suivre votre réclamation et de lire les réponses.
          </span>
        </p>

        <div className="mt-8 flex w-full flex-col gap-3">
          <Bouton variante="principal" taille="grand" className="w-full" onClick={surSuivre} data-visite="suivre">
            Suivre ma réclamation
          </Bouton>
          <Bouton variante="secondaire" taille="grand" className="w-full" onClick={surAutre}>
            Déposer une autre réclamation
          </Bouton>
        </div>
      </div>
    </CadrePortail>
  );
}
