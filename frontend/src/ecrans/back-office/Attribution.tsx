/**
 * Attribution et escalade automatiques (étape 16, phase 2) : lireReglesTraitement,
 * modifierReglesTraitement, listerGroupes, creerGroupe, modifierGroupe, supprimerGroupe.
 *
 * L'Admin Entreprise choisit le mode, compose les groupes d'agents, confie à chacun des catégories
 * et des agences, et règle le seuil d'escalade à l'Admin Entreprise. Le superviseur consulte : la
 * charge et les absences du jour de chaque agent.
 */
import { useEffect, useState } from 'react';
import { ArrowUpRight, BellRing, Pencil, Plus, Trash2, UserRoundX, UsersRound } from 'lucide-react';
import type { S } from '../../api/types';
import { Dialogue } from '../../ui/Dialogue';
import { Avatar, Bouton, Champ, Liste, Panneau, Saisie, cx } from '../../ui/composants';
import { MODE_ATTRIBUTION, STATUT_UTILISATEUR } from '../../ui/libelles';

type Issue = void | boolean | Promise<boolean>;
type Seuil = number | null;

export interface ActionsAttribution {
  changerMode: (mode: S<'ModeAttribution'>) => Issue;
  enregistrerRegles: (m: S<'ModificationReglesTraitement'>) => Issue;
  creerGroupe: (v: S<'EcritureGroupe'>) => Issue;
  modifierGroupe: (id: string, v: S<'ModificationGroupe'>) => Issue;
  supprimerGroupe: (g: S<'GroupeAgents'>) => Issue;
  occupe?: boolean;
  erreurs?: Record<string, string>;
}

/** Agent qu'on peut mettre dans un groupe (rôle Agent, compte non désactivé). */
export interface AgentDuGroupe {
  id: string;
  nom: string;
  statut: S<'StatutUtilisateur'>;
}

const MODES: S<'ModeAttribution'>[] = ['MANUELLE', 'SUGGESTION', 'AUTOMATIQUE'];
/** Compte pas encore utilisable : ni invitation acceptée, ni compte actif */
const INDISPONIBLE: Record<Exclude<S<'StatutUtilisateur'>, 'ACTIF'>, string> = { INVITE: 'Invitation', DESACTIVE: 'Désactivé' };
const texte = (n: Seuil) => (n === null ? '' : String(n));
/** Saisie d'un seuil : vide (pas de seuil ici), sinon un entier de 101 à 1000 ; undefined si invalide. */
function seuilDe(v: string): Seuil | undefined {
  const t = v.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isInteger(n) && n >= 101 && n <= 1000 ? n : undefined;
}
const pluriel = (n: number, mot: string) => `${n} ${mot}${n > 1 ? 's' : ''}`;

/* ------------------------------------------------------------------ Mode */

