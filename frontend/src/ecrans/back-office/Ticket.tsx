/**
 * Fiche d'une réclamation (lireReclamation). Tout bouton vient de actionsPossibles et
 * operationsPossibles, calculés par l'API avec la machine d'états : l'interface n'a pas de
 * règle de droits à elle (décision E4).
 */
import { useState } from 'react';
import type { ReactNode } from 'react';
import {
  ArrowUpRight, Bot, ChevronLeft, CircleCheck, Combine, Copy, Eye, Flame, Link2, LockKeyhole, Mail, MailWarning, MessagesSquare, Phone, RotateCw, SendHorizontal, Sparkles, TriangleAlert, UserRound, X,
} from 'lucide-react';
import { LIBELLES_MOTIF } from '@domaine/envois';
import { LIBELLE_INTERDIT, verifierInterdits } from '@domaine/ia/interdits';
import type { S } from '../../api/types';
import { ChoixFichiers } from '../../ui/ChoixFichiers';
import { Avatar, BadgeStatut, BadgeUrgent, Bouton, Liste, Panneau, Texte, cx } from '../../ui/composants';
import { dateCourte, dateHeure, heure } from '../../ui/format';
import { JaugeFiche } from '../../ui/JaugeSla';
import { AideEnvoi, BadgeCanal, envoiDeLaReponse, IconeCanal, IconeDepot } from '../../ui/Canaux';
import { CANAL, CANAL_CONVERSATION, ETAT_AVIS, ETAT_ENVOI, EVENEMENT, MOTIF_CLOTURE, NOTE_SATISFACTION, STATUT } from '../../ui/libelles';
import { PieceJointe } from '../portail/MaReclamation';

export type Fenetre = 'aucune' | 'resoudre' | 'cloturer' | 'rattacher';

/** Résultat d'une action : false (ou une promesse de false) si elle a échoué, et la saisie est gardée. */
type Issue = void | boolean | Promise<boolean>;

/** Démo cliquable et application (étape 8) : chaque bouton de la fiche appelle une opération du contrat. */
export interface ActionsFiche {
  retour?: () => void;
  prendreEnCharge?: () => void;
  assigner?: (agentId: string) => void;
  repondre?: (contenu: string, attendreReponse: boolean, fichiers: File[]) => Issue;
  note?: (contenu: string, fichiers: File[]) => Issue;
  resoudre?: (contenu: string) => Issue;
  priorite?: () => void;
  escalader?: () => void;
  cloturer?: (motif: S<'MotifClotureForcee'>, precision: string) => Issue;
  /** Chat web (étape 17) : la conversation dans la boîte de réception */
  ouvrirConversation?: (conversationId: string) => void;
  /** Assistant IA (étape 18) : un brouillon de réponse, que l'agent relit et envoie lui-même (suggererReponse) */
  suggerer?: () => Promise<S<'SuggestionReponse'> | null>;
  /** Étape 21 : joindre ce doublon à une autre réclamation du même client, qui devient la principale */
  rattacher?: (principaleId: string) => Issue;
  /** Étape 21 : renvoyer au client le lien de son suivi, à ses seules coordonnées */
  renvoyerLien?: () => void;
  /** Étape 21 : ouvrir une autre réclamation (du même client, principale, doublon rattaché) */
  ouvrir?: (id: string) => void;
  /** Étape 22 : renvoyer au client un message non remis, tel quel, à la même coordonnée */
  renvoyerMessage?: (envoiId: string) => void;
  /** Une action est en cours : ses boutons attendent */
  occupe?: boolean;
}

/** Lien vers une autre réclamation : la fiche s'ouvre dans l'application, l'ancre suffit aux maquettes. */
function LienReclamation({ id, numero, actions }: { id: string; numero: string; actions?: ActionsFiche }) {
  return (
    <a
      href={`#${id}`}
      onClick={(e) => {
        if (actions?.ouvrir) {
          e.preventDefault();
          actions.ouvrir(id);
        }
      }}
      className="chiffres font-bold tracking-wide text-marque-texte underline-offset-2 hover:underline"
    >
      {numero}
    </a>
  );
}

/** Étape 21 : les autres réclamations du client, les plus récentes d'abord ; un agent n'ouvre que les siennes. */
function DuMemeClient({ autres, actions }: { autres: S<'ReclamationDetail'>['duMemeClient']; actions?: ActionsFiche }) {
  return (
    <Panneau titre="Du même client">
      <ul className="-my-2 divide-y divide-trait">
        {autres.map((d) => (
          <li key={d.id} className="py-2.5 text-sm">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {d.accessible ? <LienReclamation id={d.id} numero={d.numero} actions={actions} /> : <span className="chiffres font-bold tracking-wide text-encre-2">{d.numero}</span>}
              <BadgeStatut statut={d.statut} />
              {d.doublonPossible && (
                <span className="inline-flex items-center gap-0.5 rounded-md bg-attente-doux px-1.5 text-[13px] font-semibold text-attente">
                  <Copy aria-hidden size={12} strokeWidth={2.4} />
                  Doublon possible
                </span>
              )}
            </div>
            <p className="mt-0.5 text-encre-3">
              {d.categorie.nom}, <span className="chiffres">{dateCourte(d.creeLe)}</span>
              {d.agent ? `, ${d.agent.nom}` : ', non assignée'}
              {!d.accessible && ' (assignée à un autre agent)'}
            </p>
          </li>
        ))}
      </ul>
    </Panneau>
  );
}

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
          <span className="text-encre-3">
            {client ? 'client, a écrit' : 'a répondu au client'}
            {m.canal === 'WHATSAPP' ? ' sur WhatsApp' : m.canal === 'SMS' ? ' par SMS' : ''}
          </span>
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

