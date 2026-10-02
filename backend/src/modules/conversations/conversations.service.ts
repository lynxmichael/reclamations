/**
 * Boîte de réception des agents (étape 17) : conversations des réclamations visibles, lecture,
 * marque « lue ». L'agent ne voit que les conversations de ses réclamations (décision A5) ; le
 * superviseur et l'Admin Entreprise, toutes. Une conversation hors de portée répond 404.
 *
 * Fonction ouverte banque par banque par Makor (décision I2) : fermée, ces opérations répondent
 * 403 FONCTION_NON_OUVERTE. On répond depuis la boîte avec repondreAuClient, comme depuis la fiche.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { Prisma, StatutReclamation } from '../../generated/prisma/client.js';
import { etat } from '../../application/reclamations/cycle-de-vie.js';
import { lectureBanque } from '../../application/reclamations/conversations.js';
import { chargerParametres } from '../../application/reclamations/parametres.js';
import { clientEnLigne, extrait, nonLueParLaBanque, reponseDue, type EtatConversation } from '../../domaine/conversation.js';
import { verifierOperation } from '../../domaine/reclamation/machine.js';
import { BaseDonnees, type ClientTransaction } from '../../infrastructure/base-de-donnees/base-de-donnees.service.js';
import { enSerie } from '../../infrastructure/base-de-donnees/index.js';
import { acteurDe, personnelBanque, type Appel, type Personnel } from '../../infrastructure/contrat/appel.js';
import { introuvable, Probleme } from '../../infrastructure/contrat/probleme.js';
import { HORLOGE, type Horloge } from '../../noyau/noyau.module.js';
import { pageDe, pagination, type S } from '../commun.js';
import { INCLUSION_MESSAGE, iso, messagePersonnel, nomComplet, operationsPossibles } from '../reclamations/lecture.js';

type Moi = Personnel & { tenantId: string };
type Where = Prisma.ConversationWhereInput;

/** On ne répond plus à une réclamation résolue ou clôturée : elle sort de « À répondre » (domaine, reponseDue). */
const OUVERTES: StatutReclamation[] = ['OUVERTE', 'EN_COURS', 'EN_ATTENTE_CLIENT'];

const RECLAMATION = {
  select: {
    id: true, numero: true, statut: true, priorite: true, agentId: true, clientId: true, clotureAutoPrevueLe: true,
    description: true, creeLe: true,
    categorie: { select: { nom: true } },
    agent: { select: { id: true, nom: true, prenom: true } },
    client: { select: { nom: true } },
  },
} as const;

type ReclamationLue = Prisma.ReclamationGetPayload<typeof RECLAMATION>;

const enConversation = (r: ReclamationLue): S<'ReclamationEnConversation'> =>
  ({ id: r.id, numero: r.numero, statut: r.statut, priorite: r.priorite, categorie: r.categorie.nom });

@Injectable()
export class ServiceConversations {
  constructor(
    @Inject(BaseDonnees) private readonly bd: BaseDonnees,
    @Inject(HORLOGE) private readonly horloge: Horloge,
  ) {}

  /** Transaction de la banque de l'appelant, le chat devant être ouvert par Makor. */
  private dans<T>(appel: Appel, travail: (tx: ClientTransaction, moi: Moi) => Promise<T>): Promise<T> {
    const moi = personnelBanque(appel);
    return this.bd.enBanque(moi.tenantId, async (tx) => {
      const p = await chargerParametres(tx, moi.tenantId);
      if (!p.banque.chatWeb) {
        throw new Probleme(403, 'FONCTION_NON_OUVERTE', 'Le chat web n\'est pas ouvert à votre banque : adressez-vous à Makor');
      }
      return travail(tx, moi);
    });
  }

