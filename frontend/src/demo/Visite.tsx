/**
 * La visite guidée : le parcours complet d'une réclamation, raconté étape par étape. Chaque étape
 * met en évidence l'élément concerné ; « Le faire pour moi » exécute l'action à la place du
 * présentateur, qui peut aussi la faire lui-même (la visite le détecte).
 */
import { Check, ChevronLeft, ChevronRight, Minimize2, Sparkles, X } from 'lucide-react';
import type { S } from '../api/types';
import { cx } from '../ui/composants';
import { dateCourte, duree } from '../ui/format';
import { SAISIE_EXEMPLE, SUGGESTIONS, type Demo } from './useDemo';

export interface EtapeVisite {
  id: string;
  cote: 'client' | 'banque';
  titre: (d: Demo) => string;
  texte: (d: Demo) => string;
  cible?: (d: Demo) => string | null;
  preparer?: (d: Demo) => void;
  faire?: { libelle: string; action: (d: Demo) => void };
  fait?: (d: Demo) => boolean;
}

const ticket = (d: Demo) => (d.demoId ? d.moteur.ticket(d.demoId) : null);
const statut = (d: Demo): S<'StatutReclamation'> | null => ticket(d)?.statut ?? null;

function ouvrirFicheEnTantQue(d: Demo, role: 'SUPERVISEUR' | 'AGENT' | 'ADMIN_ENTREPRISE') {
  if (!d.demoId) return;
  d.setBanque({ role, page: 'reclamations', ficheId: d.demoId, notifs: false });
}

