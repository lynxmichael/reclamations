/**
 * Assistant IA (étape 18, décisions I3 à I6 de l'étape 14).
 *
 * - Portail : un tour de l'assistant. L'IA ne fait que trier le dernier message du client, masqué ;
 *   le client ne lit que des textes fixes et les réponses validées par la banque. Il dépose lui-même.
 * - Base de réponses : écrite et validée par l'Admin Entreprise ; les interdits y sont signalés.
 * - Brouillon pour l'agent : description et derniers messages publics, masqués (ni nom, ni
 *   coordonnées, ni notes internes, ni pièces jointes) ; l'agent relit, corrige et envoie lui-même.
 * - Consommation par banque pour Makor, d'après le journal des appels, sans contenu.
 *
 * Fonction ouverte banque par banque par Makor (décision I2), avec le chat web : fermée, ces
 * opérations répondent 403 FONCTION_NON_OUVERTE.
 */
import { Inject, Injectable } from '@nestjs/common';
import { DateTime } from 'luxon';
import { MoteurIa } from '../../application/ia/moteur.js';
import { etat } from '../../application/reclamations/cycle-de-vie.js';
import { chargerParametres, type ParametresBanque } from '../../application/reclamations/parametres.js';
import { disponibilite } from '../../domaine/conversation.js';
import {
  categorieParRegles, decisionParRegles, faqParRegles, presentation, repondre, SUGGESTION_CONSEILLER, SUGGESTION_DEPOT, texteReprise, urgenceParRegles,
  type CategorieAssistant, type CodeMessage, type ContexteAssistant, type Echange, type QuestionFrequente,
} from '../../domaine/ia/assistant.js';
import { brouillonParRegles, consignesBrouillon, consignesTri, type Brouillon, type ContexteRedaction } from '../../domaine/ia/consignes.js';
import { demandeHumain, LIBELLE_INTERDIT, verifierInterdits } from '../../domaine/ia/interdits.js';
import { masquer, mentionneCodeSecret } from '../../domaine/ia/masquage.js';
import { verifierOperation } from '../../domaine/reclamation/machine.js';
import type { StatutReclamation } from '../../generated/prisma/enums.js';
import { journaliser } from '../../infrastructure/audit/journal.js';
import { BaseDonnees, type ClientTransaction } from '../../infrastructure/base-de-donnees/base-de-donnees.service.js';
import { enSerie } from '../../infrastructure/base-de-donnees/index.js';
import { acteurDe, personnelBanque, traceDe, type Appel, type Personnel } from '../../infrastructure/contrat/appel.js';
import { introuvable, Probleme } from '../../infrastructure/contrat/probleme.js';
import { LIMITES, Limiteur } from '../../infrastructure/securite/limiteur.js';
import { HORLOGE, type Horloge } from '../../noyau/noyau.module.js';
import type { S } from '../commun.js';
import { pointPublic } from '../public/public.service.js';

type Moi = Personnel & { tenantId: string };

/** Échanges lus à chaque tour : les plus récents ; un message du client tronqué à 1 000 caractères */
const ECHANGES_LUS = 12;
const LONGUEUR_MESSAGE = 1000;

const LIBELLE_STATUT: Record<StatutReclamation, string> = {
  OUVERTE: 'Ouverte', EN_COURS: 'En cours', EN_ATTENTE_CLIENT: 'En attente du client', RESOLUE: 'Résolue', CLOTUREE: 'Clôturée',
};

const fonctionFermee = () => new Probleme(403, 'FONCTION_NON_OUVERTE', 'L\'assistant IA n\'est pas ouvert à votre banque : adressez-vous à Makor');

export const alertes = (texte: string): S<'AlerteInterdit'>[] =>
  verifierInterdits(texte).map((a) => ({ code: a.code, libelle: LIBELLE_INTERDIT[a.code], extrait: a.extrait }));

type LigneReponse = { id: string; question: string; reponse: string; active: boolean; ordre: number; modifieLe: Date };
const vueReponse = (r: LigneReponse): S<'ReponseBanque'> =>
  ({ id: r.id, question: r.question, reponse: r.reponse, active: r.active, ordre: r.ordre, alertes: alertes(r.reponse), modifieLe: r.modifieLe.toISOString() });

