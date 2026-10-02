# Cahier de recette du MVP

Plateforme de gestion des réclamations — Makor Telecoms, solution 1. Version 1.0.0.

Le MVP est accepté quand chacun des 11 critères de la section 10 du cahier des charges est vérifié **sur l'environnement de démonstration, avec deux banques de test** (Banque Alpha et Banque Horizon). Ce cahier donne, critère par critère, les gestes à faire et le résultat attendu. La partie automatique (plus de 400 tests relancés d'une commande) est dans le [rapport de recette automatique](rapport.md) : chaque fiche y renvoie.

Une fiche se note **OK**, **KO** (le résultat attendu n'est pas obtenu : la recette est suspendue sur ce critère) ou **Réserve** (obtenu avec un écart mineur, à corriger sans bloquer). Le procès-verbal en fin de cahier reprend les onze résultats.

## 1. Préparation

**Environnement.** Démonstration déployée (docs/exploitation.md, partie 6), remise à zéro le matin même :

```bash
./deploiement/reinitialiser-demo.sh
./deploiement/verifier.sh --env .env.demo --portail alpha --local     # tout doit être « ok »
```

Dans ce cahier, `<demo>` désigne le domaine de la démonstration (ex. `demo.reclamations.ci`) :

| Écran | Adresse |
|---|---|
| Console du personnel (banques et plateforme) | `https://console.<demo>` |
| Portail de la Banque Alpha, dépôt par QR code | `https://alpha.<demo>/d/7K3QX9P2MA` |
| Portail de la Banque Horizon, dépôt par QR code | `https://horizon.<demo>/d/H7P4XK2RQD` |

**Comptes.** Tous ont le mot de passe `DEMO_MOT_DE_PASSE` du fichier `.env.demo`. La double authentification se prépare une fois par téléphone : pour chaque compte utilisé, sur le serveur,

```bash
docker compose -f docker-compose.prod.yml -f docker-compose.demo.yml --env-file .env.demo exec api node dist/scripts/totp.js <e-mail>
```

affiche le code du moment et l'adresse `otpauth://` à ouvrir (ou à transformer en QR code) dans l'application d'authentification. Les secrets restent les mêmes d'une remise à zéro à l'autre.

| Rôle | Banque Alpha | Banque Horizon |
|---|---|---|
| Admin Entreprise | fatou.diabate@banque-alpha.example | awa.bamba@banque-horizon.example |
| Superviseurs | serge.kouadio@ · mariam.ouattara@banque-alpha.example | didier.yao@banque-horizon.example |
| Agents | aya.konan@ · mamadou.traore@ · ibrahim.coulibaly@banque-alpha.example | salif.kone@banque-horizon.example |
| Super Admin (plateforme) | koffi.admin@makortelecoms.example | |

Les e-mails du personnel fictif (`.example`) ne sont pas délivrés : les alertes se lisent dans la cloche de la console. Pour le client, utiliser **votre propre adresse e-mail et votre numéro** : l'accusé vous parvient réellement.

**SMS.** Si la passerelle SMS de Makor Telecoms n'est pas branchée (`SMS_MODE=journal`), chaque SMS est écrit dans le journal du worker au lieu d'être envoyé :

```bash
docker compose -f docker-compose.prod.yml -f docker-compose.demo.yml --env-file .env.demo logs worker | grep SMS
```

**Horaires.** Les deux banques de démonstration sont ouvertes du lundi au vendredi, de 8 h à 12 h et de 14 h à 17 h 30 (heure d'Abidjan). Les critères 5 et 6 se passent pendant ces heures.

**Requêtes SQL (critères 4 et 9).** Elles se font sur le serveur de démonstration :

```bash
docker compose -f docker-compose.prod.yml -f docker-compose.demo.yml --env-file .env.demo exec postgres psql -U reclamations -d reclamations
```

## 2. Fiches de recette

### Critère 1 — Dépôt par QR code traité puis clôturé de bout en bout

*Une réclamation déposée par QR code est traitée puis clôturée de bout en bout, avec numéro, accusé de réception par e-mail et par SMS.*

1. Sur un téléphone, ouvrir le portail Alpha par son QR code (`https://alpha.<demo>/d/7K3QX9P2MA`). Le formulaire est aux couleurs de la banque, l'agence « Plateau » déjà connue.
2. Choisir « Carte bancaire », décrire le problème, joindre une photo, donner votre nom, votre téléphone et votre e-mail, accepter la politique de données, envoyer.
3. **Attendu :** un numéro `ALP-2026-NNNNNN` s'affiche ; l'accusé arrive par e-mail (avec le numéro et le lien de suivi) et par SMS (ou dans le journal du worker).
4. Console, Serge (superviseur) : **Réclamations › Reçues**, ouvrir la réclamation, l'**assigner** à Aya.
5. Console, Aya (agente) : **Prendre en charge**, **Répondre au client** (« Réponse finale au client »), puis **Résoudre**.
6. Téléphone : ouvrir le lien de suivi reçu, confirmer la résolution.
7. **Attendu :** la réclamation est **Clôturée** dans la console ; le client a reçu un e-mail à chaque étape prévue.

Preuve automatique : `parcours.e2e.test.ts` (8 tests), `navigateur/1-parcours.spec.ts` (5 tests).

Résultat : ☐ OK ☐ KO ☐ Réserve — Observations :

### Critère 2 — Le client voit l'étape exacte et horodatée

*Le client voit à tout moment l'étape exacte et horodatée de sa réclamation.*

1. Pendant le critère 1, après chaque action du personnel, recharger le lien de suivi sur le téléphone.
2. **Attendu :** le statut affiché est celui de la console (Ouverte, En cours, En attente client, Résolue, Clôturée), chaque étape avec sa date et son heure ; ni note interne, ni description, ni coordonnées ne s'affichent par le lien (il peut circuler).
3. Depuis le portail, **Mes réclamations** : se connecter avec le code reçu par SMS ou e-mail. **Attendu :** la chronologie complète et les réponses de la banque, sans les notes internes.

Preuve automatique : `parcours.e2e.test.ts`, `navigateur/1-parcours.spec.ts`, `navigateur/5-portail.spec.ts`.

Résultat : ☐ OK ☐ KO ☐ Réserve — Observations :

### Critère 3 — Réclamation urgente : alerte immédiate à quatre destinataires

*Une réclamation urgente alerte immédiatement l'agent, le superviseur, l'Admin Entreprise et le Super Admin ; l'alerte du Super Admin ne contient ni nom ni description.*

1. Garder ouvertes quatre sessions de la console : Serge, Fatou (Admin Entreprise Alpha), Koffi (Super Admin) et Aya.
2. Déposer sur le portail Alpha une réclamation « Fraude suspectée » (catégorie urgente).
3. **Attendu, dans la minute :** Serge, Mariam et Fatou reçoivent l'alerte « réclamation urgente » (cloche) ; Koffi aussi, avec seulement la banque, le numéro, la catégorie et l'heure : **ni nom du client, ni description**.
4. Serge assigne la réclamation à Aya. **Attendu :** Aya reçoit aussitôt l'alerte urgente.
5. Variante : sur une réclamation normale, Serge change la priorité en « Urgente ». **Attendu :** les mêmes alertes partent aussitôt.

Preuve automatique : `back-office.e2e.test.ts` (2 tests), vérifications PostgreSQL du cycle de vie (contenu de l'alerte plateforme).

Résultat : ☐ OK ☐ KO ☐ Réserve — Observations :

### Critère 4 — Cloisonnement entre banques

*Un agent de la banque A qui demande un ticket de la banque B reçoit 404 ; la même lecture, faite directement en SQL, ne renvoie rien.*

1. Console, Didier (superviseur Horizon) : ouvrir une réclamation d'Horizon, copier son adresse (`https://console.<demo>/reclamations/<identifiant>`).
2. Console, Aya (agente Alpha) : coller cette adresse. **Attendu :** le message « introuvable » (réponse 404 de l'API, visible dans l'onglet Réseau des outils du navigateur), exactement comme pour un identifiant qui n'existe pas : rien ne révèle que la réclamation existe ailleurs.
3. Même essai avec Serge (superviseur Alpha) et Fatou (Admin Alpha). **Attendu :** introuvable.
4. En SQL, avec le rôle de l'application restreint à la Banque Alpha (remplacer `<id Horizon>` par l'identifiant copié) :

```sql
BEGIN;
SET LOCAL ROLE acces_banque;
SELECT set_config('app.tenant_id', (SELECT id::text FROM banque WHERE slug = 'alpha'), true);
SELECT count(*) FROM reclamation WHERE id = '<id Horizon>';   -- attendu : 0
SELECT count(*) FROM reclamation;                               -- seulement celles d'Alpha
ROLLBACK;
```

Remarque : `SELECT … FROM banque` s'exécute avant `SET LOCAL ROLE` dans la même transaction ; sinon, noter l'identifiant d'Alpha d'abord.

Preuve automatique : `securite.e2e.test.ts` (4 tests), vérifications de sécurité PostgreSQL (RLS, rôles, droits par colonne).

Résultat : ☐ OK ☐ KO ☐ Réserve — Observations :

### Critère 5 — SLA en heures ouvrées, jours fériés, suspension

*Le délai SLA exclut les heures non ouvrées et les jours fériés, et se suspend en « En attente client ».*

1. Déposer une réclamation « Carte bancaire » (délai : 16 h ouvrées). Ouvrir sa fiche dans la console : noter l'**échéance**.
2. **Attendu :** l'échéance ne compte que les heures d'ouverture, 7 h 30 par jour ouvré (calculs faits avec le moteur de la plateforme, horaires des banques de démonstration) :

| Dépôt | Échéance attendue | Détail |
|---|---|---|
| jeudi 16 h 00 | lundi 17 h 00 | 1 h 30 jeudi, 7 h 30 vendredi, 7 h 00 lundi |
| lundi 10 h 00 | mercredi 11 h 00 | 5 h 30 lundi, 7 h 30 mardi, 3 h 00 mercredi |
| vendredi 18 h 00, banque fermée | mercredi 9 h 00 | rien le week-end ; 7 h 30 lundi, 7 h 30 mardi, 1 h 00 mercredi |
| samedi 11 h 00 | mercredi 9 h 00 | comme ci-dessus |
| jeudi 16 h 00, **vendredi férié** | **mardi 17 h 00** | le vendredi ne compte plus |

3. Fatou, **Paramétrage › Horaires** : ajouter un jour férié le prochain jour ouvré, puis déposer une nouvelle réclamation « Carte bancaire ». **Attendu :** son échéance tombe un jour ouvré plus tard que celle d'une réclamation déposée juste avant l'ajout. Retirer ensuite le jour férié.
4. Aya, sur une réclamation prise en charge : **Répondre au client** en choisissant « Précision » (question au client). **Attendu :** statut « En attente client », le délai affiché est **suspendu**. Le client répond par son lien 30 minutes (ouvrées) plus tard. **Attendu :** statut « En cours », échéance repoussée de 30 minutes.

Preuve automatique : `worker.e2e.test.ts`, `parcours.e2e.test.ts` (chrono en pause), 32 tests unitaires du calendrier ouvré et du SLA.

Résultat : ☐ OK ☐ KO ☐ Réserve — Observations :

### Critère 6 — Alerte à 75 %, escalade au dépassement, une seule fois

*L'alerte préventive part à 75 % du délai, l'escalade au dépassement, chacune une seule fois.*

1. Fatou, **Paramétrage › Catégories** : créer « Recette SLA », délai **0 h 08**, priorité normale.
2. Pendant les heures d'ouverture, loin d'une fermeture (entre 8 h et 11 h 45, ou entre 14 h et 17 h 15), déposer une réclamation « Recette SLA ». Serge l'assigne aussitôt à Aya.
3. **Attendu, 6 minutes après le dépôt (75 %) :** Aya reçoit l'alerte préventive (cloche et e-mail), une seule ; la fiche passe en « alerte ».
4. **Attendu, 8 minutes après le dépôt :** la réclamation est en retard (file « En retard ») et **escaladée vers Serge Kouadio** ; Aya et Serge reçoivent l'alerte de dépassement, une seule chacun. La chronologie montre, dans l'ordre : alerte préventive, dépassement, escalade.
5. Attendre 5 minutes de plus. **Attendu :** aucune nouvelle alerte pour cette réclamation.
6. Retirer la catégorie « Recette SLA » du formulaire (ou la laisser : la remise à zéro de la nuit l'efface).

Preuve automatique : `worker.e2e.test.ts` (horloge simulée).

Résultat : ☐ OK ☐ KO ☐ Réserve — Observations :

### Critère 7 — Clôture automatique après 5 jours ; contestation

*Une résolution non contestée est clôturée automatiquement après 5 jours ; une contestation rouvre le ticket.*

1. Aya résout une réclamation R1 sans que le client réponde. **Attendu :** sa fiche indique la clôture automatique prévue **5 jours** après la résolution ; le client a reçu le lien pour confirmer ou contester.
2. Aya résout une réclamation R2. Le client ouvre son lien et **conteste** en expliquant pourquoi. **Attendu :** R2 revient « En cours » chez Aya, la contestation est comptée comme une réouverture.
3. Vérification complète de la clôture (facultative, sur deux jours) : Koffi, **Plateforme › Banques** : délai de clôture d'Alpha à **1 jour** ; **suspendre la remise à zéro de la nuit** (`sudo rm /etc/cron.d/reclamations-demo`) ; résoudre R3. **Attendu le lendemain :** R3 « Clôturée » automatiquement. Remettre ensuite 5 jours et la remise à zéro (`sudo ./deploiement/reinitialiser-demo.sh --installer-cron`).

Preuve automatique : `worker.e2e.test.ts` (5 jours simulés, contestation refusée après le délai), `back-office.e2e.test.ts`, `navigateur/5-portail.spec.ts`.

Résultat : ☐ OK ☐ KO ☐ Réserve — Observations :

### Critère 8 — Taux de résolution au premier contact (§6.6)

*Le taux de résolution au premier contact correspond à la définition de la section 6.6 : résolue sans attente du client, sans escalade, sans réouverture.*

1. Fatou crée la catégorie « Recette premier contact ». Déposer cinq réclamations dans cette catégorie et les traiter ainsi :
   - A : prise en charge puis résolue directement ;
   - B : une question au client (« Précision »), réponse du client, puis résolue ;
   - C : escaladée par l'agent, puis résolue ;
   - D : résolue, contestée par le client, puis résolue à nouveau ;
   - E : laissée ouverte.
2. Serge, **Tableau de bord** : période « Ce mois-ci », catégorie « Recette premier contact ».
3. **Attendu :** 5 déposées, 4 résolues, **premier contact 25 %** (seule A compte) ; le détail des délais correspond aux fiches.

Preuve automatique : `reporting.e2e.test.ts` (le même scénario), vérifications PostgreSQL du cycle de vie (drapeaux enregistrés à chaque transition).

Résultat : ☐ OK ☐ KO ☐ Réserve — Observations :

### Critère 9 — Journal d'audit complet, falsification détectée

*Le journal d'audit restitue toutes les actions d'une réclamation ; une ligne modifiée à la main est détectée par la vérification de la chaîne.*

1. Fatou, **Journal d'audit** : rechercher la réclamation du critère 1. **Attendu :** toutes ses actions, dans l'ordre, avec l'auteur, l'heure et l'adresse IP : dépôt, assignation, prise en charge, réponse, résolution, confirmation, clôture ; aucune donnée du client (ni nom, ni téléphone, ni description).
2. **Vérifier la chaîne.** **Attendu :** chaîne intacte, avec le nombre de lignes.
3. Sur le serveur, modifier une ligne à la main (un administrateur de base de données le pourrait) :

```sql
BEGIN;
SET LOCAL session_replication_role = replica;   -- contourne la protection en écriture seule
UPDATE journal_audit SET action = 'reclamation.effacee'
 WHERE id = (SELECT id FROM journal_audit WHERE chaine = 'banque:' || (SELECT id FROM banque WHERE slug = 'alpha')
             ORDER BY rang DESC LIMIT 1 OFFSET 3);
COMMIT;
```

4. Fatou, **Vérifier à nouveau**. **Attendu :** chaîne **rompue**, à la ligne modifiée. Koffi, **Plateforme › Journal** : la vérification de la chaîne d'Alpha signale la même rupture ; celle d'Horizon reste intacte.
5. Remettre la démonstration en état : `./deploiement/reinitialiser-demo.sh`.

Preuve automatique : `parametrage.e2e.test.ts`, `navigateur/1-parcours.spec.ts`, `navigateur/4-plateforme.spec.ts` ; l'essai de sauvegarde vérifie aussi qu'une archive au journal falsifié est refusée.

Résultat : ☐ OK ☐ KO ☐ Réserve — Observations :

### Critère 10 — Opérations courantes en moins d'une seconde

*Les opérations courantes répondent en moins d'une seconde.*

1. Serge, sur la Banque Alpha (plus de 160 réclamations, 60 jours d'historique) : parcourir les files, changer de page, trier par échéance, rechercher un client par son nom, ouvrir une fiche, assigner, ouvrir le tableau de bord, exporter.
2. **Attendu :** chaque écran répond sans attente perceptible ; dans les outils du navigateur (onglet Réseau), chaque appel `/api/v1/…` dure moins d'une seconde.

Preuve automatique : `performance.e2e.test.ts`, sur une banque de **1 000 réclamations** ; mesures p95 dans le [rapport](rapport.md) (toutes entre 25 et 150 ms).

Résultat : ☐ OK ☐ KO ☐ Réserve — Observations :

### Critère 11 — Export CSV des listes

*Les listes s'exportent en CSV.*

1. Serge, **Réclamations**, file « Toutes » filtrée (par exemple catégorie « Carte bancaire ») : **Exporter en CSV**.
2. Ouvrir le fichier dans Excel. **Attendu :** accents corrects, une colonne par champ, une ligne par réclamation, **autant de lignes que la liste filtrée** ; aucune donnée du client (ni nom, ni téléphone, ni description).
3. Serge, **Tableau de bord** : exporter. **Attendu :** les réclamations de la période et des filtres choisis.
4. Koffi, **Plateforme › Activité et SMS** : exporter la facturation SMS du mois. **Attendu :** une ligne par banque (SMS, segments, échecs) et le total.
5. Fatou, **Journal d'audit** : chaque export y figure, sans le texte recherché.

Preuve automatique : `reporting.e2e.test.ts` (3 tests), `navigateur/7-reporting.spec.ts` (2 tests).

Résultat : ☐ OK ☐ KO ☐ Réserve — Observations :

### Critère 12 (phase 2, étape 15) — Enquête de satisfaction

*À la clôture confirmée ou automatique, le message de clôture porte le lien d'une enquête, à laquelle le client répond une seule fois dans les 7 jours ; la banque en suit les résultats ; le Super Admin ne voit que des totaux par banque.*

Ce critère ne fait pas partie de la recette du MVP (section 10 du cahier des charges) : il se signe à part, à la livraison de la phase 2.

1. Koffi, **Plateforme › Banques**, Banque Alpha : **Enquête de satisfaction à la clôture** cochée. Horizon : décochée. **Attendu :** Fatou voit « Enquête de satisfaction : Oui, à la clôture » dans **Banque et apparence**, sans pouvoir le changer.
2. Aya résout une réclamation d'Alpha déposée avec un téléphone. Le client ouvre son lien, saisit son code et **confirme**. **Attendu :** le SMS de clôture dit « réclamation … close. Votre avis : … /avis », sans SMS de plus ; l'espace client affiche « Votre avis sur le traitement ».
3. Le client ouvre le lien, choisit 4 sur 5 et 9 sur 10, écrit un commentaire, envoie. **Attendu :** « Merci pour votre avis » ; au rechargement, la même réponse, sans formulaire.
4. Serge, fiche de la réclamation. **Attendu :** panneau « Avis du client », 4 / 5, 9 / 10, le commentaire. **Tableau de bord** : bloc « Satisfaction des clients » avec le commentaire en tête des derniers. Export CSV : les deux notes en fin de ligne, pas le commentaire.
5. Aya, **Tableau de bord** : le bloc, sur ses réclamations seulement, sans tableau par agent.
6. Serge clôture de force une autre réclamation (doublon). **Attendu :** pas de lien d'avis, pas d'enquête sur la fiche.
7. Koffi, **Plateforme › Activité et SMS** : tableau « Satisfaction des clients », une ligne pour Alpha, aucun commentaire.

Preuve automatique : `satisfaction.e2e.test.ts` (12 tests, dont la fin après 7 jours), `navigateur/8-satisfaction.spec.ts` (6 tests), vérifications de sécurité (13 contrôles : réponse figée, commentaire illisible pour la plateforme).

Résultat : ☐ OK ☐ KO ☐ Réserve — Observations :

### Critère 13 (phase 2, étape 16) — Attribution et escalade automatiques

*L'Admin Entreprise confie chaque catégorie et chaque agence à un groupe d'agents ; une nouvelle réclamation va à l'agent disponible le moins chargé, ou lui est proposée ; un agent absent ne reçoit rien ; au-delà d'un seuil, l'Admin Entreprise est prévenu.*

Comme le critère 12, il se signe à part, à la livraison de la phase 2. Les étapes 5 et 6 se passent pendant les heures d'ouverture de la banque (lundi–vendredi, 8 h–12 h et 14 h–17 h 30).

1. Koffi, **Plateforme › Banques**, Banque Alpha : **Attribution et escalade automatiques** cochée (jeu de démonstration). **Attendu :** Fatou voit « Attribution et escalade automatiques : Oui, mode suggestion » dans **Banque et apparence**, et les pages **Attribution et escalade** et **Absences**. Avec Horizon, décochée : ni l'une ni l'autre.
2. Fatou, **Attribution et escalade** : trois groupes (Monétique, Comptes et crédits, Agence de Bouaké) avec la charge de chaque agent. Elle crée le groupe « Litiges » avec Ibrahim, lui confie la catégorie « Crédit » avec un seuil de 200 %, enregistre. **Attendu :** la carte du groupe affiche « Reçoit : Crédit » ; le journal d'audit montre « Groupe d'agents créé » et « Règles d'attribution modifiées ».
3. Mode **Suggestion**. Un client dépose une réclamation « Carte bancaire » par le QR code. **Attendu :** Serge, file « Reçues » : l'agent proposé (Aya ou Mamadou, le moins chargé) et le bouton **Valider** ; sur la fiche, « Attribution suggérée … groupe Monétique ». Fatou ne voit pas de suggestion (elle n'assigne pas).
4. Serge, **Absences** : il déclare l'agent proposé absent aujourd'hui. **Attendu :** la fiche propose l'autre agent du groupe ; **Assigner à …** l'assigne, l'agent est prévenu. Serge retire l'absence.
5. Fatou passe en mode **Automatique**. Un client dépose une réclamation « Carte bancaire ». **Attendu :** elle est assignée dès le dépôt ; la chronologie montre « Attribution automatique », par le système ; l'agent reçoit la notification.
6. Serge déclare Aya et Mamadou absents aujourd'hui ; un client dépose une réclamation « Carte bancaire ». **Attendu :** elle reste dans « Reçues ». Serge retire l'absence d'Aya : dans la minute, le worker la lui attribue. (Hors des heures d'ouverture, la réclamation attend de même l'ouverture.)
7. Une réclamation « Banque mobile » (8 h ouvrées) n'est pas traitée. **Attendu :** alerte à 75 %, puis à l'échéance escalade au superviseur (inchangées) ; 4 h ouvrées plus tard (150 %), Fatou reçoit « … : retard important » et la fiche porte « Escaladée à l'Admin Entreprise ». Pour ne pas attendre : seuil de la catégorie à 101 %.
8. Koffi décoche la fonction pour Alpha. **Attendu :** retour à l'attribution manuelle, les deux pages disparaissent. Recochée : Fatou retrouve ses groupes, en mode manuel.

Preuve automatique : `attribution.e2e.test.ts` (20 tests, dont la nuit et l'ouverture du lendemain), `navigateur/9-attribution.spec.ts` (6 tests), vérifications de sécurité (17 contrôles : groupes et absences cloisonnés par banque, fonction ouverte par le seul Super Admin, seuils bornés).

Résultat : ☐ OK ☐ KO ☐ Réserve — Observations :

### Critère 14 (phase 2, étape 17) — Conversations et chat web

*Le client écrit à la banque dans un chat intégré au portail et voit les réponses arriver ; les agents répondent depuis une boîte de réception ; une conversation par réclamation, isolée par banque ; une réponse lue dans le chat n'envoie ni e-mail ni SMS.*

Comme les critères 12 et 13, il se signe à part, à la livraison de la phase 2. Ouvrez le portail sur un téléphone (ou une fenêtre étroite) et la console dans une autre fenêtre, côte à côte.

1. Koffi, **Plateforme › Banques**, Banque Alpha : **Chat web et boîte de réception** cochée (jeu de démonstration). **Attendu :** Fatou voit « Chat web : Oui, sur le portail » dans **Banque et apparence** ; Aya, Serge et Fatou ont le menu **Conversations**. Horizon, décochée : pas de menu, et l'espace client d'Horizon garde son fil « Échanges ».
2. Serge, **Conversations** : deux clients attendent une réponse (Yao Kouassi, carte ; Brice Tanoh, fraude), la plus longue attente en tête, avec l'agent qui les suit. Aya ne voit que celle de Yao Kouassi ; Mamadou, aucune.
3. Le client Yao Kouassi ouvre son lien de suivi, saisit son code. **Attendu :** la réclamation, puis « Discussion avec Banque Alpha », « Ouvert : un conseiller vous répond ici » ; la réponse d'Aya signée par la banque, jamais par Aya. Il écrit deux messages d'affilée (Entrée envoie). **Attendu :** chaque message s'affiche aussitôt, « Envoyé » sous le dernier ; Aya ne reçoit qu'une notification pour les deux.
4. Aya, **Conversations** : la ligne en gras, rond vert (client en ligne). Elle l'ouvre. **Attendu :** dans les 5 secondes, « Lu » sous le dernier message du client. Elle répond. **Attendu :** dans les 5 secondes, la réponse apparaît dans le chat du client, puis « Lu par le client » chez Aya ; aucun SMS « nouvelle réponse ».
5. Le client ferme son téléphone (ou quitte la page). Aya répond deux fois de suite. **Attendu :** environ 2 à 3 minutes après la seconde, un seul SMS « nouvelle réponse sur votre réclamation … » avec le lien, sans le texte.
6. Serge ouvre la conversation de Brice Tanoh, suivie par Ibrahim. **Attendu :** elle reste « non lue » pour Ibrahim. Fatou peut lire une conversation, pas y répondre.
7. Le soir ou le week-end (hors des heures d'ouverture), le client ouvre son chat. **Attendu :** « Fermé : réponse dès la réouverture, lundi … à 08:00 ».
8. Koffi décoche le chat pour Alpha. **Attendu :** le menu **Conversations** disparaît ; l'espace client affiche de nouveau le fil « Échanges », avec tous les messages.

Preuve automatique : `conversations.e2e.test.ts` (17 tests, dont les avis différés et la limite de 30 messages en 10 minutes), `navigateur/10-conversations.spec.ts` (5 tests), `domaine/conversation.test.ts` (11 tests), vérifications de sécurité (14 contrôles : conversations cloisonnées par banque, illisibles pour la plateforme, chat ouvert par le seul Super Admin).

Résultat : ☐ OK ☐ KO ☐ Réserve — Observations :

## 3. Contrôles d'exploitation (hors section 10, avant la mise en production)

| Contrôle | Commande | Attendu | Résultat |
|---|---|---|---|
| Déploiement de production vérifié | `./deploiement/verifier.sh --portail <slug> --local` sur le VPS | aucun échec | ☐ |
| Sauvegarde de la nuit copiée hors du VPS | `docker compose … run --rm restauration restaurer liste` | archive du jour, locale et distante | ☐ |
| Restauration d'essai | `docker compose … run --rm restauration restaurer derniere` (clé privée saisie) | « Sauvegarde vérifiée » : journal intact, fichiers complets | ☐ |
| Copies hors du VPS verrouillées (étape 12) | `docker compose … exec sauvegarde sauvegarder --controler` | « Verrouillage COMPLIANCE : copie verrouillée, effacement refusé » | ☐ |
| Alerte de supervision | arrêter le worker 5 minutes (`docker compose … stop worker`) | alerte reçue (santé « dégradée ») ; relancer : retour à « ok » | ☐ |

## 4. Procès-verbal de recette

| Critère | Résultat | Réserve éventuelle |
|---|---|---|
| 1. Dépôt par QR code traité puis clôturé | | |
| 2. Étape exacte et horodatée pour le client | | |
| 3. Alerte urgente à quatre destinataires | | |
| 4. Cloisonnement entre banques | | |
| 5. SLA en heures ouvrées, suspension | | |
| 6. Alerte à 75 %, escalade, une seule fois | | |
| 7. Clôture automatique, contestation | | |
| 8. Premier contact (§6.6) | | |
| 9. Journal d'audit, falsification détectée | | |
| 10. Moins d'une seconde | | |
| 11. Export CSV | | |

Décision : ☐ MVP accepté ☐ Accepté avec réserves ☐ Refusé

Phase 2, à signer à la livraison de chaque fonction :

| Critère | Résultat | Réserve éventuelle |
|---|---|---|
| 12. Enquête de satisfaction (étape 15) | | |
| 13. Attribution et escalade automatiques (étape 16) | | |
| 14. Conversations et chat web (étape 17) | | |

| | Nom | Date | Signature |
|---|---|---|---|
| Pour Makor Telecoms | | | |
| Pour la banque pilote (facultatif) | | | |
