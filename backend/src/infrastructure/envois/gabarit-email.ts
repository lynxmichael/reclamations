/**
 * Version HTML des e-mails (étape 9), à côté du texte brut que la boîte d'envoi garde en base :
 * un bandeau aux couleurs et au nom de la banque, le texte, un pied de page.
 *
 * - Pas d'image : les messageries bloquent souvent les images distantes, et une image jointe
 *   alourdit chaque envoi. Le nom de la banque, sur sa couleur, suffit à la reconnaître.
 * - Chaque adresse est affichée telle qu'elle est ouverte (le texte du lien est le lien) :
 *   le client voit qu'il reste sur le portail de sa banque.
 * - Styles en ligne et mise en page par tableau : ce que les messageries affichent partout.
 */

export interface Marque {
  readonly nom: string;
  /** #RRGGBB ; vide = couleur par défaut */
  readonly couleur: string | null;
  /** Rappel de sécurité pour les e-mails aux clients */
  readonly client: boolean;
}

export const COULEUR_PAR_DEFAUT = '#2f4858';
const ENCRE = '#17212b';
const BLANC = '#ffffff';

function canaux(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
}

function luminance(hex: string): number {
  const [r, g, b] = canaux(hex).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contraste(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (l1 + 0.05) / (l2 + 0.05);
}

/** Couleur de la banque assombrie jusqu'à un contraste de 4,5:1 sur blanc (liens). */
function pourTexte(couleur: string): string {
  const base = canaux(couleur);
  for (let t = 0; t <= 1; t += 0.04) {
    const c = `#${base.map((v) => Math.round(v * (1 - t) * 255).toString(16).padStart(2, '0')).join('')}`;
    if (contraste(c, BLANC) >= 4.5) return c;
  }
  return ENCRE;
}

const echapper = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Paragraphe : texte échappé, adresses http(s) en liens, retours à la ligne conservés. */
function paragraphe(texte: string, couleurLien: string): string {
  const morceaux = texte.split(/(https?:\/\/[^\s<>"]+)/g);
  const html = morceaux.map((m, i) => (i % 2 === 1
    ? `<a href="${echapper(m)}" style="color:${couleurLien};text-decoration:underline;word-break:break-all">${echapper(m)}</a>`
    : echapper(m))).join('').replace(/\n/g, '<br>');
  return `<p style="margin:0 0 16px">${html}</p>`;
}

export function emailHtml(sujet: string, texte: string, marque: Marque): string {
  const fond = marque.couleur && /^#[0-9a-f]{6}$/i.test(marque.couleur) ? marque.couleur : COULEUR_PAR_DEFAUT;
  const surFond = contraste(fond, BLANC) >= contraste(fond, ENCRE) ? BLANC : ENCRE;
  const lien = pourTexte(fond);
  const corps = texte.trim().split(/\n{2,}/).map((p) => paragraphe(p, lien)).join('');
  const rappel = marque.client
    ? `${echapper(marque.nom)} ne vous demandera jamais votre mot de passe, votre code secret ni vos coordonnées bancaires par e-mail.<br>`
    : '';
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${echapper(sujet)}</title>
</head>
<body style="margin:0;padding:0;background:#f1f3f5">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f3f5">
<tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;color:${ENCRE}">
<tr><td style="background:${fond};color:${surFond};padding:18px 24px;font-size:18px;font-weight:bold">${echapper(marque.nom)}</td></tr>
<tr><td style="padding:24px 24px 8px;font-size:16px;line-height:1.55">${corps}</td></tr>
<tr><td style="padding:16px 24px 24px;border-top:1px solid #dde2e7;font-size:12px;line-height:1.5;color:#465261">${rappel}Message automatique : merci de ne pas y répondre.</td></tr>
</table>
</td></tr>
</table>
</body>
</html>
`;
}
