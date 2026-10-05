/**
 * Personnel d'une banque (§5, §6.7) : invitation, équipes (agent rattaché à un superviseur),
 * désactivation (jamais de suppression), réinitialisation de la double authentification.
 * Le plafond d'agents du plan bloque l'invitation ou la réactivation au-delà de la limite.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import { CONFIGURATION, type Configuration } from '../../configuration/configuration.js';
import { normaliserTelephone } from '../../domaine/contact.js';
import { journaliser } from '../../infrastructure/audit/journal.js';
import { BaseDonnees, type ClientTransaction } from '../../infrastructure/base-de-donnees/base-de-donnees.service.js';
import { basculer, contexte, enSerie } from '../../infrastructure/base-de-donnees/index.js';
import { personnelBanque, traceDe, type Appel, type Personnel } from '../../infrastructure/contrat/appel.js';
import { interdit, introuvable, invalideChamp, Probleme } from '../../infrastructure/contrat/probleme.js';
import { HORLOGE, type Horloge } from '../../noyau/noyau.module.js';
import { envoyerInvitation, nouveauJeton } from '../auth/liens.js';
import { pageDe, pagination, type S } from '../commun.js';
import { iso, nomComplet } from '../reclamations/lecture.js';

type RoleBanque = 'ADMIN_ENTREPRISE' | 'SUPERVISEUR' | 'AGENT';

export const SELECTION_UTILISATEUR = {
  id: true, email: true, nom: true, prenom: true, telephone: true, role: true, statut: true, totpActiveLe: true,
  derniereConnexionLe: true, verrouilleJusquA: true, superviseur: { select: { id: true, nom: true, prenom: true } },
} as const satisfies Prisma.UtilisateurSelect;

type UtilisateurLu = Prisma.UtilisateurGetPayload<{ select: typeof SELECTION_UTILISATEUR }>;

export function vueUtilisateur(u: UtilisateurLu): S<'Utilisateur'> {
  return {
    id: u.id, email: u.email, nom: u.nom, prenom: u.prenom, telephone: u.telephone, role: u.role, statut: u.statut,
    superviseur: u.superviseur ? { id: u.superviseur.id, nom: nomComplet(u.superviseur) } : null,
    totpActif: u.totpActiveLe !== null,
    derniereConnexionLe: iso(u.derniereConnexionLe),
    verrouilleJusquA: iso(u.verrouilleJusquA),
  };
}

export function telephoneValide(brut: string | null | undefined): string | null {
  try {
    return normaliserTelephone(brut);
  } catch {
    throw invalideChamp('telephone', 'Numéro de téléphone invalide');
  }
}

/** L'e-mail de connexion est unique sur toute la plateforme (lecture système : la RLS masque les autres banques). */
export async function exigerEmailLibre(tx: ClientTransaction, retour: string | null, email: string): Promise<void> {
  await basculer(tx, contexte.systeme());
  const pris = await tx.utilisateur.findUnique({ where: { email }, select: { id: true } });
  await basculer(tx, retour ? contexte.banque(retour) : contexte.plateforme());
  if (pris) throw new Probleme(409, 'EMAIL_DEJA_UTILISE', `L'adresse ${email} a déjà un compte`);
}

@Injectable()
export class ServicePersonnel {
  constructor(
    @Inject(BaseDonnees) private readonly bd: BaseDonnees,
    @Inject(CONFIGURATION) private readonly config: Configuration,
    @Inject(HORLOGE) private readonly horloge: Horloge,
  ) {}

  private dans<T>(appel: Appel, travail: (tx: ClientTransaction, moi: Personnel & { tenantId: string }) => Promise<T>): Promise<T> {
    const moi = personnelBanque(appel);
    return this.bd.enBanque(moi.tenantId, (tx) => travail(tx, moi));
  }

  private async lu(tx: ClientTransaction, id: string): Promise<UtilisateurLu> {
    const u = await tx.utilisateur.findUnique({ where: { id }, select: SELECTION_UTILISATEUR });
    if (!u) throw introuvable('Membre du personnel introuvable');
    return u;
  }

  /** Agents et superviseurs non désactivés ≤ plafond du plan (vide = illimité). */
  private async exigerPlafond(tx: ClientTransaction, tenantId: string, sauf?: string): Promise<void> {
    const b = await tx.banque.findUniqueOrThrow({ where: { id: tenantId }, select: { plan: { select: { plafondAgents: true } } } });
    const plafond = b.plan.plafondAgents;
    if (!plafond) return;
    const n = await tx.utilisateur.count({ where: { role: { in: ['AGENT', 'SUPERVISEUR'] }, statut: { not: 'DESACTIVE' }, ...(sauf ? { id: { not: sauf } } : {}) } });
    if (n >= plafond) throw new Probleme(422, 'PLAFOND_AGENTS_ATTEINT', `Votre plan permet ${plafond} agents et superviseurs : désactivez un compte ou changez de plan`);
  }

