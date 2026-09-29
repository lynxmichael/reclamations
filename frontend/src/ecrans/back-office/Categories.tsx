/**
 * Catégories et délais SLA (listerCategories, creerCategorie, modifierCategorie).
 * Le délai est copié sur chaque réclamation au dépôt : le changer ne touche pas les réclamations
 * en cours (étape 4). Avec `actions` (étape 8), le panneau crée et modifie pour de vrai.
 */
import { useState } from 'react';
import { ArrowDown, ArrowUp, GripVertical, Info, Pencil, Plus, X } from 'lucide-react';
import type { S } from '../../api/types';
import { BadgeUrgent, Bouton, Champ, Saisie, Texte, cx } from '../../ui/composants';
import { duree } from '../../ui/format';

type Issue = void | boolean | Promise<boolean>;

export interface SaisieCategorie {
  nom: string;
  description: string | null;
  prioriteParDefaut: S<'Priorite'>;
  delaiCibleMinutes: number;
  active?: boolean;
}

export interface ActionsCategories {
  creer: (v: SaisieCategorie) => Issue;
  modifier: (id: string, v: Partial<SaisieCategorie> & { ordre?: number }) => Issue;
  occupe?: boolean;
  /** Erreurs par champ renvoyées par l'API (nom déjà pris…) */
  erreurs?: Record<string, string>;
}

/** « ≈ 2,1 jours ouvrés » avec la durée d'une journée d'ouverture de la banque. */
function enJours(minutes: number, minutesParJour: number): string {
  const j = minutes / Math.max(1, minutesParJour);
  return `≈ ${j.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} jour${j >= 2 ? 's' : ''}`;
}

