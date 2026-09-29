/**
 * Journal d'audit (listerJournalBanque, verifierJournalBanque ; côté plateforme,
 * listerJournalPlateforme et verifierJournalPlateforme). Chaque ligne est chaînée à la précédente
 * par une empreinte SHA-256 (étape 3) : la vérification détecte une ligne modifiée ou supprimée.
 */
import { ChevronDown, ChevronLeft, ChevronRight, ShieldAlert, ShieldCheck } from 'lucide-react';
import type { S } from '../../api/types';
import { Bouton, cx } from '../../ui/composants';
import { ChoixFiltre } from '../../ui/Filtre';
import { dateCourte, nombre } from '../../ui/format';
import { ACTION_AUDIT, ROLE } from '../../ui/libelles';

export type PeriodeAudit = '24h' | '7j' | '30j';

export interface CriteresAudit {
  action?: string;
  acteurId?: string;
  banqueId?: string;
  periode?: PeriodeAudit;
  page: number;
}

const PERIODES: Record<PeriodeAudit, string> = { '24h': '24 dernières heures', '7j': '7 derniers jours', '30j': '30 derniers jours' };

function Acteur({ a }: { a: S<'LigneAudit'>['acteur'] }) {
  if (a.type === 'SYSTEME') return <span className="text-encre-2">Système</span>;
  if (a.type === 'CLIENT') return <span className="text-encre-2">Client <span className="text-encre-3">(identité non conservée)</span></span>;
  return (
    <span>
      <span className="font-semibold">{a.libelle}</span>
      {a.role && <span className="text-encre-3">, {ROLE[a.role as S<'RoleUtilisateur'>] ?? a.role}</span>}
    </span>
  );
}

function Filtre({ libelle }: { libelle: string }) {
  return (
    <button type="button" className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-trait-fort bg-surface px-3 text-sm text-encre-2">
      {libelle}
      <ChevronDown aria-hidden size={15} />
    </button>
  );
}

