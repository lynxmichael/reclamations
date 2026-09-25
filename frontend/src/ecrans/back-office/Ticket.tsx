/**
 * Fiche d'une réclamation (lireReclamation). Tout bouton vient de actionsPossibles et
 * operationsPossibles, calculés par l'API avec la machine d'états : l'interface n'a pas de
 * règle de droits à elle (décision E4).
 */
import { useState } from 'react';
import type { ReactNode } from 'react';
import {
  ArrowUpRight, ChevronLeft, CircleCheck, Eye, Flame, Globe, LockKeyhole, Mail, Paperclip, Phone, QrCode, SendHorizontal, UserRound, X,
} from 'lucide-react';
import type { S } from '../../api/types';
import { Avatar, BadgeStatut, BadgeUrgent, Bouton, Liste, Panneau, Texte, cx } from '../../ui/composants';
import { dateCourte, dateHeure } from '../../ui/format';
import { JaugeFiche } from '../../ui/JaugeSla';
import { CANAL, EVENEMENT, MOTIF_CLOTURE } from '../../ui/libelles';
import { PieceJointe } from '../portail/MaReclamation';

export type Fenetre = 'aucune' | 'resoudre' | 'cloturer';

function Message({ m, nomClient }: { m: S<'ReclamationDetail'>['messages'][number]; nomClient: string }) {
  const note = m.type === 'NOTE_INTERNE';
  const client = m.type === 'MESSAGE_DU_CLIENT';
  const auteur = m.auteur.nom ?? (client ? nomClient : 'Système');
  return (
    <li className={cx('rounded-xl border p-4', note ? 'border-attente/25 bg-attente-doux/70' : client ? 'border-trait bg-surface' : 'border-trait border-l-4 border-l-marque bg-surface')}>
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm">
        <Avatar nom={auteur} taille={26} ton={client ? 'client' : 'neutre'} />
        <span className="font-semibold text-encre">{auteur}</span>
        {note ? (
          <span className="inline-flex items-center gap-1 font-semibold text-attente">
            <LockKeyhole aria-hidden size={13} />
            Note interne, invisible du client
          </span>
        ) : (
          <span className="text-encre-3">{client ? 'client, a écrit' : 'a répondu au client'}</span>
        )}
        <span className="chiffres ml-auto text-encre-3">{dateCourte(m.creeLe)}</span>
      </div>
      <p className="mt-2.5 text-[15px] leading-relaxed text-encre">{m.contenu}</p>
      {m.piecesJointes.length > 0 && (
        <div className="mt-3 flex max-w-sm flex-col gap-2">
          {m.piecesJointes.map((p) => <PieceJointe key={p.id} piece={p} />)}
        </div>
      )}
    </li>
  );
}

function Redaction({ r }: { r: S<'ReclamationDetail'> }) {
  const peutRepondre = r.operationsPossibles.includes('REPONDRE_AU_CLIENT');
  const peutNoter = r.operationsPossibles.includes('NOTE_INTERNE');
  const peutQuestionner = r.actionsPossibles.includes('QUESTIONNER_CLIENT');
  const [mode, setMode] = useState<'reponse' | 'note'>(peutRepondre ? 'reponse' : 'note');
  if (!peutRepondre && !peutNoter) return null;
  const note = mode === 'note';
  return (
    <div className={cx('rounded-xl border', note ? 'border-attente/35 bg-attente-doux/50' : 'border-trait-fort bg-surface')}>
      <div role="tablist" className="flex gap-1 border-b border-inherit px-3 pt-2">
        {peutRepondre && (
          <button type="button" role="tab" aria-selected={!note} onClick={() => setMode('reponse')} className={cx('-mb-px border-b-[3px] px-2.5 py-2 text-[15px] font-semibold', !note ? 'border-marque text-encre' : 'border-transparent text-encre-3')}>
            Répondre au client
          </button>
        )}
        {peutNoter && (
          <button type="button" role="tab" aria-selected={note} onClick={() => setMode('note')} className={cx('-mb-px inline-flex items-center gap-1.5 border-b-[3px] px-2.5 py-2 text-[15px] font-semibold', note ? 'border-attente text-attente' : 'border-transparent text-encre-3')}>
            <LockKeyhole aria-hidden size={14} />
            Note interne
          </button>
        )}
      </div>
      <div className="p-4">
        <label htmlFor="redaction" className="sr-only">{note ? 'Note interne' : 'Réponse au client'}</label>
        <Texte
          id="redaction"
          rows={4}
          className={note ? 'border-attente/35 bg-surface' : undefined}
          placeholder={note ? 'Visible seulement par l\'équipe de la banque' : `Votre réponse à ${r.client.nom}, envoyée par e-mail et SMS`}
        />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Bouton variante="discret" taille="petit" icone={<Paperclip aria-hidden size={15} />}>Joindre un fichier</Bouton>
          {!note && peutQuestionner && (
            <label className="inline-flex items-center gap-2 text-sm text-encre-2">
              <input type="checkbox" className="h-4 w-4 accent-[var(--marque)]" />
              Attendre la réponse du client <span className="text-encre-3">(le chrono SLA se met en pause)</span>
            </label>
          )}
          <Bouton variante={note ? 'secondaire' : 'principal'} className="ml-auto" icone={<SendHorizontal aria-hidden size={16} />}>
            {note ? 'Ajouter la note' : 'Envoyer au client'}
          </Bouton>
        </div>
      </div>
    </div>
  );
}