export const ETAPES: EtapeVisite[] = [
  {
    id: 'qr',
    cote: 'client',
    titre: () => 'Le client scanne le QR code de l\'agence',
    texte: (d) =>
      `Dans le hall de l'agence Plateau, une affiche porte un QR code. L'appareil photo du téléphone suffit : le formulaire s'ouvre aux couleurs de ${d.moteur.banque.nom}, l'agence déjà renseignée. Rien à installer, aucun compte à créer.`,
    preparer: (d) => {
      if (!d.demoId) d.setClient({ e: 'depot', erreur: null, saisie: SAISIE_EXEMPLE, version: Date.now() });
      d.setBanque({ role: 'SUPERVISEUR', page: 'reclamations', ficheId: null, notifs: false });
    },
  },
  {
    id: 'depot',
    cote: 'client',
    titre: () => 'Il décrit son problème en une minute',
    texte: () =>
      'Le formulaire est rempli pour la démo : changez la catégorie ou le texte si vous le souhaitez, puis envoyez. Un téléphone ou un e-mail suffit pour être recontacté.',
    cible: (d) => (d.client.e === 'depot' ? 'envoyer-depot' : null),
    faire: { libelle: 'Envoyer pour moi', action: (d) => d.actionsClient.deposer({ ...SAISIE_EXEMPLE, agenceId: null }) },
    fait: (d) => d.demoId !== null,
  },
  {
    id: 'sms',
    cote: 'client',
    titre: () => 'Il reçoit son numéro par SMS',
    texte: (d) =>
      `Le numéro ${ticket(d)?.numero ?? ''} s'affiche et part aussitôt par SMS et par e-mail, avec un lien de suivi. Le message ne contient jamais le détail de la réclamation : seulement le numéro et le lien.`,
    cible: () => 'sms',
  },
  {
    id: 'file',
    cote: 'banque',
    titre: () => 'Elle arrive aussitôt dans la file « Reçues »',
    texte: (d) => {
      const t = ticket(d);
      const cat = t ? d.moteur.categorie(t.categorieId) : null;
      return `Le superviseur la voit parmi les réclamations à assigner, avec son chrono SLA : ${cat ? duree(cat.delaiCibleMinutes) : ''} en heures d'ouverture pour la catégorie « ${cat?.nom ?? ''} ». Le chrono ne compte ni la nuit, ni le week-end, ni les jours fériés.`;
    },
    preparer: (d) => d.setBanque({ role: 'SUPERVISEUR', page: 'reclamations', ficheId: null, notifs: false }),
    cible: () => 'ligne-en-avant',
  },
  {
    id: 'assigner',
    cote: 'banque',
    titre: () => 'Le superviseur l\'assigne à un agent',
    texte: () => 'Serge Kouadio, superviseur, choisit un agent dans la fiche. Aya Konan est prévenue aussitôt, dans l\'application et par e-mail.',
    preparer: (d) => ouvrirFicheEnTantQue(d, 'SUPERVISEUR'),
    cible: () => 'assigner',
    faire: {
      libelle: 'Assigner à Aya Konan',
      action: (d) => d.demoId && d.actionsFiche(d.demoId).assigner?.(d.moteur.agentsAssignables().find((a) => a.nom.startsWith('Aya'))!.id),
    },
    fait: (d) => !!ticket(d)?.agentId,
  },
  {
    id: 'repondre',
    cote: 'banque',
    titre: () => 'L\'agent répond au client',
    texte: () =>
      'Aya Konan, connectée à son tour, répond depuis la fiche : le client reçoit un SMS avec le lien. En cochant « Attendre la réponse du client », elle poserait une question et le chrono se mettrait en pause.',
    preparer: (d) => ouvrirFicheEnTantQue(d, 'AGENT'),
    cible: () => 'envoyer-reponse',
    faire: { libelle: 'Envoyer la réponse', action: (d) => d.demoId && d.actionsFiche(d.demoId).repondre?.(SUGGESTIONS.reponse, false, []) },
    fait: (d) => !!ticket(d)?.premiereReponseLe,
  },
  {
    id: 'alerte',
    cote: 'banque',
    titre: () => 'Le temps passe : l\'alerte à 75 %',
    texte: (d) => {
      const t = ticket(d);
      const quand = t?.alertePreventiveLe ? ` (${dateCourte(t.alertePreventiveLe.toISOString())})` : '';
      return `Avançons l'horloge jusqu'au seuil d'alerte${quand}. L'agent est prévenu. Si l'échéance passait, la réclamation serait escaladée à son superviseur, sans que personne n'ait à y penser.`;
    },
    preparer: (d) => ouvrirFicheEnTantQue(d, 'AGENT'),
    cible: () => 'horloge',
    faire: {
      libelle: 'Avancer jusqu\'à l\'alerte',
      action: (d) => {
        const alerte = d.demoId ? d.moteur.jalonsDe(d.demoId).alerte : null;
        if (alerte) d.avancerHorloge(alerte);
      },
    },
    fait: (d) => !!ticket(d)?.alerteEnvoyee || statut(d) === 'RESOLUE' || statut(d) === 'CLOTUREE',
  },
  {
    id: 'resoudre',
    cote: 'banque',
    titre: () => 'L\'agent résout la réclamation',
    texte: () =>
      'La réponse finale est obligatoire. Le client a 5 jours pour confirmer ou contester ; sans réponse, la réclamation se clôture d\'elle-même.',
    preparer: (d) => ouvrirFicheEnTantQue(d, 'AGENT'),
    cible: () => 'resoudre',
    faire: { libelle: 'Résoudre pour moi', action: (d) => d.demoId && d.actionsFiche(d.demoId).resoudre?.(SUGGESTIONS.resolution) },
    fait: (d) => statut(d) === 'RESOLUE' || statut(d) === 'CLOTUREE',
  },
  {
    id: 'code',
    cote: 'client',
    titre: () => 'Le client lit la réponse, protégée par un code',
    texte: () =>
      'Il touche le lien du SMS. Pour lire les échanges, il reçoit un code à 6 chiffres : même si quelqu\'un d\'autre voit le SMS, il ne peut rien lire.',
    preparer: (d) => {
      if (d.client.e !== 'detail' && d.jetonDemo) d.actionsClient.suivre(d.jetonDemo);
    },
    cible: (d) => (d.client.e === 'suivi' ? 'demander-code' : d.client.e === 'code' ? (d.client.saisi ? 'valider-code' : 'sms') : null),
    faire: { libelle: 'Le faire pour moi', action: (d) => d.jetonDemo && d.actionsClient.ouvrirAvecCode(d.jetonDemo) },
    fait: (d) => d.client.e === 'detail',
  },
  {
    id: 'confirmer',
    cote: 'client',
    titre: () => 'Il confirme en un clic',
    texte: () =>
      'La solution lui convient : la réclamation est clôturée. S\'il conteste, elle revient chez l\'agent avec son motif et le chrono reprend là où il s\'était arrêté.',
    cible: () => 'confirmer',
    faire: { libelle: 'Confirmer pour moi', action: (d) => d.demoId && d.actionsClient.confirmer(d.demoId) },
    fait: (d) => statut(d) === 'CLOTUREE',
  },
  {
    id: 'tableau',
    cote: 'banque',
    titre: () => 'Tout est mesuré',
    texte: () =>
      'Délai de première réponse, délai de résolution, respect du SLA, résolution au premier contact : sur 30 jours, par catégorie, par agence et par canal. La réclamation de la démo y est déjà comptée.',
    preparer: (d) => d.setBanque({ role: 'SUPERVISEUR', page: 'tableau', ficheId: null, notifs: false }),
  },
  {
    id: 'audit',
    cote: 'banque',
    titre: () => 'Tout est tracé',
    texte: () =>
      'Chaque action, du dépôt à la confirmation, est inscrite dans un journal chaîné : une ligne modifiée ou supprimée se voit à la vérification. Il est réservé à l\'Admin Entreprise.',
    preparer: (d) => d.setBanque({ role: 'ADMIN_ENTREPRISE', page: 'audit', ficheId: null, notifs: false }),
  },
  {
    id: 'fin',
    cote: 'banque',
    titre: (d) => `Prêt pour ${d.moteur.banque.nom} ?`,
    texte: (d) =>
      `Votre portail à vos couleurs sur votre adresse, vos agences et leurs QR codes, vos catégories et vos délais, vos horaires et jours fériés. Makor Telecoms vous accompagne pour la mise en service.${d.prospect.contact ? `\n\nVotre contact : ${d.prospect.contact}` : ''}`,
  },
];

