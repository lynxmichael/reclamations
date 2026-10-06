# Étape 18 — Assistant IA de première ligne

Plateforme de gestion des réclamations · Makor Telecoms · Solution 1
Version du 02/10/2026 · **Statut : validé le 05/10/2026** (décisions V1 à V14 retenues telles que proposées).

C'est la quatrième fonction de la phase 2, cadrée à l'étape 14 (décisions I3 à I6). Sur le portail de la banque, **un assistant automatique** accueille le client, répond aux questions fréquentes avec **les réponses écrites par la banque**, prépare la réclamation que **le client envoie lui-même** et passe la main à un conseiller dès que le client le demande. Côté banque, l'agent peut lui demander **un brouillon de réponse**, qu'il relit, corrige et envoie lui-même.

**Le principe : l'IA trie, la banque parle.** Sur le portail, l'IA ne fait que classer le message du client (une question fréquente, une réclamation, une demande de conseiller…). Ce que lit le client vient de textes fixes et de la base de réponses de la banque. L'IA ne peut donc ni promettre un remboursement ou un délai, ni annoncer un statut, ni conseiller, ni demander un code : ce n'est pas une consigne qu'elle pourrait oublier, c'est la construction.

**Rien ne change pour une banque qui ne l'a pas activé.** L'assistant est fermé par défaut ; le Super Admin l'ouvre banque par banque (décision I2), seulement avec le chat web. **Sans fournisseur d'IA configuré, il fonctionne déjà**, avec des règles de mots-clés : rien ne quitte alors le serveur. Le fournisseur se choisit sur le banc d'essai livré avec cette étape.

> **Neutralité.** Cette étape a été réalisée par Claude, un modèle d'Anthropic, et Anthropic est l'un des trois fournisseurs candidats. Pour cette raison, le banc ne laisse aucune place à l'appréciation : 70 % de la note sont mesurés automatiquement, sur les mêmes 100 échanges et avec les mêmes consignes pour les trois. Les 30 % « données » viennent d'une grille de critères explicite, notée d'après les documents publics des fournisseurs. Cette grille est à vérifier par Makor et par la banque sur les contrats (décision V11).

Livrables :

- **Base de données.** Migration [`20261004120000_assistant_ia`](../backend/prisma/migrations/20261004120000_assistant_ia/migration.sql) :
  - `banque.assistant_ia`, qui exige le chat web (contrainte) ;
  - la base de réponses de chaque banque (`reponse_assistant`) ;
  - le journal des appels à l'IA (`appel_ia`), **sans aucun contenu** ;
  - isolation par banque ; journal non modifiable ; la plateforme lit le journal, pas la base de réponses.
