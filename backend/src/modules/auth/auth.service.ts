/**
 * Authentification du personnel (décision C6) : e-mail et mot de passe, puis code TOTP obligatoire.
 *
 * - jeton d'accès de 15 minutes, refresh token en cookie httpOnly changé à chaque usage ;
 *   réutiliser un refresh token déjà remplacé révoque toute la session (vol présumé) ;
 * - 5 échecs (mot de passe ou code) verrouillent le compte 15 minutes ;
 * - un même code TOTP ne sert qu'une fois ;
 * - les secrets ne sont lus qu'ici, en contexte système.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { components } from '../../contrat/api.js';
import { CONFIGURATION, type Configuration } from '../../configuration/configuration.js';
import { journaliser } from '../../infrastructure/audit/journal.js';
import { BaseDonnees, type ClientTransaction } from '../../infrastructure/base-de-donnees/base-de-donnees.service.js';
import { traceDe, type Appel, type Personnel } from '../../infrastructure/contrat/appel.js';
import { jetonInvalide, nonAuthentifie, Probleme } from '../../infrastructure/contrat/probleme.js';
import { ServiceRedis } from '../../infrastructure/redis/redis.service.js';
import { DUREE_ACCES, DUREE_INTERMEDIAIRE, Jetons } from '../../infrastructure/securite/jetons.js';
import { LIMITES, Limiteur } from '../../infrastructure/securite/limiteur.js';
import { exigerRobustesse, hacherMotDePasse, verifierMotDePasse } from '../../infrastructure/securite/mots-de-passe.js';
import { chiffrer, cleAntiRejeu, dechiffrer, enrolement, nouveauSecret, pasDuCode } from '../../infrastructure/securite/totp.js';
import { HORLOGE, type Horloge } from '../../noyau/noyau.module.js';
import { empreinte, envoyerReinitialisation, nouveauJeton } from './liens.js';

type S<N extends keyof components['schemas']> = components['schemas'][N];

export const DUREE_SESSION_HEURES = 12;
export const ECHECS_AVANT_VERROU = 5;
export const DUREE_VERROU_MINUTES = 15;
/** Deux onglets qui rafraîchissent en même temps : pas de révocation dans ce délai */
const TOLERANCE_REUTILISATION_MS = 10_000;

export interface SessionOuverte {
  readonly corps: S<'SessionPersonnel'>;
  readonly refreshToken: string;
  readonly expireLe: Date;
}

const CHAMPS_AUTH = {
  id: true, tenantId: true, role: true, statut: true, email: true, nom: true, prenom: true,
  motDePasseHash: true, totpSecretChiffre: true, totpActiveLe: true, echecsConnexion: true, verrouilleJusquA: true,
  banque: { select: { id: true, nom: true, slug: true, fuseauHoraire: true, suspendueLe: true } },
} as const;

@Injectable()
export class ServiceAuth {
  constructor(
    @Inject(BaseDonnees) private readonly bd: BaseDonnees,
    @Inject(Jetons) private readonly jetons: Jetons,
    @Inject(Limiteur) private readonly limiteur: Limiteur,
    @Inject(ServiceRedis) private readonly redis: ServiceRedis,
    @Inject(CONFIGURATION) private readonly config: Configuration,
    @Inject(HORLOGE) private readonly horloge: Horloge,
  ) {}

  private charger(tx: ClientTransaction, where: { id: string } | { email: string }) {
    // select explicite : le hash et le secret TOTP, omis par défaut, sont lus ici seulement
    return tx.utilisateur.findUnique({ where, select: CHAMPS_AUTH });
  }

  // =========================================================================
  //  Connexion
  // =========================================================================

