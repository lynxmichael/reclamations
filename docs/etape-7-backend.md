# Étape 7 — Backend MVP

Plateforme de gestion des réclamations · Makor Telecoms · Solution 1
Version du 28/09/2026 · **Statut : validé le 28/09/2026** (décisions B1 à B12 retenues telles que proposées).

Livrables :

- [`backend/src/`](../backend/src/) : l'**API NestJS** qui sert le contrat de l'étape 5 (79 opérations sur 83, les 4 du reporting arrivent à l'étape 9), et le **worker** qui exécute les tâches planifiées (SLA, envois, relances, purge) avec BullMQ ;
- l'authentification du personnel (mot de passe et TOTP, sessions) et des clients (lien de suivi et code à usage unique), l'isolation entre banques sur chaque requête ;
- [`backend/test/e2e/`](../backend/test/e2e/) : **76 tests de bout en bout** sur PostgreSQL et Redis, qui valident chaque réponse contre le contrat ;
- Docker : [`backend/Dockerfile`](../backend/Dockerfile), [`docker-compose.yml`](../docker-compose.yml) complété (API, worker, Mailpit), [`docker-compose.prod.yml`](../docker-compose.prod.yml) et [`docker/caddy/Caddyfile`](../docker/caddy/Caddyfile) pour le VPS Contabo ;
- des ajouts au contrat, sans rupture (décision B12), la documentation hors ligne du contrat et les types du frontend régénérés.

## 1. En bref

| Contrôle | Résultat |
|---|---|
| Opérations du contrat servies par l'API | **79 / 83** ; les 4 restantes (indicateurs, export CSV, facturation SMS) relèvent de l'étape 9 |
| Opérations servies appelées par les tests de bout en bout | 79 / 79 (un test échoue si une opération n'est jamais appelée) |
| Réponses validées contre le contrat, en mode strict (aucun champ en plus) | toutes, dans les 76 tests |
| Tests de bout en bout | **76 / 76** : parcours, sécurité, authentification, back-office, paramétrage, plateforme, worker, performance |
| Critères de recette du CDC (section 10) couverts par un test | **9 / 11** ; le taux de résolution au premier contact et l'export CSV relèvent de l'étape 9 |
| Opérations courantes sur 1 000 réclamations (critère 10 : moins d'une seconde) | p95 de 23 à 140 ms (file, tri par échéance, recherche, fiche, assignation) |
| Tests unitaires du backend | 147 / 147 |
| Vérifications sur PostgreSQL (étapes 2 à 4) | 32, 60 et 45 réussies, 0 en échec |
| Frontend rejoué après les ajouts au contrat | types régénérés, 122 / 122 tests |
| Production | API compilée lancée avec les seules dépendances de production et des secrets générés ; fichiers Compose validés (`docker compose config`), configuration Caddy validée (`caddy validate`) |

Limite de cette livraison : les images Docker n'ont pas pu être construites ici (le registre Docker Hub n'est pas joignable depuis l'environnement de travail). Le premier `docker compose up` sur ta machine les construira : c'est le premier contrôle à faire (section 6).

## 2. Décisions à valider

| N° | Sujet | Proposition |
|---|---|---|
| B1 | Technique | NestJS 12, Prisma 7 (pilote `pg`), Node.js 22.12 ou plus, TypeScript. Un seul code, deux processus : l'API et le worker, dans la même image Docker. BullMQ 6 sur Redis 8 pour les tâches planifiées |
| B2 | Le contrat pilote l'API | Chaque route est déclarée par son nom d'opération ; méthode, chemin, code de succès, rôles autorisés (`x-roles`) et validation des entrées sont lus dans `contrat/openapi.yaml` au démarrage. Un test échoue si une opération est servie deux fois, pas servie ou servie à une autre adresse. Erreurs au format RFC 9457, en français, avec le champ en cause. Hors production, chaque réponse est aussi vérifiée contre le contrat et tout écart est journalisé. Swagger (`/api/docs`) affiche le contrat lui-même, aussi en production : il ne contient aucune donnée |
| B3 | Connexion du personnel | E-mail et mot de passe (haché avec argon2id), puis **code TOTP obligatoire pour tous les rôles**, Super Admin compris ; enrôlement à la première connexion (QR code). Même message que l'e-mail existe ou non. 5 échecs verrouillent le compte 15 minutes ; 10 échecs par quart d'heure depuis une même adresse IP renvoient 429 (les connexions réussies ne comptent pas : tout le personnel d'une agence sort souvent par la même adresse). Secrets TOTP chiffrés en base (AES-256-GCM) ; un code ne sert qu'une fois |
| B4 | Sessions du personnel | Jeton d'accès de 15 minutes, gardé en mémoire par l'écran. Refresh token dans un cookie `HttpOnly`, `Secure`, `SameSite=Strict`, limité à `/api/v1/auth`, remplacé à chaque usage. Session de **12 heures** au plus (une journée de travail), puis nouvelle connexion. Un ancien refresh token présenté à nouveau ferme toute la session (signe de vol) et laisse une trace dans le journal d'audit. Chaque requête revérifie la session et le compte : une désactivation, une réinitialisation du TOTP ou la suspension de la banque prennent effet aussitôt |
| B5 | Accès du client | Lien de suivi public : chronologie seule, sans description ni coordonnées. Pour lire ses réponses et répondre : code à 6 chiffres par SMS (ou e-mail), valable 10 minutes, 5 essais, 3 codes par heure et par réclamation ; session client de 30 minutes. Un client ne voit que ses réclamations (404 sinon) |
| B6 | Isolation entre banques | Chaque requête s'exécute dans une transaction ouverte avec le rôle PostgreSQL de son contexte (banque, plateforme ou système) et la banque de l'utilisateur : la Row-Level Security de l'étape 3 s'applique en plus des filtres du code. Le ticket d'une autre banque, ou d'un autre agent de la même banque, répond **404**. Le Super Admin n'entre jamais dans l'espace d'une banque et ne peut pas lire une description, même en SQL. Le contexte système est réservé au dépôt public (le code du QR code désigne la banque), à la connexion et au worker |
| B7 | Protections des routes publiques | Limites : 5 dépôts par heure et par adresse IP, 3 par téléphone ; 120 appels par minute et par adresse IP sur les routes publiques ; 5 demandes de mot de passe oublié par heure. `Idempotency-Key` sur le dépôt : un double envoi renvoie le même accusé, sans doublon (24 h). Ces compteurs sont dans Redis : **si Redis tombe, l'API continue de servir sans limite** plutôt que de refuser les dépôts ; le verrouillage des comptes, lui, est en base et reste actif |
| B8 | Fichiers | Enregistrés sur un volume Docker du VPS, derrière une interface de stockage qu'un stockage S3 (Contabo Object Storage) pourra remplacer sans toucher au reste. Type reconnu au contenu, jamais d'après le nom : JPEG, PNG, WebP, PDF, 5 fichiers de 5 Mo au plus. Logo : PNG, SVG ou WebP, 1 Mo, SVG refusé s'il contient un script ou un lien externe ; servi à une adresse publique au nom aléatoire, en cache un an. Les pièces jointes ne se téléchargent que par les routes authentifiées, toujours en téléchargement, jamais affichées dans la page |
| B9 | Worker | Processus séparé, quatre travaux : SLA chaque minute (alerte à 75 %, dépassement et escalade, clôture automatique), envois toutes les 5 secondes, relances toutes les 5 minutes (5 tentatives, puis « échec » visible), purge chaque nuit à 03:17 (heure d'Abidjan). Chaque travail n'est planifié qu'une fois dans Redis, quel que soit le nombre de workers. Les notifications sont écrites dans la même transaction que l'action : jamais perdues, jamais envoyées pour une action annulée. Les codes et liens envoyés sont masqués en base après l'envoi |
| B10 | E-mails et SMS | E-mail par SMTP : Mailpit en développement, prestataire à choisir pour la production (point ouvert). **SMS : aucun envoi réel à l'étape 7.** L'adaptateur « journal » écrit chaque SMS dans les journaux du worker, avec son nombre de segments (160 caractères, 70 hors alphabet GSM) ; la passerelle SMS de Makor le remplace à l'étape 9 |
| B11 | Production | `docker-compose.prod.yml` : Caddy (HTTPS automatique ; le certificat du portail d'une banque est obtenu à sa première visite, après que l'API a confirmé que ce nom est celui d'une banque cliente), API, worker, migrations appliquées avant chaque démarrage, PostgreSQL 16, Redis 8. Seuls les ports 80 et 443 sont publiés. L'adresse IP du client est celle de la connexion reçue par Caddy, jamais un en-tête envoyé par le navigateur. L'API refuse de démarrer en production avec un secret de développement ou un cookie non `Secure`. La console et les portails appellent `/api/*` sur leur propre domaine : pas de CORS à ouvrir |
| B12 | Ajouts au contrat | Sans rupture : une opération, `lireLogo` (`GET /public/logos/{fichier}`), pour l'adresse `logoUrl` déjà prévue ; trois codes d'erreur (`INVITATION_DEJA_ACCEPTEE`, `JOUR_FERIE_EXISTANT`, `ERREUR_INTERNE`) ; les réponses 400, 403 et 423 que l'API peut renvoyer sont maintenant déclarées là où elles manquaient (dont 403 `BANQUE_SUSPENDUE` sur les routes d'une banque) ; la limite de connexion décrite comme ci-dessus (B3). Le contrat passe à 83 opérations |

## 3. Organisation du code

| Module | Opérations | Rôle |
|---|---|---|
| `public` | 6 | formulaire de dépôt (QR code ou lien web), dépôt avec pièces jointes, suivi, code OTP, logos |
| `client` | 6 | espace client : ses réclamations, messages, confirmation ou contestation, pièces jointes |
| `auth` | 9 | connexion, TOTP, invitation, sessions, mot de passe oublié, profil |
| `reclamations` | 11 | files et recherche, fiche, les huit actions du cycle de vie, pièces jointes |
| `notifications` | 3 | notifications du personnel de la banque |
| `parametrage` | 18 | paramètres, apparence et logo, catégories, agences, points de dépôt et QR codes, horaires, jours fériés |
| `personnel` | 8 | comptes et équipes de la banque |
| `audit` | 2 | journal de la banque et vérification de sa chaîne |
| `plateforme` | 15 | console de Makor Telecoms : banques, plans, journal, alertes, Super Admins |
| `sante` | 1 | état de l'API, de la base et de Redis |

Autour des modules :

- `src/infrastructure/contrat/` lit le contrat, déclare les routes, contrôle l'authentification et les rôles, valide les entrées, met les erreurs au format RFC 9457 et sert Swagger ;
- `src/infrastructure/securite/` : jetons, mots de passe, TOTP, limites de débit, idempotence ;
- `src/infrastructure/` contient aussi les fichiers, le stockage, la boîte d'envoi et ses adaptateurs (SMTP, SMS journal), le journal d'audit ;
- `src/application/reclamations/` : le service du cycle de vie et les tâches SLA de l'étape 4, réutilisés tels quels par l'API et le worker (plus l'ajout des pièces jointes aux messages) ;
- `src/worker/` : la planification BullMQ.

## 4. Authentification

**Personnel**

1. `POST /auth/connexion` avec e-mail et mot de passe. La réponse donne un jeton intermédiaire de 5 minutes et l'étape suivante : code TOTP, ou enrôlement si le compte n'a pas encore de TOTP.
2. `POST /auth/connexion/totp` (ou `POST /auth/totp/activation` avec le QR code d'enrôlement) renvoie le jeton d'accès, le profil et le cookie de session.
3. `POST /auth/rafraichissement` renouvelle le jeton d'accès avant ses 15 minutes, jusqu'à la fin des 12 heures ; `POST /auth/deconnexion` ferme la session.
4. Invitation (7 jours) et mot de passe oublié (1 heure) passent par un lien envoyé par e-mail. Le jeton est placé après `#` : il n'apparaît dans aucun journal de serveur.

**Client**

- `GET /public/suivi/{jetonSuivi}` : la chronologie, par le lien reçu au dépôt.
- `POST /public/suivi/{jetonSuivi}/otp` envoie un code ; `POST /public/suivi/{jetonSuivi}/otp/verification` ouvre une session de 30 minutes sur l'espace client.

## 5. Worker et envois

Le worker (`node dist/src/worker.js`, `npm run dev:worker` en développement) n'a pas de port. En développement, les e-mails arrivent dans Mailpit (http://localhost:8025) et les SMS s'affichent dans ses journaux : `docker compose logs -f worker`.

## 6. Docker

**Développement**, depuis la racine du dépôt :

```bash
docker compose up -d                          # PostgreSQL, Redis, Mailpit, puis API et worker (installation et migrations d'abord)
docker compose exec api npm run semer         # jeu de démonstration (section 7)
docker compose exec api npm run totp -- serge.kouadio@banque-alpha.example   # code TOTP du moment
docker compose logs -f api worker             # journaux ; les SMS s'y affichent
docker compose run --rm verification          # contrat, typage, tests unitaires, vérifications, 76 tests de bout en bout
```

API et Swagger : http://localhost:3000/api/docs · E-mails : http://localhost:8025. L'API et le worker se rechargent à chaque modification du code.

**Premier contrôle à faire** (les images n'ont pas pu être construites ici) : `docker compose up -d`, puis `docker compose ps` doit montrer `api` et `worker` démarrés et `backend-installation` terminé sans erreur ; http://localhost:3000/api/v1/sante doit répondre `"statut":"ok"`. Enfin, `docker compose run --rm verification` doit se terminer par `76 passed`.

Un volume PostgreSQL créé avant l'étape 3, ou un `APP_DB_PASSWORD` changé depuis, empêchait l'application de se connecter (erreur 28P01). Le rôle `reclamations_app` est désormais créé ou réaligné avant les migrations, au démarrage comme à la vérification (`scripts/roles-developpement.ts`, refusé en production). La vérification a aussi ses propres `node_modules`, et ses transactions ont 2 minutes au lieu de 5 secondes : un poste lent ne la fait plus échouer.

**Production** (VPS Contabo) :

```bash
cp .env.production.example .env.production    # domaine, e-mail Let's Encrypt, mots de passe, secrets, SMTP
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
docker compose -f docker-compose.prod.yml --env-file .env.production run --rm api \
  node dist/scripts/creer-super-admin.js prenom.nom@makortelecoms.ci Prénom Nom
```

Le DNS doit faire pointer `console.<domaine>` et `*.<domaine>` vers le VPS. Le script affiche le lien d'invitation du premier Super Admin ; les écrans qui l'ouvrent arrivent à l'étape 8. D'ici là, l'API se parcourt avec Swagger (`https://console.<domaine>/api/docs`).

## 7. Jeu de démonstration

`npm run semer` (refusé en production) crée deux banques, leur personnel et quelques réclamations. Mot de passe de tous les comptes : `Makor-Demo-2026`. Leur secret TOTP est dérivé de l'e-mail : `npm run totp -- <e-mail>` donne le code du moment, ou l'ajoute à une application d'authentification.

| Banque | Compte | Rôle |
|---|---|---|
| — | koffi.admin@makortelecoms.example | Super Admin |
| Banque Alpha (`ALP`, QR code `7K3QX9P2MA`) | fatou.diabate@banque-alpha.example | Admin Entreprise |
| | serge.kouadio@ · mariam.ouattara@banque-alpha.example | Superviseurs |
| | aya.konan@ · mamadou.traore@ · ibrahim.coulibaly@banque-alpha.example | Agents (estelle.gnahore@ est invitée) |
| Banque Horizon (`HOR`, QR code `H7P4XK2RQD`) | awa.bamba@banque-horizon.example | Admin Entreprise |
| | didier.yao@banque-horizon.example | Superviseur |
| | salif.kone@banque-horizon.example | Agent |

## 8. Ce que vérifient les tests

Les tests de bout en bout démarrent la vraie API sur une base recréée à chaque lancement (`reclamations_e2e`), avec le jeu de démonstration. Ils valident **chaque réponse** contre son schéma du contrat, sans champ en plus toléré. L'horloge est simulée pour les délais (SLA, clôture automatique, expirations).

| Critère de recette (CDC, section 10) | Test |
|---|---|
| 1. Dépôt par QR code traité puis clôturé, numéro, accusé par e-mail et SMS | `parcours` : du QR code à la clôture confirmée par le client (SMS par l'adaptateur journal, B10) |
| 2. Le client voit l'étape exacte et horodatée | `parcours` : suivi par le lien, puis espace client |
| 3. Alerte urgente à l'agent, au superviseur, à l'Admin Entreprise, au Super Admin sans nom ni description | `back-office` |
| 4. Banque A → ticket de B : 404, et rien en SQL | `securite` |
| 5. SLA hors heures non ouvrées et jours fériés, suspendu en attente client | `worker`, `parcours` ; jours fériés : tests unitaires et vérifications de l'étape 4 |
| 6. Alerte à 75 %, escalade au dépassement, une seule fois chacune | `worker` |
| 7. Clôture automatique après 5 jours ; contestation qui rouvre | `worker`, `back-office` |
| 8. Taux de résolution au premier contact | étape 9 (les transitions qu'il utilise sont enregistrées depuis l'étape 4) |
| 9. Journal d'audit complet ; ligne modifiée à la main détectée | `back-office` |
| 10. Opérations courantes en moins d'une seconde | `performance` : 1 000 réclamations |
| 11. Export CSV | étape 9 |

Autres contrôles : sessions et vol de refresh token, verrouillage, enrôlement TOTP, rôles (`x-roles`), fichiers refusés (type, nombre, taille), idempotence, limites de débit, suspension d'une banque, boîte d'envoi en panne puis relancée, purge, planification BullMQ unique.

Lancer les tests sans Docker (Node.js 22.12, PostgreSQL et Redis du `docker-compose.yml`) :

```bash
cd backend
cp .env.example .env
npm install
npm test                 # 147 tests unitaires
npm run test:e2e         # 76 tests de bout en bout (base reclamations_e2e recréée, Redis base 15)
```

## 9. Points ouverts qui touchent le backend

- **Nom de domaine** : conditionne les certificats et les liens envoyés (`DOMAINE_PLATEFORME`).
- **Prestataire d'e-mail transactionnel** : il suffit de renseigner `SMTP_URL`.
- **Pièces jointes** : volume du VPS (en place) ou Contabo Object Storage (B8).
- **Mécanisme anti-robot** du dépôt : le champ `jetonAntiRobot` est accepté mais pas encore vérifié.
- **Passerelle SMS de Makor** : étape 9 (B10).
- **Sauvegarde** quotidienne de PostgreSQL hors du VPS : étape 10, avec la supervision (dont une alerte si Redis tombe, B7).
- **Transfert hors de Côte d'Ivoire** (ARTCI) : inchangé, à cadrer avec chaque banque avant la mise en production.

## 10. Ce qui arrive à l'étape 8

Frontend MVP : les écrans de l'étape 6 branchés sur cette API (portail client, back-office, console), servis par Caddy depuis `/srv/portail` et `/srv/console`, et la démo cliquable qui reste disponible pour les rendez-vous commerciaux.
