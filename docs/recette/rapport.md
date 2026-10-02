# Rapport de recette automatique

Généré par `recette/recette.mjs` le 2 octobre 2026 à 15:28 (heure d'Abidjan), version 1.0.0, Node.js 22.20.0, en 23 minutes.

**10 critère(s) sur 11 vérifié(s) automatiquement**, et 3 sur 3 de la phase 2 ; 577 tests réussis sur 577 ; suite(s) en échec : API de bout en bout (base recréée, jeu des deux banques).

Ce rapport est la partie automatique de la recette. Le MVP est accepté quand chaque critère est vérifié sur l'environnement de démonstration, avec deux banques de test (section 10 du cahier des charges) : [cahier de recette](cahier-de-recette.md).

## Critères de la section 10

| | Critère | Preuves (tests réussis / tests trouvés) |
|---|---|---|
| ✅ 1 | Une réclamation déposée par QR code est traitée puis clôturée de bout en bout, avec numéro, accusé de réception par e-mail et par SMS. | 8/8 `parcours.e2e.test.ts`<br>5/5 `navigateur/1-parcours.spec.ts` |
| ✅ 2 | Le client voit à tout moment l'étape exacte et horodatée de sa réclamation. | 2/2 `parcours.e2e.test.ts`<br>1/1 `navigateur/1-parcours.spec.ts`<br>3/3 `navigateur/5-portail.spec.ts` |
| ✅ 3 | Une réclamation urgente alerte immédiatement l'agent, le superviseur, l'Admin Entreprise et le Super Admin ; l'alerte du Super Admin ne contient ni nom ni description. | 2/2 `back-office.e2e.test.ts`<br>183/183 `vérifications PostgreSQL` |
| ✅ 4 | Un agent de la banque A qui demande un ticket de la banque B reçoit 404 ; la même lecture, faite directement en SQL, ne renvoie rien. | 4/4 `securite.e2e.test.ts`<br>183/183 `vérifications PostgreSQL` |
| ✅ 5 | Le délai SLA exclut les heures non ouvrées et les jours fériés, et se suspend en « En attente client ». | 1/1 `worker.e2e.test.ts`<br>1/1 `parcours.e2e.test.ts`<br>26/26 `backend/src/domaine/temps-ouvre/`<br>10/10 `backend/src/domaine/reclamation/sla` |
| ✅ 6 | L'alerte préventive part à 75 % du délai, l'escalade au dépassement, chacune une seule fois. | 1/1 `worker.e2e.test.ts` |
| ✅ 7 | Une résolution non contestée est clôturée automatiquement après 5 jours ; une contestation rouvre le ticket. | 1/1 `worker.e2e.test.ts`<br>1/1 `back-office.e2e.test.ts`<br>1/1 `navigateur/5-portail.spec.ts` |
| ✅ 8 | Le taux de résolution au premier contact correspond à la définition de la section 6.6. | 1/1 `reporting.e2e.test.ts`<br>183/183 `vérifications PostgreSQL` |
| ✅ 9 | Le journal d'audit restitue toutes les actions d'une réclamation ; une ligne modifiée à la main est détectée par la vérification de la chaîne. | 1/1 `parametrage.e2e.test.ts`<br>1/1 `navigateur/1-parcours.spec.ts`<br>1/1 `navigateur/4-plateforme.spec.ts` |
| ❌ 10 | Les opérations courantes répondent en moins d'une seconde. | 0/0 `performance.e2e.test.ts` |
| ✅ 11 | Les listes s'exportent en CSV. | 3/3 `reporting.e2e.test.ts`<br>3/3 `navigateur/7-reporting.spec.ts` |

## Critères de la phase 2

3 critère(s) sur 3 vérifié(s) : un par fonction de la phase 2 livrée (cadrage de l'étape 14).

| | Critère | Preuves (tests réussis / tests trouvés) |
|---|---|---|
| ✅ 12 | Étape 15 — Enquêtes de satisfaction : à la clôture confirmée ou automatique, le message de clôture porte le lien d'une enquête (satisfaction de 1 à 5, recommandation de 0 à 10, commentaire facultatif), à laquelle le client répond une seule fois dans les 7 jours ; le tableau de bord donne le taux de réponse, les satisfaits, la note moyenne et le NPS, avec les filtres et par agent ; l'agent ne voit que les siens ; le Super Admin ne voit que des totaux par banque, jamais les commentaires. | 12/12 `satisfaction.e2e.test.ts`<br>6/6 `navigateur/8-satisfaction.spec.ts`<br>183/183 `vérifications PostgreSQL` |
| ✅ 13 | Étape 16 — Attribution et escalade automatiques : ouvertes banque par banque par le Super Admin ; l'Admin Entreprise confie chaque catégorie et chaque agence à un groupe d'agents ; une nouvelle réclamation va à l'agent disponible le moins chargé (mode automatique, pendant les heures d'ouverture) ou lui est proposée (mode suggestion, le superviseur valide) ; un agent absent ne reçoit rien ; sans agent disponible, elle reste dans la file du superviseur ; au-delà du seuil de la catégorie ou de la banque, l'Admin Entreprise est prévenu, après les alertes à 75 % et au dépassement. | 20/20 `attribution.e2e.test.ts`<br>6/6 `navigateur/9-attribution.spec.ts`<br>183/183 `vérifications PostgreSQL` |
| ✅ 14 | Étape 17 — Conversations et chat web : ouverts banque par banque par le Super Admin ; le client identifié par le lien de suivi et le code écrit à la banque dans un chat intégré au portail (même domaine, sans script tiers) et voit les réponses arriver ; une conversation par réclamation, isolée par banque, jamais lue par le Super Admin ; les agents répondent depuis une boîte de réception (à répondre, non lues), l'agent ne voyant que ses réclamations ; une rafale de messages n'alerte l'agent qu'une fois ; une réponse lue dans le chat n'envoie ni e-mail ni SMS, une réponse non lue 2 minutes après en envoie un seul. | 17/17 `conversations.e2e.test.ts`<br>5/5 `navigateur/10-conversations.spec.ts`<br>11/11 `backend/src/domaine/conversation`<br>183/183 `vérifications PostgreSQL` |

## Suites

| Suite | Résultat | Tests | Durée |
|---|---|---:|---:|
| Contrat d'API (OpenAPI 3.1, Redocly) | ✅ réussie |  | 8 s |
| Backend : types TypeScript | ✅ réussie |  | 80 s |
| Backend : tests unitaires | ✅ réussie | 201/201 | 21 s |
| PostgreSQL : intégrité, sécurité (RLS), cycle de vie et SLA | ✅ réussie |  | 52 s |
| API de bout en bout (base recréée, jeu des deux banques) | ❌ en échec (recette/.resultats/backend-e2e.log) | 135/135 | 262 s |
| Frontend : types TypeScript | ✅ réussie |  | 34 s |
| Frontend : tests unitaires | ✅ réussie | 198/198 | 31 s |
| Construction de production (API, worker, console, portail) | ✅ réussie |  | 68 s |
| Écrans dans Chromium (API réelle, CSP de production) | ✅ réussie | 43/43 | 580 s |
| Sauvegarde chiffrée et restauration (docker/sauvegarde/essai.sh) | ✅ réussie |  | 207 s |

Vérifications PostgreSQL (intégrité, sécurité, cycle de vie) : 32 vérifications réussies, 0 en échec · 106 vérifications réussies, 0 en échec · 45 vérifications réussies, 0 en échec.

Sauvegarde et restauration : 39/39 contrôles réussis (chiffrement, copie hors du VPS et rétention, restauration vérifiée, journal falsifié et pièce perdue détectés, remplacement de la base ; copies verrouillées, intrusion avec les clés du compartiment détectée et sans perte).

## Mise en production

- Écrans construits (JavaScript et CSS compressés) : console 194 Ko, portail 144 Ko.
- `npm audit` backend, dépendances de production : 0 critique(s), 4 élevée(s), 0 moyenne(s), 0 faible(s) ; @prisma/config, deepmerge-ts, mysql2, prisma : CLI Prisma et ses dépendances (image des migrations seulement), retirés de l'image de l'application.
- `npm audit` backend, toutes les dépendances (outils de développement compris) : 0 critique(s), 4 élevée(s), 0 moyenne(s), 0 faible(s).
- `npm audit` frontend, dépendances de production : 0 critique(s), 0 élevée(s), 0 moyenne(s), 0 faible(s).
- `npm audit` frontend, toutes les dépendances (outils de développement compris) : 0 critique(s), 0 élevée(s), 0 moyenne(s), 0 faible(s).
- Contrôle d'un déploiement réel (HTTPS, en-têtes, santé, conteneurs, pare-feu, sauvegarde) : `./deploiement/verifier.sh --local`, sur le VPS (docs/exploitation.md).

Journaux complets de cette exécution : `recette/.resultats/` (11 fichiers, non versionnés).

