# Module Customers — Objectif métier

> 🗄️ **ARCHIVED / SUPERSEDED (2026-06-04).** This legacy V2 "Objectif métier" brief was folded verbatim into **Partie I — Vue fonctionnelle** of the canonical reference module [`reference/04-modules/08-customers-loyalty.md`](../../reference/04-modules/08-customers-loyalty.md) (2026-05-13). The reference is the source of truth; this file is kept for history only.


> **Statut V2/V3** : décrit la vision business cible. **V2 jamais déployée**. Implémentation V3 = DONE (`apps/backoffice/src/features/customers` + POS `apps/pos/src/features/customers` + customerCategories + loyalty). Hardening colonnes PII S15. Voir [`../V2_V3_GLOSSARY.md`](../V2_V3_GLOSSARY.md).
>
> **Périmètre fonctionnel** : ce document décrit **ce que le module Customers sert à faire au quotidien** pour The Breakery
---

## 1. Raison d'être

Le module Customers est le **cœur relationnel** de The Breakery. Il répond à une question simple mais structurante pour une boulangerie qui veut faire revenir ses clients :

> *"Qui sont mes clients, combien dépensent-ils, comment je les fidélise, et comment je facture différemment un particulier et un hôtel qui me prend 200 baguettes par semaine ?"*

C'est le module qui transforme une **vente anonyme à la caisse** en **relation suivie** : nom, téléphone, historique d'achats, points fidélité, palier de remise, conditions B2B, encours impayé. Sans lui, chaque ticket est un événement isolé ; avec lui, chaque client devient un actif mesurable.

---

## 2. Les deux populations couvertes

Le module gère **deux types de clients** dans une seule base, distingués par le champ `customer_type` :

| Type | Profil cible | Pricing | Paiement |
|---|---|---|---|
| **Retail** | Particulier qui passe en boutique, walk-in fidélisable | Prix retail standard ± remise catégorie / palier loyalty | Comptant (cash, card, e-wallet) |
| **B2B** | Hôtel, restaurant, café, traiteur, revendeur | Prix wholesale ou grille custom par catégorie | À terme (COD, net 7/14/30/60) avec encours plafonné |

Les deux populations partagent **la même fiche client** mais activent des sections différentes (formulaire, détail, factures, conditions de paiement).

---

## 3. Objectif Fichier clients (vue liste)

Donner au gérant ou au caissier une **vue centralisée et filtrable** de tous les clients connus de The Breakery.

La liste permet de :

- Voir d'un coup d'œil chaque client avec son **type** (retail / B2B), sa **catégorie** (retail standard, wholesale, VIP, employé…), son **palier fidélité** (Bronze → Platinum), ses **points courants**, son **total dépensé** et le **nombre de visites**.
- **Rechercher** par nom, téléphone, e-mail, numéro de membre ou nom d'entreprise.
- **Filtrer** par type de client, catégorie, palier, statut actif/inactif.
- Accéder aux **statistiques agrégées** : nombre total de clients, retail vs B2B, répartition par palier, points en circulation, encours B2B total.
- **Désactiver** (soft delete) un client qui n'est plus actif sans casser l'historique des commandes passées avec lui.

Bénéfice métier : **objectiver le portefeuille client** au lieu de naviguer à l'intuition. Identifier ses 10 meilleurs clients, ses dormants à relancer, ses B2B à risque.

---

## 4. Objectif Création / édition de fiche client

Permettre à un caissier ou au gérant de **créer rapidement** un client (depuis la caisse en pleine vente, depuis le BackOffice à tête reposée) ou de **mettre à jour** une fiche existante.

### 4.1 Saisie minimale (retail)

- Nom (obligatoire).
- Téléphone et/ou e-mail (facultatif mais recommandé pour la fidélité).
- Date de naissance (facultatif, déclenche le bonus anniversaire de palier).
- Adresse (facultatif).
- Catégorie tarifaire (défaut : retail standard).
- Note libre.

### 4.2 Saisie B2B (en plus)

- Nom de l'entreprise.
- NPWP (identifiant fiscal indonésien) si facturation officielle.
- Conditions de paiement (COD, net 7/14/30/60).
- Plafond de crédit autorisé (`credit_limit`).
- Contact référent.

### 4.3 Génération automatique

À la création, le système attribue automatiquement :

