/**
 * Portail public du client final (§6.1) : formulaire d'un point de dépôt, dépôt, chronologie
 * par lien de suivi, code OTP. La banque est toujours déduite du code du point ou du jeton de
 * suivi (lecture ciblée en contexte système), puis tout se fait dans le contexte de cette banque.
 */
import { createHash, createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { CycleDeVie } from '../../application/reclamations/cycle-de-vie.js';
import { CONFIGURATION, urlPortail, type Configuration } from '../../configuration/configuration.js';
import { normaliserEmail, normaliserTelephone } from '../../domaine/contact.js';
import { journaliser } from '../../infrastructure/audit/journal.js';
import { BaseDonnees } from '../../infrastructure/base-de-donnees/base-de-donnees.service.js';
import { enSerie, type ClientTransaction } from '../../infrastructure/base-de-donnees/index.js';
import { traceDe, type Appel, type FichierRecu } from '../../infrastructure/contrat/appel.js';
import { introuvable, invalide, Probleme, type ErreurChamp } from '../../infrastructure/contrat/probleme.js';
import { MAX_FICHIERS, MAX_OCTETS, TYPES_PIECES } from '../../infrastructure/fichiers/fichiers.js';
import { AntiRobot, type Defi } from '../../infrastructure/securite/anti-robot.js';
import { Idempotence } from '../../infrastructure/securite/idempotence.js';
import { DUREE_CLIENT, Jetons } from '../../infrastructure/securite/jetons.js';
import { LIMITES, Limiteur } from '../../infrastructure/securite/limiteur.js';
import { ANTIVIRUS, type Antivirus } from '../../infrastructure/fichiers/antivirus.js';
import { STOCKAGE, type Stockage } from '../../infrastructure/stockage/stockage.js';
import { HORLOGE, type Horloge } from '../../noyau/noyau.module.js';
import { avecFichiers, banquePublique, CHAMPS_BANQUE_PUBLIQUE, stockerPiecesJointes, type S } from '../commun.js';
import { etapesSuivi } from '../reclamations/lecture.js';
import { etatAvis, normaliserReponse } from '../../domaine/satisfaction.js';

/** Version de la politique de données affichée au dépôt (conformité ARTCI) */
export const VERSION_POLITIQUE = '2026-09';
export const DUREE_OTP_SECONDES = 600;
export const ESSAIS_OTP = 5;

const CHAMPS_BANQUE = { id: true, suspendueLe: true, ...CHAMPS_BANQUE_PUBLIQUE } as const;

/** Point de dépôt par son code public : lecture ciblée, toutes banques (aussi pour l'assistant, étape 18). */
export async function pointPublic(bd: BaseDonnees, code: string) {
  const p = await bd.enSysteme((tx) => tx.pointDepot.findUnique({
    where: { code },
    select: { id: true, tenantId: true, canal: true, actif: true, agence: { select: { id: true, nom: true, active: true } }, banque: { select: CHAMPS_BANQUE } },
  }));
  // Étape 21 : seuls les QR codes et les liens web s'ouvrent au portail (WhatsApp, SMS, guichet et
  // téléphone sont des points de dépôt internes)
  if (!p || (p.canal !== 'QR_CODE' && p.canal !== 'LIEN_WEB')) throw introuvable('Ce QR code ou ce lien n\'existe pas');
  if (p.banque.suspendueLe) throw new Probleme(403, 'BANQUE_SUSPENDUE', 'Le portail de cette banque est momentanément fermé');
  if (!p.actif) throw new Probleme(404, 'POINT_DE_DEPOT_INACTIF', 'Ce QR code ou ce lien n\'est plus actif');
  return p;
}

@Injectable()
export class ServicePublic {
  constructor(
    @Inject(BaseDonnees) private readonly bd: BaseDonnees,
    @Inject(CycleDeVie) private readonly cycle: CycleDeVie,
    @Inject(Limiteur) private readonly limiteur: Limiteur,
    @Inject(Idempotence) private readonly idempotence: Idempotence,
    @Inject(AntiRobot) private readonly antiRobot: AntiRobot,
    @Inject(Jetons) private readonly jetons: Jetons,
    @Inject(STOCKAGE) private readonly stockage: Stockage,
    @Inject(ANTIVIRUS) private readonly antivirus: Antivirus,
    @Inject(CONFIGURATION) private readonly config: Configuration,
    @Inject(HORLOGE) private readonly horloge: Horloge,
  ) {}

  private point(code: string) {
    return pointPublic(this.bd, code);
  }

  async formulaire(code: string): Promise<S<'FormulaireDepot'>> {
    const p = await this.point(code);
    const [categories, agences, banque] = await this.bd.enBanque(p.tenantId, (tx) => enSerie([
      () => tx.categorie.findMany({ where: { active: true }, orderBy: [{ ordre: 'asc' }, { nom: 'asc' }], select: { id: true, nom: true, description: true } }),
      () => (p.agence ? Promise.resolve([]) : tx.agence.findMany({ where: { active: true }, orderBy: { nom: 'asc' }, select: { id: true, nom: true } })),
      () => tx.banque.findUniqueOrThrow({ where: { id: p.tenantId }, select: { assistantIa: true, chatWeb: true } }),
    ]));
    return {
      assistant: banque.assistantIa && banque.chatWeb,
      banque: banquePublique(p.banque),
      canal: p.canal,
      agence: p.agence ? { id: p.agence.id, nom: p.agence.nom } : null,
      agences,
      categories,
      politiqueDonnees: { version: VERSION_POLITIQUE, url: `${urlPortail(this.config, p.banque.slug)}/politique-donnees` },
      fichiers: { maxFichiers: MAX_FICHIERS, maxOctets: MAX_OCTETS, types: [...TYPES_PIECES] },
    };
  }

  /** Défi anti-robot (étape 11) : plus difficile si cette adresse IP en demande beaucoup. */
  async defiAntiRobot(appel: Appel): Promise<Defi> {
    return this.antiRobot.defi(appel.ip);
  }

  async deposer(code: string, corps: Record<string, unknown>, recus: readonly FichierRecu[], cleIdempotence: string | undefined, appel: Appel): Promise<S<'AccuseDepot'>> {
    const d = corps as {
      categorieId: string; agenceId?: string; description: string; nom: string; email?: string; telephone?: string; versionPolitique: string; jetonAntiRobot: string;
      viaAssistant?: boolean; categorieProposeeId?: string;
    };
    // Anti-robot (étape 11) : vérifié avant tout accès à la base, consommé seulement au dépôt réel
    // (un formulaire à corriger garde son jeton ; un renvoi avec la même clé ne le redemande pas)
    const defi = this.antiRobot.verifier(d.jetonAntiRobot);
    const p = await this.point(code);

    // Coordonnées : les erreurs rejoignent celles du formulaire, champ par champ
    const erreurs: ErreurChamp[] = [];
    let email: string | null = null;
    let telephone: string | null = null;
    try { email = normaliserEmail(d.email); } catch { erreurs.push({ champ: 'email', message: 'Adresse e-mail invalide, par exemple nom@exemple.ci' }); }
    try {
      telephone = normaliserTelephone(d.telephone);
    } catch {
      const chiffres = (d.telephone ?? '').replace(/\D/g, '').length;
      erreurs.push({ champ: 'telephone', message: `Ce numéro a ${chiffres} chiffres ; un numéro ivoirien en compte 10, par exemple 07 08 09 10 11` });
    }
    if (!d.description.trim()) erreurs.push({ champ: 'description', message: 'Décrivez votre réclamation' });
    if (!d.nom.trim()) erreurs.push({ champ: 'nom', message: 'Indiquez votre nom' });
    if (!email && !telephone && !erreurs.some((e) => e.champ === 'email' || e.champ === 'telephone')) {
      erreurs.push({ champ: 'telephone', message: 'Un téléphone ou un e-mail au moins, pour recevoir votre numéro de suivi' });
    }
    const agenceId = p.agence ? null : (d.agenceId ?? null);
    if (agenceId) {
      const agence = await this.bd.enBanque(p.tenantId, (tx) => tx.agence.findFirst({ where: { id: agenceId, active: true }, select: { id: true } }));
      if (!agence) erreurs.push({ champ: 'agenceId', message: 'Agence inconnue' });
    }
    if (erreurs.length) throw invalide(erreurs, `${erreurs.length} champ${erreurs.length > 1 ? 's' : ''} à corriger`);

    const maintenant = this.horloge();
    const empreinteRequete = createHash('sha256')
      .update(JSON.stringify([d.categorieId, agenceId, d.description, d.nom, email, telephone]))
      .update(recus.map((f) => createHash('sha256').update(f.contenu).digest('hex')).join(','))
      .digest('hex');

    const { resultat } = await this.idempotence.executer(`depot:${code}`, cleIdempotence, empreinteRequete, async () => {
      await this.antiRobot.consommer(defi);
      // Limites de débit (décision C9) : seuls comptent les dépôts réels, pas les formulaires à corriger ni les renvois
      await this.limiteur.consommer(LIMITES.depotParIp, appel.ip, 'Trop de réclamations envoyées depuis cette connexion : réessayez dans une heure');
      if (telephone) await this.limiteur.consommer(LIMITES.depotParTelephone, `${p.tenantId}:${telephone}`, 'Trop de réclamations pour ce numéro : réessayez dans une heure');
      const { fichiers, annuler } = await stockerPiecesJointes(this.stockage, this.antivirus, p.tenantId, recus, maintenant);
      const accuse = await avecFichiers(annuler, () => this.cycle.deposer({
        tenantId: p.tenantId,
        pointDepotId: p.id,
        categorieId: d.categorieId,
        description: d.description,
        agenceId,
        client: { nom: d.nom, email, telephone },
        consentementVersion: d.versionPolitique.slice(0, 20),
        fichiers,
        // Préparée avec l'assistant (étape 18) : noté seulement si la banque a l'assistant
        assistant: d.viaAssistant ? { categorieProposeeId: d.categorieProposeeId ?? null } : null,
      }, traceDe(appel)));
      return { numero: accuse.numero, lienSuivi: accuse.lienSuivi, jetonSuivi: accuse.jetonSuivi } satisfies S<'AccuseDepot'>;
    });
    return resultat;
  }

  // ---- Suivi ------------------------------------------------------------------

  private async ticketParJeton(jetonSuivi: string) {
    const t = await this.bd.enSysteme((tx) => tx.reclamation.findUnique({ where: { jetonSuivi }, select: { id: true, tenantId: true, clientId: true } }));
    if (!t) throw introuvable('Lien de suivi inconnu');
    return t;
  }

  async suivi(jetonSuivi: string): Promise<S<'SuiviPublic'>> {
    const ref = await this.ticketParJeton(jetonSuivi);
    return this.bd.enBanque(ref.tenantId, async (tx) => {
      const t = await tx.reclamation.findUniqueOrThrow({
        where: { id: ref.id },
        select: {
          numero: true, statut: true, creeLe: true, categorie: { select: { nom: true } }, banque: { select: CHAMPS_BANQUE },
          evenements: { orderBy: [{ creeLe: 'asc' }, { id: 'asc' }], select: { type: true, statutApres: true, visibleClient: true, creeLe: true } },
          enquete: { select: { reponduLe: true, expireLe: true } },
          rattacheeA: { select: { id: true, numero: true, jetonSuivi: true } },
        },
      });
      return {
        numero: t.numero,
        statut: t.statut,
        categorie: t.categorie.nom,
        creeLe: t.creeLe.toISOString(),
        banque: banquePublique(t.banque),
        etapes: etapesSuivi(t.evenements),
        avis: t.enquete ? { etat: etatAvis(t.enquete, this.horloge()), expireLe: t.enquete.expireLe.toISOString() } : null,
        // Étape 21 : un doublon joint à la réclamation principale, que le client suit désormais
        rattacheeA: t.rattacheeA ? { id: t.rattacheeA.id, numero: t.rattacheeA.numero, chemin: `/suivi/${t.rattacheeA.jetonSuivi}` } : null,
      };
    });
  }

  // ---- Enquête de satisfaction (étape 15) -----------------------------------------

  /** Enquête d'une réclamation clôturée, par son lien de suivi ; 404 s'il n'y en a pas. */
  async avis(jetonSuivi: string): Promise<S<'Avis'>> {
    const ref = await this.ticketParJeton(jetonSuivi);
    return this.bd.enBanque(ref.tenantId, (tx) => this.lireAvis(tx, ref.id));
  }

  private async lireAvis(tx: ClientTransaction, reclamationId: string): Promise<S<'Avis'>> {
    const t = await tx.reclamation.findUniqueOrThrow({
      where: { id: reclamationId },
      select: { numero: true, categorie: { select: { nom: true } }, banque: { select: CHAMPS_BANQUE }, enquete: true },
    });
    if (!t.enquete) throw introuvable('Pas d\'enquête de satisfaction pour cette réclamation');
    const e = t.enquete;
    return {
      numero: t.numero,
      categorie: t.categorie.nom,
      banque: banquePublique(t.banque),
      etat: etatAvis(e, this.horloge()),
      expireLe: e.expireLe.toISOString(),
      reponse: e.reponduLe
        ? { note: e.note!, recommandation: e.recommandation!, commentaire: e.commentaire, reponduLe: e.reponduLe.toISOString() }
        : null,
    };
  }

  /** Réponse du client : une seule, dans les 7 jours ; elle ne se modifie plus. */
  async donnerAvis(jetonSuivi: string, corps: { note: number; recommandation: number; commentaire?: string }, appel: Appel): Promise<S<'Avis'>> {
    const reponse = normaliserReponse(corps);
    if (typeof reponse === 'string') throw invalide([{ champ: 'note', message: reponse }]);
    const ref = await this.ticketParJeton(jetonSuivi);
    const maintenant = this.horloge();
    return this.bd.enBanque(ref.tenantId, async (tx) => {
      const e = await tx.enqueteSatisfaction.findFirst({ where: { reclamationId: ref.id } });
      if (!e) throw introuvable('Pas d\'enquête de satisfaction pour cette réclamation');
      if (e.reponduLe) throw new Probleme(409, 'AVIS_DEJA_DONNE', 'Vous avez déjà donné votre avis sur cette réclamation : merci');
      if (etatAvis(e, maintenant) === 'TERMINE') throw new Probleme(422, 'ENQUETE_TERMINEE', 'Cette enquête est terminée : elle restait ouverte 7 jours après la clôture');
      // Deux envois simultanés : un seul passe (la réponse ne se modifie plus, trigger en base)
      const { count } = await tx.enqueteSatisfaction.updateMany({
        where: { id: e.id, reponduLe: null },
        data: { reponduLe: maintenant, note: reponse.note, recommandation: reponse.recommandation, commentaire: reponse.commentaire },
      });
      if (count === 0) throw new Probleme(409, 'AVIS_DEJA_DONNE', 'Vous avez déjà donné votre avis sur cette réclamation : merci');
      // Journal : identifiants seulement, ni les notes ni le commentaire (arbitrage 7)
      await journaliser(tx, { tenantId: ref.tenantId, acteur: { clientId: ref.clientId }, action: 'client.avis_donne', entite: 'reclamation', entiteId: ref.id, trace: traceDe(appel) });
      return this.lireAvis(tx, ref.id);
    });
  }

  // ---- Code OTP (décision C7) ---------------------------------------------------

  private hmac(clientId: string, code: string): string {
    return createHmac('sha256', this.config.cleOtp).update(`${clientId}:${code}`).digest('hex');
  }

  async demanderCode(jetonSuivi: string, canalDemande: 'SMS' | 'EMAIL' | undefined, jetonAntiRobot: string, appel: Appel): Promise<S<'OtpEnvoye'>> {
    // Chaque SMS est facturé à la banque : un défi résolu par demande (étape 11)
    await this.antiRobot.exiger(jetonAntiRobot);
    const ref = await this.ticketParJeton(jetonSuivi);
    await this.limiteur.consommer(LIMITES.otpParReclamation, ref.id, 'Trois codes envoyés en une heure : réessayez plus tard');
    const maintenant = this.horloge();
    return this.bd.enBanque(ref.tenantId, async (tx) => {
      const client = await tx.clientFinal.findUniqueOrThrow({ where: { id: ref.clientId } });
      const banque = await tx.banque.findUniqueOrThrow({ where: { id: ref.tenantId }, select: { nom: true, suspendueLe: true } });
      if (banque.suspendueLe) throw introuvable('Lien de suivi inconnu');
      const canal = canalDemande ?? (client.telephone ? 'SMS' : 'EMAIL');
      const destination = canal === 'SMS' ? client.telephone : client.email;
      if (!destination) {
        throw new Probleme(422, 'CONTACT_REQUIS', canal === 'SMS' ? 'Aucun téléphone n\'est associé à cette réclamation' : 'Aucune adresse e-mail n\'est associée à cette réclamation');
      }
      const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
      // Un nouveau code annule les précédents
      await tx.codeOtp.updateMany({ where: { clientId: client.id, utiliseLe: null }, data: { utiliseLe: maintenant } });
      await tx.codeOtp.create({
        data: {
          tenantId: ref.tenantId, clientId: client.id, canal, destination, codeHash: this.hmac(client.id, code),
          expireLe: new Date(maintenant.getTime() + DUREE_OTP_SECONDES * 1000), creeLe: maintenant,
        },
      });
      await tx.notification.create({
        data: {
          tenantId: ref.tenantId, canal, modele: 'client.otp', destinataireClientId: client.id, destination, reclamationId: ref.id,
          sujet: canal === 'EMAIL' ? `${banque.nom} : votre code de consultation` : null,
          contenu: `${banque.nom} : votre code est ${code}. Il expire dans 10 minutes. Ne le communiquez à personne.`,
        },
      });
      await journaliser(tx, { tenantId: ref.tenantId, acteur: { clientId: client.id }, action: 'client.code_envoye', entite: 'reclamation', entiteId: ref.id, donnees: { canal }, trace: traceDe(appel) });
      return { canal, destinationMasquee: masquer(canal, destination), expireDans: DUREE_OTP_SECONDES };
    });
  }

  async verifierCode(jetonSuivi: string, code: string, appel: Appel): Promise<S<'SessionClient'>> {
    const ref = await this.ticketParJeton(jetonSuivi);
    const maintenant = this.horloge();
    // L'essai compte même si la vérification échoue : on valide la transaction avant de refuser
    const verdict = await this.bd.enBanque(ref.tenantId, async (tx) => {
      const otp = await tx.codeOtp.findFirst({ where: { clientId: ref.clientId, utiliseLe: null }, orderBy: { creeLe: 'desc' } });
      if (!otp) return { refus: new Probleme(422, 'CODE_OTP_INVALIDE', 'Demandez d\'abord un code') };
      if (otp.expireLe <= maintenant) return { refus: new Probleme(422, 'CODE_OTP_EXPIRE', 'Ce code a expiré : demandez-en un nouveau') };
      if (otp.tentatives >= ESSAIS_OTP) return { refus: new Probleme(429, 'TROP_DE_TENTATIVES', 'Trop d\'essais : demandez un nouveau code') };
      const attendu = Buffer.from(otp.codeHash, 'hex');
      const recu = Buffer.from(this.hmac(ref.clientId, code), 'hex');
      if (attendu.length !== recu.length || !timingSafeEqual(attendu, recu)) {
        await tx.codeOtp.update({ where: { id: otp.id }, data: { tentatives: otp.tentatives + 1 } });
        const restants = ESSAIS_OTP - otp.tentatives - 1;
        return { refus: new Probleme(422, 'CODE_OTP_INVALIDE', restants > 0 ? `Code incorrect : ${restants} essai(s) restant(s)` : 'Code incorrect : demandez un nouveau code') };
      }
      await tx.codeOtp.update({ where: { id: otp.id }, data: { utiliseLe: maintenant, tentatives: otp.tentatives + 1 } });
      await journaliser(tx, { tenantId: ref.tenantId, acteur: { clientId: ref.clientId }, action: 'client.session_ouverte', entite: 'reclamation', entiteId: ref.id, trace: traceDe(appel) });
      return { refus: null };
    });
    if (verdict.refus) throw verdict.refus;
    return { jetonClient: await this.jetons.signerClient({ clientId: ref.clientId, tenantId: ref.tenantId }), expireDans: DUREE_CLIENT };
  }

  // ---- Retrouver ses réclamations (étape 21) ---------------------------------------

  /** Banque du portail par son adresse : 404 inconnue, 403 suspendue. */
  private async banqueParSlug(slug: string) {
    const b = await this.bd.enSysteme((tx) => tx.banque.findUnique({ where: { slug }, select: CHAMPS_BANQUE }));
    if (!b) throw introuvable('Ce portail n\'existe pas');
    if (b.suspendueLe) throw new Probleme(403, 'BANQUE_SUSPENDUE', 'Le portail de cette banque est momentanément fermé');
    return b;
  }

  async banquePortail(slug: string): Promise<S<'BanquePublique'>> {
    return banquePublique(await this.banqueParSlug(slug));
  }

  /** Téléphone (E.164) ou e-mail, et le canal du code ; 400 si ni l'un ni l'autre n'est lisible. */
  private contact(brut: string): { canal: 'SMS' | 'EMAIL'; valeur: string } {
    const texte = brut.trim();
    try {
      if (texte.includes('@')) return { canal: 'EMAIL', valeur: normaliserEmail(texte)! };
      const telephone = normaliserTelephone(texte);
      if (telephone) return { canal: 'SMS', valeur: telephone };
    } catch {
      // le message ci-dessous
    }
    throw invalide([{ champ: 'contact', message: 'Indiquez le téléphone ou l\'e-mail donné au dépôt, par exemple 07 08 09 10 11' }]);
  }

  /**
   * Le client a perdu son lien de suivi. S'il a des réclamations dans cette banque à ce numéro ou à
   * cette adresse, un code part ; la réponse est la même dans tous les cas (rien ne dit si le numéro
   * est connu). Chaque SMS est facturé à la banque : défi anti-robot et 3 codes par heure.
   */
  async demanderCodeAcces(slug: string, corps: { contact: string; jetonAntiRobot: string }, appel: Appel): Promise<S<'OtpEnvoye'>> {
    await this.antiRobot.exiger(corps.jetonAntiRobot);
    const b = await this.banqueParSlug(slug);
    const c = this.contact(corps.contact);
    await this.limiteur.consommer(LIMITES.accesParContact, `${b.id}:${c.valeur}`, 'Trois codes demandés en une heure pour ce numéro : réessayez plus tard');
    const maintenant = this.horloge();
    await this.bd.enBanque(b.id, async (tx) => {
      const client = await tx.clientFinal.findFirst({
        where: c.canal === 'SMS' ? { telephone: c.valeur } : { email: c.valeur },
        select: { id: true, _count: { select: { reclamations: true } } },
      });
      if (!client || client._count.reclamations === 0) return;
      const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
      await tx.codeOtp.updateMany({ where: { clientId: client.id, utiliseLe: null }, data: { utiliseLe: maintenant } });
      await tx.codeOtp.create({
        data: {
          tenantId: b.id, clientId: client.id, canal: c.canal, destination: c.valeur, codeHash: this.hmac(client.id, code),
          expireLe: new Date(maintenant.getTime() + DUREE_OTP_SECONDES * 1000), creeLe: maintenant,
        },
      });
      await tx.notification.create({
        data: {
          tenantId: b.id, canal: c.canal, modele: 'client.otp', destinataireClientId: client.id, destination: c.valeur,
          sujet: c.canal === 'EMAIL' ? `${b.nom} : votre code pour retrouver vos réclamations` : null,
          contenu: `${b.nom} : votre code est ${code}. Il expire dans 10 minutes. Ne le communiquez à personne.`,
        },
      });
      await journaliser(tx, { tenantId: b.id, acteur: { clientId: client.id }, action: 'client.code_acces_envoye', entite: 'client_final', entiteId: client.id, donnees: { canal: c.canal }, trace: traceDe(appel) });
    });
    return { canal: c.canal, destinationMasquee: masquer(c.canal, c.valeur), expireDans: DUREE_OTP_SECONDES };
  }

  /** Bon code : la session de l'espace client. Un numéro inconnu se comporte comme un code faux. */
  async verifierCodeAcces(slug: string, corps: { contact: string; code: string }, appel: Appel): Promise<S<'SessionClient'>> {
    const b = await this.banqueParSlug(slug);
    const c = this.contact(corps.contact);
    await this.limiteur.consommer(LIMITES.essaisAccesParContact, `${b.id}:${c.valeur}`, 'Trop d\'essais pour ce numéro : demandez un nouveau code dans quelques minutes');
    const maintenant = this.horloge();
    const verdict = await this.bd.enBanque(b.id, async (tx) => {
      const client = await tx.clientFinal.findFirst({ where: c.canal === 'SMS' ? { telephone: c.valeur } : { email: c.valeur }, select: { id: true } });
      const otp = client ? await tx.codeOtp.findFirst({ where: { clientId: client.id, utiliseLe: null }, orderBy: { creeLe: 'desc' } }) : null;
      if (!client || !otp) return { refus: new Probleme(422, 'CODE_OTP_INVALIDE', 'Code incorrect : vérifiez-le, ou demandez un nouveau code') };
      if (otp.expireLe <= maintenant) return { refus: new Probleme(422, 'CODE_OTP_EXPIRE', 'Ce code a expiré : demandez-en un nouveau') };
      if (otp.tentatives >= ESSAIS_OTP) return { refus: new Probleme(429, 'TROP_DE_TENTATIVES', 'Trop d\'essais : demandez un nouveau code') };
      const attendu = Buffer.from(otp.codeHash, 'hex');
      const recu = Buffer.from(this.hmac(client.id, corps.code), 'hex');
      if (attendu.length !== recu.length || !timingSafeEqual(attendu, recu)) {
        await tx.codeOtp.update({ where: { id: otp.id }, data: { tentatives: otp.tentatives + 1 } });
        return { refus: new Probleme(422, 'CODE_OTP_INVALIDE', 'Code incorrect : vérifiez-le, ou demandez un nouveau code') };
      }
      await tx.codeOtp.update({ where: { id: otp.id }, data: { utiliseLe: maintenant, tentatives: otp.tentatives + 1 } });
      await journaliser(tx, { tenantId: b.id, acteur: { clientId: client.id }, action: 'client.session_ouverte', entite: 'client_final', entiteId: client.id, donnees: { par: 'contact' }, trace: traceDe(appel) });
      return { refus: null, clientId: client.id };
    });
    if (verdict.refus) throw verdict.refus;
    return { jetonClient: await this.jetons.signerClient({ clientId: verdict.clientId!, tenantId: b.id }), expireDans: DUREE_CLIENT };
  }

  // ---- Logo ---------------------------------------------------------------------

  async logo(fichier: string): Promise<{ contenu: Buffer; type: string }> {
    const cle = `logos/${fichier}`;
    const banque = await this.bd.enSysteme((tx) => tx.banque.findFirst({ where: { logoCle: cle }, select: { id: true } }));
    const contenu = banque ? await this.stockage.lire(cle) : null;
    if (!contenu) throw introuvable('Logo introuvable');
    const type = fichier.endsWith('.svg') ? 'image/svg+xml' : fichier.endsWith('.webp') ? 'image/webp' : 'image/png';
    return { contenu, type };
  }
}

/** +225 07 •• •• •• 11 ; y••••@exemple.ci */
export function masquer(canal: 'SMS' | 'EMAIL', destination: string): string {
  if (canal === 'SMS') {
    const m = /^\+225(\d{2})\d{6}(\d{2})$/.exec(destination);
    return m ? `+225 ${m[1]} •• •• •• ${m[2]}` : `${destination.slice(0, 4)} •• •• ${destination.slice(-2)}`;
  }
  const [local, domaine] = destination.split('@');
  return `${local.slice(0, 1)}••••@${domaine}`;
}
