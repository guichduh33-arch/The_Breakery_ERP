# Module Orders — Objectif métier

> 🗄️ **ARCHIVED / SUPERSEDED (2026-06-04).** This legacy V2 "Objectif métier" brief was folded verbatim into **Partie I — Vue fonctionnelle** of the canonical reference module [`reference/04-modules/02b-orders.md`](../../reference/04-modules/02b-orders.md) (2026-05-13). The reference is the source of truth; this file is kept for history only.


> **Statut V2/V3** : décrit la vision business cible. **V2 jamais déployée**. Implémentation réelle = V3 monorepo (`apps/backoffice`). Voir [`../V2_V3_GLOSSARY.md`](../../V2_V3_GLOSSARY.md) pour les mappings.
>
> **Périmètre fonctionnel** : ce document décrit **ce que la page Orders (`/orders`) sert à faire au quotidien** pour The Breakery, .

---

## 1. Raison d'être

La page Orders est le **tableau de bord opérationnel des commandes** de The Breakery. Elle répond à une question simple mais constante dans le quotidien d'un gérant ou d'un manager de salle :

> *"Qu'est-ce qui se passe en ce moment dans la boutique ? Quelles commandes sont en cours, lesquelles attendent un paiement, lesquelles sortent de la cuisine, qu'est-ce qu'on a vendu aujourd'hui ?"*

C'est l'écran qui transforme **un flux de tickets caisse anonymes** en **un panorama lisible et actionnable** : par statut, par type, par paiement, par client. Sans lui, le gérant doit aller voir la cuisine *et* la caisse *et* le KDS pour reconstituer mentalement l'activité ; avec lui, il a en une page la même information consolidée.

La page est à mi-chemin entre **opérationnel** (suivi temps réel des commandes en cours) et **historique** (consultation des ventes du jour, de la semaine, du mois). Le même écran sert au manager qui supervise le rush et au gérant qui clôture sa journée.

---

## 2. Les 4 sections de la page

La page est structurée en **4 blocs verticaux** lus de haut en bas :

| Section | Job-to-be-done |
|---|---|
| **Header** | Indicateur d'activité Realtime, bouton refresh, accès rapide aux actions |
| **Stats** | 5 KPI cards : total commandes, montant total, taux de complétion, payées vs impayées |
| **Filters** | Filtres status, type, payment, search, date range |
| **Table** | Liste des commandes paginées, clic pour ouvrir le détail |

Une **modale de détail** se superpose à la liste quand on clique sur une commande, sans changer de page.

---

## 3. Les 5 invariants de la page

Quel que soit le contexte d'utilisation, la page garantit toujours les mêmes mécaniques :

1. **Mise à jour temps réel**. La page s'auto-rafraîchit via un listener sur les changements KDS (`useKdsStatusListener`) et joue un **son** quand une commande passe en `ready` cuisine — le manager n'a pas besoin de cliquer "Refresh" pour voir l'état actuel.
2. **Pagination défensive**. Maximum 500 commandes chargées par requête (limite serveur), avec pagination cliente — la page reste rapide même un samedi à 18h.
3. **Filtre par défaut : aujourd'hui**. À l'ouverture, la page n'affiche que les commandes du jour — c'est 95 % du cas d'usage et ça évite de noyer l'utilisateur dans l'historique.
4. **Une seule source de vérité**. Les statuts affichés (`status`, `payment_status`, `item_status`) sont ceux de la base — pas de cache local divergent. Une commande payée à la caisse apparaît payée sur la page Orders à la seconde suivante.
5. **Read-mostly**. La page est principalement de la consultation. Les actions destructives (annulation, refund, modification) passent par la modale détail et exigent un PIN manager — pas de bouton "delete" sur la ligne.

---

## 4. Le Header — La barre d'orientation

En haut de page, une bande compacte qui sert de **repère permanent** :

- Titre "Orders" + badge "Live" indiquant que Realtime est connecté.
- Compteur de commandes affichées (sur les 500 maximum).
- Bouton **Refresh** manuel (en cas de doute sur le Realtime).
- Indicateur de chargement (`isFetching`) discret pendant les requêtes.
- Bouton secondaire pour exporter la sélection en CSV (utile pour le comptable).

