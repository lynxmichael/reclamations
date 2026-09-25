/**
 * Agences et points de dépôt (listerAgences, listerPointsDepot, telechargerQrCode).
 * Chaque QR code est un objet physique, affiché dans une agence : il porte le code du point,
 * donc l'agence de la réclamation, sans que le client ait à la choisir.
 */
import { Copy, Download, Ellipsis, Globe, MapPin, Plus, Printer } from 'lucide-react';
import type { S } from '../../api/types';
import { Bouton, QrCode, cx } from '../../ui/composants';

function CarteQr({ p, modifiable }: { p: S<'PointDepot'>; modifiable: boolean }) {
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
          <Bouton taille="petit" icone={<Download aria-hidden size={14} />}>PNG</Bouton>
          <Bouton taille="petit" icone={<Printer aria-hidden size={14} />}>SVG</Bouton>
          {modifiable && (
            <Bouton taille="petit" variante="discret" aria-label={`Autres actions pour ${p.libelle}`} icone={<Ellipsis aria-hidden size={16} />} />
          )}
        </div>
      </div>
    </li>
  );
}

export function PointsDepot({ agences, points, modifiable }: { agences: S<'Agence'>[]; points: S<'PointDepot'>[]; modifiable: boolean }) {
  const liens = points.filter((p) => p.canal === 'LIEN_WEB');
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
            <Bouton icone={<Plus aria-hidden size={17} />}>Nouvelle agence</Bouton>
            <Bouton variante="principal" icone={<Plus aria-hidden size={17} />}>Nouveau point de dépôt</Bouton>
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-trait bg-surface">
        {agences.map((a) => {
          const ici = points.filter((p) => p.agence?.id === a.id);
          return (
            <section key={a.id} className="flex gap-6 border-b border-trait px-5 py-4 last:border-0">
              <div className="w-48 shrink-0">
                <h2 className="text-[17px] font-bold">{a.nom}</h2>
                <p className="chiffres text-sm text-encre-3">{a.code}</p>
                <p className="mt-1 flex items-start gap-1 text-sm text-encre-2">
                  <MapPin aria-hidden size={14} className="mt-0.5 shrink-0" />
                  {[a.adresse, a.ville].filter(Boolean).join(', ')}
                </p>
              </div>
              {ici.length > 0 ? (
                <ul className="flex flex-wrap gap-3">{ici.map((p) => <CarteQr key={p.id} p={p} modifiable={modifiable} />)}</ul>
              ) : (
                <p className="self-center text-[15px] text-encre-3">
                  Pas encore de QR code dans cette agence.{modifiable && ' Créez-en un pour l\'afficher à l\'accueil.'}
                </p>
              )}
            </section>
          );
        })}
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-[19px] font-bold">Liens web</h2>
        <p className="-mt-1.5 text-[15px] text-encre-3">À placer sur le site ou dans l'application. Le client peut indiquer une agence s'il le souhaite.</p>
        <ul className="overflow-hidden rounded-xl border border-trait bg-surface">
          {liens.map((p) => (
            <li key={p.id} className="flex items-center gap-4 border-b border-trait px-4 py-3 last:border-0">
              <Globe aria-hidden size={19} className="shrink-0 text-encre-3" />
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{p.libelle}</p>
                <p className="truncate text-sm text-encre-2">{p.urlDepot}</p>
              </div>
              <Bouton taille="petit" icone={<Copy aria-hidden size={14} />}>Copier le lien</Bouton>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