export async function baseDeReponses(tx: ClientTransaction): Promise<{ faq: QuestionFrequente[]; categories: CategorieAssistant[] }> {
  const [faq, categories] = await enSerie([
    () => tx.reponseAssistant.findMany({ where: { active: true }, orderBy: [{ ordre: 'asc' }, { creeLe: 'asc' }], select: { id: true, question: true, reponse: true } }),
    () => tx.categorie.findMany({ where: { active: true }, orderBy: [{ ordre: 'asc' }, { nom: 'asc' }], select: { id: true, nom: true, description: true } }),
  ]);
  return { faq, categories };
}

@Injectable()
export class ServiceAssistant {
  constructor(
    @Inject(BaseDonnees) private readonly bd: BaseDonnees,
    @Inject(MoteurIa) private readonly moteur: MoteurIa,
    @Inject(Limiteur) private readonly limiteur: Limiteur,
    @Inject(HORLOGE) private readonly horloge: Horloge,
  ) {}

  // ---- Portail ----------------------------------------------------------------------

  async converser(code: string, corps: { echanges: { auteur: 'CLIENT' | 'ASSISTANT'; texte?: string; code?: CodeMessage }[] }, appel: Appel): Promise<S<'ReponseAssistant'>> {
    const point = await pointPublic(this.bd, code);
    const maintenant = this.horloge();
    const ctx = await this.bd.enBanque(point.tenantId, async (tx): Promise<ContexteAssistant> => {
      const p = await chargerParametres(tx, point.tenantId);
      if (!p.banque.assistantIa) throw new Probleme(403, 'FONCTION_NON_OUVERTE', 'L\'assistant n\'est pas ouvert sur ce portail');
      const d = disponibilite(maintenant, p.sla.calendrier);
      return {
        banque: p.banque.nom,
        ...(await baseDeReponses(tx)),
        ouverte: d.ouverte,
        reprise: d.repriseLe ? texteReprise(d.repriseLe, maintenant, p.banque.fuseauHoraire) : null,
      };
    });

    // Le portail renvoie l'historique : on ne garde que les derniers échanges, et pour l'assistant son code
    const echanges: Echange[] = corps.echanges.slice(-ECHANGES_LUS).flatMap((e): Echange[] => {
      if (e.auteur === 'ASSISTANT') return e.code ? [{ auteur: 'ASSISTANT', texte: '', code: e.code }] : [];
      const texte = (e.texte ?? '').trim().slice(0, LONGUEUR_MESSAGE);
      return texte ? [{ auteur: 'CLIENT', texte }] : [];
    });
    const dernier = echanges.at(-1);
    if (dernier?.auteur !== 'CLIENT') {
      return { messages: [presentation(ctx.banque)], proposition: null, suggestions: [SUGGESTION_DEPOT, SUGGESTION_CONSEILLER] };
    }

    await this.limiteur.consommer(LIMITES.assistantParIp, appel.ip ?? 'inconnue', 'Trop de messages à l\'assistant : réessayez dans quelques minutes, ou écrivez « conseiller »');
    const masque = masquer(dernier.texte);
    const codeSecret = masque.codeSecret || mentionneCodeSecret(dernier.texte);
    // « conseiller » transfère toujours (décision I3) : sans IA, la règle suffit
    const humain = demandeHumain(dernier.texte);
    const pourIa = echanges.map((e) => (e.auteur === 'CLIENT' ? { ...e, texte: masquer(e.texte).texte } : e));
    const { resultat } = await this.moteur.demander(point.tenantId, 'ACCUEIL_PORTAIL', humain ? null : consignesTri(pourIa, ctx), () => decisionParRegles(echanges, ctx));
    const decision = humain ? { ...resultat, intention: 'CONSEILLER' as const } : resultat;
    const r = repondre(decision, echanges, ctx, codeSecret);
    return {
      messages: r.messages.map((m) => ({ code: m.code, texte: m.texte })),
      proposition: r.proposition ? { motif: r.proposition.motif, categorieId: r.proposition.categorieId, description: r.proposition.description } : null,
      suggestions: [...r.suggestions],
    };
  }

  // ---- Base de réponses ---------------------------------------------------------------

  private dans<T>(appel: Appel, travail: (tx: ClientTransaction, moi: Moi, p: ParametresBanque) => Promise<T>): Promise<T> {
    const moi = personnelBanque(appel);
    return this.bd.enBanque(moi.tenantId, async (tx) => {
      const p = await chargerParametres(tx, moi.tenantId);
      if (!p.banque.assistantIa) throw fonctionFermee();
      return travail(tx, moi, p);
    });
  }

