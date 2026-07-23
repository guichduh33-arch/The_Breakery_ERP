# Module Production & Recipes — Objectif métier

> **Statut (2026-07-17)** : cette fiche avait été archivée au profit du module
> de référence `reference/04-modules/15-production-recipes.md` — ce fichier
> n'existe plus dans l'arborescence vivante. Elle redevient donc **la doc
> fonctionnelle du module**, remise à jour le 2026-07-17 pour refléter les
> décisions de l'[ADR-008](../adr/008-production-recettes-arbitrages.md)
> (✅ accepté) : D1 unités des sous-recettes, D2 waste en charge, D3 raisons
> catégorisées, D4 blocage stock insuffisant, D5 profondeur de recette,
> D6 deduct_stock, D7/D8 revert, D9 dette technique.


> **Statut V2/V3** : décrit la vision business cible. **V2 jamais déployée**. Implémentation réelle = V3 monorepo. **Le statut V3 dépasse cette fiche sur plusieurs points** (voir §15 corrigé : sub-recipes, versioning, baker's percentages, yield tracking, margin alerts — tous livrés en V3 S15→S22).
>
> **Périmètre fonctionnel** : ce document décrit **ce que le module Production & Recipes sert à faire au quotidien** pour The Breakery, sans rentrer dans la mécanique technique

---

## 1. Raison d'être

Le module Production & Recipes est **le pétrin numérique** de The Breakery. Il répond à la question fondamentale d'une boulangerie artisanale qui produit elle-même ce qu'elle vend :

> *"Quand le boulanger sort 50 baguettes du four, comment je sais que ça vient bien de m'avoir coûté 12,5 kg de farine, 250 g de sel, 75 g de levure et 7,5 L d'eau — et comment je suis sûr que mon stock matière s'est mis à jour tout seul, sans qu'il ait à le saisir ?"*

C'est le module qui transforme **l'acte artisanal de fabrication** en **flux de données comptables et logistiques** : un lot de production déclaré décrémente automatiquement les ingrédients consommés selon la recette, incrémente le stock produits finis, gère les ratés (waste), trace le batch, calcule le coût matière, et alimente la comptabilité (transfert COGS matières premières → stock produits finis).

Le module est **central à l'identité bakery** de l'app. Pour un restaurant qui revend ce qu'il achète, il n'a aucun sens ; pour une boulangerie qui fabrique 80 % de ce qu'elle vend, il est **la colonne vertébrale** entre les achats matières et les ventes produits finis.

---

## 2. Les 2 dimensions du module

Le module repose sur **deux concepts complémentaires** :

| Concept | Quoi | Quand on l'utilise |
|---|---|---|
| **Recipes** | La nomenclature : "pour produire 1 baguette, il faut X ingrédients" | À la création / modification d'un produit fini — opération rare, stratégique |
| **Production Records** | Les ordres de production : "j'ai produit Y baguettes le 12 mai" | Quotidien — chaque fournée saisie |

Recipes = **le savoir-faire codifié**. Production Records = **l'usage quotidien**.

---

## 3. Les 5 invariants du module

Quelle que soit la situation, le module garantit :

1. **Une recette = des proportions invariantes**. La recette dit "1 baguette = 250 g de farine". Que je produise 1 ou 1000 baguettes, le ratio est fixe.
2. **Conversion d'unités automatique**. La recette peut être en grammes, le stock matière en kilos — le système convertit (`getUnitConversionFactor`). 50 baguettes × 250 g = 12 500 g → −12,5 kg du stock farine. **Exception actée (ADR-008 D1)** : une ligne de recette qui pointe vers un semi-fini (un produit ayant lui-même une recette) doit être saisie dans l'unité de stockage de ce semi-fini — la conversion automatique ne s'applique qu'aux ingrédients « feuilles ».
3. **Production atomique**. Saisir une production déclenche en une transaction : déduction matières, incrémentation produit fini, gestion waste, écriture comptable, mouvements ledger. Tout ou rien.
4. **Waste géré séparément**. Sur 52 baguettes pétries, 50 vont en vente et 2 sont ratées (`quantity_waste`). Les ratés sont déduits du stock matière (la farine a quand même été consommée) mais n'entrent **pas** en stock vendable.
5. **Recettes versionnées dans le temps**. Modifier une recette ne change pas les coûts historiques. Une production passée garde le coût de la recette au moment où elle a été enregistrée.

---

## 4. Les Recipes — Le bill of materials

C'est l'**ADN du produit fini**. Pour chaque produit fini, on définit ses ingrédients :

### 4.1 Structure d'une recette

Une recette est une **liste de lignes**, chacune représentant un ingrédient :

| Champ | Exemple |
|---|---|
| **Product** (produit fini) | Baguette tradition |
| **Material** (matière première) | Farine T65 |
| **Quantity** | 250 |
| **Unit** | g |
| **Is active** | true |

Une baguette tradition aura donc ~4-5 lignes : farine, sel, levure, eau, améliorant.

### 4.2 Là où ça se définit

La recette se gère depuis la **fiche produit** (module Products) dans l'onglet "Recipe" :

- Ajout / retrait de lignes.
- Pour chaque ligne : choisir la matière première (autocomplete sur les produits flaggés `material`), quantité, unité.
- Désactivation d'une ligne sans supprimer (historique préservé).

### 4.3 Cohérence avec le coût

L'onglet Costing du produit utilise la recette pour calculer le **coût matière théorique** :

- Pour chaque ligne : `coût_unitaire_matière × quantité × conversion`.
- Somme = coût matière par unité produite.
- Comparé au prix de vente → marge brute théorique du produit.

Bénéfice métier : **chaque produit a sa fiche technique** et son coût matière calculé en direct. Quand la farine augmente de 10 %, l'app montre que le coût de la baguette monte de 5 % et que la marge baisse — décision pricing immédiate.

---

## 5. Les Production Records — Le quotidien du fournil

C'est l'**acte de production** : "j'ai fabriqué X unités de tel produit aujourd'hui dans telle section".

### 5.1 La saisie

Page `StockProductionPage` — pensée pour le boulanger ou le chef de production qui saisit en fin de service ou en début d'après-midi :

- **Sélection de la date** (par défaut : aujourd'hui).
- **Sélection de la section** (cuisine principale, four pâtisserie, atelier chocolat…).
- **Ajout des produits produits** ligne par ligne :
  - Produit fini (autocomplete).
  - Quantité produite.
  - Unité (modifiable, conversion auto).
  - Quantité waste (les ratés non vendables).
  - Raison du waste (mal cuit, mal levé, brûlé, esthétique…).
- **Estimation completion time** (optionnel — heure prévue de sortie pour piloter le service).
- **Save** → toute la chaîne se déclenche.

### 5.2 La chaîne déclenchée

À la validation, la RPC `record_production_v1` (V3 — la fiche datait de la
mutation client V2) exécute :

1. Insertion d'un `production_records` avec `production_id` séquentiel.
2. Lookup de la recette du produit fini.
3. Pour chaque ligne de recette :
   - Conversion d'unité si recette en g et matière stockée en kg.
   - Calcul de la quantité consommée = `recette_qty × conversion × (quantity_produced + quantity_waste)`.
   - Création d'un mouvement `ingredient` qui débite le stock matière.
4. Création d'un mouvement `production_in` qui crédite le stock produit fini de `quantity_produced` (sans le waste).
5. Création d'un mouvement `production_waste` si `quantity_waste > 0`.
6. Trigger Postgres → écriture comptable de transfert (DR Finished Goods Inventory / CR Raw Materials Inventory).

Bénéfice métier : **un seul geste utilisateur, toute la mécanique** se déroule. Le boulanger saisit "50 baguettes, 2 ratées" et 7 mouvements de stock + 1 écriture compta sont créés.

---

## 6. La gestion des ratés (waste)

Spécificité métier : dans une boulangerie, **le rebut fait partie du métier**. Une fournée mal levée, un croissant brûlé, une tarte écrasée — c'est du quotidien.

Le module distingue :

| Type | Sort |
|---|---|
| **quantity_produced** | Stock produit fini, vendable |
| **quantity_waste** | Sortie matière effective (le pain *a* été pétri) mais pas de stock vendable |

Chaque waste est saisi avec une **raison catégorisée** (mal cuit, mal levé, esthétique, démonstration, test recette, dégustation client) → alimente le report `production_efficiency` qui suit le taux de waste par produit dans le temps. **Acté (ADR-008 D3)** : la raison devient un enum Postgres + menu déroulant dans l'UI (aujourd'hui : notes libres — chantier à lancer). **Acté aussi (ADR-008 D2)** : le coût de la part ratée passe en charge comptable (Dr Waste Expense) au lieu d'être absorbé dans le coût du stock produits finis.

Bénéfice métier : **chiffrer le coût des ratés** sans culpabiliser l'artisan. Le boulanger déclare ses 2 baguettes ratées, le système calcule que ça représente 4 % de waste sur la fournée et 12 000 IDR de matière perdue. Sur un mois c'est 360 000 IDR — assez pour justifier une formation ou un ajustement de recette.

---

## 7. L'historique de production

`ProductionHistory` (panneau dans `StockProductionPage`) affiche les **productions du jour** déjà enregistrées :

- Liste des productions saisies aujourd'hui.
- Pour chaque entrée : produit, quantité produite, quantité waste, staff, heure.
- **Suppression** possible dans une fenêtre de 24 h, protégée par la permission `inventory.production.delete` (ADMIN et plus) — **pas de PIN manager**, acté ADR-008 D8. Le revert est **refusé si le lot a déjà bougé** depuis la production (vente, transfert…) — acté ADR-008 D7 ; le correctif passe alors par un inventaire ou un ajustement.
- **Navigation par date** : revenir au passé pour consulter les fournées des jours précédents.

Bénéfice métier : **la mémoire de la production**. Le manager voit en début d'après-midi qu'il y a déjà 80 baguettes saisies ce matin, donc inutile d'en relancer.

---

## 8. Les suggestions de production

Une vue dédiée (intégrée au panneau Alertes du module Inventory) propose des **recommandations de production** :

- Pour chaque produit fini : `vitesse_vente_jour × jours_couvrir − stock_courant`.
- Si positif → suggestion de production.
- Quantité suggérée arrondie au pas standard (douzaines pour viennoiseries, par 10 pour pains…).
- Filtrage par produits avec recette active uniquement.

Cas d'usage : "Vous vendez en moyenne 60 croissants par jour, vous en avez 8 en stock, il faut en relancer 100 pour couvrir 2 jours."

Bénéfice métier : **passer du push au pull**. Le boulanger n'attend plus qu'on lui demande — l'app pousse la liste des produits à relancer chaque matin.

---

## 9. Le `ProductionSummary` — Le récap du jour

Au-dessus de la saisie, un panneau récap synthétise :

- **Total produced** sur la journée.
- **Total waste** sur la journée + taux de waste (%).
- **Nombre de produits différents** mis en production.
- **Section active** pour la saisie courante.

Bénéfice métier : **dashboard production permanent**. Le chef voit en direct sa performance de la journée.

---

## 10. La conversion d'unités — La mécanique invisible

Spécificité technique avec impact métier énorme : le module gère **les conversions d'unités** entre la recette et le stock.

### 10.1 Pourquoi

- La **recette** s'écrit naturellement en grammes (gramme par baguette).
- Le **stock matière** est suivi en kilos (la farine s'achète au sac de 25 kg).
- Sans conversion, on aurait un produit fini défini en "250 g de farine" et un stock de "100 kg de farine" → impossible à comparer.

### 10.2 Comment

La fonction `getUnitConversionFactor(recipeUnit, materialUnit)` gère les paires :

- `g ↔ kg` (×0,001 / ×1000).
- `mL ↔ L` (×0,001 / ×1000).
- `pcs ↔ pcs` (×1).
- Conversions personnalisées par produit (si nécessaire).

À chaque saisie de production, le système applique la conversion **silencieusement** avant de débiter le stock.

Bénéfice métier : **liberté de définir la recette dans l'unité naturelle** (gramme pour la pâtisserie, mL pour les liquides) sans devoir tout aligner à la main. Le système traduit.

---

## 11. Les productions infaisables — L'alerte préventive

Avant de valider une saisie de production, le système peut **alerter** si une recette est infaisable :

- Calcul à blanc des consommations attendues.
- Vérification que chaque matière a un stock suffisant.
- Si insuffisant → alerte visuelle avec le détail "il manque 2,5 kg de farine et 50 g de levure pour produire les 100 baguettes prévues".
- **Acté (ADR-008 D4)** : le blocage est le comportement **par défaut**. Forcer la production malgré un stock insuffisant est un acte explicite — réglage global assumé ou forçage protégé par une permission dédiée, avec avertissement.

Bénéfice métier : **avant de pétrir, le système sait si on peut pétrir**. Évite de découvrir en pleine production qu'il manque un ingrédient.

---

## 12. Le couplage comptable

Chaque production génère **automatiquement** une écriture journal :

| Mouvement | Compte débit | Compte crédit |
|---|---|---|
| Sortie matières premières (recipe-based) | — | 1310 Raw Materials Inventory |
| Entrée produits finis | 1320 Finished Goods Inventory | — |
| Waste | 5210 Production Waste Expense | 1320 Finished Goods (si waste post-prod) |

Le solde net : **le coût matière sort du stock matières premières, entre dans le stock produits finis** (sauf la partie waste qui passe directement en charge). Quand le produit fini sera vendu, le coût matière sera transféré du stock vers le COGS via le trigger de vente.

Bénéfice métier : **traçabilité comptable de la valeur ajoutée** par l'atelier. La marge brute des produits finis est calculable au gramme près.

---

## 13. Couplage avec le module Inventory

Le module Production **n'est pas autonome** — il s'appuie sur Inventory pour tout ce qui concerne le stock :

- **Stock matières premières** : lu pour vérifier la faisabilité, débité à chaque production.
- **Stock produits finis** : crédité à chaque production.
- **Ledger des mouvements** : chaque production génère plusieurs mouvements typés (`ingredient`, `production_in`, `production_waste`).
- **Sections** : la production se fait dans une section spécifique (cuisine, four, atelier) — référencée dans `production_records`.

Réciproquement, le module Inventory **utilise** Production :

- Le dashboard produit affiche la recette si applicable.
- Les suggestions de réapprovisionnement matières sont calculées d'après les recettes des produits finis à produire.
- Le coût matière dans le dashboard produit vient des recettes.

---

## 14. Mécaniques transverses — Comment le module dialogue avec le reste

| Module | Relation |
|---|---|
| **Products** | Onglet Recipe sur chaque fiche produit fini. Onglet Costing utilise la recette. |
| **Inventory** | Toutes les consommations / créations passent par le ledger inventory. |
| **Reports** | `production_report`, `production_efficiency`, `cogs_production` sont alimentés ici. |
| **Accounting** | Écritures de transfert raw materials → finished goods + waste expense. |
| **Settings** | Sections de production, unités par défaut, seuil d'alerte waste configurables. |
| **POS** | Quand un produit fini est vendu, le stock produit fini créé ici est décrémenté. |
| **Purchasing** | Les matières premières achetées via PO alimentent le stock utilisé ici. |

---

## 15. Ce que le module ne fait **pas** (par design) — **MISE À JOUR V3**

> ⚠️ **V3 dépasse plusieurs limites listées historiquement** (V2 cible). Items corrigés ci-dessous.

- Le module **ne planifie pas la production** automatiquement — V3 a livré `suggest_production_schedule_v1` et `production_schedules` (S19). ✅ DÉPASSÉ V3.
- Le module **ne suit pas le temps de pétrissage / cuisson** au four. Pas de minuteur intégré, pas de capteur IoT. *(Toujours vrai V3)*
- ~~Le module **ne supporte pas les sous-recettes**~~ → **V3 supporte les sous-recettes** avec anti-cycle 5-niveaux (`validate_recipe_no_cycle`, `recipe_bom_full_v1`, `tr_recompute_is_semi_finished`, `record_batch_production_v1`). ✅ LIVRÉ V3 S15+S17+S19+S21.
- ~~Le module **ne fait pas de versioning explicite** des recettes~~ → **V3 livre `recipe_versions` + snapshot avec cost** (`snapshot_recipe_version_helper`, `tr_snapshot_on_product_cost_change`, `bump_recipe_version_snapshot_with_cost`). ✅ LIVRÉ V3 S20+S21.
- Le module **n'intègre pas d'allergènes** structurés (gluten, lactose, fruits à coque). Les notes libres s'en chargent. *(Acté définitif 2026-07-22 : la feature allergènes catalogue a été entièrement supprimée — ADR-011 §2, PR #251. Plus un backlog : wontfix.)*
- ~~Le module **ne supporte pas les recettes en pourcentage de boulanger**~~ → **V3 supporte les baker's percentages** (`extend_recipes_baker_percentage`, `bump_upsert_recipe_v1_baker`). ✅ LIVRÉ V3 S19.
- Le module **refuse une recette de plus de 5 niveaux d'imbrication** : au-delà, la production échoue avec une erreur franche au lieu de consommer partiellement en silence. *(Acté ADR-008 D5.)*
- Le module **refuse de produire un produit marqué « ne suit pas le stock »** (`deduct_stock = false`) — produire sans consommer de matières n'a pas de sens métier. *(Acté ADR-008 D6.)*

---

## 16. Ce que le module doit (encore) faire — backlog métier

| Priorité | Évolution | Bénéfice attendu |
|---|---|---|
| ✅ | ~~**Sous-recettes / semi-finis**~~ | Livré V3 (S15→S21) — pâte feuilletée comme semi-fini consommé par plusieurs produits. |
| ✅ | ~~**Versioning explicite des recettes**~~ | Livré V3 (S20+S21) — `recipe_versions` + snapshot avec coût. |
| ✅ | ~~**Boulanger's percentages**~~ | Livré V3 (S19). |
| ✅ | ~~**Allergènes structurés**~~ | Livré — propagation par recettes (`view_product_allergens_resolved`), affichés BO et POS. |
| 🔴 | **Chantiers ADR-008** : D1 unités sous-recettes, D2 waste en charge, D3 enum raisons, D4 blocage stock, D5 erreur profondeur, D6 deduct_stock, D7 garde+refactor revert, D9 dette technique | Corriger les huit écarts constatés par l'audit du 2026-07-17. |
| 🟠 | **Plan de production hebdomadaire** | Définir un planning type "lundi: 100 baguettes, 50 viennoiseries…" et l'instancier en 1 clic chaque semaine. |
| 🟡 | **Mode mobile saisie** | Le boulanger en cuisine saisit sur tablette / téléphone sans devoir aller au PC. |
| 🟡 | **Intégration IoT four** | Sondes connectées qui auto-déclenchent une production à la sortie du four. |
| 🟢 | **Coût-marge en temps réel par recette** | Alerte automatique quand un changement de prix matière fait passer une recette sous le seuil de marge cible. |
| 🟢 | **Yield calculator** | "Si je veux servir 80 couverts demain, combien je produis de quoi ?" Recommandation basée sur historique. |

---

## 17. En une phrase

Le module Production & Recipes est **le pétrin numérique** de The Breakery : il transforme un acte artisanal — sortir 50 baguettes du four — en cascade comptable et logistique propre, déduit automatiquement les ingrédients selon la recette avec conversion d'unités, traite les ratés sans culpabilité, alerte si une recette est infaisable avant pétrissage, et donne au gérant le coût matière réel de chaque produit au gramme près — pour que la magie du boulanger devienne un actif chiffré sans qu'il ait à toucher un tableur.
