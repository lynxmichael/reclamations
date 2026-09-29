/**
 * Jetons signés (JWT HS256) : accès du personnel (15 min), session client (30 min),
 * jeton intermédiaire entre le mot de passe et le code TOTP (5 min).
 * Chaque sorte a son audience : un jeton client n'ouvre jamais une route du personnel.
 */
import { randomUUID } from 'node:crypto';
import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import type { RoleUtilisateur } from '../../domaine/enumerations.js';

export const DUREE_ACCES = 15 * 60;
export const DUREE_CLIENT = 30 * 60;
export const DUREE_INTERMEDIAIRE = 5 * 60;

const EMETTEUR = 'reclamations';

type Audience = 'personnel' | 'client' | 'etape-totp' | 'enrolement-totp';

export interface JetonAcces {
  readonly utilisateurId: string;
  readonly role: RoleUtilisateur;
  readonly tenantId: string | null;
  readonly session: string;
}

export interface JetonClient {
  readonly clientId: string;
  readonly tenantId: string;
}

export interface JetonIntermediaire {
  readonly utilisateurId: string;
  readonly jti: string;
}

export class Jetons {
  constructor(private readonly secret: Uint8Array, private readonly horloge: () => Date = () => new Date()) {}

  private async signer(audience: Audience, sujet: string, duree: number, extra: JWTPayload = {}): Promise<string> {
    const maintenant = Math.floor(this.horloge().getTime() / 1000);
    return new SignJWT(extra)
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuer(EMETTEUR)
      .setAudience(audience)
      .setSubject(sujet)
      .setIssuedAt(maintenant)
      .setExpirationTime(maintenant + duree)
      .setJti(randomUUID())
      .sign(this.secret);
  }

  /** null si le jeton est absent, mal signé, expiré ou d'une autre audience. */
  private async lire(jeton: string, audience: Audience): Promise<JWTPayload | null> {
    try {
      const { payload } = await jwtVerify(jeton, this.secret, {
        issuer: EMETTEUR,
        audience,
        algorithms: ['HS256'],
        currentDate: this.horloge(),
      });
      return payload;
    } catch {
      return null;
    }
  }

  signerAcces(j: JetonAcces): Promise<string> {
    return this.signer('personnel', j.utilisateurId, DUREE_ACCES, { role: j.role, tid: j.tenantId, sid: j.session });
  }

  async lireAcces(jeton: string): Promise<JetonAcces | null> {
    const p = await this.lire(jeton, 'personnel');
    if (!p?.sub || typeof p.role !== 'string' || typeof p.sid !== 'string') return null;
    return { utilisateurId: p.sub, role: p.role as RoleUtilisateur, tenantId: (p.tid as string | null) ?? null, session: p.sid };
  }

  signerClient(j: JetonClient): Promise<string> {
    return this.signer('client', j.clientId, DUREE_CLIENT, { tid: j.tenantId });
  }

  async lireClient(jeton: string): Promise<JetonClient | null> {
    const p = await this.lire(jeton, 'client');
    if (!p?.sub || typeof p.tid !== 'string') return null;
    return { clientId: p.sub, tenantId: p.tid };
  }

  signerIntermediaire(but: 'etape-totp' | 'enrolement-totp', utilisateurId: string): Promise<string> {
    return this.signer(but, utilisateurId, DUREE_INTERMEDIAIRE);
  }

  async lireIntermediaire(jeton: string, but: 'etape-totp' | 'enrolement-totp'): Promise<JetonIntermediaire | null> {
    const p = await this.lire(jeton, but);
    if (!p?.sub || !p.jti) return null;
    return { utilisateurId: p.sub, jti: p.jti };
  }
}
