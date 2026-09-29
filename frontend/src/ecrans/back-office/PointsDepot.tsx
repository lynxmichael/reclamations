/**
 * Agences et points de dépôt (listerAgences, listerPointsDepot, telechargerQrCode).
 * Chaque QR code est un objet physique, affiché dans une agence : il porte le code du point,
 * donc l'agence de la réclamation, sans que le client ait à la choisir.
 * Avec `actions` (étape 8) : création et modification (Admin Entreprise), téléchargement du QR
 * code en PNG ou SVG pour l'impression (superviseur et Admin Entreprise).
 */
import { useState } from 'react';
import { Check, Copy, Download, Globe, MapPin, Pencil, Plus, Printer } from 'lucide-react';
import type { S } from '../../api/types';
import { Dialogue } from '../../ui/Dialogue';
import { Bouton, Champ, Liste, QrCode, Saisie, cx } from '../../ui/composants';

type Issue = void | boolean | Promise<boolean>;

export interface ActionsPoints {
  creerAgence: (v: { code: string; nom: string; ville: string | null; adresse: string | null }) => Issue;
  modifierAgence: (id: string, v: { nom?: string; ville?: string | null; adresse?: string | null; active?: boolean }) => Issue;
  creerPoint: (v: { canal: S<'CanalDepot'>; libelle: string; agenceId: string | null }) => Issue;
  modifierPoint: (id: string, v: { libelle?: string; agenceId?: string | null; actif?: boolean }) => Issue;
  telechargerQr: (p: S<'PointDepot'>, format: 'png' | 'svg') => void;
  occupe?: boolean;
  erreurs?: Record<string, string>;
}

type Fenetre =
  | { type: 'agence'; agence: S<'Agence'> | null }
  | { type: 'point'; point: S<'PointDepot'> | null; canal: S<'CanalDepot'>; agenceId: string | null };

function BoutonCopier({ texte }: { texte: string }) {
  const [copie, setCopie] = useState(false);
  return (
    <Bouton
      taille="petit"
      icone={copie ? <Check aria-hidden size={14} /> : <Copy aria-hidden size={14} />}
      onClick={() =>
        void navigator.clipboard?.writeText(texte).then(() => {
          setCopie(true);
          window.setTimeout(() => setCopie(false), 2000);
        })
      }
    >
      {copie ? 'Lien copié' : 'Copier le lien'}
    </Bouton>
  );
}

function CarteQr({ p, modifiable, actions, surModifier }: { p: S<'PointDepot'>; modifiable: boolean; actions?: ActionsPoints; surModifier: () => void }) {
  return (
    <li className={cx('flex w-[330px] gap-3.5 rounded-xl border bg-surface p-3', p.actif ? 'border-trait' : 'border-dashed border-trait-fort')}>
      <div className={cx('shrink-0 rounded-md border border-trait', !p.actif && 'opacity-35 grayscale')} title={p.urlDepot}>
        <QrCode texte={p.urlDepot} taille={84} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-start justify-between gap-2">
          <p className="leading-snug font-semibold">{p.libelle}</p>
          {!p.actif && <span className="shrink-0 rounded-md bg-cloturee-doux px-1.5 py-0.5 text-xs font-semibold text-cloturee">Désactivé</span>}
        </div>
        <p className="chiffres mt-0.5 text-sm tracking-wide text-encre-3">{p.code}</p>
        <div className="mt-auto flex items-center gap-1.5 pt-2">
          <Bouton taille="petit" icone={<Download aria-hidden size={14} />} onClick={() => actions?.telechargerQr(p, 'png')} aria-label={`QR code PNG de ${p.libelle}`}>PNG</Bouton>
          <Bouton taille="petit" icone={<Printer aria-hidden size={14} />} onClick={() => actions?.telechargerQr(p, 'svg')} aria-label={`QR code SVG de ${p.libelle}`}>SVG</Bouton>
          {modifiable && (
            <Bouton taille="petit" variante="discret" aria-label={`Modifier ${p.libelle}`} icone={<Pencil aria-hidden size={15} />} onClick={surModifier} />
          )}
        </div>
      </div>
    </li>
  );
}

