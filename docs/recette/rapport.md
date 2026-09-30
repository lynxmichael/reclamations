# Rapport de recette automatique

Généré par `recette/recette.mjs` le 30 septembre 2026 à 09:02 (heure d'Abidjan), version 1.0.0, Node.js 22.22.2, en 6 minutes.

**11 critère(s) sur 11 vérifié(s) automatiquement** ; 420 tests réussis sur 420 ; toutes les suites passent.

Ce rapport est la partie automatique de la recette. Le MVP est accepté quand chaque critère est vérifié sur l'environnement de démonstration, avec deux banques de test (section 10 du cahier des charges) : [cahier de recette](cahier-de-recette.md).

## Critères de la section 10

| | Critère | Preuves (tests réussis / tests trouvés) |
|---|---|---|
| ✅ 1 | Une réclamation déposée par QR code est traitée puis clôturée de bout en bout, avec numéro, accusé de réception par e-mail et par SMS. | 8/8 `parcours.e2e.test.ts`<br>5/5 `navigateur/1-parcours.spec.ts` |
| ✅ 2 | Le client voit à tout moment l'étape exacte et horodatée de sa réclamation. | 2/2 `parcours.e2e.test.ts`<br>1/1 `navigateur/1-parcours.spec.ts`<br>3/3 `navigateur/5-portail.spec.ts` |
| ✅ 3 | Une réclamation urgente alerte immédiatement l'agent, le superviseur, l'Admin Entreprise et le Super Admin ; l'alerte du Super Admin ne contient ni nom ni description. | 2/2 `back-office.e2e.test.ts`<br>139/139 `vérifications PostgreSQL` |
| ✅ 4 | Un agent de la banque A qui demande un ticket de la banque B reçoit 404 ; la même lecture, faite directement en SQL, ne renvoie rien. | 4/4 `securite.e2e.test.ts`<br>139/139 `vérifications PostgreSQL` |
| ✅ 5 | Le délai SLA exclut les heures non ouvrées et les jours fériés, et se suspend en « En attente client ». | 1/1 `worker.e2e.test.ts`<br>1/1 `parcours.e2e.test.ts`<br>22/22 `backend/src/domaine/temps-ouvre/`<br>10/10 `backend/src/domaine/reclamation/sla` |
| ✅ 6 | L'alerte préventive part à 75 % du délai, l'escalade au dépassement, chacune une seule fois. | 1/1 `worker.e2e.test.ts` |
| ✅ 7 | Une résolution non contestée est clôturée automatiquement après 5 jours ; une contestation rouvre le ticket. | 1/1 `worker.e2e.test.ts`<br>1/1 `back-office.e2e.test.ts`<br>1/1 `navigateur/5-portail.spec.ts` |
| ✅ 8 | Le taux de résolution au premier contact correspond à la définition de la section 6.6. | 1/1 `reporting.e2e.test.ts`<br>139/139 `vérifications PostgreSQL` |
| ✅ 9 | Le journal d'audit restitue toutes les actions d'une réclamation ; une ligne modifiée à la main est détectée par la vérification de la chaîne. | 1/1 `parametrage.e2e.test.ts`<br>1/1 `navigateur/1-parcours.spec.ts`<br>1/1 `navigateur/4-plateforme.spec.ts` |
| ✅ 10 | Les opérations courantes répondent en moins d'une seconde. | 8/8 `performance.e2e.test.ts` |
| ✅ 11 | Les listes s'exportent en CSV. | 3/3 `reporting.e2e.test.ts`<br>2/2 `navigateur/7-reporting.spec.ts` |

### Critère 10 : mesures

Banque de 1 000 réclamations, 20 appels par opération à travers toute la pile (HTTP, contrat, RLS, Prisma) ; seuil : p95 sous 1 000 ms.

| Opération | p95 | max |
|---|---:|---:|
| file « toutes », 25 par page | 37 ms | 78 ms |
| file « reçues » triée par échéance | 36 ms | 37 ms |
| recherche par nom de client | 134 ms | 182 ms |
| fiche d'une réclamation | 19 ms | 58 ms |
| assignation (écriture + notifications + audit) | 49 ms | 55 ms |
| tableau de bord du mois (indicateurs du §6.6 et courbe) | 28 ms | 50 ms |
| tableau de bord sur un an, par semaine | 27 ms | 29 ms |
| export CSV de toute la banque (plus de 1000 lignes) | 139 ms | 182 ms |

## Suites

| Suite | Résultat | Tests | Durée |
|---|---|---:|---:|
| Contrat d'API (OpenAPI 3.1, Redocly) | ✅ réussie |  | 1 s |
| Backend : types TypeScript | ✅ réussie |  | 15 s |
| Backend : tests unitaires | ✅ réussie | 170/170 | 12 s |
| PostgreSQL : intégrité, sécurité (RLS), cycle de vie et SLA | ✅ réussie |  | 10 s |
| API de bout en bout (base recréée, jeu des deux banques) | ✅ réussie | 88/88 | 118 s |
| Frontend : types TypeScript | ✅ réussie |  | 17 s |
| Frontend : tests unitaires | ✅ réussie | 136/136 | 11 s |
| Construction de production (API, worker, console, portail) | ✅ réussie |  | 13 s |
| Écrans dans Chromium (API réelle, CSP de production) | ✅ réussie | 26/26 | 124 s |
| Sauvegarde chiffrée et restauration (docker/sauvegarde/essai.sh) | ✅ réussie |  | 24 s |

Vérifications PostgreSQL (intégrité, sécurité, cycle de vie) : 32 vérifications réussies, 0 en échec · 62 vérifications réussies, 0 en échec · 45 vérifications réussies, 0 en échec.

Sauvegarde et restauration : 28/28 contrôles réussis (chiffrement, copie hors du VPS et rétention, restauration vérifiée, journal falsifié et pièce perdue détectés, remplacement de la base).

## Mise en production

- Écrans construits (JavaScript et CSS compressés) : console 179 Ko, portail 136 Ko.
- `npm audit` backend, dépendances de production : 0 critique(s), 4 élevée(s), 0 moyenne(s), 0 faible(s) ; @prisma/config, deepmerge-ts, mysql2, prisma : CLI Prisma et ses dépendances (image des migrations seulement), retirés de l'image de l'application.
- `npm audit` backend, toutes les dépendances (outils de développement compris) : 0 critique(s), 4 élevée(s), 0 moyenne(s), 0 faible(s).
- `npm audit` frontend, dépendances de production : 0 critique(s), 0 élevée(s), 0 moyenne(s), 0 faible(s).
- `npm audit` frontend, toutes les dépendances (outils de développement compris) : 0 critique(s), 0 élevée(s), 0 moyenne(s), 0 faible(s).
- Contrôle d'un déploiement réel (HTTPS, en-têtes, santé, conteneurs, pare-feu, sauvegarde) : `./deploiement/verifier.sh --local`, sur le VPS (docs/exploitation.md).

Journaux complets de cette exécution : `recette/.resultats/` (10 fichiers, non versionnés).

