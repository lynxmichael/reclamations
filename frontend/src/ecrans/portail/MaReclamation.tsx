/**
 * Détail d'une réclamation dans l'espace client (lireMaReclamation). Les boutons viennent de
 * actionsPossibles (CONFIRMER, CONTESTER) et la zone de réponse de operationsPossibles
 * (MESSAGE_DU_CLIENT) : l'écran n'applique aucune règle métier lui-même.
 */
import { useContext, useState } from 'react';
import { ChevronLeft, Download, FileText, Image, SendHorizontal } from 'lucide-react';
import type { S } from '../../api/types';
import { ChoixFichiers } from '../../ui/ChoixFichiers';
import { BadgeStatut, Bouton, LogoBanque, Texte, cx } from '../../ui/composants';
import { TelechargerPiece } from '../../ui/contextes';
import { date, dateCourte, dateLongue, octets } from '../../ui/format';
import { CadrePortail } from './CadrePortail';
import { Etapes } from './Etapes';
import { Deconnexion } from './MesReclamations';

export function PieceJointe({ piece, surFond }: { piece: S<'PieceJointe'>; surFond?: boolean }) {
  const telecharger = useContext(TelechargerPiece);
  const Icone = piece.typeMime.startsWith('image/') ? Image : FileText;
  const classes = cx('flex w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-left text-sm hover:border-encre-3', surFond ? 'border-black/10 bg-white/70' : 'border-trait bg-fond');
  const contenu = (
    <>
      <Icone aria-hidden size={18} className="shrink-0 text-encre-3" />
      <span className="min-w-0 flex-1 truncate font-semibold text-encre">{piece.nomFichier}</span>
      <span className="chiffres shrink-0 text-encre-3">{octets(piece.tailleOctets)}</span>
      {telecharger && <Download aria-hidden size={16} className="shrink-0 text-encre-3" />}
    </>
  );
  if (telecharger) {
    return (
      <button type="button" onClick={() => telecharger(piece)} className={classes} aria-label={`Télécharger ${piece.nomFichier}`}>
        {contenu}
      </button>
    );
  }
  return (
    <a href={`#${piece.id}`} className={classes}>
      {contenu}
    </a>
  );
}

