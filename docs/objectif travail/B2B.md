# Module B2B — Objectif métier

> **Périmètre fonctionnel** : ce document décrit **ce que le module B2B sert à faire au quotidien** pour The Breakery,

---

## 1. Raison d'être

Le module B2B est le **canal wholesale** de The Breakery. Il répond à une question simple mais stratégique pour une boulangerie qui ne veut pas vivre uniquement de ses tickets de comptoir :

> *"Comment je vends 200 baguettes par semaine à un hôtel, 50 viennoiseries par jour à un café, et 500 cookies en livraison à un événement d'entreprise — avec un prix négocié, une livraison planifiée, une facture officielle et un paiement à 30 jours ?"*

C'est le module qui transforme **un commerçant de quartier en fournisseur** d'hôtels, restaurants, cafés, traiteurs et revendeurs. Sans lui, chaque commande professionnelle se gérait à la main (carnet papier, facture Word, paiement perdu de vue) ; avec lui, chaque relation B2B devient un **flux structuré** : devis → confirmation → préparation → livraison(s) → facturation → encaissement échelonné.

Le module est **complémentaire de la caisse**, pas concurrent. Le POS gère la vente immédiate au comptoir ; le B2B gère la commande différée, livrée et payée plus tard.

---

## 2. Les 6 vues principales du module

| Vue | Job-to-be-done | Route |
|---|---|---|
| **Dashboard B2B** | Vue d'ensemble : top clients, KPI, commandes récentes, aging | `/b2b` |
| **Liste des commandes** | Tracker toutes les commandes B2B avec leur statut | `/b2b/orders` |
| **Création / édition commande** | Formulaire 4 sections : client, items, livraison, notes | `/b2b/orders/new` |
| **Détail commande** | 4 onglets : Items, Deliveries, Payments, History | `/b2b/orders/:id` |
| **Paiements B2B** | 3 onglets : Outstanding, Aging, Received | `/b2b/payments` |
| **Fiche client B2B** | Vue 360° d'un client : commandes, paiements, encours | `/b2b/clients/:id` |