  private audit(tx: ClientTransaction, moi: Moi, appel: Appel, action: string, entite: string, entiteId: string, donnees?: Record<string, unknown>) {
    return journaliser(tx, { tenantId: moi.tenantId, acteur: moi, action, entite, entiteId, donnees, trace: traceDe(appel) });
  }

  listerReponses(appel: Appel): Promise<S<'ReponseBanque'>[]> {
    return this.dans(appel, async (tx) =>
      (await tx.reponseAssistant.findMany({ orderBy: [{ ordre: 'asc' }, { creeLe: 'asc' }] })).map(vueReponse));
  }

  creerReponse(appel: Appel, c: { question: string; reponse: string; active?: boolean; ordre?: number }): Promise<S<'ReponseBanque'>> {
    return this.dans(appel, async (tx, moi) => {
      const r = await tx.reponseAssistant.create({
        data: { tenantId: moi.tenantId, question: c.question.trim(), reponse: c.reponse.trim(), active: c.active ?? true, ordre: c.ordre ?? 0 },
      });
      await this.audit(tx, moi, appel, 'parametrage.reponse_assistant_creee', 'reponse_assistant', r.id, { active: r.active, alertes: alertes(r.reponse).map((a) => a.code) });
      return vueReponse(r);
    });
  }

  modifierReponse(appel: Appel, id: string, m: Partial<{ question: string; reponse: string; active: boolean; ordre: number }>): Promise<S<'ReponseBanque'>> {
    return this.dans(appel, async (tx, moi) => {
      if (!(await tx.reponseAssistant.findUnique({ where: { id }, select: { id: true } }))) throw introuvable('Réponse introuvable');
      const r = await tx.reponseAssistant.update({
        where: { id },
        data: { ...m, ...(m.question !== undefined ? { question: m.question.trim() } : {}), ...(m.reponse !== undefined ? { reponse: m.reponse.trim() } : {}) },
      });
      await this.audit(tx, moi, appel, 'parametrage.reponse_assistant_modifiee', 'reponse_assistant', id, { champs: Object.keys(m), alertes: alertes(r.reponse).map((a) => a.code) });
      return vueReponse(r);
    });
  }

  supprimerReponse(appel: Appel, id: string): Promise<void> {
    return this.dans(appel, async (tx, moi) => {
      const { count } = await tx.reponseAssistant.deleteMany({ where: { id } });
      if (!count) throw introuvable('Réponse introuvable');
      await this.audit(tx, moi, appel, 'parametrage.reponse_assistant_supprimee', 'reponse_assistant', id);
    });
  }

  // ---- Brouillon pour l'agent -----------------------------------------------------------

  async suggerer(appel: Appel, id: string): Promise<S<'SuggestionReponse'>> {
    const moi = personnelBanque(appel);
    await this.limiteur.consommer(LIMITES.suggestionsParUtilisateur, moi.id, 'Trop de brouillons demandés : réessayez dans quelques minutes');
    const lu = await this.dans(appel, async (tx, _moi, p) => {
      const t = await tx.reclamation.findUnique({
        where: { id },
        select: {
          id: true, statut: true, agentId: true, clientId: true, clotureAutoPrevueLe: true, description: true, priorite: true,
          categorie: { select: { id: true, nom: true } },
          client: { select: { nom: true } },
          agent: { select: { nom: true, prenom: true } },
          // Messages publics seulement : jamais les notes internes
          commentaires: { where: { type: { in: ['REPONSE_AU_CLIENT', 'MESSAGE_DU_CLIENT'] } }, orderBy: [{ creeLe: 'desc' }, { id: 'desc' }], take: 6, select: { type: true, contenu: true } },
        },
      });
      if (!t || !verifierOperation('CONSULTER', etat(t), acteurDe(appel)).ok) throw introuvable('Réclamation introuvable');
      if (t.statut === 'CLOTUREE') throw new Probleme(409, 'RECLAMATION_CLOTUREE', 'Cette réclamation est clôturée : plus de réponse à rédiger');
      return { t, banque: p.banque.nom, base: await baseDeReponses(tx) };
    });
    const { t, base } = lu;
    const noms = [t.client.nom, ...(t.agent ? [t.agent.prenom, t.agent.nom] : [])];
    const cacher = (texte: string) => masquer(texte, { noms }).texte;
    const messages = [...t.commentaires].reverse().map((c) => ({ auteur: c.type === 'MESSAGE_DU_CLIENT' ? 'CLIENT' as const : 'BANQUE' as const, texte: cacher(c.contenu) }));
    const redaction: ContexteRedaction = {
      banque: lu.banque, categorie: t.categorie.nom, statut: LIBELLE_STATUT[t.statut], description: cacher(t.description), messages, ...base,
    };
    const textesClient = [t.description, ...t.commentaires.filter((c) => c.type === 'MESSAGE_DU_CLIENT').map((c) => c.contenu)].join('\n');
    const repli = (): Brouillon => {
      const proche = faqParRegles(textesClient, base.faq);
      return {
        ...brouillonParRegles(redaction, proche ? base.faq.find((f) => f.id === proche.id) ?? null : null),
        categorieId: categorieParRegles(textesClient, base.categories),
        urgente: urgenceParRegles(textesClient),
      };
    };
    const { resultat, source } = await this.moteur.demander(moi.tenantId, 'SUGGESTION_AGENT', consignesBrouillon(redaction), repli);
    const categorie = resultat.categorieId && resultat.categorieId !== t.categorie.id ? base.categories.find((c) => c.id === resultat.categorieId) : undefined;
    const suggestion: S<'SuggestionReponse'> = {
      brouillon: resultat.brouillon,
      alertes: alertes(resultat.brouillon),
      categorie: categorie ? { id: categorie.id, nom: categorie.nom } : null,
      urgente: resultat.urgente && t.priorite !== 'URGENTE',
      source,
    };
    // Journal : qui a demandé un brouillon, d'où il vient et ses alertes ; jamais le texte
    await this.bd.enBanque(moi.tenantId, (tx) => this.audit(tx, moi, appel, 'reclamation.brouillon_demande', 'reclamation', t.id, {
      source, alertes: suggestion.alertes.map((a) => a.code),
    }));
    return suggestion;
  }

