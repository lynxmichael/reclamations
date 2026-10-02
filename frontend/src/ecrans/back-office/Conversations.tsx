/**
 * Boîte de réception des agents (étape 17) : listerConversations, lireConversation,
 * marquerConversationLue ; on répond avec repondreAuClient, comme depuis la fiche.
 *
 * À gauche, les conversations du chat du portail (à répondre d'abord, la plus longue attente en
 * tête) ; à droite, la conversation choisie, avec la réclamation en tête du fil. Le droit de répondre
 * vient de operationsPossibles (REPONDRE_AU_CLIENT) : l'écran n'a pas de règle à lui.
 */
import { useEffect, useRef, useState } from 'react';
import { CheckCheck, ExternalLink, MessagesSquare, SendHorizontal } from 'lucide-react';
import type { S } from '../../api/types';
import { ChoixFichiers } from '../../ui/ChoixFichiers';
import { Avatar, BadgeStatut, BadgeUrgent, Bouton, Onglets, Texte, cx } from '../../ui/composants';
import { dateCourte, relatif } from '../../ui/format';
import { CANAL_CONVERSATION } from '../../ui/libelles';
import { PieceJointe } from '../portail/MaReclamation';

export type FiltreConversations = 'a-repondre' | 'non-lues' | 'toutes';

type Issue = void | boolean | Promise<boolean>;

export interface ActionsConversations {
  filtrer?: (f: FiltreConversations) => void;
  ouvrir?: (id: string) => void;
  repondre?: (contenu: string, attendreReponse: boolean, fichiers: File[]) => Issue;
  /** Fiche de la réclamation (notes internes, résolution, chronologie) */
  ouvrirFiche?: (reclamationId: string) => void;
  occupe?: boolean;
}

/** Rond vert sur l'avatar : le client a le chat à l'écran. */
function Presence({ enLigne, children }: { enLigne: boolean; children: React.ReactNode }) {
  return (
    <span className="relative inline-flex shrink-0">
      {children}
      {enLigne && <span aria-hidden className="absolute -right-0.5 -bottom-0.5 h-3 w-3 rounded-full border-2 border-surface bg-resolue" />}
    </span>
  );
}