/**
 * Brouillon de l'assistant IA (étape 18) : d'où il vient, ce qu'il suggère (catégorie, urgence), à titre
 * indicatif. Les interdits sont revérifiés à chaque frappe (domaine/ia/interdits, comme l'API) : l'agent
 * les voit disparaître en corrigeant. Rien n'est bloqué : l'agent décide (décision I4).
 */
function AideIa({ s, texte, r, actions }: { s: S<'SuggestionReponse'>; texte: string; r: S<'ReclamationDetail'>; actions?: ActionsFiche }) {
  const alertes = verifierInterdits(texte);
  return (
    <div className="mb-3 rounded-lg border border-marque/25 bg-marque-doux/60 px-3.5 py-3 text-sm" data-testid="aide-ia">
      <p className="flex items-center gap-1.5 font-semibold text-marque-texte">
        <Sparkles aria-hidden size={15} />
        {s.source === 'IA' ? 'Brouillon proposé par l\'assistant IA' : 'Brouillon type (assistant IA indisponible)'} : relisez-le, corrigez-le, puis envoyez-le vous-même.
      </p>
      {alertes.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-1" aria-label="À corriger avant l'envoi">
          {alertes.map((a) => (
            <li key={a.code} className="flex items-start gap-1.5 font-semibold text-urgent">
              <TriangleAlert aria-hidden size={15} className="mt-0.5 shrink-0" />
              <span>Le texte {LIBELLE_INTERDIT[a.code]} : « {a.extrait} ». À corriger avant l'envoi.</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1.5 text-encre-2">Aucune promesse, aucun statut annoncé, aucun conseil, aucune demande de code.</p>
      )}
      {(s.categorie || s.urgente) && (
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-encre-2">
          {s.categorie && <span>Catégorie qui conviendrait mieux : <strong className="text-encre">{s.categorie.nom}</strong></span>}
          {s.urgente && (
            <span className="inline-flex items-center gap-2">
              <span className="font-semibold text-urgent">Paraît urgente</span>
              {r.operationsPossibles.includes('CHANGER_PRIORITE') && r.priorite !== 'URGENTE' && (
                <Bouton taille="petit" icone={<Flame aria-hidden size={14} />} onClick={actions?.priorite} disabled={actions?.occupe}>Passer en urgent</Bouton>
              )}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function Redaction({ r, actions, suggestion, suggestionIa }: { r: S<'ReclamationDetail'>; actions?: ActionsFiche; suggestion?: string; suggestionIa?: S<'SuggestionReponse'> }) {
  const peutRepondre = r.operationsPossibles.includes('REPONDRE_AU_CLIENT');
  const peutNoter = r.operationsPossibles.includes('NOTE_INTERNE');
  // Depuis « Ouverte », répondre prend la réclamation en charge (S1) : la question reste possible ensuite
  const peutQuestionner = r.actionsPossibles.includes('QUESTIONNER_CLIENT') || (r.statut === 'OUVERTE' && peutRepondre);
  // Onglet choisi ; sans choix, la réponse quand elle devient possible (après une assignation)
  const [choix, setMode] = useState<'reponse' | 'note' | null>(null);
  const mode = peutRepondre ? (choix ?? 'reponse') : 'note';
  const [ia, setIa] = useState<S<'SuggestionReponse'> | null>(suggestionIa ?? null);
  const [texte, setTexte] = useState(suggestionIa?.brouillon ?? suggestion ?? '');
  const [attendre, setAttendre] = useState(false);
  const [fichiers, setFichiers] = useState<File[]>([]);
  const [prepare, setPrepare] = useState(false);
  const suggerer = async () => {
    if (!actions?.suggerer) return;
    setPrepare(true);
    try {
      const s = await actions.suggerer();
      if (s) {
        setIa(s);
        setTexte(s.brouillon);
      }
    } finally {
      setPrepare(false);
    }
  };
  if (!peutRepondre && !peutNoter) return null;
  const note = mode === 'note';
  // Répondre depuis « Ouverte » prend en charge : il faut d'abord un agent assigné
  const attendAgent = !peutRepondre && r.statut === 'OUVERTE' && !r.agent;
  // Étape 20 : WhatsApp dans les 24 h, SMS du numéro de la banque, sinon le suivi
  const envoi = note ? null : envoiDeLaReponse(r.conversation, r.client.nom, texte);
  return (
    <div className={cx('rounded-xl border', note ? 'border-attente/35 bg-attente-doux/50' : 'border-trait-fort bg-surface')}>
      <div className="flex items-end gap-2 border-b border-inherit pr-3">
      <div role="tablist" className="flex gap-1 px-3 pt-2">
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
        {!note && actions?.suggerer && (
          <Bouton taille="petit" variante="discret" className="mb-1.5 ml-auto" icone={<Sparkles aria-hidden size={15} />} onClick={() => void suggerer()} disabled={prepare || actions.occupe}>
            {prepare ? 'Rédaction…' : 'Suggérer une réponse'}
          </Bouton>
        )}
      </div>
      <div className="p-4">
        {!note && ia && <AideIa s={ia} texte={texte} r={r} actions={actions} />}
        <label htmlFor="redaction" className="sr-only">{note ? 'Note interne' : 'Réponse au client'}</label>
        <Texte
          id="redaction"
          rows={4}
          value={texte}
          onChange={(e) => setTexte(e.target.value)}
          data-visite="redaction"
          className={note ? 'border-attente/35 bg-surface' : undefined}
          placeholder={note
            ? 'Visible seulement par l\'équipe de la banque'
            : envoi
              ? envoi.invite
              : r.conversation
                ? `Votre réponse à ${r.client.nom}, dans son chat (e-mail ou SMS s'il ne la lit pas)`
                : `Votre réponse à ${r.client.nom}, envoyée par e-mail et SMS`}
        />
        <AideEnvoi aide={envoi} />
        <div className="mt-3 flex flex-wrap items-start gap-3">
          <div className="min-w-0 basis-full sm:basis-auto">
            <ChoixFichiers fichiers={fichiers} surChangement={setFichiers} libelle="Joindre un fichier" compact />
          </div>
          {!note && peutQuestionner && (
            <label className="inline-flex items-center gap-2 text-sm text-encre-2">
              <input type="checkbox" checked={attendre} onChange={(e) => setAttendre(e.target.checked)} className="h-4 w-4 accent-[var(--marque)]" />
              Attendre la réponse du client <span className="text-encre-3">(le chrono SLA se met en pause)</span>
            </label>
          )}
          <Bouton
            variante={note ? 'secondaire' : 'principal'}
            className="ml-auto"
            icone={<SendHorizontal aria-hidden size={16} />}
            disabled={!texte.trim() || actions?.occupe}
            data-visite="envoyer-reponse"
            onClick={async () => {
              const issue = await (note ? actions?.note?.(texte, fichiers) : actions?.repondre?.(texte, attendre, fichiers));
              if (issue === false) return;
              setTexte('');
              setAttendre(false);
              setFichiers([]);
              setIa(null);
            }}
          >
            {actions?.occupe ? 'Envoi…' : note ? 'Ajouter la note' : 'Envoyer au client'}
          </Bouton>
        </div>
        {attendAgent && <p className="mt-3 text-sm text-encre-3">Pour répondre au client, assignez d'abord la réclamation à un agent.</p>}
      </div>
    </div>
  );
}

/**
 * Conversation : chat du portail (étape 17), WhatsApp ou SMS (étape 20) ; présence, réponse attendue,
 * et par où partira la réponse.
 */
function ChatClient({ c, actions }: { c: NonNullable<S<'ReclamationDetail'>['conversation']>; actions?: ActionsFiche }) {
  const web = c.canal === 'WEB';
  return (
    <Panneau titre={web ? 'Chat web' : 'Conversation'}>
      {web ? (
        <p className="flex items-center gap-2 text-[15px] text-encre-2">
          <span aria-hidden className={cx('h-2.5 w-2.5 shrink-0 rounded-full', c.clientEnLigne ? 'bg-resolue' : 'bg-trait-fort')} />
          {c.clientEnLigne ? 'Le client est en ligne' : c.luParLeClientLe ? `Vu par le client ${dateCourte(c.luParLeClientLe)}` : 'Le client n\'a pas encore ouvert le chat'}
        </p>
      ) : (
        <p className="flex flex-wrap items-center gap-2 text-[15px] text-encre-2">
          <BadgeCanal canal={c.canal} />
          {c.reponseVers.canal === c.canal
            ? `Le client écrit ${c.canal === 'SMS' ? 'par SMS' : 'sur WhatsApp'} : la réponse y part.`
            : `Dernier message sur ${CANAL_CONVERSATION[c.canal]} il y a plus de 24 h : la réponse reste dans son suivi.`}
        </p>
      )}
      {c.aRepondre && <p className="mt-2 text-[15px] font-semibold text-marque-texte">Il attend une réponse{c.nonLue ? ' (message non lu)' : ''}.</p>}
      <Bouton className="mt-3 w-full" icone={<MessagesSquare aria-hidden size={16} />} onClick={() => actions?.ouvrirConversation?.(c.id)}>
        Ouvrir la conversation
      </Bouton>
    </Panneau>
  );
}

type Envoi = S<'ReclamationDetail'>['envois'][number];

const TON_ENVOI: Record<S<'EtatEnvoi'>, string> = {
  EN_ATTENTE: 'bg-fond text-encre-2',
  NOUVEL_ESSAI: 'bg-attente-doux text-attente',
  ENVOYE: 'bg-fond text-encre-2',
  REMIS: 'bg-resolue-doux text-resolue',
  LU: 'bg-resolue-doux text-resolue',
  NON_REMIS: 'bg-urgent-doux text-urgent',
};

function canalEnvoi(c: Envoi['canal']): string {
  return c === 'EMAIL' ? 'E-mail' : c === 'SMS' ? 'SMS' : 'WhatsApp';
}

/** Le détail d'un message au client : où il en est, et pourquoi il n'est pas arrivé. */
function detailEnvoi(e: Envoi): string {
  switch (e.etat) {
    case 'NON_REMIS': return `${LIBELLES_MOTIF[e.motif ?? 'ERREUR_TECHNIQUE']}${e.tentatives > 1 ? `, ${e.tentatives} essais` : ''}`;
    case 'NOUVEL_ESSAI': return e.prochaineTentativeLe ? `essai ${e.tentatives + 1} à ${heure(e.prochaineTentativeLe)}` : `essai ${e.tentatives + 1} prévu`;
    case 'REMIS': case 'LU': return e.remiseLe ? `${e.etat === 'LU' ? 'lu' : 'remis'} ${dateCourte(e.remiseLe)}` : '';
    case 'ENVOYE': return e.canal === 'EMAIL' ? 'accepté par le serveur d\'envoi' : 'en attente de l\'accusé de remise';
    default: return '';
  }
}

/**
 * Étape 22 : les messages envoyés au client (accusé, statuts, réponses…), leur coordonnée masquée et
 * leur état, jamais leur texte. Les plus récents d'abord ; les six premiers, puis tous sur demande.
 */
function MessagesAuClient({ envois, actions }: { envois: Envoi[]; actions?: ActionsFiche }) {
  const [tous, setTous] = useState(false);
  const visibles = tous ? envois : envois.slice(0, 6);
  return (
    <Panneau titre="Messages au client">
      {envois.length === 0 ? (
        <p className="text-sm text-encre-3">Aucun message envoyé au client pour l'instant.</p>
      ) : (
        <>
          <ul className="-my-2 divide-y divide-trait" data-testid="envois">
            {visibles.map((e) => (
              <li key={e.id} className="py-2.5 text-sm" data-etat={e.etat}>
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 text-encre-3">{e.canal === 'EMAIL' ? <Mail aria-hidden size={15} /> : <IconeCanal canal={e.canal} taille={15} />}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="font-semibold text-encre">{e.objet}</span>
                      <span className={cx('rounded-md px-1.5 text-[12px] font-semibold', TON_ENVOI[e.etat])}>{ETAT_ENVOI[e.etat]}</span>
                    </div>
                    <p className="text-encre-3">
                      {canalEnvoi(e.canal)} <span className="chiffres whitespace-nowrap">{e.destinationMasquee}</span>, <span className="chiffres whitespace-nowrap">{dateCourte(e.envoyeLe ?? e.creeLe)}</span>
                    </p>
                    {detailEnvoi(e) && <p className={cx(e.etat === 'NON_REMIS' ? 'font-semibold text-urgent' : 'text-encre-3')}>{detailEnvoi(e)}</p>}
                    {e.renvoyable && (
                      <Bouton taille="petit" className="mt-2" icone={<RotateCw aria-hidden size={14} />} disabled={actions?.occupe} onClick={() => actions?.renvoyerMessage?.(e.id)} aria-label={`Renvoyer « ${e.objet} » par ${canalEnvoi(e.canal)}`}>
                        Renvoyer
                      </Bouton>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
          {envois.length > 6 && (
            <button type="button" onClick={() => setTous(!tous)} className="mt-3 text-sm font-semibold text-marque-texte hover:underline">
              {tous ? 'Voir les six derniers' : `Voir les ${envois.length} messages`}
            </button>
          )}
          <p className="mt-3 border-t border-trait pt-3 text-[13px] leading-snug text-encre-3">
            Les SMS non remis sont réessayés 1, 5, 30 puis 120 minutes après. Un e-mail « Envoyé » a été accepté par le serveur d'envoi : il n'a pas d'accusé de remise.
          </p>
        </>
      )}
    </Panneau>
  );
}

/** Étape 22 : un message non remis que rien n'a remplacé, et que l'utilisateur peut renvoyer. */
function AlerteNonRemis({ e, actions }: { e: Envoi; actions?: ActionsFiche }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-urgent/30 bg-urgent-doux/60 px-4 py-3" data-testid="alerte-non-remis">
      <MailWarning aria-hidden size={18} className="shrink-0 text-urgent" />
      <p className="min-w-0 flex-1 text-[15px] leading-snug text-encre-2">
        <span className="font-semibold text-encre">Message non remis au client.</span>{' '}
        « {e.objet} » n'a pas pu être remis par {canalEnvoi(e.canal)} au <span className="chiffres">{e.destinationMasquee}</span> ({LIBELLES_MOTIF[e.motif ?? 'ERREUR_TECHNIQUE']}).
        Renvoyez-le, ou joignez le client autrement (appel, agence).
      </p>
      <Bouton taille="petit" icone={<RotateCw aria-hidden size={14} />} disabled={actions?.occupe} onClick={() => actions?.renvoyerMessage?.(e.id)}>Renvoyer</Bouton>
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

/** Mode suggestion (étape 16) : l'agent proposé ; le superviseur valide en un clic, ou choisit un autre agent. */
function Suggestion({ s, actions }: { s: NonNullable<S<'ReclamationDetail'>['attributionSuggeree']>; actions?: ActionsFiche }) {
  return (
    <section aria-labelledby="suggestion-titre" className="rounded-xl border border-dashed border-marque bg-marque-doux/60 p-4">
      <h2 id="suggestion-titre" className="flex items-center gap-2 text-[15px] font-bold">
        <Sparkles aria-hidden size={16} className="text-marque-texte" />
        Attribution suggérée
      </h2>
      <p className="mt-2 flex items-center gap-2 text-[15px] font-semibold">
        <Avatar nom={s.agent.nom} taille={26} ton="marque" />
        {s.agent.nom}
      </p>
      <p className="mt-1.5 text-sm leading-snug text-encre-2">
        L'agent disponible le moins chargé du groupe {s.groupe.nom}. Vous pouvez aussi en choisir un autre dans « Agent assigné ».
      </p>
      <Bouton variante="principal" taille="petit" className="mt-3" disabled={actions?.occupe} onClick={() => actions?.assigner?.(s.agent.id)}>
        Assigner à {s.agent.nom}
      </Bouton>
    </section>
  );
}

/** Enquête de satisfaction de la réclamation close (étape 15) : la réponse du client, telle quelle. */
function AvisClient({ avis }: { avis: NonNullable<S<'ReclamationDetail'>['avis']> }) {
  const r = avis.reponse;
  return (
    <Panneau titre="Avis du client">
      {r ? (
        <div className="flex flex-col gap-3">
          <div className="flex gap-6">
            <div>
              <p className="text-[13px] text-encre-3">Satisfaction</p>
              <p className="chiffres text-[22px] leading-tight font-bold">
                {r.note}
                <span className="text-[15px] font-semibold text-encre-3"> / 5</span>
              </p>
            </div>
            <div>
              <p className="text-[13px] text-encre-3">Recommandation</p>
              <p className="chiffres text-[22px] leading-tight font-bold">
                {r.recommandation}
                <span className="text-[15px] font-semibold text-encre-3"> / 10</span>
              </p>
            </div>
          </div>
          <p className="text-sm text-encre-2">{NOTE_SATISFACTION[r.note]}, le <span className="chiffres">{dateCourte(r.reponduLe)}</span></p>
          {r.commentaire && <blockquote className="border-l-3 border-marque-trait pl-3 text-[15px] leading-relaxed whitespace-pre-line">{r.commentaire}</blockquote>}
        </div>
      ) : (
        <p className="text-[15px] text-encre-2">
          {ETAT_AVIS[avis.etat]}
          {avis.etat === 'A_DONNER' && <span className="block text-sm text-encre-3">Jusqu'au <span className="chiffres">{dateCourte(avis.expireLe)}</span></span>}
        </p>
      )}
    </Panneau>
  );
}

function Dialogue({ titre, children, surFermer, ecran }: { titre: string; children: ReactNode; surFermer?: () => void; ecran?: boolean }) {
  return (
    <div className={cx('inset-0 z-30 flex items-start justify-center bg-encre/35 pt-24', ecran ? 'fixed' : 'absolute')}>
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
  actions,
  suggestions,
  ecran,
}: {
  r: S<'ReclamationDetail'>;
  /** Agents actifs proposés à l'assignation (listerUtilisateurs), pour le superviseur */
  agents: S<'ReferenceNommee'>[];
  fenetre?: Fenetre;
  delaiClotureJours: number;
  seuil: number;
  actions?: ActionsFiche;
  /** Textes proposés (démo) : réponse au client, réponse finale ; brouillon de l'assistant IA (maquettes, étape 18) */
  suggestions?: { reponse?: string; resolution?: string; ia?: S<'SuggestionReponse'> };
  /** Fenêtres de dialogue au-dessus de tout l'écran (application), plutôt que du cadre (démo) */
  ecran?: boolean;
}) {
  const [ouverte, setOuverte] = useState<Fenetre>(fenetre);
  const [finale, setFinale] = useState(
    suggestions?.resolution ??
      (actions ? '' : undefined) ??
      "Bonjour M. Kouassi, le distributeur n'a pas délivré les billets lors de votre retrait du 23/09. Les 50 000 FCFA ont été recrédités sur votre compte ce jour. Nous vous prions de nous excuser pour ce désagrément.",
  );
  const [motif, setMotif] = useState<S<'MotifClotureForcee'>>('DOUBLON');
  const [precision, setPrecision] = useState(actions ? '' : 'Même réclamation que ALP-2026-002436, déposée la veille par le client.');
  // Étape 21 : réclamations du même client auxquelles ce doublon peut être joint
  const candidates = r.duMemeClient.filter((d) => d.statut !== 'CLOTUREE' && d.accessible);
  const doublons = r.statut === 'CLOTUREE' ? [] : r.duMemeClient.filter((d) => d.doublonPossible);
  const [principale, setPrincipale] = useState(() => (candidates.find((d) => d.doublonPossible) ?? candidates[0])?.id ?? '');
  const a = (x: S<'ActionStatut'>) => r.actionsPossibles.includes(x);
  const o = (x: S<'OperationTicket'>) => r.operationsPossibles.includes(x);
  const lectureSeule = r.actionsPossibles.length === 0 && r.operationsPossibles.every((x) => x === 'CONSULTER');
  // Étape 22 : le message non remis le plus récent, que l'utilisateur peut renvoyer
  const nonRemis = r.envois.find((e) => e.etat === 'NON_REMIS' && e.renvoyable);

  return (
    <div className="flex flex-col gap-5">
      <a
        href="#files"
        onClick={(e) => {
          if (actions?.retour) {
            e.preventDefault();
            actions.retour();
          }
        }}
        className="-ml-1 inline-flex w-fit items-center gap-1 text-[15px] font-semibold text-encre-2 hover:text-encre"
      >
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
            {r.jalons.escaladeeAdminLe && (
              <span className="inline-flex items-center gap-1 rounded-md bg-urgent-doux px-2 py-0.5 text-[13px] font-semibold text-urgent">
                <ArrowUpRight aria-hidden size={14} />
                Escaladée à l'Admin Entreprise
              </span>
            )}
            <span className="text-[15px] text-encre-2">{r.categorie.nom}</span>
            {r.depotAssistant && (
              <span className="inline-flex items-center gap-1 rounded-md bg-marque-doux px-2 py-0.5 text-[13px] font-semibold text-marque-texte" title="Le client a préparé sa réclamation avec l'assistant automatique du portail, puis l'a relue et envoyée">
                <Bot aria-hidden size={14} />
                Déposée avec l'assistant
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {o('CHANGER_PRIORITE') && (
            <Bouton icone={<Flame aria-hidden size={16} />} onClick={actions?.priorite}>{r.priorite === 'URGENTE' ? 'Repasser en normal' : 'Passer en urgent'}</Bouton>
          )}
          {o('ESCALADER') && <Bouton icone={<ArrowUpRight aria-hidden size={16} />} onClick={actions?.escalader}>Escalader</Bouton>}
          {a('RATTACHER') && candidates.length > 0 && (
            <Bouton icone={<Combine aria-hidden size={16} />} onClick={() => setOuverte('rattacher')}>Rattacher à…</Bouton>
          )}
          {a('CLOTURER_DE_FORCE') && (
            <Bouton variante="danger" onClick={() => setOuverte('cloturer')}>Clôturer de force</Bouton>
          )}
          {a('PRENDRE_EN_CHARGE') && <Bouton variante="principal" onClick={actions?.prendreEnCharge} data-visite="prendre">Prendre en charge</Bouton>}
          {a('RESOUDRE') && (
            <Bouton variante="principal" icone={<CircleCheck aria-hidden size={17} />} onClick={() => setOuverte('resoudre')} data-visite="resoudre">
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

      {r.rattacheeA && (
        <p className="flex items-start gap-2.5 rounded-xl border border-trait bg-surface px-4 py-3 text-[15px] leading-snug text-encre-2">
          <Combine aria-hidden size={18} className="mt-0.5 shrink-0 text-encre-3" />
          <span>
            Doublon rattaché à <LienReclamation id={r.rattacheeA.id} numero={r.rattacheeA.numero} actions={actions} /> : le client ne suit plus que celle-ci.
            Les messages et les pièces jointes ci-dessous restent consultables.
          </span>
        </p>
      )}
      {nonRemis && <AlerteNonRemis e={nonRemis} actions={actions} />}
      {doublons.length > 0 && (
        <div role="note" className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-attente/30 bg-attente-doux/60 px-4 py-3">
          <Copy aria-hidden size={18} className="shrink-0 text-attente" />
          <p className="min-w-0 flex-1 text-[15px] leading-snug text-encre-2">
            <span className="font-semibold text-encre">Doublon possible.</span>{' '}
            {r.client.nom} a aussi {doublons.map((d, i) => (
              <span key={d.id}>
                {i > 0 && ', '}
                {d.accessible ? <LienReclamation id={d.id} numero={d.numero} actions={actions} /> : <span className="chiffres font-semibold">{d.numero}</span>}
              </span>
            ))}{' '}
            en cours, de la même catégorie. Si c'est la même demande, rattachez l'une à l'autre : le client ne suivra plus qu'une réclamation.
          </p>
          {a('RATTACHER') && candidates.length > 0 && (
            <Bouton taille="petit" icone={<Combine aria-hidden size={15} />} onClick={() => setOuverte('rattacher')}>Rattacher</Bouton>
          )}
        </div>
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
            <Redaction key={`${r.id}-${r.statut}-${r.messages.length}`} r={r} actions={actions} suggestion={suggestions?.reponse} suggestionIa={suggestions?.ia} />
          </section>
        </div>

        <aside className="flex flex-col gap-5">
          {r.attributionSuggeree && o('ASSIGNER') && <Suggestion s={r.attributionSuggeree} actions={actions} />}
          {r.conversation && <ChatClient c={r.conversation} actions={actions} />}
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
            {o('RENVOYER_LIEN') && (r.client.telephone || r.client.email) && (
              <div className="mt-3 border-t border-trait pt-3">
                <Bouton taille="petit" className="w-full" icone={<Link2 aria-hidden size={15} />} disabled={actions?.occupe} onClick={actions?.renvoyerLien}>
                  Renvoyer le lien de suivi
                </Bouton>
                <p className="mt-1.5 text-[13px] leading-snug text-encre-3">Au téléphone ou à l'e-mail ci-dessus seulement, jamais à une autre adresse. Trois fois par heure au plus.</p>
              </div>
            )}
          </Panneau>
          <MessagesAuClient envois={r.envois} actions={actions} />
          {r.duMemeClient.length > 0 && <DuMemeClient autres={r.duMemeClient} actions={actions} />}
          {r.doublonsRattaches.length > 0 && (
            <Panneau titre="Doublons rattachés">
              <p className="text-sm text-encre-2">Clôturés et joints à cette réclamation ; leurs messages et pièces jointes restent consultables.</p>
              <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                {r.doublonsRattaches.map((d) => <li key={d.id}><LienReclamation id={d.id} numero={d.numero} actions={actions} /></li>)}
              </ul>
            </Panneau>
          )}

          <Panneau titre="Traitement">
            <dl className="-my-2.5 divide-y divide-trait">
              <Info libelle="Agent assigné">
                {o('ASSIGNER') ? (
                  <Liste
                    value={r.agent?.id ?? ''}
                    onChange={(e) => e.target.value && actions?.assigner?.(e.target.value)}
                    aria-label="Agent assigné"
                    data-visite="assigner"
                    className="mt-1 h-10"
                  >
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
                <span className="inline-flex items-start gap-2">
                  <span className="mt-0.5 text-encre-3"><IconeDepot canal={r.canal} taille={16} /></span>
                  <span>
                    {r.canal === 'WHATSAPP' || r.canal === 'SMS'
                      ? `${CANAL[r.canal]}, au numéro de la banque`
                      : r.canal === 'GUICHET'
                        ? 'Au guichet de l\'agence'
                        : r.canal === 'TELEPHONE'
                          ? 'Par téléphone'
                          : `${CANAL[r.canal]}, ${r.pointDepot.libelle.toLowerCase()}`}
                    {r.saisiePar && <span className="block text-sm text-encre-3">Saisie par {r.saisiePar.nom}, avec l'accord du client</span>}
                  </span>
                </span>
              </Info>
              <Info libelle="Agence">{r.agence?.nom ?? 'Aucune'}</Info>
              <Info libelle="Déposée le"><span className="chiffres">{dateHeure(r.creeLe)}</span></Info>
              <Info libelle="Première réponse"><span className="chiffres">{r.jalons.premiereReponseLe ? dateHeure(r.jalons.premiereReponseLe) : 'Pas encore'}</span></Info>
              {r.nbReouvertures > 0 && <Info libelle="Réouvertures">{r.nbReouvertures}</Info>}
              {r.jalons.escaladeeAdminLe && (
                <Info libelle="Escaladée à l'Admin Entreprise"><span className="chiffres">{dateHeure(r.jalons.escaladeeAdminLe)}</span></Info>
              )}
            </dl>
          </Panneau>

          {r.avis && <AvisClient avis={r.avis} />}

          <Panneau titre="Chronologie">
            <ol className="flex flex-col gap-3.5">
              {[...r.chronologie].reverse().map((e, i) => (
                <li key={i} className="flex gap-3 text-sm">
                  <span aria-hidden className={cx('mt-1.5 h-2 w-2 shrink-0 rounded-full', e.visibleClient ? 'bg-marque' : 'bg-trait-fort')} />
                  <div>
                    <p className="font-semibold text-encre">
                      {e.type === 'ASSIGNATION' && e.acteur.type === 'SYSTEME'
                        ? 'Attribution automatique'
                        : e.type === 'CREATION' && e.acteur.type === 'UTILISATEUR'
                          ? 'Saisie pour le client'
                          : e.type === 'RATTACHEMENT' && e.statutApres
                            ? 'Rattachée à une autre réclamation'
                            : EVENEMENT[e.type]}
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
        <Dialogue titre="Résoudre la réclamation" surFermer={() => setOuverte('aucune')} ecran={ecran}>
          <p className="mt-2 text-[15px] leading-relaxed text-encre-2">
            Votre réponse finale part au client par e-mail et SMS. Il pourra confirmer ou contester pendant {delaiClotureJours} jours ; sans réponse, la réclamation sera clôturée.
          </p>
          <label htmlFor="finale" className="mt-5 block text-[15px] font-semibold">Réponse finale au client</label>
          <Texte
            id="finale"
            rows={5}
            className="mt-1.5"
            value={finale}
            onChange={(e) => setFinale(e.target.value)}
          />
          <div className="mt-5 flex justify-end gap-2">
            <Bouton variante="discret" onClick={() => setOuverte('aucune')}>Annuler</Bouton>
            <Bouton
              variante="principal"
              icone={<CircleCheck aria-hidden size={17} />}
              disabled={!finale.trim() || actions?.occupe}
              data-visite="confirmer-resolution"
              onClick={async () => {
                if ((await actions?.resoudre?.(finale)) !== false) setOuverte('aucune');
              }}
            >
              Résoudre et envoyer
            </Bouton>
          </div>
        </Dialogue>
      )}

      {ouverte === 'rattacher' && a('RATTACHER') && candidates.length > 0 && (
        <Dialogue titre="Rattacher ce doublon" surFermer={() => setOuverte('aucune')} ecran={ecran}>
          <p className="mt-2 text-[15px] leading-relaxed text-encre-2">
            {r.numero} sera clôturée (motif « Doublon ») et jointe à la réclamation choisie, qui continue son traitement. Ses messages et ses pièces jointes restent consultables.
            Le client reçoit un seul message, avec le lien de la réclamation principale ; pas d'enquête de satisfaction pour le doublon.
          </p>
          <fieldset className="mt-5">
            <legend className="text-[15px] font-semibold">Réclamation principale</legend>
            <div className="mt-2 flex flex-col gap-2">
              {candidates.map((d) => (
                <label key={d.id} className={cx('flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 text-[15px]', principale === d.id ? 'border-marque bg-marque-doux/60' : 'border-trait-fort')}>
                  <input type="radio" name="principale" checked={principale === d.id} onChange={() => setPrincipale(d.id)} className="mt-1 h-4 w-4 accent-[var(--marque)]" />
                  <span>
                    <span className="chiffres font-bold tracking-wide">{d.numero}</span>
                    <span className="ml-2 text-encre-2">{STATUT[d.statut]}</span>
                    <span className="block text-sm text-encre-3">
                      {d.categorie.nom}, déposée le <span className="chiffres">{dateCourte(d.creeLe)}</span>{d.agent ? `, ${d.agent.nom}` : ''}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="mt-5 flex justify-end gap-2">
            <Bouton variante="discret" onClick={() => setOuverte('aucune')}>Annuler</Bouton>
            <Bouton
              variante="principal"
              icone={<Combine aria-hidden size={16} />}
              disabled={!principale || actions?.occupe}
              onClick={async () => {
                if ((await actions?.rattacher?.(principale)) !== false) setOuverte('aucune');
              }}
            >
              Rattacher et clôturer
            </Bouton>
          </div>
        </Dialogue>
      )}

      {ouverte === 'cloturer' && a('CLOTURER_DE_FORCE') && (
        <Dialogue titre="Clôturer de force" surFermer={() => setOuverte('aucune')} ecran={ecran}>
          <p className="mt-2 text-[15px] leading-relaxed text-encre-2">
            La réclamation sera clôturée sans l'accord du client, qui en sera informé. Cette action est inscrite au journal d'audit.
          </p>
          <fieldset className="mt-5">
            <legend className="text-[15px] font-semibold">Motif</legend>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {(Object.keys(MOTIF_CLOTURE) as S<'MotifClotureForcee'>[]).map((m) => (
                <label key={m} className={cx('flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2.5 text-[15px]', motif === m ? 'border-urgent/50 bg-urgent-doux/50 font-semibold' : 'border-trait-fort')}>
                  <input type="radio" name="motif" checked={motif === m} onChange={() => setMotif(m)} className="h-4 w-4 accent-[var(--color-urgent)]" />
                  {MOTIF_CLOTURE[m]}
                </label>
              ))}
            </div>
          </fieldset>
          <label htmlFor="precision" className="mt-4 block text-[15px] font-semibold">Précision</label>
          <Texte id="precision" rows={2} className="mt-1.5 min-h-0" value={precision} onChange={(e) => setPrecision(e.target.value)} placeholder="Par exemple : même réclamation déposée deux fois." />
          <div className="mt-5 flex justify-end gap-2">
            <Bouton variante="discret" onClick={() => setOuverte('aucune')}>Annuler</Bouton>
            <Bouton
              variante="danger"
              className="!bg-urgent !text-white"
              disabled={!precision.trim() || actions?.occupe}
              onClick={async () => {
                if ((await actions?.cloturer?.(motif, precision)) !== false) setOuverte('aucune');
              }}
            >
              Clôturer la réclamation
            </Bouton>
          </div>
        </Dialogue>
      )}
    </div>
  );
}
