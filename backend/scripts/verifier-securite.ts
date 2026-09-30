/**
 * Étape 3 — vérification de la sécurité de la base.
 *
 * Deux banques de test sont préparées par le propriétaire des tables, puis l'application
 * s'y connecte avec son propre rôle (reclamations_app) dans chacun des trois contextes :
 * banque, plateforme (Super Admin) et système. Chaque contrôle essaie une lecture ou une
 * écriture légitime ou interdite ; les refus viennent de PostgreSQL lui-même.
 *
 * Lancé par `docker compose run --rm verification` (base jetable reclamations_verif).
 * Variables : DATABASE_URL (propriétaire) et APP_DATABASE_URL (reclamations_app).
 */
import { clientEn, contexte, creerClientBase, transactionEn } from '../src/infrastructure/base-de-donnees/index.js';
import {
  CompteRendu, DELAI_TRANSACTION_VERIFICATION, clientProprietaire, codePublic, creerBanque, creerPlan, donneesReclamation, jeton, priseEnCharge, urlBaseJetable, viderLaBase,
} from './commun.js';

const proprietaire = clientProprietaire();
const base = creerClientBase(urlBaseJetable('APP_DATABASE_URL'), { delaiTransaction: DELAI_TRANSACTION_VERIFICATION });
const cr = new CompteRendu();

