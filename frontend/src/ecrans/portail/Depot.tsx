/**
 * Dépôt d'une réclamation depuis un QR code ou un lien web.
 * Données : lireFormulaireDepot. Envoi : deposerReclamation (multipart, Idempotency-Key).
 */
import { useState } from 'react';
import { CircleAlert, FileImage, MapPin, Paperclip, X } from 'lucide-react';
import type { S } from '../../api/types';
import { Bouton, Champ, Liste, Saisie, Texte, cx } from '../../ui/composants';
import { octets } from '../../ui/format';
import { CadrePortail } from './CadrePortail';

const TYPES: Record<string, string> = { 'image/jpeg': 'JPEG', 'image/png': 'PNG', 'image/webp': 'WebP', 'application/pdf': 'PDF' };

export interface SaisieDepot {
  categorieId: string;
  description: string;
  nom: string;
  telephone: string;
  email: string;
  consentement: boolean;
  fichiers: { nom: string; taille: number }[];
}

export function Depot({
  formulaire,
  saisie,
  erreur,
}: {
  formulaire: S<'FormulaireDepot'>;
  saisie: SaisieDepot;
  /** Réponse 400 de l'API (RFC 9457) : les erreurs sont affichées sous chaque champ */
  erreur?: S<'Probleme'> | null;
}) {
  const [categorieId, setCategorieId] = useState(saisie.categorieId);
  const [fichiers, setFichiers] = useState(saisie.fichiers);
  const erreurDe = Object.fromEntries((erreur?.erreurs ?? []).map((e) => [e.champ, e.message]));
  const { fichiers: regles } = formulaire;
  const types = regles.types.map((t) => TYPES[t] ?? t);

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
        <Bouton variante="principal" taille="grand" className="w-full">
          Envoyer ma réclamation
        </Bouton>
      }
    >
      <form className="flex flex-col gap-7 px-5 pt-6 pb-8" noValidate onSubmit={(e) => e.preventDefault()}>
        <div>
          <h1 className="text-[26px] leading-tight font-bold tracking-tight">Déposer une réclamation</h1>
          <p className="mt-2 text-[15px] leading-relaxed text-encre-2">Un conseiller l'étudie et vous répond par SMS ou par e-mail.</p>
        </div>

        {erreur && (
          <div role="alert" className="flex gap-3 rounded-xl border border-urgent/30 bg-urgent-doux p-4 text-[15px]">
            <CircleAlert aria-hidden size={20} className="mt-0.5 shrink-0 text-urgent" />
            <div>
              <p className="font-bold text-urgent">{erreur.title}</p>
              <p className="mt-0.5 text-encre-2">{erreur.detail}</p>
            </div>
          </div>
        )}

        <fieldset className="flex flex-col gap-2.5">
          <legend className="mb-2.5 text-[15px] font-semibold">De quoi s'agit-il ?</legend>
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
              <Liste id={id} defaultValue="">
                <option value="">Aucune en particulier</option>
                {formulaire.agences.map((a) => (
                  <option key={a.id} value={a.id}>{a.nom}</option>
                ))}
              </Liste>
            )}
          </Champ>
        )}

        <Champ libelle="Votre réclamation" aide="Ce qui s'est passé, quand, et les montants s'il y en a." erreur={erreurDe.description}>
          {(id, decrit) => <Texte id={id} aria-describedby={decrit} defaultValue={saisie.description} invalide={!!erreurDe.description} rows={5} />}
        </Champ>

        <div className="flex flex-col gap-2.5">
          <span className="text-[15px] font-semibold">
            Photos ou documents <span className="font-normal text-encre-3">(facultatif)</span>
          </span>
          {fichiers.map((f) => (
            <div key={f.nom} className="flex items-center gap-3 rounded-lg border border-trait bg-fond px-3 py-2.5">
              <FileImage aria-hidden size={20} className="shrink-0 text-encre-3" />
              <span className="min-w-0 flex-1 truncate text-[15px]">{f.nom}</span>
              <span className="chiffres text-sm text-encre-3">{octets(f.taille)}</span>
              <button type="button" aria-label={`Retirer ${f.nom}`} onClick={() => setFichiers(fichiers.filter((x) => x !== f))} className="rounded p-1 text-encre-3 hover:bg-trait">
                <X size={18} />
              </button>
            </div>
          ))}
          {fichiers.length < regles.maxFichiers && (
            <button type="button" className="flex h-12 items-center justify-center gap-2 rounded-lg border-2 border-dashed border-trait-fort font-semibold text-marque-texte hover:border-marque">
              <Paperclip aria-hidden size={18} />
              Ajouter une photo ou un PDF
            </button>
          )}
          <p className="text-sm text-encre-3">
            {regles.maxFichiers} fichiers au plus, {octets(regles.maxOctets)} chacun ({types.join(', ')}).
          </p>
        </div>

        <fieldset className="flex flex-col gap-4">
          <legend className="mb-1 text-lg font-bold">Pour vous répondre</legend>
          <p className="-mt-2 text-sm leading-relaxed text-encre-3">Un téléphone ou un e-mail au moins. Vous y recevrez votre numéro de suivi.</p>
          <Champ libelle="Nom et prénom" erreur={erreurDe.nom}>
            {(id) => <Saisie id={id} autoComplete="name" defaultValue={saisie.nom} />}
          </Champ>
          <Champ libelle="Téléphone" erreur={erreurDe.telephone}>
            {(id, decrit) => (
              <div className="flex">
                <span className="inline-flex items-center rounded-l-lg border border-r-0 border-trait-fort bg-fond px-3 text-[15px] text-encre-2">+225</span>
                <Saisie id={id} aria-describedby={decrit} type="tel" inputMode="tel" autoComplete="tel-national" placeholder="07 08 09 10 11" defaultValue={saisie.telephone} invalide={!!erreurDe.telephone} className="rounded-l-none" />
              </div>
            )}
          </Champ>
          <Champ libelle="E-mail" facultatif erreur={erreurDe.email}>
            {(id) => <Saisie id={id} type="email" inputMode="email" autoComplete="email" defaultValue={saisie.email} />}
          </Champ>
        </fieldset>

        <label className="flex cursor-pointer items-start gap-3 text-[15px] leading-relaxed">
          <input type="checkbox" defaultChecked={saisie.consentement} className="mt-1 h-5 w-5 shrink-0 accent-[var(--marque)]" />
          <span>
            J'accepte que {formulaire.banque.nom} utilise ces informations pour traiter ma réclamation, selon sa{' '}
            <a href={formulaire.politiqueDonnees.url} className="font-semibold text-marque-texte underline underline-offset-2">
              politique de données
            </a>
            .
          </span>
        </label>
      </form>
    </CadrePortail>
  );
}