function Ligne({ c, active, maintenant, surOuvrir }: { c: S<'ConversationResume'>; active: boolean; maintenant: string; surOuvrir?: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={surOuvrir}
        aria-current={active ? 'true' : undefined}
        aria-label={`${c.client.nom}, ${c.reclamation.numero}${c.nonLue ? ', non lue' : ''}${c.aRepondre ? ', à répondre' : ''}${c.clientEnLigne ? ', en ligne' : ''}`}
        className={cx(
          'flex w-full gap-3 border-b border-trait px-4 py-3.5 text-left',
          active ? 'bg-marque-doux' : 'hover:bg-fond',
        )}
      >
        <Presence enLigne={c.clientEnLigne}>
          <Avatar nom={c.client.nom} taille={38} ton="client" />
        </Presence>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className={cx('truncate text-[15px]', c.nonLue ? 'font-bold text-encre' : 'font-semibold text-encre')}>{c.client.nom}</span>
            <span className={cx('chiffres ml-auto shrink-0 text-[13px]', c.nonLue ? 'font-semibold text-marque-texte' : 'text-encre-3')}>
              {relatif(c.dernierMessage.date, maintenant)}
            </span>
          </span>
          <span className="mt-0.5 flex items-center gap-1.5 text-[13px] text-encre-3">
            <span className="chiffres">{c.reclamation.numero}</span>
            <span aria-hidden>·</span>
            <span className="truncate">{c.reclamation.categorie}</span>
            {c.reclamation.priorite === 'URGENTE' && <span className="font-semibold text-urgent">· Urgente</span>}
          </span>
          <span className="mt-1 flex items-center gap-2">
            <span className={cx('line-clamp-2 flex-1 text-sm leading-snug', c.nonLue ? 'text-encre' : 'text-encre-2')}>
              {c.dernierMessage.auteur === 'BANQUE' && <span className="text-encre-3">Vous : </span>}
              {c.dernierMessage.extrait}
            </span>
            {c.nonLue && <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full bg-marque" />}
          </span>
          {c.agent && <span className="mt-1 block text-[13px] text-encre-3">Suivie par {c.agent.nom}</span>}
        </span>
      </button>
    </li>
  );
}

function Bulle({ m, nomClient, luParLeClient }: { m: S<'Message'>; nomClient: string; luParLeClient: boolean }) {
  const client = m.type === 'MESSAGE_DU_CLIENT';
  return (
    <li className={cx('flex flex-col gap-1', client ? 'items-start pr-16' : 'items-end pl-16')}>
      <span className="text-[13px] text-encre-3">
        <span className="font-semibold text-encre-2">{client ? nomClient : m.auteur.nom ?? 'La banque'}</span>
        {' · '}
        <span className="chiffres">{dateCourte(m.creeLe)}</span>
      </span>
      <div className={cx('flex max-w-full flex-col gap-2 rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed', client ? 'rounded-tl-md border border-trait bg-surface' : 'rounded-tr-md bg-marque-doux')}>
        <p className="whitespace-pre-line">{m.contenu}</p>
        {m.piecesJointes.map((p) => <PieceJointe key={p.id} piece={p} surFond={!client} />)}
      </div>
      {luParLeClient && (
        <span className="inline-flex items-center gap-1 text-[13px] text-encre-3">
          <CheckCheck aria-hidden size={14} className="text-resolue" />
          Lu par le client
        </span>
      )}
    </li>
  );
}

function Fil({ c, maintenant, actions }: { c: S<'ConversationDetail'>; maintenant: string; actions?: ActionsConversations }) {
  const [texte, setTexte] = useState('');
  const [attendre, setAttendre] = useState(false);
  const [fichiers, setFichiers] = useState<File[]>([]);
  const bas = useRef<HTMLDivElement>(null);
  const peutRepondre = c.operationsPossibles.includes('REPONDRE_AU_CLIENT');
  const peutQuestionner = peutRepondre && c.reclamation.statut !== 'EN_ATTENTE_CLIENT';
  // Dernière réponse de la banque : « Lu par le client » dessous, s'il l'a lue
  const derniereReponse = [...c.messages].reverse().find((m) => m.type === 'REPONSE_AU_CLIENT');
  const lue = !!derniereReponse && !!c.luParLeClientLe && c.luParLeClientLe >= derniereReponse.creeLe;

  useEffect(() => {
    bas.current?.scrollIntoView?.({ block: 'end' });
  }, [c.id, c.messages.length]);

  const envoyer = async () => {
    if (!texte.trim()) return;
    const issue = await actions?.repondre?.(texte, attendre, fichiers);
    if (issue === false) return;
    setTexte('');
    setAttendre(false);
    setFichiers([]);
  };

  return (
    <section aria-label={`Conversation avec ${c.client.nom}`} className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-trait px-5 py-3.5">
        <Presence enLigne={c.clientEnLigne}>
          <Avatar nom={c.client.nom} taille={40} ton="client" />
        </Presence>
        <div className="min-w-0">
          <h2 className="text-[17px] leading-tight font-bold">{c.client.nom}</h2>
          <p className="text-[13px] text-encre-3">
            {c.clientEnLigne ? <span className="font-semibold text-resolue">En ligne</span> : c.luParLeClientLe ? `Vu ${relatif(c.luParLeClientLe, maintenant)}` : 'Hors ligne'}
            {' · '}
            {CANAL_CONVERSATION[c.canal]}
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <BadgeStatut statut={c.reclamation.statut} />
          <BadgeUrgent priorite={c.reclamation.priorite} />
          <a
            href={`#reclamation-${c.reclamation.id}`}
            onClick={(e) => {
              if (actions?.ouvrirFiche) {
                e.preventDefault();
                actions.ouvrirFiche(c.reclamation.id);
              }
            }}
            className="chiffres inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm font-semibold text-marque-texte hover:bg-fond"
          >
            {c.reclamation.numero}
            <ExternalLink aria-hidden size={14} />
          </a>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto bg-fond/60 px-5 py-4">
        <ol className="flex flex-col gap-4" aria-label="Messages">
          <li className="flex flex-col items-start gap-1 pr-16">
            <span className="text-[13px] text-encre-3">
              <span className="font-semibold text-encre-2">Réclamation déposée</span>
              {' · '}
              <span className="chiffres">{dateCourte(c.deposeeLe)}</span>
              {' · '}
              {c.reclamation.categorie}
            </span>
            <div className="rounded-2xl rounded-tl-md border border-dashed border-trait-fort bg-surface px-4 py-2.5 text-[15px] leading-relaxed">
              <p className="whitespace-pre-line">{c.description}</p>
            </div>
          </li>
          {c.messages.map((m) => (
            <Bulle key={m.id} m={m} nomClient={c.client.nom} luParLeClient={lue && m.id === derniereReponse?.id} />
          ))}
        </ol>
        <div ref={bas} />
      </div>

      {peutRepondre ? (
        <form
          className="border-t border-trait bg-surface px-5 py-3.5"
          onSubmit={(e) => {
            e.preventDefault();
            void envoyer();
          }}
        >
          <label htmlFor="reponse-conversation" className="sr-only">Réponse au client</label>
          <Texte
            id="reponse-conversation"
            rows={3}
            value={texte}
            onChange={(e) => setTexte(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                void envoyer();
              }
            }}
            placeholder={`Votre réponse à ${c.client.nom} — Ctrl + Entrée pour envoyer`}
          />
          <div className="mt-2.5 flex flex-wrap items-center gap-3">
            <ChoixFichiers fichiers={fichiers} surChangement={setFichiers} libelle="Joindre" compact />
            {peutQuestionner && (
              <label className="inline-flex items-center gap-2 text-sm text-encre-2">
                <input type="checkbox" checked={attendre} onChange={(e) => setAttendre(e.target.checked)} className="h-4 w-4 accent-[var(--marque)]" />
                Attendre sa réponse <span className="text-encre-3">(chrono SLA en pause)</span>
              </label>
            )}
            <Bouton type="submit" variante="principal" className="ml-auto" icone={<SendHorizontal aria-hidden size={16} />} disabled={!texte.trim() || actions?.occupe}>
              {actions?.occupe ? 'Envoi…' : 'Envoyer'}
            </Bouton>
          </div>
          <p className="mt-2 text-[13px] text-encre-3">
            Le client la voit dans son chat. S'il ne l'a pas lue 2 minutes après, il est prévenu par e-mail ou SMS.
          </p>
        </form>
      ) : (
        <p className="border-t border-trait bg-surface px-5 py-3.5 text-sm text-encre-3">
          {c.reclamation.statut === 'RESOLUE' || c.reclamation.statut === 'CLOTUREE'
            ? 'Réclamation résolue : le client confirme ou conteste depuis son espace.'
            : c.reclamation.statut === 'OUVERTE' && !c.agent
              ? 'Pour répondre, assignez d\'abord la réclamation à un agent depuis sa fiche.'
              : 'Vous consultez cette conversation : la réponse revient à l\'agent assigné et aux superviseurs.'}
        </p>
      )}
    </section>
  );
}

