# Étape 12 — Sauvegardes protégées contre l'effacement

Plateforme de gestion des réclamations · Makor Telecoms · Solution 1
Version du 30/09/2026 · **Statut : à valider** (décisions V1 à V8).

Deuxième des trois étapes de la préparation de la mise en production (voir l'[étape 11](etape-11-anti-robot-qr-code.md)).

**Le problème.** Depuis l'étape 10, les sauvegardes sont chiffrées et copiées chaque nuit hors du VPS, dans Contabo Object Storage. Pour les y déposer, le VPS a les clés du compartiment. Un intrus qui prend le VPS, par exemple pour tout chiffrer contre rançon, avait donc aussi de quoi **effacer toutes les copies**. Il ne pouvait pas les lire, puisqu'elles sont chiffrées, mais il pouvait les détruire.

**La réponse.** Contabo Object Storage prend en charge le verrouillage des objets S3 (*Object Lock*) : sa [documentation](https://contabo.com/blog/de/kb/103000282887-wie-verwende-ich-die-objektsperre-fuer-dateien-in-meinem-objektspeicher/) explique comment l'activer à la création d'un compartiment. **Chaque copie est maintenant verrouillée pour toute sa durée de conservation.** Jusqu'à cette date, personne ne peut l'effacer ni la modifier, pas même avec les clés du VPS.

Livrables :

- [`docker/sauvegarde/`](../docker/sauvegarde/) :
  - copies envoyées verrouillées, et leur verrou relu chaque nuit ;
  - `sauvegarder --preparer`, qui crée le compartiment avec le verrouillage ;
  - alerte si des copies sont masquées ou remplacées, et `sauvegarder --acquitter` pour la lever ;
  - `restaurer liste` et `restaurer`, qui retrouvent les copies masquées ;
  - rclone 1.75.1 dans l'image.
- [`docker/sauvegarde/essai.sh`](../docker/sauvegarde/essai.sh) : **39 contrôles** (+11). Il rejoue notamment une intrusion avec les clés du compartiment.
- [`recette/Dockerfile`](../recette/Dockerfile) : l'image de la recette automatique, avec rclone 1.75.1 et un S3 simulé qui applique le verrouillage.
- [`deploiement/verifier.sh`](../deploiement/verifier.sh) `--local` : contrôle du verrouillage sur le VPS.
- [Guide d'exploitation](exploitation.md) : création du compartiment (5.2, 5.3), protection et conduite à tenir après une alerte (partie 7), dépannage.
- Variable `SAUVEGARDE_VERROU` (`COMPLIANCE` par défaut) dans `.env.production.example` et `docker-compose.prod.yml`.

## 1. En bref

| Contrôle | Résultat |
|---|---|
| Recette automatique | **11 / 11 critères**, 439 tests réussis sur 439, toutes les suites passent en 5 minutes ([rapport](recette/rapport.md)) |
| Essai de sauvegarde et restauration | **39 / 39 contrôles** (+11), dont 8 sur le verrouillage et l'intrusion |
| Intrusion avec les clés du compartiment | 4 attaques : suppression, purge du compartiment, effacement des versions, remplacement par un faux fichier. **Aucune copie verrouillée perdue.** L'alerte part à la sauvegarde suivante. Une copie masquée est restaurée et vérifiée. Le faux fichier est refusé à la restauration, et l'original reste restaurable. |
| Compartiment créé sans verrouillage | Détecté par `--controler`, avec la marche à suivre |
| Coût | Inchangé : chaque copie reste un jour de plus, le temps que son verrou expire |

## 2. Ce qu'un intrus peut encore faire

| Avec les clés du VPS, l'intrus… | Avant | Maintenant |
|---|---|---|
| efface les copies (`delete`, `purge`) | copies perdues | Elles ne sont que **masquées**. Les versions verrouillées restent, restaurables, et l'alerte part la nuit suivante. |
| efface les versions elles-mêmes | copies perdues | **refusé** (403) jusqu'à la fin du verrou |
| dépose un faux fichier sous le même nom | copie perdue | L'original reste en version verrouillée, restaurable, et l'alerte part. |
| supprime le compartiment | tout perdu | **refusé** tant qu'il contient des copies verrouillées |
| raccourcit ou lève le verrou | — | **impossible** en mode COMPLIANCE |
| lit les copies | impossible (chiffrées) | impossible (inchangé) |

**Ce qui reste hors de portée de la protection.** Un intrus qui prend le **compte client Contabo** peut résilier le stockage : cela ne passe pas par les clés S3. Le guide demande donc de protéger ce compte par une double authentification, confiée à une personne distincte de l'exploitation.

## 3. Décisions à valider

| N° | Sujet | Proposition |
|---|---|---|
| V1 | Mécanisme | **Verrouillage des objets chez Contabo**, dans le compartiment actuel. On écarte un second fournisseur et une seconde copie « tirée » depuis un poste de Makor : il y aurait plus à exploiter, et plus de risques d'oubli. La seconde copie tirée reste la solution de repli si le mode COMPLIANCE n'était pas disponible chez Contabo (V2). |
| V2 | Mode | **COMPLIANCE.** Personne ne peut raccourcir le verrou ni effacer une copie verrouillée, pas même le propriétaire du compte. On écarte GOVERNANCE : ce mode se contourne avec une permission que les clés du VPS ont. La documentation de Contabo montre un exemple en GOVERNANCE et ne dit rien de COMPLIANCE. **On le vérifie donc à l'installation** : `sauvegarder --preparer` envoie une sonde verrouillée puis tente de l'effacer. S'il échoue, `SAUVEGARDE_VERROU=GOVERNANCE` reste possible, au prix d'une protection plus faible. |
| V3 | Durées | Le verrou dure autant que la conservation : **30 jours** pour une quotidienne, **372 jours** pour une mensuelle (12 × 31). La rotation efface une copie un jour après la fin de son verrou. Baisser `SAUVEGARDE_JOURS` ne raccourcit pas les verrous déjà posés : le journal dit alors « rotation incomplète ». C'est normal, et ces copies partent à la fin de leur verrou. |
| V4 | Création du compartiment | Le compartiment se crée avec **`sauvegarder --preparer`**, pas dans le panneau Contabo, qui ne propose pas le verrouillage. Un compartiment ne peut pas recevoir le verrouillage après sa création. Si l'on avait déjà créé un compartiment sans verrouillage, il faut donc en créer un nouveau. Aucune production n'existe encore : il n'y a rien à migrer. |
| V5 | Vérifications | **Chaque nuit**, le verrou de chaque copie envoyée est relu (mode et date) ; une copie sans verrou fait échouer la sauvegarde. **`--controler`** envoie une sonde verrouillée un jour, puis tente de l'effacer : l'effacement doit être refusé. Il tourne au démarrage du conteneur, dans `verifier.sh --local` et à la vérification mensuelle. |
| V6 | Détection d'intrusion | La rotation efface les copies expirées **pour de bon, sans laisser de trace**. Toute copie masquée ou remplacée vient donc de quelqu'un d'autre. La sauvegarde suivante est alors **signalée en échec** : healthchecks.io prévient, et le conteneur devient « unhealthy ». L'alerte liste les archives à restaurer, sous le nom exact à donner à `restaurer`. Une fois l'incident clos, `sauvegarder --acquitter` fait taire l'alerte pour ces traces-là. |
| V7 | Restauration | `restaurer liste` montre aussi les copies masquées ou remplacées (« gardée par le verrou »). Elles se restaurent sous leur nom versionné, avec les mêmes contrôles qu'avant. |
| V8 | Outils | **rclone 1.75.1**, pris dans son image officielle, remplace le rclone 1.60 de Debian, qui ne sait pas poser de verrou (il faut la 1.70 ou plus). La recette automatique a désormais **son image** : rclone 1.75.1 et **moto**, un simulateur de S3 qui applique le verrouillage. Elle n'installe plus rien à chaque lancement. |

## 4. Mise en place

Rien ne change pour une installation neuve, sinon une commande de plus au démarrage (guide, 5.3) :

```bash
dcp up -d --build
dcp exec sauvegarde sauvegarder --preparer   # « Verrouillage COMPLIANCE : copie verrouillée, effacement refusé »
```

Si `--preparer` échoue sur le vrai compartiment Contabo, l'installation s'arrête là. Trois causes sont possibles :
- le nom du compartiment est déjà pris ;
- les clés n'ont pas le droit de créer un compartiment ;
- le mode COMPLIANCE est refusé, et il faut trancher V2.

## 5. Tests

Nouveaux contrôles de l'essai ([`essai.sh`](../docker/sauvegarde/essai.sh)), sur un S3 simulé qui applique le verrouillage :

1. compartiment créé avec le verrouillage ; la sonde est verrouillée et son effacement refusé ;
2. copies verrouillées en COMPLIANCE : 30 jours pour la quotidienne, 372 pour la mensuelle ;
3. une ancienne copie encore verrouillée est gardée par la rotation, sans faire échouer la sauvegarde ; les copies au verrou échu sont effacées ;
4. l'intrus attaque avec les clés : suppression, purge, effacement des versions, remplacement ;
5. aucune copie verrouillée n'est perdue ;
6. la sauvegarde suivante donne l'alerte, signalée en échec à la supervision, avec les archives à restaurer ;
7. `restaurer liste` montre les copies masquées ou remplacées ;
8. une copie masquée est restaurée et vérifiée (journal d'audit, isolation, pièces jointes) ;
9. le faux fichier est refusé à la restauration, et l'original reste restaurable ;
10. après `--acquitter`, les sauvegardes repassent au vert ;
11. un compartiment créé sans verrouillage est détecté.

Les 28 contrôles de l'étape 10 passent toujours : chiffrement, rétention, restauration, journal falsifié, pièce perdue, remplacement de la base.

**Limite de ces tests.** Le S3 simulé (moto 5.2.3) applique les règles de S3, pas celles de Contabo. Le vrai compartiment est vérifié à l'installation par `--preparer`, puis à chaque démarrage et à chaque `verifier.sh --local`.

## 6. L'alerte, telle qu'elle s'affiche

Extrait du journal de l'essai, après l'intrusion simulée :

```text
Copiée vers distant:essai/quotidien/, verrouillée 30 jours (COMPLIANCE)
ALERTE : des copies hors du VPS ont été masquées ou remplacées en dehors de la rotation (15 trace(s)).
Quelqu'un a utilisé les clés du compartiment : changez-les (panneau Contabo) et examinez le VPS.
Archives gardées par le verrou, restaurables telles quelles (restaurer <nom>) :
    distant:mensuel/reclamations-20260930T144803Z.tar-v2026-09-30-144804-000.age
    distant:quotidien/reclamations-20260930T144803Z.tar-v2026-09-30-144804-000.age
    distant:quotidien/reclamations-20260930T144806Z.tar-v2026-09-30-144806-000.age
Après enquête : sauvegarder --acquitter
ÉCHEC : copies hors du VPS masquées ou remplacées
```

La conduite à tenir est dans le [guide](exploitation.md#7-sauvegardes) : changer les clés, examiner ou reconstruire le VPS, vérifier une archive, puis acquitter.

## 7. Ce qui ne change pas

Le chiffrement (age, clés privées hors du VPS), le contenu et le format des archives, la rétention (7 copies locales, 30 quotidiennes, 12 mensuelles), la supervision et la restauration vérifiée restent ceux de l'étape 10.

## 8. Suite

Étape 13, répétition locale complète du déploiement sur le PC Windows : HTTPS local, S3 local avec verrouillage, sauvegarde et restauration, mise à jour et retour arrière, démonstration, contrôle du déploiement. Les scripts se lancent depuis PowerShell.

Pour valider : répondre « suivant », ou indiquer les décisions à changer.

Sources : [Contabo, verrouillage des objets (base de connaissances, juillet 2024)](https://contabo.com/blog/de/kb/103000282887-wie-verwende-ich-die-objektsperre-fuer-dateien-in-meinem-objektspeicher/) · [rclone, journal des versions (verrouillage des objets S3 depuis la 1.70)](https://rclone.org/changelog/)
