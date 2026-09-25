/**
 * Journal d'audit de la banque (listerJournalBanque, verifierJournalBanque). Chaque ligne est
 * chaînée à la précédente par une empreinte SHA-256 (étape 3) : la vérification détecte une
 * ligne modifiée ou supprimée.
 */
import { ChevronDown, ShieldAlert, ShieldCheck } from 'lucide-react';
import type { S } from '../../api/types';
import { Bouton, cx } from '../../ui/composants';
import { dateCourte, nombre } from '../../ui/format';
import { ROLE } from '../../ui/libelles';

const ACTIONS: Record<string, string> = {
  'reclamation.depot': 'Dépôt d\'une réclamation',
  'reclamation.assignation': 'Assignation',
  'reclamation.prise_en_charge': 'Prise en charge',
  'reclamation.reponse_client': 'Réponse au client',
  'reclamation.note_interne': 'Note interne',
  'reclamation.message_client': 'Message du client',
  'reclamation.resolution': 'Résolution',
  'reclamation.confirmation': 'Confirmation du client',
  'reclamation.contestation': 'Contestation du client',
  'reclamation.cloture_automatique': 'Clôture automatique',
  'reclamation.cloture_forcee': 'Clôture forcée',
  'reclamation.priorite': 'Changement de priorité',
  'reclamation.escalade': 'Escalade',
  'sla.alerte_preventive': 'Alerte SLA envoyée',
  'sla.depassement': 'Dépassement SLA et escalade',
  'categorie.modification': 'Catégorie modifiée',
  'utilisateur.connexion': 'Connexion',
  'utilisateur.verrouillage': 'Compte verrouillé (5 échecs)',
};

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

export function Audit({ journal, verification }: { journal: S<'PageAudit'>; verification: S<'VerificationChaine'> }) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">Journal d'audit</h1>
          <p className="mt-1 max-w-[72ch] text-[15px] text-encre-3">Toutes les actions sur les réclamations, le paramétrage et les comptes. Rien ne peut y être modifié ni effacé.</p>
        </div>
      </div>

      <div className={cx('flex items-center gap-4 rounded-xl border p-4', verification.valide ? 'border-resolue/30 bg-resolue-doux/60' : 'border-urgent/30 bg-urgent-doux')}>
        {verification.valide ? <ShieldCheck aria-hidden size={28} className="shrink-0 text-resolue" /> : <ShieldAlert aria-hidden size={28} className="shrink-0 text-urgent" />}
        <div className="flex-1">
          <p className={cx('font-bold', verification.valide ? 'text-resolue' : 'text-urgent')}>
            {verification.valide ? 'Journal intact' : `Rupture détectée à la ligne ${verification.premiereRupture}`}
          </p>
          <p className="chiffres text-[15px] text-encre-2">
            {nombre(verification.lignes)} lignes vérifiées une à une, de la première à la dernière.
          </p>
        </div>
        <Bouton>Vérifier à nouveau</Bouton>
      </div>

      <div className="rounded-xl border border-trait bg-surface">
        <div className="flex flex-wrap gap-2 border-b border-trait px-4 py-3">
          <Filtre libelle="Personne" />
          <Filtre libelle="Action" />
          <Filtre libelle="Réclamation" />
          <Filtre libelle="Période" />
        </div>
        <table className="w-full text-left text-[15px]">
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
                  <div className="font-semibold">{ACTIONS[l.action] ?? l.action}</div>
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
          </tbody>
        </table>
        <div className="flex items-center justify-between border-t border-trait px-5 py-3 text-sm text-encre-3">
          <span className="chiffres">{nombre(journal.pagination.total)} lignes</span>
          <span>Page 1</span>
        </div>
      </div>
    </div>
  );
}
