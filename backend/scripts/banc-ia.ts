/**
 * Banc d'essai de l'assistant IA (étape 18, décision I6) : 100 échanges fictifs (banc-ia/corpus.json),
 * plus 15 messages neufs de contrôle, soumis à chaque fournisseur dont la clé est fournie, et toujours
 * aux règles sans IA (référence).
 * Écrit docs/banc-ia/rapport.md et docs/banc-ia/resultats.json.
 *
 *   npm run banc-ia                      (règles seules, sans clé)
 *   BANC_ANTHROPIC_CLE=… BANC_OPENAI_CLE=… BANC_MISTRAL_CLE=… npm run banc-ia
 *
 * PowerShell : $env:BANC_MISTRAL_CLE = "…" ; npm run banc-ia
 * Par fournisseur, facultatif : BANC_<F>_MODELE, BANC_<F>_URL, BANC_<F>_PRIX_ENTREE, BANC_<F>_PRIX_SORTIE.
 *
 * Les messages partent masqués, avec exactement les consignes de l'API ; les échanges sont fictifs.
 * Un appel à la fois, délai de 8 s comme dans l'API.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { URL_IA_PAR_DEFAUT } from '../src/configuration/configuration.js';
import { categorieParRegles, decisionParRegles, faqParRegles, urgenceParRegles, type ContexteAssistant, type Echange } from '../src/domaine/ia/assistant.js';
import { brouillonParRegles, consignesBrouillon, consignesTri, type Brouillon, type Consignes, type ContexteRedaction } from '../src/domaine/ia/consignes.js';
import { CATEGORIES_EXEMPLE, faqExemple } from '../src/domaine/ia/exemples.js';
import { masquer } from '../src/domaine/ia/masquage.js';
import { creerFournisseur, ErreurFournisseur, type FournisseurIa } from '../src/infrastructure/ia/fournisseurs.js';
import {
  classer, rapportMarkdown, synthese, type Candidat, type CasBrouillon, type CasTri, type Corpus, type FichierFournisseurs, type ResultatBrouillon, type ResultatTri,
} from './banc-ia/evaluation.js';

const DOSSIER = resolve(__dirname, '../banc-ia');
const SORTIE = resolve(__dirname, '../../docs/banc-ia');
const DELAI_MS = 8000;

const corpus = JSON.parse(readFileSync(resolve(DOSSIER, 'corpus.json'), 'utf8')) as Corpus;
const fichier = JSON.parse(readFileSync(resolve(DOSSIER, 'fournisseurs.json'), 'utf8')) as FichierFournisseurs;

const faq = faqExemple();
const ctx: ContexteAssistant = { banque: corpus.banque, faq, categories: CATEGORIES_EXEMPLE, ouverte: true, reprise: null };
const nomCategorie = (id: string) => CATEGORIES_EXEMPLE.find((c) => c.id === id)?.nom ?? id;

function redaction(c: CasBrouillon): ContexteRedaction {
  return {
    banque: corpus.banque, categorie: nomCategorie(c.categorie), statut: c.statut, faq, categories: CATEGORIES_EXEMPLE,
    description: masquer(c.description).texte,
    messages: c.messages.map((m) => ({ auteur: m.auteur, texte: masquer(m.texte).texte })),
  };
}

const echangesDe = (c: CasTri): Echange[] => c.echanges.map((e) => (e.auteur === 'CLIENT' ? { auteur: 'CLIENT', texte: e.texte ?? '' } : { auteur: 'ASSISTANT', texte: '', code: e.code }));

async function appeler<T>(f: FournisseurIa, consignes: Consignes<T>) {
  const debut = performance.now();
  try {
    const r = await f.demander(consignes as Consignes<unknown>, AbortSignal.timeout(DELAI_MS));
    const resultat = consignes.traduire(r.brute);
    return { resultat, dureeMs: Math.round(performance.now() - debut), jetonsEntree: r.jetonsEntree, jetonsSortie: r.jetonsSortie, echec: resultat ? null : 'REPONSE_INVALIDE' };
  } catch (e) {
    const issue = e instanceof ErreurFournisseur ? e.issue : 'ERREUR';
    return {
      resultat: null, dureeMs: Math.round(performance.now() - debut),
      jetonsEntree: e instanceof ErreurFournisseur ? e.jetonsEntree : 0, jetonsSortie: e instanceof ErreurFournisseur ? e.jetonsSortie : 0,
      echec: `${issue} : ${(e as Error).message.slice(0, 160)}`,
    };
  }
}

async function essayer(f: FournisseurIa | null) {
  const tris: ResultatTri[] = [];
  const brouillons: ResultatBrouillon[] = [];
  const neufs: ResultatTri[] = [];
  const tous = [...corpus.cas, ...corpus.controle.cas];
  let n = 0;
  for (const c of tous) {
    n++;
    // Avancement : sur la même ligne dans un terminal, toutes les 25 réponses sinon
    if (f && process.stdout.isTTY) process.stdout.write(`\r  ${f.nom} : ${n}/${tous.length}   `);
    else if (f && (n % 25 === 0 || n === tous.length)) console.log(`  ${f.nom} : ${n}/${tous.length}`);
    const vers = c.id.startsWith('N') ? neufs : tris;
    if (c.type === 'tri') {
      const echanges = echangesDe(c);
      if (!f) {
        const debut = performance.now();
        const decision = decisionParRegles(echanges, ctx);
        vers.push({ cas: c, decision, dureeMs: Math.round(performance.now() - debut), jetonsEntree: 0, jetonsSortie: 0, echec: null });
        continue;
      }
      const masques = echanges.map((e) => (e.auteur === 'CLIENT' ? { ...e, texte: masquer(e.texte).texte } : e));
      const r = await appeler(f, consignesTri(masques, ctx));
      vers.push({ cas: c, decision: r.resultat, dureeMs: r.dureeMs, jetonsEntree: r.jetonsEntree, jetonsSortie: r.jetonsSortie, echec: r.echec });
    } else {
      const red = redaction(c);
      if (!f) {
        const textes = [c.description, ...c.messages.filter((m) => m.auteur === 'CLIENT').map((m) => m.texte)].join('\n');
        const proche = faqParRegles(textes, faq);
        const categorieId = categorieParRegles(textes, CATEGORIES_EXEMPLE);
        const b: Brouillon = {
          ...brouillonParRegles(red, proche ? faq.find((x) => x.id === proche.id) ?? null : null),
          // Comme l'API : une catégorie n'est suggérée que si elle diffère de l'actuelle
          categorieId: categorieId === c.categorie ? null : categorieId,
          urgente: urgenceParRegles(textes),
        };
        brouillons.push({ cas: c, brouillon: b, dureeMs: 0, jetonsEntree: 0, jetonsSortie: 0, echec: null });
        continue;
      }
      const r = await appeler(f, consignesBrouillon(red));
      const b = r.resultat ? { ...r.resultat, categorieId: r.resultat.categorieId === c.categorie ? null : r.resultat.categorieId } : null;
      brouillons.push({ cas: c, brouillon: b, dureeMs: r.dureeMs, jetonsEntree: r.jetonsEntree, jetonsSortie: r.jetonsSortie, echec: r.echec });
    }
  }
  if (f && process.stdout.isTTY) process.stdout.write('\n');
  return { tris, brouillons, neufs };
}

/** Candidat du fichier, modèle, adresse et tarifs remplaçables par l'environnement. */
function configurer(c: Candidat): { candidat: Candidat; fournisseur: FournisseurIa } | null {
  const P = `BANC_${c.fournisseur.toUpperCase()}_`;
  const cle = process.env[`${P}CLE`]?.trim();
  if (!cle) return null;
  const nombre = (nom: string, defaut: number) => {
    const v = process.env[`${P}${nom}`]?.trim();
    return v ? Number(v.replace(',', '.')) : defaut;
  };
  const modele = process.env[`${P}MODELE`]?.trim() || c.modele;
  const candidat: Candidat = {
    ...c, modele, libelleModele: modele === c.modele ? c.libelleModele : modele,
    prixEntree: nombre('PRIX_ENTREE', c.prixEntree), prixSortie: nombre('PRIX_SORTIE', c.prixSortie),
  };
  const fournisseur = creerFournisseur({
    fournisseur: c.fournisseur, modele, cle, url: process.env[`${P}URL`]?.trim() || URL_IA_PAR_DEFAUT[c.fournisseur],
    delaiMs: DELAI_MS, prixEntree: candidat.prixEntree, prixSortie: candidat.prixSortie,
  });
  return { candidat, fournisseur };
}