function Panneau({ c, minutesParJour, actions, surFermer }: { c: S<'Categorie'> | null; minutesParJour: number; actions?: ActionsCategories; surFermer: () => void }) {
  const [nom, setNom] = useState(c?.nom ?? '');
  const [description, setDescription] = useState(c?.description ?? '');
  const [priorite, setPriorite] = useState<S<'Priorite'>>(c?.prioriteParDefaut ?? 'NORMALE');
  const [heures, setHeures] = useState(String(Math.floor((c?.delaiCibleMinutes ?? 960) / 60)));
  const [minutes, setMinutes] = useState(String((c?.delaiCibleMinutes ?? 960) % 60).padStart(2, '0'));
  const [active, setActive] = useState(c?.active ?? true);
  const total = (Number(heures) || 0) * 60 + (Number(minutes) || 0);
  const valide = nom.trim().length > 0 && total > 0 && Number.isInteger(Number(heures)) && Number.isInteger(Number(minutes)) && Number(minutes) < 60;
  const erreurs = actions?.erreurs ?? {};

  const enregistrer = async () => {
    const v: SaisieCategorie = { nom: nom.trim(), description: description.trim() || null, prioriteParDefaut: priorite, delaiCibleMinutes: total };
    const issue = await (c ? actions?.modifier(c.id, { ...v, active }) : actions?.creer(v));
    if (issue !== false) surFermer();
  };

  return (
    <aside aria-label={c ? `Modifier ${c.nom}` : 'Nouvelle catégorie'} className="w-[340px] shrink-0 self-start rounded-xl border border-trait bg-surface">
      <div className="flex items-center justify-between border-b border-trait px-5 py-3.5">
        <h2 className="text-[17px] font-bold">{c ? 'Modifier la catégorie' : 'Nouvelle catégorie'}</h2>
        <button type="button" aria-label="Fermer" onClick={surFermer} className="rounded p-1 text-encre-3 hover:bg-fond"><X size={19} /></button>
      </div>
      <form
        className="flex flex-col gap-5 p-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (valide) void enregistrer();
        }}
      >
        <Champ libelle="Nom" erreur={erreurs.nom}>{(id) => <Saisie id={id} value={nom} onChange={(e) => setNom(e.target.value)} maxLength={120} autoFocus={!!actions} required invalide={!!erreurs.nom} />}</Champ>
        <Champ libelle="Description" facultatif aide="Affichée au client sous le nom.">
          {(id, d) => <Texte id={id} aria-describedby={d} rows={2} className="min-h-0" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} />}
        </Champ>
        <fieldset>
          <legend className="text-[15px] font-semibold">Priorité au dépôt</legend>
          <div className="mt-2 flex gap-2">
            {(['NORMALE', 'URGENTE'] as const).map((p) => (
              <label key={p} className={cx('flex flex-1 cursor-pointer items-center gap-2 rounded-lg border px-3 py-2.5 text-[15px]', priorite === p ? 'border-marque bg-marque-doux font-semibold' : 'border-trait-fort')}>
                <input type="radio" name="priorite" checked={priorite === p} onChange={() => setPriorite(p)} className="h-4 w-4 accent-[var(--marque)]" />
                {p === 'NORMALE' ? 'Normale' : 'Urgente'}
              </label>
            ))}
          </div>
          {priorite === 'URGENTE' && <p className="mt-1.5 text-sm text-encre-3">Chaque dépôt alerte aussitôt les superviseurs, l'Admin Entreprise et Makor Telecoms.</p>}
        </fieldset>
        <fieldset>
          <legend className="text-[15px] font-semibold">Délai cible</legend>
          <div className="mt-2 flex items-center gap-2">
            <div className="w-20"><Saisie aria-label="Heures" inputMode="numeric" value={heures} onChange={(e) => setHeures(e.target.value.replace(/\D/g, ''))} className="chiffres text-right" /></div>
            <span className="text-encre-2">h</span>
            <div className="w-20"><Saisie aria-label="Minutes" inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value.replace(/\D/g, '').slice(0, 2))} className="chiffres text-right" /></div>
            <span className="text-encre-2">min</span>
          </div>
          <p className="chiffres mt-1.5 text-sm text-encre-3">{duree(total)} ouvrées, {enJours(total, minutesParJour)} d'ouverture avec vos horaires actuels.</p>
          {erreurs.delaiCibleMinutes && <p className="mt-1 text-sm font-semibold text-urgent">{erreurs.delaiCibleMinutes}</p>}
        </fieldset>
        {c && actions && (
          <label className="flex items-start gap-2.5 text-[15px]">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="mt-1 h-4 w-4 accent-[var(--marque)]" />
            <span>
              Proposée au client
              <span className="block text-sm text-encre-3">Décochée, elle n'apparaît plus dans le formulaire ; les réclamations existantes la gardent.</span>
            </span>
          </label>
        )}
        {c && (
          <p className="flex gap-2.5 rounded-lg bg-fond p-3 text-sm leading-relaxed text-encre-2">
            <Info aria-hidden size={17} className="mt-0.5 shrink-0 text-encre-3" />
            Le nouveau délai vaut pour les réclamations déposées après l'enregistrement. Celles en cours gardent le leur.
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Bouton variante="discret" onClick={surFermer}>Annuler</Bouton>
          <Bouton type="submit" variante="principal" disabled={!!actions && (!valide || actions.occupe)}>
            {actions?.occupe ? 'Enregistrement…' : c ? 'Enregistrer' : 'Créer la catégorie'}
          </Bouton>
        </div>
      </form>
    </aside>
  );
}