function verifier(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  console.log('Étape 3 — sécurité de la base');
  await viderLaBase(proprietaire);

  // --- Données de test, posées par le propriétaire (hors RLS) -----------------------
  const plan = await creerPlan(proprietaire);
  const A = await creerBanque(proprietaire, plan, 'Banque Alpha', 'ALP');
  const B = await creerBanque(proprietaire, plan, 'Banque Beta', 'BET');
  const superAdmin = await proprietaire.utilisateur.create({
    data: { role: 'SUPER_ADMIN', statut: 'ACTIF', email: 'superadmin@makor.test', nom: 'Makor', prenom: 'Super Admin' },
  });
  const reclamationA = await proprietaire.reclamation.create({
    data: { ...donneesReclamation(A, 'ALP-2026-000001'), ...priseEnCharge(A) },
  });
  const reclamationB = await proprietaire.reclamation.create({
    data: { ...donneesReclamation(B, 'BET-2026-000001'), ...priseEnCharge(B) },
  });
  const messageA = await proprietaire.commentaire.create({
    data: { tenantId: A.tenantId, reclamationId: reclamationA.id, type: 'REPONSE_AU_CLIENT', contenu: 'Nous vérifions.', auteurUtilisateurId: A.agent.id },
  });
  const evenementA = await proprietaire.reclamationEvenement.create({
    data: { tenantId: A.tenantId, reclamationId: reclamationA.id, type: 'CREATION', statutApres: 'OUVERTE', acteurType: 'CLIENT', visibleClient: true },
  });
  await proprietaire.notification.createMany({
    data: [
      { tenantId: null, canal: 'IN_APP', modele: 'reclamation.urgente', destinataireUtilisateurId: superAdmin.id, contenu: 'Banque Alpha · ALP-2026-000001 · Carte bancaire · 10:42' },
      { tenantId: A.tenantId, canal: 'EMAIL', modele: 'reclamation.depot', destinataireClientId: A.client.id, reclamationId: reclamationA.id, contenu: 'Réclamation enregistrée' },
      { tenantId: B.tenantId, canal: 'EMAIL', modele: 'reclamation.depot', destinataireClientId: B.client.id, reclamationId: reclamationB.id, contenu: 'Réclamation enregistrée' },
    ],
  });

  const enA = clientEn(base, contexte.banque(A.tenantId));
  const enB = clientEn(base, contexte.banque(B.tenantId));
  const plateforme = clientEn(base, contexte.plateforme());
  const systeme = clientEn(base, contexte.systeme());

  // ----------------------------------------------------------------------------------
  cr.section('Cloisonnement entre banques (Row-Level Security)');

  await cr.doitReussir('En contexte A, la liste des réclamations ne contient que celles de A', async () => {
    const liste = await enA.reclamation.findMany();
    verifier(liste.length === 1 && liste[0].tenantId === A.tenantId, `${liste.length} ligne(s)`);
  });
  await cr.doitReussir('En contexte A, la réclamation de B par son identifiant est « introuvable » (→ 404)', async () => {
    verifier((await enA.reclamation.findUnique({ where: { id: reclamationB.id } })) === null, 'visible');
  });
  await cr.doitReussir('La même lecture en SQL direct (rôle acces_banque, tenant A) ne renvoie rien', async () => {
    const lignes = await transactionEn(base, contexte.banque(A.tenantId), (tx) =>
      tx.$queryRaw<unknown[]>`SELECT * FROM reclamation WHERE id = ${reclamationB.id}::uuid`);
    verifier(lignes.length === 0, `${lignes.length} ligne(s)`);
  });
  await cr.doitReussir('En contexte A, modifier la réclamation de B ne touche aucune ligne', async () => {
    const { count } = await enA.reclamation.updateMany({ where: { id: reclamationB.id }, data: { priorite: 'URGENTE' } });
    verifier(count === 0, `${count} ligne(s) modifiée(s)`);
  });
  await cr.doitEtreRefuse('En contexte A, créer une réclamation au nom de B', '42501', () =>
    enA.reclamation.create({ data: donneesReclamation(B, 'BET-2026-000777') }));
  await cr.doitEtreRefuse('En contexte A, rattacher un client à la banque B', '42501', () =>
    enA.clientFinal.create({ data: { tenantId: B.tenantId, nom: 'Intrus', email: 'intrus@exemple.ci' } }));
  await cr.doitReussir('Personnel de B : ne voit ni les clients, ni le personnel, ni le journal de A', async () => {
    const [clients, personnel, notifs] = await Promise.all([
      enB.clientFinal.findMany(), enB.utilisateur.findMany(), enB.notification.findMany(),
    ]);
    verifier([...clients, ...personnel, ...notifs].every((l) => l.tenantId === B.tenantId), 'fuite');
  });
  await cr.doitReussir('Rôle banque sans tenant renseigné : aucune ligne visible', async () => {
    const lignes = await base.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('role', 'acces_banque', true)`;
      return tx.$queryRaw<unknown[]>`SELECT id FROM reclamation`;
    });
    verifier(lignes.length === 0, `${lignes.length} ligne(s)`);
  });
  await cr.doitEtreRefuse('Requête sans contexte (rôle de connexion seul)', '42501', () => base.reclamation.findMany());
  await cr.doitEtreRefuse('Contexte banque avec un identifiant invalide', /Identifiant de banque invalide/, async () =>
    contexte.banque("x' OR '1'='1"));
  await cr.doitReussir('Le contexte ne déborde pas sur la connexion suivante (réglages locaux à la transaction)', async () => {
    for (let i = 0; i < 20; i++) await enA.reclamation.count();
    const refus = await base.plan.count().then(() => false, () => true);
    verifier(refus, 'la connexion a gardé le rôle de la requête précédente');
  });
  await cr.doitReussir('Garde-fou : chaque table qui porte tenant_id a la RLS active et une politique acces_banque', async () => {
    const manquantes = await proprietaire.$queryRaw<{ table: string }[]>`
      SELECT c.relname AS "table"
        FROM pg_class c JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id'
       WHERE c.relkind = 'r' AND c.relnamespace = 'public'::regnamespace
         AND (NOT c.relrowsecurity OR NOT EXISTS (
               SELECT 1 FROM pg_policies p WHERE p.tablename = c.relname AND 'acces_banque' = ANY (p.roles)))`;
    verifier(manquantes.length === 0, `sans RLS : ${manquantes.map((m) => m.table).join(', ')}`);
  });

  // ----------------------------------------------------------------------------------
  cr.section('Super Admin : métadonnées seulement (arbitrage 7)');

  await cr.doitReussir('Statistiques de toutes les banques (volumes par banque et par statut)', async () => {
    const stats = await plateforme.reclamation.groupBy({ by: ['tenantId', 'statut'], _count: { _all: true } });
    verifier(new Set(stats.map((s) => s.tenantId)).size === 2, 'une banque manque');
  });
  await cr.doitReussir('Liste des réclamations avec numéro, catégorie, statut et date', async () => {
    const liste = await plateforme.reclamation.findMany({ select: { numero: true, categorieId: true, statut: true, creeLe: true } });
    verifier(liste.length === 2, `${liste.length} ligne(s)`);
  });
  await cr.doitEtreRefuse("Lire la description d'une réclamation", '42501', () =>
    plateforme.reclamation.findMany({ select: { numero: true, description: true } }));
  await cr.doitEtreRefuse('Lire une réclamation complète (toutes les colonnes)', '42501', () => plateforme.reclamation.findFirst());
  await cr.doitEtreRefuse('Lire le jeton du lien de suivi', '42501', () =>
    plateforme.reclamation.findMany({ select: { jetonSuivi: true } }));
  await cr.doitEtreRefuse('Lire les coordonnées des clients', '42501', () => plateforme.clientFinal.findMany());
  await cr.doitEtreRefuse('Lire les messages', '42501', () => plateforme.commentaire.findMany());
  await cr.doitEtreRefuse("Lire l'historique détaillé", '42501', () => plateforme.reclamationEvenement.findMany());
  await cr.doitReussir('Ne reçoit que les notifications de la plateforme', async () => {
    const notifs = await plateforme.notification.findMany();
    verifier(notifs.length === 1 && notifs[0].tenantId === null, `${notifs.length} notification(s)`);
  });
  await cr.doitReussir('Facturation SMS (étape 9) : totaux par banque, sans lire un seul SMS', async () => {
    await proprietaire.notification.create({
      data: { tenantId: A.tenantId, canal: 'SMS', modele: 'client.depot', destinataireClientId: A.client.id, destination: '+2250700000001', contenu: 'Réclamation enregistrée', statut: 'ENVOYEE', envoyeeLe: new Date(), segmentsSms: 2 },
    });
    const lignes = await transactionEn(base, contexte.plateforme(), (tx) => tx.$queryRaw<{ tenant_id: string; sms: bigint; segments: bigint }[]>`
      SELECT * FROM facturation_sms(now() - interval '1 day', now() + interval '1 day')`);
    verifier(lignes.length === 1 && lignes[0]!.tenant_id === A.tenantId && Number(lignes[0]!.sms) === 1 && Number(lignes[0]!.segments) === 2, JSON.stringify(lignes, (_, v) => (typeof v === 'bigint' ? Number(v) : v)));
    verifier((await plateforme.notification.count({ where: { canal: 'SMS' } })) === 0, 'SMS lisible par la plateforme');
  });
  await cr.doitEtreRefuse('Une banque appelle la facturation SMS de toutes les banques', '42501', () =>
    transactionEn(base, contexte.banque(A.tenantId), (tx) => tx.$queryRaw`SELECT * FROM facturation_sms(now() - interval '1 day', now())`));
  await cr.doitReussir('Gère les banques : suspension', () =>
    plateforme.banque.update({ where: { id: B.tenantId }, data: { suspendueLe: new Date(), motifSuspension: 'Test' } }));
  await cr.doitEtreRefuse("Écrire dans la chaîne d'audit d'une banque", '42501', () =>
    plateforme.journalAudit.create({ data: { tenantId: A.tenantId, acteurType: 'UTILISATEUR', acteurId: superAdmin.id, action: 'test.intrusion' } }));

  // ----------------------------------------------------------------------------------
  cr.section('Secrets du personnel et colonnes figées');

  await cr.doitReussir('Lister le personnel de A : ni hash de mot de passe ni secret TOTP dans la réponse', async () => {
    const personnel = await enA.utilisateur.findMany();
    verifier(personnel.length === 3 && personnel.every((u) => !('motDePasseHash' in u) && !('totpSecretChiffre' in u)), 'secret exposé');
  });
  await cr.doitEtreRefuse('Demander le hash du mot de passe en contexte banque', '42501', () =>
    enA.utilisateur.findMany({ omit: { motDePasseHash: false } }));
  await cr.doitReussir('Inviter un agent en contexte banque', () =>
    enA.utilisateur.create({ data: { tenantId: A.tenantId, role: 'AGENT', email: 'nouvel.agent@alp.test', nom: 'Nouvel', prenom: 'Agent', superviseurId: A.superviseur.id } }));
  await cr.doitReussir("L'authentification (contexte système) lit le hash", async () => {
    const u = await systeme.utilisateur.findUnique({ where: { email: 'agent@alp.test' }, omit: { motDePasseHash: false } });
    verifier(u?.motDePasseHash?.startsWith('$argon2id$'), 'hash absent');
  });
  await cr.doitEtreRefuse("Modifier le numéro d'un ticket", '42501', () =>
    enA.reclamation.update({ where: { id: reclamationA.id }, data: { numero: 'ALP-2026-999999' } }));
  await cr.doitEtreRefuse("Modifier le délai cible d'un ticket en cours (changement de barème)", '42501', () =>
    enA.reclamation.update({ where: { id: reclamationA.id }, data: { delaiCibleMinutes: 60 } }));
  await cr.doitEtreRefuse('Réécrire la description déposée par le client', '42501', () =>
    enA.reclamation.update({ where: { id: reclamationA.id }, data: { description: 'Autre texte' } }));
  await cr.doitEtreRefuse('Admin Entreprise : changer le préfixe des tickets de sa banque', '42501', () =>
    enA.banque.update({ where: { id: A.tenantId }, data: { prefixeTickets: 'ZZZ' } }));
  await cr.doitReussir('Admin Entreprise : changer les couleurs de son portail', () =>
    enA.banque.update({ where: { id: A.tenantId }, data: { couleurPrimaire: '#0B5FFF' } }));
  await cr.doitEtreRefuse("Changer le code d'un point de dépôt (imprimé sur le QR code)", '42501', () =>
    enA.pointDepot.update({ where: { id: A.pointQr.id }, data: { code: codePublic() } }));

  // ----------------------------------------------------------------------------------
  cr.section('Contraintes CHECK');

  const refusCheck = (libelle: string, fn: () => Promise<unknown>) => cr.doitEtreRefuse(libelle, '23514', fn);
  await refusCheck('Super Admin rattaché à une banque', () =>
    systeme.utilisateur.create({ data: { tenantId: A.tenantId, role: 'SUPER_ADMIN', email: 'sa2@makor.test', nom: 'X', prenom: 'Y' } }));
  await refusCheck('Agent sans banque', () =>
    systeme.utilisateur.create({ data: { role: 'AGENT', email: 'orphelin@makor.test', nom: 'X', prenom: 'Y' } }));
  await refusCheck('Client sans e-mail ni téléphone', () =>
    enA.clientFinal.create({ data: { tenantId: A.tenantId, nom: 'Anonyme' } }));
  await refusCheck('Téléphone hors format international', () =>
    enA.clientFinal.create({ data: { tenantId: A.tenantId, nom: 'X', telephone: '0700000001' } }));
  await refusCheck('E-mail avec majuscules (non normalisé)', () =>
    enA.clientFinal.create({ data: { tenantId: A.tenantId, nom: 'X', email: 'Awa.Kone@Exemple.ci' } }));
  await refusCheck('QR code sans agence (arbitrage 3)', () =>
    enA.pointDepot.create({ data: { tenantId: A.tenantId, code: codePublic(), canal: 'QR_CODE', libelle: 'Sans agence' } }));
  await refusCheck('Numéro de ticket mal formé', () =>
    enA.reclamation.create({ data: donneesReclamation(A, 'ALP-26-42') }));
  await refusCheck('Clôture forcée sans motif (§6.3)', () =>
    enA.reclamation.update({ where: { id: reclamationA.id }, data: { statut: 'CLOTUREE', clotureLe: new Date(), modeCloture: 'FORCEE', clotureParId: A.superviseur.id } }));
  await refusCheck('Statut « Clôturée » sans date de clôture', () =>
    enA.reclamation.update({ where: { id: reclamationA.id }, data: { statut: 'CLOTUREE' } }));
  await refusCheck('Message du client signé par un agent', () =>
    enA.commentaire.create({ data: { tenantId: A.tenantId, reclamationId: reclamationA.id, type: 'MESSAGE_DU_CLIENT', contenu: 'x', auteurUtilisateurId: A.agent.id } }));
  await refusCheck('Message vide', () =>
    enA.commentaire.create({ data: { tenantId: A.tenantId, reclamationId: reclamationA.id, type: 'NOTE_INTERNE', contenu: '   ', auteurUtilisateurId: A.agent.id } }));
  await refusCheck('Plage horaire 18:00 → 08:00', () =>
    enA.horaireOuvre.create({ data: { tenantId: A.tenantId, jourSemaine: 6, debutMinute: 18 * 60, finMinute: 8 * 60 } }));
  await refusCheck('Seuil d\'alerte SLA à 150 %', () =>
    systeme.banque.update({ where: { id: A.tenantId }, data: { seuilAlerteSlaPourcent: 150 } }));
  await refusCheck('Notification de plateforme rattachée à une réclamation (arbitrage 7)', () =>
    systeme.notification.create({ data: { canal: 'IN_APP', modele: 'x', destinataireUtilisateurId: superAdmin.id, reclamationId: reclamationA.id, contenu: 'x' } }));

  // ----------------------------------------------------------------------------------
  cr.section("Journal d'audit chaîné (§6.8)");

  await cr.doitReussir('60 écritures simultanées (A, B, plateforme) : trois chaînes valides, rangs sans trou', async () => {
    await Promise.all(Array.from({ length: 60 }, (_, i) => {
      const cible = i % 3 === 0 ? enA : i % 3 === 1 ? enB : plateforme;
      const tenantId = i % 3 === 0 ? A.tenantId : i % 3 === 1 ? B.tenantId : null;
      return cible.journalAudit.create({ data: { tenantId, acteurType: 'SYSTEME', action: 'test.concurrence', donnees: { i } } });
    }));
    for (const chaine of [`banque:${A.tenantId}`, `banque:${B.tenantId}`, 'plateforme']) {
      const [v] = await proprietaire.$queryRaw<{ valide: boolean; lignes: bigint }[]>`SELECT * FROM verifier_chaine_audit(${chaine})`;
      verifier(v.valide && Number(v.lignes) === 20, `${chaine} : ${JSON.stringify({ ...v, lignes: Number(v.lignes) })}`);
    }
  });
  await cr.doitReussir("Chaîne, rang et empreintes imposés par la base : les valeurs de l'application sont ignorées", async () => {
    const l = await enA.journalAudit.create({
      data: { tenantId: A.tenantId, acteurType: 'UTILISATEUR', acteurId: A.admin.id, action: 'test.forge', chaine: `banque:${B.tenantId}`, rang: 999, empreinte: 'f'.repeat(64) },
    });
    verifier(l.chaine === `banque:${A.tenantId}` && l.rang === 21n && l.empreinte !== 'f'.repeat(64), JSON.stringify({ chaine: l.chaine, rang: String(l.rang) }));
  });
  await cr.doitReussir("L'Admin Entreprise de A vérifie sa chaîne et ne voit rien de celle de B", async () => {
    const [sienne, autre] = await transactionEn(base, contexte.banque(A.tenantId), async (tx) => [
      (await tx.$queryRaw<{ valide: boolean; lignes: bigint }[]>`SELECT * FROM verifier_chaine_audit(${`banque:${A.tenantId}`})`)[0],
      (await tx.$queryRaw<{ valide: boolean; lignes: bigint }[]>`SELECT * FROM verifier_chaine_audit(${`banque:${B.tenantId}`})`)[0],
    ]);
    verifier(sienne.valide && Number(sienne.lignes) === 21 && Number(autre.lignes) === 0, JSON.stringify({ sienne: Number(sienne.lignes), autre: Number(autre.lignes) }));
  });
  await cr.doitEtreRefuse('Modifier une ligne du journal, même en propriétaire des tables', /écriture seule/, () =>
    proprietaire.$executeRaw`UPDATE journal_audit SET action = 'effacee' WHERE rang = 1`);
  await cr.doitEtreRefuse('Supprimer une ligne du journal, même en propriétaire', /écriture seule/, () =>
    proprietaire.$executeRaw`DELETE FROM journal_audit WHERE rang = 1`);
  await cr.doitEtreRefuse('Vider le journal (TRUNCATE), même en propriétaire', /écriture seule/, () =>
    proprietaire.$executeRawUnsafe('TRUNCATE journal_audit'));
  await cr.doitReussir('Une ligne modifiée en contournant les protections est détectée par la vérification', async () => {
    // Simulation d'une altération par un superutilisateur qui désactive les triggers
    await proprietaire.$transaction([
      proprietaire.$executeRawUnsafe('SET LOCAL session_replication_role = replica'),
      proprietaire.$executeRaw`UPDATE journal_audit SET donnees = '{"i": 999}' WHERE chaine = 'plateforme' AND rang = 7`,
    ]);
    const [v] = await proprietaire.$queryRaw<{ valide: boolean; premiere_rupture: bigint }[]>`SELECT * FROM verifier_chaine_audit('plateforme')`;
    verifier(!v.valide && Number(v.premiere_rupture) === 7, JSON.stringify({ valide: v.valide, rupture: Number(v.premiere_rupture) }));
  });

  // ----------------------------------------------------------------------------------
  cr.section('Messages et historique immuables');

  await cr.doitEtreRefuse('Modifier un message envoyé au client (contexte banque)', '42501', () =>
    enA.commentaire.update({ where: { id: messageA.id }, data: { contenu: 'Autre chose' } }));
  await cr.doitEtreRefuse('Modifier un message, même en propriétaire', /écriture seule/, () =>
    proprietaire.commentaire.update({ where: { id: messageA.id }, data: { contenu: 'Autre chose' } }));
  await cr.doitEtreRefuse("Supprimer un événement de l'historique, même en propriétaire", /écriture seule/, () =>
    proprietaire.reclamationEvenement.delete({ where: { id: evenementA.id } }));

  // ----------------------------------------------------------------------------------
  cr.section('Transactions dans un contexte');

  await cr.doitReussir('Dépôt atomique en contexte A : numéro, réclamation et événement', async () => {
    const r = await transactionEn(base, contexte.banque(A.tenantId), async (tx) => {
      const [{ dernier }] = await tx.$queryRaw<{ dernier: number }[]>`
        INSERT INTO compteur_numero (tenant_id, annee, dernier) VALUES (${A.tenantId}::uuid, 2026, 2)
        ON CONFLICT (tenant_id, annee) DO UPDATE SET dernier = compteur_numero.dernier + 1 RETURNING dernier`;
      const numero = `ALP-2026-${String(dernier).padStart(6, '0')}`;
      const reclamation = await tx.reclamation.create({ data: { ...donneesReclamation(A, numero), jetonSuivi: jeton() } });
      await tx.reclamationEvenement.create({
        data: { tenantId: A.tenantId, reclamationId: reclamation.id, type: 'CREATION', statutApres: 'OUVERTE', acteurType: 'CLIENT', visibleClient: true },
      });
      return reclamation;
    });
    verifier(r.numero === 'ALP-2026-000002', r.numero);
  });
  await cr.doitReussir('Échec au milieu du dépôt : rien n\'est écrit', async () => {
    const avant = await enA.reclamation.count();
    await transactionEn(base, contexte.banque(A.tenantId), async (tx) => {
      await tx.reclamation.create({ data: donneesReclamation(A, 'ALP-2026-000500') });
      throw new Error('panne simulée');
    }).catch(() => undefined);
    verifier((await enA.reclamation.count()) === avant, 'réclamation orpheline');
  });
  await cr.doitEtreRefuse('Dans une transaction de A, lire ou écrire chez B reste impossible', '42501', () =>
    transactionEn(base, contexte.banque(A.tenantId), (tx) =>
      tx.commentaire.create({ data: { tenantId: B.tenantId, reclamationId: reclamationB.id, type: 'NOTE_INTERNE', contenu: 'x', auteurUtilisateurId: B.agent.id } })));

  await viderLaBase(proprietaire);
  cr.terminer();
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => Promise.all([proprietaire.$disconnect(), base.$disconnect()]));