Bénéfice métier : **savoir tout de suite si la page est synchronisée avec la réalité**. Le badge "Live" actif rassure le gérant que ce qu'il voit est ce qui se passe.

---

## 5. Les Stats — 5 KPI lus en 3 secondes

Une rangée de cartes condensées affiche les **chiffres clés du périmètre filtré** :

| KPI | Définition | À quoi ça sert |
|---|---|---|
| **Total** | Nombre de commandes dans le périmètre filtré | Volume brut du jour / de la période |
| **Total Amount** | Somme du `total` (taxe PB1 10% incluse) | Chiffre d'affaires brut |
| **Completion Rate** | Pourcentage de commandes en statut `completed` ou `paid` | Santé du flux opérationnel — si <80 %, c'est qu'il y a un blocage |
| **Paid count + amount** | Combien de commandes encaissées et combien d'argent rentré | Trésorerie réalisée |
| **Unpaid count + amount** | Combien de commandes pas encore payées et combien d'argent en attente | Encours du jour (ardoises, B2B différé, en cours d'encaissement) |

Les chiffres se **recalculent à la volée** dès qu'on change un filtre. Changer la date → les KPI suivent.

Bénéfice métier : **transformer 200 lignes de commandes en 5 chiffres parlants**. Le gérant qui ouvre la page à 14h sait en 3 secondes que sa matinée a fait 4,5M IDR sur 80 tickets dont 12 encore à encaisser.

---

## 6. Les Filters — Le pivot par axe d'analyse

Une rangée de filtres permet de croiser les axes d'analyse :

### 6.1 Status

Filtrer par statut de commande. Les statuts disponibles :

| Statut | Signification métier |
|---|---|
| **All** | Tout afficher |
| **Pending** | Créée mais pas encore en cuisine (rare, transitoire) |
| **Preparing** | En cours de préparation cuisine / KDS |
| **Ready** | Prête à être servie / remise au client |
| **Completed** | Servie et payée — vie de la commande terminée |
| **Voided** | Annulée (par manager, PIN exigé) |
| **Refunded** | Remboursée |

Bénéfice : **filtrer instantanément** ce qui demande une action (Preparing, Ready) vs ce qui est consultable (Completed).

### 6.2 Order Type

Filtrer par type de commande :

- **Dine-in** — service en salle, payée souvent en fin de repas.
- **Takeaway** — emporter, payée d'avance.
- **Delivery** — livraison.
- **B2B** — commande wholesale liée au module B2B.

Bénéfice : isoler les flux selon la logique de paiement (en différé pour le dine-in, immédiat pour le takeaway).

### 6.3 Payment Status

- **All** / **Paid** / **Unpaid** / **Partial**.

Bénéfice : retrouver les **ardoises et impayés** d'un coup, indépendamment du statut opérationnel.

### 6.4 Search

Recherche libre sur :

- Numéro de commande (`order_number`).
- Nom du client (`customer_name`).
- Numéro de table (`table_number`).

Bénéfice : **retrouver une commande spécifique en 5 secondes** quand un client se présente avec son ticket ("j'ai commandé tout à l'heure sous le nom de Maya").

### 6.5 Date Range

Plage de dates `from` / `to`, par défaut "today only".

