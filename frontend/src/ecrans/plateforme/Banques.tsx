/**
 * Banques clientes (listerBanques, modifierBanque, suspendreBanque, reactiverBanque) et création
 * d'une banque avec son premier Admin Entreprise en une seule opération (creerBanque, décision C13).
 */
import { useState } from 'react';
import { CirclePause, Info, Plus } from 'lucide-react';
import type { S } from '../../api/types';
import { Dialogue } from '../../ui/Dialogue';
import { Bouton, Champ, Liste, LogoBanque, Saisie, Texte, cx } from '../../ui/composants';
import { date, nombre } from '../../ui/format';

type Issue = void | boolean | Promise<boolean>;

export interface ActionsBanques {
  creer: (v: S<'CreationBanque'>) => Issue;
  modifier: (id: string, v: S<'ModificationBanque'>) => Issue;
  suspendre: (id: string, motif: string) => Issue;
  reactiver: (id: string) => Issue;
  occupe?: boolean;
  erreurs?: Record<string, string>;
}

const FUSEAUX = ['Africa/Abidjan', 'Africa/Dakar', 'Africa/Lagos', 'Africa/Douala', 'Africa/Kinshasa', 'Africa/Casablanca', 'Europe/Paris'];

function Conso({ valeur, plafond }: { valeur: number; plafond: number | null }) {
  const depasse = plafond !== null && valeur > plafond;
  return (
    <div className="w-36">
      <div className="chiffres text-[15px]">
        <span className={cx('font-bold', depasse && 'text-urgent')}>{nombre(valeur)}</span>
        <span className="text-encre-3"> / {plafond === null ? 'illimité' : nombre(plafond)}</span>
      </div>
      {plafond !== null && (
        <div className="mt-1 h-1.5 rounded-full bg-fond">
          <div className={cx('h-full rounded-full', depasse ? 'bg-urgent' : 'bg-marque/70')} style={{ width: `${Math.min(100, (valeur / plafond) * 100)}%` }} />
        </div>
      )}
    </div>
  );
}

