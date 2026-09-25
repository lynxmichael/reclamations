/**
 * Étape 2 — vérification d'intégrité du modèle de données.
 *
 * Crée deux banques de test et tente des écritures légitimes et illégitimes :
 * chaque écriture croisée entre banques doit être refusée par PostgreSQL lui-même
 * (clés étrangères composites), indépendamment du code applicatif.
 *
 * Lancé par `docker compose run --rm verification`, sur la base jetable reclamations_verif
 * (son nom doit contenir « verif » ou « test »), avec le propriétaire des tables.
 */
import {
  CompteRendu, clientProprietaire, codePublic as code, creerBanque, creerPlan, donneesReclamation, jeton, viderLaBase,
} from './commun.js';

const prisma = clientProprietaire();
const cr = new CompteRendu();
const doitReussir = cr.doitReussir.bind(cr);
const doitEtreRefuse = cr.doitEtreRefuse.bind(cr);
const maintenant = new Date();

/** Numérotation atomique, telle que le service de dépôt l'utilisera (étape 7). */
async function prochainNumero(tenantId: string, annee: number) {
  const [ligne] = await prisma.$queryRaw<{ dernier: number }[]>`
    INSERT INTO compteur_numero (tenant_id, annee, dernier) VALUES (${tenantId}::uuid, ${annee}, 1)
    ON CONFLICT (tenant_id, annee) DO UPDATE SET dernier = compteur_numero.dernier + 1
    RETURNING dernier`;
  return ligne.dernier;
}

