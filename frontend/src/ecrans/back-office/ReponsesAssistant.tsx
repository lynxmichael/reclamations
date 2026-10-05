/**
 * Base de réponses de l'assistant (étape 18, décision I4) : listerReponsesAssistant,
 * creerReponseAssistant, modifierReponseAssistant, supprimerReponseAssistant.
 *
 * L'Admin Entreprise écrit et valide chaque réponse : sur le portail, l'assistant montre la réponse
 * telle quelle quand la question du client y correspond. Les interdits (promesse de remboursement ou
 * de délai, statut annoncé, conseil, demande de code) sont signalés à la saisie, comme dans l'API :
 * un avertissement, la banque décide.
 */
import { useState } from 'react';
import { Bot, Pencil, Plus, Trash2, TriangleAlert, X } from 'lucide-react';
import { LIBELLE_INTERDIT, verifierInterdits } from '@domaine/ia/interdits';
import type { S } from '../../api/types';
import { Bouton, Champ, Saisie, Texte, cx } from '../../ui/composants';
import { dateCourte } from '../../ui/format';

type Issue = void | boolean | Promise<boolean>;

export interface SaisieReponse {
  question: string;
  reponse: string;
  active: boolean;
}

export interface ActionsReponses {
  creer: (v: SaisieReponse) => Issue;
  modifier: (id: string, v: Partial<SaisieReponse>) => Issue;
  supprimer: (id: string) => Issue;
  occupe?: boolean;
}

function Alertes({ texte }: { texte: string }) {
  const alertes = verifierInterdits(texte);
  if (!alertes.length) return null;
  return (
    <ul className="flex flex-col gap-1 text-sm font-semibold text-urgent">
      {alertes.map((a) => (
        <li key={a.code} className="flex items-start gap-1.5">
          <TriangleAlert aria-hidden size={15} className="mt-0.5 shrink-0" />
          <span>La réponse {LIBELLE_INTERDIT[a.code]} : « {a.extrait} »</span>
        </li>
      ))}
    </ul>
  );
}

function Edition({ r, actions, surFermer }: { r: S<'ReponseBanque'> | null; actions?: ActionsReponses; surFermer: () => void }) {
  const [question, setQuestion] = useState(r?.question ?? '');
  const [reponse, setReponse] = useState(r?.reponse ?? '');
  const [active, setActive] = useState(r?.active ?? true);
  const valide = question.trim().length >= 5 && reponse.trim().length >= 5;
  const enregistrer = async () => {
    const v = { question: question.trim(), reponse: reponse.trim(), active };
    const issue = await (r ? actions?.modifier(r.id, v) : actions?.creer(v));
    if (issue !== false) surFermer();
  };
  return (
    <aside aria-label={r ? 'Modifier la réponse' : 'Nouvelle réponse'} className="w-[380px] shrink-0 self-start rounded-xl border border-trait bg-surface">
      <div className="flex items-center justify-between border-b border-trait px-5 py-3.5">
        <h2 className="text-[17px] font-bold">{r ? 'Modifier la réponse' : 'Nouvelle réponse'}</h2>
        <button type="button" aria-label="Fermer" onClick={surFermer} className="rounded p-1 text-encre-3 hover:bg-fond"><X size={19} /></button>
      </div>
      <form
        className="flex flex-col gap-5 p-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (valide) void enregistrer();
        }}
      >
        <Champ libelle="Question du client" aide="Telle qu'un client la poserait.">
          {(id, d) => <Saisie id={id} aria-describedby={d} value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={300} autoFocus={!!actions} required />}
        </Champ>
        <Champ libelle="Réponse validée" aide="Montrée telle quelle au client. Sans promesse de remboursement ni de délai.">
          {(id, d) => <Texte id={id} aria-describedby={d} rows={6} value={reponse} onChange={(e) => setReponse(e.target.value)} maxLength={2000} required />}
        </Champ>
        <Alertes texte={reponse} />
        <label className="inline-flex items-center gap-2.5 text-[15px]">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="h-4 w-4 accent-[var(--marque)]" />
          Utilisée par l'assistant
        </label>
        <div className="flex gap-2">
          <Bouton variante="principal" type="submit" disabled={!valide || actions?.occupe}>{actions?.occupe ? 'Enregistrement…' : 'Enregistrer'}</Bouton>
          <Bouton onClick={surFermer}>Annuler</Bouton>
        </div>
      </form>
    </aside>
  );
}

