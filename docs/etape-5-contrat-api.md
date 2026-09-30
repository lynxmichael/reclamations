# Étape 5 — Contrat d'API

Plateforme de gestion des réclamations · Makor Telecoms · Solution 1
Version du 25/09/2026 · **Statut : validé le 25/09/2026** (décisions C1 à C14 retenues telles que proposées). Complété à l'étape 6 par quatre ajouts sans rupture ([décision E6](etape-6-ecrans.md#2-décisions-à-valider)), puis à l'étape 7 : une opération (`lireLogo`, 83 au total), trois codes d'erreur et des réponses d'erreur déclarées ([décision B12](etape-7-backend.md#2-décisions-à-valider)), enfin à l'étape 9 : la courbe d'évolution du tableau de bord (`evolution`, paramètre `regroupement`) et un code d'erreur, `EXPORT_TROP_VOLUMINEUX` ([décision R9](etape-9-reporting-notifications.md#2-décisions-à-valider)).

Livrables :

- [`contrat/openapi.yaml`](../contrat/openapi.yaml) : le contrat OpenAPI 3.1, **82 opérations** ;
- documentation Swagger : `docker compose up -d swagger` puis http://localhost:8081 ;
- [`docs/api/index.html`](api/index.html) : la même documentation en une page, lisible sans connexion ;
- [`backend/src/contrat/api.d.ts`](../backend/src/contrat/api.d.ts) : les types TypeScript générés, que le backend (étape 7) et le frontend (étape 8) utiliseront ;
- [`backend/src/contrat/contrat.test.ts`](../backend/src/contrat/contrat.test.ts) : 30 tests de cohérence entre le contrat et le code des étapes 2 à 4.

## 1. En bref

| Contrôle | Résultat |
|---|---|
| Vérification Redocly (règles recommandées + résumé, identifiant, erreur 4xx obligatoires) | Aucune erreur, aucun avertissement |
| Rendu Swagger UI 5 | 82 opérations, 11 rubriques affichées |
| Cohérence contrat ↔ code | 30 / 30 |
| Tests unitaires au total | 128 / 128 |

Les tests de cohérence échouent si le code et le contrat divergent :

- chaque énumération du contrat (statuts, priorités, rôles, événements…) est identique à celle du modèle Prisma ;
- chaque code d'erreur levé par le code existe dans le contrat ;
- chaque action du service du cycle de vie a exactement une opération d'API (`x-action`) ;
- **les rôles autorisés par l'API sont ceux de la machine d'états** : si l'étape 4 dit que seul le superviseur clôture de force, le contrat ne peut pas l'ouvrir à l'agent ;
- les espaces `/public`, `/client`, `/banque`, `/plateforme` ont chacun le bon mode d'authentification ;
- les types TypeScript générés sont à jour.

## 2. Décisions à valider

| N° | Sujet | Proposition |
|---|---|---|
| C1 | Organisation | Une API `/api/v1`, cinq espaces : `public`, `client`, `auth`, `banque`, `plateforme`. La banque vient toujours du jeton, du code du point de dépôt ou du jeton de suivi, jamais d'un paramètre libre |
| C2 | Même origine | L'API est servie sous `/api/v1` sur chaque portail (`<slug>.<domaine>`) et sur la console (`console.<domaine>`) : pas de CORS, cookies simples. Caddy route `/api/*` vers l'API |
| C3 | Langue | Chemins et champs en français, comme le code et le modèle |
| C4 | Erreurs | Format RFC 9457 (`application/problem+json`) avec un `code` stable, ex. `TRANSITION_INTERDITE`. 400 forme, 401 authentification, 403 rôle, 404 introuvable, 409 état, 422 règle métier, 423 compte verrouillé, 429 débit |
| C5 | Tickets invisibles | Un agent qui demande un ticket non assigné, ou n'importe qui un ticket d'une autre banque, reçoit 404 et non 403 : on ne révèle pas son existence |
| C6 | Sessions du personnel | Jeton d'accès de 15 min + refresh token en cookie httpOnly/Secure/SameSite=Strict, changé à chaque usage. TOTP obligatoire, activé dès l'acceptation de l'invitation. Mot de passe de 12 caractères au moins. Verrouillage 15 min après 5 échecs |
| C7 | Session du client | Code OTP à 6 chiffres, valable 10 min, 5 essais, 3 envois par heure. Session de 30 min limitée au client et à sa banque |
| C8 | Pièces jointes | 5 fichiers au plus par dépôt ou message, 5 Mo chacun, JPEG, PNG, WebP ou PDF. Téléchargement uniquement via l'API (droits vérifiés), jamais par une adresse publique |
| C9 | Dépôt | Idempotent avec l'en-tête `Idempotency-Key` (pas de double ticket sur un réseau mobile instable). 5 dépôts par heure et par IP, 3 par téléphone. Champ `jetonAntiRobot` prévu pour le mécanisme à choisir |
| C10 | Listes et export | Pagination par page (`parPage` ≤ 100). Export CSV en UTF-8 avec BOM et séparateur « ; », lisible directement dans Excel en français |
| C11 | Horaires | Remplacés d'un bloc pour toute la semaine (`PUT /banque/horaires`), avec des heures au format `HH:MM` |
| C12 | Partage des rôles | L'Admin Entreprise paramètre (catégories, agences, points, horaires, personnel, apparence). Le Super Admin règle ce qui touche au contrat commercial : plan, préfixe, fuseau, seuil d'alerte, délai de clôture, option SMS |
| C13 | Création d'une banque | Le Super Admin crée la banque et invite son premier Admin Entreprise en une seule opération ; horaires par défaut lun–ven 08:00–17:00 |
| C14 | Contrat d'abord | Le NestJS de l'étape 7 sert ce fichier (Swagger à `/api/docs`) ; ses tests valident chaque réponse contre le contrat |

## 3. Opérations par espace

| Espace | Opérations | Principales |
|---|---|---|
| `/public` | 5 | Formulaire d'un point de dépôt, dépôt (multipart), chronologie par lien de suivi, envoi et vérification du code OTP |
| `/client` | 6 | Mes réclamations, détail, message, confirmation, contestation, téléchargement |
| `/auth` | 9 | Connexion en deux étapes, invitation et activation du TOTP, rafraîchissement, déconnexion, mot de passe oublié, profil |
| `/banque` | 44 | Files et recherche, détail, 8 actions sur un ticket, indicateurs, export CSV, notifications, paramétrage (catégories, agences, points et QR codes, horaires, jours fériés, apparence), personnel, journal d'audit |
| `/plateforme` | 17 | Banques (création, suspension), plans, indicateurs de toutes les banques, facturation SMS, journal d'audit et vérification des chaînes, alertes, Super Admins |
| `/sante` | 1 | État de l'API, de la base et de Redis |

## 4. Qui peut faire quoi sur un ticket

| Action | Opération | Agent assigné | Superviseur | Admin Entreprise | Client |
|---|---|---|---|---|---|
| Consulter | `GET /banque/reclamations/{id}` | ✓ | ✓ | ✓ | via `/client` |
| Prendre en charge | `POST …/prise-en-charge` | ✓ | ✓ | | |
| Assigner | `POST …/assignation` | | ✓ | | |
| Répondre (ou questionner) | `POST …/reponses` | ✓ | ✓ | | |
| Note interne | `POST …/notes` | ✓ | ✓ | | |
| Résoudre | `POST …/resolution` | ✓ | ✓ | | |
| Changer la priorité | `POST …/priorite` | ✓ | ✓ | | |
| Escalader | `POST …/escalade` | ✓ | | | |
| Clôturer de force | `POST …/cloture-forcee` | | ✓ | | |
| Écrire à la banque | `POST /client/…/messages` | | | | ✓ |
| Confirmer ou contester | `POST /client/…/confirmation`, `…/contestation` | | | | ✓ |

Chaque réponse sur un ticket renvoie `actionsPossibles` et `operationsPossibles` : l'interface affiche seulement les boutons permis à l'utilisateur connecté, calculés par la machine d'états de l'étape 4.

## 5. Consulter le contrat

```bash
docker compose up -d swagger        # http://localhost:8081 (port réglable : SWAGGER_PORT)
```

Ou ouvrir `docs/api/index.html` dans un navigateur, sans Docker ni connexion.

Après une modification du contrat :

```bash
cd backend
npm run contrat:verifier    # règles Redocly
npm run contrat:types       # régénère src/contrat/api.d.ts
npm test                    # tests de cohérence
```

`docker compose run --rm verification` vérifie aussi le contrat avant les tests et les vérifications sur PostgreSQL.

## 6. Ce qui arrive à l'étape 6

Écrans : maquettes du portail client (formulaire de dépôt depuis un QR code, suivi, espace client après OTP) et du back-office (files, fiche d'un ticket, tableau de bord, paramétrage), construites sur ce contrat.
