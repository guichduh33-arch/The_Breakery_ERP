# Module Reports — Objectif métier

> **Périmètre fonctionnel** : ce document décrit **ce que le module Reports sert à faire au quotidien** pour The Breakery.

---

## 1. Raison d'être

Le module Reports est la **conscience analytique** de The Breakery. Il répond à une question simple mais structurante pour un gérant qui ne peut pas être à la caisse 16h par jour :

> *"Qu'est-ce qui s'est vraiment passé hier, cette semaine, ce mois ? Qu'est-ce qui se vend, qu'est-ce qui ne se vend plus, qui m'apporte de l'argent, qui m'en coûte, et est-ce que quelqu'un est en train de me voler ?"*

C'est le module qui transforme **des milliers de tickets, mouvements de stock, écritures comptables et clics caisse** en **réponses lisibles en une minute** : un graphique, un KPI comparé à hier, un top 10, une alerte rouge. Sans lui, le gérant pilote au feeling ; avec lui, chaque décision (commande fournisseur, planning staff, promo, retrait produit) est appuyée par un chiffre.

Le module n'écrit **jamais** de données métier : il ne fait que **lire, agréger, comparer, exporter**. C'est l'œil, pas la main.

---

## 2. Les 7 catégories du module (les 7 onglets)

Le module est structuré en **7 catégories** correspondant à 7 axes de pilotage distincts :

| Catégorie | Job-to-be-done | Reports |
|---|---|---|
| **Overview** | Vue 10 secondes : santé globale du jour / mois | 1 |
| **Sales** | Comprendre ce qui se vend, à qui, quand, à quel prix | 16 |
| **Inventory** | Vérifier que le stock physique colle au stock système et anticiper les ruptures | 11 |
| **Purchases** | Suivre les achats fournisseurs, les coûts d'approvisionnement et les impayés | 6 |
| **Finance & Payments** | Réconcilier la caisse, suivre la trésorerie, le P&L et la TVA | 12 |
| **Operations** | Mesurer la productivité staff, cuisine et production | 5 |
| **Logs & Audit** | Détecter les fraudes internes, les anomalies et les changements sensibles | 10 |