export function MaReclamation({
  banque,
  reclamation: r,
  surRetour,
  surQuitter,
  surConfirmer,
  surContester,
  surEnvoyer,
  occupe,
}: {
  banque: S<'BanquePublique'>;
  reclamation: S<'ReclamationClient'>;
  surRetour?: () => void;
  surQuitter?: () => void;
  surConfirmer?: () => void;
  surContester?: (motif: string) => void;
  /** Renvoie false (ou une promesse de false) si l'envoi a échoué : le texte est alors conservé */
  surEnvoyer?: (texte: string, fichiers: File[]) => void | boolean | Promise<boolean>;
  /** Une action est en cours d'envoi : les boutons attendent */
  occupe?: boolean;
}) {
  const [contestation, setContestation] = useState(false);
  const [motif, setMotif] = useState('');
  const [texte, setTexte] = useState('');
  const [fichiers, setFichiers] = useState<File[]>([]);
  const peutEcrire = r.operationsPossibles.includes('MESSAGE_DU_CLIENT');
  const peutConfirmer = r.actionsPossibles.includes('CONFIRMER');
  const peutContester = r.actionsPossibles.includes('CONTESTER');

  return (
    <CadrePortail banque={banque} action={<Deconnexion surQuitter={surQuitter} />}>
      <div className="px-5 pt-5 pb-10">
        <a
          href="#liste"
          onClick={(e) => {
            if (surRetour) {
              e.preventDefault();
              surRetour();
            }
          }}
          className="-ml-1.5 inline-flex items-center gap-1 rounded py-1 pr-2 text-[15px] font-semibold text-marque-texte"
        >
          <ChevronLeft aria-hidden size={18} />
          Vos réclamations
        </a>
        <h1 className="chiffres mt-3 text-[26px] leading-tight font-bold tracking-wide">{r.numero}</h1>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
          <BadgeStatut statut={r.statut} pourClient grand />
          <span className="text-[15px] text-encre-2">{r.categorie}</span>
        </div>

        {(peutConfirmer || peutContester) && (
          <section className="mt-6 rounded-2xl border-2 border-resolue/35 bg-resolue-doux/60 p-5">
            <h2 className="text-lg font-bold">La banque a résolu votre réclamation</h2>
            <p className="mt-1.5 text-[15px] leading-relaxed text-encre-2">Lisez sa réponse ci-dessous. La solution vous convient-elle ?</p>
            <div className="mt-4 flex flex-col gap-2.5">
              {peutConfirmer && !contestation && (
                <Bouton variante="principal" taille="grand" className="w-full" onClick={surConfirmer} disabled={occupe} data-visite="confirmer">
                  Oui, clôturer ma réclamation
                </Bouton>
              )}
              {peutContester && !contestation && (
                <Bouton variante="secondaire" taille="grand" className="w-full" onClick={() => setContestation(true)}>
                  Non, je conteste
                </Bouton>
              )}
              {contestation && (
                <form
                  className="flex flex-col gap-2.5"
                  onSubmit={(e) => {
                    e.preventDefault();
                    surContester?.(motif);
                  }}
                >
                  <label htmlFor="motif-contestation" className="text-[15px] font-semibold">
                    Qu'est-ce qui ne vous convient pas ?
                  </label>
                  <Texte id="motif-contestation" rows={3} value={motif} onChange={(e) => setMotif(e.target.value)} placeholder="Par exemple : le montant n'a été recrédité qu'en partie." />
                  <div className="flex gap-2">
                    <Bouton variante="discret" onClick={() => setContestation(false)}>
                      Annuler
                    </Bouton>
                    <Bouton type="submit" variante="principal" className="flex-1" disabled={!motif.trim() || occupe}>
                      Envoyer ma contestation
                    </Bouton>
                  </div>
                </form>
              )}
            </div>
            {r.clotureAutoPrevueLe && (
              <p className="mt-4 text-sm leading-relaxed text-encre-2">
                Sans réponse de votre part, elle sera clôturée le <span className="font-semibold">{dateLongue(r.clotureAutoPrevueLe)}</span>.
              </p>
            )}
          </section>
        )}

        <section className="mt-7">
          <h2 className="text-lg font-bold">Votre réclamation</h2>
          <p className="mt-1 text-sm text-encre-3">Déposée le {date(r.creeLe)}</p>
          <p className="mt-3 text-[15px] leading-relaxed whitespace-pre-line text-encre">{r.description}</p>
          {r.piecesJointes.length > 0 && (
            <div className="mt-3 flex flex-col gap-2">
              {r.piecesJointes.map((p) => <PieceJointe key={p.id} piece={p} />)}
            </div>
          )}
        </section>

        <section className="mt-8">
          <h2 className="text-lg font-bold">Échanges</h2>
          {r.messages.length === 0 ? (
            <p className="mt-2 text-[15px] text-encre-3">Aucun message pour l'instant. La réponse de la banque apparaîtra ici.</p>
          ) : (
            <ol className="mt-4 flex flex-col gap-4">
              {r.messages.map((m) => {
                const banqueParle = m.auteur === 'BANQUE';
                return (
                  <li key={m.id} className={cx('flex flex-col gap-1.5', banqueParle ? 'items-start pr-6' : 'items-end pl-6')}>
                    <div className="flex items-center gap-2 text-sm text-encre-3">
                      {banqueParle && <LogoBanque nom={banque.nom} logoUrl={banque.logoUrl} taille={20} />}
                      <span className="font-semibold text-encre-2">{banqueParle ? banque.nom : 'Vous'}</span>
                      <span className="chiffres">{dateCourte(m.creeLe)}</span>
                    </div>
                    <div className={cx('flex flex-col gap-2 rounded-2xl px-4 py-3 text-[15px] leading-relaxed', banqueParle ? 'rounded-tl-md bg-marque-doux' : 'rounded-tr-md bg-fond')}>
                      <p>{m.contenu}</p>
                      {m.piecesJointes.map((p) => <PieceJointe key={p.id} piece={p} surFond />)}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        {peutEcrire && (
          <form
            className="mt-6 rounded-2xl border border-trait p-4"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!texte.trim()) return;
              const envoye = await surEnvoyer?.(texte, fichiers);
              if (envoye !== false) {
                setTexte('');
                setFichiers([]);
              }
            }}
          >
            <label htmlFor="message" className="text-[15px] font-semibold">
              Écrire à la banque
            </label>
            <Texte id="message" className="mt-2" rows={3} placeholder="Votre message" value={texte} onChange={(e) => setTexte(e.target.value)} />
            <div className="mt-3 flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <ChoixFichiers fichiers={fichiers} surChangement={setFichiers} libelle="Joindre" compact />
              </div>
              <Bouton type="submit" variante="principal" icone={<SendHorizontal aria-hidden size={17} />} disabled={!texte.trim() || occupe}>
                {occupe ? 'Envoi…' : 'Envoyer'}
              </Bouton>
            </div>
          </form>
        )}

        <section className="mt-9">
          <h2 className="mb-4 text-lg font-bold">Historique</h2>
          <Etapes etapes={r.etapes} statut={r.statut} />
        </section>
      </div>
    </CadrePortail>
  );
}
