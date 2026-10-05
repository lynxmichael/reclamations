/**
 * Outils de texte de l'assistant (étape 18) : mise à plat d'un message du client pour les règles
 * (minuscules, sans accents, apostrophes et espaces uniformes), mots significatifs.
 */

/** Minuscules, sans accents, apostrophes droites, espaces simples. */
export function aplatir(texte: string): string {
  return texte
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’`´]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

const VIDES = new Set([
  'alors', 'aussi', 'avec', 'avoir', 'avez', 'avons', 'bien', 'cela', 'ceci', 'cette', 'comme', 'comment', 'dans', 'depuis', 'donc',
  'elle', 'elles', 'etre', 'faire', 'fait', 'leur', 'leurs', 'mais', 'meme', 'merci', 'mes', 'mon', 'nous', 'notre', 'pour', 'pourquoi',
  'quand', 'quel', 'quelle', 'quelles', 'quels', 'sans', 'sont', 'suis', 'tout', 'tous', 'tres', 'vous', 'votre', 'vos', 'bonjour',
  'bonsoir', 'svp', 'stp', 'plait', 'est-ce', 'peux', 'peut', 'puis', 'veux', 'voudrais', 'aimerais', 'savoir', 'combien', 'quoi',
  'banque', 'chez', 'encore', 'deja', 'jai', "j'ai", 'cest', "c'est", 'quil', "qu'il", 'avec', 'entre', 'apres', 'avant', 'autre',
]);

/** Mots de même sens, ramenés à une seule forme avant comparaison. */
const SYNONYMES: readonly [RegExp, string][] = [
  [/^(?:horaires?|heures?)$/, 'horaire'],
  [/^(?:ouvr\w*|ouvert\w*)$/, 'ouvert'],
  [/^(?:appli|applis|app|apps|applications?)$/, 'application'],
  [/^(?:gab|dab|distributeurs?|guichets? automatiques?)$/, 'distributeur'],
  [/^(?:papiers?|pieces?|documents?|justificatifs?)$/, 'document'],
  [/^(?:avale\w*|retenu\w*|gardee?s?)$/, 'avale'],
  [/^(?:agios|commissions?)$/, 'frais'],
  [/^(?:perdu\w*|perte)$/, 'perdu'],
  [/^(?:volee?s?|vol)$/, 'vole'],
  [/^(?:delais?|temps|duree|longtemps)$/, 'delai'],
  [/^(?:suivi|suivre|avancement)$/, 'suivre'],
];

const canon = (m: string) => SYNONYMES.find(([r]) => r.test(m))?.[1] ?? m;

/**
 * Mots significatifs : synonymes ramenés à une forme, 4 lettres au moins, hors mots vides, réduits à
 * leurs 6 premières lettres (« retirer », « retrait » et « retraits » se rejoignent assez pour
 * comparer des phrases courtes).
 */
export function motsSignificatifs(texte: string): Set<string> {
  const mots = aplatir(texte).replace(/guichets? automatiques?/g, 'distributeur').replace(/[^a-z0-9' -]/g, ' ').split(/[\s'-]+/);
  return new Set(mots.map(canon).filter((m) => m.length >= 4 && !VIDES.has(m) && !/^\d+$/.test(m)).map((m) => m.slice(0, 6)));
}

/** Le message pose-t-il une question (point d'interrogation ou tournure interrogative) ? */
export function estQuestion(texte: string): boolean {
  const t = aplatir(texte);
  return t.includes('?') || /^(comment|combien|quel|quelle|quels|quelles|ou |est-ce|pourquoi|quand|puis-je|peut-on|peux-tu|pouvez-vous|faut-il|c'est quoi|cest quoi)/.test(t)
    || /\b(comment (faire|on fait|je fais)|c'?est combien|a quelle heure|quels sont|quelles sont)\b/.test(t);
}