  private async exigerSuperviseur(tx: ClientTransaction, superviseurId: string): Promise<void> {
    const s = await tx.utilisateur.findFirst({ where: { id: superviseurId, role: 'SUPERVISEUR', statut: { not: 'DESACTIVE' } }, select: { id: true } });
    if (!s) throw new Probleme(422, 'SUPERVISEUR_INVALIDE', 'Le superviseur doit être un superviseur actif de la banque');
  }

  lister(appel: Appel, q: Record<string, unknown>): Promise<S<'PageUtilisateurs'>> {
    const { page, parPage, skip, take } = pagination(q);
    const where: Prisma.UtilisateurWhereInput = {
      ...(q.role ? { role: q.role as RoleBanque } : {}),
      ...(q.statut ? { statut: q.statut as 'ACTIF' } : {}),
      ...(q.recherche ? {
        OR: ['nom', 'prenom', 'email'].map((champ) => ({ [champ]: { contains: String(q.recherche).trim(), mode: 'insensitive' } })),
      } : {}),
    };
    return this.dans(appel, async (tx) => {
      const [total, lignes] = await enSerie([
        () => tx.utilisateur.count({ where }),
        () => tx.utilisateur.findMany({ where, select: SELECTION_UTILISATEUR, orderBy: [{ nom: 'asc' }, { prenom: 'asc' }], skip, take }),
      ]);
      return pageDe(lignes.map(vueUtilisateur), page, parPage, total);
    });
  }

  lire(appel: Appel, id: string) {
    return this.dans(appel, async (tx) => vueUtilisateur(await this.lu(tx, id)));
  }

  inviter(appel: Appel, e: { email: string; nom: string; prenom: string; telephone?: string | null; role: RoleBanque; superviseurId?: string | null }) {
    const email = e.email.trim().toLowerCase();
    const telephone = telephoneValide(e.telephone);
    return this.dans(appel, async (tx, moi) => {
      await exigerEmailLibre(tx, moi.tenantId, email);
      if (e.role !== 'ADMIN_ENTREPRISE') await this.exigerPlafond(tx, moi.tenantId);
      if (e.superviseurId) {
        if (e.role !== 'AGENT') throw new Probleme(422, 'SUPERVISEUR_INVALIDE', 'Seul un agent est rattaché à un superviseur');
        await this.exigerSuperviseur(tx, e.superviseurId);
      }
      const cree = await tx.utilisateur.create({
        data: {
          tenantId: moi.tenantId, role: e.role, statut: 'INVITE', email, nom: e.nom.trim(), prenom: e.prenom.trim(), telephone,
          superviseurId: e.role === 'AGENT' ? (e.superviseurId ?? null) : null,
        },
        select: { id: true },
      });
      await this.envoyerInvitation(tx, moi.tenantId, cree.id);
      await journaliser(tx, { tenantId: moi.tenantId, acteur: moi, action: 'personnel.invitation', entite: 'utilisateur', entiteId: cree.id, donnees: { role: e.role }, trace: traceDe(appel) });
      return vueUtilisateur(await this.lu(tx, cree.id));
    });
  }

  /** Jeton et e-mail (contexte système), puis retour au contexte de la banque. */
  private async envoyerInvitation(tx: ClientTransaction, tenantId: string, utilisateurId: string): Promise<void> {
    await basculer(tx, contexte.systeme());
    const u = await tx.utilisateur.findUniqueOrThrow({
      where: { id: utilisateurId }, select: { id: true, tenantId: true, email: true, prenom: true, banque: { select: { nom: true, doubleAuthentificationObligatoire: true } } },
    });
    const jeton = await nouveauJeton(tx, u.id, 'INVITATION', this.horloge());
    await envoyerInvitation(tx, this.config, u, u.banque?.nom ?? null, jeton, u.banque?.doubleAuthentificationObligatoire ?? true);
    await basculer(tx, contexte.banque(tenantId));
  }

