/**
 * Galerie des maquettes : navigation entre les écrans, variantes (rôle, état), marque de la
 * banque, et pour chaque écran les opérations du contrat qui l'alimentent.
 *   #/                                  sommaire et système visuel
 *   #/<groupe>/<écran>?role=AGENT       un écran, dans son cadre
 *   #/<groupe>/<écran>?brut=1           l'écran seul, sans cadre (captures)
 */
import type { ReactNode } from 'react';
import { Link, NavLink, useNavigate, useParams, useSearchParams } from 'react-router';
import { ChevronLeft, ChevronRight, Maximize2 } from 'lucide-react';
import operations from 'virtual:contrat-operations';
import type { S } from '../../api/types';
import { cx } from '../../ui/composants';
import { ROLE } from '../../ui/libelles';
import { ECRANS, GROUPES, type Ecran } from '../catalogue';
import { ALPHA, HORIZON } from '../donnees/commun';
import { LARGEUR_BUREAU, LARGEUR_TELEPHONE, Navigateur, Telephone } from './Cadres';
import { SystemeVisuel } from './SystemeVisuel';

const BANQUES: Record<string, S<'BanquePublique'>> = { alpha: ALPHA, horizon: HORIZON };

function Menu({ actif }: { actif?: string }) {
  return (
    <nav aria-label="Écrans" className="flex flex-col gap-6">
      {GROUPES.map((g) => {
        const ecrans = ECRANS.filter((e) => e.groupe === g.cle);
        const Liste = g.parcours ? 'ol' : 'ul';
        return (
          <div key={g.cle}>
            <p className="px-3 text-[13px] font-bold text-encre-2">{g.titre}</p>
            <Liste className="mt-1.5 flex flex-col gap-0.5">
              {ecrans.map((e, i) => (
                <li key={e.id}>
                  <NavLink
                    to={`/${e.groupe}/${e.id}`}
                    className={cx(
                      'flex items-baseline gap-2.5 rounded-lg px-3 py-1.5 text-[15px]',
                      e.id === actif ? 'bg-encre text-white' : 'text-encre-2 hover:bg-fond hover:text-encre',
                    )}
                  >
                    {g.parcours && <span className={cx('chiffres w-3 text-[13px]', e.id === actif ? 'text-white/70' : 'text-encre-3')}>{i + 1}</span>}
                    {e.titre}
                  </NavLink>
                </li>
              ))}
            </Liste>
          </div>
        );
      })}
    </nav>
  );
}

