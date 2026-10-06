/**
 * Étape 21 : saisie d'une réclamation par le personnel, pour un client venu au guichet ou qui
 * appelle (saisirReclamation). Après l'envoi, le récépissé à imprimer et à remettre au client :
 * numéro, date, et QR code de son suivi.
 */
import { useState, type FormEvent } from 'react';
import { ChevronLeft, CircleAlert, Flame, Phone, Plus, Printer, Store } from 'lucide-react';
import { normaliserTelephone } from '@domaine/contact';
import type { S } from '../../api/types';
import { ChoixFichiers, type ReglesFichiers } from '../../ui/ChoixFichiers';
import { Bouton, Champ, Liste, Panneau, QrCode, Saisie, Texte, cx } from '../../ui/composants';
import { dateHeure, telephone as formatTelephone } from '../../ui/format';

export type CanalSaisie = 'GUICHET' | 'TELEPHONE';

export interface SaisieGuichet {
  canal: CanalSaisie;
  agenceId: string;
  categorieId: string;
  description: string;
  nom: string;
  telephone: string;
  email: string;
  consentementInforme: boolean;
  urgente: boolean;
  meLAssigner: boolean;
  fichiers: File[];
}

export const SAISIE_VIDE: SaisieGuichet = {
  canal: 'GUICHET', agenceId: '', categorieId: '', description: '', nom: '', telephone: '', email: '', consentementInforme: false, urgente: false, meLAssigner: true, fichiers: [],
};

const CANAUX: { cle: CanalSaisie; libelle: string; aide: string; Icone: typeof Store }[] = [
  { cle: 'GUICHET', libelle: 'Au guichet', aide: 'Le client est devant vous, à l\'agence.', Icone: Store },
  { cle: 'TELEPHONE', libelle: 'Au téléphone', aide: 'Le client appelle la banque.', Icone: Phone },
];

/** Le récépissé remis au client : seul lui sort de l'imprimante (styles.css, .recepisse). */
export function Recepisse({
  banque,
  accuse,
  saisie,
  categorie,
  agence,
}: {
  banque: S<'BanquePublique'>;
  accuse: S<'AccuseSaisie'>;
  saisie: Pick<SaisieGuichet, 'canal' | 'telephone' | 'email' | 'nom'>;
  categorie: string;
  agence: string | null;
}) {
  const envoi = accuse.envoiPar.map((c) => (c === 'SMS' ? 'SMS' : 'e-mail')).join(' et ');
  const numero = (() => {
    try {
      return normaliserTelephone(saisie.telephone);
    } catch {
      return null;
    }
  })();
  return (
    <section aria-label="Récépissé" className="recepisse mx-auto w-full max-w-[560px] rounded-2xl border border-trait bg-surface p-7 text-encre">
      <header className="flex items-center justify-between gap-4 border-b border-trait pb-4">
        <div>
          <p className="text-lg font-bold">{banque.nom}</p>
          <p className="text-sm text-encre-3">Récépissé de réclamation</p>
        </div>
        <p className="text-right text-sm text-encre-3">
          {saisie.canal === 'GUICHET' ? `Agence ${agence ?? ''}` : 'Par téléphone'}
          <span className="chiffres block">{dateHeure(accuse.creeLe)}</span>
        </p>
      </header>
      <div className="mt-5 flex items-start gap-6">
        <div className="min-w-0 flex-1">
          <p className="text-sm text-encre-3">Numéro de suivi</p>
          <p className="chiffres text-[28px] leading-tight font-bold tracking-wide">{accuse.numero}</p>
          <dl className="mt-4 flex flex-col gap-2 text-[15px]">
            <div><dt className="inline text-encre-3">Client : </dt><dd className="inline font-semibold">{saisie.nom}</dd></div>
            <div><dt className="inline text-encre-3">Objet : </dt><dd className="inline">{categorie}</dd></div>
            {accuse.agent && <div><dt className="inline text-encre-3">Suivie par : </dt><dd className="inline">{accuse.agent.nom}</dd></div>}
          </dl>
        </div>
        <div className="shrink-0 text-center">
          <QrCode texte={accuse.lienSuivi} taille={132} libelle="QR code du suivi de la réclamation" />
          <p className="mt-1 text-[12px] text-encre-3">Scannez pour suivre</p>
        </div>
      </div>
      <p className="mt-5 rounded-lg bg-fond px-4 py-3 text-sm leading-relaxed text-encre-2">
        {envoi
          ? <>Un {envoi} de confirmation, avec le lien de suivi, est parti {accuse.envoiPar.includes('SMS') && numero ? <>au <span className="chiffres whitespace-nowrap">{formatTelephone(numero)}</span></> : 'aux coordonnées données'}. </>
          : null}
        Lien perdu ? Sur le portail de la banque, « Retrouver mes réclamations » avec ce même numéro de téléphone ou cet e-mail.
      </p>
    </section>
  );
}

