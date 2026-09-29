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
| 8 | Frontend MVP | **En attente de validation** | [`frontend/src/app/`](frontend/src/app/) · [`frontend/Dockerfile`](frontend/Dockerfile) · [note](docs/etape-8-frontend.md) |
| 9 | Reporting et notifications | À faire | |
| 10 | Tests et déploiement | À faire | |

## Structure

```
contrat/openapi.yaml                  contrat d'API OpenAPI 3.1 (83 opérations)
docker-compose.yml                    développement : PostgreSQL 16, Redis 8, Mailpit, API, worker, écrans, outils
docker-compose.prod.yml               production (VPS Contabo) : Caddy et écrans, API, worker, migrations, PostgreSQL, Redis
.env.production.example               variables et secrets de la production
docker/postgres/init/                 bases et rôles, créés au premier démarrage
docker/caddy/Caddyfile                HTTPS automatique, console.<domaine> et <slug>.<domaine>
docker/caddy/commun.caddy             en-têtes de sécurité, /api/* vers l'API, cache et CSP des écrans
backend/
  Dockerfile                          image de l'application (API et worker) et image des migrations
  prisma/schema.prisma                modèle de données (19 modèles, 13 énumérations)
  prisma/migrations/                  modèle initial, sécurité (rôles, RLS, CHECK, audit), cycle de vie
  prisma.config.ts                    configuration Prisma 7
  src/domaine/                        code pur : temps ouvré, machine d'états, SLA (+ tests unitaires), partagé avec la démo
  src/application/reclamations/       cycle de vie d'une réclamation et tâches planifiées du SLA
  src/contrat/                        types générés du contrat + tests de cohérence contrat ↔ code
  src/infrastructure/base-de-donnees/ accès contextuel : banque, plateforme, système
  src/infrastructure/contrat/         routes, rôles, validation et erreurs lus dans le contrat ; Swagger
  src/infrastructure/securite/        jetons, mots de passe, TOTP, limites de débit, idempotence
  src/infrastructure/envois/          boîte d'envoi : e-mail (SMTP), SMS (journal), in-app
  src/modules/                        API : public, client, auth, réclamations, paramétrage, personnel…
  src/main.ts · src/worker.ts         les deux processus : API NestJS et worker BullMQ
  scripts/semer.ts                    jeu de démonstration : deux banques et leur personnel
  scripts/creer-super-admin.ts        premier Super Admin d'une installation
  test/e2e/                           76 tests de bout en bout, chaque réponse validée contre le contrat
  scripts/verifier-integrite.ts       32 vérifications du modèle (étape 2)
  scripts/verifier-securite.ts        60 vérifications de sécurité (étape 3)
  scripts/verifier-cycle-de-vie.ts    45 vérifications du cycle de vie et du SLA (étape 4)
frontend/
  Dockerfile                          image web : Caddy, la console et le portail construits
  portail/ · console/                 pages d'entrée des deux applications (étape 8)
  src/app/portail/                    portail client branché sur l'API : dépôt, suivi, espace client
  src/app/console/                    console : connexion, réclamations, paramétrage, personnel, audit, plateforme
  src/api/                            client d'API tiré du contrat, sessions du personnel et du client
  src/ui/                             système visuel : statuts, chrono SLA, couleurs de la banque
  src/ecrans/                         écrans du portail, du back-office et de la console (étape 6)
  src/maquettes/                      données fictives conformes au contrat, galerie des maquettes
  src/demo/                           démo cliquable : API simulée, 30 jours d'historique, visite guidée
  tests/                              130 tests : maquettes et démo ↔ contrat ↔ machine d'états, client d'API
  tests/navigateur/                   22 tests dans Chromium (Playwright) sur la vraie API
docs/
  etape-2-modele-de-donnees.md        note de l'étape 2 et diagramme entité-relation
  etape-3-architecture.md             note d'architecture de l'étape 3 et diagrammes
  etape-4-cycle-de-vie-sla.md         machine d'états, moteur SLA, notifications
  etape-5-contrat-api.md              contrat d'API : conventions, opérations par rôle
  etape-6-ecrans.md                   écrans : décisions, captures, tests
  etape-7-backend.md                  API, authentification, worker, Docker, tests
  etape-8-frontend.md                 portail et console branchés sur l'API : décisions, captures, tests
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
docker compose exec api npm run semer   # jeu de démonstration : deux banques et leur personnel
docker compose exec api npm run totp -- serge.kouadio@banque-alpha.example   # code TOTP du moment
docker compose logs -f api worker       # journaux (les SMS de développement s'y affichent)
docker compose run --rm verification    # contrat, typage, tests unitaires, 137 vérifications, tests de bout en bout
docker compose run --rm maquettes       # écrans : 130 tests, les deux applications, docs/maquettes/ et docs/demo/
docker compose run --rm navigateur      # écrans dans Chromium sur la vraie API : 22 tests
```

