
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
| 6 | Écrans | **En attente de validation** | [maquettes hors ligne](docs/maquettes/index.html) · [`frontend/`](frontend/) · [note](docs/etape-6-ecrans.md) |
| 7 | Backend MVP | À faire | |
| 8 | Frontend MVP | À faire | |
| 9 | Reporting et notifications | À faire | |
| 10 | Tests et déploiement | À faire | |

## Structure

```
contrat/openapi.yaml                  contrat d'API OpenAPI 3.1 (82 opérations)
docker-compose.yml                    PostgreSQL 16, Redis 8, Swagger, outils de vérification
docker/postgres/init/                 bases et rôles, créés au premier démarrage
backend/
  prisma/schema.prisma                modèle de données (19 modèles, 13 énumérations)
  prisma/migrations/                  modèle initial, sécurité (rôles, RLS, CHECK, audit), cycle de vie
  prisma.config.ts                    configuration Prisma 7
  src/domaine/                        code pur : temps ouvré, machine d'états, SLA (+ tests unitaires)
  src/application/reclamations/       cycle de vie d'une réclamation et tâches planifiées du SLA
  src/contrat/                        types générés du contrat + tests de cohérence contrat ↔ code
  src/infrastructure/base-de-donnees/ accès contextuel : banque, plateforme, système
  scripts/verifier-integrite.ts       32 vérifications du modèle (étape 2)
  scripts/verifier-securite.ts        60 vérifications de sécurité (étape 3)
  scripts/verifier-cycle-de-vie.ts    45 vérifications du cycle de vie et du SLA (étape 4)
frontend/
  src/ui/                             système visuel : statuts, chrono SLA, couleurs de la banque
  src/ecrans/                         écrans du portail, du back-office et de la console (étape 6)
  src/maquettes/                      données fictives conformes au contrat, galerie des maquettes
  tests/                              112 tests : maquettes ↔ contrat ↔ machine d'états
docs/
  etape-2-modele-de-donnees.md        note de l'étape 2 et diagramme entité-relation
  etape-3-architecture.md             note d'architecture de l'étape 3 et diagrammes
  etape-4-cycle-de-vie-sla.md         machine d'états, moteur SLA, notifications
  etape-5-contrat-api.md              contrat d'API : conventions, opérations par rôle
  etape-6-ecrans.md                   écrans : décisions, captures, tests
  api/index.html                      documentation du contrat, lisible sans connexion
  maquettes/index.html                les 21 écrans en une page, lisible sans connexion
```

## Démarrer avec Docker

Docker sert au développement et au déploiement : la production tournera sous Docker Compose sur un VPS Contabo. Sa topologie est fixée à l'étape 3 ([note d'architecture](docs/etape-3-architecture.md#9-docker)) ; le fichier `docker-compose.prod.yml` arrive à l'étape 7, avec les images de l'application.

Prérequis : Docker Desktop (ou Docker Engine) avec Docker Compose.

```bash
cp .env.example .env                    # facultatif : identifiants et port de PostgreSQL
docker compose up -d                    # PostgreSQL 16 et Redis 8
docker compose run --rm verification    # contrat, tests unitaires, migrations sur une base jetable, 137 vérifications
docker compose up -d swagger            # documentation Swagger du contrat : http://localhost:8081
docker compose run --rm maquettes       # maquettes : 112 tests, puis docs/maquettes/index.html
```

La vérification tourne entièrement dans un conteneur Node 22 : rien à installer sur la machine hôte. Résultat attendu : contrat valide, `128 passed` (tests unitaires), puis `32`, `60` et `45 vérifications réussies` (modèle, sécurité, cycle de vie), chacune avec `0 en échec`. Pour les maquettes : `112 passed`, puis `docs/maquettes/index.html` reconstruit.

Les maquettes s'ouvrent aussi directement : `docs/maquettes/index.html` dans un navigateur, sans Docker.

**Si PostgreSQL a déjà été lancé avant l'étape 3**, recréer son volume une fois pour que les rôles soient créés : `docker compose down -v` puis `docker compose up -d`.

Si un port est déjà pris (un PostgreSQL local, par exemple), mettre `POSTGRES_PORT=5433` ou `REDIS_PORT=6380` dans `.env`.

## Travailler depuis la machine hôte (facultatif)

Avec Node.js 22 installé, pour utiliser Prisma directement contre le PostgreSQL du conteneur :

```bash
cd backend
cp .env.example .env        # pointe vers localhost:5432/reclamations_dev
npm install                 # installe Prisma 7.10 et génère le client
npm run migrate:deploy      # applique les migrations sur reclamations_dev
npx prisma studio           # parcourir les tables (connexion propriétaire)
```

## Arrêter

```bash
docker compose down         # conserve les données
docker compose down -v      # efface aussi les bases (volume postgres_data)

