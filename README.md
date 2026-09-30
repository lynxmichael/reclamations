# Plateforme de gestion des réclamations

Makor Telecoms · Solution 1 · SaaS multi-tenant pour les banques.
Référence : cahier des charges consolidé (version du 25/09/2026).

## Avancement

| N° | Étape | Statut | Livrable |
|---|---|---|---|
| 1 | Arbitrages | Validé | Section 3 du CDC consolidé |
| 2 | Modèle de données | Validé | [`backend/prisma/schema.prisma`](backend/prisma/schema.prisma) · [note](docs/etape-2-modele-de-donnees.md) |
| 3 | Architecture et migration SQL | Validé | [`backend/prisma/migrations/`](backend/prisma/migrations/) · [note d'architecture](docs/etape-3-architecture.md) |
| 4 | Machine d'états et moteur SLA | Validé | [`backend/src/domaine/`](backend/src/domaine/) · [`backend/src/application/`](backend/src/application/) · [note](docs/etape-4-cycle-de-vie-sla.md) |
| 5 | Contrat d'API | Validé | [`contrat/openapi.yaml`](contrat/openapi.yaml) · [Swagger hors ligne](docs/api/index.html) · [note](docs/etape-5-contrat-api.md) |
| 6 | Écrans | Validé | [maquettes hors ligne](docs/maquettes/index.html) · [démo cliquable](docs/demo/index.html) · [`frontend/`](frontend/) · [note](docs/etape-6-ecrans.md) |
| 7 | Backend MVP | Validé | [`backend/src/`](backend/src/) · [`docker-compose.prod.yml`](docker-compose.prod.yml) · [note](docs/etape-7-backend.md) |
| 8 | Frontend MVP | Validé | [`frontend/src/app/`](frontend/src/app/) · [`frontend/Dockerfile`](frontend/Dockerfile) · [note](docs/etape-8-frontend.md) |
| 9 | Reporting et notifications | Validé | [`backend/src/modules/reporting/`](backend/src/modules/reporting/) · [`frontend/src/app/console/Reporting.tsx`](frontend/src/app/console/Reporting.tsx) · [note](docs/etape-9-reporting-notifications.md) |
| 10 | Tests et déploiement | Validé | [recette automatique](recette/recette.mjs) · [rapport](docs/recette/rapport.md) · [cahier de recette](docs/recette/cahier-de-recette.md) · [guide d'exploitation](docs/exploitation.md) · [`deploiement/`](deploiement/) · [`docker/sauvegarde/`](docker/sauvegarde/) · [note](docs/etape-10-tests-deploiement.md) |
| 11 | Anti-robot du dépôt, QR code d'activation agrandi, tableau de bord de l'agent | Validé | [`backend/src/infrastructure/securite/anti-robot.ts`](backend/src/infrastructure/securite/anti-robot.ts) · [`frontend/src/api/anti-robot.ts`](frontend/src/api/anti-robot.ts) · [note](docs/etape-11-anti-robot-qr-code.md) |
| 12 | Sauvegardes protégées contre l'effacement | À valider | [`docker/sauvegarde/`](docker/sauvegarde/) · [guide d'exploitation, partie 7](docs/exploitation.md#7-sauvegardes) · [note](docs/etape-12-sauvegardes-protegees.md) |
| 13 | Répétition locale complète du déploiement | À venir | |

## Structure

```
contrat/openapi.yaml                  contrat d'API OpenAPI 3.1 (84 opérations)
docker-compose.yml                    développement : PostgreSQL 16, Redis 8, Mailpit, API, worker, écrans, outils
docker-compose.prod.yml               production (VPS Contabo) : Caddy et écrans, API, worker, migrations, PostgreSQL, Redis, sauvegarde
docker-compose.demo.yml               environnement de démonstration (second serveur) : surcharge de la production
.env.production.example               variables et secrets de la production (.env.demo.example : démonstration)
deploiement/                          secrets, contrôle d'un déploiement, mise à jour et retour arrière, remise à zéro de la démo
recette/recette.mjs                   recette automatique : toutes les suites, rapport des 11 critères (docs/recette/rapport.md)
recette/Dockerfile                    image de la recette : Playwright, client PostgreSQL, age, rclone 1.75, moto (S3 verrouillé)
docker/sauvegarde/                    sauvegarde chiffrée (age) copiée hors du VPS et verrouillée, restauration vérifiée, essai de 39 contrôles
docker/postgres/init/                 bases et rôles, créés au premier démarrage
docker/caddy/Caddyfile                HTTPS automatique, console.<domaine> et <slug>.<domaine>
docker/caddy/commun.caddy             en-têtes de sécurité, /api/* vers l'API, cache et CSP des écrans
backend/
  Dockerfile                          image de l'application (API et worker) et image des migrations
  prisma/schema.prisma                modèle de données (19 modèles, 13 énumérations)
  prisma/migrations/                  modèle initial, sécurité (rôles, RLS, CHECK, audit), cycle de vie, reporting
  prisma.config.ts                    configuration Prisma 7
  src/domaine/                        code pur : temps ouvré, machine d'états, SLA (+ tests unitaires), partagé avec la démo
  src/application/reclamations/       cycle de vie d'une réclamation et tâches planifiées du SLA
  src/contrat/                        types générés du contrat + tests de cohérence contrat ↔ code
  src/infrastructure/base-de-donnees/ accès contextuel : banque, plateforme, système
  src/infrastructure/contrat/         routes, rôles, validation et erreurs lus dans le contrat ; Swagger
  src/infrastructure/securite/        jetons, mots de passe, TOTP, limites de débit, idempotence, anti-robot
  src/infrastructure/envois/          boîte d'envoi : e-mail (SMTP, texte et HTML), SMS (passerelle HTTP ou journal), in-app
  src/modules/                        API : public, client, auth, réclamations, reporting, paramétrage, personnel…
  src/main.ts · src/worker.ts         les deux processus : API NestJS et worker BullMQ
  scripts/semer.ts                    jeu de démonstration : deux banques, leur personnel, 60 jours d'historique
  scripts/demonstration.ts            environnement de démonstration : mot de passe et graine TOTP de l'installation
  scripts/creer-super-admin.ts        premier Super Admin d'une installation
  test/e2e/                           94 tests de bout en bout, chaque réponse validée contre le contrat
  scripts/verifier-integrite.ts       32 vérifications du modèle (étape 2)
  scripts/verifier-securite.ts        62 vérifications de sécurité (étapes 3 et 9)
  scripts/verifier-cycle-de-vie.ts    45 vérifications du cycle de vie et du SLA (étape 4)
frontend/
  Dockerfile                          image web : Caddy, la console et le portail construits
  portail/ · console/                 pages d'entrée des deux applications (étape 8)
  src/app/portail/                    portail client branché sur l'API : dépôt, suivi, espace client
  src/app/console/                    console : connexion, réclamations, tableau de bord, paramétrage, personnel, audit, plateforme
  src/api/                            client d'API tiré du contrat, sessions du personnel et du client, anti-robot
  src/ui/                             système visuel : statuts, chrono SLA, couleurs de la banque, courbe d'évolution
  src/ecrans/                         écrans du portail, du back-office et de la console (étape 6)
  src/maquettes/                      données fictives conformes au contrat, galerie des maquettes
  src/demo/                           démo cliquable : API simulée, 30 jours d'historique, visite guidée
  tests/                              143 tests : maquettes et démo ↔ contrat ↔ machine d'états, client d'API, reporting, anti-robot
  tests/navigateur/                   26 tests dans Chromium (Playwright) sur la vraie API
docs/
  etape-2-modele-de-donnees.md        note de l'étape 2 et diagramme entité-relation
  etape-3-architecture.md             note d'architecture de l'étape 3 et diagrammes
  etape-4-cycle-de-vie-sla.md         machine d'états, moteur SLA, notifications
  etape-5-contrat-api.md              contrat d'API : conventions, opérations par rôle
  etape-6-ecrans.md                   écrans : décisions, captures, tests
  etape-7-backend.md                  API, authentification, worker, Docker, tests
  etape-8-frontend.md                 portail et console branchés sur l'API : décisions, captures, tests
  etape-9-reporting-notifications.md  tableau de bord, exports CSV, facturation SMS, passerelle SMS, e-mails HTML
  etape-10-tests-deploiement.md       recette, sauvegardes, supervision, déploiement, démonstration
  etape-11-anti-robot-qr-code.md      anti-robot du portail, QR code d'activation, tableau de bord de l'agent
  etape-12-sauvegardes-protegees.md   copies hors du VPS verrouillées, alerte en cas d'intrusion
  exploitation.md                     guide d'exploitation : VPS, installation, sauvegardes, supervision, mises à jour, restauration
  recette/                            cahier de recette (à signer) et rapport de la recette automatique
  demo-cliquable.md                   présenter la démo à une banque : préparation, visite, mode libre
  api/index.html                      documentation du contrat, lisible sans connexion
  maquettes/index.html                les 21 écrans en une page, lisible sans connexion
  demo/index.html                     démo cliquable pour les rendez-vous commerciaux, sans connexion
```

## Démarrer avec Docker

Docker sert au développement et au déploiement : la production tourne sous Docker Compose sur un VPS Contabo (topologie fixée à l'étape 3, [note d'architecture](docs/etape-3-architecture.md#9-docker)).

Prérequis : Docker Desktop (ou Docker Engine) avec Docker Compose.

```bash
cp .env.example .env                    # facultatif : identifiants et ports
docker compose up -d                    # PostgreSQL 16, Redis 8, Mailpit, l'API et le worker, puis les écrans
docker compose exec api npm run semer   # jeu de démonstration : deux banques, leur personnel, 60 jours d'historique
docker compose exec api npm run totp -- serge.kouadio@banque-alpha.example   # code TOTP du moment
docker compose logs -f api worker       # journaux (les SMS de développement s'y affichent)
docker compose run --rm verification    # contrat, typage, tests unitaires, 137 vérifications, tests de bout en bout
docker compose run --rm maquettes       # écrans : 143 tests, les deux applications, docs/maquettes/ et docs/demo/
docker compose run --rm navigateur      # écrans dans Chromium sur la vraie API : 26 tests
docker compose run --rm recette         # tout ce qui précède, plus l'essai de sauvegarde : rapport des 11 critères
```

| Adresse | Contenu |
|---|---|
| http://localhost:5173 | console du personnel (banques et plateforme) |
| http://alpha.localhost:5174/d/7K3QX9P2MA | portail de la Banque Alpha, QR code de l'accueil |
| http://localhost:3000/api/docs | API et documentation Swagger (essais en direct) |
| http://localhost:3000/api/v1/sante | état de l'API, de la base, de Redis, du worker, des envois et du disque |
| http://localhost:8025 | e-mails envoyés par le worker (Mailpit) |

Comptes de démonstration, mot de passe et codes TOTP : [note de l'étape 7, section 7](docs/etape-7-backend.md#7-jeu-de-démonstration). L'API, le worker et les écrans se rechargent à chaque modification du code, contrat d'API compris, y compris sous Windows (les fichiers sont relus chaque seconde : Docker Desktop ne signale pas les changements du dossier partagé). Si une nouvelle livraison ne semble pas prise en compte : `docker compose restart api worker console portail`, puis rechargement forcé de la page (Ctrl+Maj+R). Les liens des e-mails (Mailpit) pointent vers la console et le portail ci-dessus. Le tableau de bord et les exports de la Banque Alpha s'appuient sur 60 jours d'historique ; une base semée avant l'étape 9 ne l'a pas : `docker compose down -v`, `docker compose up -d`, puis `npm run semer`.

La vérification tourne entièrement dans un conteneur Node 22 : rien à installer sur la machine hôte. Résultat attendu : contrat valide, `176 passed` (tests unitaires), puis `32`, `62` et `45 vérifications réussies` (modèle, sécurité, cycle de vie), chacune avec `0 en échec`, enfin `94 passed` (tests de bout en bout de l'API). Pour les écrans : `143 passed`, les deux applications construites, puis `docs/maquettes/index.html` et `docs/demo/index.html` reconstruits ; dans le navigateur : `26 passed`.

Les maquettes et la démo s'ouvrent aussi directement dans un navigateur, sans Docker : `docs/maquettes/index.html` et `docs/demo/index.html`. Pour présenter la démo à une banque : [guide](docs/demo-cliquable.md).

Le rôle de connexion de l'application (`reclamations_app`) est créé ou remis au mot de passe de `APP_DB_PASSWORD` à chaque démarrage et à chaque vérification (`npm run roles:dev`, refusé en production) : un volume PostgreSQL créé avant l'étape 3, ou un mot de passe changé depuis, ne bloque plus rien.

Page blanche sur la console ou le portail, avec des erreurs `504` ou `NS_ERROR_CORRUPTED_CONTENT` sur `/.vite/deps/…` dans la console du navigateur : les serveurs Vite ont vu leurs dépendances réinstallées pendant qu'ils tournaient. `docker compose restart console portail`, puis rechargement forcé de la page (Ctrl+Maj+R). Depuis l'étape 11, `docker compose up -d` ne réinstalle plus que si `package-lock.json` a changé, et Vite garde ses dépendances préparées hors de `node_modules` : le cas ne devrait plus se produire.

Si un port est déjà pris (un PostgreSQL local, par exemple), mettre `POSTGRES_PORT=5433`, `REDIS_PORT=6380`, `API_PORT=3001`, `CONSOLE_PORT=5183` ou `PORTAIL_PORT=5184` dans `.env`.

## Production (VPS Contabo)

Tout est dans le [guide d'exploitation](docs/exploitation.md) : préparation et durcissement du VPS, DNS, secrets, clés de sauvegarde, démarrage, vérification, environnement de démonstration, sauvegardes, supervision, mises à jour, restauration, dépannage. L'essentiel :

```bash
./deploiement/generer-env.sh --domaine <domaine> --acme <adresse>      # .env.production, secrets générés
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
docker compose -f docker-compose.prod.yml --env-file .env.production run --rm api \
  node dist/scripts/creer-super-admin.js prenom.nom@makortelecoms.ci Prénom Nom
./deploiement/verifier.sh --local                                      # HTTPS, en-têtes, santé, conteneurs, pare-feu
./deploiement/mettre-a-jour.sh 1.1.0                                   # plus tard : sauvegarde, construction, migrations, contrôle
```

Seuls les ports 80 et 443 (Caddy) sont publiés ; le DNS fait pointer `console.<domaine>` et `*.<domaine>` vers le VPS. La base et les pièces jointes sont sauvegardées chaque nuit, chiffrées, et copiées hors du VPS ; la clé qui les déchiffre n'y est jamais.

## Travailler depuis la machine hôte (facultatif)

Avec Node.js 22.12 ou plus, contre PostgreSQL, Redis et Mailpit des conteneurs :

```bash
cd backend
cp .env.example .env        # pointe vers localhost (base reclamations_dev, Redis, Mailpit)
npm install                 # installe les dépendances et génère le client Prisma
npm run migrate:deploy      # applique les migrations sur reclamations_dev
npm run dev                 # API : http://localhost:3000/api/docs
npm run dev:worker          # worker (dans un second terminal)
npm test                    # 170 tests unitaires
npm run test:e2e            # 88 tests de bout en bout (base reclamations_e2e recréée à chaque fois)
npx prisma studio           # parcourir les tables (connexion propriétaire)
```

Arrêter d'abord l'API et le worker des conteneurs (`docker compose stop api worker`) pour libérer le port 3000.

Les écrans, dans un second temps :

```bash
cd frontend
npm install
npm run dev:console         # console : http://localhost:5173 (appelle l'API sur le port 3000)
npm run dev:portail         # portail : http://alpha.localhost:5174/d/7K3QX9P2MA
npm test                    # 136 tests unitaires
npx playwright install chromium
npm run test:navigateur     # 26 tests dans Chromium (API de test sur le port 3300, base reclamations_navigateur)
npm run build               # console, portail, docs/maquettes/ et docs/demo/
```

Arrêter alors aussi les écrans des conteneurs (`docker compose stop console portail`).

## Arrêter

```bash
docker compose down         # conserve les données
docker compose down -v      # efface aussi les bases et les fichiers (volumes)
```