export function NouvelleReclamation({
  banque,
  moi,
  categories,
  agences,
  regles,
  lienPolitique,
  saisie = SAISIE_VIDE,
  erreur,
  occupe,
  accuse,
  surEnvoyer,
  surRetour,
  surAutre,
  surOuvrir,
  surImprimer,
}: {
  banque: S<'BanquePublique'>;
  moi: S<'Moi'>;
  categories: S<'ReferenceNommee'>[];
  agences: S<'ReferenceNommee'>[];
  regles: ReglesFichiers;
  /** La politique de données de la banque, à présenter au client */
  lienPolitique: string;
  /** Valeurs de départ (maquettes) */
  saisie?: SaisieGuichet;
  /** Réponse 400 de l'API : les erreurs sous chaque champ */
  erreur?: S<'Probleme'> | null;
  occupe?: boolean;
  /** La réclamation est enregistrée : le récépissé remplace le formulaire */
  accuse?: { accuse: S<'AccuseSaisie'>; saisie: SaisieGuichet } | null;
  surEnvoyer?: (v: SaisieGuichet) => void;
  surRetour?: () => void;
  surAutre?: () => void;
  surOuvrir?: (id: string) => void;
  surImprimer?: () => void;
}) {
  const [canal, setCanal] = useState<CanalSaisie>(saisie.canal);
  const [agenceId, setAgenceId] = useState(saisie.agenceId);
  const [categorieId, setCategorieId] = useState(saisie.categorieId);
  const [fichiers, setFichiers] = useState(saisie.fichiers);
  // Une erreur de l'API disparaît dès que son champ est corrigé ; l'alerte, quand plus aucune ne reste
  const [corriges, setCorriges] = useState<ReadonlySet<string>>(new Set());
  const restantes = (erreur?.erreurs ?? []).filter((e) => !corriges.has(e.champ));
  const erreurDe: Record<string, string> = Object.fromEntries(restantes.map((e) => [e.champ, e.message]));
  const alerte = erreur && (!erreur.erreurs?.length || restantes.length > 0);
  const corriger = (champ: string) => setCorriges((c) => (c.has(champ) ? c : new Set([...c, champ])));
  const agent = moi.role === 'AGENT';

  const envoyer = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const texte = (cle: string) => String(f.get(cle) ?? '');
    surEnvoyer?.({
      canal,
      agenceId,
      categorieId,
      description: texte('description'),
      nom: texte('nom'),
      telephone: texte('telephone'),
      email: texte('email'),
      consentementInforme: f.get('consentement') === 'on',
      urgente: f.get('urgente') === 'on',
      meLAssigner: agent && f.get('meLAssigner') === 'on',
      fichiers,
    });
  };

  const retour = (
    <a
      href="#files"
      onClick={(e) => {
        if (surRetour) {
          e.preventDefault();
          surRetour();
        }
      }}
      className="-ml-1 inline-flex w-fit items-center gap-1 text-[15px] font-semibold text-encre-2 hover:text-encre"
    >
      <ChevronLeft aria-hidden size={18} />
      Réclamations
    </a>
  );

  if (accuse) {
    const a = accuse.accuse;
    return (
      <div className="flex flex-col gap-5">
        {retour}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-[26px] font-bold tracking-tight">Réclamation enregistrée</h1>
            <p className="mt-1 text-[15px] text-encre-3">
              {a.agent ? (a.agent.id === moi.id ? 'Elle vous est assignée.' : `Assignée à ${a.agent.nom}.`) : 'Elle attend dans la file « Reçues ».'}{' '}
              {accuse.saisie.canal === 'GUICHET' ? 'Imprimez le récépissé et remettez-le au client.' : 'Le client a reçu son numéro et son lien de suivi.'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Bouton icone={<Plus aria-hidden size={17} />} onClick={surAutre}>Autre réclamation</Bouton>
            <Bouton onClick={() => surOuvrir?.(a.id)}>Ouvrir la fiche</Bouton>
            <Bouton variante="principal" icone={<Printer aria-hidden size={17} />} onClick={surImprimer ?? (() => window.print())}>Imprimer le récépissé</Bouton>
          </div>
        </div>
        <Recepisse
          banque={banque}
          accuse={a}
          saisie={accuse.saisie}
          categorie={categories.find((c) => c.id === accuse.saisie.categorieId)?.nom ?? ''}
          agence={agences.find((x) => x.id === accuse.saisie.agenceId)?.nom ?? null}
        />
        <p className="text-center text-sm text-encre-3">Le lien de suivi n'apparaît qu'ici : ensuite, il n'est plus montré au personnel. Il peut être renvoyé au client depuis la fiche.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {retour}
      <div>
        <h1 className="text-[26px] font-bold tracking-tight">Nouvelle réclamation</h1>
        <p className="mt-1 text-[15px] text-encre-3">Pour un client sans smartphone, ou qui préfère en parler : vous saisissez sa réclamation avec lui, il reçoit son numéro par SMS ou e-mail.</p>
      </div>

      {alerte && (
        <div role="alert" className="flex gap-3 rounded-xl border border-urgent/30 bg-urgent-doux p-4 text-[15px]">
          <CircleAlert aria-hidden size={20} className="mt-0.5 shrink-0 text-urgent" />
          <div>
            <p className="font-bold text-urgent">{erreur.title}</p>
            {erreur.detail && <p className="mt-0.5 text-encre-2">{erreur.detail}</p>}
          </div>
        </div>
      )}

      <form
        id="form-saisie"
        noValidate
        onSubmit={envoyer}
        onChange={(e) => {
          const nom = (e.target as unknown as HTMLInputElement).name;
          if (nom) corriger(nom === 'consentement' ? 'consentementInforme' : nom);
        }}
        className="grid grid-cols-[minmax(0,1fr)_340px] items-start gap-5">
        <div className="flex min-w-0 flex-col gap-5">
          <Panneau titre="La réclamation">
            <div className="flex flex-col gap-5">
              <fieldset>
                <legend className="text-[15px] font-semibold">Le client est</legend>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {CANAUX.map(({ cle, libelle, aide, Icone }) => (
                    <label key={cle} className={cx('flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5', canal === cle ? 'border-marque bg-marque-doux/60 ring-1 ring-marque' : 'border-trait-fort hover:border-encre-3')}>
                      <input type="radio" name="canal" value={cle} checked={canal === cle} onChange={() => setCanal(cle)} className="mt-1 h-4 w-4 accent-[var(--marque)]" />
                      <span>
                        <span className="flex items-center gap-1.5 text-[15px] font-semibold"><Icone aria-hidden size={16} />{libelle}</span>
                        <span className="block text-sm text-encre-3">{aide}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="grid grid-cols-2 gap-4">
                <Champ libelle={canal === 'GUICHET' ? 'Agence du guichet' : 'Agence concernée'} facultatif={canal === 'TELEPHONE'} erreur={erreurDe.agenceId}>
                  {(id, decrit) => (
                    <Liste id={id} name="agenceId" aria-describedby={decrit} value={agenceId} onChange={(e) => setAgenceId(e.target.value)} className={cx('h-11', erreurDe.agenceId && 'border-urgent')}>
                      <option value="">{canal === 'GUICHET' ? 'Choisir l\'agence' : 'Aucune en particulier'}</option>
                      {agences.map((x) => <option key={x.id} value={x.id}>{x.nom}</option>)}
                    </Liste>
                  )}
                </Champ>
                <Champ libelle="Catégorie" erreur={erreurDe.categorieId}>
                  {(id, decrit) => (
                    <Liste id={id} name="categorieId" aria-describedby={decrit} value={categorieId} onChange={(e) => setCategorieId(e.target.value)} className={cx('h-11', erreurDe.categorieId && 'border-urgent')}>
                      <option value="">Choisir la catégorie</option>
                      {categories.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
                    </Liste>
                  )}
                </Champ>
              </div>
              <Champ libelle="Ce que dit le client" aide="Ce qui s'est passé, quand, et les montants s'il y en a. Le client pourra le relire dans son suivi." erreur={erreurDe.description}>
                {(id, decrit) => <Texte id={id} name="description" aria-describedby={decrit} rows={6} defaultValue={saisie.description} invalide={!!erreurDe.description} />}
              </Champ>
              <div className="flex flex-col gap-2">
                <span className="text-[15px] font-semibold">Documents remis par le client <span className="font-normal text-encre-3">(facultatif)</span></span>
                <ChoixFichiers fichiers={fichiers} surChangement={setFichiers} regles={regles} libelle="Ajouter une photo, un PDF scanné ou un document Word" />
                {erreurDe.fichiers && <p className="text-sm font-semibold text-urgent">{erreurDe.fichiers}</p>}
              </div>
            </div>
          </Panneau>
        </div>

        <aside className="flex flex-col gap-5">
          <Panneau titre="Le client">
            <div className="flex flex-col gap-4">
              <Champ libelle="Nom et prénom" erreur={erreurDe.nom}>
                {(id) => <Saisie id={id} name="nom" autoComplete="off" defaultValue={saisie.nom} invalide={!!erreurDe.nom} />}
              </Champ>
              <Champ libelle="Téléphone" erreur={erreurDe.telephone} aide="Il y reçoit son numéro et son lien de suivi.">
                {(id, decrit) => (
                  <div className="flex">
                    <span className="inline-flex items-center rounded-l-lg border border-r-0 border-trait-fort bg-fond px-3 text-[15px] text-encre-2">+225</span>
                    <Saisie id={id} name="telephone" aria-describedby={decrit} type="tel" inputMode="tel" autoComplete="off" placeholder="07 08 09 10 11" defaultValue={saisie.telephone} invalide={!!erreurDe.telephone} className="rounded-l-none" />
                  </div>
                )}
              </Champ>
              <Champ libelle="E-mail" facultatif erreur={erreurDe.email}>
                {(id) => <Saisie id={id} name="email" type="email" inputMode="email" autoComplete="off" defaultValue={saisie.email} invalide={!!erreurDe.email} />}
              </Champ>
            </div>
          </Panneau>
          <Panneau titre="Traitement">
            <div className="flex flex-col gap-3 text-[15px]">
              <label className="flex cursor-pointer items-start gap-3">
                <input type="checkbox" name="urgente" defaultChecked={saisie.urgente} className="mt-1 h-4 w-4 shrink-0 accent-[var(--color-urgent)]" />
                <span>
                  <span className="inline-flex items-center gap-1 font-semibold"><Flame aria-hidden size={15} className="text-urgent" />Urgente</span>
                  <span className="block text-sm text-encre-3">Sinon, la priorité de la catégorie.</span>
                </span>
              </label>
              {agent && (
                <label className="flex cursor-pointer items-start gap-3">
                  <input type="checkbox" name="meLAssigner" defaultChecked={saisie.meLAssigner} className="mt-1 h-4 w-4 shrink-0 accent-[var(--marque)]" />
                  <span>
                    <span className="font-semibold">Me l'assigner</span>
                    <span className="block text-sm text-encre-3">Vous la traitez vous-même ; sinon, elle suit les règles d'attribution de la banque.</span>
                  </span>
                </label>
              )}
            </div>
          </Panneau>
          <Panneau>
            <label className="flex cursor-pointer items-start gap-3 text-[15px] leading-relaxed">
              <input type="checkbox" name="consentement" defaultChecked={saisie.consentementInforme} className="mt-1 h-5 w-5 shrink-0 accent-[var(--marque)]" />
              <span>
                J'ai informé le client que {banque.nom} utilise ces informations pour traiter sa réclamation, selon sa{' '}
                <a href={lienPolitique} target="_blank" rel="noopener" className="font-semibold text-marque-texte underline underline-offset-2">politique de données</a>, et il l'accepte.
                {erreurDe.consentementInforme && <span className="mt-1 block text-sm font-semibold text-urgent">{erreurDe.consentementInforme}</span>}
              </span>
            </label>
            <p className="mt-2 text-[13px] text-encre-3">Son accord est inscrit au journal d'audit, à votre nom.</p>
            <Bouton type="submit" variante="principal" taille="grand" className="mt-4 w-full" disabled={occupe}>
              {occupe ? 'Enregistrement…' : 'Enregistrer la réclamation'}
            </Bouton>
          </Panneau>
        </aside>
      </form>
    </div>
  );
}