  async connexion(entree: { email: string; motDePasse: string }, appel: Appel): Promise<S<'EtapeTotp'>> {
    await this.limiteur.exigerSousLimite(LIMITES.echecsConnexionParIp, appel.ip, 'Trop de tentatives de connexion depuis cette adresse');
    const maintenant = this.horloge();
    const email = entree.email.trim().toLowerCase();
    const u = await this.bd.enSysteme((tx) => this.charger(tx, { email }));
    this.exigerNonVerrouille(u, maintenant);
    const valide = await verifierMotDePasse(u?.motDePasseHash, entree.motDePasse);
    const utilisable = !!u && (u.statut === 'ACTIF' || (u.statut === 'INVITE' && !!u.motDePasseHash));
    if (!u || !valide || !utilisable) {
      await this.limiteur.compter(LIMITES.echecsConnexionParIp, appel.ip);
      if (u && !valide) await this.noterEchec(u, maintenant, 'auth.echec_mot_de_passe', appel);
      throw new Probleme(401, 'IDENTIFIANTS_INVALIDES', 'E-mail ou mot de passe incorrect');
    }
    this.exigerBanqueOuverte(u);

    if (!u.totpActiveLe) {
      // Première connexion après une réinitialisation du TOTP : nouvel enrôlement
      const secret = nouveauSecret();
      await this.bd.enSysteme((tx) => tx.utilisateur.update({ where: { id: u.id }, data: { totpSecretChiffre: chiffrer(this.config.cleTotp, secret) } }));
      const jeton = await this.jetons.signerIntermediaire('enrolement-totp', u.id);
      return {
        etape: 'ENROLEMENT_TOTP_REQUIS',
        jetonIntermediaire: jeton,
        expireDans: DUREE_INTERMEDIAIRE,
        enrolement: { jetonIntermediaire: jeton, ...(await enrolement(secret, u.email)) },
      };
    }
    return { etape: 'TOTP_REQUIS', jetonIntermediaire: await this.jetons.signerIntermediaire('etape-totp', u.id), expireDans: DUREE_INTERMEDIAIRE };
  }

  async validerCodeTotp(entree: { jetonIntermediaire: string; code: string }, appel: Appel): Promise<SessionOuverte> {
    const maintenant = this.horloge();
    const j = await this.jetons.lireIntermediaire(entree.jetonIntermediaire, 'etape-totp');
    if (!j || !(await this.jetonIntermediaireLibre(j.jti))) throw jetonInvalide('Étape de connexion expirée : recommencez');
    const u = await this.bd.enSysteme((tx) => this.charger(tx, { id: j.utilisateurId }));
    if (!u || u.statut !== 'ACTIF' || !u.totpActiveLe || !u.totpSecretChiffre) throw jetonInvalide('Étape de connexion expirée : recommencez');
    this.exigerNonVerrouille(u, maintenant);
    this.exigerBanqueOuverte(u);
    await this.verifierCode(u, entree.code, maintenant, appel);
    await this.consommerJetonIntermediaire(j.jti);
    return this.ouvrirSession(u, maintenant, appel, 'auth.connexion');
  }

  // =========================================================================
  //  Invitation et enrôlement TOTP
  // =========================================================================

  async accepterInvitation(entree: { jeton: string; motDePasse: string }, appel: Appel): Promise<S<'EnrolementTotp'>> {
    const maintenant = this.horloge();
    const secret = nouveauSecret();
    const u = await this.bd.enSysteme(async (tx) => {
      const jeton = await tx.jetonUtilisateur.findUnique({ where: { jetonHash: empreinte(entree.jeton) } });
      if (!jeton || jeton.type !== 'INVITATION' || jeton.utiliseLe || jeton.expireLe <= maintenant) {
        throw jetonInvalide('Lien d\'invitation invalide ou expiré : demandez un nouvel envoi');
      }
      const u = await this.charger(tx, { id: jeton.utilisateurId });
      if (!u || u.statut !== 'INVITE') throw jetonInvalide('Lien d\'invitation invalide ou expiré : demandez un nouvel envoi');
      this.exigerBanqueOuverte(u);
      exigerRobustesse(entree.motDePasse, u);
      await tx.utilisateur.update({
        where: { id: u.id },
        data: { motDePasseHash: await hacherMotDePasse(entree.motDePasse), totpSecretChiffre: chiffrer(this.config.cleTotp, secret), totpActiveLe: null },
      });
      await tx.jetonUtilisateur.update({ where: { id: jeton.id }, data: { utiliseLe: maintenant } });
      await journaliser(tx, { tenantId: u.tenantId, acteur: this.personnel(u, ''), action: 'personnel.invitation_acceptee', entite: 'utilisateur', entiteId: u.id, trace: traceDe(appel) });
      return u;
    });
    return { jetonIntermediaire: await this.jetons.signerIntermediaire('enrolement-totp', u.id), ...(await enrolement(secret, u.email)) };
  }

