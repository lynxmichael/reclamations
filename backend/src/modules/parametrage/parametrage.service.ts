/**
 * Paramétrage d'une banque par son Admin Entreprise (§6.7, décision C12) : apparence, catégories
 * et délais, agences, points de dépôt et QR codes, horaires, jours fériés. Chaque modification
 * est inscrite au journal d'audit de la banque.
 */
import { randomBytes, randomInt } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { DateTime } from 'luxon';
import { toBuffer, toString as qrEnSvg } from 'qrcode';
import { CONFIGURATION, type Configuration } from '../../configuration/configuration.js';
import { journaliser } from '../../infrastructure/audit/journal.js';
import { BaseDonnees, type ClientTransaction } from '../../infrastructure/base-de-donnees/base-de-donnees.service.js';
import { basculer, contexte, enSerie } from '../../infrastructure/base-de-donnees/index.js';
import { personnelBanque, traceDe, type Appel, type FichierRecu, type Personnel } from '../../infrastructure/contrat/appel.js';
import { introuvable, invalideChamp, Probleme } from '../../infrastructure/contrat/probleme.js';
import { svgSain, TYPES_LOGO, verifierFichiers } from '../../infrastructure/fichiers/fichiers.js';
import { STOCKAGE, type Stockage } from '../../infrastructure/stockage/stockage.js';
import { HORLOGE, type Horloge } from '../../noyau/noyau.module.js';
import { adresseDepot, urlLogo, type S } from '../commun.js';

/** Unicité violée (P2002) → le Probleme donné. */
export async function unique<T>(travail: () => Promise<T>, probleme: () => Probleme): Promise<T> {
  try {
    return await travail();
  } catch (e) {
    if ((e as { code?: string }).code === 'P2002') throw probleme();
    throw e;
  }
}