Bénéfice : **basculer entre temps réel** (aujourd'hui) **et historique** (semaine, mois) sur le même écran, sans changer de page.

---

## 7. La Table — La liste actionnable

La table affiche une **ligne par commande** avec les colonnes les plus utiles :

- **Order #** — numéro de commande (cliquable).
- **Heure** — heure de création.
- **Type** — badge dine-in / takeaway / delivery / B2B.
- **Table / Client** — si dine-in, numéro de table ; sinon nom client.
- **Items count** — nombre d'items dans la commande.
- **Total** — montant total tax incluse, formaté IDR.
- **Status** — badge coloré.
- **Payment** — badge paid / unpaid / partial.
- **Actions** — bouton "Voir détail" (ouvre la modale).

Comportements :

- **Tri** par date décroissante (la plus récente en haut) par défaut.
- **Pagination** côté client (page taille configurée dans `ITEMS_PER_PAGE`).
- **Clic ligne** → ouvre la modale détail.
- **Coloration douce** des lignes selon le statut (subtile, pour ne pas saturer l'œil).

Bénéfice métier : **scroller un service entier en quelques secondes**, repérer l'anormal (une commande à 1M IDR sortant du gabarit, un dine-in encore impayé deux heures après) et plonger dans le détail au clic.

---

## 8. La modale de détail — La vue 360° d'une commande

Au clic sur une ligne, une modale s'ouvre **par-dessus la liste** sans navigation, et affiche toutes les informations d'une commande :

### 8.1 Bloc Header

- Numéro, type, statut, statut paiement.
- Heure de création, heure de complétion.
- Table / client / nom personnalisé.

### 8.2 Bloc Items

Liste détaillée des items :

- Nom du produit, quantité, prix unitaire.
- **Modifiers** appliqués (sucre +, lait d'amande, sans glace…) avec leur surcoût.
- **Item status** indépendant par item : `pending`, `preparing`, `ready`, `served`, `cancelled`.
- **Dispatch station** : à quelle station KDS l'item est routé (boissons, cuisine chaude, pâtisserie…).

C'est crucial pour une commande dine-in où une partie peut être servie pendant que l'autre est encore en cuisine.

### 8.3 Bloc Financial

- Subtotal.
- Discount appliqué.
- Service charge (si applicable).
- Tax PB1 (10% inclus, calculée comme `total × 10/110`).
- Total.
- Méthode de paiement, cash reçu, monnaie rendue.

### 8.4 Bloc Actions

Selon le statut et les permissions :

- **Imprimer reçu** (re-print depuis le journal).
- **Imprimer ticket cuisine** (re-print kitchen ticket).
- **Annuler la commande** (exige PIN manager + raison obligatoire).
- **Refund partiel ou total** (exige PIN manager + raison).
- **Marquer payée** (pour les ardoises encaissées plus tard).
- **Modifier le client** (rattacher une commande anonyme à un client après coup).

Toutes ces actions sont **tracées dans l'audit log** avec qui-quoi-quand.

Bénéfice métier : **résoudre 95 % des situations de comptoir sans changer d'écran**. Un client revient pour un remboursement → retrouver la commande, vérifier les items, traiter le refund en moins de 30 secondes.

---

## 9. Les statuts item-level — La granularité cuisine

Spécificité du module : une commande n'a pas un seul statut, elle en a deux niveaux :

- **Order status** — état global de la commande (pending / preparing / ready / completed).
- **Item status** par ligne — état individuel de chaque item (pending / preparing / ready / served / cancelled).

Pourquoi : un cappuccino sort de la machine en 1 minute, un croque-monsieur prend 8 minutes au four. Tracer un seul statut sur la commande masquerait que le client peut déjà avoir son café devant lui pendant qu'il attend son sandwich.

Avantage métier :

- Le serveur sait quoi apporter à quel moment.
- Le client a la moitié de sa commande tout de suite (perception de service rapide).
- Le KDS reflète la réalité granulaire de la cuisine.

La page Orders **affiche ces statuts dans la modale détail** mais ne les agrège pas dans le statut commande — la commande passe à `ready` quand **tous** ses items sont `ready`.

---

## 10. Le couplage avec le KDS — Le son et la mise à jour

Le hook `useKdsStatusListener` écoute en permanence les changements de statut KDS et déclenche :

- Un **rafraîchissement automatique** de la liste (invalidation de la query React Query).
- Un **bip sonore** (`playOrderReadySound`) quand un item passe en `ready` cuisine — le manager entend l'événement même s'il regarde un autre écran.

Configurable : le son peut être désactivé dans Settings → POS Configuration (toggle "Sound notifications").

Bénéfice métier : **le manager n'a pas besoin de fixer la page**. Il vaque à ses tâches, et le bip le ramène à la page Orders quand quelque chose change.

---

## 11. Le rapport avec les autres modules

| Module | Relation |
|---|---|
| **POS** | Les commandes affichées sont créées au POS — la page Orders en est la **vue d'inspection**, jamais la création. |
| **KDS** | Les changements de statut KDS se propagent en direct à la page Orders. |
| **B2B** | Les commandes B2B sont visibles ici avec le type `b2b` ; mais leur cycle complet (livraisons, paiements échelonnés) se gère dans le module B2B. |
| **Customers** | Une commande est rattachable à un client → la page Orders permet de **lier après coup** une commande anonyme à un client (pour fidélité). |
| **Accounting** | Une commande `completed` + `paid` déclenche automatiquement les écritures journal (revenu, taxe PB1, encaissement). |
| **Reports** | Les reports ventes consomment la même table `orders` que la page Orders — mais avec une vue agrégée (KPI, graphique) plutôt que la liste détaillée. |

---

## 12. Mécaniques transverses — Comment la page se comporte

### 12.1 Limites de performance

- Maximum **500 commandes** par requête. Au-delà, la pagination serveur prend le relais.
- Pagination cliente sur la sélection retournée pour la fluidité du scroll.
- Date range par défaut "aujourd'hui" pour ne pas tirer 30 jours de données inutilement.

### 12.2 Erreurs et recovery

- Erreurs Supabase logguées via `logError` + remontées dans Sentry (`@sentry/react`).
- En cas d'erreur de chargement, la page affiche un message + le bouton Refresh — pas de page blanche.
- Si Realtime se déconnecte, le badge "Live" s'éteint — l'utilisateur peut continuer à utiliser la page en mode "manuel" avec le bouton Refresh.

### 12.3 Permissions

- Accès via `sales.view` (lecture).
- Action "Annuler" exige `sales.void` **et** PIN manager.
- Action "Refund" exige `sales.refund` **et** PIN manager.
- Export CSV exige `reports.sales`.

---

## 13. Ce que la page ne fait **pas** (par design)

- La page **ne crée pas de commande**. La création se fait au POS, jamais ici.
- La page **ne modifie pas les items** d'une commande (ajouter / retirer un produit). Pour ajouter un item, il faut retourner au POS sur la commande ouverte.
- La page **n'imprime pas en masse**. L'impression est ticket par ticket via la modale.
- La page **ne fait pas d'analytics avancée**. Pas de graphique, pas de comparaison période — c'est le rôle du module Reports.
- La page **ne change pas l'item status en direct**. Le KDS est la seule interface qui pilote `item_status` côté cuisine.
- La page **ne supporte pas l'export PDF**. CSV uniquement (PDF est dans Reports avec mise en forme).

---

## 14. Ce que la page doit (encore) faire — backlog métier

| Priorité | Évolution | Bénéfice attendu |
|---|---|---|
| 🔴 | **Filtre par cashier / serveur** | Voir d'un coup toutes les commandes d'un staff (audit, performance). |
| 🔴 | **Bulk actions** | Marquer payées plusieurs commandes d'un coup (utile pour solder des ardoises de groupe). |
| 🟠 | **Heatmap visuelle des commandes en cours** | Vue compacte montrant l'âge de chaque commande (vert / orange / rouge selon attente). |
| 🟠 | **Filtre rapide "Mes commandes"** | Pour un serveur, ne voir que les commandes qu'il a saisies. |
| 🟠 | **Notification toast riche** | À chaque commande qui passe en `ready`, afficher un toast cliquable qui ouvre la modale détail. |
| 🟡 | **Édition de la commande après coup** | Ajouter / retirer un item avec PIN manager + audit, sans devoir voider et recréer. |
| 🟡 | **Vue calendrier des commandes différées** | Pour les pré-commandes / réservations, voir le planning visuel des prochains jours. |
| 🟢 | **Export PDF par commande** | Re-générer le ticket en PDF pour envoi par e-mail au client. |
| 🟢 | **Lien direct vers le KDS** | Un bouton "voir au KDS" qui ouvre la station correspondante avec l'item surligné. |

---

## 15. En une phrase

La page Orders est **la tour de contrôle des commandes** de The Breakery : elle transforme le flux brut des tickets caisse en panorama filtrable et temps réel, joue un son quand une commande sort de cuisine, donne au manager les 5 KPI qui décrivent l'état de son service, et permet de traiter en 30 secondes les 95 % d'incidents de comptoir (refund, annulation, retrouvaille d'un ticket) — pour qu'aucune commande ne passe entre les mailles entre la cuisine, la caisse et le client.