  async activerTotp(entree: { jetonIntermediaire: string; code: string }, appel: Appel): Promise<SessionOuverte> {
    const maintenant = this.horloge();
    const j = await this.jetons.lireIntermediaire(entree.jetonIntermediaire, 'enrolement-totp');
    if (!j || !(await this.jetonIntermediaireLibre(j.jti))) throw jetonInvalide('Étape d\'activation expirée : reconnectez-vous');
    const u = await this.bd.enSysteme((tx) => this.charger(tx, { id: j.utilisateurId }));
    if (!u || u.totpActiveLe || !u.totpSecretChiffre || !u.motDePasseHash || (u.statut !== 'ACTIF' && u.statut !== 'INVITE')) {
      throw jetonInvalide('Étape d\'activation expirée : reconnectez-vous');
    }
    this.exigerNonVerrouille(u, maintenant);
    this.exigerBanqueOuverte(u);
    await this.verifierCode(u, entree.code, maintenant, appel);
    await this.consommerJetonIntermediaire(j.jti);
    await this.bd.enSysteme(async (tx) => {
      await tx.utilisateur.update({ where: { id: u.id }, data: { totpActiveLe: maintenant, statut: 'ACTIF' } });
      await journaliser(tx, { tenantId: u.tenantId, acteur: this.personnel(u, ''), action: 'auth.totp_active', entite: 'utilisateur', entiteId: u.id, trace: traceDe(appel) });
    });
    return this.ouvrirSession({ ...u, statut: 'ACTIF' }, maintenant, appel, 'auth.connexion');
  }

  // =========================================================================
  //  Sessions
  // =========================================================================

  async rafraichir(refreshToken: string | undefined, appel: Appel): Promise<SessionOuverte> {
    if (!refreshToken) throw nonAuthentifie('Session absente : reconnectez-vous');
    const maintenant = this.horloge();
    const hash = empreinte(refreshToken);
    // Le refus est décidé dans la transaction, mais levé après son COMMIT : la révocation d'une
    // session volée doit être enregistrée même si la réponse est une erreur.
    const r = await this.bd.enSysteme(async (tx): Promise<SessionOuverte | Probleme> => {
      const s = await tx.sessionUtilisateur.findUnique({ where: { refreshTokenHash: hash } });
      if (!s) return jetonInvalide('Session inconnue : reconnectez-vous');
      if (s.revoqueLe) return jetonInvalide('Session fermée : reconnectez-vous');
      if (s.remplaceLe) {
        // Un refresh token déjà remplacé revient : il a pu être volé. Toute la session tombe.
        if (maintenant.getTime() - s.remplaceLe.getTime() > TOLERANCE_REUTILISATION_MS) {
          await tx.sessionUtilisateur.updateMany({ where: { famille: s.famille, revoqueLe: null }, data: { revoqueLe: maintenant } });
          const u = await this.charger(tx, { id: s.utilisateurId });
          if (u) await journaliser(tx, { tenantId: u.tenantId, acteur: this.personnel(u, s.famille), action: 'auth.reutilisation_refresh_token', entite: 'utilisateur', entiteId: u.id, trace: traceDe(appel) });
        }
        return jetonInvalide('Session expirée : reconnectez-vous');
      }
      if (s.expireLe <= maintenant) return jetonInvalide('Session expirée : reconnectez-vous');
      const u = await this.charger(tx, { id: s.utilisateurId });
      if (!u || u.statut !== 'ACTIF' || u.banque?.suspendueLe) return jetonInvalide('Session fermée : reconnectez-vous');
      await tx.sessionUtilisateur.update({ where: { id: s.id }, data: { remplaceLe: maintenant } });
      const nouveau = randomBytes(32).toString('base64url');
      await tx.sessionUtilisateur.create({
        data: {
          utilisateurId: u.id, famille: s.famille, refreshTokenHash: empreinte(nouveau), expireLe: s.expireLe,
          ip: appel.ip.slice(0, 45), userAgent: appel.userAgent?.slice(0, 512) ?? null, creeLe: maintenant,
        },
      });
      return { corps: await this.corpsSession(u, s.famille), refreshToken: nouveau, expireLe: s.expireLe };
    });
    if (r instanceof Probleme) throw r;
    return r;
  }

  async deconnexion(personnel: Personnel, appel: Appel): Promise<void> {
    const maintenant = this.horloge();
    await this.bd.enSysteme(async (tx) => {
      await tx.sessionUtilisateur.updateMany({ where: { famille: personnel.session, revoqueLe: null }, data: { revoqueLe: maintenant } });
      await journaliser(tx, { tenantId: personnel.tenantId, acteur: personnel, action: 'auth.deconnexion', entite: 'utilisateur', entiteId: personnel.id, trace: traceDe(appel) });
    });
  }

