/**
 * Calcul de l'anti-robot (étape 11) : SHA-256 en JavaScript pur, sans allocation dans la boucle.
 *
 * WebCrypto (crypto.subtle.digest) est asynchrone : pour des milliers de très petits messages, un
 * SHA-256 synchrone est dix à cinquante fois plus rapide. Le défi est comparé mot à mot, sans passer
 * par l'hexadécimal. Ce fichier sert au Web Worker comme au fil principal (repli).
 */

const K = Int32Array.from([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const H = Int32Array.from([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
const W = new Int32Array(64);

/** Taille à prévoir pour un message de `n` octets, remplissage compris. */
const taillePourMessage = (n: number) => (((n + 9 + 63) >> 6) << 6);

/**
 * SHA-256 des `longueur` premiers octets de `m` (qui doit avoir la place du remplissage, écrit sur
 * place) ; les 8 mots du résultat vont dans `sortie`.
 */
function condenser(m: Uint8Array, longueur: number, sortie: Int32Array): void {
  const total = taillePourMessage(longueur);
  m[longueur] = 0x80;
  m.fill(0, longueur + 1, total - 4);
  const bits = longueur * 8;
  m[total - 4] = bits >>> 24;
  m[total - 3] = (bits >>> 16) & 255;
  m[total - 2] = (bits >>> 8) & 255;
  m[total - 1] = bits & 255;
  let h0 = H[0]!, h1 = H[1]!, h2 = H[2]!, h3 = H[3]!, h4 = H[4]!, h5 = H[5]!, h6 = H[6]!, h7 = H[7]!;
  for (let o = 0; o < total; o += 64) {
    for (let i = 0; i < 16; i++) {
      const p = o + i * 4;
      W[i] = (m[p]! << 24) | (m[p + 1]! << 16) | (m[p + 2]! << 8) | m[p + 3]!;
    }
    for (let i = 16; i < 64; i++) {
      const x = W[i - 15]!;
      const y = W[i - 2]!;
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      W[i] = (W[i - 16]! + s0 + W[i - 7]! + s1) | 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const t1 = (h + S1 + ((e & f) ^ (~e & g)) + K[i]! + W[i]!) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
  }
  sortie[0] = h0; sortie[1] = h1; sortie[2] = h2; sortie[3] = h3;
  sortie[4] = h4; sortie[5] = h5; sortie[6] = h6; sortie[7] = h7;
}

const hex = (mots: Int32Array) => Array.from(mots, (x) => (x >>> 0).toString(16).padStart(8, '0')).join('');

/** SHA-256 d'un texte (UTF-8), en hexadécimal : tests et vérifications. */
export function sha256Hex(texte: string): string {
  const octets = new TextEncoder().encode(texte);
  const m = new Uint8Array(taillePourMessage(octets.length));
  m.set(octets);
  const sortie = new Int32Array(8);
  condenser(m, octets.length, sortie);
  return hex(sortie);
}

/**
 * Cherche le nombre n, de `debut` à `fin` inclus, tel que SHA-256(sel + n) = defi. Rend null s'il
 * n'est pas dans l'intervalle (le fil principal cherche par tranches).
 */
export function chercher(sel: string, defi: string, debut: number, fin: number): number | null {
  const prefixe = new TextEncoder().encode(sel);
  const m = new Uint8Array(taillePourMessage(prefixe.length + 16));
  m.set(prefixe);
  const cible = new Int32Array(8);
  for (let i = 0; i < 8; i++) cible[i] = parseInt(defi.slice(i * 8, i * 8 + 8), 16) | 0;
  const sortie = new Int32Array(8);
  const chiffres = new Uint8Array(16);
  for (let n = debut; n <= fin; n++) {
    // Écriture décimale de n après le sel
    let k = 0;
    let x = n;
    do {
      chiffres[k++] = 48 + (x % 10);
      x = Math.floor(x / 10);
    } while (x > 0);
    let longueur = prefixe.length;
    while (k > 0) m[longueur++] = chiffres[--k]!;
    condenser(m, longueur, sortie);
    if (sortie[0] === cible[0] && sortie[1] === cible[1] && sortie[2] === cible[2] && sortie[3] === cible[3]
      && sortie[4] === cible[4] && sortie[5] === cible[5] && sortie[6] === cible[6] && sortie[7] === cible[7]) return n;
  }
  return null;
}
