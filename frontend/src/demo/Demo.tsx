/**
 * La démo cliquable, à présenter aux banques : le téléphone du client et le back-office côte à
 * côte, une horloge qu'on peut avancer, la visite guidée, la mise aux couleurs du prospect.
 */
import { useEffect, useState } from 'react';
import { CircleCheck, Clock3, Info, RotateCcw, Sparkles, TriangleAlert } from 'lucide-react';
import { LogoBanque, cx } from '../ui/composants';
import { dateCourte, dateLongue, heure } from '../ui/format';
import { NavigateurAjuste, TelephoneAjuste } from './Cadres';
import { Ouverture } from './Ouverture';
import { Personnalisation } from './Personnalisation';
import { EXEMPLE, enregistrerProspect, lireProspect } from './prospect';
import { useDemo, type Role } from './useDemo';
import { CarteVisite, ETAPES } from './Visite';
import { EcranBanque, EcranClient, NotificationSms, adresseBanque } from './Vues';

const ROLES: { cle: Role; libelle: string; qui: string }[] = [
  { cle: 'SUPERVISEUR', libelle: 'Superviseur', qui: 'Serge Kouadio, superviseur' },
  { cle: 'AGENT', libelle: 'Agent', qui: 'Aya Konan, agent' },
  { cle: 'ADMIN_ENTREPRISE', libelle: 'Admin', qui: 'Fatou Diabaté, Admin Entreprise' },
];

function Segments<T extends string>({ valeur, options, surChoix, libelle }: { valeur: T; options: { cle: T; libelle: string }[]; surChoix: (v: T) => void; libelle: string }) {
  return (
    <div role="radiogroup" aria-label={libelle} className="flex rounded-lg bg-fond p-0.5 ring-1 ring-trait">
      {options.map((o) => (
        <button
          key={o.cle}
          type="button"
          role="radio"
          aria-checked={o.cle === valeur}
          onClick={() => surChoix(o.cle)}
          className={cx('rounded-md px-2.5 py-1 text-sm font-semibold whitespace-nowrap', o.cle === valeur ? 'bg-surface text-encre shadow-sm ring-1 ring-trait' : 'text-encre-3 hover:text-encre')}
        >
          {o.libelle}
        </button>
      ))}
    </div>
  );
}

/** Écran assez large pour montrer le téléphone et le back-office côte à côte. */
function useLarge() {
  const requete = '(min-width: 1024px)';
  const [large, setLarge] = useState(() => window.matchMedia(requete).matches);
  useEffect(() => {
    const m = window.matchMedia(requete);
    const changer = () => setLarge(m.matches);
    m.addEventListener('change', changer);
    return () => m.removeEventListener('change', changer);
  }, []);
  return large;
}