  // =========================================================================
  //  Mot de passe oublié
  // =========================================================================

  /** Répond toujours de la même façon, que l'adresse existe ou non. */
  async demanderReinitialisation(email: string, appel: Appel): Promise<void> {
    await this.limiteur.consommer(LIMITES.motDePasseOublieParIp, appel.ip);
    const maintenant = this.horloge();
    await this.bd.enSysteme(async (tx) => {
      const u = await this.charger(tx, { email: email.trim().toLowerCase() });
      if (!u || u.statut !== 'ACTIF') return;
      const jeton = await nouveauJeton(tx, u.id, 'REINITIALISATION', maintenant);
      await envoyerReinitialisation(tx, this.config, u, jeton);
      await journaliser(tx, { tenantId: u.tenantId, acteur: 'SYSTEME', action: 'auth.demande_reinitialisation', entite: 'utilisateur', entiteId: u.id, trace: traceDe(appel) });
    });
  }

  async reinitialiserMotDePasse(entree: { jeton: string; motDePasse: string }, appel: Appel): Promise<void> {
    const maintenant = this.horloge();
    await this.bd.enSysteme(async (tx) => {
      const jeton = await tx.jetonUtilisateur.findUnique({ where: { jetonHash: empreinte(entree.jeton) } });
      if (!jeton || jeton.type !== 'REINITIALISATION' || jeton.utiliseLe || jeton.expireLe <= maintenant) {
        throw jetonInvalide('Lien de réinitialisation invalide ou expiré : faites une nouvelle demande');
      }
      const u = await this.charger(tx, { id: jeton.utilisateurId });
      if (!u || u.statut !== 'ACTIF') throw jetonInvalide('Lien de réinitialisation invalide ou expiré : faites une nouvelle demande');
      exigerRobustesse(entree.motDePasse, u);
      await tx.utilisateur.update({
        where: { id: u.id },
        data: { motDePasseHash: await hacherMotDePasse(entree.motDePasse), echecsConnexion: 0, verrouilleJusquA: null },
      });
      await tx.jetonUtilisateur.update({ where: { id: jeton.id }, data: { utiliseLe: maintenant } });
      await tx.sessionUtilisateur.updateMany({ where: { utilisateurId: u.id, revoqueLe: null }, data: { revoqueLe: maintenant } });
      await journaliser(tx, { tenantId: u.tenantId, acteur: this.personnel(u, ''), action: 'auth.mot_de_passe_reinitialise', entite: 'utilisateur', entiteId: u.id, trace: traceDe(appel) });
    });
  }

  async moi(personnel: Personnel): Promise<S<'Moi'>> {
    const u = await this.bd.enSysteme((tx) => this.charger(tx, { id: personnel.id }));
    if (!u) throw jetonInvalide();
    return moiDe(u);
  }

  // =========================================================================
  //  Outils
  // =========================================================================

  private exigerNonVerrouille(u: UtilisateurAuth | null, maintenant: Date): void {
    if (u?.verrouilleJusquA && u.verrouilleJusquA > maintenant) {
      const secondes = Math.ceil((u.verrouilleJusquA.getTime() - maintenant.getTime()) / 1000);
      throw new Probleme(423, 'COMPTE_VERROUILLE', `Trop d'échecs : réessayez dans ${Math.ceil(secondes / 60)} minute(s)`, undefined, { 'Retry-After': String(secondes) });
    }
  }

  private exigerBanqueOuverte(u: UtilisateurAuth): void {
    if (u.banque?.suspendueLe) throw new Probleme(403, 'BANQUE_SUSPENDUE', 'L\'accès de votre banque est suspendu');
  }

  private async noterEchec(u: UtilisateurAuth, maintenant: Date, action: string, appel: Appel): Promise<void> {
    await this.bd.enSysteme(async (tx) => {
      const echecs = u.echecsConnexion + 1;
      const verrou = echecs >= ECHECS_AVANT_VERROU;
      await tx.utilisateur.update({
        where: { id: u.id },
        data: verrou
          ? { echecsConnexion: 0, verrouilleJusquA: new Date(maintenant.getTime() + DUREE_VERROU_MINUTES * 60_000) }
          : { echecsConnexion: echecs },
      });
      await journaliser(tx, { tenantId: u.tenantId, acteur: 'SYSTEME', action: verrou ? 'auth.compte_verrouille' : action, entite: 'utilisateur', entiteId: u.id, trace: traceDe(appel) });
    });
  }

