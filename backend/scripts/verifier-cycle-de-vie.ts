import { DateTime } from "luxon";
import {
  CycleDeVie,
  TachesSla,
} from "../src/application/reclamations/index.js";
import type { Acteur } from "../src/domaine/reclamation/machine.js";
import {
  contexte,
  creerClientBase,
  transactionEn,
} from "../src/infrastructure/base-de-donnees/index.js";
import {
  CompteRendu,
  DELAI_TRANSACTION_VERIFICATION,
  clientProprietaire,
  creerBanque,
  creerPlan,
  urlBaseJetable,
  viderLaBase,
  type BanqueDeTest,
} from "./commun.js";

const proprietaire = clientProprietaire();
const base = creerClientBase(urlBaseJetable("APP_DATABASE_URL"), {
  delaiTransaction: DELAI_TRANSACTION_VERIFICATION,
});
const cr = new CompteRendu();

const t = (texte: string) =>
  DateTime.fromFormat(texte, "yyyy-MM-dd HH:mm", {
    zone: "Africa/Abidjan",
  }).toJSDate();
const local = (d: Date | null | undefined) =>
  d
    ? DateTime.fromJSDate(d, { zone: "Africa/Abidjan" }).toFormat(
        "yyyy-MM-dd HH:mm",
      )
    : "null";
let horloge = t("2026-09-25 10:00");
const cycle = new CycleDeVie(base, {
  horloge: () => horloge,
  lienSuivi: (slug, jeton) =>
    `https://${slug}.reclamations.test/suivi/${jeton}`,
});
const taches = new TachesSla(base, cycle);