export function Banques({
  page,
  plans,
  creation,
  actions,
  adresse = (slug) => `${slug}.reclamations.example`,
}: {
  page: S<'PageBanques'>;
  plans: S<'Plan'>[];
  creation?: boolean;
  actions?: ActionsBanques;
  /** Adresse du portail d'une banque */
  adresse?: (slug: string) => string;
}) {
  const [nouvelle, setNouvelle] = useState(!!creation);
  const [ouverte, setOuverte] = useState<string | null>(null);
  const plan = (id: string) => plans.find((p) => p.id === id);
  const banque = page.donnees.find((b) => b.id === ouverte) ?? null;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">Banques</h1>
          <p className="mt-1 text-[15px] text-encre-3">{page.pagination.total} banque{page.pagination.total > 1 ? 's' : ''} cliente{page.pagination.total > 1 ? 's' : ''}. Consommation du mois en cours.</p>
        </div>
        <Bouton variante="principal" icone={<Plus aria-hidden size={17} />} onClick={() => setNouvelle(true)}>Nouvelle banque</Bouton>
      </div>

      <div className="overflow-hidden rounded-xl border border-trait bg-surface">
        <table className="w-full text-left text-[15px]">
          <thead>
            <tr className="border-b border-trait text-[13px] text-encre-3">
              <th scope="col" className="py-2.5 pr-3 pl-5 font-semibold">Banque</th>
              <th scope="col" className="px-3 py-2.5 font-semibold">Plan</th>
              <th scope="col" className="px-3 py-2.5 font-semibold">Agents</th>
              <th scope="col" className="px-3 py-2.5 font-semibold">Réclamations ce mois</th>
              <th scope="col" className="px-3 py-2.5 font-semibold">Réglages</th>
              <th scope="col" className="px-3 py-2.5 font-semibold">État</th>
              <th scope="col" className="py-2.5 pr-5"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {page.donnees.map((b) => {
              const p = plan(b.plan.id);
              return (
                <tr key={b.id} className="border-b border-trait align-top last:border-0">
                  <td className="py-3.5 pr-3 pl-5">
                    <div className="flex items-center gap-3">
                      <LogoBanque nom={b.nom} logoUrl={null} taille={34} />
                      <div className="leading-snug">
                        <div className="font-semibold">{b.nom}</div>
                        <div className="text-sm text-encre-3">{adresse(b.slug)}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3.5">{b.plan.nom}</td>
                  <td className="px-3 py-3.5"><Conso valeur={b.consommation.agents} plafond={p?.plafondAgents ?? null} /></td>
                  <td className="px-3 py-3.5"><Conso valeur={b.consommation.ticketsCeMois} plafond={p?.plafondTicketsMois ?? null} /></td>
                  <td className="px-3 py-3.5 text-sm leading-relaxed text-encre-2">
                    <div>Préfixe <span className="chiffres font-semibold text-encre">{b.prefixeTickets}</span>, alerte à {b.seuilAlerteSlaPourcent} %</div>
                    <div>Clôture après {b.delaiClotureAutoJours} jours, SMS {b.smsChaqueChangementStatut ? 'à chaque étape' : 'au dépôt et à la résolution'}</div>
                  </td>
                  <td className="px-3 py-3.5">
                    {b.suspendueLe ? (
                      <div className="text-sm">
                        <span className="inline-flex items-center gap-1 rounded-md bg-alerte-doux px-2 py-0.5 text-[13px] font-semibold whitespace-nowrap text-alerte">
                          <CirclePause aria-hidden size={13} />
                          Suspendue le {date(b.suspendueLe).slice(0, 5)}
                        </span>
                        <p className="mt-1 max-w-44 text-encre-3">{b.motifSuspension}</p>
                      </div>
                    ) : (
                      <span className="inline-flex rounded-md bg-resolue-doux px-2 py-0.5 text-[13px] font-semibold text-resolue">Active</span>
                    )}
                  </td>
                  <td className="py-3.5 pr-5 text-right">
                    <Bouton taille="petit" variante="discret" onClick={() => setOuverte(b.id)} aria-label={`Ouvrir ${b.nom}`}>Ouvrir</Bouton>
                  </td>
                </tr>
              );
            })}
            {page.donnees.length === 0 && (
              <tr>
                <td colSpan={7} className="px-5 py-10 text-center text-encre-3">Aucune banque cliente pour l'instant.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {nouvelle && <NouvelleBanque plans={plans.filter((p) => p.actif)} actions={actions} adresse={adresse} surFermer={() => setNouvelle(false)} />}
      {banque && actions && <FicheBanque key={banque.id} b={banque} plans={plans} actions={actions} surFermer={() => setOuverte(null)} />}
    </div>
  );
}

function NouvelleBanque({ plans, actions, adresse, surFermer }: { plans: S<'Plan'>[]; actions?: ActionsBanques; adresse: (slug: string) => string; surFermer: () => void }) {
  const demo = !actions;
  const [nom, setNom] = useState(demo ? 'Banque Kora' : '');
  const [slug, setSlug] = useState(demo ? 'kora' : '');
  const [prefixe, setPrefixe] = useState(demo ? 'KOR' : '');
  const [planId, setPlanId] = useState(plans[0]?.id ?? '');
  const [prenom, setPrenom] = useState(demo ? 'Nathalie' : '');
  const [nomAdmin, setNomAdmin] = useState(demo ? 'Yéo' : '');
  const [email, setEmail] = useState(demo ? 'nathalie.yeo@banque-kora.example' : '');
  const [telephone, setTelephone] = useState('');
  const [{ slug: suggestionSlug, prefixe: suggestionPrefixe }, setSuggestions] = useState({ slug: '', prefixe: '' });
  const e = actions?.erreurs ?? {};
  const valide = nom.trim().length >= 2 && /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(slug) && /^[A-Z0-9]{2,10}$/.test(prefixe) && planId && prenom.trim() && nomAdmin.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const suggerer = (n: string) => {
    setNom(n);
    const base = n.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/^(banque|caisse)\s+/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (!slug || slug === suggestionSlug) setSlug(base.slice(0, 63));
    if (!prefixe || prefixe === suggestionPrefixe) setPrefixe(base.replace(/-/g, '').slice(0, 3).toUpperCase());
    setSuggestions({ slug: base.slice(0, 63), prefixe: base.replace(/-/g, '').slice(0, 3).toUpperCase() });
  };
  const creer = async () => {
    const issue = await actions?.creer({
      nom: nom.trim(),
      slug,
      prefixeTickets: prefixe,
      planId,
      fuseauHoraire: 'Africa/Abidjan',
      administrateur: { prenom: prenom.trim(), nom: nomAdmin.trim(), email: email.trim().toLowerCase(), telephone: telephone.trim() || null },
    });
    if (issue !== false) surFermer();
  };
  return (
    <Dialogue
      cote
      cadre={demo}
      titre="Nouvelle banque"
      surFermer={surFermer}
      pied={
        <>
          <Bouton variante="discret" onClick={surFermer}>Annuler</Bouton>
          <Bouton variante="principal" disabled={!demo && (!valide || actions.occupe)} onClick={() => void creer()}>Créer la banque et inviter l'Admin</Bouton>
        </>
      }
    >
      <form className="flex flex-col gap-6" onSubmit={(x) => x.preventDefault()}>
        <fieldset className="flex flex-col gap-4">
          <legend className="mb-1 text-[17px] font-bold">La banque</legend>
          <Champ libelle="Nom" erreur={e.nom}>{(id) => <Saisie id={id} value={nom} onChange={(x) => suggerer(x.target.value)} maxLength={160} />}</Champ>
          <div className="grid grid-cols-[minmax(0,1fr)_130px] gap-3">
            <Champ libelle="Adresse du portail" aide={slug ? adresse(slug) : 'lettres minuscules, chiffres, tirets'} erreur={e.slug}>
              {(id, d) => <Saisie id={id} aria-describedby={d} value={slug} onChange={(x) => setSlug(x.target.value.toLowerCase().trim())} maxLength={63} invalide={!!e.slug} />}
            </Champ>
            <Champ libelle="Préfixe" aide={prefixe ? `${prefixe}-${new Date().getFullYear()}-000001` : '2 à 10 caractères'} erreur={e.prefixeTickets}>
              {(id, d) => <Saisie id={id} aria-describedby={d} value={prefixe} onChange={(x) => setPrefixe(x.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} maxLength={10} className="chiffres uppercase" invalide={!!e.prefixeTickets} />}
            </Champ>
          </div>
          <fieldset>
            <legend className="text-[15px] font-semibold">Plan</legend>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {plans.map((p) => (
                <label key={p.id} className={cx('flex cursor-pointer flex-col gap-0.5 rounded-lg border px-3 py-2.5', p.id === planId ? 'border-marque bg-marque-doux ring-1 ring-marque' : 'border-trait-fort')}>
                  <input type="radio" name="plan" checked={p.id === planId} onChange={() => setPlanId(p.id)} className="sr-only" />
                  <span className="font-semibold">{p.nom}</span>
                  <span className="chiffres text-sm text-encre-3">
                    {p.plafondAgents === null ? 'Agents illimités' : `${p.plafondAgents} agents`}, {p.plafondTicketsMois === null ? 'réclamations illimitées' : `${nombre(p.plafondTicketsMois)} récl./mois`}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        </fieldset>

        <fieldset className="flex flex-col gap-4">
          <legend className="mb-1 text-[17px] font-bold">Son premier Admin Entreprise</legend>
          <div className="grid grid-cols-2 gap-3">
            <Champ libelle="Prénom">{(id) => <Saisie id={id} value={prenom} onChange={(x) => setPrenom(x.target.value)} />}</Champ>
            <Champ libelle="Nom">{(id) => <Saisie id={id} value={nomAdmin} onChange={(x) => setNomAdmin(x.target.value)} />}</Champ>
          </div>
          <Champ libelle="E-mail professionnel" erreur={e.email}>{(id) => <Saisie id={id} type="email" value={email} onChange={(x) => setEmail(x.target.value)} invalide={!!e.email} />}</Champ>
          <Champ libelle="Téléphone" facultatif>{(id) => <Saisie id={id} type="tel" value={telephone} onChange={(x) => setTelephone(x.target.value)} />}</Champ>
        </fieldset>

        <p className="flex gap-2.5 rounded-lg bg-fond p-3 text-sm leading-relaxed text-encre-2">
          <Info aria-hidden size={17} className="mt-0.5 shrink-0 text-encre-3" />
          La banque démarre avec les horaires lun–ven 08:00–17:00, le fuseau d'Abidjan, une alerte à 75 % et la clôture automatique après 5 jours. L'Admin reçoit une invitation par e-mail pour choisir son mot de passe.
        </p>
      </form>
    </Dialogue>
  );
}

function FicheBanque({ b, plans, actions, surFermer }: { b: S<'BanquePlateforme'>; plans: S<'Plan'>[]; actions: ActionsBanques; surFermer: () => void }) {
  const [nom, setNom] = useState(b.nom);
  const [planId, setPlanId] = useState(b.plan.id);
  const [fuseau, setFuseau] = useState(b.fuseauHoraire);
  const [seuil, setSeuil] = useState(String(b.seuilAlerteSlaPourcent));
  const [delai, setDelai] = useState(String(b.delaiClotureAutoJours));
  const [sms, setSms] = useState(b.smsChaqueChangementStatut);
  const [motif, setMotif] = useState('');
  const e = actions.erreurs ?? {};
  const valide = nom.trim().length >= 2 && Number(seuil) >= 1 && Number(seuil) <= 99 && Number(delai) >= 1 && Number(delai) <= 60;
  const enregistrer = async () => {
    const issue = await actions.modifier(b.id, { nom: nom.trim(), planId, fuseauHoraire: fuseau, seuilAlerteSlaPourcent: Number(seuil), delaiClotureAutoJours: Number(delai), smsChaqueChangementStatut: sms });
    if (issue !== false) surFermer();
  };
  return (
    <Dialogue
      cote
      titre={b.nom}
      description={`Cliente depuis le ${date(b.creeLe)} · préfixe ${b.prefixeTickets}`}
      surFermer={surFermer}
      pied={
        <>
          <Bouton variante="discret" onClick={surFermer}>Fermer</Bouton>
          <Bouton variante="principal" disabled={!valide || actions.occupe} onClick={() => void enregistrer()}>Enregistrer les réglages</Bouton>
        </>
      }
    >
      <div className="flex flex-col gap-6">
        <fieldset className="flex flex-col gap-4">
          <legend className="mb-1 text-[17px] font-bold">Contrat et réglages (décision C12)</legend>
          <Champ libelle="Nom" erreur={e.nom}>{(id) => <Saisie id={id} value={nom} onChange={(x) => setNom(x.target.value)} maxLength={160} />}</Champ>
          <div className="grid grid-cols-2 gap-3">
            <Champ libelle="Plan" erreur={e.planId}>
              {(id) => (
                <Liste id={id} value={planId} onChange={(x) => setPlanId(x.target.value)}>
                  {plans.filter((p) => p.actif || p.id === b.plan.id).map((p) => (
                    <option key={p.id} value={p.id}>{p.nom}</option>
                  ))}
                </Liste>
              )}
            </Champ>
            <Champ libelle="Fuseau horaire" erreur={e.fuseauHoraire}>
              {(id) => (
                <Liste id={id} value={fuseau} onChange={(x) => setFuseau(x.target.value)}>
                  {[...new Set([fuseau, ...FUSEAUX])].map((f) => (
                    <option key={f} value={f}>{f.replace('_', ' ')}</option>
                  ))}
                </Liste>
              )}
            </Champ>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Champ libelle="Seuil d'alerte SLA (%)" aide="Alerte préventive à ce pourcentage du délai" erreur={e.seuilAlerteSlaPourcent}>
              {(id, d) => <Saisie id={id} aria-describedby={d} inputMode="numeric" value={seuil} onChange={(x) => setSeuil(x.target.value.replace(/\D/g, ''))} className="chiffres" />}
            </Champ>
            <Champ libelle="Clôture automatique (jours)" aide="Sans réponse du client après la résolution" erreur={e.delaiClotureAutoJours}>
              {(id, d) => <Saisie id={id} aria-describedby={d} inputMode="numeric" value={delai} onChange={(x) => setDelai(x.target.value.replace(/\D/g, ''))} className="chiffres" />}
            </Champ>
          </div>
          <label className="flex items-start gap-2.5 text-[15px]">
            <input type="checkbox" checked={sms} onChange={(x) => setSms(x.target.checked)} className="mt-1 h-4 w-4 accent-[var(--marque)]" />
            <span>
              SMS au client à chaque changement de statut
              <span className="block text-sm text-encre-3">Sinon, au dépôt et à la résolution seulement. Chaque SMS est refacturé à la banque.</span>
            </span>
          </label>
        </fieldset>

        <fieldset className="flex flex-col gap-3 rounded-xl border border-trait p-4">
          <legend className="px-1 text-[17px] font-bold">{b.suspendueLe ? 'Banque suspendue' : 'Suspendre la banque'}</legend>
          {b.suspendueLe ? (
            <>
              <p className="text-[15px] leading-relaxed text-encre-2">
                Suspendue le {date(b.suspendueLe)} : {b.motifSuspension}. Son portail et sa console sont fermés ; ses données sont conservées.
              </p>
              <Bouton className="self-start" disabled={actions.occupe} onClick={() => void actions.reactiver(b.id)}>Réactiver la banque</Bouton>
            </>
          ) : (
            <>
              <p className="text-[15px] leading-relaxed text-encre-2">Le portail n'accepte plus de réclamations et le personnel ne peut plus se connecter. Les données sont conservées et la réactivation rétablit tout.</p>
              <Champ libelle="Motif" erreur={e.motif}>{(id) => <Texte id={id} rows={2} className="min-h-0" value={motif} onChange={(x) => setMotif(x.target.value)} maxLength={500} placeholder="Ex. impayé du mois d'août" />}</Champ>
              <Bouton variante="danger" className="self-start" disabled={!motif.trim() || actions.occupe} onClick={() => void actions.suspendre(b.id, motif.trim())}>
                Suspendre
              </Bouton>
            </>
          )}
        </fieldset>
      </div>
    </Dialogue>
  );
}