export function CarteVisite({
  d,
  index,
  surAller,
  surQuitter,
  surReduire,
  reduite,
  integree,
}: {
  d: Demo;
  index: number;
  surAller: (i: number) => void;
  surQuitter: () => void;
  surReduire: () => void;
  reduite: boolean;
  /** Sous le téléphone (grand écran) plutôt qu'en surimpression */
  integree?: boolean;
}) {
  const e = ETAPES[index]!;
  const fait = e.fait ? e.fait(d) : true;
  const derniere = index === ETAPES.length - 1;

  if (reduite) {
    return (
      <button
        type="button"
        onClick={surReduire}
        className="fixed right-4 bottom-4 z-40 inline-flex items-center gap-2 rounded-full bg-console px-4 py-2.5 text-[15px] font-semibold text-white shadow-lg"
      >
        <Sparkles aria-hidden size={17} />
        Visite guidée, étape {index + 1} sur {ETAPES.length}
      </button>
    );
  }

  return (
    <aside
      aria-label="Visite guidée"
      className={cx(
        'rounded-2xl bg-surface ring-1 ring-black/5',
        integree
          ? 'w-full shrink-0 p-4 shadow-[0_8px_24px_rgb(23_33_43/0.14)]'
          : 'fixed right-4 bottom-4 z-40 max-h-[48dvh] w-[min(400px,calc(100vw-2rem))] overflow-y-auto p-4 shadow-[0_18px_50px_rgb(23_33_43/0.3)] sm:p-5',
      )}
    >
      <div className="flex items-center gap-3">
        <span className="chiffres text-sm font-semibold text-console">
          Étape {index + 1} sur {ETAPES.length}
        </span>
        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-console-doux">
          <span className="block h-full rounded-full bg-console transition-[width]" style={{ width: `${((index + 1) / ETAPES.length) * 100}%` }} />
        </span>
        <button type="button" aria-label="Réduire la visite" onClick={surReduire} className="rounded p-1 text-encre-3 hover:bg-fond">
          <Minimize2 size={16} />
        </button>
        <button type="button" aria-label="Quitter la visite" onClick={surQuitter} className="rounded p-1 text-encre-3 hover:bg-fond">
          <X size={17} />
        </button>
      </div>
      <h2 className={cx('leading-snug font-bold text-balance', integree ? 'mt-2.5 text-[17px]' : 'mt-2.5 text-base sm:mt-3 sm:text-lg')}>{e.titre(d)}</h2>
      <p className={cx('mt-1.5 leading-relaxed whitespace-pre-line text-encre-2', integree ? 'text-sm' : 'text-sm sm:text-[15px]')}>{e.texte(d)}</p>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => surAller(index - 1)}
          disabled={index === 0}
          aria-label="Étape précédente"
          className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-encre-2 ring-1 ring-trait hover:bg-fond disabled:opacity-40"
        >
          <ChevronLeft size={18} />
        </button>
        {e.faire && !fait && (
          <button type="button" onClick={() => e.faire!.action(d)} className="inline-flex h-10 items-center gap-2 rounded-lg bg-console-doux px-3.5 text-[15px] font-semibold text-console hover:brightness-95">
            <Sparkles aria-hidden size={16} />
            {e.faire.libelle}
          </button>
        )}
        {e.faire && fait && (
          <span className="inline-flex items-center gap-1.5 text-[15px] font-semibold text-resolue">
            <Check aria-hidden size={17} />
            Fait
          </span>
        )}
        {derniere ? (
          <div className="ml-auto flex gap-2">
            <button type="button" onClick={surQuitter} className="inline-flex h-10 items-center rounded-lg px-3.5 text-[15px] font-semibold text-encre-2 ring-1 ring-trait hover:bg-fond">
              Explorer librement
            </button>
            <button type="button" onClick={() => surAller(-1)} className="inline-flex h-10 items-center rounded-lg bg-console px-3.5 text-[15px] font-semibold text-white hover:brightness-110">
              Recommencer
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => surAller(index + 1)}
            disabled={!fait}
            data-visite-suivant
            className={cx(
              'ml-auto inline-flex h-10 items-center gap-1.5 rounded-lg px-4 text-[15px] font-semibold',
              fait ? 'bg-console text-white hover:brightness-110' : 'bg-fond text-encre-3',
            )}
          >
            Suivant
            <ChevronRight aria-hidden size={17} />
          </button>
        )}
      </div>
    </aside>
  );
}
