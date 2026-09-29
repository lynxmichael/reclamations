/**
 * Politique de données présentée au client avant le dépôt (consentement ARTCI, version 2026-09).
 * Texte type, commun aux banques : chacune le fait valider par son responsable de la conformité
 * avant l'ouverture (point ouvert de l'étape 8).
 */
import type { S } from '../../api/types';

export const VERSION_POLITIQUE = '2026-09';

export function TextePolitique({ banque }: { banque: S<'BanquePublique'> | null }) {
  const nom = banque?.nom ?? 'votre banque';
  return (
    <article className="flex flex-col gap-5 px-5 pt-6 pb-10 text-[15px] leading-relaxed text-encre-2">
      <div>
        <h1 className="text-[26px] leading-tight font-bold tracking-tight text-encre">Politique de données</h1>
        <p className="mt-1 text-sm text-encre-3">Version {VERSION_POLITIQUE}</p>
      </div>
      <section>
        <h2 className="mb-1.5 text-lg font-bold text-encre">Qui traite vos données</h2>
        <p>
          {banque ? banque.nom : 'La banque à laquelle vous adressez votre réclamation'} est responsable du traitement. Makor Telecoms fournit la plateforme de réclamation pour son compte et n'a pas accès au contenu de votre réclamation.
        </p>
      </section>
      <section>
        <h2 className="mb-1.5 text-lg font-bold text-encre">Pourquoi</h2>
        <p>Uniquement pour enregistrer, traiter et suivre votre réclamation, vous répondre, et mesurer la qualité du service de réclamation.</p>
      </section>
      <section>
        <h2 className="mb-1.5 text-lg font-bold text-encre">Quelles données</h2>
        <p>Votre nom, votre téléphone et/ou votre e-mail, la description de votre réclamation, les fichiers que vous joignez et les échanges avec {nom}.</p>
      </section>
      <section>
        <h2 className="mb-1.5 text-lg font-bold text-encre">Qui les voit</h2>
        <p>Seul le personnel de {nom} chargé des réclamations. Elles ne sont ni vendues ni utilisées pour de la publicité.</p>
      </section>
      <section>
        <h2 className="mb-1.5 text-lg font-bold text-encre">Où elles sont conservées</h2>
        <p>
          Sur les serveurs de la plateforme, dans l'Union européenne, de façon chiffrée pendant leur transport. Ce transfert hors de Côte d'Ivoire relève de la loi n° 2013-450 relative à la protection des données à caractère personnel et de l'autorisation de l'ARTCI.
        </p>
      </section>
      <section>
        <h2 className="mb-1.5 text-lg font-bold text-encre">Vos droits</h2>
        <p>
          Vous pouvez demander l'accès à vos données, leur rectification ou leur suppression, et vous opposer à leur traitement, en vous adressant à {nom}. Vous pouvez aussi saisir l'ARTCI (Autorité de Régulation des Télécommunications/TIC de Côte d'Ivoire).
        </p>
      </section>
    </article>
  );
}