- Un **numéro de membre** unique (`membership_number`).
- Un **QR code** unique (`BRK-XXXXXX-YYMM`) scannable à la caisse pour identifier le client en une seconde.

Bénéfice métier : **réduire la friction caisse**. En 15 secondes le caissier saisit un nom + téléphone, le client repart avec son QR code, et toutes ses prochaines visites alimentent automatiquement sa fidélité.

---

## 5. Objectif Catégories clients (pricing tiers)

Permettre au gérant de définir des **logiques de prix différenciées** selon le profil du client, sans toucher au catalogue produit.

Une catégorie regroupe des clients qui partagent **la même règle de pricing**. Le module fournit quatre logiques natives :

| Type de catégorie | Comportement |
|---|---|
| **Retail** | Le client paie le prix retail standard du catalogue. |
| **Wholesale** | Le client paie le prix wholesale du produit (s'il existe), sinon retail. |
| **Discount %** | Le client bénéficie d'une remise en pourcentage appliquée au prix retail (arrondie à 100 IDR). |
| **Custom** | Le prix est défini ligne par ligne (`product_category_prices`) pour ce produit et cette catégorie. Permet par exemple à un hôtel d'avoir un prix négocié sur 20 produits clés et le wholesale par défaut sur le reste. |

Chaque catégorie peut aussi définir :

- Un **multiplicateur de points fidélité** (`points_multiplier`) — une catégorie VIP gagne 1,5× plus de points par IDR dépensé.
- Si la **fidélité est activée** ou non pour cette catégorie.
- Un **code couleur** et une **icône** pour repérage visuel.
- Le statut **par défaut** (utilisé pour les clients sans catégorie explicite).

Bénéfice métier : **adapter la tarification à la réalité commerciale** (un Pullman ne paie pas le même prix qu'un walk-in) **sans dupliquer le catalogue produit**. La modification du prix retail d'un produit se propage automatiquement à toutes les catégories qui s'y réfèrent.

---

## 6. Objectif Programme de fidélité (loyalty)

Inciter les clients retail à revenir, et récompenser les meilleurs.

### 6.1 Règle d'acquisition

- **1 point gagné par tranche de 1 000 IDR dépensée**.
- Multiplié par le `points_multiplier` de la **catégorie** du client.
- Multiplié par le `points_multiplier` du **palier** courant du client.
- Inscrit automatiquement à la complétion d'une commande payée.

### 6.2 Paliers (tiers)

| Palier | Points lifetime requis | Remise | Multiplicateur points | Bonus anniversaire | Livraison offerte |
|---|---|---|---|---|---|
| **Bronze** | 0 | 0 % | 1,0× | — | non |
| **Silver** | 500 | 5 % | 1,05× | configurable | non |
| **Gold** | 2 000 | 8 % | 1,1× | configurable | non |
| **Platinum** | 5 000 | 10 % | 1,2× | configurable | possible |

L'**upgrade de palier est automatique** : dès que `lifetime_points` dépasse le seuil suivant, le client est promu et la remise associée s'applique sur les prochaines transactions.

### 6.3 Utilisation des points

- **Earn** : crédit automatique sur paiement d'une commande.
- **Redeem** : échange des points contre une remise en caisse (avec vérification du solde disponible).
- **Bonus** : geste commercial manuel (anniversaire, parrainage, doléance).
- **Adjust** : ajustement administratif par un manager (correction de saisie, remboursement de points en cas de retour).
- **Expire** : expiration éventuelle (politique configurable).
- **Refund** : restitution de points si la commande est annulée.

### 6.4 Ledger immutable

Chaque mouvement de points est consigné dans `loyalty_transactions` avec :

- Type, nombre de points, solde après opération.
- Montant de la commande déclenchante (si earn).
- Description, utilisateur initiateur, date.

Aucun mouvement n'est supprimable : toute correction passe par un mouvement compensatoire. Garantie d'**auditabilité** intégrale.

### 6.5 QR code client

Chaque client a un QR code unique généré à la création. À la caisse, le caissier scanne le QR → la fiche client se charge instantanément → la commande applique automatiquement le bon prix, le bon multiplicateur de points, et la bonne remise palier.

Bénéfice métier : **transformer un acheteur ponctuel en client récurrent mesurable**, et **récompenser la fidélité sans gestion papier** (pas de carte à tampon perdue, pas de calcul manuel).

---

## 7. Objectif Fiche client détaillée (dashboard 360°)

Donner au gérant un **tableau de bord par client** consultable en un clic depuis la liste.

La fiche est organisée en plusieurs onglets :

### 7.1 Vue d'ensemble (header)

- Identité (nom, téléphone, e-mail, type, catégorie, palier).
- Indicateurs clés : `total_visits`, `total_spent`, `loyalty_points` courants, `lifetime_points`.
- Date d'inscription, dernière visite.
- Actions rapides : éditer, ajuster les points, désactiver.

### 7.2 Onglet Loyalty

- Palier courant et progression vers le suivant (jauge "X points avant Gold").
- Historique complet des transactions de points (gagnés, échangés, bonus).
- Bouton **manuel d'ajustement** de points (geste commercial, correction).
- QR code affiché en grand pour scan.

### 7.3 Onglet Orders

- Historique des commandes passées par ce client : date, montant, statut, mode de paiement.
- Filtrable par période, par statut.
- Lien direct vers le détail de chaque commande.

### 7.4 Onglet Analytics

- Chiffre d'affaires par mois.
- Panier moyen.
- Fréquence de visite.
- Top produits achetés.
- Tendance (en croissance, stable, en déclin).

### 7.5 Sections B2B (uniquement pour `customer_type = b2b`)

- **Outstanding orders** : commandes B2B livrées mais non encore payées, avec encours total et alerte si proche du `credit_limit`.
- **Monthly spending chart** : courbe de dépense mensuelle pour suivre la santé du compte.
- **Top products** : ce que ce B2B commande le plus (utile pour la négociation annuelle).
- **Recent orders table** : dernières commandes B2B avec statuts de paiement.

Bénéfice métier : **piloter chaque client individuellement** — détecter qu'un B2B fidèle dépense moins, qu'un client retail Gold n'est plus revenu depuis 3 mois, qu'un hôtel approche son plafond de crédit et doit être relancé avant d'accepter une nouvelle commande.

---

## 8. Objectif Import en masse

Permettre de **reprendre un fichier client existant** (Excel, Google Sheets, ancien logiciel) sans devoir ressaisir chaque fiche à la main.

Le module fournit un assistant en 3 étapes :

1. **Upload** : sélection du fichier CSV/Excel, choix de la catégorie par défaut.
2. **Preview** : aperçu des lignes parsées, détection des doublons (par téléphone / e-mail), validation des champs obligatoires, signalement des erreurs ligne par ligne.
3. **Result** : récapitulatif des clients créés, mis à jour, ignorés ou en erreur, avec possibilité d'exporter le rapport.

Bénéfice métier : **migrer rapidement** depuis un système existant (Excel, ancien POS), ou **enrichir périodiquement** la base à partir d'une source externe (programme de parrainage, événement promotionnel).

---

## 9. Objectif Intégration POS (caisse)

Le module Customers est **branché directement sur le POS** pour que la fidélité et le pricing différencié soient invisibles côté caissier :

- **Rattacher un client** à une commande en cours : recherche rapide par nom/téléphone, scan QR code, ou création express.
- **Pricing automatique** : dès qu'un client est rattaché, les prix de la commande sont recalculés selon sa catégorie (`get_customer_product_price` RPC).
- **Remise palier** appliquée automatiquement au sous-total selon le `loyalty_tier` du client.
- **Earn points** automatique à la finalisation du paiement (via trigger ou RPC `add_loyalty_points`).
- **Redeem points** proposé en moyen de paiement à la caisse (le caissier saisit le nombre de points à utiliser, le système vérifie le solde et applique la remise).
- **Visibilité solde** du client en temps réel dans l'écran de paiement.

Bénéfice métier : **zéro friction caisse** + **zéro oubli de fidélité**. Le caissier ne calcule rien, ne tape rien manuellement — il scanne et encaisse.

---

## 10. Objectif Intégration B2B / Wholesale

Pour les clients B2B, le module sert de **base de référence** au module B2B / Wholesale qui gère les commandes professionnelles :

- Sélection du client B2B → application automatique des **prix wholesale** ou custom.
- Vérification de l'**encours** par rapport au `credit_limit` avant de valider une nouvelle commande à crédit.
- Pré-remplissage des **conditions de paiement** (`payment_terms`) sur la facture.
- Suivi des **factures impayées** et calcul du **DSO** (délai moyen de paiement) par client.

Pour le détail du cycle de commande B2B, voir le module B2B / Wholesale dédié.

---

## 11. Objectif Sécurité et conformité

| Objectif | Pourquoi |
|---|---|
| **Soft delete** | Un client désactivé garde son historique (commandes, points). Aucune donnée n'est perdue. |
| **Ledger fidélité immutable** | Les transactions de points ne sont jamais supprimées. Toute correction = mouvement compensatoire. |
| **QR code unique** | Garantit l'identification rapide et fiable sans saisie clavier. |
| **RLS Supabase** | Lecture pour tout utilisateur authentifié ; écriture conditionnée aux permissions `customers.create`, `customers.update`, `customers.delete`, `customers.loyalty`, `products.pricing`. |
| **Traçabilité utilisateur** | Chaque ajustement de points, chaque modification de fiche enregistre l'utilisateur et la date. |
| **Données personnelles** | Téléphone et e-mail stockés en clair (utilisation interne uniquement) ; pas de partage tiers. NPWP B2B isolé sur les fiches B2B. |

---

## 12. Permissions

Le module est gouverné par **5 codes de permission** distincts :

| Code | Pour qui ? |
|---|---|
| `customers.view` | Tout utilisateur de la caisse et du BackOffice |
| `customers.create` | Caissiers, managers, gérant |
| `customers.update` | Managers, gérant |
| `customers.delete` | Gérant uniquement (soft delete) |
| `customers.loyalty` | Managers et gérant (ajustement manuel de points) |
| `products.pricing` | Managers et gérant (custom prices par catégorie) |

---

## 13. Ce que le module **ne fait pas** (limites assumées V2)

- **Pas de segmentation marketing avancée** (RFM, scoring, cohortes) — les analytics restent descriptives.
- **Pas de campagne SMS / e-mail intégrée** — l'export de la base est manuel, le routage marketing est externe.
- **Pas de programme de parrainage** automatisé — gérable manuellement via ajustement de points bonus.
- **Pas d'expiration automatique** des points en V2 — le mécanisme `expire` existe dans le ledger mais aucun job ne le déclenche automatiquement.
- **Pas de gestion multi-établissement** — un seul site, donc une seule base client.
- **Pas de fusion automatique de doublons** — la détection au moment de l'import existe, mais la déduplication d'une base existante se fait manuellement.
- **Pas d'app mobile dédiée client** — le QR code est imprimé / affiché sur écran ; pas d'app de fidélité côté consommateur.

---

## 14. Utilisateurs cibles

| Rôle | Ce qu'il fait dans le module |
|---|---|
| **Caissier** | Rattache un client à une commande, scanne un QR code, crée une fiche express à la volée. |
| **Manager** | Ajuste manuellement des points (geste commercial), gère les conflits, consulte les fiches détaillées. |
| **Gérant** | Pilote la base globale, configure les catégories tarifaires et les paliers, surveille les encours B2B, lance les imports en masse. |
| **Responsable B2B** | Crée et entretient les fiches entreprise, négocie les prix custom, surveille les encours et relance les impayés. |
| **Comptable** | Audite les transactions de fidélité, vérifie la cohérence des encours B2B avec le grand livre clients. |

---

## 15. Indicateurs clés pilotables

Le module fournit (ou alimente d'autres modules avec) les indicateurs suivants :

- **Nombre total de clients** actifs, par type, par catégorie, par palier.
- **Taux de fidélisation** : % de visites associées à un client identifié vs anonyme.
- **Panier moyen par palier** (Bronze vs Gold : la fidélité paie-t-elle ?).
- **Points en circulation** (passif fidélité) vs points consommés.
- **Encours B2B total** et par client.
- **DSO** (jours moyens de paiement B2B).
- **Top clients** (par CA, par fréquence, par panier moyen).
- **Clients dormants** (inactifs depuis N jours).

---

## 16. Résumé en une phrase

> **Le module Customers transforme chaque ticket de caisse en relation suivie : il sait qui achète quoi, à quel prix, avec quelle fidélité et quel encours — pour que The Breakery puisse récompenser ses meilleurs clients retail, facturer correctement ses comptes B2B, et piloter son portefeuille au lieu de subir le hasard du passage en boutique.**
