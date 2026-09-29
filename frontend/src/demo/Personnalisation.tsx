/**
 * Préparer la démo pour une banque : son nom, sa couleur, son logo, et le contact affiché en fin
 * de visite. Le portail, l'affiche QR et le back-office prennent aussitôt son apparence.
 */
import { useState } from 'react';
import { ImagePlus, TriangleAlert, X } from 'lucide-react';
import { Bouton, Champ, LogoBanque, Saisie, cx } from '../ui/composants';
import { contraste, couleurValide, styleMarque, texteSur } from '../ui/marque';
import { COULEURS_PROPOSEES, EXEMPLE, versBanque, type Prospect } from './prospect';

export function Personnalisation({ actuel, surAppliquer, surFermer }: { actuel: Prospect; surAppliquer: (p: Prospect | null) => void; surFermer: () => void }) {
  const [p, setP] = useState<Prospect>(actuel);
  const [erreurLogo, setErreurLogo] = useState<string | null>(null);
  const couleur = couleurValide(p.couleur);
  const lisible = contraste(couleur, texteSur(couleur)) >= 4.5;
  const b = versBanque({ ...p, nom: p.nom || 'Votre banque' });

  const lireLogo = (fichier: File | undefined) => {
    setErreurLogo(null);
    if (!fichier) return;
    if (fichier.size > 400_000) return setErreurLogo('Logo trop lourd : 400 Ko au plus (PNG ou SVG).');
    const lecteur = new FileReader();
    lecteur.onload = () => setP((x) => ({ ...x, logoUrl: String(lecteur.result) }));
    lecteur.readAsDataURL(fichier);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-encre/45 px-4 py-10">
      <form
        role="dialog"
        aria-modal="true"
        aria-label="Préparer la démo pour une banque"
        className="w-full max-w-[560px] rounded-2xl bg-surface p-6 shadow-[0_24px_64px_rgb(23_33_43/0.3)]"
        onSubmit={(e) => {
          e.preventDefault();
          if (p.nom.trim()) surAppliquer({ ...p, nom: p.nom.trim(), couleur });
        }}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold">Préparer la démo pour une banque</h2>
            <p className="mt-1 text-[15px] text-encre-2">Portail, affiche QR et back-office prennent son nom et sa couleur. Ces réglages restent dans ce navigateur.</p>
          </div>
          <button type="button" aria-label="Fermer" onClick={surFermer} className="rounded p-1 text-encre-3 hover:bg-fond">
            <X size={20} />
          </button>
        </div>

        <div className="mt-6 flex flex-col gap-5">
          <Champ libelle="Nom de la banque" aide={`Numéros de réclamation : ${b.prefixe}-2026-000123. Adresse : ${b.slug}.reclamations.example`}>
            {(id, d) => <Saisie id={id} aria-describedby={d} value={p.nom} onChange={(e) => setP({ ...p, nom: e.target.value })} placeholder="Par exemple : Banque Horizon" required />}
          </Champ>

          <fieldset>
            <legend className="text-[15px] font-semibold">Couleur principale</legend>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {COULEURS_PROPOSEES.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Couleur ${c}`}
                  aria-pressed={c === couleur}
                  onClick={() => setP({ ...p, couleur: c })}
                  className={cx('h-9 w-9 rounded-full ring-offset-2', c === couleur ? 'ring-2 ring-encre' : 'ring-1 ring-black/10')}
                  style={{ background: c }}
                />
              ))}
              <input
                type="color"
                aria-label="Autre couleur"
                value={couleur}
                onChange={(e) => setP({ ...p, couleur: e.target.value })}
                className="h-9 w-12 cursor-pointer rounded-lg border border-trait bg-surface p-1"
              />
              <span className="chiffres text-sm text-encre-3">{couleur.toUpperCase()}</span>
            </div>
            {!lisible && (
              <p className="mt-2 flex items-center gap-1.5 text-sm text-alerte">
                <TriangleAlert aria-hidden size={15} />
                Contraste faible : le texte sera moins lisible sur cette couleur.
              </p>
            )}
          </fieldset>

          <div>
            <span className="text-[15px] font-semibold">
              Logo <span className="font-normal text-encre-3">(facultatif)</span>
            </span>
            <div className="mt-2 flex items-center gap-3">
              <LogoBanque nom={b.nom} logoUrl={p.logoUrl} taille={44} />
              <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-trait-fort px-3.5 text-[15px] font-semibold hover:bg-fond">
                <ImagePlus aria-hidden size={17} />
                Choisir une image
                <input type="file" accept="image/png,image/svg+xml,image/jpeg,image/webp" className="sr-only" onChange={(e) => lireLogo(e.target.files?.[0])} />
              </label>
              {p.logoUrl && (
                <button type="button" onClick={() => setP({ ...p, logoUrl: null })} className="text-sm font-semibold text-encre-2 hover:underline">
                  Retirer
                </button>
              )}
            </div>
            {erreurLogo && <p className="mt-1.5 text-sm font-semibold text-urgent">{erreurLogo}</p>}
          </div>

          <Champ libelle="Contact affiché à la fin de la visite" facultatif>
            {(id) => <Saisie id={id} value={p.contact} onChange={(e) => setP({ ...p, contact: e.target.value })} placeholder="Votre nom, votre e-mail ou votre téléphone" />}
          </Champ>

          <div style={styleMarque(couleur)} className="overflow-hidden rounded-xl border border-trait">
            <div className="flex items-center gap-2.5 bg-marque px-4 py-3 text-sur-marque">
              <LogoBanque nom={b.nom} logoUrl={p.logoUrl} taille={28} inverse />
              <div className="leading-tight">
                <div className="font-bold">{b.nom}</div>
                <div className="text-xs opacity-85">Service réclamations</div>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <button type="button" onClick={() => surAppliquer(null)} className="text-[15px] font-semibold text-encre-2 hover:underline">
            Revenir à l'exemple ({EXEMPLE.nom})
          </button>
          <div className="flex gap-2">
            <Bouton variante="discret" onClick={surFermer}>
              Annuler
            </Bouton>
            <Bouton variante="console" type="submit" disabled={!p.nom.trim()}>
              Appliquer et recommencer
            </Bouton>
          </div>
        </div>
      </form>
    </div>
  );
}
