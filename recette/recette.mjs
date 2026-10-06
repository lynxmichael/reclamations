#!/usr/bin/env node
/**
 * Recette automatique (étape 10) : relance toutes les suites de tests et écrit le rapport des
 * 11 critères de la section 10 du cahier des charges, preuve par preuve (docs/recette/rapport.md).
 *
 *   docker compose run --rm recette          tout, dans un conteneur (≈ 15 minutes)
 *   node recette/recette.mjs [--sans-navigateur] [--sans-sauvegarde] [--sans-audit] [--sortie FICHIER]
 *   node recette/recette.mjs --seulement sauvegarde --sans-audit     une suite seulement (identifiants : SUITES)
 *
 * Hors Docker : Node.js 22, dépendances installées (npm ci) dans backend/ et frontend/, PostgreSQL
 * et Redis joignables par les variables de backend/.env, dont DATABASE_URL sur une base jetable
 * (reclamations_verif) ; navigateurs Playwright ; pour l'essai de sauvegarde, psql et pg_dump 16,
 * age, rclone et jq. Code de sortie 1 si un critère ou une suite échoue.
 *
 * La recette contractuelle se fait ensuite à la main sur l'environnement de démonstration, avec
 * docs/recette/cahier-de-recette.md : ce rapport en est la partie automatique.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const RACINE = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const option = (nom) => args.includes(nom);
const iSortie = args.indexOf('--sortie');
const sortie = resolve(RACINE, iSortie >= 0 && args[iSortie + 1] ? args[iSortie + 1] : 'docs/recette/rapport.md');
const TRAVAIL = join(RACINE, 'recette', '.resultats');
rmSync(TRAVAIL, { recursive: true, force: true });
mkdirSync(TRAVAIL, { recursive: true });

// Variables de backend/.env, sans écraser celles déjà définies (conteneur, CI)
const env = { ...process.env };
if (existsSync(join(RACINE, 'backend/.env'))) {
  for (const ligne of readFileSync(join(RACINE, 'backend/.env'), 'utf8').split(/\r?\n/)) {
    const m = ligne.match(/^\s*([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/);
    if (m && env[m[1]] === undefined) env[m[1]] = m[2];
  }
}
delete env.PORT;
const MESURES = join(TRAVAIL, 'mesures.jsonl');

// ---- Suites ---------------------------------------------------------------------------------------------
const baseJetable = (() => {
  try {
    return new URL(env.DATABASE_URL ?? '').pathname.slice(1);
  } catch {
    return '';
  }
})();
const pg = (() => {
  try {
    const u = new URL(env.DATABASE_URL);
    return { PGHOST: u.hostname, PGPORT: u.port || '5432', PGUSER: decodeURIComponent(u.username), PGPASSWORD: decodeURIComponent(u.password) };
  } catch {
    return {};
  }
})();
const outilsSauvegarde = ['psql', 'pg_dump', 'pg_restore', 'age', 'age-keygen', 'rclone', 'jq', 'curl']
  .filter((o) => spawnSync('sh', ['-c', `command -v ${o}`]).status !== 0);

const SUITES = [
  { id: 'contrat', libelle: 'Contrat d\'API (OpenAPI 3.1, Redocly)', cwd: 'backend', cmd: 'npm run -s contrat:verifier' },
  { id: 'backend-types', libelle: 'Backend : types TypeScript', cwd: 'backend', cmd: 'npm run -s typecheck' },
  { id: 'backend-unitaires', libelle: 'Backend : tests unitaires', cwd: 'backend', cmd: 'npx vitest run --reporter=json --outputFile={json}', format: 'vitest' },
  {
    id: 'verifications', libelle: 'PostgreSQL : intégrité, sécurité (RLS), cycle de vie et SLA', cwd: 'backend',
    cmd: 'npx tsx scripts/recreer-base-jetable.ts && npm run -s verifier',
    refus: /verif|test/.test(baseJetable) ? null : `DATABASE_URL doit désigner une base jetable (reclamations_verif), pas « ${baseJetable || '?'} »`,
  },
  { id: 'backend-e2e', libelle: 'API de bout en bout (base recréée, jeu des deux banques)', cwd: 'backend', cmd: 'npx vitest run -c vitest.e2e.config.mts --reporter=json --outputFile={json}', format: 'vitest', env: { RECETTE_MESURES: MESURES } },
  { id: 'frontend-types', libelle: 'Frontend : types TypeScript', cwd: 'frontend', cmd: 'npm run -s typecheck' },
  { id: 'frontend-unitaires', libelle: 'Frontend : tests unitaires', cwd: 'frontend', cmd: 'npx vitest run --reporter=json --outputFile={json}', format: 'vitest' },
  { id: 'construction', libelle: 'Construction de production (API, worker, console, portail)', cwd: '.', cmd: '(cd backend && npm run -s build) && (cd frontend && npm run -s build:applications)' },
  {
    id: 'navigateur', libelle: 'Écrans dans Chromium (API réelle, CSP de production)', cwd: 'frontend', cmd: 'npx playwright test --reporter=json', format: 'playwright',
    envJson: 'PLAYWRIGHT_JSON_OUTPUT_NAME', saute: option('--sans-navigateur') && 'option --sans-navigateur',
  },
  {
    id: 'sauvegarde', libelle: 'Sauvegarde chiffrée et restauration (docker/sauvegarde/essai.sh)', cwd: '.',
    // Base source neuve : celle des tests de bout en bout contient une ligne d'audit modifiée exprès (critère 9)
    cmd: '(cd backend && npx tsx scripts/recreer-base-jetable.ts --base reclamations_test_sauvegarde --semer) && bash docker/sauvegarde/essai.sh',
    // Moins d'une minute d'habitude ; chaque étape de l'essai est de toute façon bornée à 2 minutes
    minutes: 20,
    env: { ...pg, ESSAI_SOURCE: 'reclamations_test_sauvegarde', ESSAI_JOURNAL: join(TRAVAIL, 'sauvegarde-detail.log'), ESSAI_MDP_APP: (() => { try { return decodeURIComponent(new URL(env.APP_DATABASE_URL).password); } catch { return 'reclamations_app'; } })() },
    saute: option('--sans-sauvegarde') ? 'option --sans-sauvegarde' : outilsSauvegarde.length ? `outils absents : ${outilsSauvegarde.join(', ')}` : false,
    // Une ancienne version de l'essai (avant le 30/09) prenait rclone 1.60 pour un serveur S3 et attendait sans fin
    refus: readFileSync(join(RACINE, 'docker/sauvegarde/essai.sh'), 'utf8').includes('ESSAI_JOURNAL') ? null
      : 'docker/sauvegarde/essai.sh n\'est pas à jour : prenez celui de la dernière archive de l\'étape 10',
  },
];

// Chaque suite tourne détachée du terminal (aucune invite de mot de passe ne peut la bloquer), avec
// son journal écrit au fil de l'eau, une ligne de progression chaque minute et une durée maximale :
// au-delà, tout son groupe de processus est arrêté et la suite est notée en échec.
function lancer(s) {
  const json = join(TRAVAIL, `${s.id}.json`);
  const journal = join(TRAVAIL, `${s.id}.log`);
  if (s.saute) return Promise.resolve({ ...s, statut: 'saute', raison: s.saute });
  if (s.refus) {
    console.log(`  ${s.libelle} … ÉCHEC : ${s.refus}`);
    return Promise.resolve({ ...s, statut: 'echec', raison: s.refus });
  }
  const limite = s.minutes ?? 30;
  process.stdout.write(`  ${s.libelle} … `);
  const debut = Date.now();
  const flux = createWriteStream(journal);
  let texte = '';
  const enfant = spawn('sh', ['-c', s.cmd.replace('{json}', json)], {
    cwd: join(RACINE, s.cwd),
    env: { ...env, ...s.env, ...(s.envJson ? { [s.envJson]: json } : {}), FORCE_COLOR: '0', NO_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  const recevoir = (d) => { texte += d; flux.write(d); };
  enfant.stdout.setEncoding('utf8').on('data', recevoir);
  enfant.stderr.setEncoding('utf8').on('data', recevoir);
  const arreter = (signal) => { try { process.kill(-enfant.pid, signal); } catch { /* déjà terminé */ } };
  let depasse = false;
  const progression = setInterval(() => process.stdout.write(`${Math.round((Date.now() - debut) / 60000)} min … `), 60_000);
  const minuterie = setTimeout(() => { depasse = true; arreter('SIGTERM'); setTimeout(() => arreter('SIGKILL'), 10_000); }, limite * 60_000);
  return new Promise((fin) => enfant.on('exit', (code) => {
    clearInterval(progression);
    clearTimeout(minuterie);
    arreter('SIGKILL'); // processus laissés en arrière-plan par la suite
    setTimeout(() => {
      flux.end();
      const duree = Math.round((Date.now() - debut) / 1000);
      const res = { ...s, statut: code === 0 && !depasse ? 'ok' : 'echec', duree, journal: relative(RACINE, journal), texte, tests: [] };
      if (depasse) res.raison = `arrêtée après ${limite} minutes (${relative(RACINE, journal)})`;
      if (s.format && existsSync(json)) res.tests = s.format === 'vitest' ? testsVitest(json) : testsPlaywright(json);
      console.log(`${res.statut === 'ok' ? 'ok' : 'ÉCHEC'} (${duree} s${res.tests.length ? `, ${res.tests.filter((t) => t.ok).length}/${res.tests.length} tests` : ''}${depasse ? `, arrêtée après ${limite} min` : ''})`);
      fin(res);
    }, 200);
  }));
}

