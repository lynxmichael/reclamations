/**
 * Espace client après le code OTP : toutes les réclamations de ce client dans cette banque
 * (listerMesReclamations). La session dure 30 minutes et ne voit que ce client.
 */
import { ChevronRight, LogOut } from 'lucide-react';
import type { S } from '../../api/types';
import { BadgeStatut } from '../../ui/composants';
import { date } from '../../ui/format';
import { CadrePortail } from './CadrePortail';

export function Deconnexion() {
  return (
    <button type="button" className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-semibold hover:bg-sur-marque/15">
      <LogOut aria-hidden size={16} />
      Quitter
    </button>
  );
}

export function MesReclamations({ banque, reclamations }: { banque: S<'BanquePublique'>; reclamations: S<'ReclamationClientResume'>[] }) {
  const aConfirmer = reclamations.filter((r) => r.statut === 'RESOLUE').length;
  return (
    <CadrePortail banque={banque} action={<Deconnexion />}>
      <div className="px-5 pt-6 pb-10">
        <h1 className="text-[26px] leading-tight font-bold tracking-tight">Vos réclamations</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-encre-2">
          {aConfirmer > 0
            ? `${aConfirmer === 1 ? 'Une réclamation attend' : `${aConfirmer} réclamations attendent`} votre confirmation.`
            : 'Retrouvez ici les réponses de la banque.'}
        </p>
        <ul className="mt-6 flex flex-col gap-3">
          {reclamations.map((r) => (
            <li key={r.id}>
              <a
                href={`#${r.id}`}
                className="flex items-center gap-3 rounded-xl border border-trait px-4 py-4 hover:border-encre-3 has-[.a-confirmer]:border-resolue/40 has-[.a-confirmer]:bg-resolue-doux/40"
              >
                <div className="min-w-0 flex-1">
                  <p className="chiffres text-[17px] font-bold tracking-wide">{r.numero}</p>
                  <p className="mt-0.5 text-[15px] text-encre-2">{r.categorie}</p>
                  <div className={r.statut === 'RESOLUE' ? 'a-confirmer mt-2.5' : 'mt-2.5'}>
                    <BadgeStatut statut={r.statut} pourClient />
                  </div>
                  <p className="mt-2 text-sm text-encre-3">Déposée le {date(r.creeLe)}</p>
                </div>
                <ChevronRight aria-hidden size={20} className="shrink-0 text-encre-3" />
              </a>
            </li>
          ))}
        </ul>
        <p className="mt-8 text-sm leading-relaxed text-encre-3">Pour votre sécurité, cet espace se ferme après 30 minutes. Un nouveau code vous sera demandé.</p>
      </div>
    </CadrePortail>
  );
}
