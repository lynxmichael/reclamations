/**
 * Banque et apparence (lireParametresBanque, modifierApparence, televerserLogo).
 * L'Admin Entreprise règle l'apparence du portail ; le contrat commercial (plan, préfixe,
 * fuseau, seuil d'alerte, délai de clôture, SMS) est réglé par le Super Admin (décision C12).
 */
import { CircleCheck, TriangleAlert, Upload } from 'lucide-react';
import type { S } from '../../api/types';
import { Bouton, Champ, LogoBanque, Panneau, Saisie, cx } from '../../ui/composants';
import { nombre } from '../../ui/format';
import { contraste, couleurValide, styleMarque, texteSur } from '../../ui/marque';

function Jauge({ libelle, valeur, plafond }: { libelle: string; valeur: number; plafond: number | null }) {
  const part = plafond ? valeur / plafond : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between text-[15px]">
        <span className="text-encre-2">{libelle}</span>
        <span className="chiffres">
          <span className="font-bold">{nombre(valeur)}</span>
          <span className="text-encre-3"> / {plafond === null ? 'illimité' : nombre(plafond)}</span>
        </span>
      </div>
      {plafond !== null && (
        <div className="mt-1.5 h-2 rounded-full bg-fond">
          <div className={cx('h-full rounded-full', part > 1 ? 'bg-urgent' : part > 0.85 ? 'bg-alerte' : 'bg-encre-3')} style={{ width: `${Math.min(100, part * 100)}%` }} />
        </div>
      )}
    </div>
  );
}

function Reglage({ libelle, valeur }: { libelle: string; valeur: string }) {
  return (
    <div className="flex justify-between gap-4 py-2.5 text-[15px]">
      <dt className="text-encre-2">{libelle}</dt>
      <dd className="text-right font-semibold">{valeur}</dd>
    </div>
  );
}

export function Banque({ parametres: p, banque }: { parametres: S<'ParametresBanque'>; banque: S<'BanquePublique'> }) {
  const couleur = couleurValide(p.couleurPrimaire);
  const texte = texteSur(couleur);
  const ratio = contraste(couleur, texte);
  const conforme = ratio >= 4.5;
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-[26px] font-bold tracking-tight">Banque et apparence</h1>
        <p className="mt-1 text-[15px] text-encre-3">Ce que voient vos clients sur le portail de réclamation.</p>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_340px] items-start gap-5">
        <div className="flex flex-col gap-5">
          <Panneau titre="Apparence du portail">
            <div className="flex flex-col gap-6">
              <div className="flex items-center gap-4">
                <LogoBanque nom={p.nom} logoUrl={p.logoUrl} taille={56} />
                <div>
                  <p className="text-[15px] font-semibold">Logo</p>
                  <p className="text-sm text-encre-3">PNG ou SVG, fond transparent. En attendant, vos initiales s'affichent.</p>
                </div>
                <Bouton className="ml-auto" icone={<Upload aria-hidden size={16} />}>Déposer un logo</Bouton>
              </div>

              <div className="grid grid-cols-2 gap-5">
                <Champ libelle="Couleur principale" aide="Bandeau, boutons, liens.">
                  {(id, d) => (
                    <div className="flex items-center gap-2">
                      <span aria-hidden className="h-11 w-11 shrink-0 rounded-lg border border-trait" style={{ background: couleur }} />
                      <Saisie id={id} aria-describedby={d} defaultValue={couleur.toUpperCase()} className="chiffres uppercase" />
                    </div>
                  )}
                </Champ>
                <Champ libelle="Couleur secondaire" facultatif aide="Fonds légers.">
                  {(id, d) => (
                    <div className="flex items-center gap-2">
                      <span aria-hidden className="h-11 w-11 shrink-0 rounded-lg border border-trait" style={{ background: couleurValide(p.couleurSecondaire) }} />
                      <Saisie id={id} aria-describedby={d} defaultValue={(p.couleurSecondaire ?? '').toUpperCase()} className="chiffres uppercase" />
                    </div>
                  )}
                </Champ>
              </div>

              <p className={cx('flex items-start gap-2.5 rounded-lg p-3 text-sm leading-relaxed', conforme ? 'bg-resolue-doux text-resolue' : 'bg-alerte-doux text-alerte')}>
                {conforme ? <CircleCheck aria-hidden size={18} className="mt-px shrink-0" /> : <TriangleAlert aria-hidden size={18} className="mt-px shrink-0" />}
                <span>
                  Texte {texte === '#ffffff' ? 'blanc' : 'foncé'} sur cette couleur : contraste de {ratio.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} pour 1.{' '}
                  {conforme ? 'Conforme au niveau AA des règles d\'accessibilité (4,5 pour 1 au moins).' : 'Trop faible : choisissez une couleur plus foncée ou plus claire.'}
                </span>
              </p>

              <Champ libelle="E-mail de contact" aide="Indiqué au client dans les e-mails de suivi.">
                {(id, d) => <Saisie id={id} aria-describedby={d} type="email" defaultValue={p.emailContact ?? ''} />}
              </Champ>

              <div className="flex justify-end">
                <Bouton variante="principal">Enregistrer l'apparence</Bouton>
              </div>
            </div>
          </Panneau>
        </div>

        <aside className="flex flex-col gap-5">
          <Panneau titre="Aperçu">
            <div style={styleMarque(p.couleurPrimaire)} className="overflow-hidden rounded-xl border border-trait">
              <div className="flex items-center gap-2.5 bg-marque px-4 py-3.5 text-sur-marque">
                <LogoBanque nom={banque.nom} logoUrl={banque.logoUrl} taille={30} inverse />
                <div className="leading-tight">
                  <div className="text-[15px] font-bold">{banque.nom}</div>
                  <div className="text-xs opacity-85">Service réclamations</div>
                </div>
              </div>
              <div className="flex flex-col gap-3 p-4">
                <div className="h-2.5 w-3/4 rounded bg-trait" />
                <div className="h-2.5 w-1/2 rounded bg-trait" />
                <div className="mt-1 flex h-10 items-center justify-center rounded-lg bg-marque text-sm font-semibold text-sur-marque">Envoyer ma réclamation</div>
              </div>
            </div>
          </Panneau>

          <Panneau titre={`Plan ${p.plan.nom}`}>
            <div className="flex flex-col gap-4">
              <Jauge libelle="Agents et superviseurs" valeur={p.consommation.agents} plafond={p.plan.plafondAgents} />
              <Jauge libelle="Réclamations ce mois-ci" valeur={p.consommation.ticketsCeMois} plafond={p.plan.plafondTicketsMois} />
            </div>
            <dl className="mt-4 divide-y divide-trait border-t border-trait">
              <Reglage libelle="Adresse du portail" valeur={`${p.slug}.reclamations.example`} />
              <Reglage libelle="Préfixe des numéros" valeur={p.prefixeTickets} />
              <Reglage libelle="Seuil d'alerte SLA" valeur={`${p.seuilAlerteSlaPourcent} %`} />
              <Reglage libelle="Clôture automatique" valeur={`après ${p.delaiClotureAutoJours} jours`} />
              <Reglage libelle="SMS à chaque étape" valeur={p.smsChaqueChangementStatut ? 'Oui' : 'Non'} />
            </dl>
            <p className="mt-3 text-sm leading-relaxed text-encre-3">Ces réglages relèvent de votre contrat. Pour les changer, contactez Makor Telecoms.</p>
          </Panneau>
        </aside>
      </div>
    </div>
  );
}