  modifier(appel: Appel, id: string, m: { nom?: string; prenom?: string; telephone?: string | null; role?: RoleBanque; superviseurId?: string | null }) {
    const telephone = m.telephone !== undefined ? telephoneValide(m.telephone) : undefined;
    return this.dans(appel, async (tx, moi) => {
      const avant = await this.lu(tx, id);
      if (m.role && m.role !== avant.role && id === moi.id) throw interdit('Vous ne pouvez pas changer votre propre rôle');
      const role = (m.role ?? avant.role) as RoleBanque;
      if (role !== 'ADMIN_ENTREPRISE' && avant.role === 'ADMIN_ENTREPRISE' && avant.statut !== 'DESACTIVE') await this.exigerPlafond(tx, moi.tenantId, id);
      let superviseurId = m.superviseurId !== undefined ? m.superviseurId : avant.superviseur?.id ?? null;
      if (role !== 'AGENT') {
        if (m.superviseurId) throw new Probleme(422, 'SUPERVISEUR_INVALIDE', 'Seul un agent est rattaché à un superviseur');
        superviseurId = null;
      } else if (m.superviseurId) {
        if (m.superviseurId === id) throw new Probleme(422, 'SUPERVISEUR_INVALIDE', 'Un agent ne peut pas être son propre superviseur');
        await this.exigerSuperviseur(tx, m.superviseurId);
      }
      // Un superviseur qui change de rôle libère son équipe
      if (avant.role === 'SUPERVISEUR' && role !== 'SUPERVISEUR') {
        await tx.utilisateur.updateMany({ where: { superviseurId: id }, data: { superviseurId: null } });
      }
      await tx.utilisateur.update({
        where: { id },
        data: {
          ...(m.nom !== undefined ? { nom: m.nom.trim() } : {}),
          ...(m.prenom !== undefined ? { prenom: m.prenom.trim() } : {}),
          ...(telephone !== undefined ? { telephone } : {}),
          role,
          superviseurId,
        },
      });
      await journaliser(tx, {
        tenantId: moi.tenantId, acteur: moi, action: 'personnel.modifie', entite: 'utilisateur', entiteId: id,
        donnees: { champs: Object.keys(m), ...(m.role && m.role !== avant.role ? { roleAvant: avant.role, roleApres: m.role } : {}) }, trace: traceDe(appel),
      });
      return vueUtilisateur(await this.lu(tx, id));
    });
  }

  desactiver(appel: Appel, id: string) {
    return this.dans(appel, async (tx, moi) => {
      if (id === moi.id) throw interdit('Vous ne pouvez pas désactiver votre propre compte');
      const u = await this.lu(tx, id);
      if (u.statut !== 'DESACTIVE') {
        const maintenant = this.horloge();
        await tx.utilisateur.update({ where: { id }, data: { statut: 'DESACTIVE', desactiveLe: maintenant } });
        await basculer(tx, contexte.systeme());
        await tx.sessionUtilisateur.updateMany({ where: { utilisateurId: id, revoqueLe: null }, data: { revoqueLe: maintenant } });
        await tx.jetonUtilisateur.updateMany({ where: { utilisateurId: id, utiliseLe: null }, data: { utiliseLe: maintenant } });
        await basculer(tx, contexte.banque(moi.tenantId));
        await journaliser(tx, { tenantId: moi.tenantId, acteur: moi, action: 'personnel.desactive', entite: 'utilisateur', entiteId: id, donnees: { role: u.role }, trace: traceDe(appel) });
      }
      return vueUtilisateur(await this.lu(tx, id));
    });
  }

  reactiver(appel: Appel, id: string) {
    return this.dans(appel, async (tx, moi) => {
      const u = await this.lu(tx, id);
      if (u.statut === 'DESACTIVE') {
        if (u.role !== 'ADMIN_ENTREPRISE') await this.exigerPlafond(tx, moi.tenantId, id);
        // Un compte qui n'a jamais ouvert de session ni activé la double authentification n'a pas été
        // finalisé : il redevient une invitation (étape 19 : on peut être actif sans double authentification)
        await tx.utilisateur.update({ where: { id }, data: { statut: u.totpActiveLe || u.derniereConnexionLe ? 'ACTIF' : 'INVITE', desactiveLe: null } });
        await journaliser(tx, { tenantId: moi.tenantId, acteur: moi, action: 'personnel.reactive', entite: 'utilisateur', entiteId: id, trace: traceDe(appel) });
      }
      return vueUtilisateur(await this.lu(tx, id));
    });
  }

  renvoyerInvitation(appel: Appel, id: string) {
    return this.dans(appel, async (tx, moi) => {
      const u = await this.lu(tx, id);
      if (u.statut !== 'INVITE') throw new Probleme(409, 'INVITATION_DEJA_ACCEPTEE', 'Ce compte a déjà été activé');
      await this.envoyerInvitation(tx, moi.tenantId, id);
      await journaliser(tx, { tenantId: moi.tenantId, acteur: moi, action: 'personnel.invitation_renvoyee', entite: 'utilisateur', entiteId: id, trace: traceDe(appel) });
    });
  }

  /**
   * Téléphone perdu : le secret TOTP est effacé et les sessions fermées. La prochaine connexion demandera
   * un nouvel enrôlement si la banque l'exige ; sinon la personne le réactive depuis « Mon compte » (étape 19).
   */
  reinitialiserTotp(appel: Appel, id: string) {
    return this.dans(appel, async (tx, moi) => {
      await this.lu(tx, id);
      const maintenant = this.horloge();
      await basculer(tx, contexte.systeme());
      await tx.utilisateur.update({ where: { id }, data: { totpSecretChiffre: null, totpActiveLe: null } });
      await tx.sessionUtilisateur.updateMany({ where: { utilisateurId: id, revoqueLe: null }, data: { revoqueLe: maintenant } });
      await basculer(tx, contexte.banque(moi.tenantId));
      await journaliser(tx, { tenantId: moi.tenantId, acteur: moi, action: 'personnel.totp_reinitialise', entite: 'utilisateur', entiteId: id, trace: traceDe(appel) });
      return vueUtilisateur(await this.lu(tx, id));
    });
  }
}