function ChoixMode({ mode, modifiable, actions }: { mode: S<'ModeAttribution'>; modifiable: boolean; actions?: ActionsAttribution }) {
  // Choix affiché tout de suite ; il revient au mode enregistré si l'API refuse
  const [choisi, setChoisi] = useState(mode);
  useEffect(() => setChoisi(mode), [mode]);
  const choisir = async (m: S<'ModeAttribution'>) => {
    setChoisi(m);
    if ((await actions?.changerMode(m)) === false) setChoisi(mode);
  };
  return (
    <fieldset>
      <legend className="sr-only">Mode d'attribution</legend>
      <div className="grid grid-cols-3 gap-3">
        {MODES.map((m) => {
          const actif = m === choisi;
          return (
            <label
              key={m}
              className={cx(
                'flex cursor-pointer gap-3 rounded-xl border p-4',
                actif ? 'border-marque bg-marque-doux shadow-[inset_0_0_0_1px_var(--marque)]' : 'border-trait-fort bg-surface hover:border-encre-3',
                !modifiable && 'cursor-default',
              )}
            >
              <input
                type="radio"
                name="mode-attribution"
                value={m}
                checked={actif}
                disabled={!modifiable || actions?.occupe}
                onChange={() => void choisir(m)}
                className="mt-1 h-4 w-4 shrink-0 accent-[var(--marque)]"
              />
              <span>
                <span className="block text-[15px] font-bold">{MODE_ATTRIBUTION[m].libelle}</span>
                <span className="mt-0.5 block text-sm leading-snug text-encre-2">{MODE_ATTRIBUTION[m].description}</span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/* ------------------------------------------------------------------ Groupes */

function CarteGroupe({ g, modifiable, surModifier, surSupprimer }: { g: S<'GroupeAgents'>; modifiable: boolean; surModifier: () => void; surSupprimer: () => void }) {
  const disponibles = g.membres.filter((m) => m.statut === 'ACTIF' && !m.absent).length;
  const recoit = [...g.categories.map((c) => c.nom), ...g.agences.map((a) => `agence ${a.nom}`)];
  return (
    <article aria-label={`Groupe ${g.nom}`} className="flex flex-col rounded-xl border border-trait bg-surface">
      <header className="flex items-start justify-between gap-2 border-b border-trait px-4 py-3">
        <div>
          <h3 className="text-[16px] font-bold">{g.nom}</h3>
          <p className="text-sm text-encre-3">
            {pluriel(g.membres.length, 'agent')}, {disponibles} disponible{disponibles > 1 ? 's' : ''} aujourd'hui
          </p>
        </div>
        {modifiable && (
          <div className="flex shrink-0 gap-0.5">
            <button type="button" aria-label={`Modifier le groupe ${g.nom}`} onClick={surModifier} className="rounded-lg p-2 text-encre-3 hover:bg-fond hover:text-encre"><Pencil size={16} /></button>
            <button type="button" aria-label={`Supprimer le groupe ${g.nom}`} onClick={surSupprimer} className="rounded-lg p-2 text-encre-3 hover:bg-fond hover:text-urgent"><Trash2 size={16} /></button>
          </div>
        )}
      </header>
      <ul className="flex flex-1 flex-col px-4 py-1.5">
        {g.membres.length === 0 && <li className="py-2 text-sm text-encre-3">Aucun agent : ajoutez-en pour que le groupe reçoive des réclamations.</li>}
        {g.membres.map((m) => {
          const indisponible = m.statut !== 'ACTIF' || m.absent;
          return (
            <li key={m.id} className="flex items-center gap-2.5 py-1.5 text-[15px]">
              <Avatar nom={m.nom} taille={26} />
              <span className={cx('min-w-0 flex-1 truncate', indisponible && 'text-encre-3')}>{m.nom}</span>
              {m.statut !== 'ACTIF' ? (
                <span className="rounded-md bg-fond px-1.5 py-0.5 text-xs font-semibold text-encre-3" title={STATUT_UTILISATEUR[m.statut]}>{INDISPONIBLE[m.statut]}</span>
              ) : m.absent ? (
                <span className="inline-flex items-center gap-1 rounded-md bg-alerte-doux px-1.5 py-0.5 text-xs font-semibold text-alerte">
                  <UserRoundX aria-hidden size={12} />
                  Absent aujourd'hui
                </span>
              ) : null}
              <span className="chiffres w-[86px] shrink-0 text-right text-sm text-encre-2" title="Réclamations ouvertes ou en cours">{m.aTraiter} à traiter</span>
            </li>
          );
        })}
      </ul>
      <p className="border-t border-trait px-4 py-2.5 text-sm text-encre-2">
        {recoit.length ? <>Reçoit : {recoit.join(', ')}</> : <span className="text-encre-3">Aucune catégorie ni agence : ce groupe ne reçoit rien pour l'instant.</span>}
      </p>
    </article>
  );
}

function FenetreGroupe({ groupe, agents, actions, surFermer }: { groupe: S<'GroupeAgents'> | null; agents: AgentDuGroupe[]; actions: ActionsAttribution; surFermer: () => void }) {
  const [nom, setNom] = useState(groupe?.nom ?? '');
  const [membres, setMembres] = useState<string[]>(groupe?.membres.map((m) => m.id) ?? []);
  const e = actions.erreurs ?? {};
  // Un membre désactivé depuis reste affiché, pour pouvoir le retirer
  const choix = [...agents, ...(groupe?.membres.filter((m) => !agents.some((a) => a.id === m.id)) ?? [])].sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
  const basculer = (id: string) => setMembres((ms) => (ms.includes(id) ? ms.filter((x) => x !== id) : [...ms, id]));
  const valider = async () => {
    const v = { nom: nom.trim(), membres };
    const ok = groupe ? await actions.modifierGroupe(groupe.id, v) : await actions.creerGroupe(v);
    if (ok !== false) surFermer();
  };
  return (
    <Dialogue
      titre={groupe ? `Modifier le groupe ${groupe.nom}` : 'Nouveau groupe d\'agents'}
      description="Les agents d'un groupe se partagent les réclamations des catégories et des agences qui lui sont confiées."
      surFermer={surFermer}
      pied={
        <>
          <Bouton variante="discret" onClick={surFermer}>Annuler</Bouton>
          <Bouton variante="principal" disabled={nom.trim().length < 2 || actions.occupe} onClick={() => void valider()}>
            {groupe ? 'Enregistrer' : 'Créer le groupe'}
          </Bouton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Champ libelle="Nom du groupe" erreur={e.nom}>
          {(id) => <Saisie id={id} value={nom} onChange={(x) => setNom(x.target.value)} maxLength={120} placeholder="Ex. Monétique, Agences de l'intérieur" invalide={!!e.nom} />}
        </Champ>
        <fieldset>
          <legend className="text-[15px] font-semibold">Agents <span className="font-normal text-encre-3">({membres.length} choisi{membres.length > 1 ? 's' : ''})</span></legend>
          <ul className="mt-2 grid max-h-[280px] grid-cols-2 gap-x-4 overflow-auto rounded-lg border border-trait px-3 py-1.5">
            {choix.length === 0 && <li className="col-span-2 py-2 text-sm text-encre-3">Aucun agent dans la banque : invitez-en depuis la page Personnel.</li>}
            {choix.map((a) => (
              <li key={a.id}>
                <label className="flex items-center gap-2.5 py-1.5 text-[15px]">
                  <input type="checkbox" checked={membres.includes(a.id)} onChange={() => basculer(a.id)} className="h-4 w-4 accent-[var(--marque)]" />
                  <span>{a.nom}</span>
                  {a.statut !== 'ACTIF' && <span className="text-sm text-encre-3">({INDISPONIBLE[a.statut].toLowerCase()})</span>}
                </label>
              </li>
            ))}
          </ul>
          {e.membres && <p className="mt-1.5 text-sm font-semibold text-urgent">{e.membres}</p>}
        </fieldset>
      </div>
    </Dialogue>
  );
}

/* ------------------------------------------------------------------ Règles */

interface LigneCategorie { id: string; groupeId: string; normal: string; urgent: string }
interface LigneAgence { id: string; groupeId: string }

function Seuil({ valeur, surChangement, defaut, libelle, modifiable }: { valeur: string; surChangement: (v: string) => void; defaut: Seuil; libelle: string; modifiable: boolean }) {
  const invalide = seuilDe(valeur) === undefined;
  if (!modifiable) {
    return <span className={cx('chiffres', !valeur && 'text-encre-3')}>{valeur ? `${valeur} %` : defaut ? `${defaut} %` : '—'}</span>;
  }
  return (
    <span className={cx('chiffres inline-flex h-9 w-[104px] items-center rounded-lg border bg-surface pr-2.5', invalide ? 'border-urgent' : 'border-trait-fort')}>
      <input
        aria-label={libelle}
        inputMode="numeric"
        value={valeur}
        onChange={(e) => surChangement(e.target.value.replace(/[^\d]/g, ''))}
        placeholder={defaut ? String(defaut) : '—'}
        maxLength={4}
        aria-invalid={invalide || undefined}
        className="w-full min-w-0 bg-transparent pl-2.5 text-right text-[15px] placeholder:text-encre-3 focus:outline-none"
      />
      <span className="ml-1 text-encre-3">%</span>
    </span>
  );
}

function ChoixGroupe({ valeur, groupes, surChangement, libelle, modifiable }: { valeur: string; groupes: S<'GroupeAgents'>[]; surChangement: (v: string) => void; libelle: string; modifiable: boolean }) {
  if (!modifiable) {
    const g = groupes.find((x) => x.id === valeur);
    return g ? <span className="inline-flex items-center gap-1.5"><UsersRound aria-hidden size={15} className="text-encre-3" />{g.nom}</span> : <span className="text-encre-3">Aucun</span>;
  }
  return (
    <Liste aria-label={libelle} value={valeur} onChange={(e) => surChangement(e.target.value)} className="h-9 max-w-[260px] text-[15px]">
      <option value="">Aucun groupe</option>
      {groupes.map((g) => <option key={g.id} value={g.id}>{g.nom}</option>)}
    </Liste>
  );
}

function Regles({ regles, groupes, modifiable, actions }: { regles: S<'ReglesTraitement'>; groupes: S<'GroupeAgents'>[]; modifiable: boolean; actions?: ActionsAttribution }) {
  const initialesCategories: LigneCategorie[] = regles.categories.map((c) => ({
    id: c.categorie.id, groupeId: c.groupe?.id ?? '', normal: texte(c.seuilEscaladeAdminPourcent), urgent: texte(c.seuilEscaladeAdminUrgentPourcent),
  }));
  const initialesAgences: LigneAgence[] = regles.agences.map((a) => ({ id: a.agence.id, groupeId: a.groupe?.id ?? '' }));
  const [banque, setBanque] = useState({ normal: texte(regles.seuilEscaladeAdminPourcent), urgent: texte(regles.seuilEscaladeAdminUrgentPourcent) });
  const [categories, setCategories] = useState(initialesCategories);
  const [agences, setAgences] = useState(initialesAgences);

  const seuilBanque = { normal: seuilDe(banque.normal), urgent: seuilDe(banque.urgent) };
  const categoriesModifiees = categories.filter((c, i) => JSON.stringify(c) !== JSON.stringify(initialesCategories[i]));
  const agencesModifiees = agences.filter((a, i) => a.groupeId !== initialesAgences[i]!.groupeId);
  const banqueModifiee = banque.normal !== texte(regles.seuilEscaladeAdminPourcent) || banque.urgent !== texte(regles.seuilEscaladeAdminUrgentPourcent);
  const modifiee = banqueModifiee || categoriesModifiees.length > 0 || agencesModifiees.length > 0;
  const valides = seuilBanque.normal !== undefined && seuilBanque.urgent !== undefined
    && categories.every((c) => seuilDe(c.normal) !== undefined && seuilDe(c.urgent) !== undefined);

  const enregistrer = () => {
    const m: S<'ModificationReglesTraitement'> = {};
    if (banqueModifiee) {
      m.seuilEscaladeAdminPourcent = seuilBanque.normal ?? null;
      m.seuilEscaladeAdminUrgentPourcent = seuilBanque.urgent ?? null;
    }
    if (categoriesModifiees.length) {
      m.categories = categoriesModifiees.map((c) => ({
        id: c.id, groupeId: c.groupeId || null, seuilEscaladeAdminPourcent: seuilDe(c.normal) ?? null, seuilEscaladeAdminUrgentPourcent: seuilDe(c.urgent) ?? null,
      }));
    }
    if (agencesModifiees.length) m.agences = agencesModifiees.map((a) => ({ id: a.id, groupeId: a.groupeId || null }));
    void actions?.enregistrerRegles(m);
  };
  const changerCategorie = (i: number, c: Partial<LigneCategorie>) => setCategories(categories.map((x, j) => (j === i ? { ...x, ...c } : x)));
  const nb = (v: Seuil | undefined) => (v === undefined ? null : v);

  return (
    <>
      <Panneau titre="Escalade">
        <ol className="grid grid-cols-3 gap-3 text-sm">
          <li className="rounded-lg bg-fond px-3.5 py-3">
            <span className="chiffres text-[15px] font-bold">75 %</span> du délai cible
            <span className="mt-0.5 flex items-center gap-1.5 text-encre-2"><BellRing aria-hidden size={14} />alerte à l'agent (inchangé)</span>
          </li>
          <li className="rounded-lg bg-fond px-3.5 py-3">
            <span className="chiffres text-[15px] font-bold">100 %</span>, échéance dépassée
            <span className="mt-0.5 flex items-center gap-1.5 text-encre-2"><ArrowUpRight aria-hidden size={14} />escalade au superviseur (inchangé)</span>
          </li>
          <li className="rounded-lg border border-marque bg-marque-doux px-3.5 py-3">
            <span className="text-[15px] font-bold">Au-delà du seuil</span>
            <span className="mt-0.5 flex items-center gap-1.5 text-encre-2"><ArrowUpRight aria-hidden size={14} />l'Admin Entreprise est prévenu</span>
          </li>
        </ol>
        <div className="mt-4 flex flex-wrap items-end gap-6">
          <div className="flex flex-col gap-1.5">
            <span className="text-[15px] font-semibold">Seuil de la banque</span>
            <span className="flex items-center gap-2 text-sm text-encre-2">
              <Seuil valeur={banque.normal} surChangement={(v) => setBanque({ ...banque, normal: v })} defaut={null} libelle="Seuil d'escalade de la banque, réclamations normales" modifiable={modifiable} />
              normales
              <Seuil valeur={banque.urgent} surChangement={(v) => setBanque({ ...banque, urgent: v })} defaut={nb(seuilBanque.normal)} libelle="Seuil d'escalade de la banque, réclamations urgentes" modifiable={modifiable} />
              urgentes
            </span>
          </div>
          <p className="max-w-[60ch] text-sm leading-relaxed text-encre-3">
            En pourcentage du délai cible : à 150 %, l'Admin Entreprise est prévenu quand la moitié du délai s'est encore écoulée après l'échéance, en heures ouvrées.
            Une catégorie peut avoir son propre seuil. Sans seuil, pas d'escalade à l'Admin Entreprise.
          </p>
        </div>
      </Panneau>

      <Panneau titre="Catégories et agences" sansMarge>
        <table className="w-full text-left text-[15px]">
          <caption className="sr-only">Groupe d'agents et seuil d'escalade de chaque catégorie</caption>
          <thead>
            <tr className="border-b border-trait text-[13px] text-encre-3">
              <th scope="col" className="py-2.5 pr-3 pl-5 font-semibold">Catégorie</th>
              <th scope="col" className="px-3 py-2.5 font-semibold">Groupe d'agents</th>
              <th scope="col" className="px-3 py-2.5 font-semibold">Escalade, normales</th>
              <th scope="col" className="py-2.5 pr-5 pl-3 font-semibold">Escalade, urgentes</th>
            </tr>
          </thead>
          <tbody>
            {regles.categories.map((c, i) => {
              const ligne = categories[i]!;
              const normal = seuilDe(ligne.normal);
              return (
                <tr key={c.categorie.id} className="border-b border-trait">
                  <th scope="row" className={cx('py-2 pr-3 pl-5 font-normal', !c.active && 'text-encre-3')}>
                    {c.categorie.nom}
                    {!c.active && <span className="ml-1.5 text-sm">(désactivée)</span>}
                  </th>
                  <td className="px-3 py-2">
                    <ChoixGroupe valeur={ligne.groupeId} groupes={groupes} surChangement={(v) => changerCategorie(i, { groupeId: v })} libelle={`Groupe de la catégorie ${c.categorie.nom}`} modifiable={modifiable} />
                  </td>
                  <td className="px-3 py-2">
                    <Seuil valeur={ligne.normal} surChangement={(v) => changerCategorie(i, { normal: v })} defaut={nb(seuilBanque.normal)} libelle={`Seuil d'escalade, ${c.categorie.nom}, réclamations normales`} modifiable={modifiable} />
                  </td>
                  <td className="py-2 pr-5 pl-3">
                    <Seuil
                      valeur={ligne.urgent}
                      surChangement={(v) => changerCategorie(i, { urgent: v })}
                      defaut={nb(seuilBanque.urgent) ?? nb(normal) ?? nb(seuilBanque.normal)}
                      libelle={`Seuil d'escalade, ${c.categorie.nom}, réclamations urgentes`}
                      modifiable={modifiable}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <table className="w-full text-left text-[15px]">
          <caption className="sr-only">Groupe d'agents de chaque agence</caption>
          <thead>
            <tr className="border-b border-trait text-[13px] text-encre-3">
              <th scope="col" className="w-[30%] py-2.5 pr-3 pl-5 font-semibold">Agence</th>
              <th scope="col" className="py-2.5 pr-5 pl-3 font-semibold">Groupe d'agents</th>
            </tr>
          </thead>
          <tbody>
            {regles.agences.map((a, i) => (
              <tr key={a.agence.id} className="border-b border-trait last:border-0">
                <th scope="row" className={cx('py-2 pr-3 pl-5 font-normal', !a.active && 'text-encre-3')}>
                  {a.agence.nom}
                  {!a.active && <span className="ml-1.5 text-sm">(fermée)</span>}
                </th>
                <td className="py-2 pr-5 pl-3">
                  <ChoixGroupe
                    valeur={agences[i]!.groupeId}
                    groupes={groupes}
                    surChangement={(v) => setAgences(agences.map((x, j) => (j === i ? { ...x, groupeId: v } : x)))}
                    libelle={`Groupe de l'agence ${a.agence.nom}`}
                    modifiable={modifiable}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex items-center justify-between gap-4 border-t border-trait px-5 py-3.5">
          <p className="max-w-[78ch] text-sm leading-relaxed text-encre-3">
            Une réclamation va d'abord à un agent des deux groupes, celui de sa catégorie et celui de son agence ; à défaut, au groupe de la catégorie, puis à celui de l'agence.
            Sans groupe, elle reste dans la file « Reçues » du superviseur.
          </p>
          {modifiable && (
            <div className="flex shrink-0 gap-2">
              {modifiee && (
                <Bouton variante="discret" onClick={() => { setBanque({ normal: texte(regles.seuilEscaladeAdminPourcent), urgent: texte(regles.seuilEscaladeAdminUrgentPourcent) }); setCategories(initialesCategories); setAgences(initialesAgences); }}>
                  Annuler
                </Bouton>
              )}
              <Bouton variante="principal" disabled={!modifiee || !valides || actions?.occupe} onClick={enregistrer}>Enregistrer les règles</Bouton>
            </div>
          )}
        </div>
        {modifiable && !valides && <p className="px-5 pb-3 text-sm font-semibold text-urgent">Un seuil se donne de 101 à 1000 %, ou se laisse vide.</p>}
      </Panneau>
    </>
  );
}

/* ------------------------------------------------------------------ Écran */

export function Attribution({
  regles,
  groupes,
  agents,
  modifiable,
  actions,
}: {
  regles: S<'ReglesTraitement'>;
  groupes: S<'GroupeAgents'>[];
  /** Agents qu'on peut ajouter à un groupe (Admin Entreprise) */
  agents: AgentDuGroupe[];
  /** Admin Entreprise : tout se règle ; superviseur : lecture */
  modifiable: boolean;
  actions?: ActionsAttribution;
}) {
  const [fenetre, setFenetre] = useState<{ type: 'groupe'; groupe: S<'GroupeAgents'> | null } | { type: 'suppression'; groupe: S<'GroupeAgents'> } | null>(null);
  // Les maquettes montrent les commandes de l'Admin Entreprise sans actions branchées
  const peutEcrire = modifiable;
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-[26px] font-bold tracking-tight">Attribution et escalade</h1>
        <p className="mt-1 max-w-[80ch] text-[15px] text-encre-3">
          Chaque nouvelle réclamation peut aller à l'agent disponible le moins chargé du groupe de sa catégorie ou de son agence.
          Un agent absent, ou en dehors des heures d'ouverture de la banque, n'en reçoit pas.
        </p>
      </div>

      <Panneau titre="Mode d'attribution">
        <ChoixMode mode={regles.mode} modifiable={peutEcrire} actions={actions} />
        {regles.mode !== 'MANUELLE' && groupes.length === 0 && (
          <p className="mt-3 text-sm font-semibold text-alerte">Aucun groupe d'agents : créez-en un et confiez-lui des catégories pour que l'attribution s'applique.</p>
        )}
      </Panneau>

      <Panneau
        titre="Groupes d'agents"
        action={peutEcrire && <Bouton taille="petit" icone={<Plus aria-hidden size={14} />} onClick={() => setFenetre({ type: 'groupe', groupe: null })}>Nouveau groupe</Bouton>}
      >
        {groupes.length === 0 ? (
          <p className="text-[15px] text-encre-3">Aucun groupe pour l'instant. Un groupe réunit les agents qui traitent les mêmes catégories ou les mêmes agences.</p>
        ) : (
          <div className="grid grid-cols-3 gap-4">
            {groupes.map((g) => (
              <CarteGroupe
                key={g.id}
                g={g}
                modifiable={peutEcrire}
                surModifier={() => setFenetre({ type: 'groupe', groupe: g })}
                surSupprimer={() => setFenetre({ type: 'suppression', groupe: g })}
              />
            ))}
          </div>
        )}
      </Panneau>

      <Regles key={JSON.stringify(regles)} regles={regles} groupes={groupes} modifiable={peutEcrire} actions={actions} />

      {actions && fenetre?.type === 'groupe' && <FenetreGroupe groupe={fenetre.groupe} agents={agents} actions={actions} surFermer={() => setFenetre(null)} />}
      {actions && fenetre?.type === 'suppression' && (
        <Dialogue
          titre={`Supprimer le groupe ${fenetre.groupe.nom} ?`}
          surFermer={() => setFenetre(null)}
          pied={
            <>
              <Bouton variante="discret" onClick={() => setFenetre(null)}>Annuler</Bouton>
              <Bouton
                variante="danger"
                disabled={actions.occupe}
                onClick={() => void Promise.resolve(actions.supprimerGroupe(fenetre.groupe)).then((ok) => ok !== false && setFenetre(null))}
              >
                Supprimer
              </Bouton>
            </>
          }
        >
          <p className="text-[15px] leading-relaxed text-encre-2">
            {fenetre.groupe.categories.length + fenetre.groupe.agences.length > 0
              ? `Ses ${pluriel(fenetre.groupe.categories.length, 'catégorie')} et ${pluriel(fenetre.groupe.agences.length, 'agence')} n'auront plus de groupe : leurs nouvelles réclamations resteront dans la file du superviseur.`
              : 'Aucune catégorie ni agence ne lui est confiée.'}
            {' '}Les réclamations déjà assignées ne changent pas.
          </p>
        </Dialogue>
      )}
    </div>
  );
}