export function Demo() {
  const d = useDemo(lireProspect());
  const large = useLarge();
  const [ouverte, setOuverte] = useState(false);
  const [visite, setVisite] = useState<number | null>(null);
  const [reduite, setReduite] = useState(false);
  const [perso, setPerso] = useState(false);
  const [cote, setCote] = useState<'client' | 'banque'>('client');
  const { moteur } = d;
  const etape = visite === null ? null : ETAPES[visite]!;

  const aller = (i: number) => {
    if (i < 0) {
      d.recommencer();
      setVisite(0);
      return;
    }
    setVisite(Math.min(i, ETAPES.length - 1));
    setReduite(false);
  };

  // En entrant dans une étape : préparer les écrans et montrer le bon côté sur un petit écran
  useEffect(() => {
    if (!etape) return;
    etape.preparer?.(d);
    setCote(etape.cote);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visite]);

  // Mettre en évidence l'élément dont parle l'étape
  const cible = etape?.cible?.(d) ?? null;
  useEffect(() => {
    if (!cible) return;
    const t = window.setTimeout(() => {
      const els = document.querySelectorAll<HTMLElement>(`[data-visite="${cible}"]`);
      els.forEach((el) => el.classList.add('visite-cible'));
      els[0]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, 60);
    return () => {
      window.clearTimeout(t);
      document.querySelectorAll('.visite-cible').forEach((el) => el.classList.remove('visite-cible'));
    };
  });

  const banqueDemo = moteur.banque;
  const qui = ROLES.find((r) => r.cle === d.banque.role)!;

  if (!ouverte) {
    return (
      <>
        <Ouverture
          banque={banqueDemo}
          surVisite={() => {
            setOuverte(true);
            setVisite(0);
          }}
          surLibre={() => setOuverte(true)}
          surPreparer={() => setPerso(true)}
        />
        {perso && (
          <Personnalisation
            actuel={d.prospect}
            surFermer={() => setPerso(false)}
            surAppliquer={(p) => {
              enregistrerProspect(p);
              d.recommencer(p ?? EXEMPLE);
              setPerso(false);
            }}
          />
        )}
      </>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#e4e8ec]">
      {/* Barre de la démo */}
      <header className="z-30 flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-trait bg-surface px-4 py-2.5">
        <div className="flex items-center gap-2.5">
          <span className="rounded-md bg-console px-2 py-0.5 text-[13px] font-bold text-white">Démo</span>
          <LogoBanque nom={banqueDemo.nom} logoUrl={banqueDemo.logoUrl} taille={26} />
          <span className="max-w-[16ch] truncate font-bold">{banqueDemo.nom}</span>
          <button type="button" onClick={() => setPerso(true)} className="text-sm font-semibold text-console hover:underline">
            Changer
          </button>
        </div>

        <div className="flex items-center gap-2 rounded-lg px-1 py-0.5" data-visite="horloge">
          <Clock3 aria-hidden size={17} className="text-encre-3" />
          <span className="chiffres text-[15px] font-semibold first-letter:uppercase" aria-live="polite">
            <span className="sm:hidden">{dateCourte(moteur.maintenant.toISOString())}</span>
            <span className="hidden sm:inline">{dateLongue(moteur.maintenant.toISOString())}</span>
          </span>
          <span className="sr-only">Avancer l'horloge de la démo :</span>
          {[
            [60, '+1 h'],
            [240, '+4 h'],
            [1440, '+1 jour'],
          ].map(([m, l]) => (
            <button
              key={l}
              type="button"
              onClick={() => d.avancerHorloge(m as number)}
              className="chiffres rounded-md bg-fond px-2 py-1 text-sm font-semibold whitespace-nowrap text-encre-2 ring-1 ring-trait hover:bg-white hover:text-encre"
            >
              {l}
            </button>
          ))}
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="hidden text-sm text-encre-3 sm:inline">Banque vue par</span>
            <Segments libelle="Banque vue par" valeur={d.banque.role} options={ROLES} surChoix={d.actionsBanque.role} />
          </div>
          <button
            type="button"
            onClick={() => (visite === null ? aller(0) : setVisite(null))}
            className={cx('inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold', visite === null ? 'bg-console text-white hover:brightness-110' : 'bg-console-doux text-console')}
          >
            <Sparkles aria-hidden size={15} />
            {visite === null ? 'Visite guidée' : <><span className="sm:hidden">Arrêter</span><span className="hidden sm:inline">Arrêter la visite</span></>}
          </button>
          <button
            type="button"
            onClick={() => {
              d.recommencer();
              if (visite !== null) setVisite(0);
            }}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-encre-2 ring-1 ring-trait hover:bg-fond"
          >
            <RotateCcw aria-hidden size={15} />
            <span className="hidden sm:inline">Recommencer</span>
          </button>
        </div>
      </header>

      {/* Sur un petit écran : un côté à la fois */}
      <div className="flex gap-1 border-b border-trait bg-surface px-4 lg:hidden" role="tablist">
        {(['client', 'banque'] as const).map((c) => (
          <button
            key={c}
            type="button"
            role="tab"
            aria-selected={cote === c}
            onClick={() => setCote(c)}
            className={cx('-mb-px border-b-[3px] px-3 py-2.5 text-[15px] font-semibold', cote === c ? 'border-console text-encre' : 'border-transparent text-encre-3')}
          >
            {c === 'client' ? 'Téléphone du client' : 'Back-office de la banque'}
          </button>
        ))}
      </div>

      <main className="grid min-h-0 flex-1 grid-cols-1 gap-5 px-4 py-4 lg:grid-cols-[412px_minmax(0,1fr)] lg:px-5">
        <section aria-label="Téléphone du client" className={cx('min-h-0 flex-col gap-2', cote === 'client' ? 'flex' : 'hidden lg:flex')}>
          <p className="text-sm font-semibold text-encre-2">Le client, sur son téléphone</p>
          <div className="min-h-0 flex-1">
            {large ? (
              <TelephoneAjuste
                couleur={banqueDemo.couleur}
                heure={heure(moteur.maintenant.toISOString())}
                superposition={<NotificationSms d={d} />}
                ecran={`${d.client.e}-${'id' in d.client ? d.client.id : ''}`}
              >
                <EcranClient d={d} />
              </TelephoneAjuste>
            ) : (
              // Sur un téléphone, l'écran du client occupe simplement la place, sans cadre
              <div className="relative h-full overflow-hidden rounded-xl bg-white ring-1 ring-trait">
                <div className="flex h-full flex-col overflow-y-auto [&>*]:shrink-0 [&>*]:grow" data-ecran-telephone>
                  <EcranClient d={d} />
                </div>
                <NotificationSms d={d} />
              </div>
            )}
          </div>
          {large && visite !== null && !reduite && (
            <CarteVisite d={d} index={visite} surAller={aller} surQuitter={() => setVisite(null)} surReduire={() => setReduite(true)} reduite={false} integree />
          )}
        </section>
        <section aria-label="Back-office de la banque" className={cx('min-h-0 flex-col gap-2', cote === 'banque' ? 'flex' : 'hidden lg:flex')}>
          <p className="text-sm font-semibold text-encre-2">
            La banque, connectée en tant que {qui.qui}
            <span className="font-normal text-encre-3 lg:hidden">. Le back-office est conçu pour un ordinateur : ici, il est réduit.</span>
          </p>
          <div className="min-h-0 flex-1">
            <NavigateurAjuste adresse={adresseBanque(d)}>
              <EcranBanque d={d} />
            </NavigateurAjuste>
          </div>
        </section>
      </main>

      {/* Messages de retour */}
      <div aria-live="polite" className="pointer-events-none fixed top-16 left-1/2 z-50 flex w-[min(560px,calc(100vw-2rem))] -translate-x-1/2 flex-col gap-2">
        {d.messages.map((m) => (
          <p
            key={m.id}
            className={cx(
              'flex items-start gap-2.5 rounded-xl px-4 py-3 text-[15px] shadow-lg ring-1',
              m.ton === 'erreur' ? 'bg-urgent-doux text-urgent ring-urgent/25' : m.ton === 'info' ? 'bg-surface text-encre ring-trait' : 'bg-encre text-white ring-black/10',
            )}
          >
            {m.ton === 'erreur' ? <TriangleAlert aria-hidden size={18} className="mt-0.5 shrink-0" /> : m.ton === 'info' ? <Info aria-hidden size={18} className="mt-0.5 shrink-0 text-console" /> : <CircleCheck aria-hidden size={18} className="mt-0.5 shrink-0" />}
            {m.texte}
          </p>
        ))}
      </div>

      {visite !== null && (!large || reduite) && (
        <CarteVisite d={d} index={visite} surAller={aller} surQuitter={() => setVisite(null)} surReduire={() => setReduite((r) => !r)} reduite={reduite} />
      )}

      {perso && (
        <Personnalisation
          actuel={d.prospect}
          surFermer={() => setPerso(false)}
          surAppliquer={(p) => {
            enregistrerProspect(p);
            d.recommencer(p ?? EXEMPLE);
            setPerso(false);
            if (visite !== null) setVisite(0);
          }}
        />
      )}
    </div>
  );
}