  async lister(appel: Appel, q: Record<string, unknown>): Promise<S<'PageConversations'>> {
    const maintenant = this.horloge();
    const { page, parPage, skip, take } = pagination(q);
    return this.dans(appel, async (tx, moi) => {
      const champs = tx.conversation.fields;
      // Le client a écrit ; l'agent ne voit que ses réclamations
      const visibles: Where = {
        dernierMessageClientLe: { not: null },
        ...(moi.role === 'AGENT' ? { reclamation: { agentId: moi.id } } : {}),
      };
      const aRepondreW: Where = {
        reclamation: { statut: { in: OUVERTES } },
        OR: [{ dernierMessageBanqueLe: null }, { dernierMessageBanqueLe: { lt: champs.dernierMessageClientLe } }],
      };
      const nonLuesW: Where = { OR: [{ luBanqueLe: null }, { luBanqueLe: { lt: champs.dernierMessageClientLe } }] };
      const filtre = String(q.filtre ?? 'a-repondre');
      const where: Where = { AND: [visibles, filtre === 'a-repondre' ? aRepondreW : filtre === 'non-lues' ? nonLuesW : {}] };
      const orderBy: Prisma.ConversationOrderByWithRelationInput[] = filtre === 'a-repondre'
        ? [{ dernierMessageClientLe: 'asc' }, { id: 'asc' }]
        : [{ dernierMessageClientLe: 'desc' }, { id: 'desc' }];

      const [total, lignes, nbARepondre, nbNonLues] = await enSerie([
        () => tx.conversation.count({ where }),
        () => tx.conversation.findMany({
          where, orderBy, skip, take,
          include: {
            reclamation: {
              select: {
                ...RECLAMATION.select,
                commentaires: {
                  where: { type: { not: 'NOTE_INTERNE' } }, orderBy: [{ creeLe: 'desc' }, { id: 'desc' }], take: 1,
                  select: { contenu: true, type: true, creeLe: true },
                },
              },
            },
          },
        }),
        () => tx.conversation.count({ where: { AND: [visibles, aRepondreW] } }),
        () => tx.conversation.count({ where: { AND: [visibles, nonLuesW] } }),
      ]);

      return {
        ...pageDe(lignes.map((c) => {
          const r = c.reclamation;
          const dernier = r.commentaires[0];
          return {
            id: c.id,
            canal: c.canal,
            reclamation: enConversation(r),
            client: { nom: r.client.nom },
            agent: r.agent ? { id: r.agent.id, nom: nomComplet(r.agent) } : null,
            dernierMessage: dernier
              ? { extrait: extrait(dernier.contenu), auteur: dernier.type === 'MESSAGE_DU_CLIENT' ? 'CLIENT' as const : 'BANQUE' as const, date: dernier.creeLe.toISOString() }
              : { extrait: extrait(r.description), auteur: 'CLIENT' as const, date: r.creeLe.toISOString() },
            ...drapeaux(c, r.statut, maintenant),
          };
        }), page, parPage, total),
        compteurs: { aRepondre: nbARepondre, nonLues: nbNonLues },
      };
    });
  }

  /** Une conversation visible de l'appelant, avec sa réclamation ; sinon 404. */
  private async charger(tx: ClientTransaction, appel: Appel, id: string) {
    const c = await tx.conversation.findUnique({ where: { id }, include: { reclamation: RECLAMATION } });
    if (!c || !verifierOperation('CONSULTER', etat(c.reclamation), acteurDe(appel)).ok) throw introuvable('Conversation introuvable');
    return c;
  }

  lire(appel: Appel, id: string): Promise<S<'ConversationDetail'>> {
    const maintenant = this.horloge();
    return this.dans(appel, async (tx) => {
      const c = await this.charger(tx, appel, id);
      const r = c.reclamation;
      const messages = await tx.commentaire.findMany({
        where: { reclamationId: r.id, type: { not: 'NOTE_INTERNE' } },
        orderBy: [{ creeLe: 'asc' }, { id: 'asc' }],
        include: INCLUSION_MESSAGE,
      });
      return {
        id: c.id,
        canal: c.canal,
        reclamation: enConversation(r),
        client: { nom: r.client.nom },
        agent: r.agent ? { id: r.agent.id, nom: nomComplet(r.agent) } : null,
        description: r.description,
        deposeeLe: r.creeLe.toISOString(),
        messages: messages.map(messagePersonnel),
        ...drapeaux(c, r.statut, maintenant),
        luParLeClientLe: iso(c.luClientLe),
        operationsPossibles: operationsPossibles(etat(r), acteurDe(appel)),
      };
    });
  }

  /** Lecture par la banque : l'agent assigné, ou un superviseur si la réclamation n'est pas assignée ; sinon sans effet. */
  async marquerLue(appel: Appel, id: string): Promise<void> {
    await this.dans(appel, async (tx, moi) => {
      const c = await this.charger(tx, appel, id);
      await lectureBanque(tx, c.id, moi, c.reclamation.agentId, this.horloge());
    });
  }
}

function drapeaux(c: EtatConversation, statut: StatutReclamation, maintenant: Date) {
  return { aRepondre: reponseDue(c, statut), nonLue: nonLueParLaBanque(c), clientEnLigne: clientEnLigne(c, maintenant) };
}