Le tout est complété par la **configuration B2B** (`/settings/b2b`) qui définit les règles transverses (conditions de paiement par défaut, numérotation facture, workflow d'approbation).

---

## 3. Les 5 invariants du module

Quelle que soit la vue consultée, l'utilisateur retrouve toujours les mêmes mécaniques — c'est ce qui rend le module robuste :

1. **Un client B2B est un client de la base partagée**. Pas de doublon avec le module Customers — c'est le flag `customer_type = 'b2b'` qui active la logique wholesale (pricing, crédit, conditions).
2. **Une commande est un cycle complet**. Le module suit la commande de sa création à sa livraison complète et à son paiement intégral — pas juste l'encaissement.
3. **Paiement et livraison sont découplés**. On peut livrer en plusieurs fois, payer en plusieurs fois, et les deux flux sont indépendants. Une facture peut être livrée à 80% et payée à 100% — c'est normal.
4. **Numérotation séquentielle officielle**. Chaque commande et chaque facture ont un numéro séquentiel non réutilisable, pour traçabilité légale.
5. **Tout est tracé dans l'historique commande**. Création, confirmation, modification de quantité, ajout de paiement, génération de facture — chaque événement est daté et signé.

---

## 4. Vue **Dashboard B2B** — La photo du canal

Donner au gérant en charge des B2B une **vue 30 secondes** de son canal wholesale.

### 4.1 KPI principaux

En haut de page, ~6 KPI cards :

- **Total clients B2B** (et actifs).
- **Commandes totales** sur la période.
- **Commandes en cours** (statuts confirmed / processing / ready).
- **Revenu total B2B** sur la période.
- **Encours impayé** (somme des `amount_due` toutes commandes confondues).
- **Aging résumé** (combien de créances dans chaque bucket : courant, 30j, 60j, 90j+).

### 4.2 Top clients B2B

Une grille de cartes des **clients les plus stratégiques** :

- Triés par chiffre d'affaires.
- Chaque carte montre : raison sociale, statut, nombre de commandes, total dépensé, encours impayé.
- Clic → ouvre la fiche client.

### 4.3 Commandes récentes

Les **5 dernières commandes** créées avec : numéro, client, montant, statut, statut paiement, date. Clic → détail commande.

### 4.4 Aging summary visuel

Un mini-graphique répartissant l'encours impayé par tranche d'ancienneté (Courant / 1-30j / 31-60j / 61-90j / 90j+). Permet d'identifier en 5 secondes si le canal B2B a un problème de recouvrement.

Bénéfice métier : **prioriser la journée**. Le gérant voit immédiatement si un client important est en retard de paiement, si une commande importante doit être préparée aujourd'hui, si l'encours global dérape.

---

## 5. Vue **Liste des commandes** — Le tracker opérationnel

Donner à l'équipe **la liste complète** de toutes les commandes B2B, avec ce qu'il faut pour les piloter au quotidien.

### 5.1 Affichage

Chaque ligne : numéro de commande, client, date commande, date de livraison prévue, montant total, statut, statut paiement, montant restant dû.

### 5.2 Filtres

- Par statut (draft, confirmed, processing, ready, partially_delivered, delivered, completed, cancelled).
- Par statut paiement (unpaid, partial, paid).
- Par client.
- Par période (date de commande, date de livraison).
- Par tag (commande prioritaire, événement, récurrente…).

### 5.3 Recherche

Par numéro de commande, nom de client, raison sociale.

### 5.4 Actions

- **Créer une nouvelle commande** (bouton primaire).
- **Cloner une commande existante** (utile pour les commandes récurrentes : "même chose que la semaine dernière").
- **Imprimer** un bon de préparation ou une facture.

Bénéfice métier : **éviter qu'une commande soit oubliée**. Tous les statuts pending sont visibles d'un coup ; chaque commande à livrer demain remonte en haut de la pile.

---

## 6. Vue **Création / édition commande** — Le formulaire central

C'est l'écran le plus utilisé du module. Il est structuré en **4 sections** + **1 sidebar** :

### 6.1 Section Customer

- Sélection du client B2B (autocomplete sur la base partagée, filtré sur `customer_type = 'b2b'`).
- Affichage automatique des **conditions du client** : prix wholesale ou liste de prix dédiée, conditions de paiement (COD / net 7 / 14 / 30 / 60), plafond de crédit, encours actuel.
- Alerte automatique si la commande risque de **dépasser le plafond de crédit** du client.

### 6.2 Section Items

- Ajout de produits ligne par ligne.
- Pour chaque ligne : produit, quantité, prix unitaire (pré-rempli avec le prix wholesale du client), remise éventuelle, total ligne.
- Le prix par défaut respecte la hiérarchie : **liste de prix dédiée du client** > prix wholesale > prix retail.
- Possibilité d'override manuel du prix avec trace dans l'historique.
- Calcul total commande en temps réel (subtotal + tax PB1 10% inclus).

### 6.3 Section Delivery

- Adresse de livraison (par défaut celle du client, modifiable).
- Date et créneau de livraison prévue.
- Mode de livraison (livraison en propre, transporteur, retrait sur place).
- Instructions spéciales (étage, code, contact à prévenir).

### 6.4 Section Notes

- Commentaires internes (vu par le staff).
- Mention sur la facture (vu par le client).
- Tags / étiquettes.

### 6.5 Sidebar — Résumé temps réel

Une colonne fixée à droite qui affiche :

- Sous-total, taxe, total.
- Conditions de paiement appliquées.
- Date d'échéance calculée automatiquement.
- Boutons d'action : "Save as draft", "Confirm order" (passe en statut `confirmed`).

Bénéfice métier : **passer une commande de 30 lignes en 3 minutes** sans risque d'erreur de prix. Le formulaire impose les bonnes données dans le bon ordre, calcule tout en direct, et bloque les commandes au-delà du plafond crédit avant qu'elles ne créent un risque.

---

## 7. Vue **Détail commande** — Le pilotage d'une commande

Une fois la commande créée, son détail s'affiche avec **4 onglets** correspondant aux 4 dimensions d'une commande B2B.

### 7.1 Onglet **Items**

- Récap complet des lignes de la commande.
- Quantités commandées vs livrées (utile pour les livraisons partielles).
- Possibilité d'ajouter / retirer un item tant que la commande n'est pas `delivered` (avec PIN manager si déjà confirmée).
- Bouton "Imprimer bon de préparation" pour la cuisine / le pâtissier.

### 7.2 Onglet **Deliveries**

- Liste des livraisons effectuées pour cette commande.
- Pour chaque livraison : date, items livrés, quantités, statut.
- Bouton "Enregistrer une livraison" — saisir les items réellement remis avec leur quantité.
- Lors d'une livraison, le stock est automatiquement déduit (flag `stock_deducted`).
- Une commande passe à `partially_delivered` après la première livraison incomplète, à `delivered` quand tout est sorti.

### 7.3 Onglet **Payments**

- Liste des paiements reçus pour cette commande.
- Pour chaque paiement : date, méthode (cash, bank transfer, card), montant, numéro de paiement.
- Bouton "Enregistrer un paiement" — saisir un nouveau versement.
- Une commande passe à `partial` après le premier paiement incomplet, à `paid` quand `amount_due = 0`.
- Possibilité de saisir un paiement **FIFO** (mode dédié) qui s'applique automatiquement aux plus vieilles commandes du client.

### 7.4 Onglet **History**

- Journal immuable de tous les événements de la commande.
- Chaque ligne : timestamp, utilisateur, type d'événement (created, confirmed, item_added, item_removed, delivery_recorded, payment_received, invoice_generated, status_changed, cancelled), description.
- Toujours visible, jamais éditable.

Bénéfice métier : **tout savoir d'une commande en un seul écran**, sans avoir à fouiller dans des tableaux séparés. Pour un litige client ("vous m'avez livré quoi le 12 ?", "j'ai bien réglé le 25 ?"), la réponse est dans les onglets en 10 secondes.

---

## 8. Status machine — Le cycle de vie d'une commande

Une commande B2B traverse une **séquence d'états** définie et tracée :

```
draft → confirmed → processing → ready → partially_delivered → delivered → completed
   ↓
cancelled
```

| Statut | Signification métier | Qui peut changer |
|---|---|---|
| **draft** | Brouillon — modifiable librement, pas encore engagée | Auteur |
| **confirmed** | Engagée client — bloque les prix, alerte l'équipe | Manager / sales |
| **processing** | En préparation cuisine / pâtisserie | Staff cuisine |
| **ready** | Prête à être livrée / retirée | Staff cuisine |
| **partially_delivered** | Au moins une livraison effectuée, reste à livrer | Auto (livraison enregistrée) |
| **delivered** | Tous les items livrés | Auto (dernière livraison) |
| **completed** | Livrée ET intégralement payée | Auto (dernier paiement) |
| **cancelled** | Annulée — items retirés du stock si déjà déduit | Manager (PIN) |

Bénéfice métier : **chaque commande sait où elle est** dans son cycle, sans qu'on doive le chercher. Le staff cuisine ne voit que les commandes `confirmed` ou `processing` ; la compta ne voit que les commandes `delivered` non `completed`.

---

## 9. Vue **Paiements B2B** — Le pilotage du recouvrement

Cette page est l'outil **du gérant ou du comptable** qui veille à l'encaissement. Elle est structurée en **3 onglets** :

### 9.1 Onglet **Outstanding** — Les impayés courants

- Liste de toutes les commandes avec `amount_due > 0`.
- Par client : nom, raison sociale, nombre de commandes ouvertes, montant total dû.
- Indicateur de retard : OK (avant échéance), à risque (échéance dans 7j), en retard (passée).
- Action rapide : "Enregistrer un paiement" (peut s'appliquer en FIFO sur les plus vieilles factures).
- Action rapide : "Envoyer relance" (génère un PDF ou un message).

### 9.2 Onglet **Aging** — Le vieillissement des créances

- Tableau avec une ligne par client B2B en encours.
- Pour chaque client : montant courant, montant 1-30j, 31-60j, 61-90j, 90j+, total.
- Trié par retard (plus vieux en haut).
- Export CSV / PDF.

Bénéfice : **identifier les clients toxiques** dont la créance dérape avant qu'elle ne devienne irrécouvrable.

### 9.3 Onglet **Received** — Les paiements encaissés

- Journal des paiements B2B sur la période.
- Filtre par client, par méthode, par période.
- Récap : total encaissé, répartition par méthode, par jour.
- Réconciliation : croiser avec les relevés bancaires.

Bénéfice métier : **arrêter de courir après l'argent à l'aveugle**. Le module sait toujours qui doit quoi, depuis quand, et prioritise les relances par âge et par enjeu.

---

## 10. Paiement **FIFO** — La gestion intelligente du multi-encours

Spécificité métier B2B : un même client peut avoir **plusieurs commandes impayées simultanément**. Quand il envoie un virement de 5M IDR, comment savoir à quelle facture l'imputer ?

Le module propose un **mode FIFO** (First In First Out) :

- Le paiement reçu s'applique automatiquement à la **plus vieille facture impayée** du client.
- Une fois cette facture soldée, le reste s'applique à la suivante, etc.
- Affichage en direct de la répartition avant validation.
- Possibilité de **forcer une imputation manuelle** (le client demande "imputez ce paiement à la facture INV-2024-0156") avec trace dans l'historique.

Bénéfice métier : **automatiser le travail comptable** sans renoncer au contrôle. 90 % des paiements suivent la logique FIFO ; les 10 % spécifiques sont traités à la main mais tracés.

---

## 11. Fiche **Client B2B** — La vue 360° d'une relation

La fiche client B2B est la **vue d'ensemble d'une relation** dans le temps. Accessible via le top clients du dashboard ou via le module Customers.

Elle affiche :

- **Identité** : raison sociale, NPWP, contact référent, adresse, conditions.
- **Conditions appliquées** : plafond de crédit, conditions de paiement, liste de prix dédiée si applicable.
- **KPI** : nombre total de commandes, chiffre d'affaires cumulé, encours actuel, panier moyen, fréquence d'achat.
- **Toutes les commandes** chronologiquement, avec accès rapide au détail.
- **Tous les paiements** chronologiquement.
- **Aging spécifique** au client (combien dans chaque bucket).
- **Historique d'événements** (création compte, changement de conditions, blocage temporaire, alertes).

Bénéfice métier : **préparer un rendez-vous client en 1 minute**. Avant d'appeler un hôtel pour discuter d'un retard de paiement, le gérant a sous les yeux tout l'historique : commandes, encours, antériorité, fréquence — il négocie en position de force.

---

## 12. Listes de prix B2B — Le pricing négocié

Tous les clients B2B ne paient pas la même chose. Le module supporte **trois niveaux de pricing** :

1. **Prix retail** — Le tarif par défaut (utilisé si rien d'autre n'est défini).
2. **Prix wholesale** — Tarif générique B2B (défini sur la fiche produit).
3. **Liste de prix dédiée** — Tarif négocié spécifiquement avec un client (table `b2b_price_lists`).

Une liste de prix dédiée permet de :

- Donner un prix sur-mesure à chaque produit pour un client donné.
- Limiter dans le temps (date de début / fin).
- Cloner d'un client à un autre (utile pour une chaîne d'hôtels).
- Versionner (les anciennes commandes gardent leur prix d'origine).

Bénéfice métier : **honorer les négociations commerciales sans tout coder à la main**. Quand un hôtel signe pour 2 ans à -15%, on crée une liste de prix dédiée et toutes ses commandes appliquent automatiquement le bon tarif.

---

## 13. Facturation B2B — Le document officiel

Chaque commande B2B confirmée peut générer une **facture officielle** :

- **Numérotation séquentielle** non réutilisable (préfixe + année + séquence, configurable dans Settings).
- **Mentions légales** complètes : raison sociale, NPWP de The Breakery, NPWP du client, conditions de paiement, date d'échéance, taxe PB1 détaillée.
- **PDF généré** via l'Edge Function `generate-invoice`, archivé dans Supabase Storage.
- **Téléchargeable** depuis le détail commande ou la liste des commandes.
- **Envoi par e-mail** au client (configurable, utilise `send-test-email` côté serveur).

Bénéfice métier : **un document standardisé, légal et infalsifiable** sortant en 2 secondes, sans risque d'erreur de calcul ou d'oubli de mention.

---

## 14. Mécaniques transverses — Comment le module dialogue avec le reste

### 14.1 Avec Customers

Le client B2B est un enregistrement de la table `customers` avec `customer_type = 'b2b'`. La création / édition de la fiche client passe par le module Customers ; le module B2B n'y touche pas directement.

### 14.2 Avec Inventory

À chaque livraison enregistrée, le module B2B **déduit le stock** des items livrés via les mouvements de stock standards. Pas de double comptage : le `stock_deducted` flag verrouille l'opération.

### 14.3 Avec Accounting

Une commande B2B `delivered` génère automatiquement les écritures comptables (revenu + taxe collectée + créance client). Un paiement reçu génère les écritures de règlement (encaissement + diminution créance). Tout passe par les triggers Postgres du module Accounting.

### 14.4 Avec Reports

Le module alimente plusieurs reports dédiés : **B2B Receivables Aging**, **Sales By Customer** (croisé avec retail), **B2B Self-Approval Risk** (audit fraude — voir module Reports section Logs & Audit).

### 14.5 Avec Settings

Les valeurs par défaut (conditions de paiement, numérotation facture, plafond crédit générique, template facture) sont définies dans `/settings/b2b`. Le module les lit, ne les écrit jamais.

---

## 15. Ce que le module ne fait **pas** (par design)

- Le module **ne crée pas de fiches clients B2B**. Cette opération est dans le module Customers (avec activation du flag `customer_type = 'b2b'`).
- Le module **ne gère pas le catalogue produit**. Pas d'ajout / modification produit ici — uniquement leur pricing dédié via les listes de prix.
- Le module **ne fait pas le suivi de la production**. Si un client commande 200 baguettes, c'est au module Production de planifier le pétrissage — le B2B ne fait que demander.
- Le module **n'envoie pas automatiquement de relances**. La détection des retards est faite (page Outstanding), mais l'envoi reste à initier manuellement par l'utilisateur.
- Le module **ne gère pas les contrats de récurrence**. Une commande hebdomadaire d'hôtel reste à ressaisir (ou cloner) chaque semaine ; pas encore d'abonnement B2B.

---

## 16. Ce que le module doit (encore) faire — backlog métier

| Priorité | Évolution | Bénéfice attendu |
|---|---|---|
| 🔴 | **Auto-approval workflow** | Workflow visuel : commande > X IDR exige validation manager ; commande hors plafond crédit exige validation owner. Aujourd'hui contrôlé en code, à externaliser. |
| 🔴 | **Détection self-approval** | Empêcher qu'un commercial crée et approuve sa propre commande (signal de fraude). Cf. report `b2b_self_approval_risk`. |
| 🟠 | **Commandes récurrentes / abonnements** | Définir une commande type qui se duplique automatiquement chaque lundi pour un hôtel. |
| 🟠 | **Relances automatiques** | Envoi automatique d'un rappel à J-3 de l'échéance, J+0, J+7, J+15. |
| 🟠 | **Devis (quote) avant commande** | Étape `quote` en amont de `draft` — envoyer un PDF de devis, le client confirme par retour. |
| 🟡 | **Avoirs / credit notes** | Générer une note de crédit officielle pour un retour client ou une casse à la livraison. |
| 🟡 | **Multi-livraisons planifiées d'avance** | Planifier une commande 500 baguettes en 5 livraisons sur la semaine, dès la confirmation. |
| 🟡 | **Portal client B2B** | Donner un accès web au client pour consulter ses commandes / factures / encours en self-service. |
| 🟢 | **Tarification par volume** | Prix dégressif automatique selon quantité commandée (baguettes < 50 = prix A, ≥ 50 = prix B). |
| 🟢 | **Intégration comptable export** | Export direct des factures dans le format attendu par le comptable externe (Accurate, MYOB). |

---

## 17. En une phrase

Le module B2B est **le moteur wholesale** de The Breakery : il transforme une boulangerie de comptoir en fournisseur professionnel structuré, suit chaque commande de son brouillon à son paiement intégral, applique automatiquement les prix négociés client par client, et donne au gérant la maîtrise totale de son encours sans transformer la compta en cauchemar — pour qu'aucune commande B2B ne soit ni mal facturée, ni oubliée, ni impayée sans qu'on le sache.