/** Code public d'un point de dépôt : 10 caractères sans ambiguïté de lecture (ni 0/O, ni 1/I). */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const nouveauCodePoint = () => Array.from({ length: 10 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');

const hhmm = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

type Categorie = S<'Categorie'>;

@Injectable()
export class ServiceParametrage {
  constructor(
    @Inject(BaseDonnees) private readonly bd: BaseDonnees,
    @Inject(STOCKAGE) private readonly stockage: Stockage,
    @Inject(CONFIGURATION) private readonly config: Configuration,
    @Inject(HORLOGE) private readonly horloge: Horloge,
  ) {}

  private dans<T>(appel: Appel, travail: (tx: ClientTransaction, moi: Personnel & { tenantId: string }) => Promise<T>): Promise<T> {
    const moi = personnelBanque(appel);
    return this.bd.enBanque(moi.tenantId, (tx) => travail(tx, moi));
  }

  private audit(tx: ClientTransaction, moi: Personnel & { tenantId: string }, appel: Appel, action: string, entite: string, entiteId: string | null, donnees?: Record<string, unknown>) {
    return journaliser(tx, { tenantId: moi.tenantId, acteur: moi, action, entite, entiteId, donnees, trace: traceDe(appel) });
  }

  // ---- Paramètres et apparence ---------------------------------------------------

  private async parametres(tx: ClientTransaction, tenantId: string): Promise<S<'ParametresBanque'>> {
    const b = await tx.banque.findUniqueOrThrow({ where: { id: tenantId }, include: { plan: true, canaux: { select: { canal: true, numero: true } } } });
    const numero = (canal: 'WHATSAPP' | 'SMS', ouvert: boolean) => (ouvert && b.chatWeb ? (b.canaux.find((c) => c.canal === canal)?.numero ?? null) : null);
    const debutMois = DateTime.fromJSDate(this.horloge(), { zone: b.fuseauHoraire }).startOf('month').toJSDate();
    const [agents, ticketsCeMois] = await enSerie([
      () => tx.utilisateur.count({ where: { role: { in: ['AGENT', 'SUPERVISEUR'] }, statut: { not: 'DESACTIVE' } } }),
      () => tx.reclamation.count({ where: { creeLe: { gte: debutMois } } }),
    ]);
    return {
      nom: b.nom,
      slug: b.slug,
      prefixeTickets: b.prefixeTickets,
      fuseauHoraire: b.fuseauHoraire,
      seuilAlerteSlaPourcent: b.seuilAlerteSlaPourcent,
      delaiClotureAutoJours: b.delaiClotureAutoJours,
      smsChaqueChangementStatut: b.smsChaqueChangementStatut,
      enqueteSatisfaction: b.enqueteSatisfaction,
      attributionAutomatique: b.attributionAutomatique,
      modeAttribution: b.modeAttribution,
      chatWeb: b.chatWeb,
      assistantIa: b.assistantIa && b.chatWeb,
      barometre: b.barometre,
      whatsapp: numero('WHATSAPP', b.whatsapp),
      smsEntrant: numero('SMS', b.smsEntrant),
      doubleAuthentificationObligatoire: b.doubleAuthentificationObligatoire,
      couleurPrimaire: b.couleurPrimaire,
      couleurSecondaire: b.couleurSecondaire,
      logoUrl: urlLogo(b.logoCle),
      emailContact: b.emailContact,
      plan: { nom: b.plan.nom, plafondAgents: b.plan.plafondAgents, plafondTicketsMois: b.plan.plafondTicketsMois },
      consommation: { agents, ticketsCeMois },
    };
  }

  lireParametres(appel: Appel) {
    return this.dans(appel, (tx, moi) => this.parametres(tx, moi.tenantId));
  }

  modifierApparence(appel: Appel, m: { couleurPrimaire?: string | null; couleurSecondaire?: string | null; emailContact?: string | null }) {
    return this.dans(appel, async (tx, moi) => {
      const data = {
        ...(m.couleurPrimaire !== undefined ? { couleurPrimaire: m.couleurPrimaire?.toUpperCase() ?? null } : {}),
        ...(m.couleurSecondaire !== undefined ? { couleurSecondaire: m.couleurSecondaire?.toUpperCase() ?? null } : {}),
        ...(m.emailContact !== undefined ? { emailContact: m.emailContact?.trim().toLowerCase() || null } : {}),
      };
      await tx.banque.update({ where: { id: moi.tenantId }, data });
      await this.audit(tx, moi, appel, 'parametrage.apparence', 'banque', moi.tenantId, { champs: Object.keys(data) });
      return this.parametres(tx, moi.tenantId);
    });
  }

  /**
   * Étape 19 : double authentification obligatoire ou facultative pour le personnel. Pour l'exiger,
   * l'Admin Entreprise l'a activée lui-même ; les sessions ouvertes sans code sont alors fermées, et
   * chacun l'active à sa prochaine connexion.
   */
  modifierSecurite(appel: Appel, m: { doubleAuthentificationObligatoire: boolean }) {
    return this.dans(appel, async (tx, moi) => {
      const obligatoire = m.doubleAuthentificationObligatoire;
      const avant = await tx.banque.findUniqueOrThrow({ where: { id: moi.tenantId }, select: { doubleAuthentificationObligatoire: true } });
      if (obligatoire) {
        const lui = await tx.utilisateur.findUniqueOrThrow({ where: { id: moi.id }, select: { totpActiveLe: true } });
        if (!lui.totpActiveLe) {
          throw new Probleme(422, 'DOUBLE_AUTHENTIFICATION_A_ACTIVER', 'Activez d\'abord la double authentification sur votre compte (Mon compte), puis rendez-la obligatoire');
        }
      }
      if (avant.doubleAuthentificationObligatoire === obligatoire) return this.parametres(tx, moi.tenantId);
      await tx.banque.update({ where: { id: moi.tenantId }, data: { doubleAuthentificationObligatoire: obligatoire } });
      let sessionsFermees = 0;
      if (obligatoire) {
        // Les sessions ne sont lisibles qu'en contexte système (étape 3)
        await basculer(tx, contexte.systeme());
        sessionsFermees = (await tx.sessionUtilisateur.updateMany({
          where: { revoqueLe: null, utilisateur: { tenantId: moi.tenantId, totpActiveLe: null } }, data: { revoqueLe: this.horloge() },
        })).count;
        await basculer(tx, contexte.banque(moi.tenantId));
      }
      await this.audit(tx, moi, appel, 'parametrage.double_authentification', 'banque', moi.tenantId, { obligatoire, sessionsFermees });
      return this.parametres(tx, moi.tenantId);
    });
  }

  async televerserLogo(appel: Appel, fichiers: readonly FichierRecu[]) {
    const moi = personnelBanque(appel);
    const [logo] = verifierFichiers(fichiers.filter((f) => f.champ === 'logo').slice(0, 1), TYPES_LOGO);
    if (!logo) throw invalideChamp('logo', 'Fichier obligatoire');
    if (logo.typeMime === 'image/svg+xml' && !svgSain(logo.contenu)) {
      throw new Probleme(415, 'TYPE_DE_FICHIER_NON_SUPPORTE', 'Ce SVG contient du script ou des liens externes : exportez-le en PNG');
    }
    const extension = { 'image/png': 'png', 'image/svg+xml': 'svg', 'image/webp': 'webp' }[logo.typeMime as 'image/png'];
    const cle = `logos/${randomBytes(18).toString('base64url')}.${extension}`;
    await this.stockage.ecrire(cle, logo.contenu);
    let ancien: string | null = null;
    try {
      const res = await this.dans(appel, async (tx) => {
        ancien = (await tx.banque.findUniqueOrThrow({ where: { id: moi.tenantId }, select: { logoCle: true } })).logoCle;
        await tx.banque.update({ where: { id: moi.tenantId }, data: { logoCle: cle } });
        await this.audit(tx, moi, appel, 'parametrage.logo', 'banque', moi.tenantId, { type: logo.typeMime, octets: logo.taille });
        return this.parametres(tx, moi.tenantId);
      });
      if (ancien) await this.stockage.supprimer(ancien).catch(() => undefined);
      return res;
    } catch (e) {
      await this.stockage.supprimer(cle).catch(() => undefined);
      throw e;
    }
  }

  // ---- Catégories -------------------------------------------------------------------

  private categorie = (c: { id: string; nom: string; description: string | null; prioriteParDefaut: 'NORMALE' | 'URGENTE'; delaiCibleMinutes: number; ordre: number; active: boolean }): Categorie =>
    ({ id: c.id, nom: c.nom, description: c.description, prioriteParDefaut: c.prioriteParDefaut, delaiCibleMinutes: c.delaiCibleMinutes, ordre: c.ordre, active: c.active });

  listerCategories(appel: Appel) {
    return this.dans(appel, async (tx) => (await tx.categorie.findMany({ orderBy: [{ ordre: 'asc' }, { nom: 'asc' }] })).map(this.categorie));
  }

  creerCategorie(appel: Appel, c: { nom: string; description?: string | null; prioriteParDefaut?: 'NORMALE' | 'URGENTE'; delaiCibleMinutes: number; ordre?: number }) {
    return this.dans(appel, async (tx, moi) => {
      const cree = await unique(() => tx.categorie.create({
        data: {
          tenantId: moi.tenantId, nom: c.nom.trim(), description: c.description?.trim() || null,
          prioriteParDefaut: c.prioriteParDefaut ?? 'NORMALE', delaiCibleMinutes: c.delaiCibleMinutes, ordre: c.ordre ?? 0,
        },
      }), () => new Probleme(409, 'NOM_DEJA_UTILISE', `La catégorie « ${c.nom} » existe déjà`));
      await this.audit(tx, moi, appel, 'parametrage.categorie_creee', 'categorie', cree.id, { delaiCibleMinutes: cree.delaiCibleMinutes, priorite: cree.prioriteParDefaut });
      return this.categorie(cree);
    });
  }

  modifierCategorie(appel: Appel, id: string, m: Partial<{ nom: string; description: string | null; prioriteParDefaut: 'NORMALE' | 'URGENTE'; delaiCibleMinutes: number; ordre: number; active: boolean }>) {
    return this.dans(appel, async (tx, moi) => {
      const avant = await tx.categorie.findUnique({ where: { id } });
      if (!avant) throw introuvable('Catégorie introuvable');
      const modifiee = await unique(() => tx.categorie.update({
        where: { id },
        data: { ...m, ...(m.nom !== undefined ? { nom: m.nom.trim() } : {}), ...(m.description !== undefined ? { description: m.description?.trim() || null } : {}) },
      }), () => new Probleme(409, 'NOM_DEJA_UTILISE', `La catégorie « ${m.nom} » existe déjà`));
      await this.audit(tx, moi, appel, 'parametrage.categorie_modifiee', 'categorie', id, {
        champs: Object.keys(m), ...(m.delaiCibleMinutes !== undefined ? { delaiAvant: avant.delaiCibleMinutes, delaiApres: m.delaiCibleMinutes } : {}),
      });
      return this.categorie(modifiee);
    });
  }

  // ---- Agences ------------------------------------------------------------------------

  private agence = (a: { id: string; code: string; nom: string; ville: string | null; adresse: string | null; active: boolean }): S<'Agence'> =>
    ({ id: a.id, code: a.code, nom: a.nom, ville: a.ville, adresse: a.adresse, active: a.active });

  listerAgences(appel: Appel) {
    return this.dans(appel, async (tx) => (await tx.agence.findMany({ orderBy: [{ nom: 'asc' }] })).map(this.agence));
  }

  creerAgence(appel: Appel, a: { code: string; nom: string; ville?: string | null; adresse?: string | null }) {
    return this.dans(appel, async (tx, moi) => {
      const creee = await unique(() => tx.agence.create({
        data: { tenantId: moi.tenantId, code: a.code.trim().toUpperCase(), nom: a.nom.trim(), ville: a.ville?.trim() || null, adresse: a.adresse?.trim() || null },
      }), () => new Probleme(409, 'CODE_DEJA_UTILISE', `Le code d'agence « ${a.code} » existe déjà`));
      await this.audit(tx, moi, appel, 'parametrage.agence_creee', 'agence', creee.id, { code: creee.code });
      return this.agence(creee);
    });
  }

  modifierAgence(appel: Appel, id: string, m: Partial<{ nom: string; ville: string | null; adresse: string | null; active: boolean }>) {
    return this.dans(appel, async (tx, moi) => {
      if (!(await tx.agence.findUnique({ where: { id }, select: { id: true } }))) throw introuvable('Agence introuvable');
      const modifiee = await tx.agence.update({
        where: { id },
        data: {
          ...m,
          ...(m.nom !== undefined ? { nom: m.nom.trim() } : {}),
          ...(m.ville !== undefined ? { ville: m.ville?.trim() || null } : {}),
          ...(m.adresse !== undefined ? { adresse: m.adresse?.trim() || null } : {}),
        },
      });
      await this.audit(tx, moi, appel, 'parametrage.agence_modifiee', 'agence', id, { champs: Object.keys(m) });
      return this.agence(modifiee);
    });
  }

  // ---- Points de dépôt et QR codes ----------------------------------------------------

  private async pointsVue(tx: ClientTransaction, tenantId: string, where: { id?: string } = {}): Promise<S<'PointDepot'>[]> {
    const banque = await tx.banque.findUniqueOrThrow({ where: { id: tenantId }, select: { slug: true, canaux: { select: { pointDepotId: true, numero: true } } } });
    // Étape 21 : les points « Guichet » et « Téléphone » des saisies par le personnel ne s'affichent ni ne s'impriment
    const points = await tx.pointDepot.findMany({
      where: { ...where, canal: { notIn: ['GUICHET', 'TELEPHONE'] } }, orderBy: [{ creeLe: 'asc' }], include: { agence: { select: { id: true, nom: true } } },
    });
    return points.map((p) => ({
      id: p.id, code: p.code, canal: p.canal, libelle: p.libelle, agence: p.agence ? { id: p.agence.id, nom: p.agence.nom } : null,
      actif: p.actif,
      // Étape 20 : le numéro WhatsApp ou SMS de la banque s'ouvre sur le téléphone du client
      urlDepot: adresseDepot(this.config, banque.slug, p, banque.canaux.find((c) => c.pointDepotId === p.id)?.numero ?? null),
    }));
  }

  listerPoints(appel: Appel) {
    return this.dans(appel, (tx, moi) => this.pointsVue(tx, moi.tenantId));
  }

  private async exigerAgence(tx: ClientTransaction, agenceId: string) {
    if (!(await tx.agence.findFirst({ where: { id: agenceId }, select: { id: true } }))) throw invalideChamp('agenceId', 'Agence inconnue');
  }

  creerPoint(appel: Appel, p: { canal: 'QR_CODE' | 'LIEN_WEB'; libelle: string; agenceId?: string | null }) {
    return this.dans(appel, async (tx, moi) => {
      if (p.canal === 'QR_CODE' && !p.agenceId) throw new Probleme(422, 'QR_CODE_SANS_AGENCE', 'Choisissez l\'agence où le QR code sera affiché');
      if (p.agenceId) await this.exigerAgence(tx, p.agenceId);
      // 32^10 codes possibles : une collision est négligeable ; l'unicité reste garantie par la base
      const cree = await tx.pointDepot.create({
        data: { tenantId: moi.tenantId, code: nouveauCodePoint(), canal: p.canal, libelle: p.libelle.trim(), agenceId: p.agenceId ?? null },
      });
      await this.audit(tx, moi, appel, 'parametrage.point_cree', 'point_depot', cree.id, { canal: cree.canal, code: cree.code });
      return (await this.pointsVue(tx, moi.tenantId, { id: cree.id }))[0];
    });
  }

  modifierPoint(appel: Appel, id: string, m: Partial<{ libelle: string; agenceId: string | null; actif: boolean }>) {
    return this.dans(appel, async (tx, moi) => {
      const avant = await tx.pointDepot.findUnique({ where: { id } });
      if (!avant || avant.canal === 'GUICHET' || avant.canal === 'TELEPHONE') throw introuvable('Point de dépôt introuvable');
      const agenceId = m.agenceId !== undefined ? m.agenceId : avant.agenceId;
      // Étape 20 : le numéro WhatsApp ou SMS de la banque n'appartient à aucune agence, et Makor l'ouvre ou le ferme
      if (avant.canal === 'WHATSAPP' || avant.canal === 'SMS') {
        if (agenceId) throw invalideChamp('agenceId', 'Le numéro WhatsApp ou SMS de la banque n\'appartient à aucune agence');
        if (m.actif === false) throw invalideChamp('actif', 'Ce canal s\'ouvre et se ferme par Makor : adressez-vous à lui');
      }
      if (avant.canal === 'QR_CODE' && !agenceId) throw new Probleme(422, 'QR_CODE_SANS_AGENCE', 'Un QR code reste rattaché à une agence');
      if (m.agenceId) await this.exigerAgence(tx, m.agenceId);
      await tx.pointDepot.update({
        where: { id },
        data: { ...(m.libelle !== undefined ? { libelle: m.libelle.trim() } : {}), ...(m.agenceId !== undefined ? { agenceId: m.agenceId } : {}), ...(m.actif !== undefined ? { actif: m.actif } : {}) },
      });
      await this.audit(tx, moi, appel, 'parametrage.point_modifie', 'point_depot', id, { champs: Object.keys(m), actif: m.actif });
      return (await this.pointsVue(tx, moi.tenantId, { id }))[0];
    });
  }

  async qrCode(appel: Appel, id: string, format: 'png' | 'svg', taille: number): Promise<{ contenu: Buffer; type: string; nom: string }> {
    const point = await this.dans(appel, async (tx, moi) => (await this.pointsVue(tx, moi.tenantId, { id }))[0]);
    if (!point) throw introuvable('Point de dépôt introuvable');
    const options = { errorCorrectionLevel: 'M' as const, margin: 4 };
    if (format === 'svg') {
      return { contenu: Buffer.from(await qrEnSvg(point.urlDepot, { ...options, type: 'svg' })), type: 'image/svg+xml', nom: `qr-${point.code}.svg` };
    }
    return { contenu: await toBuffer(point.urlDepot, { ...options, type: 'png', width: taille }), type: 'image/png', nom: `qr-${point.code}.png` };
  }

  // ---- Horaires (décision C11) --------------------------------------------------------

  private async horaires(tx: ClientTransaction, tenantId: string): Promise<S<'Horaires'>> {
    const [b, plages] = await enSerie([
      () => tx.banque.findUniqueOrThrow({ where: { id: tenantId }, select: { fuseauHoraire: true } }),
      () => tx.horaireOuvre.findMany({ orderBy: [{ jourSemaine: 'asc' }, { debutMinute: 'asc' }] }),
    ]);
    return { fuseauHoraire: b.fuseauHoraire, plages: plages.map((p) => ({ jourSemaine: p.jourSemaine, debut: hhmm(p.debutMinute), fin: hhmm(p.finMinute) })) };
  }

  lireHoraires(appel: Appel) {
    return this.dans(appel, (tx, moi) => this.horaires(tx, moi.tenantId));
  }

  /** Remplace toute la semaine ; les plages qui se chevauchent ou se touchent sont fusionnées. */
  remplacerHoraires(appel: Appel, plages: { jourSemaine: number; debut: string; fin: string }[]) {
    const erreurs = plages.flatMap((p, i) => (minutes(p.debut) >= minutes(p.fin)
      ? [{ champ: `plages.${i}`, message: 'Le début doit précéder la fin' }] : []));
    if (erreurs.length) throw new Probleme(400, 'VALIDATION', 'Plages horaires invalides', erreurs);
    const fusionnees: { jourSemaine: number; debutMinute: number; finMinute: number }[] = [];
    for (const jour of [1, 2, 3, 4, 5, 6, 7]) {
      const duJour = plages.filter((p) => p.jourSemaine === jour).map((p) => [minutes(p.debut), minutes(p.fin)] as [number, number]).sort((a, b) => a[0] - b[0]);
      for (const [d, f] of duJour) {
        const derniere = fusionnees.at(-1);
        if (derniere && derniere.jourSemaine === jour && d <= derniere.finMinute) derniere.finMinute = Math.max(derniere.finMinute, f);
        else fusionnees.push({ jourSemaine: jour, debutMinute: d, finMinute: f });
      }
    }
    return this.dans(appel, async (tx, moi) => {
      await tx.horaireOuvre.deleteMany({});
      if (fusionnees.length) await tx.horaireOuvre.createMany({ data: fusionnees.map((p) => ({ ...p, tenantId: moi.tenantId })) });
      await this.audit(tx, moi, appel, 'parametrage.horaires', 'banque', moi.tenantId, { plages: fusionnees.length, minutesParSemaine: fusionnees.reduce((s, p) => s + p.finMinute - p.debutMinute, 0) });
      return this.horaires(tx, moi.tenantId);
    });
  }

  // ---- Jours fériés ------------------------------------------------------------------

  listerJoursFeries(appel: Appel, annee?: number) {
    return this.dans(appel, async (tx) => {
      const tous = await tx.jourFerie.findMany({ orderBy: [{ date: 'asc' }] });
      const vue = tous.map((j) => ({ id: j.id, date: j.date.toISOString().slice(0, 10), libelle: j.libelle, recurrent: j.recurrent }));
      if (!annee) return vue;
      // Pour une année donnée : les fêtes de cette année, et les récurrentes ramenées à cette année
      return vue
        .filter((j) => j.recurrent || j.date.startsWith(`${annee}-`))
        .map((j) => (j.recurrent ? { ...j, date: `${annee}${j.date.slice(4)}` } : j))
        .filter((j) => DateTime.fromISO(j.date).isValid)
        .sort((a, b) => a.date.localeCompare(b.date));
    });
  }

  ajouterJourFerie(appel: Appel, j: { date: string; libelle: string; recurrent?: boolean }) {
    return this.dans(appel, async (tx, moi) => {
      const cree = await unique(() => tx.jourFerie.create({
        data: { tenantId: moi.tenantId, date: new Date(`${j.date}T00:00:00Z`), libelle: j.libelle.trim(), recurrent: j.recurrent ?? false },
      }), () => new Probleme(409, 'JOUR_FERIE_EXISTANT', `Un jour férié est déjà enregistré le ${j.date}`));
      await this.audit(tx, moi, appel, 'parametrage.jour_ferie_ajoute', 'jour_ferie', cree.id, { date: j.date, recurrent: cree.recurrent });
      return { id: cree.id, date: j.date, libelle: cree.libelle, recurrent: cree.recurrent };
    });
  }

  supprimerJourFerie(appel: Appel, id: string) {
    return this.dans(appel, async (tx, moi) => {
      const j = await tx.jourFerie.findUnique({ where: { id } });
      if (!j) throw introuvable('Jour férié introuvable');
      await tx.jourFerie.delete({ where: { id } });
      await this.audit(tx, moi, appel, 'parametrage.jour_ferie_retire', 'jour_ferie', id, { date: j.date.toISOString().slice(0, 10) });
    });
  }
}
