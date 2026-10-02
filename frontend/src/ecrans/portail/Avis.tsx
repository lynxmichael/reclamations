/**
 * Enquête de satisfaction (étape 15, décision I9), ouverte par le lien du message de clôture ou
 * par le bouton du suivi (lireAvis, donnerAvis). Deux questions et un commentaire facultatif ;
 * une seule réponse, pendant 7 jours. L'écran suit l'état rendu par l'API, sans règle à lui.
 */
import { useState } from 'react';
import { CircleCheck, Clock3 } from 'lucide-react';
import type { S } from '../../api/types';
import { Bouton, Texte, cx } from '../../ui/composants';
import { date, dateLongue } from '../../ui/format';
import { NOTE_SATISFACTION } from '../../ui/libelles';
import { CadrePortail } from './CadrePortail';

const LONGUEUR_COMMENTAIRE = 1000;

function Echelle({
  nom,
  legende,
  min,
  max,
  valeur,
  surChoix,
  accessible,
  bornes,
  colonnes,
}: {
  nom: string;
  legende: string;
  min: number;
  max: number;
  valeur: number | null;
  surChoix: (n: number) => void;
  /** Nom lu par un lecteur d'écran pour chaque choix */
  accessible: (n: number) => string;
  bornes: [string, string];
  colonnes: string;
}) {
  const choix = Array.from({ length: max - min + 1 }, (_, i) => min + i);
  return (
    <fieldset>
      <legend className="text-[17px] leading-snug font-bold">{legende}</legend>
      <div className={cx('mt-3.5 grid gap-2', colonnes)}>
        {choix.map((n) => (
          <label
            key={n}
            className={cx(
              'chiffres relative flex h-12 cursor-pointer items-center justify-center rounded-xl border-2 text-lg font-bold transition-colors',
              'has-[input:focus-visible]:outline-3 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-focus',
              valeur === n ? 'border-marque bg-marque text-sur-marque' : 'border-trait-fort bg-surface text-encre hover:border-marque',
            )}
          >
            <input type="radio" name={nom} value={n} checked={valeur === n} onChange={() => surChoix(n)} className="absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0" aria-label={accessible(n)} />
            {n}
          </label>
        ))}
      </div>
      <div className="mt-2 flex justify-between gap-4 text-sm text-encre-3">
        <span>{bornes[0]}</span>
        <span className="text-right">{bornes[1]}</span>
      </div>
    </fieldset>
  );
}

function LienSuivi({ surSuivi }: { surSuivi?: () => void }) {
  if (!surSuivi) return null;
  return (
    <button type="button" onClick={surSuivi} className="mt-6 w-full py-1.5 text-[15px] font-semibold text-marque-texte underline-offset-2 hover:underline">
      Voir le suivi de ma réclamation
    </button>
  );
}