export function Audit({
  journal,
  verification,
  criteres,
  surCriteres,
  surVerifier,
  verificationEnCours,
  personnes,
  banques,
  chargement,
}: {
  journal: S<'PageAudit'>;
  verification: S<'VerificationChaine'> | null;
  /** Étape 8 : filtres et pagination portés par l'adresse de la page */
  criteres?: CriteresAudit;
  surCriteres?: (c: CriteresAudit) => void;
  surVerifier?: () => void;
  verificationEnCours?: boolean;
  /** Filtre « Personne » (journal d'une banque) */
  personnes?: S<'ReferenceNommee'>[];
  /** Filtre « Banque » (journal de la plateforme) */
  banques?: S<'ReferenceNommee'>[];
  chargement?: boolean;
}) {
  const serveur = !!(criteres && surCriteres);
  const changer = (c: Partial<CriteresAudit>) => surCriteres?.({ ...criteres!, page: 1, ...c });
  const { page, parPage, total } = journal.pagination;
  const pages = Math.max(1, Math.ceil(total / parPage));
  const nomChaine = banques ? (criteres?.banqueId && criteres.banqueId !== 'plateforme' ? banques.find((b) => b.id === criteres.banqueId)?.nom ?? 'la banque' : 'la plateforme') : null;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">Journal d'audit</h1>
          <p className="mt-1 max-w-[72ch] text-[15px] text-encre-3">
            {banques ? 'Les actions de toutes les banques et de la plateforme. Chaque banque a sa propre chaîne, vérifiable séparément.' : 'Toutes les actions sur les réclamations, le paramétrage et les comptes. Rien ne peut y être modifié ni effacé.'}
          </p>
        </div>
      </div>

      {verification ? (
        <div className={cx('flex items-center gap-4 rounded-xl border p-4', verification.valide ? 'border-resolue/30 bg-resolue-doux/60' : 'border-urgent/30 bg-urgent-doux')}>
          {verification.valide ? <ShieldCheck aria-hidden size={28} className="shrink-0 text-resolue" /> : <ShieldAlert aria-hidden size={28} className="shrink-0 text-urgent" />}
          <div className="flex-1">
            <p className={cx('font-bold', verification.valide ? 'text-resolue' : 'text-urgent')}>
              {verification.valide ? `Journal intact${nomChaine ? ` : chaîne de ${nomChaine}` : ''}` : `Rupture détectée à la ligne ${verification.premiereRupture}${nomChaine ? `, chaîne de ${nomChaine}` : ''}`}
            </p>
            <p className="chiffres text-[15px] text-encre-2">
              {nombre(verification.lignes)} lignes vérifiées une à une, de la première à la dernière.
            </p>
          </div>
          <Bouton onClick={surVerifier} disabled={verificationEnCours}>{verificationEnCours ? 'Vérification…' : 'Vérifier à nouveau'}</Bouton>
        </div>
      ) : (
        <div className="flex items-center gap-4 rounded-xl border border-trait bg-surface p-4">
          <ShieldCheck aria-hidden size={28} className="shrink-0 text-encre-3" />
          <p className="flex-1 text-[15px] text-encre-2">Vérifiez que la chaîne{nomChaine ? ` de ${nomChaine}` : ''} n'a pas été modifiée : chaque ligne est recalculée depuis la première.</p>
          <Bouton onClick={surVerifier} disabled={verificationEnCours}>{verificationEnCours ? 'Vérification…' : 'Vérifier la chaîne'}</Bouton>
        </div>
      )}

      <div className="rounded-xl border border-trait bg-surface">
        <div className="flex flex-wrap gap-2 border-b border-trait px-4 py-3">
          {serveur ? (
            <>
              {banques && (
                <ChoixFiltre
                  libelle="Banque"
                  valeur={criteres!.banqueId}
                  options={[{ valeur: 'plateforme', libelle: 'Plateforme (Makor Telecoms)' }, ...banques.map((b) => ({ valeur: b.id, libelle: b.nom }))]}
                  surChoix={(v) => changer({ banqueId: v })}
                />
              )}
              {personnes && <ChoixFiltre libelle="Personne" valeur={criteres!.acteurId} options={personnes.map((p) => ({ valeur: p.id, libelle: p.nom }))} surChoix={(v) => changer({ acteurId: v })} />}
              <ChoixFiltre
                libelle="Action"
                valeur={criteres!.action}
                options={Object.entries(ACTION_AUDIT).map(([valeur, libelle]) => ({ valeur, libelle })).sort((a, b) => a.libelle.localeCompare(b.libelle, 'fr'))}
                surChoix={(v) => changer({ action: v })}
              />
              <ChoixFiltre libelle="Période" valeur={criteres!.periode} options={(Object.keys(PERIODES) as PeriodeAudit[]).map((v) => ({ valeur: v, libelle: PERIODES[v] }))} surChoix={(v) => changer({ periode: v as PeriodeAudit | undefined })} />
            </>
          ) : (
            <>
              <Filtre libelle="Personne" />
              <Filtre libelle="Action" />
              <Filtre libelle="Réclamation" />
              <Filtre libelle="Période" />
            </>
          )}
        </div>
        <table className={cx('w-full text-left text-[15px] transition-opacity', chargement && 'opacity-60')}>
          <thead>
            <tr className="border-b border-trait text-[13px] text-encre-3">
              <th scope="col" className="py-2.5 pr-3 pl-5 font-semibold">N°</th>
              <th scope="col" className="px-3 py-2.5 font-semibold">Date</th>
              <th scope="col" className="px-3 py-2.5 font-semibold">Qui</th>
              <th scope="col" className="px-3 py-2.5 font-semibold">Action</th>
              <th scope="col" className="px-3 py-2.5 font-semibold">Détails</th>
              <th scope="col" className="py-2.5 pr-5 pl-3 font-semibold">Adresse IP</th>
            </tr>
          </thead>
          <tbody>
            {journal.donnees.map((l) => (
              <tr key={l.id} className="border-b border-trait align-top last:border-0">
                <td className="chiffres py-3 pr-3 pl-5 text-sm text-encre-3">{nombre(l.rang)}</td>
                <td className="chiffres px-3 py-3 text-sm whitespace-nowrap">{dateCourte(l.horodatage)}</td>
                <td className="px-3 py-3 text-sm"><Acteur a={l.acteur} /></td>
                <td className="px-3 py-3 text-sm">
                  <div className="font-semibold">{ACTION_AUDIT[l.action] ?? l.action}</div>
                  <div className="text-encre-3">{l.action}</div>
                </td>
                <td className="px-3 py-3 text-sm text-encre-2">
                  {l.entite && <div>{l.entite} {l.entiteId?.slice(-6)}</div>}
                  {l.donnees && (
                    <div className="text-encre-3">
                      {Object.entries(l.donnees).map(([k, v]) => `${k} : ${Array.isArray(v) ? v.join(' → ') : String(v).length > 20 ? `…${String(v).slice(-6)}` : String(v)}`).join(', ')}
                    </div>
                  )}
                </td>
                <td className="chiffres py-3 pr-5 pl-3 text-sm text-encre-3">{l.ip ?? '—'}</td>
              </tr>
            ))}
            {journal.donnees.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-10 text-center text-encre-3">Aucune ligne pour ces critères.</td>
              </tr>
            )}
          </tbody>
        </table>
        <div className="flex items-center justify-between border-t border-trait px-5 py-3 text-sm text-encre-3">
          <span className="chiffres">{nombre(total)} ligne{total > 1 ? 's' : ''}</span>
          {serveur ? (
            <span className="flex items-center gap-2">
              <Bouton taille="petit" variante="discret" aria-label="Page précédente" disabled={page <= 1} onClick={() => surCriteres!({ ...criteres!, page: page - 1 })} icone={<ChevronLeft aria-hidden size={16} />} />
              <span className="chiffres">Page {page} sur {pages}</span>
              <Bouton taille="petit" variante="discret" aria-label="Page suivante" disabled={page >= pages} onClick={() => surCriteres!({ ...criteres!, page: page + 1 })} icone={<ChevronRight aria-hidden size={16} />} />
            </span>
          ) : (
            <span>Page 1</span>
          )}
        </div>
      </div>
    </div>
  );
}