  private async verifierCode(u: UtilisateurAuth, code: string, maintenant: Date, appel: Appel): Promise<void> {
    const secret = dechiffrer(this.config.cleTotp, u.totpSecretChiffre!);
    const pas = pasDuCode(secret, code, maintenant);
    // Anti-rejeu : un code déjà utilisé est refusé pendant toute sa période de validité
    const neuf = pas !== null && (await this.redis.client.set(cleAntiRejeu(u.id, secret, pas), '1', 'EX', 120, 'NX').catch(() => 'OK')) === 'OK';
    if (!neuf) {
      await this.limiteur.compter(LIMITES.echecsConnexionParIp, appel.ip);
      await this.noterEchec(u, maintenant, 'auth.echec_totp', appel);
      throw new Probleme(401, 'CODE_TOTP_INVALIDE', 'Code incorrect ou déjà utilisé : attendez le suivant');
    }
  }

  private async jetonIntermediaireLibre(jti: string): Promise<boolean> {
    return !(await this.redis.client.exists(`intermediaire:${jti}`).catch(() => 0));
  }

  private async consommerJetonIntermediaire(jti: string): Promise<void> {
    await this.redis.client.set(`intermediaire:${jti}`, '1', 'EX', DUREE_INTERMEDIAIRE + 60).catch(() => undefined);
  }

  private async ouvrirSession(u: UtilisateurAuth, maintenant: Date, appel: Appel, action: string): Promise<SessionOuverte> {
    const refreshToken = randomBytes(32).toString('base64url');
    const famille = randomUUID();
    const expireLe = new Date(maintenant.getTime() + DUREE_SESSION_HEURES * 3_600_000);
    await this.bd.enSysteme(async (tx) => {
      await tx.sessionUtilisateur.create({
        data: {
          utilisateurId: u.id, famille, refreshTokenHash: empreinte(refreshToken), expireLe,
          ip: appel.ip.slice(0, 45), userAgent: appel.userAgent?.slice(0, 512) ?? null, creeLe: maintenant,
        },
      });
      await tx.utilisateur.update({ where: { id: u.id }, data: { echecsConnexion: 0, verrouilleJusquA: null, derniereConnexionLe: maintenant } });
      await journaliser(tx, { tenantId: u.tenantId, acteur: this.personnel(u, famille), action, entite: 'utilisateur', entiteId: u.id, trace: traceDe(appel) });
    });
    return { corps: await this.corpsSession(u, famille), refreshToken, expireLe };
  }

  private async corpsSession(u: UtilisateurAuth, famille: string): Promise<S<'SessionPersonnel'>> {
    return {
      jetonAcces: await this.jetons.signerAcces({ utilisateurId: u.id, role: u.role, tenantId: u.tenantId, session: famille }),
      expireDans: DUREE_ACCES,
      utilisateur: moiDe(u),
    };
  }

  private personnel(u: UtilisateurAuth, session: string): Personnel {
    return { id: u.id, role: u.role, tenantId: u.tenantId, email: u.email, nom: u.nom, prenom: u.prenom, session };
  }
}

interface UtilisateurAuth {
  id: string;
  tenantId: string | null;
  role: Personnel['role'];
  statut: 'INVITE' | 'ACTIF' | 'DESACTIVE';
  email: string;
  nom: string;
  prenom: string;
  motDePasseHash: string | null;
  totpSecretChiffre: string | null;
  totpActiveLe: Date | null;
  echecsConnexion: number;
  verrouilleJusquA: Date | null;
  banque: { id: string; nom: string; slug: string; fuseauHoraire: string; suspendueLe: Date | null } | null;
}

export function moiDe(u: Pick<UtilisateurAuth, 'id' | 'email' | 'nom' | 'prenom' | 'role' | 'banque'>): S<'Moi'> {
  return {
    id: u.id,
    email: u.email,
    nom: u.nom,
    prenom: u.prenom,
    role: u.role,
    banque: u.banque ? { id: u.banque.id, nom: u.banque.nom, slug: u.banque.slug, fuseauHoraire: u.banque.fuseauHoraire } : null,
  };
}

/** Empreinte courte d'un refresh token, pour les journaux (jamais le jeton lui-même). */
export const empreinteCourte = (jeton: string) => createHash('sha256').update(jeton).digest('hex').slice(0, 12);
