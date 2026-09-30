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

## 3. Contrôles d'exploitation (hors section 10, avant la mise en production)

| Contrôle | Commande | Attendu | Résultat |
|---|---|---|---|
| Déploiement de production vérifié | `./deploiement/verifier.sh --portail <slug> --local` sur le VPS | aucun échec | ☐ |
| Sauvegarde de la nuit copiée hors du VPS | `docker compose … run --rm restauration restaurer liste` | archive du jour, locale et distante | ☐ |
| Restauration d'essai | `docker compose … run --rm restauration restaurer derniere` (clé privée saisie) | « Sauvegarde vérifiée » : journal intact, fichiers complets | ☐ |
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

| | Nom | Date | Signature |
|---|---|---|---|
| Pour Makor Telecoms | | | |
| Pour la banque pilote (facultatif) | | | |