export function Conversations({
  page,
  filtre,
  selection,
  maintenant,
  actions,
}: {
  page: S<'PageConversations'>;
  filtre: FiltreConversations;
  /** Conversation ouverte à droite ; vide : aucune choisie */
  selection: S<'ConversationDetail'> | null;
  maintenant: string;
  actions?: ActionsConversations;
}) {
  const vide = {
    'a-repondre': 'Aucun client n\'attend de réponse.',
    'non-lues': 'Tout est lu.',
    toutes: 'Aucune conversation pour l\'instant.',
  }[filtre];
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-[26px] font-bold tracking-tight">Conversations</h1>
        <p className="mt-1 max-w-[80ch] text-[15px] text-encre-3">
          Les messages que les clients écrivent dans le chat du portail, réclamation par réclamation. Le chrono SLA et l'historique sont ceux de la fiche.
        </p>
      </div>

      <div className="grid h-[calc(100vh-220px)] min-h-[520px] grid-cols-[380px_minmax(0,1fr)] overflow-hidden rounded-xl border border-trait bg-surface">
        <div className="flex min-h-0 flex-col border-r border-trait">
          <div className="px-2">
            <Onglets<FiltreConversations>
              actif={filtre}
              surChoix={(f) => actions?.filtrer?.(f)}
              onglets={[
                { cle: 'a-repondre', libelle: 'À répondre', compte: page.compteurs.aRepondre, ton: 'marque' },
                { cle: 'non-lues', libelle: 'Non lues', compte: page.compteurs.nonLues, ton: 'marque' },
                { cle: 'toutes', libelle: 'Toutes' },
              ]}
            />
          </div>
          {page.donnees.length === 0 ? (
            <p className="flex flex-col items-center gap-2 px-6 py-12 text-center text-[15px] text-encre-3">
              <MessagesSquare aria-hidden size={28} />
              {vide}
            </p>
          ) : (
            <ul className="min-h-0 flex-1 overflow-y-auto" aria-label="Conversations">
              {page.donnees.map((c) => (
                <Ligne key={c.id} c={c} active={c.id === selection?.id} maintenant={maintenant} surOuvrir={() => actions?.ouvrir?.(c.id)} />
              ))}
            </ul>
          )}
          {page.pagination.total > page.donnees.length && (
            <p className="border-t border-trait px-4 py-2.5 text-[13px] text-encre-3">
              {page.donnees.length} sur {page.pagination.total} : répondez aux premières pour voir les suivantes.
            </p>
          )}
        </div>

        {selection ? (
          <Fil key={selection.id} c={selection} maintenant={maintenant} actions={actions} />
        ) : (
          <div className="flex flex-col items-center justify-center gap-2 px-8 text-center text-[15px] text-encre-3">
            <MessagesSquare aria-hidden size={32} />
            <p>Choisissez une conversation à gauche.</p>
            <p className="text-sm">Vos réponses apparaissent aussitôt dans le chat du client, sur le portail de la banque.</p>
          </div>
        )}
      </div>
    </div>
  );
}
