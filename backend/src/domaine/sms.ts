/**
 * SMS : décompte des segments facturés (étape 9) et mise en forme des SMS d'une conversation
 * (étape 20). Code pur, partagé par l'API, le worker et les écrans.
 */

// Alphabet GSM 03.38 : 7 bits par caractère ; les caractères de l'extension en comptent deux
const GSM_BASE = new Set([...'@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà']);
const GSM_EXTENSION = new Set([...'^{}\\[~]|€']);

/** Nombre de segments facturés : 160/153 caractères en GSM 7 bits, 70/67 en UCS-2 (accents hors GSM, emojis). */
export function segmentsSms(texte: string): number {
  const caracteres = [...texte];
  const gsm = caracteres.every((c) => GSM_BASE.has(c) || GSM_EXTENSION.has(c));
  if (gsm) {
    const longueur = caracteres.reduce((n, c) => n + (GSM_EXTENSION.has(c) ? 2 : 1), 0);
    return longueur <= 160 ? 1 : Math.ceil(longueur / 153);
  }
  // UCS-2 : les caractères hors plan de base (emojis) comptent deux unités
  const unites = texte.length;
  return unites <= 70 ? 1 : Math.ceil(unites / 67);
}

/** Caractères français hors alphabet GSM, et leur équivalent : un seul suffirait à doubler le coût. */
const VERS_GSM: Record<string, string> = {
  'ç': 'c', 'â': 'a', 'ê': 'e', 'î': 'i', 'ô': 'o', 'û': 'u', 'ë': 'e', 'ï': 'i', 'ÿ': 'y', 'œ': 'oe', 'Œ': 'OE', 'á': 'a', 'í': 'i', 'ó': 'o', 'ú': 'u',
  'À': 'A', 'Â': 'A', 'È': 'E', 'Ê': 'E', 'Ë': 'E', 'Î': 'I', 'Ï': 'I', 'Ô': 'O', 'Û': 'U', 'Ù': 'U',
  '«': '"', '»': '"', '“': '"', '”': '"', '„': '"', '’': "'", '‘': "'", '´': "'", '`': "'",
  '–': '-', '—': '-', '•': '-', '…': '...', ' ': ' ', ' ': ' ', '\t': ' ',
};

/** Le texte d'un SMS ramené à l'alphabet GSM quand c'est possible : 160 caractères par SMS au lieu de 70. */
export function versGsm(texte: string): string {
  return [...texte].map((c) => VERS_GSM[c] ?? c).join('');
}

/**
 * Au-delà de `maxSegments`, le texte est coupé au mot et la suite renvoyée au suivi : un SMS long
 * coûte un segment tous les 153 caractères.
 */
export function couperSms(texte: string, suite: string, maxSegments: number): string {
  if (segmentsSms(texte) <= maxSegments) return texte;
  const fin = ` ${suite}`;
  let n = texte.length;
  while (n > 0) {
    n = Math.max(0, n - 20);
    const coupe = texte.slice(0, n);
    const espace = coupe.lastIndexOf(' ');
    const debut = (espace > n * 0.7 ? coupe.slice(0, espace) : coupe).trimEnd();
    const candidat = `${debut}...${fin}`;
    if (segmentsSms(candidat) <= maxSegments) return candidat;
  }
  return suite;
}