Au total **~61 reports** (dont quelques uns cachés en attente d'implémentation). Tous partagent la **même structure d'écran** (filtres date + KPI cards + graphiques + table + export) et les **mêmes permissions** (`reports.sales`, `reports.inventory`, `reports.financial`).

---

## 3. Les 6 invariants UX du module

Quel que soit le report consulté, l'utilisateur retrouve toujours les mêmes éléments — c'est ce qui rend le module appropriable en quelques minutes :

1. **Sélecteur de période** en haut à droite : Today, Yesterday, Last 7 days, Last 30 days, Month-to-date, Year-to-date, Custom range. Le report se recalcule en direct.
2. **Comparaison de période** activable d'un clic : "vs période précédente" ou "vs même période l'an dernier", avec affichage des deltas en % et en valeur absolue sur les KPI cards.
3. **Filtres contextuels** spécifiques au report (catégorie produit, staff, méthode de paiement, type de commande, client) avec synchronisation dans l'URL (partage de lien préservant les filtres).
4. **KPI cards** en haut (4 à 8 chiffres clés) — c'est le résumé qu'on lit en premier.
5. **Graphique(s)** au milieu — courbe, barres, donut, heatmap horaire selon le contexte.
6. **Table détaillée** en bas avec tri et pagination, et **deux boutons d'export** : CSV (pour Excel / comptable) et PDF (pour archivage / impression / partage).

Bénéfice métier : **zéro courbe d'apprentissage entre deux reports**. Le gérant qui maîtrise le Sales Dashboard maîtrise mécaniquement le P&L et le Stock Movement.

---

## 4. Objectif Overview — General Dashboard

Donner au gérant qui ouvre l'application le matin une **photo instantanée** de la santé du business sur la période sélectionnée, sans avoir à plonger dans le détail.

Le dashboard affiche :

- **Revenue net** (ventes encaissées, taxes incluses) avec delta vs période précédente.
- **Nombre de commandes** et **panier moyen**.
- **Top product** du jour (volume + revenu).
- **Alertes stock bas** consolidées (combien de produits sous le seuil critique).
- **Sessions de caisse actives** (combien de caisses ouvertes en ce moment).
- **Tendance ventes** sur les 7 / 30 / 90 derniers jours (courbe).

Bénéfice métier : **savoir en 10 secondes si la journée est en avance, en retard ou conforme** sur l'objectif. Si tout est vert, le gérant peut aller voir le four ; si quelque chose est rouge, il sait exactement où creuser.

---

## 5. Objectif Sales (16 reports) — Comprendre la vente

C'est la catégorie la plus dense du module. Elle répond à **toutes les questions qu'un commerçant se pose sur ses ventes**, déclinées par axe d'analyse.

### 5.1 Vues d'ensemble synthétiques

| Report | Réponse |
|---|---|
| **All in 1 Sales Summary** | "Quelle a été la journée / la semaine ?" Une page qui rassemble revenu, commandes, taxes, remises, top produits, top staff, méthodes de paiement. |
| **Daily Sales** | "Comment se répartit le revenu jour par jour sur la période ?" Une courbe + une table chronologique. |
| **Profit & Loss** | "Combien j'ai *vraiment* gagné après COGS et dépenses ?" Revenue – COGS – Expenses = Net Profit. |

### 5.2 Axes d'analyse des ventes

| Report | Réponse |
|---|---|
| **Sales By Date** | Journal détaillé de chaque commande sur la période. |
| **Sales Items By Date** | Journal détaillé de chaque ligne d'item vendue (drill-down dans les commandes). |
| **Daily Items Sold Detail** | Log chronologique avec heure d'envoi cuisine et heure de paiement — utile pour comprendre la cadence de service. |
| **Product Sales By SKU** | "Quels produits cartonnent ?" Classement par revenu / quantité. |
| **Product Sales By Category** | "Quelle catégorie tire le chiffre ?" Pains, viennoiseries, boissons, plats salés. |
| **Sales By Customer** | "Qui sont mes meilleurs clients ?" Classement par dépense cumulée sur la période. |
| **Sales Details By Hours** | "À quelle heure je vends le plus ?" Heatmap horaire — décisif pour le planning staff et la production. |
| **Order Type Distribution** | "Quelle part fait Dine-in, Takeaway, Delivery, B2B ?" Donut + comparaison période. |

### 5.3 Analyses avancées (rentabilité & fidélité)

| Report | Réponse |
|---|---|
| **Gross Margin by Product** | "Quel produit est *rentable* (pas juste populaire) ?" Revenu – coût matière par SKU. Identifie les SKUs déficitaires à reformuler ou retirer. |
| **ABC Product Analysis** | "Quels sont mes 20% de produits qui font 80% du CA ?" Classement Pareto en classes A / B / C. Outil de rationalisation du catalogue. |
| **Customer Lifetime Value** | "Combien vaut un client sur sa durée de vie ?" Total dépensé, fréquence de visite, ancienneté, statut (actif / dormant / perdu). |
| **Loyalty & Retention** | "Mon programme fidélité fonctionne-t-il ?" Points en circulation, répartition par palier (Bronze→Platinum), clients actifs vs inactifs. |
| **Sales Cancellation Details** | "Combien de commandes sont annulées et par qui ?" — premier filet de sécurité contre les annulations frauduleuses (croisé avec Logs & Audit). |

Bénéfice métier global : **arrêter de gérer le catalogue à l'instinct**. Chaque retrait, chaque promo, chaque négociation fournisseur est appuyée par un report précis.

---

## 6. Objectif Inventory (11 reports) — Gardien du stock

Le pendant analytique du module Inventory. Ici on ne *modifie* pas le stock, on **l'inspecte sous tous les angles**.

| Report | Réponse |
|---|---|
| **Product Stock Balance** | "Combien j'ai de chaque produit en ce moment et combien ça vaut ?" Valorisation au coût + au prix de vente. |
| **Stock Movement** | "Qu'est-ce qui a bougé sur la période ?" Historique complet : achats, ventes, transferts, casses, ajustements, productions. |
| **Stock Movement Analytics** | "Comment évolue la valeur du stock dans le temps ?" Courbe valeur + quantité. |
| **Wastage & Spoilage** | "Combien je jette par jour, et quels produits ?" Critique pour une boulangerie où le périssable est partout. |
| **Incoming Raw Materials** | "Qu'est-ce qui est rentré récemment côté matières premières ?" Suivi des réceptions hors PO formelles. |
| **Stock Transfer** | "Qu'est-ce qui a circulé entre l'entrepôt et la cuisine / la vitrine ?" |
| **Product Stock Warning** | "Quels produits sont en alerte rouge / orange ?" Liste actionnable pour le réassort. |
| **Product Unsold** | "Quels produits n'ont pas bougé sur la période ?" — détecte les SKUs morts à arrêter de produire. |
| **Expired Stock** | "Quels lots tracés sont périmés ou vont l'être ?" — alerte sanitaire et perte financière. |
| **Product Materials** | "Pour chaque produit fini, quelle est sa recette détaillée et son coût matière théorique ?" Base du calcul de marge. |

Bénéfice métier : **réconcilier la perception cuisine avec la réalité financière du stock**. Un chef qui jette "deux ou trois croissants par jour" voit en chiffres que ça représente 12 % de la production hebdo et 600 000 IDR de perte mensuelle.

---

## 7. Objectif Purchases (6 reports) — Suivre l'approvisionnement

Le pendant analytique du module Purchasing. Il répond à **"qu'est-ce que j'achète, à qui, à quel prix, et qu'est-ce que je n'ai pas encore payé ?"**.

| Report | Réponse |
|---|---|
| **Purchase Items** | "Quels articles j'ai achetés, à quel prix unitaire, à quelle date ?" — base pour la négociation fournisseur. |
| **Purchase Details** | "Détail de chaque PO sur la période — qui a commandé, qui a reçu, montants." |
| **Purchase By Date** | "Comment se répartissent mes achats dans le temps ?" Courbe d'évolution. |
| **Purchase By Supplier** | "Combien je dépense chez chaque fournisseur ?" — outil clé pour la concentration / diversification des sources. |
| **Outstanding Payment** | "Combien je dois encore à mes fournisseurs ?" Liste des factures impayées. |
| **Purchase Returns** *(à venir)* | Suivi des retours fournisseurs (avoirs, casse à la réception). |

Bénéfice métier : **maîtriser le coût matière** dans le temps. Repérer une hausse de tarif fournisseur, voir si un nouveau fournisseur tient ses prix, identifier les dépendances dangereuses (90% du beurre chez un seul fournisseur).

---

## 8. Objectif Finance & Payments (12 reports) — Réconcilier et projeter

C'est la catégorie **comptable et trésorerie** du module. Elle s'adresse autant au gérant qu'au comptable externe.

### 8.1 Réconciliation et encaissements

| Report | Réponse |
|---|---|
| **Payment By Method** | "Quelle part en cash, carte, QRIS, e-wallet, bank transfer ?" Critique pour anticiper la trésorerie et négocier les commissions bancaires. |
| **Sales Cash Balance** | "Mon fond de caisse colle-t-il ?" Réconciliation des sessions caisse — montants attendus vs comptés. |
| **Expenses by Date** | Journal des dépenses opérationnelles approuvées sur la période. |

### 8.2 Créances et impayés

| Report | Réponse |
|---|---|
| **Receivables** | "Qui me doit de l'argent ?" Liste globale clients + ardoises POS. |
| **B2B Receivables Aging** | "Combien d'impayés B2B, et depuis quand ?" Buckets : Courant / 1-30j / 31-60j / 61-90j / 90j+. Permet de prioriser les relances. |
| **POS Outstanding** | "Quelles ardoises POS sont en cours ?" Notes non payées avec aging. |
| **POS Outstanding History** | "Quelles ardoises ont été soldées, avec quel délai ?" Mesure de la santé du crédit informel accordé en caisse. |

### 8.3 Pilotage P&L et projection

| Report | Réponse |
|---|---|
| **Revenue Forecast** | "Combien je vais faire les 14 prochains jours ?" Projection basée sur la moyenne mobile 7 jours des 90 derniers jours. |
| **P&L Monthly Trend** | "Quelle est ma rentabilité mois par mois sur 12 mois ?" Revenue, COGS, expenses, net profit en courbe. |
| **VAT / Tax Report** | "Combien de PB1 (taxe restaurant 10%) j'ai collecté ce mois ?" Base pour la déclaration. |

### 8.4 Contrôle des dérives commerciales

| Report | Réponse |
|---|---|
| **Discounts & Voids** | "Combien de remises et annulations sur la période, qui les a faites ?" Vue agrégée. |
| **Discount Details** | "Détail de chaque remise — type, montant, bill, staff, approbation manager." |

Bénéfice métier : **avoir une comptabilité de pilotage en temps réel**, indépendante du comptable mensuel. Le gérant détecte une dérive de marge ou un trou de trésorerie au jour près, pas au trimestre près.

---

## 9. Objectif Operations (5 reports) — Mesurer la productivité

Ici on regarde **le geste opérationnel** : qui fait quoi, en combien de temps, avec quel rendement.

| Report | Réponse |
|---|---|
| **Staff Performance** | "Quel staff vend le plus, fait le plus de commandes, a le plus d'annulations ?" Classement par cashier / serveur. |
| **Production Report** | "Combien j'ai produit de chaque produit, à quel coût matière théorique ?" Drill-down par produit et date. |
| **Production Efficiency** | "Quel produit a le plus de gâchis en production ?" Taux de waste par produit + tendance journalière — repère les recettes mal calibrées ou les opérateurs en difficulté. |
| **COGS Production Report** | "Quel est le coût des matières premières consommées via la production + les ventes ?" Base du COGS comptable. |
| **KDS Service Speed** *(à venir)* | "Combien de temps prend chaque plat entre l'envoi cuisine et le 'ready' ?" Mesure du goulot d'étranglement service. |

Bénéfice métier : **objectiver les conversations RH et cuisine**. Un staff qui se plaint d'être "débordé tous les après-midis" est appuyé (ou contredit) par la heatmap horaire ; un chef qui dit qu'une recette "marche pas bien" est appuyé par le taux de waste.

---

## 10. Objectif Logs & Audit (10 reports) — Détecter fraude et anomalies

C'est la catégorie **sécurité métier**. Elle s'adresse au gérant qui veut s'assurer que **personne ne le vole** — ni de l'extérieur (clients) ni de l'intérieur (staff).

### 10.1 Traçabilité opérationnelle

| Report | Réponse |
|---|---|
| **Price Changes** | "Qui a changé le prix de quel produit, quand ?" Historique des modifications tarifaires — détecte les baisses non autorisées. |
| **Product Deleted** | "Qui a supprimé quel produit du catalogue ?" Log des suppressions (soft delete tracé). |
| **General Audit Log** | "Quels événements sensibles ont eu lieu dans le système ?" Vue brute du flux d'audit, filtrable. |
| **Permission Change Log** | "Qui a modifié les droits de qui ?" Détecte l'**auto-escalade de privilèges** (un staff qui se donne plus de droits) et les changements en masse suspects. |

### 10.2 Détection de fraude staff

| Report | Réponse | Risque détecté |
|---|---|---|
| **Void & Discount Abuse** | Taux d'annulation et de remise par cashier vs moyenne équipe. | **Sweethearting** (remises à des complices) et **annulations frauduleuses** (encaisser puis annuler pour empocher le cash). |
| **Cash Variance Trend** | Tendance des écarts de caisse par session sur 30 jours. | **Vol progressif** — petites soustractions répétées non détectables sur une seule session. |
| **Loyalty Adjustments Audit** | Ajouts manuels de points fidélité non rattachés à une commande. | **Crédit frauduleux** de points à un client complice. |
| **Ghost Stock Movements** | Mouvements de stock suspects : sans raison documentée, quantité anormalement élevée, hors horaires. | **Détournement de stock** physique. |

### 10.3 Détection d'erreurs ou fraude externe

| Report | Réponse |
|---|---|
| **Duplicate Transactions** | Détection d'éventuels doubles débits — même client / staff / montant dans une fenêtre courte. Protection client + détection d'erreur caisse. |
| **Alerts Dashboard** | Tableau de bord consolidé des anomalies détectées par l'app (anomaly detection cross-modules). |

Bénéfice métier : **dissuader, détecter, documenter**. Le simple fait que ces reports existent et soient consultés régulièrement par le gérant réduit drastiquement les tentations internes. En cas de fraude avérée, le report fournit la **preuve datée** pour licencier ou porter plainte.

---

## 11. Objectif Exports — Sortir de l'app

Chaque report propose **deux exports systématiques** :

| Export | Usage cible |
|---|---|
| **CSV** | Comptable externe (Excel), analyse ad-hoc, sauvegarde mensuelle, croisement avec d'autres sources. |
| **PDF** | Impression, archivage légal, envoi par e-mail à un associé, présentation à un investisseur ou à la banque. |

Le PDF inclut systématiquement un **en-tête The Breakery**, la **période**, la **date d'extraction** et un **filigrane** pour traçabilité.

Bénéfice métier : **interopérabilité totale**. Le module n'est pas une prison de données — le gérant peut emporter ses chiffres partout, dans n'importe quel format demandé par un tiers (banque, comptable, fournisseur de fonds).

---

## 12. Objectif Drill-down — Aller du général au détail

Plusieurs reports supportent la navigation **drill-down avec breadcrumb** : un clic sur une ligne de KPI ou de table ouvre le report enfant filtré sur cette ligne.

Exemples :

- Sur **Sales by Category**, cliquer "Viennoiseries" → ouvre **Product Sales By SKU** filtré sur Viennoiseries.
- Sur **Staff Performance**, cliquer un cashier → ouvre **Sales By Date** filtré sur ce cashier.
- Sur **Stock Warning**, cliquer un produit → ouvre **Stock Movement** filtré sur ce produit.

Le breadcrumb permet de remonter d'un clic.

Bénéfice métier : **éviter le ping-pong** entre 15 reports différents pour répondre à une seule question. Le gérant suit un fil naturel : "le CA viennoiseries baisse → quel produit en particulier → quel jour précis → c'est lié à quelle promo".

---

## 13. Objectif Permissions — Cloisonnement par rôle

Le module respecte le système de permissions transverse de l'app. Trois permissions principales :

| Permission | Donne accès à |
|---|---|
| `reports.sales` | Catégories Overview, Sales |
| `reports.inventory` | Catégorie Inventory |
| `reports.financial` | Catégories Finance & Payments, Purchases, Operations (partiellement) |
| `reports.security` *(implicite via admin)* | Catégorie Logs & Audit |

Bénéfice métier : **un cashier ne voit pas le P&L**, un manager de salle ne voit pas les audits de fraude, le comptable externe ne voit que la finance. Chaque rôle accède strictement à ce qu'il doit voir.

---

## 14. Ce que le module ne fait **pas** (par design)

Pour cadrer les attentes :

- Le module **ne modifie aucune donnée métier**. On ne corrige pas un prix dans un report — on va dans le module Products.
- Le module **ne crée pas d'écritures comptables**. La compta double-entry est gérée par triggers Postgres dans le module Accounting.
- Le module **ne déclenche pas d'actions** (commande automatique, relance fournisseur, e-mail client). Les reports informent ; l'action est manuelle dans le module concerné.
- Le module **ne stocke aucune donnée propre**. Toutes les vues sont des projections en lecture seule des tables transactionnelles — ce qui garantit qu'un report est **toujours synchronisé avec la réalité** au moment où il est ouvert.
- Le module **n'envoie pas de notifications push**. Les alertes apparaissent quand le report est ouvert ; l'envoi automatique d'alertes est de la responsabilité d'un futur module Notifications.

---

## 15. Ce que le module doit (encore) faire — backlog métier

Reports identifiés comme à forte valeur ajoutée non encore livrés :

| Priorité | Report | Bénéfice attendu |
|---|---|---|
| 🔴 | **KDS Service Speed** | Mesurer le goulot d'étranglement cuisine, optimiser les recettes longues. |
| 🔴 | **Unusual Transaction Patterns** | Détecter automatiquement les transactions hors horaires, montants aberrants, splits cash juste sous un seuil suspect. |
| 🔴 | **B2B Self-Approval Risk** | Repérer les commandes B2B où le créateur et l'approbateur sont la même personne. |
| 🟠 | **Customer Cohort Analysis** | Mesurer la rétention par cohorte mensuelle (nouveaux vs récurrents). |
| 🟠 | **Basket Analysis** | Identifier les produits souvent achetés ensemble pour créer des combos pertinents. |
| 🟠 | **Promotion Effectiveness** | Mesurer le ROI réel de chaque promotion (volume incrémental vs marge sacrifiée). |
| 🟡 | **Peak Hour Staffing** | Recommander un planning staff basé sur la charge horaire historique. |
| 🟡 | **Perishable Turnover** | Rotation des produits périssables (jours moyens en stock) pour réduire le waste. |
| 🟡 | **Table Turnover** | Durée moyenne d'occupation table, taux de rotation — décisif pour la capacité dîner. |
| 🟢 | **Sales By Brand** | Découper le CA par marque pour les rayons multi-marques (placeholder déjà câblé). |
| 🟢 | **Purchase Returns** | Suivre les retours fournisseurs (placeholder déjà câblé). |
| 🟢 | **Outgoing Stocks** | Vue agrégée des sorties (ventes + casse + transferts) — placeholder déjà câblé. |

---

## 16. En une phrase

Le module Reports est **l'instrument de bord** de The Breakery : il transforme l'activité brute en décisions actionnables, sécurise contre les dérives, et donne à un gérant qui dort 6h par nuit la certitude que tout ce qui se passe dans sa boulangerie est mesuré, comparé et exportable — sans qu'il ait à plonger dans la base de données.