  // ---- Consommation (Super Admin) ----------------------------------------------------------

  /** Usage d'un mois civil (temps universel), par banque, d'après le journal des appels. */
  consommation(mois: string): Promise<S<'ConsommationIa'>> {
    const debut = DateTime.fromISO(`${mois}-01T00:00:00`, { zone: 'utc' });
    const fin = debut.plus({ months: 1 });
    return this.bd.enPlateforme(async (tx) => {
      const [lignes] = await enSerie([
        () => tx.$queryRaw<{ tenant_id: string; finalite: string; issue: string; appels: number; entree: bigint; sortie: bigint; cout: bigint }[]>`
          SELECT tenant_id, finalite::text, issue::text, count(*)::int AS appels,
                 coalesce(sum(jetons_entree), 0)::bigint AS entree, coalesce(sum(jetons_sortie), 0)::bigint AS sortie,
                 coalesce(sum(cout_micro_usd), 0)::bigint AS cout
          FROM appel_ia WHERE cree_le >= ${debut.toJSDate()} AND cree_le < ${fin.toJSDate()}
          GROUP BY 1, 2, 3`,
      ]);
      // Les banques existant à la fin du mois, et celles qui ont des appels ce mois-là
      const banques = await tx.banque.findMany({
        where: { OR: [{ creeLe: { lt: fin.toJSDate() } }, { id: { in: [...new Set(lignes.map((l) => l.tenant_id))] } }] },
        select: { id: true, nom: true, assistantIa: true },
        orderBy: { nom: 'asc' },
      });
      return {
        mois,
        fournisseur: this.moteur.configure,
        banques: banques.map((b) => {
          const siennes = lignes.filter((l) => l.tenant_id === b.id);
          const somme = (f: (l: (typeof siennes)[number]) => number) => siennes.reduce((n, l) => n + f(l), 0);
          return {
            banque: { id: b.id, nom: b.nom },
            assistantIa: b.assistantIa,
            tours: somme((l) => (l.finalite === 'ACCUEIL_PORTAIL' ? l.appels : 0)),
            suggestions: somme((l) => (l.finalite === 'SUGGESTION_AGENT' ? l.appels : 0)),
            barometres: somme((l) => (l.finalite === 'BAROMETRE' ? l.appels : 0)),
            parIa: somme((l) => (l.issue === 'OK' ? l.appels : 0)),
            regles: somme((l) => (l.issue === 'OK' ? 0 : l.appels)),
            jetonsEntree: somme((l) => Number(l.entree)),
            jetonsSortie: somme((l) => Number(l.sortie)),
            // Millionièmes de dollar → dollars
            coutUsd: somme((l) => Number(l.cout)) / 1_000_000,
          };
        }),
      };
    });
  }
}