function verifier(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
const egal = (obtenu: unknown, attendu: unknown, quoi: string) =>
  verifier(
    obtenu === attendu,
    `${quoi} : attendu ${String(attendu)}, obtenu ${String(obtenu)}`,
  );

const personnel = (u: {
  id: string;
  role: "AGENT" | "SUPERVISEUR" | "ADMIN_ENTREPRISE";
  prenom: string;
  nom: string;
}): Acteur => ({
  type: "UTILISATEUR",
  id: u.id,
  role: u.role,
  libelle: `${u.prenom} ${u.nom}`,
});
const ticket = (id: string) =>
  proprietaire.reclamation.findUniqueOrThrow({ where: { id } });
const notifications = (reclamationId: string | null, modele: string) =>
  proprietaire.notification.findMany({
    where: { reclamationId, modele },
    orderBy: { canal: "asc" },
  });

async function main() {
  console.log("Étape 4 — cycle de vie et SLA");
  await viderLaBase(proprietaire);

  // --- Deux banques de test, horaires lun–ven 08:00–12:00 et 14:00–17:30 ------------
  const plan = await creerPlan(proprietaire);
  const A: BanqueDeTest = await creerBanque(
    proprietaire,
    plan,
    "Banque Alpha",
    "ALP",
  );
  const B: BanqueDeTest = await creerBanque(
    proprietaire,
    plan,
    "Banque Beta",
    "BET",
  );
  await proprietaire.utilisateur.create({
    data: {
      role: "SUPER_ADMIN",
      statut: "ACTIF",
      email: "superadmin@makor.test",
      nom: "Makor",
      prenom: "Super Admin",
    },
  });
  const autreAgentA = await proprietaire.utilisateur.create({
    data: {
      tenantId: A.tenantId,
      role: "AGENT",
      statut: "ACTIF",
      email: "agent2@alp.test",
      nom: "Deux",
      prenom: "Agent",
      superviseurId: A.superviseur.id,
    },
  });
  const fraude = await proprietaire.categorie.create({
    data: {
      tenantId: A.tenantId,
      nom: "Fraude",
      prioriteParDefaut: "URGENTE",
      delaiCibleMinutes: 240,
    },
  });

  const agentA = personnel({ ...A.agent, role: "AGENT" });
  const autreAgent = personnel({ ...autreAgentA, role: "AGENT" });
  const supA = personnel({ ...A.superviseur, role: "SUPERVISEUR" });
  const supB = personnel({ ...B.superviseur, role: "SUPERVISEUR" });
  const depot = (
    b: BanqueDeTest,
    client: { nom: string; email?: string; telephone?: string },
    categorieId = b.categorie.id,
  ) =>
    cycle.deposer(
      {
        tenantId: b.tenantId,
        pointDepotId: b.pointQr.id,
        categorieId,
        description: "Carte avalée par le distributeur de Cocody.",
        client,
        consentementVersion: "2026-09",
      },
      { ip: "196.47.10.1", userAgent: "Test" },
    );

  // =================================================================================
  cr.section("Dépôt (§6.1)");

  let T1!: Awaited<ReturnType<typeof depot>>;
  await cr.doitReussir(
    "Dépôt par QR code vendredi 10:00 : ALP-2026-000001, « Ouverte »",
    async () => {
      T1 = await depot(A, {
        nom: "Yao Kouassi",
        email: " Yao.Kouassi@Exemple.CI ",
        telephone: "07 08 09 10 11",
      });
      egal(T1.numero, "ALP-2026-000001", "numéro");
      const r = await ticket(T1.id);
      egal(r.statut, "OUVERTE", "statut");
      egal(r.canal, "QR_CODE", "canal");
      egal(r.agenceId, A.agence.id, "agence du QR code");
    },
  );
  await cr.doitReussir(
    "Délai 16 h ouvrées : alerte lundi 16:30 (75 %), échéance mardi 11:00",
    async () => {
      const r = await ticket(T1.id);
      egal(local(r.alertePreventiveLe), "2026-09-28 16:30", "alerte");
      egal(local(r.echeanceSlaLe), "2026-09-29 11:00", "échéance");
    },
  );
  await cr.doitReussir(
    "Coordonnées normalisées : e-mail en minuscules, téléphone +225",
    async () => {
      const c = await proprietaire.clientFinal.findFirstOrThrow({
        where: { id: (await ticket(T1.id)).clientId },
      });
      egal(c.email, "yao.kouassi@exemple.ci", "e-mail");
      egal(c.telephone, "+2250708091011", "téléphone");
    },
  );
  await cr.doitReussir(
    "Accusé de réception au client : un e-mail et un SMS avec numéro et lien, sans la description",
    async () => {
      const n = await notifications(T1.id, "client.depot");
      egal(n.map((x) => x.canal).join(","), "EMAIL,SMS", "canaux");
      verifier(
        n.every(
          (x) =>
            x.contenu.includes("ALP-2026-000001") &&
            x.contenu.includes(T1.jetonSuivi) &&
            !x.contenu.includes("distributeur"),
        ),
        "contenu",
      );
    },
  );
  let T2!: Awaited<ReturnType<typeof depot>>;
  await cr.doitReussir(
    "Deuxième dépôt du même client, écrit autrement : même client final, ALP-2026-000002",
    async () => {
      horloge = t("2026-09-25 10:05");
      T2 = await depot(A, {
        nom: "Yao K.",
        email: "YAO.KOUASSI@exemple.ci",
        telephone: "+225 07.08.09.10.11",
      });
      egal(T2.numero, "ALP-2026-000002", "numéro");
      egal(
        (await ticket(T2.id)).clientId,
        (await ticket(T1.id)).clientId,
        "client final",
      );
      egal(
        await proprietaire.clientFinal.count({
          where: { tenantId: A.tenantId, email: "yao.kouassi@exemple.ci" },
        }),
        1,
        "clients",
      );
    },
  );
  await cr.doitReussir(
    "Journal d'audit du dépôt : IP tracée, ni nom, ni e-mail, ni description",
    async () => {
      const lignes = await proprietaire.journalAudit.findMany({
        where: { tenantId: A.tenantId, action: "reclamation.depot" },
      });
      egal(lignes.length, 2, "lignes");
      const texte = JSON.stringify(lignes, (_k, v) =>
        typeof v === "bigint" ? String(v) : v,
      );
      verifier(
        lignes[0].ip === "196.47.10.1" &&
          lignes[0].acteurType === "CLIENT" &&
          lignes[0].acteurLibelle === null,
        "acteur",
      );
      verifier(
        !/Yao|exemple\.ci|distributeur|\+225/i.test(texte),
        "donnée personnelle dans l'audit",
      );
    },
  );
  await cr.doitEtreRefuse(
    "Dépôt sans e-mail ni téléphone",
    "CONTACT_REQUIS",
    () => depot(A, { nom: "Anonyme" }),
  );
  await cr.doitEtreRefuse(
    "Dépôt avec un téléphone invalide",
    "CONTACT_INVALIDE",
    () => depot(A, { nom: "X", telephone: "1234" }),
  );

  // =================================================================================
  cr.section("Assignation et prise en charge (§6.2)");

  horloge = t("2026-09-25 10:30");
  await cr.doitEtreRefuse(
    "Un agent ne prend pas en charge un ticket qui ne lui est pas assigné",
    "ACTEUR_NON_AUTORISE",
    () => cycle.prendreEnCharge(A.tenantId, T1.id, agentA),
  );
  await cr.doitEtreRefuse(
    "Un agent ne s'assigne pas lui-même un ticket",
    "ACTEUR_NON_AUTORISE",
    () => cycle.assigner(A.tenantId, T1.id, agentA, A.agent.id),
  );
  await cr.doitReussir(
    "Le superviseur assigne T1 et T2 : l'agent reçoit un e-mail et une notification in-app",
    async () => {
      await cycle.assigner(A.tenantId, T1.id, supA, A.agent.id);
      await cycle.assigner(A.tenantId, T2.id, supA, A.agent.id);
      egal(
        (await notifications(T1.id, "agent.assignation"))
          .map((n) => n.canal)
          .join(","),
        "EMAIL,IN_APP",
        "canaux",
      );
    },
  );
  await cr.doitEtreRefuse(
    "Un autre agent ne peut pas répondre sur ce ticket",
    "ACTEUR_NON_AUTORISE",
    () => cycle.repondreAuClient(A.tenantId, T1.id, autreAgent, "Bonjour"),
  );
  await cr.doitEtreRefuse(
    "Le superviseur de la banque B ne voit pas le ticket de A (404)",
    "INTROUVABLE",
    () => cycle.assigner(B.tenantId, T1.id, supB, B.agent.id),
  );
  await cr.doitReussir(
    "Première réponse vendredi 11:00 : prise en charge implicite, délai de première réponse 60 min",
    async () => {
      horloge = t("2026-09-25 11:00");
      await cycle.repondreAuClient(
        A.tenantId,
        T1.id,
        agentA,
        "Nous vérifions auprès du centre monétique.",
      );
      const r = await ticket(T1.id);
      egal(r.statut, "EN_COURS", "statut");
      egal(r.delaiPremiereReponseMinutes, 60, "délai de première réponse");
      egal(
        (await notifications(T1.id, "client.reponse")).length,
        2,
        "notifications au client",
      );
    },
  );

  // =================================================================================
  cr.section("Parcours idéal : résolution au premier contact (arbitrage 6)");

  await cr.doitReussir(
    "T2 : prise en charge, résolution avant l'échéance, confirmation du client",
    async () => {
      horloge = t("2026-09-25 10:40");
      await cycle.prendreEnCharge(A.tenantId, T2.id, agentA);
      horloge = t("2026-09-25 11:00");
      const res = await cycle.resoudre(
        A.tenantId,
        T2.id,
        agentA,
        "Votre carte vous sera restituée demain en agence.",
      );
      verifier(res?.slaRespecte === true, "SLA respecté");
      horloge = t("2026-09-25 12:00");
      await cycle.confirmer(A.tenantId, T2.id, {
        type: "CLIENT",
        clientId: (await ticket(T2.id)).clientId,
      });
      const r = await ticket(T2.id);
      egal(r.statut, "CLOTUREE", "statut");
      egal(r.modeCloture, "CONFIRMATION_CLIENT", "mode");
      verifier(
        !r.passeEnAttenteClient && !r.escaladeeLe && r.nbReouvertures === 0,
        "drapeaux de résolution au premier contact",
      );
    },
  );
  await cr.doitReussir(
    "Chronologie du client de T2 : dépôt → prise en charge → résolution → confirmation, sans les événements internes",
    async () => {
      const ev = await proprietaire.reclamationEvenement.findMany({
        where: {
          reclamationId: T2.id,
          visibleClient: true,
          statutApres: { not: null },
        },
        orderBy: { creeLe: "asc" },
      });
      egal(
        ev.map((e) => e.type).join(" → "),
        "CREATION → PRISE_EN_CHARGE → RESOLUTION → CONFIRMATION",
        "chronologie",
      );
      egal(
        await proprietaire.reclamationEvenement.count({
          where: {
            reclamationId: T2.id,
            type: "ASSIGNATION",
            visibleClient: true,
          },
        }),
        0,
        "assignation visible",
      );
    },
  );

  // =================================================================================
  cr.section("Pause « En attente client » (§6.4)");

  await cr.doitReussir(
    "Lundi 09:00, question au client : chrono figé à 570 min restantes, échéance effacée",
    async () => {
      horloge = t("2026-09-28 09:00");
      await cycle.repondreAuClient(
        A.tenantId,
        T1.id,
        agentA,
        "Pouvez-vous nous indiquer l'heure du retrait ?",
        { attendreReponse: true },
      );
      const r = await ticket(T1.id);
      egal(r.statut, "EN_ATTENTE_CLIENT", "statut");
      egal(r.slaMinutesRestantes, 570, "minutes restantes");
      egal(r.echeanceSlaLe, null, "échéance");
      egal(
        (await notifications(T1.id, "client.question")).length,
        2,
        "notifications « question »",
      );
    },
  );
  await cr.doitReussir(
    "Mardi 12:00, après l'échéance initiale : aucune alerte, le chrono est arrêté",
    async () => {
      horloge = t("2026-09-29 12:00");
      const bilan = await taches.toutes(horloge);
      egal(bilan.alertesPreventives + bilan.depassements, 0, "alertes");
    },
  );
  await cr.doitReussir(
    "Mercredi 10:00, le client répond : « En cours », échéance jeudi 12:00, alerte mercredi 17:30",
    async () => {
      horloge = t("2026-09-30 10:00");
      await cycle.messageDuClient(
        A.tenantId,
        T1.id,
        { type: "CLIENT", clientId: (await ticket(T1.id)).clientId },
        "Vers 18 h, au distributeur de Cocody.",
      );
      const r = await ticket(T1.id);
      egal(r.statut, "EN_COURS", "statut");
      egal(local(r.echeanceSlaLe), "2026-10-01 12:00", "échéance");
      egal(local(r.alertePreventiveLe), "2026-09-30 17:30", "alerte");
      egal(
        (await notifications(T1.id, "agent.message_client")).length,
        2,
        "agent prévenu",
      );
    },
  );

  // =================================================================================
  cr.section("Alerte préventive, dépassement et escalade (§6.4)");

  await cr.doitReussir(
    "Mercredi 17:31 : alerte préventive à l'agent (e-mail + in-app)",
    async () => {
      horloge = t("2026-09-30 17:31");
      egal((await taches.toutes(horloge)).alertesPreventives, 1, "alertes");
      egal(
        (await notifications(T1.id, "sla.alerte_preventive"))
          .map((n) => n.canal)
          .join(","),
        "EMAIL,IN_APP",
        "canaux",
      );
    },
  );
  await cr.doitReussir(
    "Mercredi 17:45 : la même alerte ne repart pas",
    async () => {
      horloge = t("2026-09-30 17:45");
      egal((await taches.toutes(horloge)).alertesPreventives, 0, "alertes");
      egal(
        (await notifications(T1.id, "sla.alerte_preventive")).length,
        2,
        "notifications",
      );
    },
  );
  await cr.doitReussir(
    "Jeudi 12:01 : dépassement signalé à l'agent et au superviseur, ticket escaladé",
    async () => {
      horloge = t("2026-10-01 12:01");
      egal((await taches.toutes(horloge)).depassements, 1, "dépassements");
      const r = await ticket(T1.id);
      egal(r.escaladeeVersId, A.superviseur.id, "escaladé vers");
      egal(local(r.escaladeeLe), "2026-10-01 12:01", "escaladé le");
      const n = await notifications(T1.id, "sla.depassement");
      egal(
        new Set(n.map((x) => x.destinataireUtilisateurId)).size,
        2,
        "destinataires",
      );
    },
  );
  await cr.doitReussir(
    "Jeudi 12:30 : le dépassement ne repart pas",
    async () => {
      horloge = t("2026-10-01 12:30");
      egal((await taches.toutes(horloge)).depassements, 0, "dépassements");
    },
  );

  // =================================================================================
  cr.section("Résolution, contestation et clôture automatique (arbitrage 5)");

  await cr.doitReussir(
    "Jeudi 14:30, résolution après l'échéance : SLA non respecté, clôture auto prévue mardi 14:30",
    async () => {
      horloge = t("2026-10-01 14:30");
      await cycle.resoudre(
        A.tenantId,
        T1.id,
        agentA,
        "Le montant a été recrédité sur votre compte.",
      );
      const r = await ticket(T1.id);
      egal(r.statut, "RESOLUE", "statut");
      egal(r.slaRespecte, false, "SLA respecté");
      egal(
        local(r.clotureAutoPrevueLe),
        "2026-10-06 14:30",
        "clôture automatique",
      );
      egal(
        (await notifications(T1.id, "client.resolution"))
          .map((n) => n.canal)
          .join(","),
        "EMAIL,SMS",
        "canaux",
      );
    },
  );
  await cr.doitEtreRefuse(
    "Un autre client ne peut pas contester",
    "ACTEUR_NON_AUTORISE",
    () =>
      cycle.contester(
        A.tenantId,
        T1.id,
        { type: "CLIENT", clientId: A.client.id },
        "Pas moi",
      ),
  );
  await cr.doitReussir(
    "Vendredi 10:00, le client conteste : ticket rouvert « En cours », réouverture comptée",
    async () => {
      horloge = t("2026-10-02 10:00");
      await cycle.contester(
        A.tenantId,
        T1.id,
        { type: "CLIENT", clientId: (await ticket(T1.id)).clientId },
        "Je ne vois pas le crédit.",
      );
      const r = await ticket(T1.id);
      egal(r.statut, "EN_COURS", "statut");
      egal(r.nbReouvertures, 1, "réouvertures");
      egal(r.clotureAutoPrevueLe, null, "clôture automatique");
      egal(
        (await notifications(T1.id, "agent.contestation")).length,
        2,
        "agent prévenu",
      );
    },
  );
  await cr.doitReussir(
    "Échéance déjà dépassée : pas de seconde alerte après la réouverture",
    async () => {
      horloge = t("2026-10-02 10:05");
      const bilan = await taches.toutes(horloge);
      egal(bilan.alertesPreventives + bilan.depassements, 0, "alertes");
    },
  );
  await cr.doitReussir(
    "Nouvelle résolution vendredi 11:00, puis silence du client : clôture automatique mercredi 11:00, pas avant",
    async () => {
      horloge = t("2026-10-02 11:00");
      await cycle.resoudre(
        A.tenantId,
        T1.id,
        agentA,
        "Le crédit apparaîtra sous 24 h.",
      );
      horloge = t("2026-10-07 10:59");
      egal(
        (await taches.toutes(horloge)).cloturesAutomatiques,
        0,
        "clôtures à 10:59",
      );
      horloge = t("2026-10-07 11:01");
      egal(
        (await taches.toutes(horloge)).cloturesAutomatiques,
        1,
        "clôtures à 11:01",
      );
      const r = await ticket(T1.id);
      egal(r.statut, "CLOTUREE", "statut");
      egal(r.modeCloture, "AUTOMATIQUE", "mode");
      verifier(
        r.passeEnAttenteClient && r.escaladeeLe && r.nbReouvertures === 1,
        "pas une résolution au premier contact",
      );
    },
  );
  await cr.doitEtreRefuse(
    "Après la clôture, le client ne peut plus écrire",
    "TRANSITION_INTERDITE",
    () =>
      cycle.messageDuClient(
        A.tenantId,
        T1.id,
        { type: "CLIENT", clientId: A.client.id },
        "Encore moi",
      ),
  );
  await cr.doitEtreRefuse(
    "Après la clôture, le client ne peut plus contester",
    "TRANSITION_INTERDITE",
    async () => {
      const r = await ticket(T1.id);
      return cycle.contester(
        A.tenantId,
        T1.id,
        { type: "CLIENT", clientId: r.clientId },
        "Trop tard",
      );
    },
  );

  // =================================================================================
  cr.section("Réclamation urgente (§6.4, arbitrage 7)");

  let T3!: Awaited<ReturnType<typeof depot>>;
  await cr.doitReussir(
    "Dépôt « Fraude » (urgente par défaut) : superviseur et Admin Entreprise alertés aussitôt",
    async () => {
      horloge = t("2026-10-07 12:00");
      T3 = await depot(
        A,
        { nom: "Aminata Traoré", telephone: "0505050505" },
        fraude.id,
      );
      egal(T3.priorite, "URGENTE", "priorité");
      const n = await notifications(T3.id, "reclamation.urgente");
      egal(
        new Set(n.map((x) => x.destinataireUtilisateurId)).size,
        2,
        "destinataires de la banque",
      );
    },
  );
  await cr.doitReussir(
    "Le Super Admin reçoit une alerte de plateforme : banque, numéro, catégorie, heure, rien d'autre",
    async () => {
      const n = await notifications(null, "plateforme.urgente");
      egal(n.length, 2, "e-mail + in-app");
      verifier(
        n.every(
          (x) =>
            x.tenantId === null &&
            x.contenu ===
              `Banque Alpha · ${T3.numero} · Fraude · 07/10/2026 12:00`,
        ),
        n[0]?.contenu ?? "aucune",
      );
    },
  );
  await cr.doitReussir(
    "L'agent assigné ensuite reçoit l'alerte urgente à son tour, les autres ne la reçoivent pas deux fois",
    async () => {
      horloge = t("2026-10-07 12:05");
      await cycle.assigner(A.tenantId, T3.id, supA, A.agent.id);
      const n = await notifications(T3.id, "reclamation.urgente");
      egal(n.length, 6, "notifications urgentes (3 personnes × 2 canaux)");
    },
  );
  await cr.doitReussir(
    "Passer un ticket normal en urgent alerte les quatre destinataires, une seule fois même si on recommence",
    async () => {
      const T4 = await depot(A, {
        nom: "Koné Ali",
        email: "ali.kone@exemple.ci",
      });
      await cycle.assigner(A.tenantId, T4.id, supA, A.agent.id);
      await cycle.changerPriorite(A.tenantId, T4.id, agentA, "URGENTE");
      await cycle.changerPriorite(A.tenantId, T4.id, agentA, "NORMALE");
      await cycle.changerPriorite(A.tenantId, T4.id, supA, "URGENTE");
      egal(
        (await notifications(T4.id, "reclamation.urgente")).length,
        6,
        "agent + superviseur + admin",
      );
      egal(
        await proprietaire.notification.count({
          where: { modele: "plateforme.urgente" },
        }),
        4,
        "Super Admin : T3 et T4",
      );
    },
  );

  // =================================================================================
  cr.section("Clôture forcée et escalade manuelle (§6.2, §6.3)");

  await cr.doitEtreRefuse(
    "Un agent ne peut pas clôturer de force",
    "ACTEUR_NON_AUTORISE",
    () =>
      cycle.cloturerDeForce(A.tenantId, T3.id, agentA, "DOUBLON", "Doublon"),
  );
  await cr.doitEtreRefuse(
    "Clôture forcée sans précision",
    "PRECISION_REQUISE",
    () => cycle.cloturerDeForce(A.tenantId, T3.id, supA, "DOUBLON", "  "),
  );
  await cr.doitReussir(
    "Escalade manuelle par l'agent : le superviseur est prévenu",
    async () => {
      await cycle.escalader(
        A.tenantId,
        T3.id,
        agentA,
        "Montant élevé, besoin de validation.",
      );
      const r = await ticket(T3.id);
      egal(r.escaladeeVersId, A.superviseur.id, "escaladé vers");
      egal(
        (await notifications(T3.id, "superviseur.escalade")).length,
        2,
        "superviseur prévenu",
      );
    },
  );
  await cr.doitReussir(
    "Clôture forcée par le superviseur (doublon) depuis « Ouverte », client prévenu",
    async () => {
      horloge = t("2026-10-07 12:30");
      await cycle.cloturerDeForce(
        A.tenantId,
        T3.id,
        supA,
        "DOUBLON",
        "Doublon de la réclamation déposée en agence.",
      );
      const r = await ticket(T3.id);
      verifier(
        r.statut === "CLOTUREE" &&
          r.modeCloture === "FORCEE" &&
          r.motifClotureForcee === "DOUBLON" &&
          r.clotureParId === A.superviseur.id,
        "clôture forcée",
      );
      egal(
        (await notifications(T3.id, "client.cloture"))
          .map((n) => n.canal)
          .join(","),
        "SMS",
        "client prévenu par SMS (pas d'e-mail)",
      );
    },
  );

  // =================================================================================
  cr.section(
    "La base refuse ce que la machine refuse (trigger de transitions)",
  );

  const sqlEnA = (
    requete: (
      tx: Parameters<Parameters<typeof transactionEn>[2]>[0],
    ) => Promise<unknown>,
  ) => transactionEn(base, contexte.banque(A.tenantId), requete);
  await cr.doitEtreRefuse(
    "Rouvrir en SQL un ticket clôturé",
    /clôturée : plus aucune modification/,
    () =>
      sqlEnA(
        (tx) =>
          tx.$executeRaw`UPDATE reclamation SET statut = 'EN_COURS' WHERE id = ${T1.id}::uuid`,
      ),
  );
  await cr.doitEtreRefuse(
    "Passer en SQL de « Ouverte » à « Résolue »",
    /Transition interdite/,
    async () => {
      const T5 = await depot(A, { nom: "Test SQL", email: "sql@exemple.ci" });
      return sqlEnA(
        (tx) =>
          tx.$executeRaw`UPDATE reclamation SET statut = 'RESOLUE' WHERE id = ${T5.id}::uuid`,
      );
    },
  );
  await cr.doitEtreRefuse(
    "Créer en SQL une réclamation directement « En cours »",
    /créée au statut OUVERTE/,
    () =>
      sqlEnA((tx) =>
        tx.reclamation.create({
          data: {
            ...champsMinimaux(A),
            numero: "ALP-2026-000900",
            statut: "EN_COURS",
            agentId: A.agent.id,
            prisEnChargeLe: horloge,
          },
        }),
      ),
  );

  // =================================================================================
  cr.section("Jours fériés et plafond de tickets (§6.4, §6.7)");

  await cr.doitReussir(
    "Banque B, lundi 28/09 férié : dépôt vendredi 10:00 → échéance mercredi 11:00",
    async () => {
      await proprietaire.jourFerie.create({
        data: {
          tenantId: B.tenantId,
          date: new Date("2026-09-28"),
          libelle: "Férié de test",
        },
      });
      const decouverte = await proprietaire.plan.create({
        data: { code: "DECOUVERTE", nom: "Découverte", plafondTicketsMois: 1 },
      });
      await proprietaire.banque.update({
        where: { id: B.tenantId },
        data: { planId: decouverte.id },
      });
      horloge = t("2026-09-25 10:00");
      const d = await depot(B, {
        nom: "Client B",
        email: "client.b@exemple.ci",
      });
      egal(local(d.echeanceSlaLe), "2026-09-30 11:00", "échéance");
    },
  );
  await cr.doitReussir(
    "Plafond de 1 ticket/mois dépassé : dépôts acceptés, Super Admin prévenu une seule fois",
    async () => {
      horloge = t("2026-09-25 11:00");
      await depot(B, { nom: "Client B", email: "client.b@exemple.ci" });
      await depot(B, { nom: "Client B", email: "client.b@exemple.ci" });
      egal(
        await proprietaire.reclamation.count({
          where: { tenantId: B.tenantId },
        }),
        3,
        "dépôts",
      );
      egal(
        await proprietaire.notification.count({
          where: { modele: "plateforme.plafond" },
        }),
        2,
        "alerte plafond (e-mail + in-app)",
      );
    },
  );

  // =================================================================================
  cr.section("Tâches planifiées concurrentes");

  await cr.doitReussir(
    "Deux workers en parallèle : chaque ticket échu reçoit exactement une alerte",
    async () => {
      horloge = t("2026-12-31 12:00");
      const attendus = await proprietaire.reclamation.count({
        where: {
          statut: { in: ["OUVERTE", "EN_COURS"] },
          alertePreventiveEnvoyeeLe: null,
          alertePreventiveLe: { lte: horloge },
        },
      });
      verifier(attendus >= 4, `au moins 4 tickets échus (obtenu ${attendus})`);
      const [x, y] = await Promise.all([
        taches.alertesPreventives(horloge),
        taches.alertesPreventives(horloge),
      ]);
      egal(x + y, attendus, "alertes traitées");
      const doublons = await proprietaire.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM (SELECT reclamation_id FROM reclamation_evenement WHERE type = 'ALERTE_SLA_PREVENTIVE'
                                  GROUP BY reclamation_id HAVING count(*) > 1) d`;
      egal(Number(doublons[0].n), 0, "tickets alertés deux fois");
    },
  );

  await cr.doitReussir(
    "Journal d'audit des deux banques toujours intègre après tout le parcours",
    async () => {
      for (const b of [A, B]) {
        const [v] = await proprietaire.$queryRaw<
          { valide: boolean; lignes: bigint }[]
        >`SELECT * FROM verifier_chaine_audit(${`banque:${b.tenantId}`})`;
        verifier(
          v.valide && Number(v.lignes) > 0,
          `chaîne ${b.banque.prefixeTickets}`,
        );
      }
    },
  );

  await viderLaBase(proprietaire);
  cr.terminer();
}

function champsMinimaux(b: BanqueDeTest) {
  return {
    tenantId: b.tenantId,
    jetonSuivi: `test-${Date.now()}`,
    clientId: b.client.id,
    categorieId: b.categorie.id,
    pointDepotId: b.pointQr.id,
    canal: "QR_CODE" as const,
    description: "x",
    priorite: "NORMALE" as const,
    consentementLe: horloge,
    consentementVersion: "2026-09",
    delaiCibleMinutes: 60,
    echeanceSlaLe: horloge,
    alertePreventiveLe: horloge,
    creeLe: horloge,
  };
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => Promise.all([proprietaire.$disconnect(), base.$disconnect()]));
