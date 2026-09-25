/** Référence du système visuel : ce que l'étape 8 réutilisera tel quel. */
import type { S } from '../../api/types';
import { BadgeStatut, BadgeUrgent, Bouton, LogoBanque } from '../../ui/composants';
import { JaugeLigne, type Chrono } from '../../ui/JaugeSla';
import { ETAT_CHRONO } from '../../ui/libelles';
import { contraste, couleurValide, marquePourTexte, styleMarque, texteSur } from '../../ui/marque';
import { ALPHA, HORIZON } from '../donnees/commun';

const STATUTS: S<'StatutReclamation'>[] = ['OUVERTE', 'EN_COURS', 'EN_ATTENTE_CLIENT', 'RESOLUE', 'CLOTUREE'];
const CHRONOS: { c: Chrono; echeance: string | null }[] = [
  { c: { etat: 'DANS_LES_DELAIS', delaiCibleMinutes: 960, minutesRestantes: 582 }, echeance: '2026-09-28T17:22:00Z' },
  { c: { etat: 'ALERTE', delaiCibleMinutes: 240, minutesRestantes: 50 }, echeance: '2026-09-25T16:00:00Z' },
  { c: { etat: 'DEPASSE', delaiCibleMinutes: 1440, minutesRestantes: -550 }, echeance: '2026-09-24T11:30:00Z' },
  { c: { etat: 'EN_PAUSE', delaiCibleMinutes: 960, minutesRestantes: 480 }, echeance: null },
  { c: { etat: 'ARRETE', delaiCibleMinutes: 1440, minutesRestantes: null }, echeance: null },
];

function Marque({ banque }: { banque: S<'BanquePublique'> }) {
  const c = couleurValide(banque.couleurPrimaire);
  const texte = texteSur(c);
  return (
    <div style={styleMarque(c)} className="flex flex-col gap-3 rounded-xl border border-trait bg-surface p-4">
      <div className="flex items-center gap-3 rounded-lg bg-marque px-3 py-2.5 text-sur-marque">
        <LogoBanque nom={banque.nom} logoUrl={null} taille={28} inverse />
        <span className="font-bold">{banque.nom}</span>
      </div>
      <div className="flex items-center gap-3">
        <Bouton variante="principal" taille="petit">Envoyer</Bouton>
        <a href="#lien" className="text-[15px] font-semibold text-marque-texte underline underline-offset-2">Un lien</a>
      </div>
      <p className="chiffres text-sm text-encre-3">
        {c.toUpperCase()} ; texte {texte === '#ffffff' ? 'blanc' : 'foncé'}, contraste {contraste(c, texte).toFixed(1).replace('.', ',')} ; liens en {marquePourTexte(c).toUpperCase()}
      </p>
    </div>
  );
}

export function SystemeVisuel() {
  return (
    <section className="flex flex-col gap-6">
      <div>
        <h2 className="text-[24px] font-bold tracking-tight">Système visuel</h2>
        <p className="mt-2 max-w-[68ch] text-[15px] leading-relaxed text-encre-2">
          Les couleurs de statut et du chrono sont les mêmes pour toutes les banques, toujours doublées d'une icône et d'un libellé. Seule la couleur de la marque change.
        </p>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <div className="rounded-xl border border-trait bg-surface p-5">
          <h3 className="font-bold">Statuts et priorité</h3>
          <div className="mt-3 flex flex-wrap gap-2">
            {STATUTS.map((s) => <BadgeStatut key={s} statut={s} />)}
            <BadgeUrgent priorite="URGENTE" />
          </div>
          <p className="mt-3 text-sm text-encre-3">Le client lit des libellés à sa mesure :</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {STATUTS.map((s) => <BadgeStatut key={s} statut={s} pourClient />)}
          </div>
        </div>

        <div className="rounded-xl border border-trait bg-surface p-5">
          <h3 className="font-bold">Typographie</h3>
          <p className="mt-3 text-[15px] leading-relaxed text-encre-2">Atkinson Hyperlegible Next, une seule famille, auto-hébergée. Chiffres et lettres qu'on ne confond pas :</p>
          <p className="chiffres mt-2 text-[28px] font-bold tracking-wide">ALP-2026-002442</p>
          <p className="chiffres text-lg tracking-[0.3em] text-encre-2">0O 1lI 5S 8B</p>
        </div>
      </div>

      <div className="rounded-xl border border-trait bg-surface p-5">
        <h3 className="font-bold">Chrono SLA</h3>
        <p className="mt-1 text-[15px] text-encre-2">Temps ouvré consommé ; le trait vertical marque le seuil d'alerte de la banque (75 %).</p>
        <div className="mt-4 grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-5">
          {CHRONOS.map(({ c, echeance }) => (
            <div key={c.etat}>
              <p className="mb-2 text-sm font-semibold text-encre-2">{ETAT_CHRONO[c.etat]}</p>
              <JaugeLigne c={c} echeanceLe={echeance} />
            </div>
          ))}
        </div>
      </div>

      <div>
        <h3 className="font-bold">Couleur de la banque</h3>
        <p className="mt-1 text-[15px] text-encre-2">Le texte sur la couleur et la teinte des liens s'ajustent seuls, même pour une couleur très claire.</p>
        <div className="mt-3 grid gap-5 md:grid-cols-2">
          <Marque banque={ALPHA} />
          <Marque banque={HORIZON} />
        </div>
      </div>
    </section>
  );
}