export function Categories({
  categories,
  enEdition,
  minutesParJour,
  actions,
}: {
  categories: S<'Categorie'>[];
  enEdition: string | null;
  minutesParJour: number;
  actions?: ActionsCategories;
}) {
  const [edition, setEdition] = useState<string | null>(enEdition);
  const liste = [...categories].sort((a, b) => a.ordre - b.ordre || a.nom.localeCompare(b.nom, 'fr'));
  const c = liste.find((x) => x.id === edition) ?? null;
  const deplacer = (i: number, sens: -1 | 1) => {
    const a = liste[i]!;
    const b = liste[i + sens];
    if (!b || !actions) return;
    // Deux catégories échangent leur place ; ordres identiques : on les sépare
    const [oa, ob] = a.ordre === b.ordre ? [b.ordre + sens, a.ordre] : [b.ordre, a.ordre];
    void Promise.resolve(actions.modifier(a.id, { ordre: oa })).then((ok) => ok !== false && actions.modifier(b.id, { ordre: ob }));
  };

  return (
    <div className="flex gap-5">
      <div className="flex min-w-0 flex-1 flex-col gap-5">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-[26px] font-bold tracking-tight">Catégories et délais</h1>
            <p className="mt-1 max-w-[70ch] text-[15px] text-encre-3">
              Le client choisit une catégorie au dépôt. Son délai fixe l'échéance SLA, compté en heures d'ouverture.
            </p>
          </div>
          <Bouton variante="principal" icone={<Plus aria-hidden size={17} />} onClick={() => setEdition('nouvelle')}>Nouvelle catégorie</Bouton>
        </div>

        <div className="overflow-hidden rounded-xl border border-trait bg-surface">
          <table className="w-full text-left text-[15px]">
            <thead>
              <tr className="border-b border-trait text-[13px] text-encre-3">
                <th scope="col" className={cx('py-2.5 pl-3', actions ? 'w-16' : 'w-10')}><span className="sr-only">Ordre</span></th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Catégorie</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Priorité</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Délai cible</th>
                <th scope="col" className="py-2.5 pr-4"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {liste.map((x, i) => (
                <tr key={x.id} className={cx('border-b border-trait last:border-0', x.id === edition && 'bg-marque-doux/60', !x.active && 'text-encre-3')}>
                  <td className="py-3 pl-3 align-top text-encre-3">
                    {actions ? (
                      <span className="flex">
                        <button type="button" aria-label={`Monter ${x.nom}`} disabled={i === 0 || actions.occupe} onClick={() => deplacer(i, -1)} className="rounded p-1 hover:bg-fond disabled:opacity-30"><ArrowUp size={15} /></button>
                        <button type="button" aria-label={`Descendre ${x.nom}`} disabled={i === liste.length - 1 || actions.occupe} onClick={() => deplacer(i, 1)} className="rounded p-1 hover:bg-fond disabled:opacity-30"><ArrowDown size={15} /></button>
                      </span>
                    ) : (
                      <GripVertical aria-hidden size={18} />
                    )}
                  </td>
                  <td className="px-3 py-3 align-top">
                    <div className="flex items-center gap-2 font-semibold">
                      {x.nom}
                      {!x.active && <span className="rounded-md bg-cloturee-doux px-2 py-0.5 text-[13px] text-cloturee">Désactivée</span>}
                    </div>
                    {x.description && <div className="mt-0.5 text-sm text-encre-3">{x.description}</div>}
                  </td>
                  <td className="px-3 py-3 align-top">{x.prioriteParDefaut === 'URGENTE' ? <BadgeUrgent priorite="URGENTE" /> : <span className="text-encre-2">Normale</span>}</td>
                  <td className="px-3 py-3 align-top whitespace-nowrap">
                    <div className="chiffres font-semibold">{duree(x.delaiCibleMinutes)}</div>
                    <div className="chiffres text-sm text-encre-3">{enJours(x.delaiCibleMinutes, minutesParJour)}</div>
                  </td>
                  <td className="py-3 pr-4 text-right align-top">
                    <Bouton taille="petit" variante="discret" aria-label={`Modifier ${x.nom}`} icone={<Pencil aria-hidden size={15} />} onClick={() => setEdition(x.id)} />
                  </td>
                </tr>
              ))}
              {liste.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-10 text-center text-encre-3">Aucune catégorie : créez-en une pour ouvrir le dépôt aux clients.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {(c || edition === 'nouvelle') && <Panneau key={edition} c={c} minutesParJour={minutesParJour} actions={actions} surFermer={() => setEdition(null)} />}
    </div>
  );
}