function testsVitest(fichier) {
  const d = JSON.parse(readFileSync(fichier, 'utf8'));
  return d.testResults.flatMap((f) => f.assertionResults.map((t) => ({
    fichier: relative(RACINE, f.name), titre: [...t.ancestorTitles, t.title].join(' › '), ok: t.status === 'passed', saute: t.status === 'skipped' || t.status === 'pending',
  })));
}

function testsPlaywright(fichier) {
  const d = JSON.parse(readFileSync(fichier, 'utf8'));
  const tests = [];
  const parcourir = (suite, chemin, fichierSuite) => {
    const f = suite.file ?? fichierSuite;
    for (const spec of suite.specs ?? []) {
      tests.push({ fichier: `frontend/tests/navigateur/${f}`, titre: [...chemin, spec.title].join(' › '), ok: spec.ok && spec.tests.every((t) => t.status === 'expected'), saute: spec.tests.every((t) => t.status === 'skipped') });
    }
    for (const s of suite.suites ?? []) parcourir(s, s.title === (s.file ?? '') ? chemin : [...chemin, s.title], f);
  };
  for (const s of d.suites ?? []) parcourir(s, [], s.file);
  return tests;
}

// ---- Critères de la section 10 et leurs preuves ------------------------------------------------------------
// Chaque preuve désigne des tests par leur fichier et leur titre ; un critère est vérifié si chacune
// de ses preuves trouve au moins un test et que tous ceux qu'elle trouve passent.
const e2e = (f) => `backend/test/e2e/${f}.e2e.test.ts`;
const nav = (f) => `frontend/tests/navigateur/${f}.spec.ts`;
const CRITERES = [
  ['Une réclamation déposée par QR code est traitée puis clôturée de bout en bout, avec numéro, accusé de réception par e-mail et par SMS.', [
    [e2e('parcours'), /parcours complet d'une réclamation déposée par QR code/],
    [nav('1-parcours'), /./],
  ]],
  ['Le client voit à tout moment l\'étape exacte et horodatée de sa réclamation.', [
    [e2e('parcours'), /lien de suivi montre la chronologie|le client lit sa réclamation/],
    [nav('1-parcours'), /le client lit la réponse/],
    [nav('5-portail'), /./],
  ]],
  ['Une réclamation urgente alerte immédiatement l\'agent, le superviseur, l\'Admin Entreprise et le Super Admin ; l\'alerte du Super Admin ne contient ni nom ni description.', [
    [e2e('back-office'), /réclamation urgente \(critère 3\)/],
    ['verifications'],
  ]],
  ['Un agent de la banque A qui demande un ticket de la banque B reçoit 404 ; la même lecture, faite directement en SQL, ne renvoie rien.', [
    [e2e('securite'), /cloisonnement entre banques/],
    ['verifications'],
  ]],
  ['Le délai SLA exclut les heures non ouvrées et les jours fériés, et se suspend en « En attente client ».', [
    [e2e('worker'), /l'échéance ne compte que les heures ouvrées/],
    [e2e('parcours'), /En attente client.*chrono en pause/],
    ['backend/src/domaine/temps-ouvre/', /./],
    ['backend/src/domaine/reclamation/sla', /./],
  ]],
  ['L\'alerte préventive part à 75 % du délai, l\'escalade au dépassement, chacune une seule fois.', [
    [e2e('worker'), /alerte préventive à 75 %/],
  ]],
  ['Une résolution non contestée est clôturée automatiquement après 5 jours ; une contestation rouvre le ticket.', [
    [e2e('worker'), /clôture automatique et contestation/],
    [e2e('back-office'), /contestation dans le délai/],
    [nav('5-portail'), /le client conteste/],
  ]],
  ['Le taux de résolution au premier contact correspond à la définition de la section 6.6.', [
    [e2e('reporting'), /critère 8 : premier contact/],
    ['verifications'],
  ]],
  ['Le journal d\'audit restitue toutes les actions d\'une réclamation ; une ligne modifiée à la main est détectée par la vérification de la chaîne.', [
    [e2e('parametrage'), /journal d'audit de la banque \(critère 9\)/],
    [nav('1-parcours'), /journal d'audit, chaîne intacte/],
    [nav('4-plateforme'), /journal vérifié par banque/],
  ]],
  ['Les opérations courantes répondent en moins d\'une seconde.', [
    [e2e('performance'), /moins d'une seconde/],
  ]],
  ['Les listes s\'exportent en CSV.', [
    [e2e('reporting'), /export CSV \(critère 11\)|l'agent exporte ses réclamations/],
    [nav('7-reporting'), /export CSV|exportée en CSV|exporte ses réclamations/],
  ]],
];

// Phase 2 (étape 14) : un critère par fonction livrée, numérotés à la suite de la section 10
const CRITERES_PHASE_2 = [
  ['Étape 15 — Enquêtes de satisfaction : à la clôture confirmée ou automatique, le message de clôture porte le lien d\'une enquête (satisfaction de 1 à 5, recommandation de 0 à 10, commentaire facultatif), à laquelle le client répond une seule fois dans les 7 jours ; le tableau de bord donne le taux de réponse, les satisfaits, la note moyenne et le NPS, avec les filtres et par agent ; l\'agent ne voit que les siens ; le Super Admin ne voit que des totaux par banque, jamais les commentaires.', [
    [e2e('satisfaction'), /./],
    [nav('8-satisfaction'), /./],
    ['verifications'],
  ]],
  ['Étape 16 — Attribution et escalade automatiques : ouvertes banque par banque par le Super Admin ; l\'Admin Entreprise confie chaque catégorie et chaque agence à un groupe d\'agents ; une nouvelle réclamation va à l\'agent disponible le moins chargé (mode automatique, pendant les heures d\'ouverture) ou lui est proposée (mode suggestion, le superviseur valide) ; un agent absent ne reçoit rien ; sans agent disponible, elle reste dans la file du superviseur ; au-delà du seuil de la catégorie ou de la banque, l\'Admin Entreprise est prévenu, après les alertes à 75 % et au dépassement.', [
    [e2e('attribution'), /./],
    [nav('9-attribution'), /./],
    ['verifications'],
  ]],
  ['Étape 17 — Conversations et chat web : ouverts banque par banque par le Super Admin ; le client identifié par le lien de suivi et le code écrit à la banque dans un chat intégré au portail (même domaine, sans script tiers) et voit les réponses arriver ; une conversation par réclamation, isolée par banque, jamais lue par le Super Admin ; les agents répondent depuis une boîte de réception (à répondre, non lues), l\'agent ne voyant que ses réclamations ; une rafale de messages n\'alerte l\'agent qu\'une fois ; une réponse lue dans le chat n\'envoie ni e-mail ni SMS, une réponse non lue 2 minutes après en envoie un seul.', [
    [e2e('conversations'), /./],
    [nav('10-conversations'), /./],
    ['backend/src/domaine/conversation', /./],
    ['verifications'],
  ]],
  ['Étape 18 — Assistant IA de première ligne : ouvert banque par banque par le Super Admin, avec le chat web ; sur le portail, l\'assistant se présente comme automatique, répond aux questions fréquentes avec les réponses écrites par la banque, prépare la réclamation que le client relit et envoie lui-même, et passe la main à un conseiller dès que le client l\'écrit ; il ne promet ni remboursement ni délai, n\'annonce aucun statut, ne conseille pas et ne demande aucun code ; les données personnelles sont masquées avant tout envoi à l\'IA ; sans IA, ou si elle échoue, des règles répondent ; l\'agent obtient un brouillon vérifié qu\'il envoie lui-même ; chaque appel est journalisé sans contenu, avec un plafond quotidien par banque, et l\'usage du mois est visible par Makor ; le fournisseur se choisit par un banc d\'essai pondéré.', [
    [e2e('assistant'), /./],
    [nav('11-assistant'), /./],
    ['backend/src/domaine/ia', /./],
    ['backend/src/infrastructure/ia', /./],
    ['backend/scripts/banc-ia', /./],
    ['verifications'],
  ]],
  ['Étape 19 — Activité des agences et double authentification au choix de la banque : l\'Admin Entreprise et les superviseurs voient chaque agence de la banque sur la période (réclamations, urgentes, résolues, délais, respect du SLA, charge en ce moment, satisfaction, catégories, agents, QR codes), les lignes faisant le total du tableau de bord, et ouvrent son tableau de bord ou ses réclamations ; la double authentification est facultative par défaut, chacun l\'active ou la désactive depuis « Mon compte » avec un code ; l\'Admin Entreprise, l\'ayant activée lui-même, peut l\'exiger de tout le personnel (sessions sans code fermées, activation à la connexion) puis la rendre facultative ; le Super Admin la garde toujours.', [
    [e2e('authentification'), /étape 19|facultative|Mon compte|rendre obligatoire/],
    [e2e('reporting'), /activité des agences/],
    [nav('12-agences-securite'), /./],
    ['verifications'],
  ]],
  ['Étape 20 — WhatsApp Business et SMS entrant : ouverts banque par banque par le Super Admin, avec le chat web, une fois le numéro de la banque raccordé (WhatsApp : son propre compte, jeton chiffré) ; le client qui écrit est reconnu à son numéro, son message entre dans la conversation de sa réclamation (au choix s\'il en a plusieurs) ou prépare avec lui une réclamation qu\'il envoie en répondant OUI après le lien de la politique de données ; l\'agent répond depuis la boîte de réception et la réponse part là où le client a écrit (WhatsApp dans les 24 h, SMS du numéro de la banque), sinon dans son suivi avec un avis ; OUI clôture une réclamation résolue, tout autre message la conteste ; webhooks signés, chaque message traité une seule fois, réponses automatiques plafonnées ; l\'Admin Entreprise publie ses numéros, le Super Admin voit les messages du mois et ceux facturés par Meta, jamais leur contenu.', [
    [e2e('canaux'), /./],
    [nav('13-whatsapp-sms'), /./],
    ['backend/src/domaine/canaux', /./],
    ['backend/src/domaine/sms', /./],
    ['backend/src/infrastructure/canaux', /./],
    ['verifications'],
  ]],
];

// ---- Exécution ------------------------------------------------------------------------------------------------
const debut = new Date();
console.log(`Recette automatique — ${debut.toISOString()}\n`);
// --seulement sauvegarde,navigateur : relance ces suites seulement (les autres sont notées non lancées)
const iSeulement = args.indexOf('--seulement');
const seulement = iSeulement >= 0 ? (args[iSeulement + 1] ?? '').split(',') : null;
const resultats = [];
for (const s of SUITES) resultats.push(await lancer(seulement && !seulement.includes(s.id) ? { ...s, saute: 'non demandée, --seulement' } : s));
const tousLesTests = resultats.flatMap((r) => r.tests ?? []);
const suite = (id) => resultats.find((r) => r.id === id);

// Vérifications PostgreSQL : « N vérifications réussies, M en échec. » à la fin de chaque script
function bilanVerifications() {
  const lignes = [...(suite('verifications')?.texte ?? '').matchAll(/(\d+) vérifications réussies, (\d+) en échec/g)];
  return { lignes: lignes.map((m) => m[0]), reussis: lignes.reduce((t, m) => t + Number(m[1]), 0), echecs: lignes.reduce((t, m) => t + Number(m[2]), 0) };
}
function evaluerPreuve([cible, titre]) {
  if (cible === 'verifications') {
    const b = bilanVerifications();
    return { cible: 'vérifications PostgreSQL', trouves: b.reussis + b.echecs, reussis: suite('verifications')?.statut === 'ok' ? b.reussis : 0 };
  }
  const tests = tousLesTests.filter((t) => t.fichier.startsWith(cible) && titre.test(t.titre) && !t.saute);
  return { cible, trouves: tests.length, reussis: tests.filter((t) => t.ok).length };
}
const evaluer = (liste, premier) => liste.map(([libelle, preuves], i) => {
  const p = preuves.map(evaluerPreuve);
  const navigateurSaute = suite('navigateur').statut === 'saute';
  const utiles = p.filter((x) => !(navigateurSaute && x.cible.startsWith('frontend/tests/navigateur')));
  return { n: premier + i, libelle, preuves: p, ok: utiles.length > 0 && utiles.every((x) => x.trouves > 0 && x.reussis === x.trouves) };
});
const criteres = evaluer(CRITERES, 1);
const criteresPhase2 = evaluer(CRITERES_PHASE_2, CRITERES.length + 1);

// Mesures du critère 10, audit des dépendances, taille des écrans
const mesures = existsSync(MESURES) ? readFileSync(MESURES, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
function audit(dossier, production) {
  if (option('--sans-audit')) return null;
  const r = spawnSync('npm', ['audit', '--json', ...(production ? ['--omit=dev'] : [])], { cwd: join(RACINE, dossier), encoding: 'utf8', env, timeout: 120_000 });
  try {
    const j = JSON.parse(r.stdout);
    const v = j.metadata.vulnerabilities;
    // Paquets « dev ou optionnels » seulement : retirés de l'image de l'application (backend/Dockerfile)
    const verrou = JSON.parse(readFileSync(join(RACINE, dossier, 'package-lock.json'), 'utf8')).packages;
    const paquets = Object.values(j.vulnerabilities ?? {}).map((x) => ({ nom: x.name, gravite: x.severity, horsImage: x.nodes.every((n) => verrou[n]?.devOptional || verrou[n]?.dev) }));
    return { critique: v.critical, elevee: v.high, moyenne: v.moderate, faible: v.low, paquets };
  } catch {
    return { erreur: (r.stderr || r.stdout || 'npm audit indisponible').trim().split('\n').pop() };
  }
}
const audits = option('--sans-audit') ? [] : [['backend', true], ['backend', false], ['frontend', true], ['frontend', false]].map(([d, p]) => ({ dossier: d, production: p, ...audit(d, p) }));
function detailAudit(a) {
  if (!a.production || !a.paquets?.length) return '';
  const hors = a.paquets.filter((p) => p.horsImage);
  const dans = a.paquets.filter((p) => !p.horsImage);
  return `${hors.length ? ` ; ${hors.map((p) => p.nom).join(', ')} : CLI Prisma et ses dépendances (image des migrations seulement), retirés de l'image de l'application` : ''}${dans.length ? ` ; **dans l'image de l'application : ${dans.map((p) => `${p.nom} (${p.gravite})`).join(', ')}**` : ''}`;
}
function tailleGzip(dossier) {
  const d = join(RACINE, 'frontend/dist', dossier, 'assets');
  if (!existsSync(d)) return null;
  const f = readdirSync(d).filter((n) => /\.(js|css)$/.test(n));
  return { gzip: f.reduce((t, n) => t + gzipSync(readFileSync(join(d, n))).length, 0), fichiers: f.length };
}

// ---- Rapport ----------------------------------------------------------------------------------------------------
const version = JSON.parse(readFileSync(join(RACINE, 'backend/package.json'), 'utf8')).version;
const coche = (ok) => (ok ? '✅' : '❌');
const ko = (n) => `${Math.round(n / 1024)} Ko`;
const valides = criteres.filter((c) => c.ok).length;
const suitesKo = resultats.filter((r) => r.statut === 'echec');
const L = [];
L.push('# Rapport de recette automatique', '');
L.push(`Généré par \`recette/recette.mjs\` le ${debut.toLocaleString('fr-FR', { timeZone: 'Africa/Abidjan', dateStyle: 'long', timeStyle: 'short' })} (heure d'Abidjan), version ${version}, Node.js ${process.versions.node}, en ${Math.round((Date.now() - debut.getTime()) / 60000)} minutes.`, '');
const valides2 = criteresPhase2.filter((c) => c.ok).length;
L.push(`**${valides} critère(s) sur ${criteres.length} vérifié(s) automatiquement**, et ${valides2} sur ${criteresPhase2.length} de la phase 2 ; ${tousLesTests.filter((t) => t.ok).length} tests réussis sur ${tousLesTests.filter((t) => !t.saute).length}${suitesKo.length ? ` ; suite(s) en échec : ${suitesKo.map((s) => s.libelle).join(', ')}` : ' ; toutes les suites passent'}.`, '');
L.push('Ce rapport est la partie automatique de la recette. Le MVP est accepté quand chaque critère est vérifié sur l\'environnement de démonstration, avec deux banques de test (section 10 du cahier des charges) : [cahier de recette](cahier-de-recette.md).', '');

const tableauCriteres = (liste) => {
  L.push('| | Critère | Preuves (tests réussis / tests trouvés) |', '|---|---|---|');
  for (const c of liste) {
    const preuves = c.preuves.map((p) => `${p.reussis}/${p.trouves} \`${p.cible.replace('backend/test/e2e/', '').replace('frontend/tests/navigateur/', 'navigateur/')}\``).join('<br>');
    L.push(`| ${coche(c.ok)} ${c.n} | ${c.libelle} | ${preuves} |`);
  }
  L.push('');
};
L.push('## Critères de la section 10', '');
tableauCriteres(criteres);
if (mesures.length) {
  L.push('### Critère 10 : mesures', '', 'Banque de 1 000 réclamations, 20 appels par opération à travers toute la pile (HTTP, contrat, RLS, Prisma) ; seuil : p95 sous 1 000 ms.', '');
  L.push('| Opération | p95 | max |', '|---|---:|---:|');
  for (const m of mesures) L.push(`| ${m.operation} | ${m.p95} ms | ${m.max} ms |`);
  L.push('');
}

L.push('## Critères de la phase 2', '');
L.push(`${criteresPhase2.filter((c) => c.ok).length} critère(s) sur ${criteresPhase2.length} vérifié(s) : un par fonction de la phase 2 livrée (cadrage de l'étape 14), et l'étape 19 ajoutée à la demande du client (activité des agences, double authentification au choix de la banque).`, '');
tableauCriteres(criteresPhase2);
L.push('## Suites', '');
L.push('| Suite | Résultat | Tests | Durée |', '|---|---|---:|---:|');
for (const r of resultats) {
  const n = r.tests?.length ? `${r.tests.filter((t) => t.ok).length}/${r.tests.filter((t) => !t.saute).length}` : '';
  const res = r.statut === 'ok' ? '✅ réussie' : r.statut === 'saute' ? `➖ non lancée (${r.raison})` : `❌ en échec${r.raison ? ` : ${r.raison}` : ` (${r.journal})`}`;
  L.push(`| ${r.libelle} | ${res} | ${n} | ${r.duree !== undefined ? `${r.duree} s` : ''} |`);
}
L.push('');
const verifs = bilanVerifications();
if (verifs.lignes.length) L.push(`Vérifications PostgreSQL (intégrité, sécurité, cycle de vie) : ${verifs.lignes.join(' · ')}.`, '');
const essai = (suite('sauvegarde').texte ?? '').split('\n').find((l) => /contrôles réussis/.test(l));
if (essai) L.push(`${essai.trim()} (chiffrement, copie hors du VPS et rétention, restauration vérifiée, journal falsifié et pièce perdue détectés, remplacement de la base ; copies verrouillées, intrusion avec les clés du compartiment détectée et sans perte).`, '');

L.push('## Mise en production', '');
const tc = tailleGzip('console');
const tp = tailleGzip('portail');
if (tc && tp) L.push(`- Écrans construits (JavaScript et CSS compressés) : console ${ko(tc.gzip)}, portail ${ko(tp.gzip)}.`);
for (const a of audits) {
  const portee = a.production ? 'dépendances de production' : 'toutes les dépendances (outils de développement compris)';
  L.push(a.erreur
    ? `- \`npm audit\` ${a.dossier}, ${portee} : non disponible (${a.erreur}).`
    : `- \`npm audit\` ${a.dossier}, ${portee} : ${a.critique} critique(s), ${a.elevee} élevée(s), ${a.moyenne} moyenne(s), ${a.faible} faible(s)${detailAudit(a)}.`);
}
L.push('- Contrôle d\'un déploiement réel (HTTPS, en-têtes, santé, conteneurs, pare-feu, sauvegarde) : `./deploiement/verifier.sh --local`, sur le VPS (docs/exploitation.md).', '');

const echecs = tousLesTests.filter((t) => !t.ok && !t.saute);
if (echecs.length) {
  L.push('## Tests en échec', '');
  for (const t of echecs.slice(0, 50)) L.push(`- \`${t.fichier}\` : ${t.titre}`);
  L.push('');
}
L.push(`Journaux complets de cette exécution : \`recette/.resultats/\` (${readdirSync(TRAVAIL).filter((f) => f.endsWith('.log')).length} fichiers, non versionnés).`, '');

mkdirSync(resolve(sortie, '..'), { recursive: true });
writeFileSync(sortie, `${L.join('\n')}\n`);
console.log(`\n${valides}/${criteres.length} critères vérifiés (phase 2 : ${valides2}/${criteresPhase2.length}), ${suitesKo.length} suite(s) en échec — rapport : ${relative(RACINE, sortie)}`);
process.exit(valides === criteres.length && valides2 === criteresPhase2.length && suitesKo.length === 0 ? 0 : 1);