async function main() {
  console.log('Étape 2 — intégrité du modèle de données');
  await viderLaBase(prisma);

  const plan = await creerPlan(prisma);
  const A = await creerBanque(prisma, plan, 'Banque Alpha', 'ALP');
  const B = await creerBanque(prisma, plan, 'Banque Beta', 'BET');
  const superAdmin = await prisma.utilisateur.create({
    data: { role: 'SUPER_ADMIN', statut: 'ACTIF', email: 'superadmin@makor.test', nom: 'Makor', prenom: 'Super Admin' },
  });

  cr.section('Isolation entre banques (clés étrangères composites)');
  let reclamationA!: { id: string };
  await doitReussir('Réclamation de A avec catégorie, point, agence, client et agent assigné de A', async () => {
    reclamationA = await prisma.reclamation.create({
      data: { ...donneesReclamation(A, 'ALP-2026-000001'), agentId: A.agent.id },
    });
  });
  await doitEtreRefuse('Réclamation de A avec une catégorie de B', 'P2003', () =>
    prisma.reclamation.create({ data: { ...donneesReclamation(A, 'ALP-2026-000901'), categorieId: B.categorie.id } }));
  await doitEtreRefuse('Réclamation de A pour un client de B', 'P2003', () =>
    prisma.reclamation.create({ data: { ...donneesReclamation(A, 'ALP-2026-000902'), clientId: B.client.id } }));
  await doitEtreRefuse('Réclamation de A déposée via un point de dépôt de B', 'P2003', () =>
    prisma.reclamation.create({ data: { ...donneesReclamation(A, 'ALP-2026-000903'), pointDepotId: B.pointQr.id } }));
  await doitEtreRefuse("Assigner un agent de B à une réclamation de A", 'P2003', () =>
    prisma.reclamation.update({ where: { id: reclamationA.id }, data: { agentId: B.agent.id } }));
  await doitEtreRefuse('Escalader une réclamation de A vers un superviseur de B', 'P2003', () =>
    prisma.reclamation.update({ where: { id: reclamationA.id }, data: { escaladeeVersId: B.superviseur.id, escaladeeLe: maintenant } }));
  await doitEtreRefuse("Rattacher un agent de A à un superviseur de B", 'P2003', () =>
    prisma.utilisateur.update({ where: { id: A.agent.id }, data: { superviseurId: B.superviseur.id } }));
  await doitEtreRefuse('Point de dépôt de A rattaché à une agence de B', 'P2003', () =>
    prisma.pointDepot.create({ data: { tenantId: A.tenantId, agenceId: B.agence.id, code: code(), canal: 'QR_CODE', libelle: 'Intrus' } }));
  await doitEtreRefuse('Commentaire marqué banque B sur une réclamation de A', 'P2003', () =>
    prisma.commentaire.create({ data: { tenantId: B.tenantId, reclamationId: reclamationA.id, type: 'NOTE_INTERNE', contenu: 'x', auteurUtilisateurId: B.agent.id } }));
  await doitEtreRefuse("Note interne de A signée par l'agent de B", 'P2003', () =>
    prisma.commentaire.create({ data: { tenantId: A.tenantId, reclamationId: reclamationA.id, type: 'NOTE_INTERNE', contenu: 'x', auteurUtilisateurId: B.agent.id } }));
  await doitEtreRefuse('Pièce jointe de B sur une réclamation de A', 'P2003', () =>
    prisma.pieceJointe.create({
      data: {
        tenantId: B.tenantId, reclamationId: reclamationA.id, nomFichier: 'recu.pdf', typeMime: 'application/pdf',
        tailleOctets: 1024, cleStockage: `test/${jeton()}`, empreinteSha256: 'a'.repeat(64), deposeParType: 'CLIENT',
      },
    }));
  await doitEtreRefuse("Événement de A attribué à l'agent de B", 'P2003', () =>
    prisma.reclamationEvenement.create({
      data: { tenantId: A.tenantId, reclamationId: reclamationA.id, type: 'PRISE_EN_CHARGE', acteurType: 'UTILISATEUR', acteurUtilisateurId: B.agent.id, visibleClient: true },
    }));
  await doitEtreRefuse('Code OTP de A pour un client de B', 'P2003', () =>
    prisma.codeOtp.create({
      data: { tenantId: A.tenantId, clientId: B.client.id, canal: 'SMS', destination: '+2250700000001', codeHash: 'b'.repeat(64), expireLe: maintenant },
    }));
  await doitEtreRefuse('Notification de B sur une réclamation de A', 'P2003', () =>
    prisma.notification.create({ data: { tenantId: B.tenantId, canal: 'EMAIL', modele: 'reclamation.depot', reclamationId: reclamationA.id, contenu: 'x' } }));

  cr.section('Unicités');
  await doitReussir('Même e-mail client dans A et B : deux clients finaux distincts', async () => {
    const n = await prisma.clientFinal.count({ where: { email: 'awa.kone@exemple.ci' } });
    if (n !== 2) throw new Error(`attendu 2, obtenu ${n}`);
  });
  await doitEtreRefuse('Deuxième client avec le même e-mail dans A', 'P2002', () =>
    prisma.clientFinal.create({ data: { tenantId: A.tenantId, nom: 'Homonyme', email: 'awa.kone@exemple.ci' } }));
  await doitEtreRefuse('Deuxième client avec le même téléphone dans A', 'P2002', () =>
    prisma.clientFinal.create({ data: { tenantId: A.tenantId, nom: 'Homonyme', telephone: '+2250700000001' } }));
  await doitEtreRefuse('Numéro de ticket en double dans A', 'P2002', () =>
    prisma.reclamation.create({ data: donneesReclamation(A, 'ALP-2026-000001') }));
  await doitEtreRefuse("Code de point de dépôt déjà utilisé par une autre banque", 'P2002', () =>
    prisma.pointDepot.create({ data: { tenantId: B.tenantId, agenceId: B.agence.id, code: A.pointQr.code, canal: 'QR_CODE', libelle: 'Copie' } }));
  await doitEtreRefuse('Préfixe de tickets déjà pris', 'P2002', () =>
    prisma.banque.create({ data: { nom: 'Copie', slug: 'copie', prefixeTickets: 'ALP', planId: plan.id } }));
  await doitEtreRefuse("E-mail du personnel déjà utilisé dans une autre banque", 'P2002', () =>
    prisma.utilisateur.create({ data: { tenantId: B.tenantId, role: 'AGENT', email: 'agent@alp.test', nom: 'X', prenom: 'Y' } }));
  await doitEtreRefuse('Deux catégories de même nom dans A', 'P2002', () =>
    prisma.categorie.create({ data: { tenantId: A.tenantId, nom: 'Carte bancaire', delaiCibleMinutes: 60 } }));

  cr.section('Comportements attendus');
  await doitReussir('Numérotation atomique : 50 dépôts simultanés dans A → 50 numéros distincts, B repart à 1', async () => {
    const numeros = await Promise.all(Array.from({ length: 50 }, () => prochainNumero(A.tenantId, 2026)));
    const distincts = new Set(numeros);
    if (distincts.size !== 50 || Math.max(...numeros) !== 50) throw new Error(`numéros : ${[...distincts].sort((x, y) => x - y).join(',')}`);
    const premierB = await prochainNumero(B.tenantId, 2026);
    if (premierB !== 1) throw new Error(`B commence à ${premierB}`);
  });
  await doitReussir("Désassigner l'agent (agentId = null) sans toucher tenant_id", async () => {
    const r = await prisma.reclamation.update({ where: { id: reclamationA.id }, data: { agentId: null } });
    if (r.tenantId !== A.tenantId || r.agentId !== null) throw new Error('état inattendu');
    await prisma.reclamation.update({ where: { id: reclamationA.id }, data: { agentId: A.agent.id } });
  });
  await doitReussir('Chronologie : message du client, question, réponse, résolution', async () => {
    const m = await prisma.commentaire.create({ data: { tenantId: A.tenantId, reclamationId: reclamationA.id, type: 'MESSAGE_DU_CLIENT', contenu: 'Toujours rien.' } });
    await prisma.reclamationEvenement.createMany({
      data: [
        { tenantId: A.tenantId, reclamationId: reclamationA.id, type: 'MESSAGE', acteurType: 'CLIENT', visibleClient: true, donnees: { commentaireId: m.id } },
        { tenantId: A.tenantId, reclamationId: reclamationA.id, type: 'QUESTION_AU_CLIENT', statutAvant: 'EN_COURS', statutApres: 'EN_ATTENTE_CLIENT', acteurType: 'UTILISATEUR', acteurUtilisateurId: A.agent.id, visibleClient: true },
        { tenantId: A.tenantId, reclamationId: reclamationA.id, type: 'REPONSE_DU_CLIENT', statutAvant: 'EN_ATTENTE_CLIENT', statutApres: 'EN_COURS', acteurType: 'CLIENT', visibleClient: true },
        { tenantId: A.tenantId, reclamationId: reclamationA.id, type: 'RESOLUTION', statutAvant: 'EN_COURS', statutApres: 'RESOLUE', acteurType: 'UTILISATEUR', acteurUtilisateurId: A.agent.id, visibleClient: true },
      ],
    });
    const n = await prisma.reclamationEvenement.count({ where: { reclamationId: reclamationA.id, visibleClient: true } });
    if (n !== 4) throw new Error(`attendu 4 événements visibles, obtenu ${n}`);
  });
  await doitReussir('Clôture forcée par le superviseur, avec motif', () =>
    prisma.reclamation.create({
      data: {
        ...donneesReclamation(A, 'ALP-2026-000002'), creeLe: maintenant, echeanceSlaLe: null, alertePreventiveLe: null,
        statut: 'CLOTUREE', clotureLe: maintenant, modeCloture: 'FORCEE',
        motifClotureForcee: 'DOUBLON', commentaireCloture: 'Doublon de ALP-2026-000001', clotureParId: A.superviseur.id,
      },
    }));
  await doitReussir('Alerte urgente au Super Admin : notification de plateforme, métadonnées seules', () =>
    prisma.notification.create({
      data: {
        tenantId: null, canal: 'IN_APP', modele: 'reclamation.urgente', destinataireUtilisateurId: superAdmin.id,
        contenu: 'Banque Alpha · ALP-2026-000001 · Carte bancaire · 10:42', cleDeduplication: 'urgente:ALP-2026-000001:superadmin',
      },
    }));
  await doitEtreRefuse("La même alerte ne part pas deux fois (clé de déduplication)", 'P2002', () =>
    prisma.notification.create({
      data: { canal: 'IN_APP', modele: 'reclamation.urgente', destinataireUtilisateurId: superAdmin.id, contenu: 'doublon', cleDeduplication: 'urgente:ALP-2026-000001:superadmin' },
    }));
  await doitReussir('SMS journalisé avec ses segments facturés à la banque', () =>
    prisma.notification.create({
      data: {
        tenantId: A.tenantId, canal: 'SMS', modele: 'reclamation.depot', destinataireClientId: A.client.id, reclamationId: reclamationA.id,
        destination: '+2250700000001', contenu: 'Votre réclamation ALP-2026-000001 est enregistrée.', statut: 'ENVOYEE', tentatives: 1, segmentsSms: 1, envoyeeLe: maintenant,
      },
    }));
  await doitReussir('Lecture relationnelle : tout ce qui entoure la réclamation appartient à A', async () => {
    const r = await prisma.reclamation.findUniqueOrThrow({
      where: { id: reclamationA.id },
      include: { client: true, categorie: true, pointDepot: true, agence: true, agent: { include: { superviseur: true } } },
    });
    const tenants = new Set([r.client.tenantId, r.categorie.tenantId, r.pointDepot.tenantId, r.agence?.tenantId, r.agent?.tenantId, r.agent?.superviseur?.tenantId]);
    if (tenants.size !== 1 || !tenants.has(A.tenantId)) throw new Error('données d’une autre banque');
  });
  await doitEtreRefuse('Suppression physique d’une banque qui a des données', 'P2003', () =>
    prisma.banque.delete({ where: { id: A.tenantId } }));
  await doitEtreRefuse('Suppression physique d’un agent qui a des réclamations', 'P2003', () =>
    prisma.utilisateur.delete({ where: { id: A.agent.id } }));

  await viderLaBase(prisma);
  cr.terminer();
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