function Mise({ actif, children }: { actif?: string; children: ReactNode }) {
  const navigate = useNavigate();
  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-[268px] shrink-0 flex-col overflow-y-auto border-r border-trait bg-surface px-3 py-5 lg:flex">
        <Link to="/" className="mb-6 block px-3">
          <span className="block text-[17px] font-bold">Maquettes des écrans</span>
          <span className="block text-sm text-encre-3">Réclamations, étape 6</span>
        </Link>
        <Menu actif={actif} />
      </aside>
      <div className="min-w-0 flex-1">
        <div className="border-b border-trait bg-surface px-4 py-3 lg:hidden">
          <label className="flex items-center gap-2 text-sm font-semibold">
            Écran
            <select
              className="h-10 flex-1 rounded-lg border border-trait-fort bg-surface px-2 text-[15px]"
              value={actif ?? ''}
              onChange={(ev) => {
                const e = ECRANS.find((x) => x.id === ev.target.value);
                navigate(e ? `/${e.groupe}/${e.id}` : '/');
              }}
            >
              <option value="">Sommaire</option>
              {GROUPES.map((g) => (
                <optgroup key={g.cle} label={g.titre}>
                  {ECRANS.filter((e) => e.groupe === g.cle).map((e) => (
                    <option key={e.id} value={e.id}>{e.titre}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Sommaire() {
  return (
    <Mise>
      <div className="mx-auto flex max-w-[980px] flex-col gap-10 px-5 py-10 lg:px-10">
        <header>
          <h1 className="text-[34px] leading-tight font-bold tracking-tight">Maquettes des écrans</h1>
          <p className="mt-3 max-w-[68ch] text-[17px] leading-relaxed text-encre-2">
            {ECRANS.length} écrans construits sur le contrat d'API de l'étape 5. Chaque donnée affichée est une réponse valide de l'API, et chaque bouton d'une réclamation
            vient de la machine d'états de l'étape 4 : les tests le vérifient. Ces composants deviendront les écrans réels à l'étape 8.
          </p>
        </header>
        <div className="grid gap-5 md:grid-cols-2">
          {GROUPES.map((g) => (
            <section key={g.cle} className="rounded-xl border border-trait bg-surface p-5">
              <h2 className="text-[19px] font-bold">{g.titre}</h2>
              <p className="mt-1 text-[15px] text-encre-3">{g.resume}</p>
              <ul className="mt-4 flex flex-col">
                {ECRANS.filter((e) => e.groupe === g.cle).map((e) => (
                  <li key={e.id} className="border-t border-trait first:border-0">
                    <Link to={`/${e.groupe}/${e.id}`} className="flex items-center justify-between py-2 text-[15px] font-semibold hover:text-focus">
                      {e.titre}
                      <span className="text-sm font-normal text-encre-3">{e.format === 'mobile' ? 'téléphone' : 'ordinateur'}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <SystemeVisuel />
      </div>
    </Mise>
  );
}

function valeurs(e: Ecran, params: URLSearchParams): Record<string, string> {
  return Object.fromEntries((e.variantes ?? []).map((v) => [v.cle, params.get(v.cle) ?? v.options[0]!.valeur]));
}

function Segments({ libelle, options, valeur, surChoix }: { libelle: string; options: { valeur: string; libelle: string }[]; valeur: string; surChoix: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-encre-3">{libelle}</span>
      <div role="radiogroup" aria-label={libelle} className="flex rounded-lg bg-fond p-0.5 ring-1 ring-trait">
        {options.map((o) => (
          <button
            key={o.valeur}
            type="button"
            role="radio"
            aria-checked={o.valeur === valeur}
            onClick={() => surChoix(o.valeur)}
            className={cx('rounded-md px-2.5 py-1 text-sm font-semibold whitespace-nowrap', o.valeur === valeur ? 'bg-surface text-encre shadow-sm ring-1 ring-trait' : 'text-encre-3 hover:text-encre')}
          >
            {o.libelle}
          </button>
        ))}
      </div>
    </div>
  );
}

function Notes({ e }: { e: Ecran }) {
  return (
    <div className="flex flex-col gap-6 text-[15px]">
      <section>
        <h2 className="text-sm font-bold text-encre-2">Qui le voit</h2>
        <p className="mt-1.5 leading-relaxed">{e.roles}</p>
      </section>
      <section>
        <h2 className="text-sm font-bold text-encre-2">Ce qu'il faut retenir</h2>
        <ul className="mt-1.5 flex list-disc flex-col gap-2 pl-5 leading-relaxed marker:text-encre-3">
          {e.notes.map((n) => <li key={n}>{n}</li>)}
        </ul>
      </section>
      <section>
        <h2 className="text-sm font-bold text-encre-2">Appels au contrat</h2>
        <ul className="mt-2 flex flex-col gap-2">
          {e.operations.map((id) => {
            const op = operations[id];
            return (
              <li key={id} className="rounded-lg bg-surface px-3 py-2 ring-1 ring-trait">
                {op ? (
                  <>
                    <p className="chiffres text-[13px] break-all">
                      <span className={cx('mr-1.5 font-bold', op.methode === 'GET' ? 'text-ouverte' : op.methode === 'DELETE' ? 'text-urgent' : 'text-resolue')}>{op.methode}</span>
                      {op.chemin}
                    </p>
                    <p className="mt-0.5 text-sm text-encre-2">
                      {op.resume}
                      <span className="text-encre-3"> ({op.roles.map((r) => (r in ROLE ? ROLE[r as keyof typeof ROLE] : r === 'PUBLIC' ? 'public' : 'client')).join(', ')})</span>
                    </p>
                  </>
                ) : (
                  <p className="font-semibold text-urgent">Opération inconnue : {id}</p>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

export function VueEcran() {
  const { ecran } = useParams();
  const [params, setParams] = useSearchParams();
  const index = ECRANS.findIndex((x) => x.id === ecran);
  const e = ECRANS[index];
  if (!e) return <Sommaire />;
  const v = valeurs(e, params);
  const banque = (e.marque && BANQUES[params.get('banque') ?? '']) || ALPHA;
  const contenu = e.rendu({ v, banque });
  const choisir = (cle: string, valeur: string) => {
    const p = new URLSearchParams(params);
    p.set(cle, valeur);
    setParams(p, { replace: true });
  };

  if (params.get('brut') === '1') {
    return (
      <div className="flex min-h-screen flex-col bg-surface [&>*]:grow" style={e.format === 'mobile' ? { width: LARGEUR_TELEPHONE } : { minWidth: LARGEUR_BUREAU }}>
        {contenu}
      </div>
    );
  }

  const precedent = ECRANS[index - 1];
  const suivant = ECRANS[index + 1];
  const brut = new URLSearchParams(params);
  brut.set('brut', '1');

  return (
    <Mise actif={e.id}>
      <div className="flex flex-col gap-5 px-5 py-6 lg:px-8">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="mr-auto">
            <p className="text-sm text-encre-3">{GROUPES.find((g) => g.cle === e.groupe)!.titre}</p>
            <h1 className="text-2xl font-bold tracking-tight">{e.titre}</h1>
          </div>
          {e.variantes?.map((va) => <Segments key={va.cle} libelle={va.libelle} options={va.options} valeur={v[va.cle]!} surChoix={(x) => choisir(va.cle, x)} />)}
          {e.marque && (
            <Segments
              libelle="Banque"
              options={[{ valeur: 'alpha', libelle: 'Alpha' }, { valeur: 'horizon', libelle: 'Horizon' }]}
              valeur={banque.slug}
              surChoix={(x) => choisir('banque', x)}
            />
          )}
          <Link to={`/${e.groupe}/${e.id}?${brut.toString()}`} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-semibold text-encre-2 ring-1 ring-trait hover:bg-surface">
            <Maximize2 aria-hidden size={14} />
            Écran seul
          </Link>
        </div>

        {e.format === 'mobile' ? (
          <div className="flex flex-col items-center gap-8 xl:flex-row xl:items-start">
            <Telephone couleur={banque.couleurPrimaire}>{contenu}</Telephone>
            <div className="w-full max-w-[520px] xl:pt-2">
              <Notes e={e} />
            </div>
          </div>
        ) : (
          <>
            <Navigateur adresse={e.adresse(banque)}>{contenu}</Navigateur>
            <div className="max-w-[980px] pt-2">
              <Notes e={e} />
            </div>
          </>
        )}

        <div className="flex justify-between border-t border-trait-fort pt-4 text-[15px] font-semibold">
          {precedent ? (
            <Link to={`/${precedent.groupe}/${precedent.id}`} className="inline-flex items-center gap-1 text-encre-2 hover:text-encre">
              <ChevronLeft aria-hidden size={18} />
              {precedent.titre}
            </Link>
          ) : <span />}
          {suivant && (
            <Link to={`/${suivant.groupe}/${suivant.id}`} className="inline-flex items-center gap-1 text-encre-2 hover:text-encre">
              {suivant.titre}
              <ChevronRight aria-hidden size={18} />
            </Link>
          )}
        </div>
      </div>
    </Mise>
  );
}