export function ReponsesAssistant({
  reponses,
  enEdition,
  actions,
}: {
  reponses: S<'ReponseBanque'>[];
  /** Maquettes : la réponse ouverte dans le panneau (« nouvelle » pour une création) */
  enEdition?: string | 'nouvelle' | null;
  actions?: ActionsReponses;
}) {
  const [edition, setEdition] = useState<string | 'nouvelle' | null>(enEdition ?? null);
  const enCours = edition && edition !== 'nouvelle' ? reponses.find((r) => r.id === edition) ?? null : null;
  const actives = reponses.filter((r) => r.active).length;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">Assistant IA</h1>
          <p className="mt-1 max-w-3xl text-[15px] text-encre-3">
            Les réponses que l'assistant automatique du portail donne aux questions fréquentes, telles que vous les écrivez. Il ne rédige jamais lui-même une réponse au client.
          </p>
        </div>
        <Bouton variante="principal" icone={<Plus aria-hidden size={17} />} onClick={() => setEdition('nouvelle')}>Nouvelle réponse</Bouton>
      </div>

      <p className="flex items-start gap-2.5 rounded-xl border border-trait bg-surface px-4 py-3 text-[15px] leading-relaxed text-encre-2">
        <Bot aria-hidden size={19} className="mt-0.5 shrink-0 text-marque-texte" />
        <span>
          {actives} réponse{actives > 1 ? 's' : ''} utilisée{actives > 1 ? 's' : ''}. L'assistant se présente comme automatique, propose toujours un conseiller, et prépare la réclamation que le client relit et envoie lui-même.
          Les agents peuvent aussi lui demander un brouillon de réponse sur la fiche d'une réclamation.
        </span>
      </p>

      <div className="flex items-start gap-5">
        <ul className="min-w-0 flex-1 overflow-hidden rounded-xl border border-trait bg-surface">
          {reponses.length === 0 && <li className="px-5 py-10 text-center text-[15px] text-encre-3">Aucune réponse pour l'instant : l'assistant se contente de préparer les réclamations.</li>}
          {reponses.map((r) => (
            <li key={r.id} className={cx('flex gap-4 border-b border-trait px-5 py-4 last:border-0', !r.active && 'bg-fond/60')}>
              <div className="min-w-0 flex-1">
                <p className={cx('font-semibold', !r.active && 'text-encre-3')}>
                  {r.question}
                  {!r.active && <span className="ml-2 rounded-md bg-fond px-1.5 py-0.5 text-xs font-semibold text-encre-3 ring-1 ring-trait">Retirée</span>}
                </p>
                <p className="mt-1 line-clamp-3 text-[15px] leading-relaxed whitespace-pre-line text-encre-2">{r.reponse}</p>
                {r.alertes.length > 0 && (
                  <p className="mt-1.5 flex items-center gap-1.5 text-sm font-semibold text-urgent">
                    <TriangleAlert aria-hidden size={14} />
                    {r.alertes.map((a) => a.libelle).join(', ')}
                  </p>
                )}
                <p className="chiffres mt-1 text-xs text-encre-3">Modifiée le {dateCourte(r.modifieLe)}</p>
              </div>
              <div className="flex shrink-0 items-start gap-1">
                <button type="button" aria-label={`Modifier « ${r.question} »`} onClick={() => setEdition(r.id)} className="rounded-lg p-2 text-encre-2 hover:bg-fond"><Pencil size={17} /></button>
                <button
                  type="button"
                  aria-label={`Supprimer « ${r.question} »`}
                  disabled={actions?.occupe}
                  onClick={() => void actions?.supprimer(r.id)}
                  className="rounded-lg p-2 text-encre-2 hover:bg-urgent-doux hover:text-urgent"
                >
                  <Trash2 size={17} />
                </button>
              </div>
            </li>
          ))}
        </ul>
        {edition && <Edition key={edition} r={enCours} actions={actions} surFermer={() => setEdition(null)} />}
      </div>
    </div>
  );
}
