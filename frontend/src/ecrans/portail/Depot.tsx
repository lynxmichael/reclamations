/**
 * Dépôt d'une réclamation depuis un QR code ou un lien web.
 * Données : lireFormulaireDepot. Envoi : deposerReclamation (multipart, Idempotency-Key).
 */
import { useState, type FormEvent } from 'react';
import { Bot, CircleAlert, MapPin } from 'lucide-react';
import type { S } from '../../api/types';
import { IconeCanal } from '../../ui/Canaux';
import { telephone } from '../../ui/format';
import { ChoixFichiers } from '../../ui/ChoixFichiers';
import { Bouton, Champ, Liste, Saisie, Texte, cx } from '../../ui/composants';
import { CadrePortail } from './CadrePortail';

/** Un fichier d'exemple (maquettes, démo) : du vrai contenu, de la taille annoncée. */
export function fichierExemple(nom: string, taille: number, type = nom.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg'): File {
  return new File([new ArrayBuffer(taille)], nom, { type });
}

export interface SaisieDepot {
  categorieId: string;
  description: string;
  nom: string;
  telephone: string;
  email: string;
  consentement: boolean;
  fichiers: File[];
}

export function Depot({
  formulaire,
  saisie,
  erreur,
  surEnvoyer,
  occupe,
  lienPolitique,
  assistant,
}: {
  formulaire: S<'FormulaireDepot'>;
  saisie: SaisieDepot;
  /** Réponse 400 de l'API (RFC 9457) : les erreurs sont affichées sous chaque champ */
  erreur?: S<'Probleme'> | null;
  /** Envoi du formulaire (démo cliquable ; à l'étape 8, deposerReclamation) */
  surEnvoyer?: (valeurs: SaisieDepot & { agenceId: string | null }) => void;
  occupe?: boolean;
  /** Adresse de la politique de données (par défaut celle que donne l'API) */
  lienPolitique?: string;
  /** Étape 18 : formulaire préparé avec l'assistant (préremplie), ou assistant disponible sur ce portail */
  assistant?: { readonly prepare: boolean; readonly surRetour?: () => void };
}) {
  const [categorieId, setCategorieId] = useState(saisie.categorieId);
  const [fichiers, setFichiers] = useState(saisie.fichiers);
  const envoyer = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const texte = (cle: string) => String(f.get(cle) ?? '');
    surEnvoyer?.({
      categorieId,
      description: texte('description'),
      nom: texte('nom'),
      telephone: texte('telephone'),
      email: texte('email'),
      consentement: f.get('consentement') === 'on',
      fichiers,
      agenceId: texte('agenceId') || null,
    });
  };
  const erreurDe = Object.fromEntries((erreur?.erreurs ?? []).map((e) => [e.champ, e.message]));
  const { fichiers: regles } = formulaire;

  return (
    <CadrePortail
      banque={formulaire.banque}
      contexte={
        formulaire.agence && (
          <p className="inline-flex items-center gap-1.5 rounded-full bg-sur-marque/15 px-3 py-1.5 text-sm font-semibold">
            <MapPin aria-hidden size={15} strokeWidth={2.4} />
            Agence {formulaire.agence.nom}
          </p>
        )
      }
      bas={
        <Bouton variante="principal" taille="grand" className="w-full" type="submit" form="form-depot" disabled={occupe} data-visite="envoyer-depot">
          {occupe ? 'Envoi…' : 'Envoyer ma réclamation'}
        </Bouton>
      }
    >
      <form id="form-depot" className="flex flex-col gap-7 px-5 pt-6 pb-8" noValidate onSubmit={envoyer}>
        <div>
          <h1 className="text-[26px] leading-tight font-bold tracking-tight">Déposer une réclamation</h1>
          <p className="mt-2 text-[15px] leading-relaxed text-encre-2">Un conseiller l'étudie et vous répond par SMS ou par e-mail.</p>
        </div>

        {/* Étape 20 : la banque a ouvert WhatsApp ; le client peut aussi y écrire */}
        {formulaire.banque.whatsapp && (
          <a
            href={`https://wa.me/${formulaire.banque.whatsapp.replace(/\D/g, '')}`}
            target="_blank"
            rel="noreferrer"
            data-testid="lien-whatsapp"
            className="-mt-3 flex items-center gap-3 rounded-xl border border-resolue/30 bg-resolue-doux px-4 py-3 text-[15px] leading-snug text-encre"
          >
            <span className="text-resolue"><IconeCanal canal="WHATSAPP" taille={20} /></span>
            <span>
              Vous préférez WhatsApp ? Écrivez-nous au <span className="chiffres font-semibold whitespace-nowrap">{telephone(formulaire.banque.whatsapp)}</span> : un conseiller vous y répond.
            </span>
          </a>
        )}

        {assistant && (
          <div className="flex gap-3 rounded-xl border border-marque/30 bg-marque-doux px-4 py-3 text-[15px] leading-relaxed">
            <Bot aria-hidden size={20} className="mt-0.5 shrink-0 text-marque-texte" />
            <div>
              {assistant.prepare && <p>Préparée avec l'assistant : vérifiez la catégorie et la description, ajoutez vos coordonnées, puis envoyez.</p>}
              {assistant.surRetour && (
                <button type="button" onClick={assistant.surRetour} className="font-semibold text-marque-texte underline underline-offset-2">
                  {assistant.prepare ? 'Revenir à l\'assistant' : 'Être aidé par l\'assistant automatique'}
                </button>
              )}
            </div>
          </div>
        )}

        {erreur && (
          <div role="alert" className="flex gap-3 rounded-xl border border-urgent/30 bg-urgent-doux p-4 text-[15px]">
            <CircleAlert aria-hidden size={20} className="mt-0.5 shrink-0 text-urgent" />
            <div>
              <p className="font-bold text-urgent">{erreur.title}</p>
              <p className="mt-0.5 text-encre-2">{erreur.detail}</p>
            </div>
          </div>
        )}

        <fieldset className="flex flex-col gap-2.5" aria-describedby={erreurDe.categorieId ? 'erreur-categorie' : undefined}>
          <legend className="mb-2.5 text-[15px] font-semibold">De quoi s'agit-il ?</legend>
          {erreurDe.categorieId && <p id="erreur-categorie" className="-mt-1 text-sm font-semibold text-urgent">Choisissez le type de réclamation.</p>}
          {formulaire.categories.map((c) => {
            const choisie = c.id === categorieId;
            return (
              <label
                key={c.id}
                className={cx(
                  'flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3 transition-colors',
                  choisie ? 'border-marque bg-marque-doux ring-1 ring-marque' : 'border-trait-fort hover:border-encre-3',
                )}
              >
                <input type="radio" name="categorie" checked={choisie} onChange={() => setCategorieId(c.id)} className="sr-only" />
                <span aria-hidden className={cx('mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2', choisie ? 'border-marque-texte' : 'border-trait-fort')}>
                  {choisie && <span className="h-2.5 w-2.5 rounded-full bg-marque-texte" />}
                </span>
                <span className="leading-snug">
                  <span className="block font-semibold">{c.nom}</span>
                  {c.description && <span className="block text-sm text-encre-3">{c.description}</span>}
                </span>
              </label>
            );
          })}
        </fieldset>

        {formulaire.agence === null && formulaire.agences.length > 0 && (
          <Champ libelle="Agence concernée" facultatif>
            {(id) => (
              <Liste id={id} name="agenceId" defaultValue="">
                <option value="">Aucune en particulier</option>
                {formulaire.agences.map((a) => (
                  <option key={a.id} value={a.id}>{a.nom}</option>
                ))}
              </Liste>
            )}
          </Champ>
        )}

        <Champ libelle="Votre réclamation" aide="Ce qui s'est passé, quand, et les montants s'il y en a." erreur={erreurDe.description}>
          {(id, decrit) => <Texte id={id} name="description" aria-describedby={decrit} defaultValue={saisie.description} invalide={!!erreurDe.description} rows={5} />}
        </Champ>

        <div className="flex flex-col gap-2.5">
          <span className="text-[15px] font-semibold">
            Photos ou documents <span className="font-normal text-encre-3">(facultatif)</span>
          </span>
          <ChoixFichiers fichiers={fichiers} surChangement={setFichiers} regles={{ max: regles.maxFichiers, maxOctets: regles.maxOctets, types: regles.types }} />
          {erreurDe.fichiers && <p className="text-sm font-semibold text-urgent">{erreurDe.fichiers}</p>}
        </div>

        <fieldset className="flex flex-col gap-4">
          <legend className="mb-1 text-lg font-bold">Pour vous répondre</legend>
          <p className="-mt-2 text-sm leading-relaxed text-encre-3">Un téléphone ou un e-mail au moins. Vous y recevrez votre numéro de suivi.</p>
          <Champ libelle="Nom et prénom" erreur={erreurDe.nom}>
            {(id) => <Saisie id={id} name="nom" autoComplete="name" defaultValue={saisie.nom} invalide={!!erreurDe.nom} />}
          </Champ>
          <Champ libelle="Téléphone" erreur={erreurDe.telephone}>
            {(id, decrit) => (
              <div className="flex">
                <span className="inline-flex items-center rounded-l-lg border border-r-0 border-trait-fort bg-fond px-3 text-[15px] text-encre-2">+225</span>
                <Saisie id={id} name="telephone" aria-describedby={decrit} type="tel" inputMode="tel" autoComplete="tel-national" placeholder="07 08 09 10 11" defaultValue={saisie.telephone} invalide={!!erreurDe.telephone} className="rounded-l-none" />
              </div>
            )}
          </Champ>
          <Champ libelle="E-mail" facultatif erreur={erreurDe.email}>
            {(id) => <Saisie id={id} name="email" type="email" inputMode="email" autoComplete="email" defaultValue={saisie.email} invalide={!!erreurDe.email} />}
          </Champ>
        </fieldset>

        <label className="flex cursor-pointer items-start gap-3 text-[15px] leading-relaxed">
          <input type="checkbox" name="consentement" defaultChecked={saisie.consentement} className="mt-1 h-5 w-5 shrink-0 accent-[var(--marque)]" />
          <span>
            J'accepte que {formulaire.banque.nom} utilise ces informations pour traiter ma réclamation, selon sa{' '}
            <a href={lienPolitique ?? formulaire.politiqueDonnees.url} target="_blank" rel="noopener" className="font-semibold text-marque-texte underline underline-offset-2">
              politique de données
            </a>
            .
            {erreurDe.consentement && <span className="mt-1 block text-sm font-semibold text-urgent">{erreurDe.consentement}</span>}
          </span>
        </label>
      </form>
    </CadrePortail>
  );
}
