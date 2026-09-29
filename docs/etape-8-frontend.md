# Étape 8 — Frontend MVP

Plateforme de gestion des réclamations · Makor Telecoms · Solution 1
Version du 29/09/2026 · **Statut : en attente de validation** (décisions F1 à F11 ci-dessous).

Livrables :

- [`frontend/portail/`](../frontend/portail/) et [`frontend/src/app/portail/`](../frontend/src/app/portail/) : le **portail client** branché sur l'API, servi sur `<slug>.<domaine>` (dépôt par QR code ou lien web, accusé, suivi, code à usage unique, espace client) ;
- [`frontend/console/`](../frontend/console/) et [`frontend/src/app/console/`](../frontend/src/app/console/) : la **console** du personnel des banques et de la plateforme, servie sur `console.<domaine>` (connexion avec TOTP, invitation, mot de passe oublié, réclamations, paramétrage, personnel, journal d'audit, banques, plans, alertes, Super Admins) ;
- [`frontend/src/api/`](../frontend/src/api/) : le client d'API construit depuis le contrat, les sessions du personnel et du client ;
- [`frontend/tests/navigateur/`](../frontend/tests/navigateur/) : **22 tests dans Chromium** (Playwright) sur la vraie API, sous la politique de sécurité du contenu (CSP) de production ;
- Docker : l'**image web** ([`frontend/Dockerfile`](../frontend/Dockerfile) : Caddy et les deux applications construites), [`docker/caddy/commun.caddy`](../docker/caddy/commun.caddy) (cache, CSP), les serveurs de développement et le service `navigateur` dans [`docker-compose.yml`](../docker-compose.yml) ;
- les écrans de l'étape 6 sont les mêmes composants : la [galerie des maquettes](maquettes/index.html) et la [démo cliquable](demo/index.html) restent disponibles et ont été reconstruites.

## 1. En bref

| Contrôle | Résultat |
|---|---|
| Opérations du contrat appelées par les écrans | **75 / 83** ; les 4 du reporting relèvent de l'étape 9 ; `lireSante` sert à la supervision ; `lireMoi`, `lireUtilisateur` et `lireBanque` sont inutiles aux écrans (la session et les listes portent déjà ces données) |
| Tests dans un vrai navigateur (Chromium), sur la vraie API et PostgreSQL | **22 / 22** : parcours complet, authentification, paramétrage, plateforme, portail, serveurs de développement |
| Ressources refusées par la CSP de production pendant ces tests | **0** (le lancement échoue sinon) |
| Tests unitaires du frontend | 130 / 130 (maquettes et démo ↔ contrat ↔ machine d'états, client d'API) |
| Backend rejoué (une règle précisée, F10) | 148 tests unitaires, vérifications 32, 60 et 45 réussies, 76 tests de bout en bout |
| Poids transféré au premier chargement (compressé) | portail : 125 Ko de JavaScript, 9 Ko de CSS, 34 Ko de police ; console : 161 Ko, 9 Ko, 34 Ko. Ensuite en cache un an |
| Caddy | configuration validée (`caddy validate`, Caddy 2.11.4), puis servie ici avec les applications construites : en-têtes, cache, adresses profondes, 404 et `/api` contrôlés (section 7) |

Limite de cette livraison, comme à l'étape 7 : les images Docker n'ont pas pu être construites ici (Docker Hub et le registre de Microsoft ne sont pas joignables depuis l'environnement de travail). Les fichiers Compose sont validés (`docker compose config`) et la construction de l'image web a été rejouée hors Docker à l'identique (seuls `frontend/` et `contrat/` sont lus). Premier contrôle à faire sur ta machine : `docker compose up -d`, puis `docker compose run --rm navigateur`.

## 2. Décisions à valider

| N° | Sujet | Proposition |
|---|---|---|
| F1 | Deux applications, un seul code | React 19, Vite 8, Tailwind 4. Le portail et la console sont deux constructions séparées (`npm run build:portail`, `npm run build:console`) des mêmes composants que les maquettes et la démo de l'étape 6 : un écran corrigé l'est partout. Un client ne télécharge jamais le code de la console. Pas de rendu côté serveur : deux dossiers de fichiers statiques servis par Caddy |
| F2 | Client d'API tiré du contrat | Chaque appel se fait par le nom de l'opération (`appeler('lireReclamation', { chemin: { id } })`) : méthode, adresse, format du corps (JSON ou fichiers), réponse et sécurité sont lus dans `contrat/openapi.yaml` à la construction, et les types viennent du contrat. Le jeton n'est présenté qu'aux opérations qui l'exigent. Les erreurs de l'API (RFC 9457) s'affichent telles quelles, en français, au bon champ ; une coupure réseau donne « Connexion impossible ». Sur un 401, le jeton est renouvelé une fois et la requête rejouée |
| F3 | Session du client | Le jeton obtenu avec le code à usage unique (30 minutes, B5) est gardé dans le stockage de l'onglet : recharger la page ne redemande pas de code, donc pas de nouveau SMS facturé à la banque. Fermer l'onglet ou attendre 30 minutes le fait disparaître ; rien n'est gardé sur le téléphone au-delà |
| F4 | Adresses des pages | Portail : `/d/<code>` (dépôt), `/suivi/<jeton>` (suivi), `/mes-reclamations[/<id>]`, `/politique-donnees`. Console : `/connexion`, `/invitation`, `/mot-de-passe-oublie`, `/reclamations[/<id>]`, `/parametrage/…`, `/personnel`, `/journal-audit`, `/plateforme/…`. Filtres, tri, page et recherche sont dans l'adresse : une file se partage par un lien et survit au rechargement. Le **tableau de bord**, l'**export CSV** et l'**activité** de la plateforme sont masqués jusqu'à l'étape 9 (reporting) : leurs adresses mènent aux réclamations et aux banques |
| F5 | Session du personnel | Application de B4 : jeton d'accès en mémoire seulement, reprise de la session au chargement par le cookie `HttpOnly`, renouvellement une minute avant l'expiration. Entre onglets, les renouvellements passent l'un après l'autre (verrou du navigateur) : la rotation du refresh token ne ferme jamais la session d'un autre onglet. Les liens d'invitation et de mot de passe portent leur jeton après `#` : il n'est jamais envoyé à un serveur ni journalisé, et il quitte l'adresse dès sa lecture |
| F6 | Nouveautés sans rechargement | Les files, la fiche ouverte, les compteurs et les notifications sont relus toutes les **30 secondes** ; l'espace client toutes les 60 secondes ; tout est relu aussitôt après une action. Pas de temps réel (WebSocket) au MVP : 30 secondes suffisent à des délais SLA comptés en heures. Deux personnes qui agissent sur le même ticket : la seconde reçoit le refus de l'API et la fiche est relue |
| F7 | Service par Caddy | Image web unique (Caddy 2.11.4 et les deux applications). Fichiers à empreinte (`/assets/…`) gardés un an par le navigateur ; `index.html` revalidé à chaque visite : une nouvelle version est prise dès son déploiement, sans vider de cache. **CSP stricte** : scripts, styles, polices et appels uniquement depuis le domaine lui-même, aucune page tierce ne peut encadrer les écrans. Aucun service externe : polices auto-hébergées, QR codes dessinés dans le navigateur |
| F8 | Politique de données | Un texte type, version `2026-09`, montré au client avant le consentement (ARTCI) et accessible depuis chaque formulaire. **Chaque banque le fait valider** par son responsable de la conformité avant l'ouverture (point ouvert) ; la version acceptée est enregistrée avec la réclamation |
| F9 | Poste de travail et téléphone | La console vise un écran de bureau d'au moins 1 180 pixels de large (en dessous, la page défile plutôt que de s'écraser). Le portail est pensé d'abord pour le téléphone : il est testé sur un Pixel 7 |
| F10 | Répondre à un ticket non assigné | Répondre depuis « Ouverte » vaut prise en charge (S1), qui exige un agent assigné (étape 4). L'API refusait déjà la réponse d'un superviseur sur un ticket sans agent, mais la proposait : elle ne la propose plus, et la fiche invite à assigner d'abord (capture 13). La note interne reste possible. Correction de la règle `REPONDRE_AU_CLIENT` dans `backend/src/domaine`, avec son test |
| F11 | Tests dans un vrai navigateur | Playwright et Chromium, sur la vraie API (base jetable `reclamations_navigateur`, jeu de démonstration), les applications construites pour la production et servies sous la CSP de production. Les codes et liens envoyés par e-mail ou SMS sont lus dans la boîte d'envoi. Lancement : `docker compose run --rm navigateur`, ou `npm run test:navigateur` dans `frontend/` |

## 3. Portail client

Même parcours que la maquette validée à l'étape 6, maintenant sur l'API :

- **dépôt** (`/d/<code>`) : formulaire aux couleurs et au logo de la banque, catégories actives, agence imposée par le QR code ou au choix (lien web), téléphone ou e-mail (au moins l'un), jusqu'à 5 pièces jointes vérifiées avant l'envoi (type, 5 Mo), consentement ; un double appui n'envoie qu'une réclamation (clé d'idempotence, B7) ;
- **accusé** : numéro, lien de suivi, rappel de l'envoi par SMS ou e-mail ;
- **suivi** (`/suivi/<jeton>`) : étapes horodatées ; pour lire les réponses, code à 6 chiffres reçu par SMS, ou par e-mail si le client n'a pas donné de téléphone ;
- **espace client** : réponses de la banque, messages avec pièces jointes, téléchargement des pièces, confirmation ou contestation d'une réclamation résolue ;
- QR code inconnu, banque suspendue, lien expiré : un message clair, jamais un écran vide.

| | |
|---|---|
| ![Dépôt](etape-8-captures/01-depot.png) | ![Erreurs du formulaire](etape-8-captures/02-depot-erreurs.png) |
| 01 · Dépôt par QR code, sur téléphone | 02 · Erreurs du formulaire, au bon champ |
| ![Accusé](etape-8-captures/03-accuse.png) | ![Suivi](etape-8-captures/04-suivi.png) |
| 03 · Accusé : numéro et lien de suivi | 04 · Suivi, avant le code à usage unique |
| ![Réponse au client](etape-8-captures/05-reponse-client.png) | |
| 05 · Espace client : réponse de la banque, confirmer ou contester | |

## 4. Console : connexion et réclamations

- **connexion** : e-mail et mot de passe, puis code TOTP (6 cases, collage accepté) ; première connexion d'une invitée : mot de passe, puis QR code à scanner ; mot de passe oublié par e-mail ; message identique que le compte existe ou non ;
- **files** : Reçues, Assignées à moi (Mes réclamations pour un agent), Urgentes, En retard, Escaladées, Toutes, avec leurs compteurs ; filtres (statut, catégorie, agence, canal, agent, période), tri par échéance, recherche par numéro, nom ou téléphone ; notifications ;
- **fiche** : chrono SLA, échanges et notes internes, pièces jointes, chronologie ; seuls les boutons que l'API autorise (`actionsPossibles`, `operationsPossibles`) sont affichés : assigner, prendre en charge, répondre (avec ou sans attente du client), note interne, résoudre, urgence, escalade, clôture de force.

| | |
|---|---|
| ![Connexion](etape-8-captures/20-connexion.png) | ![Activation du TOTP](etape-8-captures/21-activation-totp.png) |
| 20 · Connexion | 21 · Première connexion : activation du TOTP |
| ![Files du superviseur](etape-8-captures/10-files-superviseur.png) | ![Fiche de l'agente](etape-8-captures/11-fiche-agent.png) |
| 10 · Files du superviseur | 11 · Fiche : réponse avec pièce jointe, note interne |
| ![Résolution](etape-8-captures/12-resolution.png) | ![Fiche non assignée](etape-8-captures/13-fiche-non-assignee.png) |
| 12 · Résolution : réponse finale au client | 13 · Ticket sans agent : assigner avant de répondre (F10) |

## 5. Console : paramétrage, personnel, audit

Pour l'Admin Entreprise (et, pour les agences et le personnel, le superviseur) : catégories et délais SLA (création, modification, ordre, retrait du formulaire), agences et points de dépôt (QR code à télécharger en PNG ou SVG pour l'impression, lien web à copier), horaires et jours fériés, apparence (couleurs avec contrôle du contraste, logo) avec aperçu, personnel (invitation, rôle et rattachement à un superviseur, invitation renvoyée, réinitialisation du TOTP, désactivation et réactivation), journal d'audit filtré et vérification de sa chaîne.

| | |
|---|---|
| ![Catégories](etape-8-captures/31-categories.png) | ![Agences et QR codes](etape-8-captures/32-agences-qr.png) |
| 31 · Catégories et délais | 32 · Agences et QR codes |
| ![Horaires](etape-8-captures/33-horaires.png) | ![Apparence](etape-8-captures/34-apparence.png) |
| 33 · Horaires et jours fériés | 34 · Apparence : couleur et logo, aperçu |
| ![Personnel](etape-8-captures/35-personnel.png) | ![Journal d'audit](etape-8-captures/30-audit.png) |
| 35 · Personnel : invitation | 30 · Journal d'audit, chaîne vérifiée |

## 6. Console de la plateforme

Pour le Super Admin : banques (création avec son premier Admin Entreprise, paramètres du contrat, suspension et réactivation), plans, alertes, journal d'audit de la plateforme et de chaque banque (chaîne vérifiée), Super Admins. Aucune description ni coordonnée de client n'y apparaît (arbitrage 7).

| | |
|---|---|
| ![Nouvelle banque](etape-8-captures/40-nouvelle-banque.png) | ![Banques](etape-8-captures/41-banques.png) |
| 40 · Nouvelle banque et son Admin | 41 · Banques |
| ![Alertes](etape-8-captures/42-alertes.png) | |
| 42 · Alertes | |

## 7. Docker et production

**Développement** : `docker compose up -d` démarre aussi les écrans, rechargés à chaque modification.

| Adresse | Contenu |
|---|---|
| http://localhost:5173 | console du personnel (comptes de démonstration : [note de l'étape 7, section 7](etape-7-backend.md#7-jeu-de-démonstration)) |
| http://alpha.localhost:5174/d/7K3QX9P2MA | portail de la Banque Alpha, QR code de l'accueil (Horizon : `horizon.localhost`, `H7P4XK2RQD`) |
| http://localhost:8025 | e-mails envoyés : codes, liens d'invitation, qui pointent vers ces deux adresses |

Les adresses en `.localhost` fonctionnent sans rien configurer dans Chrome, Edge et Firefox. Les écrans appellent `/api` sur leur propre adresse, relayé vers l'API : pas de CORS, comme en production.

**Production** : `docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build` construit maintenant aussi l'image web (`reclamations-web`) : Caddy, le Caddyfile et les deux applications. Rien d'autre à copier sur le VPS.

Contrôles faits ici avec Caddy 2.11.4 et les applications construites :

| Requête | Réponse |
|---|---|
| `/connexion`, `/reclamations/<id>` (adresse profonde) | `index.html`, `Cache-Control: no-cache`, CSP, HSTS, `nosniff`, compressé (zstd ou gzip) |
| `/assets/index-<empreinte>.js` | `Cache-Control: public, max-age=31536000, immutable` |
| `/assets/absent.js` | 404 sans cache (jamais `index.html`) |
| `/api/v1/sante` | relayé vers l'API |
| `/interne/tls` | 404 : la route de contrôle des certificats n'est jamais publiée |

## 8. Ce que vérifient les tests

`frontend/tests/navigateur/`, dans Chromium, sur l'API réelle :

| Fichier | Parcours |
|---|---|
| `1-parcours` | le client dépose par QR code avec une photo ; le superviseur assigne ; l'agente prend en charge, répond avec une pièce jointe, écrit une note, résout ; le client lit la réponse sans la note et confirme ; l'Admin Entreprise retrouve tout dans le journal, chaîne intacte. Les fichiers téléchargés sont comparés octet par octet |
| `2-authentification` | mauvais mot de passe (même message), session reprise après rechargement, déconnexion, page réservée à un rôle, première connexion d'une invitée (mot de passe et TOTP), mot de passe oublié |
| `3-parametrage` | catégories, agence et QR code (PNG vérifié), horaires et jour férié, apparence (le logo s'affiche vraiment sur le portail, la couleur aussi), invitation d'un agent |
| `4-plateforme` | plan, nouvelle banque et son Admin, suspension (le portail se ferme) et réactivation, alertes, journal par banque, Super Admin |
| `5-portail` | dépôt avec un e-mail seulement (code reçu par e-mail), message du client avec pièce jointe, ticket sans agent (F10), résolution puis contestation qui rouvre, QR code inconnu |
| `6-developpement` | les serveurs de développement (`npm run dev:console`, `dev:portail`, services `console` et `portail` de Docker) chargent vraiment les deux applications, sans erreur, et relaient `/api` |

Les tests 1 à 5 utilisent les applications construites comme en production, servies avec la CSP lue dans `docker/caddy/commun.caddy` ; le navigateur signale toute ressource refusée et le lancement échoue s'il y en a une.

Avec Docker (Playwright et Chromium dans un conteneur, rien à installer) :

```bash
docker compose run --rm navigateur                  # 22 tests
docker compose run --rm -e CAPTURES=1 navigateur    # et les captures de cette note
```

Sans Docker (Node.js 22.12, PostgreSQL et Redis du `docker-compose.yml`, `backend/.env` rempli comme à l'étape 7) :

```bash
cd frontend
npm install
npx playwright install chromium
npm test                    # 130 tests unitaires
npm run test:navigateur     # 22 tests dans Chromium
```

## 9. Corrections

- **Serveurs de développement** (signalé le 29/09/2026) : la console et le portail ne se chargeaient pas avec `npm run dev:console`, `dev:portail` ou `docker compose up` (« chargement du module bloqué en raison d'un type MIME interdit »). `index.html` désignait un script hors de la racine de Vite (`../src/app/…`), que le serveur de développement remplaçait par la page HTML ; les applications construites, seules testées jusque-là, n'étaient pas touchées. Chaque application a maintenant son point d'entrée dans sa racine (`console/entree.ts`, `portail/entree.ts`), et le test `6-developpement` charge les deux serveurs de développement.
- **Fichiers servis en JSON en développement** : logo, pièces jointes et QR codes étaient renvoyés en JSON par l'API lancée avec `tsx` (deux copies de la classe `StreamableFile` de NestJS ; l'image de production n'était pas touchée). Les fichiers sont maintenant écrits directement dans la réponse. Les tests navigateur le couvrent : image réellement affichée, fichiers téléchargés identiques à l'octet.
- **Réponse sur un ticket sans agent** : voir F10.

## 10. Points ouverts qui touchent les écrans

- **Nom de domaine** : conditionne les adresses du portail et de la console, et les certificats.
- **Politique de données** : texte type à faire valider par chaque banque (F8).
- **Mécanisme anti-robot** du dépôt : toujours pas affiché, il dépend du mécanisme choisi (étape 7).
- **Avertissement de Prisma 7** dans les journaux de l'API (« `client.query()` when the client is already executing a query ») : il vient du moteur de Prisma lui-même, sans effet aujourd'hui ; à suivre lors des mises à jour de `pg` (version 9).

## 11. Ce qui arrive à l'étape 9

Reporting et notifications : tableau de bord de la banque et indicateurs de la plateforme (dont le taux de résolution au premier contact), export CSV, facturation des SMS, passerelle SMS de Makor à la place de l'adaptateur « journal ». Les pages masquées par F4 apparaissent alors dans la console.