- **Règles.** Code pur dans [`domaine/ia/`](../backend/src/domaine/ia/), partagé avec la démo cliquable et le banc d'essai :
  - [masquage](../backend/src/domaine/ia/masquage.ts) ;
  - [interdits](../backend/src/domaine/ia/interdits.ts) et demande d'un humain ;
  - [assistant](../backend/src/domaine/ia/assistant.ts) : textes fixes, réponse au client, tri par règles ;
  - [consignes](../backend/src/domaine/ia/consignes.ts) envoyées au fournisseur, les mêmes pour l'API et le banc ;
  - [base d'exemple](../backend/src/domaine/ia/exemples.ts).
- **Contrat.** [`contrat/openapi.yaml`](../contrat/openapi.yaml) passe de 100 à **107 opérations**, dans un nouveau groupe « Assistant IA » (partie 6).
- **API.**
  - [Adaptateurs](../backend/src/infrastructure/ia/fournisseurs.ts) Anthropic, OpenAI et Mistral, interchangeables par la configuration.
  - [Moteur](../backend/src/application/ia/moteur.ts) : appel, repli sur les règles, plafond, journal.
  - [Module assistant](../backend/src/modules/assistant/assistant.service.ts) : portail, base de réponses, brouillons, consommation.
- **Banc d'essai.**
  - [Corpus](../backend/banc-ia/corpus.json) : 100 échanges fictifs en français d'Abidjan, plus 15 messages neufs de contrôle.
  - [Candidats](../backend/banc-ia/fournisseurs.json), avec leur grille « données ».
  - [Script](../backend/scripts/banc-ia.ts) et [notation](../backend/scripts/banc-ia/evaluation.ts).
  - [Rapport](banc-ia/rapport.md), produit ici avec les règles seules, faute de clés d'API (partie 5).
- **Écrans.**
  - L'[assistant du portail](../frontend/src/ecrans/portail/Assistant.tsx), avant le [formulaire de dépôt](../frontend/src/ecrans/portail/Depot.tsx).
  - La [base de réponses](../frontend/src/ecrans/back-office/ReponsesAssistant.tsx) (Admin Entreprise).
  - « Suggérer une réponse » sur la [fiche](../frontend/src/ecrans/back-office/Ticket.tsx).
  - La case « Assistant IA » et le tableau de consommation dans la console de la plateforme ([Banques](../frontend/src/ecrans/plateforme/Banques.tsx), [Activité](../frontend/src/ecrans/plateforme/Activite.tsx)).
- **Démo, maquettes et jeu de démonstration.**
  - [Démo cliquable](demo/index.html) : sur le téléphone du client, « Être aidé par l'assistant automatique » au-dessus du formulaire ; sur la fiche, « Suggérer une réponse » (règles, sans IA).
  - [Maquettes](maquettes/index.html) : trois écrans de plus (« Assistant automatique », trois conversations ; « Fiche, brouillon de l'assistant IA » ; « Assistant IA : base de réponses »), et l'usage de l'IA dans « Activité et SMS ».
  - Jeu de démonstration : assistant ouvert pour la Banque Alpha, 9 réponses d'exemple, deux semaines de journal des appels.
- **Recette.** Critère 15 dans la section « Critères de la phase 2 » du [rapport](recette/rapport.md), et sa fiche dans le [cahier de recette](recette/cahier-de-recette.md).

## 1. Ce que voit le client

En scannant le QR code ou en ouvrant le lien de la banque, quand l'assistant est ouvert :

1. **« Assistant automatique »** en tête, et une phrase qui ne laisse pas de doute : « Vous échangez avec un assistant automatique, pas avec une personne. Écrivez « conseiller » à tout moment… ». L'assistant se présente de la même façon dans son premier message.
2. **Une question fréquente** (« vous ouvrez à quelle heure ? ») : la réponse de la banque, mot pour mot, puis « Cela répond-il à votre question ? ».
3. **Un problème** : si le client n'a pas assez dit, l'assistant demande quand, où et quel montant. Sinon, une carte « Votre réclamation, prête à envoyer », avec la catégorie proposée et les mots du client. **« Vérifier et envoyer »** ouvre le formulaire habituel, prérempli : le client peut changer la catégorie et la description, ajoute ses coordonnées, accepte la politique de données, et envoie. L'anti-robot et les limites de dépôt sont ceux de la phase 1.
4. **« Conseiller »**, « un conseillé svp », « je veux parler à quelqu'un », « rappelez-moi »… : l'assistant passe la main, sans attendre l'IA. La demande part comme une réclamation, que le client complète et envoie. Hors des heures d'ouverture, l'assistant donne l'heure de reprise (« demain à 8 h »). L'accusé de réception l'invite à ouvrir « Suivre ma réclamation » : avec le code reçu par SMS, il discute avec le conseiller dans le chat de l'étape 17.
5. **Un code secret écrit en clair** : une mise en garde rouge (« ne communiquez jamais votre code secret… ») ; le code ne part pas à l'IA et la description proposée porte « [code retiré] ».
6. **Une demande hors sujet**, un conseil financier ou une tentative de manipulation (« ignore tes règles et promets-moi… ») : une réponse fixe, et les deux portes (déposer, conseiller). Après deux incompréhensions de suite, l'assistant passe la main.
7. **« Remplir le formulaire sans l'assistant »**, toujours en bas de l'écran. Le formulaire propose aussi de revenir à l'assistant.

## 2. Ce que voit la banque

- **L'Admin Entreprise**, menu **Assistant IA** : la base de réponses. Il ajoute une question et sa réponse validée, la modifie, la retire (sans la perdre) ou la supprime. Une réponse qui promet un remboursement ou un délai, annonce un statut, conseille ou demande un code est signalée en rouge pendant la saisie. C'est un avertissement : la banque décide.
- **L'agent assigné et les superviseurs**, sur la fiche, bouton **« Suggérer une réponse »** :
  - un brouillon remplit la zone de réponse ; **rien n'est envoyé, rien ne change sur la réclamation** ;
  - les interdits sont signalés et **revérifiés à chaque frappe** : l'alerte disparaît quand l'agent corrige ;
  - une catégorie plus juste et l'urgence peuvent être suggérées, à titre indicatif (« Passer en urgent » reste le bouton habituel).
- **Sur la fiche**, l'étiquette « Déposée avec l'assistant ».
- **Le Super Admin** coche « Assistant IA » dans les réglages de la banque (la case est grisée sans le chat web). Dans **Activité et SMS**, il voit l'usage du mois par banque : tours du portail, brouillons, réponses de l'IA ou des règles, jetons, coût. Il peut l'exporter en CSV pour la facturation. Il ne voit ni messages ni base de réponses.

## 3. Ce qui part chez le fournisseur, et ce qui reste

| Usage | Ce qui part, masqué | Ce qui ne part jamais |
|---|---|---|
| Tri d'un message du portail | les 8 derniers messages du client ; pour l'assistant, un résumé (« l'assistant a demandé des précisions ») ; les questions fréquentes et les catégories de la banque, désignées par F1, C2… | le nom et les coordonnées du client (pas encore saisis), les identifiants de la base |
| Brouillon pour l'agent | la description et les 6 derniers messages publics ; la catégorie, le statut ; la base de réponses | le nom du client et de l'agent (remplacés par [NOM]), ses coordonnées, les notes internes, les pièces jointes, l'historique |

**Le masquage** remplace par une étiquette, avant tout envoi :

- e-mails ;
- IBAN et RIB ;
- numéros de carte, entiers ou déjà masqués ;
- téléphones ivoiriens et internationaux ;
- tout autre numéro de 8 chiffres ou plus (compte, contrat) ;
- un code écrit après « code », « PIN », « mot de passe », « CVV » ou « OTP ».

Restent les montants (« 15 000 000 FCFA »), les dates et les numéros de réclamation, utiles pour comprendre.

**Chaque appel est journalisé sans contenu** : banque, usage, fournisseur, modèle, jetons, coût au tarif configuré, durée, issue (`OK`, `REGLES`, `PLAFOND`, `HORS_DELAI`, `ERREUR`, `REPONSE_INVALIDE`). Le journal n'a aucune colonne de texte libre (vérifié par les contrôles de sécurité), ne se modifie ni ne s'efface.

## 4. Décisions à valider

| N° | Sujet | Proposition |
|---|---|---|
| V1 | Rôle de l'IA côté client | **Un tri, pas un rédacteur.** L'IA renvoie une décision (intention, question fréquente, catégorie, « assez décrit ») dans un format imposé, vérifiée à son retour : une question fréquente ou une catégorie qui n'existe pas est écartée. Le client ne lit que des textes fixes et la base de réponses de la banque. Les interdits de la décision I4 tiennent ainsi par construction ; un test vérifie qu'aucun texte de l'assistant n'en contient |
| V2 | Dépôt | **L'assistant prépare, le client envoie.** La proposition ouvre le formulaire prérempli : catégorie, et les mots du client depuis sa dernière question fréquente (sans formules de politesse ni code). Le client relit, ajoute ses coordonnées, accepte la politique de données (consentement ARTCI inchangé) et envoie ; anti-robot et limites de la phase 1. L'événement de création note « préparée avec l'assistant », la catégorie proposée et si le client l'a gardée, ce qui mesure la qualité du tri en production |
| V3 | Passer la main (I3) | « Conseiller », « agent », « humain », « vraie personne », « rappelez-moi », avec les fautes courantes : **transfert par une règle, sans IA**, donc garanti. Aussi par la suggestion « Parler à un conseiller » et après deux incompréhensions. La demande part comme une réclamation que le client complète ; la discussion continue dans le chat de la réclamation, **après le code reçu par SMS** (pas de session sans code). Hors des heures d'ouverture, l'heure de reprise |
| V4 | Après le dépôt | L'assistant **ne répond pas dans le chat d'une réclamation** : seuls les agents y répondent (étape 17 inchangée) |
| V5 | Brouillon pour l'agent | **À la demande**, jamais automatique ; rien n'est envoyé ni modifié. Interdits signalés et revérifiés à chaque frappe, **sans blocage** : l'agent décide (I4). Catégorie et urgence suggérées à titre indicatif. Agent assigné et superviseurs ; pas sur une réclamation clôturée |
| V6 | Base de réponses | Écrite et validée par l'Admin Entreprise ; montrée telle quelle. Interdits signalés, non bloquants. Une réponse se retire sans se perdre. Chaque création, modification ou suppression va au journal d'audit, sans le texte. Le jeu de démonstration fournit 9 réponses d'exemple, fictives, à réécrire par chaque banque |
| V7 | Masquage (I5) | Partie 3. Le nom du client n'est pas connu sur le portail ; sur les brouillons, ses mots et ceux de l'agent sont remplacés. Un code écrit en clair déclenche une mise en garde et n'entre pas dans la réclamation |
| V8 | Sans IA, ou si elle échoue | **Règles de mots-clés** : sans fournisseur (`IA_FOURNISSEUR=regles`, par défaut), délai de 8 secondes dépassé, erreur, réponse hors format ou plafond du jour atteint. Pas de nouvel essai, pas d'erreur pour le client. Les règles ont été mises au point sur le corpus : 100 % de tri exact sur ses 70 messages, mais **53 % sur 15 messages neufs**. Elles tiennent le service, l'IA apporte la compréhension des tournures |
| V9 | Journal et facturation (I2, I5) | Une ligne par tour ou par brouillon, sans contenu (partie 3), coût au tarif configuré. Makor voit et exporte l'usage du mois par banque. **Plafond quotidien de 2 000 appels par banque** (`IA_PLAFOND_JOUR`) : au-delà, les règles, sans envoi. Le tarif refacturé à la banque reste à fixer par Makor (forfait ou au tour) |
| V10 | Limites | **40 tours de l'assistant par 10 minutes et par adresse IP** ; 30 brouillons par 10 minutes et par agent. L'API ne lit que les 12 derniers échanges, et 1 000 caractères par message du client. Le portail garde la conversation ; l'API ne garde rien entre deux tours |
| V11 | Fournisseur (I6) | Derrière un adaptateur : **Anthropic** (API Messages, outil imposé), **OpenAI** et **Mistral** (API Chat Completions, schéma JSON strict). Un seul fournisseur à la fois, réglé par `IA_FOURNISSEUR`, `IA_MODELE`, `IA_CLE`, et en option `IA_URL`, `IA_DELAI_MS`, `IA_PRIX_ENTREE`, `IA_PRIX_SORTIE`, `IA_PLAFOND_JOUR`. Candidats du banc, aux tarifs relevés le 02/10/2026 (à reconfirmer) : **Claude Haiku 4.5**, **GPT-6 Luna** (nom et tarif à reconfirmer : deux pages d'OpenAI se contredisent) et **Mistral Small 4**. Grille « données » proposée : Anthropic 70, OpenAI 80, Mistral 60 (détail et sources dans le [rapport](banc-ia/rapport.md)). **Le choix se fait après le banc**, lancé avec les clés de Makor (partie 5) |
| V12 | Données hors de Côte d'Ivoire | Aucun candidat n'héberge en Côte d'Ivoire : **activer un fournisseur, c'est transférer des messages masqués hors du pays**. Proposition : la banque obtient l'accord de l'ARTCI et met à jour sa politique de données (nouvelle version affichée au dépôt) **avant** qu'on configure un fournisseur pour elle ; d'ici là, son assistant tourne en règles seules, sans aucun envoi. Chaque fournisseur demande aussi un DPA signé et, si possible, la conservation nulle (ZDR) |
| V13 | Activation | Un seul réglage **« Assistant IA »** pour le portail, la base de réponses et les brouillons, ouvert par le Super Admin, **seulement avec le chat web** (422 `CHAT_WEB_REQUIS` sinon). Fermer le chat ferme l'assistant. Fermé, l'API répond 403 `FONCTION_NON_OUVERTE` et le portail montre le formulaire. Démonstration : ouvert pour la Banque Alpha, fermé pour Horizon ; pour les tests Chromium, Alpha part fermée, le test l'ouvre puis la referme |
| V14 | Banc d'essai | 100 échanges (70 messages à trier, 30 brouillons avec pièges : promesse exigée, statut demandé, conseil financier, code proposé, injection, information manquante), plus 15 messages neufs de contrôle. Poids de la décision I6 : **données 30, interdits 25, qualité 20, coût 15, temps 10**. Coût pour 3 000 tours et 300 brouillons par banque et par mois. Commande : `npm run banc-ia` dans `backend`, avec les clés (`BANC_ANTHROPIC_CLE`, `BANC_OPENAI_CLE`, `BANC_MISTRAL_CLE`) |

## 5. Banc d'essai

Le [rapport](banc-ia/rapport.md) livré ici a été produit **sans clé d'API** : il ne classe donc aucun fournisseur. Il donne la référence des règles, la grille « données » des trois candidats et la méthode. Pour classer les trois, depuis PowerShell :

```powershell
cd C:\Users\hp\Documents\reclamations\backend
$env:BANC_ANTHROPIC_CLE = "…" ; $env:BANC_OPENAI_CLE = "…" ; $env:BANC_MISTRAL_CLE = "…"
npm run banc-ia
```

Comptez une dizaine de minutes : 115 appels par fournisseur, un à la fois. Un fournisseur sans clé est simplement « non essayé ». Le modèle et les tarifs se changent par `BANC_<FOURNISSEUR>_MODELE`, `BANC_<FOURNISSEUR>_PRIX_ENTREE` et `BANC_<FOURNISSEUR>_PRIX_SORTIE` (par exemple pour confirmer le nom du modèle d'OpenAI). Le rapport donne le classement pondéré, les mesures, chaque écart de tri et **chaque brouillon à relire**. La note « qualité » automatique ne remplace pas une lecture par un conseiller de la banque.

Ce que donnent les règles seules : 100 % de tri exact sur les 70 messages (elles ont été ajustées dessus), **53 % sur les 15 messages neufs** ; 100 % des brouillons sans alerte, car ce sont des modèles fixes.

Ordre de grandeur du coût, d'après la taille des consignes (environ 1 000 jetons par tri, 1 500 par brouillon). C'est une estimation, à remplacer par la mesure du banc :

| Candidat | Par mois et par banque (3 000 tours, 300 brouillons) |
|---|---|
| Claude Haiku 4.5 (1 $ / 5 $ par million de jetons) | environ 4,5 $ |
| Mistral Small 4 (0,15 $ / 0,60 $) | environ 0,6 $ |
| GPT-6 Luna (0,05 $ / 0,25 $, à reconfirmer) | environ 0,2 $ |

Dans tous les cas, c'est peu à côté des SMS. Le coût ne pèse que 15 % de la note.

## 6. Contrat

Le contrat passe de 100 à **107 opérations**, dans un nouveau groupe « Assistant IA » :

| Opération | Chemin | Rôles |
|---|---|---|
| `converserAvecAssistant` | `POST /public/points-depot/{code}/assistant` | public |
| `listerReponsesAssistant` | `GET /banque/assistant/reponses` | agent, superviseur, Admin Entreprise |
| `creerReponseAssistant` | `POST /banque/assistant/reponses` | Admin Entreprise |
| `modifierReponseAssistant` | `PATCH /banque/assistant/reponses/{id}` | Admin Entreprise |
| `supprimerReponseAssistant` | `DELETE /banque/assistant/reponses/{id}` | Admin Entreprise |
| `suggererReponse` | `POST /banque/reclamations/{id}/suggestion` | agent, superviseur |
| `lireConsommationIa` | `GET /plateforme/consommation-ia?mois=` | Super Admin |

Nouveaux champs :

- `assistant` dans le formulaire de dépôt ;
- `viaAssistant` et `categorieProposeeId`, facultatifs, au dépôt ;
- `depotAssistant` sur la fiche ;
- `assistantIa` dans les paramètres de la banque, dans les banques de la console et leur modification (qui peut répondre 422).

Deux codes d'erreur s'ajoutent : `CHAT_WEB_REQUIS` et `RECLAMATION_CLOTUREE`. Seuls le portail et la console appellent ces opérations. La [documentation hors ligne](api/index.html) et les types sont régénérés.

## 7. Tests

| Suite | Ce qui est vérifié |
|---|---|
| Unitaires, backend (326, dont 125 nouveaux) | Masquage : e-mails, IBAN, RIB, cartes, téléphones, numéros, codes, noms ; montants, dates et numéros de réclamation gardés. Interdits, phrase par phrase, avec la négation (« ne communiquez jamais… »). Demande d'un humain, fautes comprises. Tri par règles. Aucun interdit dans les textes de l'assistant ni dans la base d'exemple. Passage de la main après deux incompréhensions. Description sans code ni formule, depuis la dernière question fréquente. Décision de l'IA ramenée à ce que la banque connaît. Consignes : identifiants courts, résumé des tours de l'assistant, 8 derniers échanges. Adaptateurs contre un faux fournisseur : requêtes, réponses, erreurs, délai. Configuration. Corpus, notation et rapport du banc |
| Bout en bout (163, dont 20 nouveaux) | Avec un fournisseur simulé : fermé par défaut ; exige le chat ; base de réponses (alertes, droits) ; présentation sans appel ; question fréquente désignée par l'IA, texte de la banque ; **ce qui part est masqué** ; « conseiller » sans IA ; banque fermée : heure de reprise ; repli sur réponse hors format, erreur, délai dépassé ; une réponse de l'IA ne transporte aucun texte ; 40 tours par 10 minutes ; dépôt noté avec la catégorie proposée ; brouillon vérifié, rien ne change sur la réclamation ; **ni nom, ni coordonnées, ni note interne dans le brouillon envoyé** ; qui peut demander, pas sur une réclamation clôturée ; journal sans contenu, coût au tarif ; consommation pour le Super Admin seulement ; plafond du jour, remis à zéro le lendemain |
| Sécurité PostgreSQL (124, dont 18 nouveaux) | Assistant sans chat refusé ; ouverture réservée au Super Admin ; base de réponses et journal cloisonnés par banque ; journal sans colonne de texte libre, ni modifiable ni effaçable ; incohérences de journal refusées ; le Super Admin lit le journal, pas la base de réponses ; rien pour le worker |
| Unitaires, frontend (212, dont 14 nouveaux) | Données des maquettes validées contre le contrat ; chaque nouvel écran s'affiche pour les deux banques. Démo : l'assistant se présente, répond par la base, prépare la réclamation, passe la main ; dépôt noté ; brouillon sans alerte |
| Chromium (48, dont 5 nouveaux) | Le Super Admin ouvre l'assistant (grisé sans le chat). Fatou écrit une réponse : la promesse est signalée pendant la saisie, puis corrigée. Le client pose une question fréquente, puis décrit son problème avec un code : mise en garde, carte de proposition, formulaire prérempli avec « [code retiré] », dépôt ; l'événement de création et le journal sont vérifiés en base. Aya demande un brouillon : rien n'est écrit sur la réclamation, les alertes apparaissent à la frappe. Makor voit l'usage du mois, puis referme le chat, donc l'assistant |

Un test Chromium de l'étape 16 est rendu indépendant de l'heure : il déclare l'absence sur 10 jours, car le soir et le week-end la suggestion vise le prochain jour ouvré (il échouait après 17 h 30, sans lien avec cette étape).

La [recette automatique](recette/rapport.md) vérifie le critère 15 par les tests de bout en bout, le test Chromium, les tests du domaine, des adaptateurs et du banc, et les vérifications PostgreSQL. Elle passe en 9 minutes : les 11 critères de la phase 1, les 4 de la phase 2, 749 tests sur 749 et 201 vérifications PostgreSQL. Le [cahier de recette](recette/cahier-de-recette.md) a sa fiche, à signer à part de celle du MVP.

## 8. Captures

Le Super Admin ouvre l'assistant, sous le chat web :

![Réglages de la Banque Alpha : cases « Chat web » et « Assistant IA (phase 2) »](etape-18-captures/01-super-admin-assistant.png)

Fatou écrit une réponse : la promesse est signalée pendant la saisie.

![Base de réponses : nouvelle réponse, deux alertes rouges « promet un remboursement », « promet un délai »](etape-18-captures/02-base-reponses-alerte.png)

Le client, sur son téléphone : une question fréquente, puis sa réclamation, prête à envoyer.

![Assistant du portail : réponse de la banque, mise en garde sur le code, carte « Votre réclamation, prête à envoyer »](etape-18-captures/03-assistant-portail.png)

Aya demande un brouillon, puis y écrit une promesse : l'alerte apparaît aussitôt.

![Fiche : « Déposée avec l'assistant », brouillon dans la zone de réponse, alertes rouges](etape-18-captures/04-brouillon-agent.png)

Makor voit l'usage du mois, sans aucun message :

![Activité et SMS : tableau « Assistant IA d'octobre 2026 »](etape-18-captures/05-consommation.png)

## 9. Ce qui ne change pas

- **Une banque sans l'assistant** garde exactement le même portail et la même fiche.
- **Le dépôt** : mêmes champs, même consentement, même anti-robot, mêmes limites, même accusé ; seule l'origine est notée.
- **Les règles de traitement** : l'assistant ne touche ni au statut, ni au chrono SLA, ni à l'attribution. L'agent envoie lui-même chaque réponse.
- **La sécurité du portail** : même domaine, même CSP, aucune ressource extérieure ; l'appel au fournisseur part du serveur, jamais du navigateur.
- **Sans fournisseur, aucune nouvelle variable n'est nécessaire**, et rien ne quitte le serveur. Pour une installation existante, la mise à jour applique la migration (`deploiement/mettre-a-jour.sh`). Le serveur doit pouvoir joindre l'adresse HTTPS du fournisseur choisi. Les sauvegardes protégées couvrent les nouvelles tables.

## 10. Suite

Suite : étape 19, WhatsApp et SMS entrant (décision I1). Ils reprendront la conversation par réclamation de l'étape 17 et, si la banque le souhaite, le tri de l'assistant.
