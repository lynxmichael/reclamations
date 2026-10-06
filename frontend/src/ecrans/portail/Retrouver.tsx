/**
 * Étape 21 : le client a perdu son lien ou son numéro de suivi. Il donne le téléphone ou l'e-mail
 * du dépôt (demanderCodeAcces) ; le code reçu ouvre son espace, avec toutes ses réclamations dans
 * cette banque (verifierCodeAcces). La réponse est la même que le numéro soit connu ou non.
 */
import { useState, type FormEvent } from 'react';
import { ChevronLeft, KeyRound, MessageSquareText, QrCode as IconeQr, Search } from 'lucide-react';
import type { S } from '../../api/types';
import { Bouton, Champ, Saisie } from '../../ui/composants';
import { CadrePortail } from './CadrePortail';

export function Retrouver({
  banque,
  contact = '',
  erreur,
  occupe,
  surEnvoyer,
  surRetour,
}: {
  banque: S<'BanquePublique'>;
  contact?: string;
  erreur?: string | null;
  occupe?: boolean;
  surEnvoyer?: (contact: string) => void;
  surRetour?: () => void;
}) {
  const [valeur, setValeur] = useState(contact);
  const envoyer = (e: FormEvent) => {
    e.preventDefault();
    surEnvoyer?.(valeur.trim());
  };
  return (
    <CadrePortail
      banque={banque}
      bas={
        <Bouton variante="principal" taille="grand" className="w-full" type="submit" form="form-retrouver" disabled={occupe || valeur.trim().length < 6}>
          {occupe ? 'Envoi…' : 'Recevoir un code'}
        </Bouton>
      }
    >
      <form id="form-retrouver" noValidate onSubmit={envoyer} className="px-5 pt-5 pb-8">
        {surRetour && (
          <button type="button" onClick={surRetour} className="-ml-1.5 inline-flex items-center gap-1 rounded py-1 pr-2 text-[15px] font-semibold text-marque-texte">
            <ChevronLeft aria-hidden size={18} />
            Accueil
          </button>
        )}
        <h1 className="mt-3 text-[26px] leading-tight font-bold tracking-tight">Retrouver mes réclamations</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-encre-2">
          Lien de suivi perdu, numéro oublié ? Donnez le téléphone ou l'e-mail que vous avez indiqué lors du dépôt, au portail ou au guichet. Nous y envoyons un code pour ouvrir votre espace, avec toutes vos réclamations chez {banque.nom}.
        </p>
        <div className="mt-6">
          <Champ libelle="Téléphone ou e-mail" erreur={erreur ?? undefined} aide="Par exemple 07 08 09 10 11, ou nom@exemple.ci">
            {(id, decrit) => (
              <Saisie
                id={id}
                aria-describedby={decrit}
                name="contact"
                inputMode="email"
                autoComplete="username"
                value={valeur}
                onChange={(e) => setValeur(e.target.value)}
                invalide={!!erreur}
              />
            )}
          </Champ>
        </div>
        <p className="mt-5 flex gap-2.5 rounded-xl bg-fond px-4 py-3 text-sm leading-relaxed text-encre-2">
          <KeyRound aria-hidden size={17} className="mt-0.5 shrink-0 text-encre-3" />
          Pour protéger vos informations, nous ne disons pas si ce numéro ou cette adresse est connu : si un code arrive, c'est qu'il y a des réclamations à ce nom.
        </p>
      </form>
    </CadrePortail>
  );
}

/** Accueil du portail d'une banque (<slug>.<domaine>) : déposer, suivre, ou retrouver ses réclamations. */
export function AccueilPortail({ banque, surRetrouver }: { banque: S<'BanquePublique'>; surRetrouver?: () => void }) {
  return (
    <CadrePortail banque={banque}>
      <div className="px-5 pt-6 pb-10">
        <h1 className="text-[26px] leading-tight font-bold tracking-tight">Déposer ou suivre une réclamation</h1>
        <ul className="mt-6 flex flex-col gap-5 text-[15px] leading-relaxed text-encre-2">
          <li className="flex gap-3">
            <IconeQr aria-hidden size={22} className="mt-0.5 shrink-0 text-encre-3" />
            <span>Pour déposer une réclamation, scannez le QR code affiché dans votre agence, ouvrez le lien donné par {banque.nom}, ou adressez-vous au guichet.</span>
          </li>
          <li className="flex gap-3">
            <MessageSquareText aria-hidden size={22} className="mt-0.5 shrink-0 text-encre-3" />
            <span>Pour suivre une réclamation, ouvrez le lien reçu par SMS ou par e-mail après votre dépôt.</span>
          </li>
        </ul>
        <section className="mt-8 rounded-2xl bg-marque-doux p-5">
          <h2 className="flex items-center gap-2 text-lg font-bold">
            <Search aria-hidden size={19} className="text-marque-texte" />
            Lien perdu ?
          </h2>
          <p className="mt-2 text-[15px] leading-relaxed text-encre-2">Retrouvez toutes vos réclamations avec le téléphone ou l'e-mail donné au dépôt.</p>
          <Bouton variante="principal" taille="grand" className="mt-4 w-full" onClick={surRetrouver}>
            Retrouver mes réclamations
          </Bouton>
        </section>
      </div>
    </CadrePortail>
  );
}
