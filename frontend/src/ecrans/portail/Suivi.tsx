/**
 * Suivi public, ouvert depuis le lien reçu par SMS ou e-mail (lireSuivi).
 * Sans code : la chronologie seule. Les messages exigent un code à usage unique (demanderCodeOtp).
 * Étape 15 : une réclamation close avec enquête invite à donner son avis (sans code).
 */
import { LockKeyhole } from 'lucide-react';
import type { S } from '../../api/types';
import { BadgeStatut, Bouton } from '../../ui/composants';
import { date } from '../../ui/format';
import { InvitationAvis } from './Avis';
import { CadrePortail } from './CadrePortail';
import { Etapes } from './Etapes';

export function Suivi({ suivi, surDemanderCode, surAvis }: { suivi: S<'SuiviPublic'>; surDemanderCode?: (canal?: 'EMAIL') => void; surAvis?: () => void }) {
  return (
    <CadrePortail banque={suivi.banque}>
      <div className="px-5 pt-6 pb-8">
        <p className="text-sm font-semibold text-encre-3">Réclamation</p>
        <h1 className="chiffres text-[26px] leading-tight font-bold tracking-wide">{suivi.numero}</h1>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
          <BadgeStatut statut={suivi.statut} pourClient grand />
          <span className="text-[15px] text-encre-2">
            {suivi.categorie}, déposée le {date(suivi.creeLe)}
          </span>
        </div>

        {suivi.avis && <InvitationAvis avis={suivi.avis} surAvis={surAvis} />}

        <section className="mt-8">
          <h2 className="mb-4 text-lg font-bold">Où en est-elle ?</h2>
          <Etapes etapes={suivi.etapes} statut={suivi.statut} />
        </section>

        <section className="mt-9 rounded-2xl bg-marque-doux p-5">
          <h2 className="flex items-center gap-2 text-lg font-bold">
            <LockKeyhole aria-hidden size={19} className="text-marque-texte" />
            Lire les réponses et répondre
          </h2>
          <p className="mt-2 text-[15px] leading-relaxed text-encre-2">
            Pour protéger vos informations, nous envoyons d'abord un code à 6 chiffres au téléphone donné lors du dépôt, ou à votre e-mail si vous n'avez pas donné de téléphone.
          </p>
          <Bouton variante="principal" taille="grand" className="mt-4 w-full" onClick={() => surDemanderCode?.()} data-visite="demander-code">
            Recevoir un code
          </Bouton>
          <button type="button" onClick={() => surDemanderCode?.('EMAIL')} className="mt-3 w-full py-1.5 text-[15px] font-semibold text-marque-texte underline-offset-2 hover:underline">
            Je préfère le recevoir par e-mail
          </button>
        </section>
      </div>
    </CadrePortail>
  );
}