| Adresse | Contenu |
|---|---|
| http://localhost:5173 | console du personnel (banques et plateforme) |
| http://alpha.localhost:5174/d/7K3QX9P2MA | portail de la Banque Alpha, QR code de l'accueil |
| http://localhost:3000/api/docs | API et documentation Swagger (essais en direct) |
| http://localhost:3000/api/v1/sante | état de l'API, de la base et de Redis |
| http://localhost:8025 | e-mails envoyés par le worker (Mailpit) |

Comptes de démonstration, mot de passe et codes TOTP : [note de l'étape 7, section 7](docs/etape-7-backend.md#7-jeu-de-démonstration). L'API, le worker et les écrans se rechargent à chaque modification du code. Les liens des e-mails (Mailpit) pointent vers la console et le portail ci-dessus.

La vérification tourne entièrement dans un conteneur Node 22 : rien à installer sur la machine hôte. Résultat attendu : contrat valide, `148 passed` (tests unitaires), puis `32`, `60` et `45 vérifications réussies` (modèle, sécurité, cycle de vie), chacune avec `0 en échec`, enfin `76 passed` (tests de bout en bout de l'API). Pour les écrans : `130 passed`, les deux applications construites, puis `docs/maquettes/index.html` et `docs/demo/index.html` reconstruits ; dans le navigateur : `22 passed`.

Les maquettes et la démo s'ouvrent aussi directement dans un navigateur, sans Docker : `docs/maquettes/index.html` et `docs/demo/index.html`. Pour présenter la démo à une banque : [guide](docs/demo-cliquable.md).

Le rôle de connexion de l'application (`reclamations_app`) est créé ou remis au mot de passe de `APP_DB_PASSWORD` à chaque démarrage et à chaque vérification (`npm run roles:dev`, refusé en production) : un volume PostgreSQL créé avant l'étape 3, ou un mot de passe changé depuis, ne bloque plus rien.

Si un port est déjà pris (un PostgreSQL local, par exemple), mettre `POSTGRES_PORT=5433`, `REDIS_PORT=6380`, `API_PORT=3001`, `CONSOLE_PORT=5183` ou `PORTAIL_PORT=5184` dans `.env`.

## Production (VPS Contabo)

```bash
cp .env.production.example .env.production      # domaine, e-mail Let's Encrypt, mots de passe, secrets, SMTP
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
docker compose -f docker-compose.prod.yml --env-file .env.production run --rm api \
  node dist/scripts/creer-super-admin.js prenom.nom@makortelecoms.ci Prénom Nom
```

Seuls les ports 80 et 443 (Caddy) sont publiés. Le DNS doit faire pointer `console.<domaine>` et `*.<domaine>` vers le VPS. L'image web (Caddy, la console et le portail) est construite avec les autres. Détails : [note de l'étape 7, section 6](docs/etape-7-backend.md#6-docker) et [note de l'étape 8, section 7](docs/etape-8-frontend.md#7-docker-et-production).

## Travailler depuis la machine hôte (facultatif)

Avec Node.js 22.12 ou plus, contre PostgreSQL, Redis et Mailpit des conteneurs :

```bash
cd backend
cp .env.example .env        # pointe vers localhost (base reclamations_dev, Redis, Mailpit)
npm install                 # installe les dépendances et génère le client Prisma
npm run migrate:deploy      # applique les migrations sur reclamations_dev
npm run dev                 # API : http://localhost:3000/api/docs
npm run dev:worker          # worker (dans un second terminal)
npm test                    # 148 tests unitaires
npm run test:e2e            # 76 tests de bout en bout (base reclamations_e2e recréée à chaque fois)
npx prisma studio           # parcourir les tables (connexion propriétaire)
```

Arrêter d'abord l'API et le worker des conteneurs (`docker compose stop api worker`) pour libérer le port 3000.

Les écrans, dans un second temps :

```bash
cd frontend
npm install
npm run dev:console         # console : http://localhost:5173 (appelle l'API sur le port 3000)
npm run dev:portail         # portail : http://alpha.localhost:5174/d/7K3QX9P2MA
npm test                    # 130 tests unitaires
npx playwright install chromium
npm run test:navigateur     # 22 tests dans Chromium (API de test sur le port 3300, base reclamations_navigateur)
npm run build               # console, portail, docs/maquettes/ et docs/demo/
```

Arrêter alors aussi les écrans des conteneurs (`docker compose stop console portail`).

## Arrêter

```bash
docker compose down         # conserve les données
docker compose down -v      # efface aussi les bases et les fichiers (volumes)
```
