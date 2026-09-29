/**
 * Écran d'ouverture de la démo : l'affiche QR telle qu'elle serait posée dans le hall d'une
 * agence, et en face ce que la plateforme apporte à la banque.
 */
import { Building2, Clock3, ScrollText, Smartphone } from 'lucide-react';
import { LogoBanque, QrCode } from '../ui/composants';
import { styleMarque } from '../ui/marque';
import { DOMAINE } from '../maquettes/donnees/commun';
import type { BanqueDemo } from './moteur';
import { POINT_QR } from './useDemo';

export function AfficheQr({ banque, taille = 1 }: { banque: BanqueDemo; taille?: number }) {
  return (
    <figure
      style={{ ...styleMarque(banque.couleur), width: 300 * taille }}
      className="shrink-0 overflow-hidden rounded-[18px] bg-surface shadow-[0_30px_60px_-24px_rgb(23_33_43/0.55),0_2px_6px_rgb(23_33_43/0.12)]"
    >
      <div className="flex items-center gap-2.5 bg-marque px-5 py-4 text-sur-marque">
        <LogoBanque nom={banque.nom} logoUrl={banque.logoUrl} taille={34 * taille} inverse />
        <span className="text-[17px] leading-tight font-bold">{banque.nom}</span>
      </div>
      <div className="flex flex-col items-center px-6 pt-5 pb-6 text-center">
        <p className="text-[26px] leading-[1.1] font-extrabold tracking-tight text-encre">
          Une réclamation ?<br />
          Scannez ce code.
        </p>
        <div className="mt-4 rounded-xl p-2 ring-2 ring-marque">
          <QrCode texte={`https://${banque.slug}.${DOMAINE}/d/${POINT_QR}`} taille={176 * taille} />
        </div>
        <p className="mt-4 text-[15px] leading-snug text-encre-2">Vous recevez un numéro de suivi par SMS et la réponse d'un conseiller.</p>
        <figcaption className="mt-3 text-xs text-encre-3">Agence Plateau, hall d'accueil</figcaption>
      </div>
    </figure>
  );
}

const ATOUTS = [
  { icone: Smartphone, titre: 'Rien à installer pour le client', texte: 'Un QR code en agence ou un lien sur votre site, un numéro de suivi par SMS, un code pour lire les réponses.' },
  { icone: Clock3, titre: 'Des délais tenus', texte: 'Un chrono SLA par catégorie, en heures d\'ouverture, une alerte à 75 % et une escalade automatique à l\'échéance.' },
  { icone: Building2, titre: 'Vos équipes, vos règles', texte: 'Agents, superviseurs, Admin Entreprise ; vos agences, catégories, horaires et jours fériés.' },
  { icone: ScrollText, titre: 'La preuve à l\'appui', texte: 'Un tableau de bord des délais et un journal d\'audit infalsifiable, données isolées pour chaque banque.' },
];

export function Ouverture({
  banque,
  surVisite,
  surLibre,
  surPreparer,
}: {
  banque: BanqueDemo;
  surVisite: () => void;
  surLibre: () => void;
  surPreparer: () => void;
}) {
  return (
    <div className="min-h-full bg-fond">
      <div className="mx-auto flex max-w-[1180px] flex-col gap-12 px-5 py-10 lg:flex-row lg:items-center lg:gap-16 lg:py-16">
        <div className="flex-1">
          <p className="text-[15px] font-semibold text-console">Démonstration interactive</p>
          <h1 className="mt-3 max-w-[20ch] text-[40px] leading-[1.05] font-extrabold tracking-tight text-balance text-encre sm:text-[52px]">
            Chaque réclamation suivie, jusqu'à la réponse.
          </h1>
          <p className="mt-5 max-w-[58ch] text-lg leading-relaxed text-encre-2">
            Vivez le parcours complet en quelques minutes : un client dépose sa réclamation depuis le QR code d'une agence, {banque.nom} la traite dans ses délais,
            le client confirme la solution sur son téléphone.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <button type="button" onClick={surVisite} className="inline-flex h-12 items-center rounded-xl bg-console px-6 text-base font-bold text-white shadow-[inset_0_-2px_0_rgb(0_0_0/0.18)] hover:brightness-110">
              Commencer la visite guidée
            </button>
            <button type="button" onClick={surLibre} className="inline-flex h-12 items-center rounded-xl bg-surface px-6 text-base font-semibold text-encre ring-1 ring-trait-fort hover:bg-white">
              Explorer librement
            </button>
            <button type="button" onClick={surPreparer} className="px-2 text-[15px] font-semibold text-console underline-offset-4 hover:underline">
              Préparer pour une autre banque
            </button>
          </div>
          <ul className="mt-12 grid gap-x-8 gap-y-6 sm:grid-cols-2">
            {ATOUTS.map((a) => (
              <li key={a.titre} className="flex gap-3.5">
                <a.icone aria-hidden size={22} className="mt-0.5 shrink-0 text-console" />
                <div>
                  <p className="font-bold text-encre">{a.titre}</p>
                  <p className="mt-1 text-[15px] leading-relaxed text-encre-2">{a.texte}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <div className="flex justify-center lg:w-[380px]">
          <div className="-rotate-2">
            <AfficheQr banque={banque} />
          </div>
        </div>
      </div>
      <p className="mx-auto max-w-[1180px] px-5 pb-8 text-sm leading-relaxed text-encre-3">
        Les données de cette démonstration sont fictives et restent dans ce navigateur : rien n'est envoyé. Plateforme de gestion des réclamations, Makor Telecoms.
      </p>
    </div>
  );
}