function FenetreAgence({ agence, actions, surFermer }: { agence: S<'Agence'> | null; actions: ActionsPoints; surFermer: () => void }) {
  const [code, setCode] = useState(agence?.code ?? '');
  const [nom, setNom] = useState(agence?.nom ?? '');
  const [ville, setVille] = useState(agence?.ville ?? '');
  const [adresse, setAdresse] = useState(agence?.adresse ?? '');
  const [active, setActive] = useState(agence?.active ?? true);
  const e = actions.erreurs ?? {};
  const valide = nom.trim() && (agence || code.trim());
  const enregistrer = async () => {
    const commun = { nom: nom.trim(), ville: ville.trim() || null, adresse: adresse.trim() || null };
    const issue = await (agence ? actions.modifierAgence(agence.id, { ...commun, active }) : actions.creerAgence({ code: code.trim().toUpperCase(), ...commun }));
    if (issue !== false) surFermer();
  };
  return (
    <Dialogue
      titre={agence ? `Agence ${agence.nom}` : 'Nouvelle agence'}
      surFermer={surFermer}
      pied={
        <>
          <Bouton variante="discret" onClick={surFermer}>Annuler</Bouton>
          <Bouton variante="principal" disabled={!valide || actions.occupe} onClick={() => void enregistrer()}>{agence ? 'Enregistrer' : 'Créer l\'agence'}</Bouton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-[130px_minmax(0,1fr)] gap-3">
          <Champ libelle="Code" aide={agence ? 'Ne change pas' : 'Ex. PLT'} erreur={e.code}>
            {(id, d) => <Saisie id={id} aria-describedby={d} value={code} onChange={(x) => setCode(x.target.value)} disabled={!!agence} maxLength={20} className="chiffres uppercase" invalide={!!e.code} />}
          </Champ>
          <Champ libelle="Nom" erreur={e.nom}>{(id) => <Saisie id={id} value={nom} onChange={(x) => setNom(x.target.value)} maxLength={120} invalide={!!e.nom} />}</Champ>
        </div>
        <Champ libelle="Ville" facultatif>{(id) => <Saisie id={id} value={ville} onChange={(x) => setVille(x.target.value)} maxLength={120} />}</Champ>
        <Champ libelle="Adresse" facultatif>{(id) => <Saisie id={id} value={adresse} onChange={(x) => setAdresse(x.target.value)} maxLength={255} />}</Champ>
        {agence && (
          <label className="flex items-start gap-2.5 text-[15px]">
            <input type="checkbox" checked={active} onChange={(x) => setActive(x.target.checked)} className="mt-1 h-4 w-4 accent-[var(--marque)]" />
            <span>
              Agence ouverte
              <span className="block text-sm text-encre-3">Fermée, elle n'est plus proposée au client ; ses réclamations restent.</span>
            </span>
          </label>
        )}
      </div>
    </Dialogue>
  );
}

function FenetrePoint({ point, canal, agenceId, agences, actions, surFermer }: { point: S<'PointDepot'> | null; canal: S<'CanalDepot'>; agenceId: string | null; agences: S<'Agence'>[]; actions: ActionsPoints; surFermer: () => void }) {
  const [libelle, setLibelle] = useState(point?.libelle ?? '');
  const [agence, setAgence] = useState(point?.agence?.id ?? agenceId ?? '');
  const [actif, setActif] = useState(point?.actif ?? true);
  const e = actions.erreurs ?? {};
  const qr = (point?.canal ?? canal) === 'QR_CODE';
  const valide = libelle.trim() && (!qr || agence);
  const enregistrer = async () => {
    const issue = await (point
      ? actions.modifierPoint(point.id, { libelle: libelle.trim(), agenceId: agence || null, actif })
      : actions.creerPoint({ canal, libelle: libelle.trim(), agenceId: agence || null }));
    if (issue !== false) surFermer();
  };
  return (
    <Dialogue
      titre={point ? 'Modifier le point de dépôt' : qr ? 'Nouveau QR code' : 'Nouveau lien web'}
      description={!point && (qr ? 'Un QR code par emplacement : accueil, guichet, espace libre-service. Son code est généré et ne changera plus, même si vous le renommez.' : 'À placer sur le site ou dans l\'application de la banque. Le client pourra indiquer une agence.')}
      surFermer={surFermer}
      pied={
        <>
          <Bouton variante="discret" onClick={surFermer}>Annuler</Bouton>
          <Bouton variante="principal" disabled={!valide || actions.occupe} onClick={() => void enregistrer()}>{point ? 'Enregistrer' : 'Créer'}</Bouton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Champ libelle="Libellé" aide={qr ? 'Ex. Accueil, Guichet 2' : 'Ex. Site web, Application mobile'} erreur={e.libelle}>
          {(id, d) => <Saisie id={id} aria-describedby={d} value={libelle} onChange={(x) => setLibelle(x.target.value)} maxLength={120} invalide={!!e.libelle} />}
        </Champ>
        <Champ libelle="Agence" facultatif={!qr} erreur={e.agenceId}>
          {(id) => (
            <Liste id={id} value={agence} onChange={(x) => setAgence(x.target.value)}>
              <option value="">{qr ? 'Choisir une agence' : 'Aucune'}</option>
              {agences.filter((a) => a.active || a.id === agence).map((a) => (
                <option key={a.id} value={a.id}>{a.nom}</option>
              ))}
            </Liste>
          )}
        </Champ>
        {point && (
          <label className="flex items-start gap-2.5 text-[15px]">
            <input type="checkbox" checked={actif} onChange={(x) => setActif(x.target.checked)} className="mt-1 h-4 w-4 accent-[var(--marque)]" />
            <span>
              Actif
              <span className="block text-sm text-encre-3">Désactivé, le QR code ou le lien affiche un message au lieu du formulaire.</span>
            </span>
          </label>
        )}
      </div>
    </Dialogue>
  );
}

export function PointsDepot({ agences, points, modifiable, actions }: { agences: S<'Agence'>[]; points: S<'PointDepot'>[]; modifiable: boolean; actions?: ActionsPoints }) {
  const [fenetre, setFenetre] = useState<Fenetre | null>(null);
  const liens = points.filter((p) => p.canal === 'LIEN_WEB');
  const edition = modifiable && !!actions;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">Agences et QR codes</h1>
          <p className="mt-1 max-w-[72ch] text-[15px] text-encre-3">
            Un QR code par emplacement : le client le scanne sur place et sa réclamation arrive avec l'agence déjà renseignée.
          </p>
        </div>
        {modifiable && (
          <div className="flex gap-2">
            <Bouton icone={<Plus aria-hidden size={17} />} onClick={() => setFenetre({ type: 'agence', agence: null })}>Nouvelle agence</Bouton>
            <Bouton variante="principal" icone={<Plus aria-hidden size={17} />} onClick={() => setFenetre({ type: 'point', point: null, canal: 'QR_CODE', agenceId: agences.find((a) => a.active)?.id ?? null })}>
              Nouveau QR code
            </Bouton>
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-trait bg-surface">
        {agences.length === 0 && <p className="px-5 py-10 text-center text-[15px] text-encre-3">Aucune agence pour l'instant.{modifiable && ' Créez la première pour y afficher un QR code.'}</p>}
        {agences.map((a) => {
          const ici = points.filter((p) => p.agence?.id === a.id && p.canal === 'QR_CODE');
          return (
            <section key={a.id} className={cx('flex gap-6 border-b border-trait px-5 py-4 last:border-0', !a.active && 'bg-fond/60')}>
              <div className="w-48 shrink-0">
                <h2 className="flex items-center gap-1.5 text-[17px] font-bold">
                  {a.nom}
                  {edition && (
                    <button type="button" aria-label={`Modifier l'agence ${a.nom}`} onClick={() => setFenetre({ type: 'agence', agence: a })} className="rounded p-1 text-encre-3 hover:bg-fond hover:text-encre">
                      <Pencil size={14} />
                    </button>
                  )}
                </h2>
                <p className="chiffres text-sm text-encre-3">{a.code}{!a.active && ' · fermée'}</p>
                {(a.adresse || a.ville) && (
                  <p className="mt-1 flex items-start gap-1 text-sm text-encre-2">
                    <MapPin aria-hidden size={14} className="mt-0.5 shrink-0" />
                    {[a.adresse, a.ville].filter(Boolean).join(', ')}
                  </p>
                )}
              </div>
              <div className="flex flex-1 flex-wrap items-start gap-3">
                {ici.length > 0 ? (
                  <ul className="flex flex-wrap gap-3">
                    {ici.map((p) => <CarteQr key={p.id} p={p} modifiable={modifiable} actions={actions} surModifier={() => setFenetre({ type: 'point', point: p, canal: p.canal, agenceId: a.id })} />)}
                  </ul>
                ) : (
                  <p className="self-center text-[15px] text-encre-3">
                    Pas encore de QR code dans cette agence.{modifiable && ' Créez-en un pour l\'afficher à l\'accueil.'}
                  </p>
                )}
                {edition && a.active && (
                  <button type="button" onClick={() => setFenetre({ type: 'point', point: null, canal: 'QR_CODE', agenceId: a.id })} className="inline-flex h-9 items-center gap-1.5 self-center rounded-lg px-3 text-sm font-semibold text-marque-texte hover:bg-fond">
                    <Plus aria-hidden size={15} />
                    QR code
                  </button>
                )}
              </div>
            </section>
          );
        })}
      </div>

      <section className="flex flex-col gap-3">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 className="text-[19px] font-bold">Liens web</h2>
            <p className="mt-0.5 text-[15px] text-encre-3">À placer sur le site ou dans l'application. Le client peut indiquer une agence s'il le souhaite.</p>
          </div>
          {edition && (
            <Bouton taille="petit" icone={<Plus aria-hidden size={14} />} onClick={() => setFenetre({ type: 'point', point: null, canal: 'LIEN_WEB', agenceId: null })}>
              Nouveau lien
            </Bouton>
          )}
        </div>
        <ul className="overflow-hidden rounded-xl border border-trait bg-surface">
          {liens.length === 0 && <li className="px-4 py-6 text-center text-[15px] text-encre-3">Aucun lien web.</li>}
          {liens.map((p) => (
            <li key={p.id} className={cx('flex items-center gap-4 border-b border-trait px-4 py-3 last:border-0', !p.actif && 'text-encre-3')}>
              <Globe aria-hidden size={19} className="shrink-0 text-encre-3" />
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{p.libelle}{!p.actif && <span className="ml-2 text-sm font-normal">(désactivé)</span>}</p>
                <p className="truncate text-sm text-encre-2">{p.urlDepot}</p>
              </div>
              <BoutonCopier texte={p.urlDepot} />
              {edition && (
                <Bouton taille="petit" variante="discret" aria-label={`Modifier ${p.libelle}`} icone={<Pencil aria-hidden size={15} />} onClick={() => setFenetre({ type: 'point', point: p, canal: p.canal, agenceId: p.agence?.id ?? null })} />
              )}
            </li>
          ))}
        </ul>
      </section>

      {actions && fenetre?.type === 'agence' && <FenetreAgence agence={fenetre.agence} actions={actions} surFermer={() => setFenetre(null)} />}
      {actions && fenetre?.type === 'point' && (
        <FenetrePoint point={fenetre.point} canal={fenetre.canal} agenceId={fenetre.agenceId} agences={agences} actions={actions} surFermer={() => setFenetre(null)} />
      )}
    </div>
  );
}
