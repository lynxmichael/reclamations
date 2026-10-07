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
  cr.section('Enquêtes de satisfaction (étape 15)');

  const ouverture = new Date();
  const fin = new Date(ouverture.getTime() + 7 * 24 * 3600 * 1000);
  const enqueteA = await enA.enqueteSatisfaction.create({
    data: { tenantId: A.tenantId, reclamationId: reclamationA.id, creeLe: ouverture, expireLe: fin },
  });
  await proprietaire.enqueteSatisfaction.create({
    data: { tenantId: B.tenantId, reclamationId: reclamationB.id, creeLe: ouverture, expireLe: fin, reponduLe: ouverture, note: 2, recommandation: 3, commentaire: 'Avis de B' },
  });
  await cr.doitReussir('En contexte A, une seule enquête visible : celle de A', async () => {
    const liste = await enA.enqueteSatisfaction.findMany();
    verifier(liste.length === 1 && liste[0]!.tenantId === A.tenantId, `${liste.length} ligne(s)`);
  });
  await cr.doitEtreRefuse('En contexte A, ouvrir une enquête sur une réclamation de B', '42501', () =>
    enA.enqueteSatisfaction.create({ data: { tenantId: B.tenantId, reclamationId: reclamationB.id, creeLe: ouverture, expireLe: fin } }));
  await cr.doitEtreRefuse("Repousser la fin d'une enquête (expire_le)", '42501', () =>
    enA.enqueteSatisfaction.update({ where: { id: enqueteA.id }, data: { expireLe: new Date(fin.getTime() + 86_400_000) } }));
  await cr.doitReussir('Le client répond une fois (contexte banque)', () =>
    enA.enqueteSatisfaction.update({ where: { id: enqueteA.id }, data: { reponduLe: new Date(), note: 4, recommandation: 9, commentaire: 'Merci' } }));
  await cr.doitEtreRefuse('Changer une réponse déjà donnée', '23514', () =>
    enA.enqueteSatisfaction.update({ where: { id: enqueteA.id }, data: { note: 5 } }));
  await cr.doitEtreRefuse('Changer une réponse, même en propriétaire des tables', '23514', () =>
    proprietaire.enqueteSatisfaction.update({ where: { id: enqueteA.id }, data: { commentaire: 'Autre avis' } }));
  await cr.doitEtreRefuse('Supprimer une enquête (contexte banque)', '42501', () =>
    enA.enqueteSatisfaction.delete({ where: { id: enqueteA.id } }));
  await refusCheck('Note hors bornes (6 sur 5)', () =>
    proprietaire.enqueteSatisfaction.create({ data: { tenantId: A.tenantId, reclamationId: reclamationA.id, creeLe: ouverture, expireLe: fin, reponduLe: ouverture, note: 6, recommandation: 5 } }));
  await refusCheck('Réponse incomplète (note sans recommandation)', () =>
    proprietaire.enqueteSatisfaction.create({ data: { tenantId: A.tenantId, reclamationId: reclamationA.id, creeLe: ouverture, expireLe: fin, reponduLe: ouverture, note: 3 } }));
  await cr.doitReussir('Super Admin : notes de toutes les banques pour ses totaux', async () => {
    const notes = await plateforme.enqueteSatisfaction.findMany({ select: { tenantId: true, note: true, recommandation: true } });
    verifier(notes.length === 2 && new Set(notes.map((n) => n.tenantId)).size === 2, `${notes.length} ligne(s)`);
  });
  await cr.doitEtreRefuse('Super Admin : lire le commentaire d\'un client', '42501', () =>
    plateforme.enqueteSatisfaction.findMany({ select: { commentaire: true } }));
  await cr.doitEtreRefuse('Super Admin : modifier une enquête', '42501', () =>
    plateforme.enqueteSatisfaction.updateMany({ data: { note: 1 } }));
  await cr.doitEtreRefuse('Contexte système (worker, authentification) : aucun accès aux enquêtes', '42501', () =>
    systeme.enqueteSatisfaction.count());

  // ----------------------------------------------------------------------------------
  cr.section('Attribution et escalade automatiques (étape 16)');

  const groupeA = await enA.groupeAgents.create({ data: { tenantId: A.tenantId, nom: 'Monétique' } });
  const groupeB = await proprietaire.groupeAgents.create({ data: { tenantId: B.tenantId, nom: 'Monétique' } });
  await proprietaire.groupeAgentsMembre.create({ data: { tenantId: B.tenantId, groupeId: groupeB.id, utilisateurId: B.agent.id } });
  await cr.doitReussir('En contexte A : un groupe et son agent', () =>
    enA.groupeAgentsMembre.create({ data: { tenantId: A.tenantId, groupeId: groupeA.id, utilisateurId: A.agent.id } }));
  await cr.doitReussir('En contexte A, seuls les groupes et membres de A sont visibles', async () => {
    const [g, m] = [await enA.groupeAgents.findMany(), await enA.groupeAgentsMembre.findMany()];
    verifier(g.length === 1 && m.length === 1 && g[0]!.tenantId === A.tenantId && m[0]!.tenantId === A.tenantId, `${g.length} groupe(s), ${m.length} membre(s)`);
  });
  await cr.doitEtreRefuse('En contexte A, mettre un agent de B dans un groupe', '42501', () =>
    enA.groupeAgentsMembre.create({ data: { tenantId: B.tenantId, groupeId: groupeB.id, utilisateurId: B.agent.id } }));
  await cr.doitEtreRefuse('Un groupe de A avec un agent de B (clé étrangère par banque)', '23503', () =>
    proprietaire.groupeAgentsMembre.create({ data: { tenantId: A.tenantId, groupeId: groupeA.id, utilisateurId: B.agent.id } }));
  await cr.doitEtreRefuse('Confier une catégorie de A au groupe de B (clé étrangère par banque)', '23503', () =>
    enA.categorie.update({ where: { id: A.categorie.id }, data: { groupeId: groupeB.id } }));
  await cr.doitEtreRefuse('En contexte A, déclarer absent un agent de B', '42501', () =>
    enA.absenceAgent.create({ data: { tenantId: B.tenantId, utilisateurId: B.agent.id, du: new Date('2026-11-09'), au: new Date('2026-11-10') } }));
  const absenceA = await enA.absenceAgent.create({ data: { tenantId: A.tenantId, utilisateurId: A.agent.id, du: new Date('2026-11-09'), au: new Date('2026-11-10') } });
  await cr.doitEtreRefuse('Modifier une absence (on la retire et on en déclare une autre)', '42501', () =>
    enA.absenceAgent.update({ where: { id: absenceA.id }, data: { au: new Date('2026-12-31') } }));
  await refusCheck('Absence qui finit avant de commencer', () =>
    proprietaire.absenceAgent.create({ data: { tenantId: A.tenantId, utilisateurId: A.agent.id, du: new Date('2026-11-10'), au: new Date('2026-11-09') } }));
  await refusCheck('Absence de plus d\'un an', () =>
    proprietaire.absenceAgent.create({ data: { tenantId: A.tenantId, utilisateurId: A.agent.id, du: new Date('2026-01-01'), au: new Date('2027-06-30') } }));
  await cr.doitEtreRefuse('L\'Admin Entreprise ouvre lui-même la fonction (réservé au Super Admin)', '42501', () =>
    enA.banque.update({ where: { id: A.tenantId }, data: { attributionAutomatique: true } }));
  await refusCheck('Mode automatique alors que la fonction est fermée', () =>
    enA.banque.update({ where: { id: A.tenantId }, data: { modeAttribution: 'AUTOMATIQUE' } }));
  await cr.doitReussir('Fonction ouverte par le Super Admin : l\'Admin Entreprise choisit le mode et les seuils', async () => {
    await plateforme.banque.update({ where: { id: A.tenantId }, data: { attributionAutomatique: true } });
    await enA.banque.update({ where: { id: A.tenantId }, data: { modeAttribution: 'AUTOMATIQUE', seuilEscaladeAdminPourcent: 150 } });
  });
  await refusCheck('Seuil d\'escalade avant l\'échéance (100 %)', () =>
    enA.categorie.update({ where: { id: A.categorie.id }, data: { seuilEscaladeAdminPourcent: 100 } }));
  await refusCheck('Escalade à l\'Admin Entreprise sans dépassement signalé', () =>
    enA.reclamation.update({ where: { id: reclamationA.id }, data: { escaladeeAdminLe: new Date() } }));
  await cr.doitReussir('Attribution : la date de la dernière attribution d\'un agent (contexte A)', () =>
    enA.utilisateur.updateMany({ where: { id: A.agent.id }, data: { derniereAttributionLe: new Date() } }));
  await cr.doitEtreRefuse('Super Admin : lire les groupes d\'une banque', '42501', () => plateforme.groupeAgents.count());
  await cr.doitEtreRefuse('Contexte système : aucun accès aux absences', '42501', () => systeme.absenceAgent.count());

  // ----------------------------------------------------------------------------------
  cr.section('Conversations et chat web (étape 17)');

  const conversationA = await enA.conversation.create({ data: { tenantId: A.tenantId, reclamationId: reclamationA.id, luClientLe: new Date() } });
  await proprietaire.conversation.create({ data: { tenantId: B.tenantId, reclamationId: reclamationB.id, dernierMessageClientLe: new Date() } });
  await cr.doitReussir('En contexte A, une seule conversation visible : celle de A', async () => {
    const liste = await enA.conversation.findMany();
    verifier(liste.length === 1 && liste[0]!.tenantId === A.tenantId, `${liste.length} ligne(s)`);
  });
  await cr.doitEtreRefuse('En contexte A, ouvrir une conversation sur une réclamation de B', '42501', () =>
    enA.conversation.create({ data: { tenantId: B.tenantId, reclamationId: reclamationB.id } }));
  await cr.doitEtreRefuse('Une conversation de A sur une réclamation de B (clé étrangère par banque)', '23503', () =>
    proprietaire.conversation.create({ data: { tenantId: A.tenantId, reclamationId: reclamationB.id } }));
  await cr.doitEtreRefuse('Deux conversations pour une même réclamation', '23505', () =>
    enA.conversation.create({ data: { tenantId: A.tenantId, reclamationId: reclamationA.id } }));
  await cr.doitReussir('Marques de lecture et derniers messages (contexte A)', () =>
    enA.conversation.update({ where: { id: conversationA.id }, data: { luBanqueLe: new Date(), dernierMessageClientLe: new Date() } }));
  await cr.doitEtreRefuse('Rattacher une conversation à une autre réclamation', '42501', () =>
    enA.conversation.update({ where: { id: conversationA.id }, data: { reclamationId: reclamationA.id } }));
  await cr.doitEtreRefuse('Supprimer une conversation (contexte banque)', '42501', () =>
    enA.conversation.delete({ where: { id: conversationA.id } }));
  await refusCheck('Avis différé sans réponse de la banque', () =>
    enA.conversation.update({ where: { id: conversationA.id }, data: { avisClientLe: new Date() } }));
  await cr.doitEtreRefuse('L\'Admin Entreprise ouvre lui-même le chat (réservé au Super Admin)', '42501', () =>
    enA.banque.update({ where: { id: A.tenantId }, data: { chatWeb: true } }));
  await cr.doitReussir('Le Super Admin ouvre le chat d\'une banque', () =>
    plateforme.banque.update({ where: { id: A.tenantId }, data: { chatWeb: true } }));
  await cr.doitEtreRefuse('Super Admin : lire les conversations (arbitrage 7, décision I5)', '42501', () => plateforme.conversation.count());
  await cr.doitReussir('Contexte système (worker) : les colonnes des avis différés, toutes banques', async () => {
    const n = await systeme.conversation.findMany({ select: { id: true, tenantId: true, reclamationId: true, dernierMessageBanqueLe: true, luClientLe: true, avisClientLe: true } });
    verifier(n.length === 2, `${n.length} ligne(s)`);
  });
  await cr.doitEtreRefuse('Contexte système : lire les marques de lecture de la banque', '42501', () =>
    systeme.conversation.findMany({ select: { luBanqueLe: true } }));
  await cr.doitEtreRefuse('Contexte système : modifier les marques de lecture de la banque', '42501', () =>
    systeme.conversation.updateMany({ data: { luBanqueLe: null } }));
  await cr.doitReussir('Contexte système (étape 20) : lecture par le client et avis différé, d\'après les statuts de Meta', () =>
    systeme.conversation.updateMany({ where: { id: conversationA.id }, data: { avisClientLe: null, luClientLe: new Date() } }));

  // ----------------------------------------------------------------------------------
  cr.section('Assistant IA (étape 18)');

  await refusCheck('Assistant ouvert sans le chat web', () =>
    plateforme.banque.update({ where: { id: B.tenantId }, data: { assistantIa: true } }));
  await cr.doitEtreRefuse('L\'Admin Entreprise ouvre lui-même l\'assistant (réservé au Super Admin)', '42501', () =>
    enA.banque.update({ where: { id: A.tenantId }, data: { assistantIa: true } }));
  await cr.doitReussir('Le Super Admin ouvre l\'assistant d\'une banque qui a le chat', () =>
    plateforme.banque.update({ where: { id: A.tenantId }, data: { assistantIa: true } }));
  const reponseA = await enA.reponseAssistant.create({ data: { tenantId: A.tenantId, question: 'Horaires ?', reponse: 'De 8 h à 17 h.' } });
  await proprietaire.reponseAssistant.create({ data: { tenantId: B.tenantId, question: 'Horaires ?', reponse: 'De 7 h 30 à 16 h.' } });
  await cr.doitReussir('En contexte A, seule la base de réponses de A est visible', async () => {
    const liste = await enA.reponseAssistant.findMany();
    verifier(liste.length === 1 && liste[0]!.tenantId === A.tenantId, `${liste.length} ligne(s)`);
  });
  await cr.doitEtreRefuse('En contexte A, écrire une réponse dans la base de B', '42501', () =>
    enA.reponseAssistant.create({ data: { tenantId: B.tenantId, question: 'Q ?', reponse: 'R.' } }));
  await cr.doitEtreRefuse('Déplacer une réponse vers une autre banque', '42501', () =>
    enA.reponseAssistant.update({ where: { id: reponseA.id }, data: { tenantId: B.tenantId } }));
  await refusCheck('Réponse vide', () =>
    enA.reponseAssistant.update({ where: { id: reponseA.id }, data: { reponse: '   ' } }));
  await cr.doitEtreRefuse('Super Admin : lire la base de réponses d\'une banque', '42501', () => plateforme.reponseAssistant.count());

  const appel = { finalite: 'ACCUEIL_PORTAIL' as const, fournisseur: 'anthropic', modele: 'modele', jetonsEntree: 900, jetonsSortie: 40, coutMicroUsd: 1100, dureeMs: 800, issue: 'OK' as const };
  const appelA = await enA.appelIa.create({ data: { tenantId: A.tenantId, ...appel } });
  await proprietaire.appelIa.create({ data: { tenantId: B.tenantId, ...appel } });
  await cr.doitReussir('Journal des appels sans contenu : aucune colonne de texte libre', async () => {
    const colonnes = await proprietaire.$queryRaw<{ column_name: string; data_type: string }[]>`
      SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'appel_ia' ORDER BY column_name`;
    const textes = colonnes.filter((c) => ['text', 'character varying', 'json', 'jsonb'].includes(c.data_type)).map((c) => c.column_name);
    verifier(JSON.stringify(textes) === JSON.stringify(['fournisseur', 'modele']), `colonnes de texte : ${textes.join(', ')}`);
  });
  await cr.doitReussir('En contexte A, seuls les appels de A sont visibles', async () => {
    const n = await enA.appelIa.findMany();
    verifier(n.length === 1 && n[0]!.tenantId === A.tenantId, `${n.length} ligne(s)`);
  });
  await cr.doitEtreRefuse('En contexte A, journaliser un appel au nom de B', '42501', () =>
    enA.appelIa.create({ data: { tenantId: B.tenantId, ...appel } }));
  await cr.doitEtreRefuse('Modifier un appel journalisé (facturation)', '42501', () =>
    enA.appelIa.update({ where: { id: appelA.id }, data: { jetonsEntree: 0 } }));
  await cr.doitEtreRefuse('Effacer un appel journalisé', '42501', () => enA.appelIa.delete({ where: { id: appelA.id } }));
  await refusCheck('Appel « règles » attribué à un fournisseur', () =>
    enA.appelIa.create({ data: { tenantId: A.tenantId, ...appel, issue: 'REGLES' } }));
  await refusCheck('Plafond atteint, mais des jetons comptés', () =>
    enA.appelIa.create({ data: { tenantId: A.tenantId, ...appel, issue: 'PLAFOND' } }));
  await cr.doitReussir('Super Admin : le journal des appels de toutes les banques (facturation)', async () => {
    const n = await plateforme.appelIa.count();
    verifier(n === 2, `${n} ligne(s)`);
  });
  await cr.doitEtreRefuse('Super Admin : écrire dans le journal des appels', '42501', () =>
    plateforme.appelIa.create({ data: { tenantId: A.tenantId, ...appel } }));
  await cr.doitEtreRefuse('Contexte système : aucun accès au journal des appels', '42501', () => systeme.appelIa.count());

  // ----------------------------------------------------------------------------------
  cr.section('Double authentification au choix de la banque (étape 19)');

  await cr.doitReussir('L\'Admin Entreprise rend la double authentification obligatoire dans sa banque', async () => {
    const b = await enA.banque.update({ where: { id: A.tenantId }, data: { doubleAuthentificationObligatoire: true } });
    verifier(b.doubleAuthentificationObligatoire, 'réglage non enregistré');
  });
  await cr.doitReussir('En contexte A, le réglage de B ne peut pas être changé (aucune ligne)', async () => {
    const { count } = await enA.banque.updateMany({ where: { id: B.tenantId }, data: { doubleAuthentificationObligatoire: true } });
    verifier(count === 0, `${count} ligne(s) modifiée(s)`);
  });
  await cr.doitEtreRefuse('En contexte banque, marquer la double authentification d\'un compte comme activée', '42501', () =>
    enA.utilisateur.update({ where: { id: A.agent.id }, data: { totpActiveLe: new Date() } }));
  await cr.doitEtreRefuse('En contexte banque, effacer le secret TOTP d\'un compte', '42501', () =>
    enA.utilisateur.update({ where: { id: A.agent.id }, data: { totpSecretChiffre: null } }));
  await cr.doitReussir('Le Super Admin lit le réglage de chaque banque', async () => {
    const b = await plateforme.banque.findMany({ select: { id: true, doubleAuthentificationObligatoire: true } });
    verifier(b.find((x) => x.id === A.tenantId)?.doubleAuthentificationObligatoire === true && b.find((x) => x.id === B.tenantId)?.doubleAuthentificationObligatoire === false, JSON.stringify(b));
  });

  // ----------------------------------------------------------------------------------
  cr.section('WhatsApp et SMS entrant (étape 20)');

  const pointWaA = await proprietaire.pointDepot.create({ data: { tenantId: A.tenantId, code: codePublic(), canal: 'WHATSAPP', libelle: 'WhatsApp' } });
  const pointSmsB = await proprietaire.pointDepot.create({ data: { tenantId: B.tenantId, code: codePublic(), canal: 'SMS', libelle: 'SMS' } });
  const waA = { tenantId: A.tenantId, canal: 'WHATSAPP' as const, identifiant: '1098765', numero: '+2252722000000', compteWhatsapp: '2098765', jetonChiffre: 'v1:a:b:c', pointDepotId: pointWaA.id };
  await cr.doitReussir('Contexte système : raccorder le numéro WhatsApp d\'une banque, jeton chiffré compris', () => systeme.canalBanque.create({ data: waA }));
  await systeme.canalBanque.create({ data: { tenantId: B.tenantId, canal: 'SMS', identifiant: '+2252722000001', numero: '+2252722000001', pointDepotId: pointSmsB.id } });
  await cr.doitEtreRefuse('L\'Admin Entreprise raccorde lui-même un numéro', '42501', () =>
    enA.canalBanque.create({ data: { ...waA, identifiant: '777', canal: 'SMS' } }));
  await cr.doitReussir('En contexte A : son numéro seulement, sans identifiant chez Meta ni jeton', async () => {
    const n = await enA.canalBanque.findMany({ select: { canal: true, numero: true, pointDepotId: true } });
    verifier(n.length === 1 && n[0]!.numero === waA.numero, JSON.stringify(n));
  });
  await cr.doitEtreRefuse('En contexte banque, lire le jeton WhatsApp', '42501', () => enA.canalBanque.findMany({ select: { jetonChiffre: true } }));
  await cr.doitEtreRefuse('En contexte banque, lire l\'identifiant chez Meta', '42501', () => enA.canalBanque.findMany({ select: { identifiant: true } }));
  await cr.doitReussir('Super Admin : les raccordements de toutes les banques, sans jeton', async () => {
    const n = await plateforme.canalBanque.findMany({ select: { tenantId: true, identifiant: true, numero: true, compteWhatsapp: true } });
    verifier(n.length === 2, `${n.length} ligne(s)`);
  });
  await cr.doitEtreRefuse('Super Admin : lire le jeton WhatsApp', '42501', () => plateforme.canalBanque.findMany({ select: { jetonChiffre: true } }));
  await cr.doitEtreRefuse('Un même numéro chez deux banques', '23505', () =>
    systeme.canalBanque.create({ data: { ...waA, tenantId: B.tenantId, pointDepotId: pointSmsB.id, canal: 'WHATSAPP' } }));
  await refusCheck('WhatsApp sans jeton', () => systeme.canalBanque.create({ data: { ...waA, tenantId: B.tenantId, identifiant: '55', jetonChiffre: null, pointDepotId: pointSmsB.id } }));
  await refusCheck('SMS dont l\'identifiant n\'est pas le numéro', () =>
    systeme.canalBanque.update({ where: { tenantId_canal: { tenantId: B.tenantId, canal: 'SMS' } }, data: { identifiant: '+2252722000009' } }));
  await refusCheck('Numéro hors format international', () =>
    systeme.canalBanque.update({ where: { tenantId_canal: { tenantId: A.tenantId, canal: 'WHATSAPP' } }, data: { numero: '0722000000' } }));
  await refusCheck('Point de dépôt WhatsApp rattaché à une agence', () =>
    proprietaire.pointDepot.update({ where: { id: pointWaA.id }, data: { agenceId: A.agence.id } }));
  await refusCheck('WhatsApp ouvert sans le chat web', () => plateforme.banque.update({ where: { id: B.tenantId }, data: { smsEntrant: true } }));
  await cr.doitEtreRefuse('L\'Admin Entreprise ouvre lui-même WhatsApp (réservé au Super Admin)', '42501', () =>
    enA.banque.update({ where: { id: A.tenantId }, data: { whatsapp: true } }));
  await cr.doitReussir('Le Super Admin ouvre WhatsApp à une banque qui a le chat', () =>
    plateforme.banque.update({ where: { id: A.tenantId }, data: { whatsapp: true } }));

  const sessionA = await enA.sessionCanal.create({ data: { tenantId: A.tenantId, canal: 'WHATSAPP', telephone: '+2250707070707', dernierMessageLe: new Date() } });
  await proprietaire.sessionCanal.create({ data: { tenantId: B.tenantId, canal: 'SMS', telephone: '+2250707070707', dernierMessageLe: new Date() } });
  await cr.doitReussir('En contexte A, seules les sessions de A sont visibles', async () => {
    const n = await enA.sessionCanal.findMany();
    verifier(n.length === 1 && n[0]!.id === sessionA.id, `${n.length} ligne(s)`);
  });
  await cr.doitEtreRefuse('En contexte A, ouvrir une session chez B', '42501', () =>
    enA.sessionCanal.create({ data: { tenantId: B.tenantId, canal: 'WHATSAPP', telephone: '+2250708080808', dernierMessageLe: new Date() } }));
  await refusCheck('Session d\'une étape inconnue', () => enA.sessionCanal.update({ where: { id: sessionA.id }, data: { etape: 'PAIEMENT' } }));
  await cr.doitEtreRefuse('Super Admin : lire les sessions (numéros, dépôts en préparation)', '42501', () => plateforme.sessionCanal.count());

  await enA.messageEntrant.create({ data: { tenantId: A.tenantId, canal: 'WHATSAPP', idExterne: 'wamid.1', issue: 'EN_COURS', recuLe: new Date() } });
  await cr.doitEtreRefuse('Un message reçu deux fois (Meta réessaie) : une seule ligne, toutes banques', '23505', () =>
    proprietaire.messageEntrant.create({ data: { tenantId: B.tenantId, canal: 'WHATSAPP', idExterne: 'wamid.1', issue: 'DEPOT', recuLe: new Date() } }));
  await refusCheck('Message rattaché sans commentaire', () =>
    enA.messageEntrant.update({ where: { canal_idExterne: { canal: 'WHATSAPP', idExterne: 'wamid.1' } }, data: { issue: 'RATTACHE' } }));
  await cr.doitEtreRefuse('En contexte banque, effacer un message reçu (facturation)', '42501', () =>
    enA.messageEntrant.deleteMany({ where: { idExterne: 'wamid.1' } }));
  await cr.doitEtreRefuse('Super Admin : lire les messages reçus', '42501', () => plateforme.messageEntrant.count());
  await cr.doitReussir('Contexte système : effacer un message dont le traitement a échoué (Meta le renverra)', () =>
    systeme.messageEntrant.deleteMany({ where: { idExterne: 'wamid.1' } }));
  await refusCheck('Note interne avec un canal', () =>
    enA.commentaire.create({ data: { tenantId: A.tenantId, reclamationId: reclamationA.id, type: 'NOTE_INTERNE', contenu: 'Note', canal: 'WHATSAPP', auteurUtilisateurId: A.agent.id } }));
  await refusCheck('Expéditeur sur un e-mail', () =>
    enA.notification.create({ data: { tenantId: A.tenantId, canal: 'EMAIL', modele: 'client.depot', destination: 'a@b.ci', contenu: 'x', expediteur: '+2252722000000' } }));
  await refusCheck('Facturation de Meta sur un SMS', () =>
    enA.notification.create({ data: { tenantId: A.tenantId, canal: 'SMS', modele: 'client.depot', destination: '+2250707070707', contenu: 'x', facturable: true } }));
  await cr.doitReussir('Super Admin : facturation WhatsApp et SMS reçus, des totaux seulement', async () => {
    const l = await transactionEn(base, contexte.plateforme(), (tx) => tx.$queryRaw<{ tenant_id: string }[]>`
      SELECT * FROM facturation_canaux(now() - interval '1 day', now() + interval '1 day')`);
    verifier(Array.isArray(l), 'pas de résultat');
  });
  await cr.doitEtreRefuse('En contexte banque, la facturation de toutes les banques', '42501', () =>
    transactionEn(base, contexte.banque(A.tenantId), (tx) => tx.$queryRaw`SELECT * FROM facturation_canaux(now() - interval '1 day', now())`));

  // ----------------------------------------------------------------------------------
  cr.section('Saisie au guichet, doublons, réaffectation (étape 21)');

  await cr.doitReussir('En contexte A : le point « Guichet » d\'une agence, créé à la première saisie', () =>
    enA.pointDepot.create({ data: { tenantId: A.tenantId, code: codePublic(), canal: 'GUICHET', libelle: 'Guichet', agenceId: A.agence.id } }));
  await cr.doitEtreRefuse('Deux points « Guichet » pour la même agence', '23505', () =>
    enA.pointDepot.create({ data: { tenantId: A.tenantId, code: codePublic(), canal: 'GUICHET', libelle: 'Guichet', agenceId: A.agence.id } }));
  await refusCheck('Point « Guichet » sans agence', () => enA.pointDepot.create({ data: { tenantId: A.tenantId, code: codePublic(), canal: 'GUICHET', libelle: 'Guichet' } }));
  await cr.doitReussir('En contexte A : le point « Téléphone » de la banque', () =>
    enA.pointDepot.create({ data: { tenantId: A.tenantId, code: codePublic(), canal: 'TELEPHONE', libelle: 'Téléphone' } }));
  await cr.doitEtreRefuse('Deux points « Téléphone » pour la même banque', '23505', () =>
    enA.pointDepot.create({ data: { tenantId: A.tenantId, code: codePublic(), canal: 'TELEPHONE', libelle: 'Téléphone' } }));
  await refusCheck('Point « Téléphone » rattaché à une agence', () =>
    proprietaire.pointDepot.create({ data: { tenantId: B.tenantId, code: codePublic(), canal: 'TELEPHONE', libelle: 'Téléphone', agenceId: B.agence.id } }));
  await cr.doitEtreRefuse('En contexte A, un point « Guichet » chez B', '42501', () =>
    enA.pointDepot.create({ data: { tenantId: B.tenantId, code: codePublic(), canal: 'GUICHET', libelle: 'Guichet', agenceId: B.agence.id } }));

  const doublonA = await proprietaire.reclamation.create({ data: donneesReclamation(A, 'ALP-2026-000900') });
  const cloture = (principaleId: string, motif: 'DOUBLON' | 'AUTRE' = 'DOUBLON') => ({
    statut: 'CLOTUREE' as const, clotureLe: new Date(), modeCloture: 'FORCEE' as const, motifClotureForcee: motif,
    commentaireCloture: 'Rattachée à ALP-2026-000001', clotureParId: A.superviseur.id, rattacheeAId: principaleId,
    echeanceSlaLe: null, alertePreventiveLe: null, slaSuspenduLe: null,
  });
  await refusCheck('Doublon rattaché sans être clôturé', () => enA.reclamation.update({ where: { id: doublonA.id }, data: { rattacheeAId: reclamationA.id } }));
  await refusCheck('Doublon rattaché à lui-même', () => enA.reclamation.update({ where: { id: doublonA.id }, data: cloture(doublonA.id) }));
  await refusCheck('Rattachement clôturé avec un autre motif que « Doublon »', () => enA.reclamation.update({ where: { id: doublonA.id }, data: cloture(reclamationA.id, 'AUTRE') }));
  await cr.doitEtreRefuse('En contexte A, rattacher à une réclamation de la banque B', '23503', () =>
    enA.reclamation.update({ where: { id: doublonA.id }, data: cloture(reclamationB.id) }));
  await cr.doitEtreRefuse('Super Admin : rattacher un doublon', '42501', () =>
    plateforme.reclamation.updateMany({ where: { id: doublonA.id }, data: { rattacheeAId: reclamationA.id } }));
  await cr.doitReussir('En contexte A : rattacher un doublon clôturé « Doublon » à sa réclamation principale', () =>
    enA.reclamation.update({ where: { id: doublonA.id }, data: cloture(reclamationA.id) }));
  await cr.doitReussir('En contexte B, la réclamation rattachée de A reste invisible', async () => {
    verifier((await enB.reclamation.count({ where: { rattacheeAId: { not: null } } })) === 0, 'visible');
  });

  // ----------------------------------------------------------------------------------
  cr.section('Envois non remis et pièces jointes (étape 22)');

  const smsA = await proprietaire.notification.create({
    data: { tenantId: A.tenantId, canal: 'SMS', modele: 'client.depot', destinataireClientId: A.client.id, reclamationId: reclamationA.id, destination: '+2250707070707', contenu: 'Réclamation enregistrée', statut: 'ENVOYEE', envoyeeLe: new Date() },
  });
  await cr.doitEtreRefuse('En contexte banque, déclarer remis un message au client', '42501', () =>
    enA.notification.update({ where: { id: smsA.id }, data: { statut: 'DELIVREE', remiseLe: new Date() } }));
  await cr.doitEtreRefuse('Super Admin : changer l\'état d\'un envoi', '42501', () =>
    plateforme.notification.update({ where: { id: smsA.id }, data: { motifEchec: 'INJOIGNABLE' } }));
  await refusCheck('Motif d\'échec inconnu', () => systeme.notification.update({ where: { id: smsA.id }, data: { statut: 'ECHEC', motifEchec: 'PERDU' } }));
  await cr.doitReussir('Contexte système : accusé de remise de la passerelle (non remis, motif)', () =>
    systeme.notification.update({ where: { id: smsA.id }, data: { statut: 'ECHEC', motifEchec: 'INJOIGNABLE' } }));
  await cr.doitReussir('Super Admin : facturation SMS (envoyés, remis, non remis), des totaux seulement', async () => {
    const l = await transactionEn(base, contexte.plateforme(), (tx) => tx.$queryRaw<{ tenant_id: string; remis: bigint; echecs: bigint }[]>`
      SELECT * FROM facturation_sms(now() - interval '1 day', now() + interval '1 day')`);
    verifier(l.some((b) => b.tenant_id === A.tenantId && Number(b.echecs) === 1), JSON.stringify(l, (_, v) => (typeof v === 'bigint' ? Number(v) : v)));
  });
  await cr.doitEtreRefuse('En contexte banque, la facturation SMS de toutes les banques', '42501', () =>
    transactionEn(base, contexte.banque(A.tenantId), (tx) => tx.$queryRaw`SELECT * FROM facturation_sms(now() - interval '1 day', now())`));

  const piece = (n: number) => ({
    tenantId: A.tenantId, reclamationId: reclamationA.id, nomFichier: `piece-${n}.pdf`, typeMime: 'application/pdf', tailleOctets: 100,
    cleStockage: `${A.tenantId}/verification/${n}.pdf`, empreinteSha256: 'a'.repeat(64), deposeParType: 'CLIENT' as const,
  });
  const pieceA = await enA.pieceJointe.create({ data: piece(1) });
  await cr.doitReussir('Une pièce jointe reçue attend l\'antivirus (par défaut)', async () => verifier(pieceA.antivirus === 'EN_ATTENTE', pieceA.antivirus));
  await cr.doitEtreRefuse('En contexte banque, déclarer saine une pièce jointe', '42501', () =>
    enA.pieceJointe.update({ where: { id: pieceA.id }, data: { antivirus: 'SAIN', analyseeLe: new Date() } }));
  await cr.doitEtreRefuse('Super Admin : déclarer saine une pièce jointe', '42501', () =>
    plateforme.pieceJointe.updateMany({ where: { id: pieceA.id }, data: { antivirus: 'SAIN' } }));
  await refusCheck('Infectée sans le nom du virus', () => systeme.pieceJointe.update({ where: { id: pieceA.id }, data: { antivirus: 'INFECTE', analyseeLe: new Date() } }));
  await refusCheck('Nom de virus sur une pièce saine', () => systeme.pieceJointe.update({ where: { id: pieceA.id }, data: { antivirus: 'SAIN', virus: 'Eicar' } }));
  await cr.doitEtreRefuse('Contexte système : renommer le fichier', '42501', () =>
    systeme.pieceJointe.update({ where: { id: pieceA.id }, data: { nomFichier: 'autre.pdf' } }));
  await cr.doitEtreRefuse('Changer le fichier en notant le résultat, même en propriétaire', /écriture seule/, () =>
    proprietaire.pieceJointe.update({ where: { id: pieceA.id }, data: { antivirus: 'SAIN', cleStockage: `${A.tenantId}/verification/autre.pdf` } }));
  await cr.doitReussir('Contexte système : noter le résultat de l\'analyse (infectée, nom du virus)', () =>
    systeme.pieceJointe.update({ where: { id: pieceA.id }, data: { antivirus: 'INFECTE', analyseeLe: new Date(), virus: 'Win.Test.EICAR_HDB-1' } }));
  await cr.doitEtreRefuse('Revenir sur le résultat de l\'analyse, même en propriétaire', /écriture seule/, () =>
    proprietaire.pieceJointe.update({ where: { id: pieceA.id }, data: { antivirus: 'SAIN', virus: null } }));
  await cr.doitEtreRefuse('Supprimer une pièce jointe, même en propriétaire', /écriture seule/, () =>
    proprietaire.pieceJointe.delete({ where: { id: pieceA.id } }));
  await cr.doitReussir('En contexte B, la pièce jointe de A reste invisible', async () => {
    verifier((await enB.pieceJointe.count({ where: { id: pieceA.id } })) === 0, 'visible');
  });

  // ----------------------------------------------------------------------------------
  cr.section('Baromètre mensuel et recommandations (étape 23)');

  await cr.doitEtreRefuse('L\'Admin Entreprise ouvre lui-même le baromètre (réservé au Super Admin)', '42501', () =>
    enA.banque.update({ where: { id: A.tenantId }, data: { barometre: true } }));
  await cr.doitReussir('Le Super Admin ouvre le baromètre d\'une banque', () =>
    plateforme.banque.update({ where: { id: A.tenantId }, data: { barometre: true } }));
  const septembre = new Date('2026-09-01T00:00:00Z');
  const contenu = { version: 1, mois: '2026-09', mesures: { reclamations: 12 }, themes: [{ libelle: 'Délais', exemples: [{ texte: 'Trois semaines sans nouvelles' }] }] };
  const reco = (tenantId: string, barometreId: string, ordre: number) => ({
    tenantId, barometreId, ordre, titre: 'Traiter plus vite les réclamations carte', constat: '4 réclamations sur 10 hors délai.', action: 'Renforcer l\'équipe.', priorite: 'HAUTE', source: 'REGLES',
  });
  let barometreA = { id: '' };
  let recoA = { id: '' };
  await cr.doitReussir('Contexte système (worker) : publier le baromètre et ses recommandations', async () => {
    barometreA = await systeme.barometre.create({ data: { tenantId: A.tenantId, mois: septembre, source: 'REGLES', contenu } });
    recoA = await systeme.recommandationBarometre.create({ data: reco(A.tenantId, barometreA.id, 1) });
  });
  const barometreB = await proprietaire.barometre.create({ data: { tenantId: B.tenantId, mois: septembre, source: 'IA', contenu } });
  const recoB = await proprietaire.recommandationBarometre.create({ data: { ...reco(B.tenantId, barometreB.id, 1), source: 'IA' } });
  await cr.doitEtreRefuse('Deux baromètres pour le même mois', 'P2002', () =>
    systeme.barometre.create({ data: { tenantId: A.tenantId, mois: septembre, source: 'REGLES', contenu } }));
  await cr.doitEtreRefuse('Contexte système : modifier un baromètre publié', '42501', () =>
    systeme.barometre.update({ where: { id: barometreA.id }, data: { contenu: { ...contenu, mesures: { reclamations: 3 } } } }));
  await cr.doitEtreRefuse('Contexte système : effacer un baromètre publié', '42501', () => systeme.barometre.delete({ where: { id: barometreA.id } }));
  await cr.doitEtreRefuse('Contexte système : décider d\'une recommandation à la place de la banque', '42501', () =>
    systeme.recommandationBarometre.update({ where: { id: recoA.id }, data: { decision: 'ECARTEE' } }));
  await cr.doitReussir('En contexte A, seul le baromètre de A est visible (et ses recommandations)', async () => {
    const [b, r] = await Promise.all([enA.barometre.findMany(), enA.recommandationBarometre.findMany()]);
    verifier(b.length === 1 && b[0]!.tenantId === A.tenantId && r.length === 1 && r[0]!.tenantId === A.tenantId, `${b.length} baromètre(s), ${r.length} recommandation(s)`);
  });
  await cr.doitEtreRefuse('En contexte A, publier un baromètre', '42501', () =>
    enA.barometre.create({ data: { tenantId: A.tenantId, mois: new Date('2026-08-01T00:00:00Z'), source: 'REGLES', contenu } }));
  await cr.doitEtreRefuse('En contexte A, retoucher les chiffres du baromètre publié', '42501', () =>
    enA.barometre.update({ where: { id: barometreA.id }, data: { contenu: { ...contenu, mesures: { reclamations: 3 } } } }));
  await cr.doitEtreRefuse('En contexte A, réécrire le texte d\'une recommandation', '42501', () =>
    enA.recommandationBarometre.update({ where: { id: recoA.id }, data: { constat: 'Tout va bien.' } }));
  await cr.doitEtreRefuse('En contexte A, ajouter une recommandation', '42501', () =>
    enA.recommandationBarometre.create({ data: reco(A.tenantId, barometreA.id, 2) }));
  await cr.doitEtreRefuse('En contexte A, effacer une recommandation', '42501', () => enA.recommandationBarometre.delete({ where: { id: recoA.id } }));
  await cr.doitReussir('En contexte A, l\'Admin Entreprise retient une recommandation (décision, commentaire, auteur, date)', () =>
    enA.recommandationBarometre.update({ where: { id: recoA.id }, data: { decision: 'RETENUE', commentaire: 'Renfort lundi', decideeParId: A.admin.id, decideeLe: new Date() } }));
  await cr.doitReussir('En contexte A, la recommandation de B reste hors d\'atteinte', async () => {
    const n = await enA.recommandationBarometre.updateMany({ where: { id: recoB.id }, data: { decision: 'ECARTEE' } });
    verifier(n.count === 0, `${n.count} ligne(s) modifiée(s)`);
  });
  await cr.doitEtreRefuse('En contexte A, décider au nom d\'un utilisateur de B', '23503', () =>
    enA.recommandationBarometre.update({ where: { id: recoA.id }, data: { decideeParId: B.admin.id, decideeLe: new Date() } }));
  await refusCheck('Décision inconnue', () => enA.recommandationBarometre.update({ where: { id: recoA.id }, data: { decision: 'PEUT_ETRE' } }));
  await refusCheck('Décision datée sans auteur', () => enA.recommandationBarometre.update({ where: { id: recoA.id }, data: { decideeParId: null } }));
  await refusCheck('Baromètre daté d\'un autre jour que le 1er du mois', () =>
    systeme.barometre.create({ data: { tenantId: A.tenantId, mois: new Date('2026-08-15T00:00:00Z'), source: 'REGLES', contenu } }));
  await refusCheck('Analyse qui ne vient ni de l\'IA ni des règles', () =>
    systeme.barometre.create({ data: { tenantId: A.tenantId, mois: new Date('2026-07-01T00:00:00Z'), source: 'HUMAIN', contenu } }));
  await refusCheck('Contenu qui n\'est pas un objet', () =>
    systeme.barometre.create({ data: { tenantId: A.tenantId, mois: new Date('2026-06-01T00:00:00Z'), source: 'REGLES', contenu: [1, 2] } }));
  await refusCheck('Plus de 5 recommandations', () => systeme.recommandationBarometre.create({ data: reco(A.tenantId, barometreA.id, 6) }));
  await cr.doitEtreRefuse('Super Admin : lire les baromètres (ils contiennent les commentaires des clients)', '42501', () => plateforme.barometre.count());
  await cr.doitEtreRefuse('Super Admin : lire les recommandations', '42501', () => plateforme.recommandationBarometre.count());

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
