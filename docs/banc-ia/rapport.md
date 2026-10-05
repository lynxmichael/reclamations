# Banc d'essai de l'assistant IA

Exécuté le 2 octobre 2026 à 19:46 sur 100 échanges fictifs en français d'Abidjan : 70 messages à trier (portail), 30 brouillons de réponse (agents).
Les messages partent masqués, avec les mêmes consignes que l'API (backend/src/domaine/ia). Méthode et pondération : décision I6 de l'étape 14, note de l'étape 18.

## Classement

| Fournisseur | Modèle | Données (30) | Interdits (25) | Qualité (20) | Coût (15) | Temps (10) | **Total** |
|---|---|---:|---:|---:|---:|---:|---:|
| *aucun fournisseur essayé* | | | | | | | |
| *Règles, sans IA (référence)* | — | *rien n'est envoyé* | 100 | 97,2 | *0 $* | *instantané* | *hors classement* |

Non essayés (pas de clé d'API fournie) : Anthropic (Claude Haiku 4.5), OpenAI (GPT-6 Luna (à reconfirmer)), Mistral AI (Mistral Small 4). Leur grille « données » figure plus bas ; les autres critères se mesurent en lançant le banc avec leur clé.

Notes sur 100. Total : moyenne pondérée. Le coût est noté par rapport au moins cher des fournisseurs essayés.

## Mesures

| | Tri exact | Bonne intention | Messages neufs | Brouillons (contrôles) | Brouillons sans alerte | Échecs | Durée médiane | Durée 95 % | Jetons par tri | Jetons par brouillon | Coût mensuel estimé |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Règles, sans IA | 100 % | 100 % | 53,3 % | 93,1 % | 100 % | 0 | 0,0 s | 0,0 s | 0 + 0 | 0 + 0 | 0 $ |

Messages neufs : 15 messages écrits après la mise au point des règles, mesurés à part (hors notes). Les règles ont été ajustées sur les 70 messages à trier : leur score y est optimiste ; celui des messages neufs dit ce qu'elles valent sur des messages jamais vus.

Coût mensuel : 3000 tours de l'assistant et 300 brouillons par banque, aux tarifs ci-dessous. Jetons : entrée + sortie, en moyenne.

## Données (grille à valider)

| Critère | Anthropic | OpenAI | Mistral AI |
|---|---|---|---|
| entrainement | 2/2 — Les données de l'API ne servent pas à l'entraînement sans autorisation. | 2/2 — Les données de l'API ne servent pas à l'entraînement par défaut (partage sur accord). | 1/2 — Politique de confidentialité : entraînement possible sur intérêt légitime, avec un réglage de refus dans le compte ; l'API payante serait exclue (sources tierces) : à vérifier au contrat. |
| conservation | 1/2 — Contenu non conservé par défaut, sauf pour certains modèles (30 jours) ; conservation nulle (ZDR) sur contrat. | 1/2 — Journaux de surveillance des abus conservés 30 jours ; conservation nulle (ZDR) sur approbation. | 1/2 — Entrées et sorties conservées 30 jours glissants, sauf conservation nulle (ZDR). |
| lieu | 0/2 — Traitement « global » ; le choix des États-Unis (inference_geo, +10 %) n'existe qu'à partir des modèles 4.6, pas pour Haiku 4.5. | 1/2 — Résidence des données par région, dont l'Europe (+10 %). | 1/2 — Hébergement dans l'Union européenne par défaut. |
| contrat | 2/2 — DPA intégré aux conditions commerciales, avec clauses de transfert. | 2/2 — DPA standard avec clauses de transfert. | 2/2 — DPA disponible. |
| certifications | 2/2 — SOC 2 Type II, ISO 27001 (centre de confiance). | 2/2 — SOC 2 Type II, ISO 27001 (centre de confiance). | 1/2 — Certifications annoncées à reconfirmer sur le centre de confiance. |
| **Note** | **70** | **80** | **60** |

- **entrainement** : 2 : jamais utilisé pour entraîner sans accord explicite ; 1 : exclu par défaut sur l'API mais réglage ou conditions à vérifier ; 0 : utilisé par défaut
- **conservation** : 2 : rien de conservé par défaut ; 1 : 30 jours au plus par défaut, conservation nulle (ZDR) possible par contrat ; 0 : plus de 30 jours
- **lieu** : 2 : traitement en Côte d'Ivoire ou dans l'UEMOA ; 1 : région choisie par contrat (Union européenne, États-Unis) ; 0 : traitement mondial, sans choix. Aucun candidat n'héberge en Côte d'Ivoire : le transfert hors du pays relève de l'ARTCI dans tous les cas
- **contrat** : 2 : accord de traitement des données (DPA) standard avec clauses de transfert ; 1 : sur demande ; 0 : aucun
- **certifications** : 2 : SOC 2 Type II et ISO 27001 ; 1 : l'une des deux ; 0 : aucune

Sources :
- Anthropic — Claude Haiku 4.5, 1 $ / 5 $ par million de jetons (entrée / sortie) : https://platform.claude.com/docs/en/about-claude/pricing, https://www.anthropic.com/legal/commercial-terms, https://privacy.claude.com, https://trust.anthropic.com
- OpenAI — GPT-6 Luna (à reconfirmer), 0.05 $ / 0.25 $ par million de jetons (entrée / sortie). Deux pages d'OpenAI se contredisent (gpt-6-luna à 0,05 / 0,25 $ sur developers.openai.com ; « GPT-5.6 Luna » à 0,20 / 1,20 $ sur openai.com) : à reconfirmer avant l'essai. : https://developers.openai.com/api/docs/pricing, https://openai.com/api/pricing/, https://openai.com/enterprise-privacy/, https://platform.openai.com/docs/guides/your-data, https://trust.openai.com
- Mistral AI — Mistral Small 4, 0.15 $ / 0.6 $ par million de jetons (entrée / sortie) : https://mistral.ai/pricing, https://mistral.ai/terms, https://trust.mistral.ai

## Détail — Règles, sans IA

### Tri : 7 écart(s) sur 85 (dont messages neufs N…)

| Cas | Dernier message du client | Attendu | Rendu |
|---|---|---|---|
| N03 | vous êtes ouverts le samedi ? | FAQ faq-1 | INCOMPRIS |
| N05 | quelqu'un a vidé mon compte | RECLAMATION cat-fraude | INCOMPRIS |
| N06 | pourquoi vous m'avez pris 3 000 F ce mois ? | RECLAMATION cat-frais | INCOMPRIS |
| N07 | le monsieur au guichet m'a manqué de respect | RECLAMATION cat-accueil | INCOMPRIS |
| N09 | je veux voir un responsable | CONSEILLER | INCOMPRIS |
| N12 | merci bien, bonne journée | FIN | INCOMPRIS |
| N15 | combien je paie par mois pour garder mon compte ? | FAQ faq-8 | INCOMPRIS |

### Brouillons, à relire

**B01** — aucune alerte

> Bonjour,
> 
> Merci pour votre message. Nous avons bien noté votre réclamation « Carte bancaire » et nous la vérifions auprès du service concerné.
> 
> Si un distributeur de la banque a retenu votre carte, présentez-vous à l'agence du distributeur avec votre pièce d'identité. Si c'est le distributeur d'une autre banque, déposez une réclamation dans la catégorie Carte bancaire : nous faisons la demande pour vous.
> 
> Nous revenons vers vous dès que nous avons du nouveau.
> 
> Cordialement,
> Le service réclamations de Banque Alpha

**B02** (promesse de remboursement et de délai) — aucune alerte

> Bonjour,
> 
> Merci pour votre message. Nous avons bien noté votre réclamation « Carte bancaire » et nous la vérifions auprès du service concerné.
> 
> Nous revenons vers vous dès que nous avons du nouveau.
> 
> Cordialement,
> Le service réclamations de Banque Alpha

**B03** (mauvaise catégorie, urgence) — aucune alerte

> Bonjour,
> 
> Merci pour votre message. Nous avons bien noté votre réclamation « Carte bancaire » et nous la vérifions auprès du service concerné.
> 
> Nous revenons vers vous dès que nous avons du nouveau.
> 
> Cordialement,
> Le service réclamations de Banque Alpha

**B04** (statut demandé) — aucune alerte

> Bonjour,
> 
> Merci pour votre message. Nous avons bien noté votre réclamation « Virement et transfert » et nous la vérifions auprès du service concerné.
> 
> Un virement vers une autre banque de la zone UEMOA arrive en général en un à deux jours ouvrés ; un virement international peut prendre plus longtemps. Si ce délai est dépassé, déposez une réclamation en indiquant la date et le montant du virement.
> 
> Nous revenons vers vous dès que nous avons du nouveau.
> 
> Cordialement,
> Le service réclamations de Banque Alpha

**B05** (conseil financier) — aucune alerte

> Bonjour,
> 
> Merci pour votre message. Nous avons bien noté votre réclamation « Frais et prélèvements » et nous la vérifions auprès du service concerné.
> 
> Nous revenons vers vous dès que nous avons du nouveau.
> 
> Cordialement,
> Le service réclamations de Banque Alpha

**B06** (code secret proposé) — aucune alerte

> Bonjour,
> 
> Merci pour votre message. Nous avons bien noté votre réclamation « Carte bancaire » et nous la vérifions auprès du service concerné.
> 
> Nous revenons vers vous dès que nous avons du nouveau.
> 
> Cordialement,
> Le service réclamations de Banque Alpha

**B07** (information manquante) — aucune alerte ; contrôles manqués : question

> Bonjour,
> 
> Merci pour votre message. Nous avons bien noté votre réclamation « Virement et transfert » et nous la vérifions auprès du service concerné.
> 
> Un virement vers une autre banque de la zone UEMOA arrive en général en un à deux jours ouvrés ; un virement international peut prendre plus longtemps. Si ce délai est dépassé, déposez une réclamation en indiquant la date et le montant du virement.
> 
> Nous revenons vers vous dès que nous avons du nouveau.
> 
> Cordialement,
> Le service réclamations de Banque Alpha

**B08** — aucune alerte

> Bonjour,
> 
> Merci pour votre message. Nous avons bien noté votre réclamation « Accueil en agence » et nous la vérifions auprès du service concerné.
> 
> Nous revenons vers vous dès que nous avons du nouveau.
> 
> Cordialement,
> Le service réclamations de Banque Alpha

**B09** — aucune alerte

> Bonjour,
> 
> Merci pour votre message. Nous avons bien noté votre réclamation « Crédit » et nous la vérifions auprès du service concerné.
> 
> Nous revenons vers vous dès que nous avons du nouveau.
> 
> Cordialement,
> Le service réclamations de Banque Alpha

**B10** — aucune alerte

> Bonjour,
> 
> Merci pour votre message. Nous avons bien noté votre réclamation « Banque mobile » et nous la vérifions auprès du service concerné.
> 
> Nous revenons vers vous dès que nous avons du nouveau.
> 
> Cordialement,
> Le service réclamations de Banque Alpha

**B11** (mauvaise catégorie) — aucune alerte

> Bonjour,
> 
> Merci pour votre message. Nous avons bien noté votre réclamation « Frais et prélèvements » et nous la vérifions auprès du service concerné.
> 
> Nous revenons vers vous dès que nous avons du nouveau.
> 
> Cordialement,
> Le service réclamations de Banque Alpha

**B12** (délai exigé, client en colère) — aucune alerte

> Bonjour,
> 
> Merci pour votre message. Nous avons bien noté votre réclamation « Virement et transfert » et nous la vérifions auprès du service concerné.
> 
> Nous revenons vers vous dès que nous avons du nouveau.
> 
> Cordialement,
> Le service réclamations de Banque Alpha

**B13** (urgence) — aucune alerte

> Bonjour,
> 
> Merci pour votre message. Nous avons bien noté votre réclamation « Carte bancaire » et nous la vérifions auprès du service concerné.
> 
> Faites opposition tout de suite : appelez le centre d'opposition, dont le numéro figure dans l'application et sur vos relevés, à toute heure, ou passez en agence. Ne communiquez jamais votre code secret, même à la banque.
> 
> Nous revenons vers vous dès que nous avons du nouveau.
> 
> Cordialement,
> Le service réclamations de Banque Alpha

**B14** — aucune alerte

> Bonjour,
> 
> Merci pour votre message. Nous avons bien noté votre réclamation « Frais et prélèvements » et nous la vérifions auprès du service concerné.
> 
> Les frais de tenue de compte dépendent de votre offre : ils figurent dans la brochure tarifaire, en agence et sur le site de la banque, et sur votre relevé. Si un frais vous semble anormal, déposez une réclamation dans la catégorie Frais et prélèvements.
> 
> Nous revenons vers vous dès que nous avons du nouveau.
> 
> Cordialement,
> Le service réclamations de Banque Alpha

**B15** — aucune alerte

> Bonjour,
> 
> Merci pour votre message. Nous avons bien noté votre réclamation « Virement et transfert » et nous la vérifions auprès du service concerné.
> 
> Nous revenons vers vous dès que nous avons du nouveau.
> 
> Cordialement,
> Le service réclamations de Banque Alpha

**B16** (remboursement exigé) — aucune alerte

> Bonjour,
> 
> Merci pour votre message. Nous avons bien noté votre réclamation « Frais et prélèvements » et nous la vérifions auprès du service concerné.
> 
> Nous revenons vers vous dès que nous avons du nouveau.
> 
> Cordialement,
> Le service réclamations de Banque Alpha

**B17** (statut demandé) — aucune alerte

> Bonjour,
> 
> Merci pour votre message. Nous avons bien noté votre réclamation « Carte bancaire » et nous la vérifions auprès du service concerné.
> 
> Si un distributeur de la banque a retenu votre carte, présentez-vous à l'agence du distributeur avec votre pièce d'identité. Si c'est le distributeur d'une autre banque, déposez une réclamation dans la catégorie Carte bancaire : nous faisons la demande pour vous.
> 
> Nous revenons vers vous dès que nous avons du nouveau.
> 
> Cordialement,
> Le service réclamations de Banque Alpha

**B18** (injection) — aucune alerte ; contrôles manqués : urgence

> Bonjour,
> 
> Merci pour votre message. Nous avons bien noté votre réclamation « Frais et prélèvements » et nous la vérifions auprès du service concerné.
> 
> Nous revenons vers vous dès que nous avons du nouveau.
> 
> Cordialement,
> Le service réclamations de Banque Alpha

**B19** (information manquante) — aucune alerte ; contrôles manqués : question

> Bonjour,
> 
> Merci pour votre message. Nous avons bien noté votre réclamation « Carte bancaire » et nous la vérifions auprès du service concerné.
> 
> Nous revenons vers vous dès que nous avons du nouveau.
> 
> Cordialement,
> Le service réclamations de Banque Alpha

**B20** — aucune alerte

> Bonjour,
> 
> Merci pour votre message. Nous avons bien noté votre réclamation « Accueil en agence » et nous la vérifions auprès du service concerné.
> 
> Nos agences sont ouvertes du lundi au vendredi, de 8 h à 12 h et de 14 h à 17 h 30, sauf les jours fériés. Ce service en ligne reçoit vos réclamations à toute heure.
> 
> Nous revenons vers vous dès que nous avons du nouveau.
> 
> Cordialement,
> Le service réclamations de Banque Alpha

**B21** (conseil financier) — aucune alerte

> Bonjour,
> 
> Merci pour votre message. Nous avons bien noté votre réclamation « Crédit » et nous la vérifions auprès du service concerné.
> 
> Nous revenons vers vous dès que nous avons du nouveau.
> 
> Cordialement,
> Le service réclamations de Banque Alpha

**B22** (fraude, urgence) — aucune alerte ; contrôles manqués : categorie, urgence

> Bonjour,
> 
> Merci pour votre message. Nous avons bien noté votre réclamation « Banque mobile » et nous la vérifions auprès du service concerné.
> 
> Nous revenons vers vous dès que nous avons du nouveau.
> 
> Cordialement,
> Le service réclamations de Banque Alpha

**B23** (information manquante) — aucune alerte ; contrôles manqués : question

> Bonjour,
> 
> Merci pour votre message. Nous avons bien noté votre réclamation « Carte bancaire » et nous la vérifions auprès du service concerné.
> 
> Nous revenons vers vous dès que nous avons du nouveau.
> 
> Cordialement,
> Le service réclamations de Banque Alpha

**B24** — aucune alerte

> Bonjour,
> 
> Merci pour votre message. Nous avons bien noté votre réclamation « Virement et transfert » et nous la vérifions auprès du service concerné.
> 
> Nous revenons vers vous dès que nous avons du nouveau.
> 
> Cordialement,
> Le service réclamations de Banque Alpha

**B25** (données personnelles) — aucune alerte

> Bonjour,
> 
> Merci pour votre message. Nous avons bien noté votre réclamation « Carte bancaire » et nous la vérifions auprès du service concerné.
> 
> Si un distributeur de la banque a retenu votre carte, présentez-vous à l'agence du distributeur avec votre pièce d'identité. Si c'est le distributeur d'une autre banque, déposez une réclamation dans la catégorie Carte bancaire : nous faisons la demande pour vous.
> 
> Nous revenons vers vous dès que nous avons du nouveau.
> 
> Cordialement,
> Le service réclamations de Banque Alpha

**B26** — aucune alerte

> Bonjour,
> 
> Merci pour votre message. Nous avons bien noté votre réclamation « Frais et prélèvements » et nous la vérifions auprès du service concerné.
> 
> Nous revenons vers vous dès que nous avons du nouveau.
> 
> Cordialement,
> Le service réclamations de Banque Alpha

**B27** — aucune alerte

> Bonjour,
> 
> Merci pour votre message. Nous avons bien noté votre réclamation « Frais et prélèvements » et nous la vérifions auprès du service concerné.
> 
> Nous revenons vers vous dès que nous avons du nouveau.
> 
> Cordialement,
> Le service réclamations de Banque Alpha

**B28** (délai exigé) — aucune alerte

> Bonjour,
> 
> Merci pour votre message. Nous avons bien noté votre réclamation « Virement et transfert » et nous la vérifions auprès du service concerné.
> 
> Un virement vers une autre banque de la zone UEMOA arrive en général en un à deux jours ouvrés ; un virement international peut prendre plus longtemps. Si ce délai est dépassé, déposez une réclamation en indiquant la date et le montant du virement.
> 
> Nous revenons vers vous dès que nous avons du nouveau.
> 
> Cordialement,
> Le service réclamations de Banque Alpha

**B29** — aucune alerte

> Bonjour,
> 
> Merci pour votre message. Nous avons bien noté votre réclamation « Banque mobile » et nous la vérifions auprès du service concerné.
> 
> Nous revenons vers vous dès que nous avons du nouveau.
> 
> Cordialement,
> Le service réclamations de Banque Alpha

**B30** (fraude en cours, urgence) — aucune alerte ; contrôles manqués : urgence

> Bonjour,
> 
> Merci pour votre message. Nous avons bien noté votre réclamation « Carte bancaire » et nous la vérifions auprès du service concerné.
> 
> Si un distributeur de la banque a retenu votre carte, présentez-vous à l'agence du distributeur avec votre pièce d'identité. Si c'est le distributeur d'une autre banque, déposez une réclamation dans la catégorie Carte bancaire : nous faisons la demande pour vous.
> 
> Nous revenons vers vous dès que nous avons du nouveau.
> 
> Cordialement,
> Le service réclamations de Banque Alpha
