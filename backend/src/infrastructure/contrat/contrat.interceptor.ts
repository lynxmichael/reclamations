/**
 * Intercepteur du contrat, appliqué à chaque opération :
 *   1. authentification selon le schéma de sécurité de l'opération (personnel, client, aucune) ;
 *   2. rôle autorisé (x-roles), banque non suspendue ;
 *   3. limite de débit des pages publiques ;
 *   4. lecture du multipart (fichiers en mémoire, limites) ;
 *   5. validation des paramètres, en-têtes et corps contre les schémas du contrat.
 * Le contrôleur reçoit alors un appel authentifié et des entrées conformes.
 */
import { Inject, Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import type { Observable } from 'rxjs';
import { CONFIGURATION, type Configuration } from '../../configuration/configuration.js';
import { HORLOGE, type Horloge } from '../../noyau/noyau.module.js';
import { BaseDonnees } from '../base-de-donnees/base-de-donnees.service.js';
import { enSerie } from '../base-de-donnees/index.js';
import { lireMultipart, MAX_OCTETS, MAX_OCTETS_LOGO } from '../fichiers/fichiers.js';
import { Jetons } from '../securite/jetons.js';
import { LIMITES, Limiteur } from '../securite/limiteur.js';
import type { Appel, FichierRecu, RequeteApi } from './appel.js';
import { operation, type OperationContrat } from './contrat.js';
import { CLE_OPERATION } from './operation.decorator.js';
import { interdit, invalide, jetonInvalide, nonAuthentifie, Probleme } from './probleme.js';
import { erreursChamps, validateurDe } from './validation.js';

@Injectable()
export class InterceptionContrat implements NestInterceptor {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(Jetons) private readonly jetons: Jetons,
    @Inject(BaseDonnees) private readonly bd: BaseDonnees,
    @Inject(Limiteur) private readonly limiteur: Limiteur,
    @Inject(CONFIGURATION) private readonly config: Configuration,
    @Inject(HORLOGE) private readonly horloge: Horloge,
  ) {}

  async intercept(ctx: ExecutionContext, suite: CallHandler): Promise<Observable<unknown>> {
    const id = this.reflector.get<string | undefined>(CLE_OPERATION, ctx.getHandler());
    if (!id) return suite.handle();
    const op = operation(id);
    const req = ctx.switchToHttp().getRequest<RequeteApi>();
    const res = ctx.switchToHttp().getResponse<Response>();

    const appel: Appel = { operation: id, ip: req.ip ?? req.socket.remoteAddress ?? 'inconnue', userAgent: req.get('user-agent') ?? undefined };
    req.appel = appel;

    await this.authentifier(op, req, appel);
    if (op.chemin.startsWith('/public') || op.chemin === '/sante') {
      await this.limiteur.consommer(LIMITES.publicParIp, appel.ip);
    }
    const fichiers = op.corps?.type === 'multipart' && req.is('multipart/form-data')
      ? await lireMultipart(req, res, op.id === 'televerserLogo' ? MAX_OCTETS_LOGO : MAX_OCTETS)
      : [];
    appel.entrees = this.valider(op, req, fichiers);
    return suite.handle();
  }

  // ---- Authentification --------------------------------------------------------

  private async authentifier(op: OperationContrat, req: RequeteApi, appel: Appel): Promise<void> {
    if (op.securite !== 'jetonPersonnel' && op.securite !== 'jetonClient') return;
    const entete = req.get('authorization') ?? '';
    const jeton = /^Bearer\s+(\S+)$/i.exec(entete)?.[1];
    if (!jeton) throw nonAuthentifie();

    if (op.securite === 'jetonClient') {
      const c = await this.jetons.lireClient(jeton);
      if (!c) throw jetonInvalide('Session expirée : demandez un nouveau code');
      const client = await this.bd.enSysteme((tx) => tx.clientFinal.findUnique({
        where: { id: c.clientId }, select: { tenantId: true, banque: { select: { suspendueLe: true } } },
      }));
      if (!client || client.tenantId !== c.tenantId || client.banque.suspendueLe) throw jetonInvalide('Session expirée : demandez un nouveau code');
      appel.client = { id: c.clientId, tenantId: c.tenantId };
      return;
    }

    const a = await this.jetons.lireAcces(jeton);
    if (!a) throw jetonInvalide();
    // L'horloge de l'application, comme pour la signature du jeton (pilotée par les tests)
    const maintenant = this.horloge();
    const [u, session] = await this.bd.enSysteme((tx) => enSerie([
      () => tx.utilisateur.findUnique({
        where: { id: a.utilisateurId },
        select: { id: true, role: true, statut: true, tenantId: true, email: true, nom: true, prenom: true, banque: { select: { suspendueLe: true } } },
      }),
      () => tx.sessionUtilisateur.findFirst({
        where: { famille: a.session, utilisateurId: a.utilisateurId, revoqueLe: null, remplaceLe: null, expireLe: { gt: maintenant } },
        select: { id: true },
      }),
    ]));
    if (!u || !session || u.statut !== 'ACTIF' || u.role !== a.role || u.tenantId !== a.tenantId) throw jetonInvalide();
    if (u.banque?.suspendueLe) throw new Probleme(403, 'BANQUE_SUSPENDUE', 'L\'accès de votre banque est suspendu');
    if (!op.roles.includes(u.role)) throw interdit();
    appel.personnel = { id: u.id, role: u.role, tenantId: u.tenantId, email: u.email, nom: u.nom, prenom: u.prenom, session: a.session };
  }

  // ---- Validation ------------------------------------------------------------------

  private valider(op: OperationContrat, req: RequeteApi, fichiers: FichierRecu[]) {
    const v = validateurDe(op);
    const chemin = { ...(req.params as Record<string, string>) };
    const requete = normaliserRequete(req.query as Record<string, unknown>);
    const entetes = Object.fromEntries(op.parametres.filter((p) => p.dans === 'header')
      .map((p) => [p.nom.toLowerCase(), req.get(p.nom)]).filter(([, val]) => val !== undefined)) as Record<string, string>;
    const erreurs = [
      ...(v.chemin(chemin) ? [] : erreursChamps(v.chemin.errors)),
      ...(v.requete(requete) ? [] : erreursChamps(v.requete.errors)),
      ...(v.entetes(entetes) ? [] : erreursChamps(v.entetes.errors)),
    ];
    // Un identifiant de ressource mal formé ne peut désigner aucune ressource : 404
    if (erreurs.some((e) => ['id', 'pieceId', 'code', 'jetonSuivi', 'fichier'].includes(e.champ)) && op.parametres.some((p) => p.dans === 'path')) {
      throw new Probleme(404, 'INTROUVABLE', 'Ressource introuvable');
    }

    let corps: Record<string, unknown> = {};
    if (op.corps && v.corps) {
      const brut: unknown = req.body;
      const vide = brut === undefined || brut === null || (typeof brut === 'object' && Object.keys(brut as object).length === 0 && !req.is('json'));
      if (op.corps.type === 'multipart' && !req.is('multipart/form-data') && op.corps.requis) {
        throw new Probleme(400, 'VALIDATION', 'Corps multipart/form-data attendu');
      }
      if (vide && !op.corps.requis) {
        corps = {};
      } else {
        corps = (brut && typeof brut === 'object' && !Array.isArray(brut) ? { ...(brut as Record<string, unknown>) } : brut) as Record<string, unknown>;
        if (!v.corps(corps)) erreurs.push(...erreursChamps(v.corps.errors));
      }
      for (const f of fichiers) {
        if (!v.champsFichiers.includes(f.champ)) erreurs.push({ champ: f.champ, message: 'Champ de fichier inattendu' });
      }
      for (const champ of v.fichiersRequis) {
        if (!fichiers.some((f) => f.champ === champ)) erreurs.push({ champ, message: 'Fichier obligatoire' });
      }
    } else if (fichiers.length) {
      erreurs.push({ champ: 'fichiers', message: 'Aucun fichier attendu' });
    }
    if (erreurs.length) throw invalide(erreurs);
    return { chemin, requete, entetes, corps, fichiers };
  }
}

/** Express donne « statut=A&statut=B » en tableau et « statut=A » en texte : Ajv convertit ensuite. */
function normaliserRequete(q: Record<string, unknown>): Record<string, unknown> {
  const res: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(q)) {
    if (v === '' || v === undefined) continue;
    res[k] = v;
  }
  return res;
}