export function Avis({
  avis,
  erreur,
  occupe,
  surEnvoyer,
  surSuivi,
}: {
  avis: S<'Avis'>;
  /** Refus de l'API (enquête terminée entre-temps, réseau…) */
  erreur?: string | null;
  occupe?: boolean;
  surEnvoyer?: (reponse: S<'ReponseAvis'>) => void;
  surSuivi?: () => void;
}) {
  const [note, setNote] = useState<number | null>(null);
  const [recommandation, setRecommandation] = useState<number | null>(null);
  const [commentaire, setCommentaire] = useState('');

  const entete = (
    <p className="text-sm font-semibold text-encre-3">
      Réclamation <span className="chiffres">{avis.numero}</span> · {avis.categorie}
    </p>
  );

  if (avis.etat === 'DONNE' && avis.reponse) {
    const r = avis.reponse;
    return (
      <CadrePortail banque={avis.banque}>
        <div className="px-5 pt-6 pb-8">
          {entete}
          <div className="mt-5 flex flex-col items-center rounded-2xl bg-resolue-doux/70 px-5 py-6 text-center">
            <CircleCheck aria-hidden size={40} className="text-resolue" />
            <h1 className="mt-3 text-[24px] leading-tight font-bold">Merci pour votre avis</h1>
            <p className="mt-2 text-[15px] leading-relaxed text-encre-2">Il a été transmis à {avis.banque.nom} le {date(r.reponduLe)}.</p>
          </div>
          <dl className="mt-6 divide-y divide-trait rounded-2xl border border-trait">
            <div className="flex items-baseline justify-between gap-4 px-4 py-3">
              <dt className="text-[15px] text-encre-2">Satisfaction</dt>
              <dd className="text-[15px] font-semibold">
                <span className="chiffres">{r.note} sur 5</span>, {NOTE_SATISFACTION[r.note]?.toLowerCase()}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-4 px-4 py-3">
              <dt className="text-[15px] text-encre-2">Recommandation</dt>
              <dd className="chiffres text-[15px] font-semibold">{r.recommandation} sur 10</dd>
            </div>
            {r.commentaire && (
              <div className="px-4 py-3">
                <dt className="text-[15px] text-encre-2">Votre commentaire</dt>
                <dd className="mt-1 text-[15px] leading-relaxed whitespace-pre-line">{r.commentaire}</dd>
              </div>
            )}
          </dl>
          <LienSuivi surSuivi={surSuivi} />
        </div>
      </CadrePortail>
    );
  }

  if (avis.etat !== 'A_DONNER') {
    return (
      <CadrePortail banque={avis.banque}>
        <div className="px-5 pt-6 pb-8">
          {entete}
          <div className="mt-5 flex flex-col items-center rounded-2xl bg-fond px-5 py-6 text-center">
            <Clock3 aria-hidden size={36} className="text-encre-3" />
            <h1 className="mt-3 text-[24px] leading-tight font-bold">Cette enquête est terminée</h1>
            <p className="mt-2 text-[15px] leading-relaxed text-encre-2">
              Elle était ouverte jusqu'au {dateLongue(avis.expireLe)}. Merci de votre confiance.
            </p>
          </div>
          <LienSuivi surSuivi={surSuivi} />
        </div>
      </CadrePortail>
    );
  }

  const complet = note !== null && recommandation !== null;
  const trop = commentaire.length > LONGUEUR_COMMENTAIRE;
  return (
    <CadrePortail banque={avis.banque}>
      <form
        className="px-5 pt-6 pb-8"
        onSubmit={(e) => {
          e.preventDefault();
          if (!complet || trop) return;
          surEnvoyer?.({ note, recommandation, ...(commentaire.trim() ? { commentaire: commentaire.trim() } : {}) });
        }}
      >
        {entete}
        <h1 className="mt-1 text-[26px] leading-tight font-bold tracking-tight">Votre avis compte</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-encre-2">
          Votre réclamation est close. Deux questions, moins d'une minute : vous avez jusqu'au{' '}
          <span className="font-semibold">{dateLongue(avis.expireLe)}</span>.
        </p>

        {erreur && (
          <p role="alert" className="mt-5 rounded-xl border border-urgent/30 bg-urgent-doux px-4 py-3 text-[15px] font-semibold text-urgent">
            {erreur}
          </p>
        )}

        <div className="mt-7 flex flex-col gap-8">
          <div>
            <Echelle
              nom="note"
              legende="Êtes-vous satisfait du traitement de votre réclamation ?"
              min={1}
              max={5}
              valeur={note}
              surChoix={setNote}
              accessible={(n) => `${n} sur 5, ${NOTE_SATISFACTION[n]!.toLowerCase()}`}
              bornes={['1 : pas du tout satisfait', '5 : très satisfait']}
              colonnes="grid-cols-5"
            />
            <p aria-live="polite" className="mt-1.5 min-h-6 text-[15px] font-semibold text-marque-texte">
              {note !== null ? NOTE_SATISFACTION[note] : ''}
            </p>
          </div>

          <Echelle
            nom="recommandation"
            legende={`Recommanderiez-vous ${avis.banque.nom} à un proche ?`}
            min={0}
            max={10}
            valeur={recommandation}
            surChoix={setRecommandation}
            accessible={(n) => `${n} sur 10`}
            bornes={['0 : pas du tout', '10 : certainement']}
            colonnes="grid-cols-6"
          />

          <div className="flex flex-col gap-1.5">
            <label htmlFor="commentaire-avis" className="text-[15px] font-semibold">
              Un commentaire ?<span className="ml-1.5 font-normal text-encre-3">(facultatif)</span>
            </label>
            <Texte
              id="commentaire-avis"
              rows={3}
              value={commentaire}
              invalide={trop}
              onChange={(e) => setCommentaire(e.target.value)}
              placeholder="Ce qui vous a plu, ce que la banque peut améliorer"
              aria-describedby="commentaire-avis-aide"
            />
            <p id="commentaire-avis-aide" className={cx('text-right text-sm', trop ? 'font-semibold text-urgent' : 'text-encre-3')}>
              <span className="chiffres">{commentaire.length}</span> / {LONGUEUR_COMMENTAIRE}
            </p>
          </div>
        </div>

        <Bouton type="submit" variante="principal" taille="grand" className="mt-6 w-full" disabled={!complet || trop || occupe} data-visite="envoyer-avis">
          {occupe ? 'Envoi…' : 'Envoyer mon avis'}
        </Bouton>
        <p className="mt-3 text-center text-sm leading-relaxed text-encre-3">Une fois envoyé, votre avis ne peut plus être modifié.</p>
        <LienSuivi surSuivi={surSuivi} />
      </form>
    </CadrePortail>
  );
}

/** Invitation à donner son avis, sur le suivi et dans l'espace client. */
export function InvitationAvis({ avis, surAvis }: { avis: { etat: S<'EtatAvis'>; expireLe: string }; surAvis?: () => void }) {
  if (avis.etat === 'TERMINE') return null;
  if (avis.etat === 'DONNE') {
    return (
      <p className="mt-6 flex items-center gap-2.5 rounded-2xl bg-resolue-doux/70 px-4 py-3 text-[15px] text-encre-2">
        <CircleCheck aria-hidden size={19} className="shrink-0 text-resolue" />
        Merci, votre avis a bien été transmis à la banque.
      </p>
    );
  }
  return (
    <section className="mt-6 rounded-2xl border-2 border-marque-trait bg-marque-doux p-5" aria-labelledby="invitation-avis">
      <h2 id="invitation-avis" className="text-lg font-bold">Votre avis sur le traitement</h2>
      <p className="mt-1.5 text-[15px] leading-relaxed text-encre-2">
        Deux questions, moins d'une minute, jusqu'au <span className="font-semibold">{dateLongue(avis.expireLe)}</span>.
      </p>
      <Bouton variante="principal" taille="grand" className="mt-4 w-full" onClick={surAvis} data-visite="donner-avis">
        Donner mon avis
      </Bouton>
    </section>
  );
}