function Info({ libelle, children }: { libelle: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-2.5">
      <dt className="text-[13px] text-encre-3">{libelle}</dt>
      <dd className="text-[15px] text-encre">{children}</dd>
    </div>
  );
}

function Dialogue({ titre, children, surFermer }: { titre: string; children: ReactNode; surFermer?: () => void }) {
  return (
    <div className="absolute inset-0 z-30 flex items-start justify-center bg-encre/35 pt-24">
      <div role="dialog" aria-modal="true" aria-label={titre} className="w-[520px] rounded-2xl bg-surface p-6 shadow-[0_24px_64px_rgb(23_33_43/0.28)]">
        <div className="flex items-start justify-between">
          <h2 className="text-xl font-bold">{titre}</h2>
          <button type="button" aria-label="Fermer" onClick={surFermer} className="rounded p-1 text-encre-3 hover:bg-fond">
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Ticket({
  r,
  agents,
  fenetre = 'aucune',
  delaiClotureJours,
  seuil,
}: {
  r: S<'ReclamationDetail'>;
  /** Agents actifs proposés à l'assignation (listerUtilisateurs), pour le superviseur */
  agents: S<'ReferenceNommee'>[];
  fenetre?: Fenetre;
  delaiClotureJours: number;
  seuil: number;
}) {
  const [ouverte, setOuverte] = useState<Fenetre>(fenetre);
  const a = (x: S<'ActionStatut'>) => r.actionsPossibles.includes(x);
  const o = (x: S<'OperationTicket'>) => r.operationsPossibles.includes(x);
  const lectureSeule = r.actionsPossibles.length === 0 && r.operationsPossibles.every((x) => x === 'CONSULTER');

  return (
    <div className="flex flex-col gap-5">
      <a href="#files" className="-ml-1 inline-flex w-fit items-center gap-1 text-[15px] font-semibold text-encre-2 hover:text-encre">
        <ChevronLeft aria-hidden size={18} />
        Réclamations
      </a>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="chiffres text-[28px] leading-tight font-bold tracking-wide">{r.numero}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <BadgeStatut statut={r.statut} grand />
            <BadgeUrgent priorite={r.priorite} />
            {r.escaladeeVers && (
              <span className="inline-flex items-center gap-1 rounded-md bg-en-cours-doux px-2 py-0.5 text-[13px] font-semibold text-en-cours">
                <ArrowUpRight aria-hidden size={14} />
                Escaladée vers {r.escaladeeVers.nom}
              </span>
            )}
            <span className="text-[15px] text-encre-2">{r.categorie.nom}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {o('CHANGER_PRIORITE') && (
            <Bouton icone={<Flame aria-hidden size={16} />}>{r.priorite === 'URGENTE' ? 'Repasser en normal' : 'Passer en urgent'}</Bouton>
          )}
          {o('ESCALADER') && <Bouton icone={<ArrowUpRight aria-hidden size={16} />}>Escalader</Bouton>}
          {a('CLOTURER_DE_FORCE') && (
            <Bouton variante="danger" onClick={() => setOuverte('cloturer')}>Clôturer de force</Bouton>
          )}
          {a('PRENDRE_EN_CHARGE') && <Bouton variante="principal">Prendre en charge</Bouton>}
          {a('RESOUDRE') && (
            <Bouton variante="principal" icone={<CircleCheck aria-hidden size={17} />} onClick={() => setOuverte('resoudre')}>
              Résoudre
            </Bouton>
          )}
        </div>
      </div>

      {lectureSeule && (
        <p className="flex items-center gap-2.5 rounded-xl border border-trait bg-surface px-4 py-3 text-[15px] text-encre-2">
          <Eye aria-hidden size={18} className="shrink-0 text-encre-3" />
          Vous consultez cette réclamation. Son traitement revient à l'agent assigné et aux superviseurs.
        </p>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)_340px] items-start gap-5">
        <div className="flex min-w-0 flex-col gap-5">
          <Panneau>
            <JaugeFiche
              c={r.sla}
              echeanceLe={r.sla.echeanceLe}
              alertePreventiveLe={r.sla.alertePreventiveLe}
              enPauseDepuis={r.sla.enPauseDepuis}
              respecte={r.sla.respecte}
              seuil={seuil}
            />
          </Panneau>

          <Panneau titre="Réclamation du client">
            <p className="text-[15px] leading-relaxed">{r.description}</p>
            {r.piecesJointes.length > 0 && (
              <div className="mt-3 flex max-w-sm flex-col gap-2">
                {r.piecesJointes.map((p) => <PieceJointe key={p.id} piece={p} />)}
              </div>
            )}
          </Panneau>

          <section className="flex flex-col gap-3">
            <h2 className="text-[17px] font-bold">Échanges et notes</h2>
            <ol className="flex flex-col gap-3">
              {r.messages.map((m) => <Message key={m.id} m={m} nomClient={r.client.nom} />)}
            </ol>
            <Redaction r={r} />
          </section>
        </div>

        <aside className="flex flex-col gap-5">
          <Panneau titre="Client">
            <dl className="-my-2.5 divide-y divide-trait">
              <Info libelle="Nom">
                <span className="inline-flex items-center gap-2"><UserRound aria-hidden size={16} className="text-encre-3" />{r.client.nom}</span>
              </Info>
              {r.client.telephone && (
                <Info libelle="Téléphone">
                  <span className="chiffres inline-flex items-center gap-2"><Phone aria-hidden size={16} className="text-encre-3" />{r.client.telephone.replace(/^\+225(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/, '+225 $1 $2 $3 $4 $5')}</span>
                </Info>
              )}
              {r.client.email && (
                <Info libelle="E-mail">
                  <span className="inline-flex items-center gap-2 break-all"><Mail aria-hidden size={16} className="shrink-0 text-encre-3" />{r.client.email}</span>
                </Info>
              )}
            </dl>
          </Panneau>

          <Panneau titre="Traitement">
            <dl className="-my-2.5 divide-y divide-trait">
              <Info libelle="Agent assigné">
                {o('ASSIGNER') ? (
                  <Liste defaultValue={r.agent?.id ?? ''} aria-label="Agent assigné" className="mt-1 h-10">
                    <option value="">Non assignée</option>
                    {agents.map((ag) => (
                      <option key={ag.id} value={ag.id}>{ag.nom}</option>
                    ))}
                  </Liste>
                ) : (
                  <span className="inline-flex items-center gap-2">
                    {r.agent && <Avatar nom={r.agent.nom} taille={24} />}
                    {r.agent?.nom ?? 'Non assignée'}
                  </span>
                )}
              </Info>
              <Info libelle="Dépôt">
                <span className="inline-flex items-center gap-2">
                  {r.canal === 'QR_CODE' ? <QrCode aria-hidden size={16} className="text-encre-3" /> : <Globe aria-hidden size={16} className="text-encre-3" />}
                  {CANAL[r.canal]}, {r.pointDepot.libelle.toLowerCase()}
                </span>
              </Info>
              <Info libelle="Agence">{r.agence?.nom ?? 'Aucune'}</Info>
              <Info libelle="Déposée le"><span className="chiffres">{dateHeure(r.creeLe)}</span></Info>
              <Info libelle="Première réponse"><span className="chiffres">{r.jalons.premiereReponseLe ? dateHeure(r.jalons.premiereReponseLe) : 'Pas encore'}</span></Info>
              {r.nbReouvertures > 0 && <Info libelle="Réouvertures">{r.nbReouvertures}</Info>}
            </dl>
          </Panneau>

          <Panneau titre="Chronologie">
            <ol className="flex flex-col gap-3.5">
              {[...r.chronologie].reverse().map((e, i) => (
                <li key={i} className="flex gap-3 text-sm">
                  <span aria-hidden className={cx('mt-1.5 h-2 w-2 shrink-0 rounded-full', e.visibleClient ? 'bg-marque' : 'bg-trait-fort')} />
                  <div>
                    <p className="font-semibold text-encre">
                      {EVENEMENT[e.type]}
                      {!e.visibleClient && <span className="ml-1.5 font-normal text-encre-3">(interne)</span>}
                    </p>
                    <p className="text-encre-3">
                      <span className="chiffres">{dateCourte(e.date)}</span>, {e.acteur.nom ?? (e.acteur.type === 'CLIENT' ? 'le client' : 'le système')}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </Panneau>
        </aside>
      </div>

      {ouverte === 'resoudre' && a('RESOUDRE') && (
        <Dialogue titre="Résoudre la réclamation" surFermer={() => setOuverte('aucune')}>
          <p className="mt-2 text-[15px] leading-relaxed text-encre-2">
            Votre réponse finale part au client par e-mail et SMS. Il pourra confirmer ou contester pendant {delaiClotureJours} jours ; sans réponse, la réclamation sera clôturée.
          </p>
          <label htmlFor="finale" className="mt-5 block text-[15px] font-semibold">Réponse finale au client</label>
          <Texte
            id="finale"
            rows={5}
            className="mt-1.5"
            defaultValue="Bonjour M. Kouassi, le distributeur n'a pas délivré les billets lors de votre retrait du 23/09. Les 50 000 FCFA ont été recrédités sur votre compte ce jour. Nous vous prions de nous excuser pour ce désagrément."
          />
          <div className="mt-5 flex justify-end gap-2">
            <Bouton variante="discret" onClick={() => setOuverte('aucune')}>Annuler</Bouton>
            <Bouton variante="principal" icone={<CircleCheck aria-hidden size={17} />}>Résoudre et envoyer</Bouton>
          </div>
        </Dialogue>
      )}

      {ouverte === 'cloturer' && a('CLOTURER_DE_FORCE') && (
        <Dialogue titre="Clôturer de force" surFermer={() => setOuverte('aucune')}>
          <p className="mt-2 text-[15px] leading-relaxed text-encre-2">
            La réclamation sera clôturée sans l'accord du client, qui en sera informé. Cette action est inscrite au journal d'audit.
          </p>
          <fieldset className="mt-5">
            <legend className="text-[15px] font-semibold">Motif</legend>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {(Object.keys(MOTIF_CLOTURE) as S<'MotifClotureForcee'>[]).map((m, i) => (
                <label key={m} className={cx('flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2.5 text-[15px]', i === 0 ? 'border-urgent/50 bg-urgent-doux/50 font-semibold' : 'border-trait-fort')}>
                  <input type="radio" name="motif" defaultChecked={i === 0} className="h-4 w-4 accent-[var(--color-urgent)]" />
                  {MOTIF_CLOTURE[m]}
                </label>
              ))}
            </div>
          </fieldset>
          <label htmlFor="precision" className="mt-4 block text-[15px] font-semibold">Précision</label>
          <Texte id="precision" rows={2} className="mt-1.5 min-h-0" defaultValue="Même réclamation que ALP-2026-002436, déposée la veille par le client." />
          <div className="mt-5 flex justify-end gap-2">
            <Bouton variante="discret" onClick={() => setOuverte('aucune')}>Annuler</Bouton>
            <Bouton variante="danger" className="!bg-urgent !text-white">Clôturer la réclamation</Bouton>
          </div>
        </Dialogue>
      )}
    </div>
  );
}
