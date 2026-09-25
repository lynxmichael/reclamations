/**
 * Saisie du code à usage unique (OtpEnvoye, puis verifierCodeOtp → SessionClient de 30 min).
 * Règles C7 : 6 chiffres, valable 10 min, 5 essais, 3 envois par heure.
 */
import { ChevronLeft } from 'lucide-react';
import type { S } from '../../api/types';
import { Bouton, cx } from '../../ui/composants';
import { CadrePortail } from './CadrePortail';

export function CodeOtp({ banque, numero, otp, saisi }: { banque: S<'BanquePublique'>; numero: string; otp: S<'OtpEnvoye'>; saisi: string }) {
  const chiffres = Array.from({ length: 6 }, (_, i) => saisi[i] ?? '');
  const minutes = Math.round(otp.expireDans / 60);
  return (
    <CadrePortail banque={banque}>
      <div className="px-5 pt-5 pb-10">
        <button type="button" className="-ml-1.5 inline-flex items-center gap-1 rounded py-1 pr-2 text-[15px] font-semibold text-marque-texte">
          <ChevronLeft aria-hidden size={18} />
          {numero}
        </button>
        <h1 className="mt-5 text-[26px] leading-tight font-bold tracking-tight">Saisissez le code reçu</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-encre-2">
          Envoyé par {otp.canal === 'SMS' ? 'SMS au' : 'e-mail à'} <span className="chiffres font-semibold whitespace-nowrap text-encre">{otp.destinationMasquee}</span>. Il est valable {minutes} minutes.
        </p>

        <fieldset className="mt-7">
          <legend className="sr-only">Code à 6 chiffres</legend>
          <div className="flex justify-between gap-2">
            {chiffres.map((c, i) => (
              <input
                key={i}
                aria-label={`Chiffre ${i + 1}`}
                inputMode="numeric"
                autoComplete={i === 0 ? 'one-time-code' : 'off'}
                maxLength={1}
                defaultValue={c}
                className={cx(
                  'chiffres h-14 w-full min-w-0 rounded-xl border-2 text-center text-2xl font-bold text-encre focus:border-marque focus:outline-none',
                  c ? 'border-encre-3 bg-surface' : i === saisi.length ? 'border-marque bg-surface ring-4 ring-marque-trait' : 'border-trait-fort bg-fond',
                )}
              />
            ))}
          </div>
        </fieldset>

        <Bouton variante="principal" taille="grand" className="mt-7 w-full" disabled={saisi.length < 6}>
          Valider
        </Bouton>

        <div className="mt-8 border-t border-trait pt-5 text-[15px] leading-relaxed text-encre-2">
          <p>Pas reçu ? Vérifiez le numéro indiqué ci-dessus, puis demandez un nouveau code.</p>
          <button type="button" disabled className="mt-2 font-semibold text-encre-3">
            Renvoyer un code dans 0:48
          </button>
        </div>
      </div>
    </CadrePortail>
  );
}
