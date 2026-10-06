/**
 * Envois au client (étape 22) : règles pures, partagées par l'API, le worker, les écrans et la démo.
 *
 * Un message au client (e-mail, SMS, WhatsApp) passe par ces états :
 *
 *   EN_ATTENTE ──envoi──▶ ENVOYE ──accusé de remise──▶ REMIS ──lu (WhatsApp)──▶ LU
 *        │                   └──accusé d'échec──▶ NON_REMIS
 *        └─échec temporaire─▶ NOUVEL_ESSAI (1, 5, 30 puis 120 minutes après) ─▶ … ─▶ NON_REMIS (5e échec)
 *
 * Une erreur définitive (numéro invalide, adresse refusée, WhatsApp fermé) ne se réessaie pas.
 * L'e-mail n'a pas d'accusé de remise : « Envoyé » veut dire accepté par le serveur d'envoi.
 */

/** Minutes avant la tentative suivante, après la 1re, 2e, 3e et 4e tentative échouée. */
export const ESPACEMENT_MINUTES = [1, 5, 30, 120] as const;
export const TENTATIVES_MAX = ESPACEMENT_MINUTES.length + 1;

/** Heure de la prochaine tentative après `tentatives` échecs ; null : plus de tentative. */
export function prochaineTentative(tentatives: number, maintenant: Date): Date | null {
  if (tentatives < 1 || tentatives >= TENTATIVES_MAX) return null;
  return new Date(maintenant.getTime() + ESPACEMENT_MINUTES[tentatives - 1]! * 60_000);
}

export type StatutNotificationBrut = 'EN_ATTENTE' | 'ENVOYEE' | 'DELIVREE' | 'ECHEC';
export type EtatEnvoi = 'EN_ATTENTE' | 'NOUVEL_ESSAI' | 'ENVOYE' | 'REMIS' | 'LU' | 'NON_REMIS';

/** L'état montré au personnel, d'après la ligne de la boîte d'envoi. */
export function etatEnvoi(n: { readonly statut: StatutNotificationBrut; readonly tentatives: number; readonly lueLe?: Date | string | null }): EtatEnvoi {
  switch (n.statut) {
    case 'EN_ATTENTE': return n.tentatives > 0 ? 'NOUVEL_ESSAI' : 'EN_ATTENTE';
    case 'ENVOYEE': return 'ENVOYE';
    case 'DELIVREE': return n.lueLe ? 'LU' : 'REMIS';
    case 'ECHEC': return 'NON_REMIS';
  }
}

export const MOTIFS_ECHEC = [
  'NUMERO_INVALIDE', 'INJOIGNABLE', 'EXPIRE', 'REFUSE', 'ADRESSE_INVALIDE', 'WHATSAPP_INDISPONIBLE', 'ERREUR_TECHNIQUE',
] as const;
export type MotifEchec = (typeof MOTIFS_ECHEC)[number];

/** Pourquoi le message n'a pas été remis, en mots du personnel (jamais le message technique). */
export const LIBELLES_MOTIF: Record<MotifEchec, string> = {
  NUMERO_INVALIDE: 'numéro invalide',
  INJOIGNABLE: 'téléphone injoignable',
  EXPIRE: 'téléphone resté éteint ou hors réseau',
  REFUSE: 'refusé par l\'opérateur',
  ADRESSE_INVALIDE: 'adresse e-mail refusée',
  WHATSAPP_INDISPONIBLE: 'WhatsApp n\'a pas pu le remettre',
  ERREUR_TECHNIQUE: 'envoi impossible après 5 essais',
};

/** Accusé de remise de la passerelle SMS : son statut, et ce qu'il devient ici. */
export const STATUTS_REMISE = ['REMIS', 'NON_REMIS', 'EXPIRE', 'REJETE', 'EN_COURS'] as const;
export type StatutRemise = (typeof STATUTS_REMISE)[number];
export const MOTIF_DE_REMISE: Record<Exclude<StatutRemise, 'REMIS' | 'EN_COURS'>, MotifEchec> = {
  NON_REMIS: 'INJOIGNABLE',
  EXPIRE: 'EXPIRE',
  REJETE: 'REFUSE',
};

/** Ce que dit chaque message au client (son modèle), sans son texte. */
export const OBJETS_ENVOI: Record<string, string> = {
  'client.depot': 'Accusé de dépôt',
  'client.statut': 'Changement de statut',
  'client.reponse': 'Nouvelle réponse',
  'client.question': 'Question de la banque',
  'client.resolution': 'Résolution',
  'client.cloture': 'Clôture',
  'client.lien_suivi': 'Lien de suivi',
  'client.rattachement': 'Réclamation jointe',
  'client.otp': 'Code de connexion',
  'conversation.reponse': 'Réponse dans la conversation',
  'canal.reponse_auto': 'Réponse automatique',
};
export const objetEnvoi = (modele: string): string => OBJETS_ENVOI[modele] ?? 'Message';

/**
 * Messages que le personnel peut renvoyer tels quels : leur texte est gardé (numéro et lien de suivi).
 * Un code ou un message de conversation est effacé après envoi ; le client en redemande un.
 */
export const MODELES_RENVOYABLES: readonly string[] = [
  'client.depot', 'client.statut', 'client.reponse', 'client.question', 'client.resolution', 'client.cloture', 'client.lien_suivi', 'client.rattachement',
];
/** Un message de ces modèles non remis prévient l'agent (ou le superviseur) */
export const MODELES_A_SIGNALER: readonly string[] = [...MODELES_RENVOYABLES, 'conversation.reponse'];

export const renvoyable = (modele: string) => MODELES_RENVOYABLES.includes(modele);
export const aSignaler = (modele: string) => MODELES_A_SIGNALER.includes(modele);

/** Coordonnée masquée, comme à l'écran du code : +225 07 •• •• •• 11, y••••@exemple.ci */
export function masquerDestination(canal: 'SMS' | 'EMAIL' | 'WHATSAPP', destination: string): string {
  if (canal !== 'EMAIL') {
    const m = /^\+225(\d{2})\d{6}(\d{2})$/.exec(destination);
    return m ? `+225 ${m[1]} •• •• •• ${m[2]}` : `${destination.slice(0, 4)} •• •• ${destination.slice(-2)}`;
  }
  const [local = '', domaine = ''] = destination.split('@');
  return `${local.slice(0, 1)}••••@${domaine}`;
}

export interface EnvoiCompare {
  readonly modele: string;
  readonly statut: StatutNotificationBrut;
  readonly creeLe: Date;
}

/**
 * Un message au client reste non remis tant qu'aucun message du même modèle ne lui est parvenu
 * depuis, ou n'est en route (par l'autre coordonnée au même moment, ou renvoyé ensuite). Les codes ne
 * comptent pas.
 */
export function nonRemisEnSuspens<T extends EnvoiCompare>(envois: readonly T[]): T[] {
  const MARGE = 60_000;
  return envois.filter((e) => e.statut === 'ECHEC' && aSignaler(e.modele)
    && !envois.some((x) => x !== e && x.modele === e.modele && x.statut !== 'ECHEC'
      && x.creeLe.getTime() >= e.creeLe.getTime() - MARGE));
}
