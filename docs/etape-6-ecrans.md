# Étape 6 — Écrans

Plateforme de gestion des réclamations · Makor Telecoms · Solution 1
Version du 25/09/2026 · **Statut : validé le 28/09/2026** (décisions E1 à E12 retenues telles que proposées). Complété par une [démo cliquable](demo-cliquable.md) pour les rendez-vous commerciaux.

Livrables :

- [`docs/maquettes/index.html`](maquettes/index.html) : les **21 écrans** en une seule page, à ouvrir dans un navigateur, sans serveur ni connexion. Chaque écran a ses variantes (rôle, état, banque) et, dessous, les opérations du contrat qui l'alimentent ;
- [`frontend/`](../frontend/) : le projet React qui produit ces maquettes. Les écrans sont des composants alimentés par les types du contrat : l'étape 8 les branchera sur l'API ;
- [`frontend/tests/`](../frontend/tests/) : 112 tests qui confrontent les maquettes au contrat et à la machine d'états (122 avec ceux de la démo) ;
- quatre ajouts au contrat, sans rupture (décision E6), et la documentation hors ligne du contrat régénérée ([`docs/api/index.html`](api/index.html)) ;
- en plus : [`docs/demo/index.html`](demo/index.html), une **démo cliquable** pour les rendez-vous avec les banques, construite sur ces écrans et sur les règles du backend. Voir le [guide de présentation](demo-cliquable.md).

![La galerie : fiche d'une réclamation vue par un superviseur](etape-6-captures/00-galerie.png)

## 1. En bref

| Contrôle | Résultat |
|---|---|
| Écrans | 21 : portail client 6, connexion 3, back-office 9, console de la plateforme 3 |
| Données des maquettes validées contre les schémas du contrat (sans champ en plus) | 34 / 34 |
| Boutons d'une réclamation identiques à la machine d'états de l'étape 4 | 5 / 5 (agent, superviseur, Admin Entreprise, client × 2) |
| Écrans affichés dans toutes leurs variantes, sans valeur manquante | 50 / 50 |
| Opérations citées présentes dans le contrat | 21 / 21 écrans |
| Tests du frontend au total | **122 / 122** (dont 10 pour la démo cliquable) |
| Backend (étapes 2 à 5), rejoué après les ajouts au contrat | 130 tests, contrat valide, aucune dérive |
| Page des maquettes | 655 Ko, une seule page, polices et scripts inclus |
| Démo cliquable | 632 Ko, visite guidée en 13 étapes rejouée sans erreur ; 10 tests du moteur, toutes ses réponses conformes au contrat |

## 2. Décisions à valider

| N° | Sujet | Proposition |
|---|---|---|
| E1 | Technique du frontend | React 19, Vite 8, TypeScript, Tailwind CSS 4, React Router. Les écrans reçoivent uniquement les types générés du contrat : à l'étape 8, les mêmes composants seront alimentés par l'API |
| E2 | Marque de la banque | Le portail et le back-office prennent la couleur principale de la banque. Le texte posé dessus (blanc ou foncé) est choisi automatiquement, et les liens sont assombris jusqu'au contraste 4,5 pour 1 : une banque au jaune vif reste lisible. Sans logo, ses initiales s'affichent. La console de Makor Telecoms a sa propre couleur |
| E3 | Typographie | Une seule famille, Atkinson Hyperlegible Next, conçue pour qu'on ne confonde pas 0 et O, 1 et l : utile pour lire un numéro de réclamation ou un code. Auto-hébergée (environ 50 Ko) : aucun appel à un service externe |
| E4 | Droits dans l'interface | L'interface n'a aucune règle de droits à elle : chaque bouton vient de `actionsPossibles` et `operationsPossibles` renvoyés par l'API (machine d'états de l'étape 4) |
| E5 | Chrono SLA | Une jauge unique, dans les files et en tête de fiche : temps ouvré consommé, trait au seuil d'alerte de la banque, cinq états (dans les délais, seuil franchi, dépassé, en pause, arrêté). Couleurs fixes pour toutes les banques, toujours doublées d'une icône et d'un libellé |
| E6 | Ajouts au contrat | Les écrans ont montré quatre manques, comblés sans rupture : **état du chrono** (`EtatChrono`) et **résumé SLA** dans les files (`ReclamationResume.sla`) ; `EtatSla.etat` et **minutes restantes calculées à la lecture** ; **compteurs des onglets** (`PageReclamations.compteurs`) ; **`operationsPossibles` pour le client** (`ReclamationClient`). Plus une correction de typage : `LigneAudit.donnees` est un objet libre |
| E7 | Tableau de bord | Pas de courbe d'évolution : le contrat ne fournit pas de série par jour ou par semaine. Proposition : l'ajouter à l'étape 9 (reporting) avec un paramètre de regroupement |
| E8 | Formulaire de dépôt | Une seule page, pas d'assistant en plusieurs étapes ; catégories en liste de choix (pas de menu déroulant) ; bouton d'envoi fixé en bas de l'écran ; téléphone précédé de +225. Les erreurs de l'API (RFC 9457) s'affichent en tête et sous chaque champ |
| E9 | Ce que voit le client | Statuts formulés pour lui (« En attente de votre réponse », « Résolue, à confirmer ») ; réponses signées par la banque, jamais par le nom de l'agent ; aucune note interne ; date de clôture automatique rappelée |
| E10 | Réponse ou note interne | Deux onglets distincts dans la fiche ; la note interne est sur fond ambre et marquée « invisible du client ». « Attendre la réponse du client » transforme la réponse en question et met le chrono en pause |
| E11 | Erreur de connexion | Message identique que l'e-mail existe ou non (pas d'indice pour un attaquant), avec le rappel du verrouillage après 5 échecs |
| E12 | QR codes | Un QR code par emplacement physique, regroupés par agence ; PNG pour l'écran, SVG pour l'impression (formats du contrat) |

