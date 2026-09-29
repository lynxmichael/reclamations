/**
 * Saisie du code à usage unique (OtpEnvoye, puis verifierCodeOtp → SessionClient de 30 min).
 * Règles C7 : 6 chiffres, valable 10 min, 5 essais, 3 envois par heure.
 */
import { useEffect, useRef, useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import type { S } from '../../api/types';
import { Bouton, cx } from '../../ui/composants';
import { CadrePortail } from './CadrePortail';

export function CodeOtp({
  banque,
  numero,
  otp,
  saisi,
  erreur,
  surValider,
  surRenvoyer,
  surRetour,
}: {
  banque: S<'BanquePublique'>;
  numero: string;
  otp: S<'OtpEnvoye'>;
  /** Code déjà saisi (ou proposé par le téléphone à l'arrivée du SMS) */
  saisi: string;
  erreur?: string | null;
  surValider?: (code: string) => void;
  surRenvoyer?: () => void;
  surRetour?: () => void;
}) {
  const [code, setCode] = useState(saisi);
  const cases = useRef<(HTMLInputElement | null)[]>([]);
  useEffect(() => setCode(saisi), [saisi]);
  const chiffres = Array.from({ length: 6 }, (_, i) => code[i] ?? '');
  const minutes = Math.round(otp.expireDans / 60);

  const saisir = (i: number, valeur: string) => {
    const propres = valeur.replace(/\D/g, '');
    if (propres.length > 1) {
      setCode(propres.slice(0, 6));
      cases.current[Math.min(5, propres.length)]?.focus();
      return;
    }
    const suite = (code.slice(0, i) + propres + code.slice(i + 1)).slice(0, 6);
    setCode(suite);
    if (propres && i < 5) cases.current[i + 1]?.focus();
  };

  return (
    <CadrePortail banque={banque}>
      <div className="px-5 pt-5 pb-10">
        <button type="button" onClick={surRetour} className="-ml-1.5 inline-flex items-center gap-1 rounded py-1 pr-2 text-[15px] font-semibold text-marque-texte">
          <ChevronLeft aria-hidden size={18} />
          {numero}
        </button>
        <h1 className="mt-5 text-[26px] leading-tight font-bold tracking-tight">Saisissez le code reçu</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-encre-2">
          Envoyé par {otp.canal === 'SMS' ? 'SMS au' : 'e-mail à'} <span className="chiffres font-semibold whitespace-nowrap text-encre">{otp.destinationMasquee}</span>. Il est valable {minutes} minutes.
        </p>

        <form
          className="mt-7"
          onSubmit={(e) => {
            e.preventDefault();
            surValider?.(code);
          }}
        >
          <fieldset>
            <legend className="sr-only">Code à 6 chiffres</legend>
            <div className="flex justify-between gap-2">
              {chiffres.map((c, i) => (
                <input
                  key={i}
                  ref={(el) => {
                    cases.current[i] = el;
                  }}
                  aria-label={`Chiffre ${i + 1}`}
                  inputMode="numeric"
                  autoComplete={i === 0 ? 'one-time-code' : 'off'}
                  value={c}
                  onChange={(e) => saisir(i, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Backspace' && !c && i > 0) cases.current[i - 1]?.focus();
                  }}
                  className={cx(
                    'chiffres h-14 w-full min-w-0 rounded-xl border-2 text-center text-2xl font-bold text-encre focus:border-marque focus:outline-none',
                    erreur ? 'border-urgent bg-surface' : c ? 'border-encre-3 bg-surface' : i === code.length ? 'border-marque bg-surface ring-4 ring-marque-trait' : 'border-trait-fort bg-fond',
                  )}
                />
              ))}
            </div>
          </fieldset>
          {erreur && <p role="alert" className="mt-3 text-sm font-semibold text-urgent">{erreur}</p>}

          <Bouton type="submit" variante="principal" taille="grand" className="mt-7 w-full" disabled={code.length < 6} data-visite="valider-code">
            Valider
          </Bouton>
        </form>

        <div className="mt-8 border-t border-trait pt-5 text-[15px] leading-relaxed text-encre-2">
          <p>Pas reçu ? Vérifiez le numéro indiqué ci-dessus, puis demandez un nouveau code.</p>
          <button type="button" onClick={surRenvoyer} disabled={!surRenvoyer} className={cx('mt-2 font-semibold', surRenvoyer ? 'text-marque-texte hover:underline' : 'text-encre-3')}>
            {surRenvoyer ? 'Renvoyer un code' : 'Renvoyer un code dans 0:48'}
          </button>
        </div>
      </div>
    </CadrePortail>
  );
}