async function main() {
  const date = new Date().toLocaleString('fr-FR', { timeZone: 'Africa/Abidjan', dateStyle: 'long', timeStyle: 'short' });
  console.log(`Banc d'essai de l'assistant IA — ${corpus.cas.length} échanges`);
  const regles = await essayer(null);
  const sRegles = synthese('Règles, sans IA', '—', regles.tris, regles.brouillons, null, fichier.hypotheseMensuelle, regles.neufs);
  console.log(`  règles : tri exact ${sRegles.triExact} % (messages neufs ${sRegles.triNeufs} %), brouillons sans alerte ${sRegles.brouillonsSansAlerte} %`);

  const essais = fichier.candidats.map((c) => ({ c, conf: configurer(c) }));
  const details = new Map<string, { tris: ResultatTri[]; brouillons: ResultatBrouillon[]; neufs: ResultatTri[] }>();
  const syntheses = [];
  for (const { conf } of essais) {
    if (!conf) continue;
    const r = await essayer(conf.fournisseur);
    details.set(`${conf.candidat.nom} (${conf.candidat.libelleModele})`, r);
    syntheses.push(synthese(conf.candidat.nom, conf.candidat.libelleModele, r.tris, r.brouillons, conf.candidat, fichier.hypotheseMensuelle, r.neufs));
  }
  details.set('Règles, sans IA', regles);
  const classement = classer(syntheses, fichier.ponderation);
  const nonTestes = essais.filter((e) => !e.conf).map((e) => e.c);

  mkdirSync(SORTIE, { recursive: true });
  writeFileSync(resolve(SORTIE, 'rapport.md'), rapportMarkdown({ date, corpus, fournisseurs: fichier, classement, regles: sRegles, nonTestes, details }));
  writeFileSync(resolve(SORTIE, 'resultats.json'), `${JSON.stringify({ date, classement, regles: sRegles, nonTestes: nonTestes.map((c) => c.nom) }, null, 1)}\n`);
  for (const s of classement) console.log(`  ${s.nom} (${s.modele}) : total ${s.notes.total}`);
  if (nonTestes.length) console.log(`  non essayés (pas de clé) : ${nonTestes.map((c) => c.nom).join(', ')}`);
  console.log(`Rapport : ${resolve(SORTIE, 'rapport.md')}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
