/**
 * Catégories et délais SLA (listerCategories, creerCategorie, modifierCategorie).
 * Le délai est copié sur chaque réclamation au dépôt : le changer ne touche pas les réclamations
 * en cours (étape 4).
 */
import { GripVertical, Info, Pencil, Plus, X } from 'lucide-react';
import type { S } from '../../api/types';
import { BadgeUrgent, Bouton, Champ, Saisie, Texte, cx } from '../../ui/composants';
import { duree } from '../../ui/format';

/** « ≈ 2,1 jours ouvrés » avec la durée d'une journée d'ouverture de la banque. */
function enJours(minutes: number, minutesParJour: number): string {
  const j = minutes / minutesParJour;
  return `≈ ${j.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} jour${j >= 2 ? 's' : ''}`;
}

export function Categories({ categories, enEdition, minutesParJour }: { categories: S<'Categorie'>[]; enEdition: string | null; minutesParJour: number }) {
  const c = categories.find((x) => x.id === enEdition);
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
          <Bouton variante="principal" icone={<Plus aria-hidden size={17} />}>Nouvelle catégorie</Bouton>
        </div>

        <div className="overflow-hidden rounded-xl border border-trait bg-surface">
          <table className="w-full text-left text-[15px]">
            <thead>
              <tr className="border-b border-trait text-[13px] text-encre-3">
                <th scope="col" className="w-10 py-2.5 pl-3"><span className="sr-only">Ordre</span></th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Catégorie</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Priorité</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Délai cible</th>
                <th scope="col" className="py-2.5 pr-4"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {categories.map((x) => (
                <tr key={x.id} className={cx('border-b border-trait last:border-0', x.id === enEdition && 'bg-marque-doux/60', !x.active && 'text-encre-3')}>
                  <td className="py-3 pl-3 align-top text-encre-3"><GripVertical aria-hidden size={18} /></td>
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
                    <Bouton taille="petit" variante="discret" aria-label={`Modifier ${x.nom}`} icone={<Pencil aria-hidden size={15} />} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {c && (
        <aside aria-label={`Modifier ${c.nom}`} className="w-[340px] shrink-0 self-start rounded-xl border border-trait bg-surface">
          <div className="flex items-center justify-between border-b border-trait px-5 py-3.5">
            <h2 className="text-[17px] font-bold">Modifier la catégorie</h2>
            <button type="button" aria-label="Fermer" className="rounded p-1 text-encre-3 hover:bg-fond"><X size={19} /></button>
          </div>
          <form className="flex flex-col gap-5 p-5" onSubmit={(e) => e.preventDefault()}>
            <Champ libelle="Nom">{(id) => <Saisie id={id} defaultValue={c.nom} />}</Champ>
            <Champ libelle="Description" facultatif aide="Affichée au client sous le nom.">
              {(id, d) => <Texte id={id} aria-describedby={d} rows={2} className="min-h-0" defaultValue={c.description ?? ''} />}
            </Champ>
            <fieldset>
              <legend className="text-[15px] font-semibold">Priorité au dépôt</legend>
              <div className="mt-2 flex gap-2">
                {(['NORMALE', 'URGENTE'] as const).map((p) => (
                  <label key={p} className={cx('flex flex-1 cursor-pointer items-center gap-2 rounded-lg border px-3 py-2.5 text-[15px]', c.prioriteParDefaut === p ? 'border-marque bg-marque-doux font-semibold' : 'border-trait-fort')}>
                    <input type="radio" name="priorite" defaultChecked={c.prioriteParDefaut === p} className="h-4 w-4 accent-[var(--marque)]" />
                    {p === 'NORMALE' ? 'Normale' : 'Urgente'}
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className="text-[15px] font-semibold">Délai cible</legend>
              <div className="mt-2 flex items-center gap-2">
                <div className="w-20"><Saisie aria-label="Heures" inputMode="numeric" defaultValue={String(Math.floor(c.delaiCibleMinutes / 60))} className="chiffres text-right" /></div>
                <span className="text-encre-2">h</span>
                <div className="w-20"><Saisie aria-label="Minutes" inputMode="numeric" defaultValue={String(c.delaiCibleMinutes % 60).padStart(2, '0')} className="chiffres text-right" /></div>
                <span className="text-encre-2">min</span>
              </div>
              <p className="chiffres mt-1.5 text-sm text-encre-3">{duree(c.delaiCibleMinutes)} ouvrées, {enJours(c.delaiCibleMinutes, minutesParJour)} d'ouverture avec vos horaires actuels.</p>
            </fieldset>
            <p className="flex gap-2.5 rounded-lg bg-fond p-3 text-sm leading-relaxed text-encre-2">
              <Info aria-hidden size={17} className="mt-0.5 shrink-0 text-encre-3" />
              Le nouveau délai vaut pour les réclamations déposées après l'enregistrement. Celles en cours gardent le leur.
            </p>
            <div className="flex justify-end gap-2">
              <Bouton variante="discret">Annuler</Bouton>
              <Bouton variante="principal">Enregistrer</Bouton>
            </div>
          </form>
        </aside>
      )}
    </div>
  );
}