## 3. Portail client (téléphone)

| N° | Écran | Opérations |
|---|---|---|
| 1 | Déposer une réclamation (QR code de l'agence Plateau) | `lireFormulaireDepot`, `deposerReclamation` |
| 2 | Accusé de réception | `deposerReclamation` |
| 3 | Suivi par le lien reçu | `lireSuivi`, `demanderCodeOtp` |
| 4 | Code à usage unique | `verifierCodeOtp`, `demanderCodeOtp` |
| 5 | Espace client | `listerMesReclamations` |
| 6 | Réponses et confirmation | `lireMaReclamation`, `envoyerMessageClient`, `confirmerResolution`, `contesterResolution`, `telechargerPieceJointeClient` |

| Dépôt | Erreurs renvoyées par l'API | Accusé | Suivi public |
|---|---|---|---|
| ![](etape-6-captures/01-depot.png) | ![](etape-6-captures/02-depot-erreurs.png) | ![](etape-6-captures/03-accuse.png) | ![](etape-6-captures/04-suivi.png) |

| Code OTP | Espace client | Résolue : confirmer ou contester | En cours : écrire à la banque |
|---|---|---|---|
| ![](etape-6-captures/05-code.png) | ![](etape-6-captures/06-espace-client.png) | ![](etape-6-captures/07-reclamation-resolue.png) | ![](etape-6-captures/08-reclamation-en-cours.png) |

Le même formulaire aux couleurs d'une autre banque (décision E2) :

![Portail aux couleurs de la Banque Horizon](etape-6-captures/09-depot-horizon.png)

## 4. Connexion du personnel

| Écran | Opérations |
|---|---|
| Connexion | `connexion`, `demanderReinitialisation` |
| Code TOTP | `validerCodeTotp` |
| Première connexion (activation du TOTP) | `accepterInvitation`, `activerTotp` |

| Erreur de connexion | Code TOTP | Première connexion |
|---|---|---|
| ![](etape-6-captures/10-connexion-erreur.png) | ![](etape-6-captures/11-code-totp.png) | ![](etape-6-captures/12-premiere-connexion.png) |

## 5. Back-office de la banque

| Écran | Qui | Opérations |
|---|---|---|
| Files de traitement | Agent (ses réclamations), superviseur, Admin Entreprise | `listerReclamations`, `exporterReclamations`, `listerNotifications`, `assignerReclamation` |
| Fiche d'une réclamation | Agent assigné et superviseur agissent ; Admin Entreprise consulte | `lireReclamation` et les 8 actions (`prendreEnCharge` … `cloturerDeForce`), `telechargerPieceJointe` |
| Tableau de bord | Superviseur, Admin Entreprise | `lireIndicateurs`, `exporterReclamations` |
| Catégories et délais | Admin Entreprise | `listerCategories`, `creerCategorie`, `modifierCategorie` |
| Agences et QR codes | Admin Entreprise ; superviseur (téléchargement) | `listerAgences`, `creerAgence`, `listerPointsDepot`, `creerPointDepot`, `modifierPointDepot`, `telechargerQrCode` |
| Horaires et jours fériés | Admin Entreprise | `lireHoraires`, `remplacerHoraires`, `listerJoursFeries`, `ajouterJourFerie`, `supprimerJourFerie` |
| Banque et apparence | Admin Entreprise | `lireParametresBanque`, `modifierApparence`, `televerserLogo` |
| Personnel | Admin Entreprise ; superviseur (lecture) | `listerUtilisateurs`, `inviterUtilisateur`, `modifierUtilisateur`, `desactiverUtilisateur`, `renvoyerInvitation`, `reinitialiserTotp` |
| Journal d'audit | Admin Entreprise | `listerJournalBanque`, `verifierJournalBanque` |

La navigation suit le rôle : l'agent ne voit que ses réclamations ; le superviseur ajoute le tableau de bord, les QR codes et son équipe ; l'Admin Entreprise paramètre la banque et consulte le journal.

**Files de traitement.** Onglets du §6.2 avec leurs compteurs, tri par échéance la plus proche, chrono de chaque réclamation.

![Files du superviseur](etape-6-captures/13-files-superviseur.png)

![Files de l'agent, notifications ouvertes](etape-6-captures/14-files-agent-notifications.png)

**Fiche d'une réclamation.** Les boutons changent avec l'utilisateur : l'agent assigné peut escalader, le superviseur assigner et clôturer de force, l'Admin Entreprise lit seulement.

![Fiche vue par l'agent assigné](etape-6-captures/15-fiche-agent.png)

| Superviseur : clôture forcée | Admin Entreprise : lecture seule | Résoudre : réponse finale obligatoire |
|---|---|---|
| ![](etape-6-captures/16-fiche-superviseur-cloture.png) | ![](etape-6-captures/17-fiche-admin.png) | ![](etape-6-captures/18-fiche-resoudre.png) |

**Tableau de bord** (indicateurs du §6.6, délais en temps ouvré) :

![Tableau de bord](etape-6-captures/19-tableau-de-bord.png)

**Paramétrage et équipe :**

| Catégories et délais | Agences et QR codes |
|---|---|
| ![](etape-6-captures/20-categories.png) | ![](etape-6-captures/21-agences-qr.png) |

| Horaires et jours fériés | Banque et apparence |
|---|---|
| ![](etape-6-captures/22-horaires.png) | ![](etape-6-captures/23-banque-apparence.png) |

| Personnel | Journal d'audit |
|---|---|
| ![](etape-6-captures/24-personnel.png) | ![](etape-6-captures/25-journal-audit.png) |

## 6. Console de la plateforme (Super Admin)

Servie sur `console.<domaine>`. Métadonnées seulement : ni texte de réclamation, ni client (arbitrage 4, droits par colonne de l'étape 3).

| Écran | Opérations |
|---|---|
| Banques clientes, création d'une banque avec son premier Admin Entreprise | `listerBanques`, `listerPlans`, `creerBanque`, `suspendreBanque`, `reactiverBanque` |
| Activité et SMS | `lireIndicateursPlateforme`, `lireFacturationSms` |
| Alertes | `listerNotificationsPlateforme`, `marquerNotificationPlateformeLue` |

| Banques | Nouvelle banque (décision C13) |
|---|---|
| ![](etape-6-captures/26-banques.png) | ![](etape-6-captures/27-nouvelle-banque.png) |

| Activité et SMS | Alertes |
|---|---|
| ![](etape-6-captures/28-activite-sms.png) | ![](etape-6-captures/29-alertes.png) |

## 7. Ce que vérifient les tests

`frontend/tests/maquettes.test.ts` et `frontend/tests/ecrans.test.tsx` :

- **données conformes au contrat** : chaque donnée affichée (34 réponses d'API fictives : formulaire, files, fiche, indicateurs, personnel, journal, banques…) est validée contre son schéma de `contrat/openapi.yaml`, en mode strict : un champ que l'API ne fournit pas fait échouer le test ;
- **boutons conformes à la machine d'états** : pour la fiche vue par l'agent, le superviseur et l'Admin Entreprise, et pour le client (réclamation en cours ou résolue), `actionsPossibles` et `operationsPossibles` sont recalculés avec le code de l'étape 4 et comparés ;
- **écrans complets** : chaque écran est rendu dans toutes ses variantes (rôle, état, banque) ; aucun « undefined », « null », « NaN » ni date invalide n'apparaît ; aux couleurs de la Banque Horizon, plus aucune mention de la Banque Alpha ;
- **opérations existantes** : chaque opération citée sous un écran existe dans le contrat ;
- **types à jour** : `frontend/src/api/schema.d.ts` correspond au contrat.

Les données sont fictives (banques, personnes, adresses). L'instant des maquettes est le vendredi 25/09/2026 à 15:10 ; les échéances et minutes restantes ont été calculées avec les horaires lun–ven 08:00–12:00 et 14:00–17:30, comme l'exemple vérifié de l'étape 4.

## 8. Ouvrir les maquettes

Ouvrir `docs/maquettes/index.html` dans un navigateur : sommaire, système visuel, puis chaque écran. Le bouton « Écran seul » affiche l'écran sans cadre.

Avec Docker, pour relancer les tests et reconstruire les maquettes et la démo :

```bash
docker compose run --rm maquettes
```

Sans Docker, avec Node.js 22 :

```bash
cd frontend
npm install
npm test                  # 122 tests (maquettes et démo) ; 130 depuis l'étape 8
npm run dev               # galerie en direct : http://localhost:5175
npm run dev:demo          # démo en direct : http://localhost:5175
npm run build             # reconstruit docs/maquettes/index.html et docs/demo/index.html
```

Depuis l'étape 8, les ports 5173 et 5174 sont ceux de la console et du portail branchés sur l'API ([note de l'étape 8](etape-8-frontend.md)), et `npm run build` construit aussi ces deux applications.

`docker compose run --rm verification` vérifie toujours le contrat et le backend (étapes 2 à 5).

## 9. Points ouverts qui touchent les écrans

- **Nom de domaine** : les maquettes utilisent `<slug>.reclamations.example` et `console.reclamations.example` en attendant le vrai domaine.
- **Mécanisme anti-robot** du dépôt (champ `jetonAntiRobot`) : pas encore affiché, il dépend du mécanisme choisi.
- **Courbe d'évolution** du tableau de bord : voir E7.

## 10. Ce qui arrive à l'étape 7

Backend MVP : l'API NestJS qui sert ce contrat (Swagger à `/api/docs`), branchée sur le service du cycle de vie de l'étape 4, les tâches planifiées sur BullMQ, et le fichier `docker-compose.prod.yml` pour le VPS Contabo. Ses tests valideront chaque réponse contre le contrat, comme ceux des maquettes.
