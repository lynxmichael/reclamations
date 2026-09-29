/**
 * Cadre du portail client, aux couleurs de la banque (décision E2) : pensé d'abord pour un
 * téléphone, ouvert en scannant le QR code d'une agence.
 */
import { useContext, type ReactNode } from 'react';
import type { S } from '../../api/types';
import { LogoBanque } from '../../ui/composants';
import { LienPolitique } from '../../ui/contextes';
import { styleMarque } from '../../ui/marque';

export function CadrePortail({
  banque,
  contexte,
  action,
  children,
  bas,
}: {
  banque: S<'BanquePublique'>;
  /** Sous le nom de la banque : l'agence du QR code, ou l'espace client */
  contexte?: ReactNode;
  /** En haut à droite : « Se déconnecter » dans l'espace client */
  action?: ReactNode;
  children: ReactNode;
  /** Barre fixée en bas de l'écran (bouton d'envoi) */
  bas?: ReactNode;
}) {
  const lienPolitique = useContext(LienPolitique);
  return (
    <div style={styleMarque(banque.couleurPrimaire)} className="flex min-h-full flex-col bg-surface text-encre">
      <header className="bg-marque px-5 pt-4 pb-5 text-sur-marque">
        <div className="flex items-center gap-3">
          <LogoBanque nom={banque.nom} logoUrl={banque.logoUrl} taille={38} inverse />
          <div className="min-w-0 flex-1 leading-tight">
            <div className="text-[17px] font-bold">{banque.nom}</div>
            <div className="text-sm opacity-85">Service réclamations</div>
          </div>
          {action}
        </div>
        {contexte && <div className="mt-4">{contexte}</div>}
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-trait px-5 pt-5 pb-8 text-sm leading-relaxed text-encre-3">
        Vos informations servent uniquement à traiter votre réclamation.{' '}
        <a href={lienPolitique} className="font-semibold text-marque-texte underline underline-offset-2">
          Politique de données
        </a>
      </footer>
      {bas && <div className="sticky bottom-0 border-t border-trait bg-surface/95 p-4 backdrop-blur">{bas}</div>}
    </div>
  );
}
