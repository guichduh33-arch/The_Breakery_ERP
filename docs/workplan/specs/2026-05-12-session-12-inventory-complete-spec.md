# The Breakery — Session 12 Spec : Inventory **Complete** (les 7 onglets + Dashboard + Alertes)

> **Trace historique** : ce fichier documente une session de travail datée. Le fond reste l'enregistrement de cette date. Seules les références de chemin ont été alignées sur la nouvelle structure (voir [`../../README.md`](../../README.md)).
> **Last refreshed** : 2026-05-13

> **Module concerné** : ce spec correspond au module [Inventory & Stock](../../reference/04-modules/06-inventory-stock.md). Pour la spec consolidée actuelle (Partie I fonctionnel + Partie II technique + Partie III backlog + Partie IV design), aller à la référence canonique.

> **Date** : 2026-05-12
> **Auteur** : guichduh33@gmail.com
> **Statut** : Approuvé pour décomposition en sous-phases (executing-plans / subagent-driven-development)
> **Remplace** : [`./2026-05-11-session-12-inventory-mvp-spec.md`](./2026-05-11-session-12-inventory-mvp-spec.md) (MVP — couverture ~15% de l'objectif métier)
> **Source d'objectifs** : [référence Inventory & Stock](../../reference/04-modules/06-inventory-stock.md) — Partie I §1-20 (vue fonctionnelle)
> **Cible** : Livrer le module Inventory **complet** tel que décrit dans la référence (Partie I §1-20) — les 7 onglets (Stock, Incoming, Transfers, Wastage, Production, Opname, Movements) + Dashboard produit analytique + Panneau d'alertes + Sections / Locations + couplage comptable automatique. Exécution prévue en **8 sous-phases** ; cf. [`../plans/2026-05-12-session-12-inventory-complete-INDEX.md`](../plans/2026-05-12-session-12-inventory-complete-INDEX.md).
> **Backlog opérationnel** : [`../backlog-by-module/06-inventory-stock.md`](../backlog-by-module/06-inventory-stock.md).

---

## 0. Contexte & gap

Le pipeline POS écrit déjà `stock_movements` automatiquement à chaque vente / void / refund (`complete_order_with_payment` v8 ; `void_order_rpc` ; `refund_order_rpc`). La table `stock_movements` existe depuis session 1 (`20260503000004_init_inventory.sql`) avec un enum `movement_type` couvrant `sale`, `sale_void`, `production`, `purchase`, `waste`, `adjustment`. Le cache `products.current_stock` est synchronisé inline.

Le **MVP session 12** précédent ne couvrait que la couche admin minimale (adjust / receive flat / waste + page list). Il manquait :

- L'onglet **Transfers** (déplacement inter-sections avec cycle de vie draft/pending/in_transit/received/cancelled).
- L'onglet **Production** (recettes / BOM, déduction automatique des ingrédients, COGS production, suggestions de production).
- L'onglet **Opname** (sessions de comptage physique avec écarts, validation manager).
- Le modèle physique **Sections / Locations** (warehouse, kitchen, sales).
- Le **Dashboard produit** analytique (timeline, breakdown, recipe usage, purchase trend).
- Le **panneau d'alertes** (Low Stock + Reorder Suggestions + Production Suggestions).
- Le couplage **comptable automatique** pour production / wastage / opname (JE générés par triggers ou wrappers).
- Les **mouvements `transfer` / `production_in` / `production_out`** dans l'enum.
- La **conversion d'unités** (kg ↔ g, L ↔ mL).

Cette session livre tout ce périmètre, en réutilisant le squelette MVP comme fondation Phase 1 / 2.

---

## 1. Décisions actées

| # | Décision | Choix |
|---|---|---|
| **C1** | Source de vérité | `stock_movements` reste l'append-only ledger signé. `products.current_stock` reste un cache mais il est **dénormalisé par section** via la nouvelle table `section_stock` (Phase 4). La lecture autoritaire pour reporting passe par `SUM(stock_movements.quantity)` filtré par produit (et optionnellement section). |
| **C2** | Modèle physique | Introduction des tables `sections` (5 seedées : Main Warehouse, Production Kitchen, Pastry, Cafe Storage, Front Sales) et `stock_locations` (hiérarchique, optionnel, sous une section). Les `stock_movements` reçoivent `from_section_id` / `to_section_id` (NULL pour origines abstraites comme `purchase`). |
| **C3** | Extension de l'enum `movement_type` | Ajout de **`transfer_in`**, **`transfer_out`**, **`production_in`**, **`production_out`**, **`adjustment_in`**, **`adjustment_out`**, **`opname_in`**, **`opname_out`**, **`incoming`**, **`reservation_hold`** (B2B futur — non utilisé MVP), **`reservation_release`**. L'enum `adjustment` (sans direction) est conservé pour rétro-compatibilité MVP mais déprécié — nouvelles RPCs émettent `adjustment_in` / `adjustment_out`. |
| **C4** | Conversion d'unités | Nouvelle table `unit_conversions(from_unit, to_unit, factor)` seedée avec les 12 paires de base (kg↔g, L↔mL, etc.) + helper SQL `convert_quantity(qty, from_unit, to_unit)`. Helper TS jumeau dans `packages/utils/src/units/`. Toute insertion `stock_movements` exige `unit` cohérente avec `products.unit` ou conversion appliquée en amont. |
| **C5** | RPC versioning | Tous nouveaux RPCs `_v1` (sauf extension d'un RPC déjà en `_v8` qui passe en `_v9`). Migration séparée par RPC. |
| **C6** | Idempotency | Toutes les RPCs admin (`adjust`, `receive`, `waste`, `transfer_*`, `production_*`, `opname_*`) acceptent `p_idempotency_key UUID` ; replay → renvoie le résultat existant sans doublonner le mouvement. |
| **C7** | RLS lockdown | `ENABLE ROW LEVEL SECURITY` sur **toutes** les tables inventory. SELECT perm-gated, INSERT/UPDATE/DELETE révoqués → SECURITY DEFINER RPCs uniquement. `stock_movements` reste **append-only** (aucune policy UPDATE/DELETE). |
| **C8** | RBAC étendu | Permissions seedées : `inventory.read` (MANAGER+), `inventory.adjust` (ADMIN+ — création de stock sans paper trail), `inventory.receive` (MANAGER+), `inventory.waste` (MANAGER+), `inventory.transfer.create` (MANAGER+), `inventory.transfer.receive` (MANAGER+), `inventory.opname.create` (MANAGER+), `inventory.opname.finalize` (ADMIN+ — verrouille les écarts), `inventory.production.create` (MANAGER+), `inventory.production.delete` (ADMIN+ — réversion stock), `inventory.recipes.update` (ADMIN+), `inventory.sections.update` (ADMIN+). 12 perms total. |
| **C9** | Concurrency | `SELECT ... FOR UPDATE` sur `products` dans toutes les RPCs admin (cohérent avec `complete_order` v8). Pour les transferts → lock pessimiste sur la row `internal_transfers` via `.in('status', ['pending', 'in_transit'])` côté hook (pattern V2 reference). |
| **C10** | Couplage comptable | Triggers `create_stock_movement_journal_entry()` génèrent les JE pour : `waste` (Dr COGS Waste / Cr Inventory), `adjustment_in` (Cr Stock Adjustment Income / Dr Inventory), `adjustment_out` (Dr Stock Adjustment Expense / Cr Inventory), `opname_*` (idem adjustment), `production_in` + `production_out` regroupés (Dr COGS Production / Cr Inventory matières premières). `transfer_in/out` n'émettent **AUCUN** JE (mouvement neutre intra-entreprise). `purchase` continue d'émettre via le trigger `create_purchase_journal_entry` (cf. spec Purchasing). |
| **C11** | Trigger fiscal period | Tout trigger JE check `check_fiscal_period_open(NOW()::DATE)` ; refuse l'opération si la période est `closed` ou `locked` (raise `period_locked` P0004). |
| **C12** | Recipes / BOM | Nouvelle table `recipes(product_id, material_id, quantity, unit, is_active)`. Une recette = N lignes. Production = `production_records` (header) + déduction auto via `record_production_v1` qui consomme `recipes` et émet `production_out` pour chaque ingrédient + `production_in` pour le produit fini. Conversion d'unité appliquée. Récursion semi-finis **pas supportée** (limite V2 reportée — produire d'abord les semi-finis). |
| **C13** | Opname | Nouvelles tables `inventory_counts(id, section_id, status, started_by, finalized_by, finalized_at)` + `inventory_count_items(count_id, product_id, expected_qty, counted_qty, variance)`. Cycle `draft → in_progress → finalized → validated`. Finalisation génère `adjustment_in` / `adjustment_out` en batch. Validation manager verrouille définitivement. |
| **C14** | Transfers | Nouvelles tables `internal_transfers(id, from_section_id, to_section_id, status, created_by, approved_by, transferred_at, received_at)` + `transfer_items(transfer_id, product_id, quantity_requested, quantity_received, unit)`. Cycle `draft → pending → in_transit → received` (ou `cancelled`). Réception déclenche 2 mouvements par item (`transfer_out` négatif sur `from_section`, `transfer_in` positif sur `to_section`). Mode `sendDirectly: true` → status passe à `received` immédiatement (transfert express). |
| **C15** | Suggestions | RPCs `get_reorder_suggestions_v1(p_lookback_days, p_max_multiplier)` + `get_production_suggestions_v1(p_lookback_days, p_priority_high, p_priority_medium)`. Calcul : vitesse de vente moyenne sur N jours → si `current_stock < avg_daily * lookback` → suggérer la quantité = `avg_daily * (lookback + buffer)`. Pour production : `current_stock_finished < avg_daily_sold * lookback` + `recipe_active = true`. |
| **C16** | Alertes | Service `inventoryAlerts.ts` (TS pur, dans `packages/domain/src/inventory/alerts/`) consomme les RPCs ci-dessus. UI : `StockAlertsBadge` (topbar BO) + `InventoryAlertsPanel` (panneau dédié à l'onglet Alertes ou à la sidebar). Sévérité `critical` (current < min_stock_threshold × 0.5) / `warning` (current < min_stock_threshold). Settings : `inventory_config.stock_percentage_critical` (défaut 25%) / `stock_percentage_warning` (50%) / `reorder_lookback_days` (14) / `production_lookback_days` (7). |
| **C17** | Dashboard produit | Page `/backoffice/inventory/products/:id/dashboard` consomme RPC `get_product_dashboard_v1(p_product_id, p_lookback_days)` qui retourne en un seul appel : KPIs (current, value, rotation), timeline 30/90j, movement breakdown, recipe usage (si raw_material), purchase pattern, purchase price trend, weekly consumption. Charts via Recharts. |
| **C18** | Sections / Locations | `sections` seedées (5 zones). `stock_locations` optionnel (hiérarchique sous section). UI page `/backoffice/inventory/sections` (CRUD ADMIN+). `stock_movements.from_section_id` / `to_section_id` exigent FK vers `sections`. |
| **C19** | Pas de FEFO / batch | Conformément à la [référence Inventory](../../reference/04-modules/06-inventory-stock.md) §19 (Limites assumées V2) : pas de `stock_batches`, pas de tracking par DLC individuelle. Péremption gérée manuellement (waste). |
| **C20** | Pas de prévision ML | Suggestions = règles simples (vitesse récente vs stock courant). Pas de scikit-learn / prophet. Conforme [référence Inventory](../../reference/04-modules/06-inventory-stock.md) §19. |
| **C21** | Sidebar BO restructurée | Groupe **"Inventory"** dans la sidebar avec 7 sous-entrées (Stock / Incoming / Transfers / Wastage / Production / Opname / Movements). + 2 entrées additionnelles (Sections / Alerts). Cf. §4.1. |

---

## 2. Périmètre — les 7 onglets et leurs livrables

| Onglet | Route | RPCs | Tables | Composants UI principaux |
|---|---|---|---|---|
| **Stock** | `/backoffice/inventory` | `get_stock_levels_v1` (extension MVP), `adjust_stock_v1` | `products`, `stock_movements` | `StockListPage`, `AdjustModal`, `LowStockBadge`, `StockLevelRow` |
| **Incoming** | `/backoffice/inventory/incoming` | `record_incoming_stock_v1` (nouveau — distingué de `receive_stock_v1` PO) | `stock_movements` (movement_type=`incoming`), `products` | `IncomingStockPage`, `IncomingForm` |
| **Transfers** | `/backoffice/inventory/transfers` | `create_internal_transfer_v1`, `receive_internal_transfer_v1`, `cancel_internal_transfer_v1` | `internal_transfers`, `transfer_items`, `stock_movements` | `TransfersListPage`, `TransferFormPage`, `TransferDetailPage`, `TransferReceiveModal` |
| **Wastage** | `/backoffice/inventory/wastage` | `waste_stock_v1` (extension MVP) + `list_waste_v1` | `stock_movements` (waste), `waste_records` (header optionnel) | `WastagePage`, `WasteModal`, `WasteReasonSelect` |
| **Production** | `/backoffice/inventory/production` | `record_production_v1`, `revert_production_v1`, `list_recipes_v1`, `upsert_recipe_v1` | `production_records`, `recipes`, `recipe_ingredients` (alternative : recipes flat), `stock_movements` | `ProductionPage`, `ProductionForm`, `RecipeEditorModal`, `RecipeViewerModal`, `ProductionHistoryTable`, `ProductionSuggestionsPanel` |
| **Opname** | `/backoffice/inventory/opname` + `/backoffice/inventory/opname/:id` | `create_opname_v1`, `add_opname_item_v1`, `finalize_opname_v1`, `validate_opname_v1`, `cancel_opname_v1` | `inventory_counts`, `inventory_count_items`, `stock_movements` | `OpnameListPage`, `OpnameDetailPage`, `OpnameCountTable`, `OpnameFinalizeModal`, `OpnameValidateButton` |
| **Movements** | `/backoffice/inventory/movements` | `get_stock_movements_v1` (filtré + paginé), `get_movements_aggregates_v1` | `stock_movements` (lecture seule) | `StockMovementsPage` (table filtrable), `MovementBadge`, `MovementDrillDownDrawer` |

Onglets cross-cutting :

| Vue | Route | RPCs | Composants |
|---|---|---|---|
| **Dashboard produit** | `/backoffice/inventory/products/:id/dashboard` | `get_product_dashboard_v1` | `ProductInventoryDashboard`, `StockTimelineChart`, `MovementBreakdownChart`, `PurchasePriceTrendChart`, `RecipeUsageTable` |
| **Alertes** | `/backoffice/inventory/alerts` | `get_low_stock_v1`, `get_reorder_suggestions_v1`, `get_production_suggestions_v1` | `InventoryAlertsPanel`, `LowStockTab`, `ReorderTab`, `ProductionTab`, `StockAlertsBadge` |
| **Sections / Locations** | `/backoffice/inventory/sections` | CRUD via supabase direct (RLS) | `SectionsPage`, `SectionFormModal`, `LocationFormModal` |

---

## 3. Schéma DB — additions par phase

### 3.1 Migrations à créer (≈ 30)

```
# Phase 1 — fondations sections + extensions enum + units
20260516000001_init_sections.sql                       # CREATE TABLE sections (5 seedées) + stock_locations
20260516000002_extend_movement_type_enum.sql           # ALTER TYPE movement_type ADD VALUE transfer_in/out, production_in/out, adjustment_in/out, opname_in/out, incoming, reservation_*
20260516000003_init_unit_conversions.sql               # CREATE TABLE unit_conversions + 12 paires seedées + fonction convert_quantity()
20260516000004_extend_stock_movements_sections.sql     # ALTER stock_movements: +from_section_id, +to_section_id, +unit (NOT NULL), +unit_cost, +reason, +supplier_id, +idempotency_key + DROP NOT NULL reference_id + CHECKs + indexes
20260516000005_init_section_stock.sql                  # CREATE TABLE section_stock(section_id, product_id, quantity) — cache dénormalisé par section
20260516000006_init_stock_movements_rls.sql            # RLS lockdown : SELECT perm_read, REVOKE writes
20260516000007_seed_inventory_perms_v1.sql             # 12 perms + role_permissions seed + has_permission v8 (whitelist MANAGER étendue)
20260516000008_add_products_min_stock.sql              # ALTER products : +min_stock_threshold (déjà MVP mais on garde idempotent)

# Phase 2 — RPCs admin core (Stock + Incoming + Wastage)
20260516000009_create_record_stock_movement_rpc.sql    # primitive interne (REVOKE EXECUTE FROM authenticated)
20260516000010_create_adjust_stock_rpc.sql             # ADMIN+ — émet adjustment_in/out signé
20260516000011_create_receive_stock_rpc.sql            # MANAGER+ — supplier link, purchase movement
20260516000012_create_record_incoming_stock_rpc.sql    # MANAGER+ — incoming movement (sans PO, free-form supplier or none)
20260516000013_create_waste_stock_rpc.sql              # MANAGER+ — waste movement
20260516000014_create_get_stock_levels_rpc.sql         # SELECT perm — paginated + filterable

# Phase 3 — Transfers
20260516000015_init_internal_transfers.sql             # CREATE TABLE internal_transfers + transfer_items + RLS
20260516000016_create_internal_transfer_rpcs.sql       # create_internal_transfer_v1, receive_internal_transfer_v1, cancel_internal_transfer_v1
20260516000017_create_transfer_movements_helper.sql    # fonction interne emit_transfer_movements(transfer_id) — appelée par receive_internal_transfer_v1

# Phase 4 — Production + Recipes
20260516000018_init_recipes.sql                        # CREATE TABLE recipes (flat: product_id + material_id + quantity + unit + is_active) + RLS
20260516000019_init_production_records.sql             # CREATE TABLE production_records + RLS
20260516000020_create_recipe_rpcs.sql                  # upsert_recipe_v1, list_recipes_v1, deactivate_recipe_v1
20260516000021_create_record_production_rpc.sql        # record_production_v1 — atomique : insert production_record + 1 production_in + N production_out + JE COGS
20260516000022_create_revert_production_rpc.sql        # revert_production_v1 — réverse les mouvements + delete record (ADMIN+)
20260516000023_create_production_suggestions_rpc.sql   # get_production_suggestions_v1

# Phase 5 — Opname
20260516000024_init_inventory_counts.sql               # CREATE TABLE inventory_counts + inventory_count_items + RLS
20260516000025_create_opname_rpcs.sql                  # create_opname_v1, add_opname_item_v1, finalize_opname_v1, validate_opname_v1, cancel_opname_v1

# Phase 6 — Movements ledger view + aggregates
20260516000026_create_get_stock_movements_rpc.sql      # filtré + paginé + drill-down
20260516000027_create_movements_aggregates_rpc.sql     # stats par type / période / section / utilisateur

# Phase 7 — Alertes + Dashboard
20260516000028_create_low_stock_rpc.sql                # get_low_stock_v1
20260516000029_create_reorder_suggestions_rpc.sql      # get_reorder_suggestions_v1
20260516000030_create_product_dashboard_rpc.sql        # get_product_dashboard_v1 (1 appel = tout pour le dashboard)

# Phase 8 — Couplage comptable
20260516000031_create_stock_movement_je_trigger.sql    # trigger after INSERT stock_movements pour waste/adjustment/opname/production
20260516000032_seed_inventory_accounts.sql             # comptes COGS Production, COGS Waste, Stock Adjustment Income/Expense, Inventory General (si pas déjà dans accounting)
```

> **Convention de date** : tous datés `20260516xxxxxx` (après session 11 `20260515000004`). Le numéro à 14 chiffres permet le tri lexicographique stable même en réordonnant les tâches au sein d'une phase.

### 3.2 Schémas clés (vue contractuelle, pas tous les SQL inline)

#### 3.2.1 `sections`

| Colonne | Type | Notes |
|---|---|---|
| `id` | UUID PK | gen_random_uuid() |
| `code` | TEXT UNIQUE | 'WAREHOUSE', 'KITCHEN', 'PASTRY', 'STORAGE', 'SALES' (seedées) |
| `name` | TEXT NOT NULL | Libellé affiché |
| `kind` | TEXT NOT NULL | 'warehouse' / 'production' / 'sales' (CHECK constraint) |
| `is_active` | BOOLEAN DEFAULT true | |
| `display_order` | INT DEFAULT 0 | Tri sidebar |
| `created_at`, `updated_at`, `deleted_at` | timestamps | soft-delete |

#### 3.2.2 `stock_locations`

| Colonne | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `section_id` | UUID FK sections NOT NULL | |
| `parent_location_id` | UUID FK stock_locations NULL | Hiérarchie |
| `code` | TEXT NOT NULL | Unique par section |
| `name` | TEXT NOT NULL | |
| `is_active` | BOOLEAN DEFAULT true | |

#### 3.2.3 `stock_movements` (extensions)

| Colonne nouvelle | Type | Notes |
|---|---|---|
| `from_section_id` | UUID FK sections NULL | Source — NULL pour `purchase` / `incoming` (origine externe) |
| `to_section_id` | UUID FK sections NULL | Destination — NULL pour `sale` / `waste` (sortie de l'entreprise) |
| `unit` | TEXT NOT NULL | Coercé via fallback `products.unit ?? 'pcs'` côté insertion |
| `unit_cost` | DECIMAL(14,2) NULL | COGS unitaire (informatif) |
| `reason` | TEXT NULL | Requis pour admin types (CHECK) |
| `supplier_id` | UUID FK suppliers NULL | Restreint à `purchase` / `incoming` (CHECK) |
| `idempotency_key` | UUID UNIQUE NULL | Replay safety |
| `metadata` | JSONB DEFAULT '{}' | Contextes additionnels (batch_id, transfer notes, etc.) |

CHECK : `movement_type IN ('sale','sale_void')` OR `reason IS NOT NULL`. CHECK : `from_section_id IS NOT NULL` OR `movement_type IN ('purchase','incoming','sale','sale_void')`. Index `(product_id, created_at DESC)`, `(movement_type, created_at DESC)`, `(supplier_id) WHERE supplier_id IS NOT NULL`, `(from_section_id, created_at DESC)`, `(to_section_id, created_at DESC)`.

#### 3.2.4 `internal_transfers`

| Colonne | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `transfer_number` | TEXT UNIQUE | Format `TRF-YYYYMMDD-XXXX` (généré server-side) |
| `from_section_id` | UUID FK sections NOT NULL | |
| `to_section_id` | UUID FK sections NOT NULL CHECK (≠ from) | |
| `status` | TEXT NOT NULL | 'draft' / 'pending' / 'in_transit' / 'received' / 'cancelled' (state machine validée RPC) |
| `notes` | TEXT NULL | |
| `created_by` | UUID FK user_profiles NOT NULL | |
| `approved_by` | UUID FK user_profiles NULL | Renseigné quand `status = received` |
| `transferred_at`, `received_at` | timestamptz NULL | |
| `created_at`, `updated_at` | timestamps | |

#### 3.2.5 `transfer_items`

| Colonne | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `transfer_id` | UUID FK internal_transfers ON DELETE CASCADE | |
| `product_id` | UUID FK products | |
| `quantity_requested` | DECIMAL(10,3) NOT NULL CHECK > 0 | |
| `quantity_received` | DECIMAL(10,3) NULL | Renseigné à la réception |
| `unit` | TEXT NOT NULL | |
| `notes` | TEXT NULL | |
| UNIQUE | `(transfer_id, product_id)` | Pas de doublon |

#### 3.2.6 `recipes`

Modèle **flat** (pas d'aggregate header séparé) :

| Colonne | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `product_id` | UUID FK products NOT NULL | Le produit fini |
| `material_id` | UUID FK products NOT NULL | L'ingrédient (peut être raw_material ou semi_finished) |
| `quantity` | DECIMAL(10,3) NOT NULL CHECK > 0 | Quantité par 1 unité de produit fini |
| `unit` | TEXT NOT NULL | Unité de la recette (convertie via convert_quantity vers material.unit) |
| `is_active` | BOOLEAN DEFAULT true | Désactivation = nouvelle version |
| `notes` | TEXT NULL | |
| `created_at`, `updated_at`, `deleted_at` | timestamps | |
| UNIQUE PARTIAL | `(product_id, material_id) WHERE is_active = true` | Une seule ligne active par couple |

#### 3.2.7 `production_records`

| Colonne | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `production_number` | TEXT UNIQUE | Format `PROD-YYYYMMDD-XXXX` |
| `product_id` | UUID FK products | Produit fini |
| `quantity_produced` | DECIMAL(10,3) NOT NULL CHECK ≥ 0 | |
| `quantity_waste` | DECIMAL(10,3) NOT NULL DEFAULT 0 CHECK ≥ 0 | Pertes (rebut) — émet un mouvement waste séparé |
| `production_date` | DATE NOT NULL DEFAULT CURRENT_DATE | |
| `section_id` | UUID FK sections NOT NULL | Section de production |
| `staff_id` | UUID FK user_profiles NOT NULL | Pâtissier responsable |
| `batch_number` | TEXT NULL | Numéro de fournée optionnel |
| `notes` | TEXT NULL | |
| `materials_consumed` | BOOLEAN NOT NULL DEFAULT false | Flag idempotence |
| `stock_updated` | BOOLEAN NOT NULL DEFAULT false | Flag idempotence |
| `je_posted` | BOOLEAN NOT NULL DEFAULT false | Flag JE COGS posté |
| `created_at`, `updated_at` | timestamps | |

#### 3.2.8 `inventory_counts`

| Colonne | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `count_number` | TEXT UNIQUE | Format `OPN-YYYYMMDD-XXXX` |
| `section_id` | UUID FK sections NULL | NULL = comptage global |
| `status` | TEXT NOT NULL | 'draft' / 'in_progress' / 'finalized' / 'validated' / 'cancelled' |
| `started_by` | UUID FK user_profiles NOT NULL | |
| `finalized_by` | UUID FK user_profiles NULL | |
| `validated_by` | UUID FK user_profiles NULL | |
| `started_at`, `finalized_at`, `validated_at` | timestamptz NULL | |
| `notes` | TEXT NULL | |

#### 3.2.9 `inventory_count_items`

| Colonne | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `count_id` | UUID FK inventory_counts ON DELETE CASCADE | |
| `product_id` | UUID FK products | |
| `expected_quantity` | DECIMAL(10,3) NOT NULL | Snapshot du `current_stock` au moment du `add_opname_item_v1` |
| `counted_quantity` | DECIMAL(10,3) NULL | NULL = pas encore compté |
| `variance` | DECIMAL(10,3) GENERATED ALWAYS AS (counted_quantity - expected_quantity) STORED | Calculé |
| `notes` | TEXT NULL | |
| UNIQUE | `(count_id, product_id)` | |

#### 3.2.10 `unit_conversions`

| Colonne | Type | Notes |
|---|---|---|
| `from_unit` | TEXT PK | (PK composite) |
| `to_unit` | TEXT PK | |
| `factor` | DECIMAL(20,10) NOT NULL CHECK > 0 | `qty_to = qty_from * factor` |

Seedées : `(kg, g, 1000)`, `(g, kg, 0.001)`, `(L, mL, 1000)`, `(mL, L, 0.001)`, identités `(pcs, pcs, 1)`, `(g, g, 1)`, etc.

### 3.3 Signatures RPC clés

```sql
-- Phase 2 (Stock / Incoming / Wastage)
record_stock_movement_v1(p_product_id, p_movement_type, p_quantity, p_reason,
                         p_unit, p_unit_cost, p_supplier_id,
                         p_from_section_id, p_to_section_id, p_idempotency_key) RETURNS JSONB
                         -- INTERNAL — REVOKE EXECUTE FROM authenticated

adjust_stock_v1(p_product_id, p_section_id, p_new_qty, p_reason, p_idempotency_key) RETURNS JSONB
                -- ADMIN+ — émet adjustment_in/out signé sur la section

receive_stock_v1(p_product_id, p_quantity, p_supplier_id, p_to_section_id,
                 p_unit, p_unit_cost, p_reason, p_idempotency_key) RETURNS JSONB
                 -- MANAGER+ — purchase movement (cf. spec Purchasing pour la version PO)

record_incoming_stock_v1(p_product_id, p_quantity, p_to_section_id,
                         p_unit, p_unit_cost, p_supplier_id, p_reason, p_note,
                         p_idempotency_key) RETURNS JSONB
                         -- MANAGER+ — incoming movement (cash & carry, dépannage)

waste_stock_v1(p_product_id, p_section_id, p_quantity, p_reason, p_idempotency_key) RETURNS JSONB
               -- MANAGER+ — waste movement

get_stock_levels_v1(p_section_id, p_category_id, p_search, p_low_stock_only,
                    p_limit, p_offset) RETURNS TABLE (...)
                    -- SELECT perm — paginé + filtré

-- Phase 3 (Transfers)
create_internal_transfer_v1(p_from_section_id, p_to_section_id,
                            p_items JSONB, -- [{product_id, quantity, unit, notes}]
                            p_send_directly BOOLEAN, p_notes,
                            p_idempotency_key) RETURNS JSONB
                            -- MANAGER+ — crée header + items, status = draft|pending|received

receive_internal_transfer_v1(p_transfer_id,
                             p_received_items JSONB, -- [{item_id, quantity_received}]
                             p_idempotency_key) RETURNS JSONB
                             -- MANAGER+ — update items, émet transfer_out + transfer_in mouvements,
                             -- status → received

cancel_internal_transfer_v1(p_transfer_id, p_reason) RETURNS JSONB
                            -- MANAGER+ — uniquement si status ∈ {draft, pending}

-- Phase 4 (Production + Recipes)
upsert_recipe_v1(p_product_id, p_ingredients JSONB) RETURNS JSONB
                 -- ADMIN+ — désactive la recette précédente + insère la nouvelle
                 -- p_ingredients = [{material_id, quantity, unit}]

list_recipes_v1(p_product_id, p_include_inactive BOOLEAN) RETURNS TABLE (...)
                -- SELECT perm

record_production_v1(p_product_id, p_quantity, p_section_id,
                     p_quantity_waste, p_batch_number, p_notes,
                     p_idempotency_key) RETURNS JSONB
                     -- MANAGER+ — atomique : production_record + production_in
                     -- + N production_out (via recipe + convert_quantity)
                     -- + waste mouvement si quantity_waste > 0
                     -- + JE COGS Production via trigger

revert_production_v1(p_production_id, p_reason) RETURNS JSONB
                     -- ADMIN+ — réverse les mouvements (négation) + delete record
                     -- + JE de contre-passation

get_production_suggestions_v1(p_lookback_days, p_priority_high_threshold,
                              p_priority_medium_threshold) RETURNS TABLE (...)
                              -- SELECT perm

-- Phase 5 (Opname)
create_opname_v1(p_section_id, p_notes, p_idempotency_key) RETURNS JSONB
                 -- MANAGER+ — crée header status='draft'

add_opname_item_v1(p_count_id, p_product_id) RETURNS JSONB
                   -- MANAGER+ — snapshot expected_quantity = products.current_stock pour cette section
                   -- bump status à 'in_progress' si encore 'draft'

set_opname_count_v1(p_count_id, p_product_id, p_counted_quantity) RETURNS JSONB
                    -- MANAGER+ — UPDATE counted_quantity (recalcule variance via STORED)

finalize_opname_v1(p_count_id, p_idempotency_key) RETURNS JSONB
                   -- MANAGER+ — pour chaque item : si variance ≠ 0, émet adjustment_in/out
                   -- + JE Stock Adjustment via trigger
                   -- status → 'finalized'

validate_opname_v1(p_count_id) RETURNS JSONB
                   -- ADMIN+ — verrouille définitivement (status → 'validated')

cancel_opname_v1(p_count_id, p_reason) RETURNS JSONB
                 -- ADMIN+ — uniquement si status ∈ {draft, in_progress, finalized}

-- Phase 6 (Movements)
get_stock_movements_v1(p_product_id, p_movement_types TEXT[], p_section_id,
                       p_supplier_id, p_user_id, p_date_from, p_date_to,
                       p_limit, p_offset) RETURNS TABLE (...)
                       -- SELECT perm — paginé + filtré + jointures product/user/supplier

get_movements_aggregates_v1(p_date_from, p_date_to, p_group_by TEXT) RETURNS TABLE (...)
                            -- agregation par type / section / utilisateur sur la période

-- Phase 7 (Alertes + Dashboard)
get_low_stock_v1() RETURNS TABLE (...)
                  -- SELECT perm — produits avec current_stock < min_stock_threshold

get_reorder_suggestions_v1(p_lookback_days, p_max_multiplier) RETURNS TABLE (...)
                          -- SELECT perm — current_stock + avg_daily_usage + last_purchase_price
                          -- + days_until_stockout + suggested_quantity + last_supplier_id

get_product_dashboard_v1(p_product_id, p_lookback_days) RETURNS JSONB
                        -- SELECT perm — payload complet pour ProductInventoryDashboard
                        -- (KPIs + timeline_buckets + movement_breakdown + recipe_usage
                        --  + purchase_pattern + price_trend + weekly_consumption)
```

### 3.4 Triggers comptables (Phase 8)

```sql
CREATE OR REPLACE FUNCTION create_stock_movement_journal_entry()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_value DECIMAL(14,2);
  v_unit_cost DECIMAL(14,2);
BEGIN
  -- Seuls les types qui affectent la valeur d'inventaire émettent un JE
  IF NEW.movement_type NOT IN ('waste', 'adjustment_in', 'adjustment_out',
                                'opname_in', 'opname_out',
                                'production_in', 'production_out') THEN
    RETURN NEW;
  END IF;

  -- Garde fiscal period
  PERFORM check_fiscal_period_open(NOW()::DATE);

  -- Résoudre cost_price si unit_cost absent
  v_unit_cost := COALESCE(NEW.unit_cost,
                          (SELECT cost_price FROM products WHERE id = NEW.product_id));
  v_value := ABS(NEW.quantity) * v_unit_cost;

  -- Production : regroupé sur la même JE par production_id (via reference_type='production')
  -- Adjustment / Opname / Waste : 1 JE par mouvement
  PERFORM post_journal_entry(
    p_entry_date := NOW()::DATE,
    p_reference_type := NEW.reference_type,
    p_reference_id := NEW.reference_id,
    p_lines := build_je_lines_for_movement(NEW, v_value)
  );

  RETURN NEW;
END $$;

CREATE TRIGGER tr_stock_movement_je
  AFTER INSERT ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION create_stock_movement_journal_entry();
```

> **Note** : la fonction `build_je_lines_for_movement` est un helper qui retourne le tableau de lignes JE selon `movement_type` (cf. table de mapping §C10). La fonction `post_journal_entry` est supposée exister dans le module Accounting (cf. session future).

---

## 4. Frontend — additions

### 4.1 Sidebar restructurée (`apps/backoffice/src/layouts/BackofficeLayout.tsx`)

Nouveau groupe **Inventory** :

```
Inventory  (groupe collapsible, perm 'inventory.read')
  ├─ Stock           → /backoffice/inventory
  ├─ Incoming        → /backoffice/inventory/incoming
  ├─ Transfers       → /backoffice/inventory/transfers
  ├─ Wastage         → /backoffice/inventory/wastage
  ├─ Production      → /backoffice/inventory/production
  ├─ Opname          → /backoffice/inventory/opname
  ├─ Movements       → /backoffice/inventory/movements
  ├─ Alerts          → /backoffice/inventory/alerts          (badge rouge si critical > 0)
  └─ Sections        → /backoffice/inventory/sections        (perm 'inventory.sections.update')
```

Topbar : `<StockAlertsBadge>` (icône cloche + compteur des alertes critiques) → ouvre un panel résumé + lien vers `/backoffice/inventory/alerts`.

### 4.2 Routes (`apps/backoffice/src/routes/index.tsx`)

| Route | Composant | PermissionGate |
|---|---|---|
| `/backoffice/inventory` | `<StockListPage>` | `inventory.read` |
| `/backoffice/inventory/incoming` | `<IncomingStockPage>` | `inventory.receive` |
| `/backoffice/inventory/transfers` | `<TransfersListPage>` | `inventory.read` |
| `/backoffice/inventory/transfers/new` | `<TransferFormPage mode="create">` | `inventory.transfer.create` |
| `/backoffice/inventory/transfers/:id` | `<TransferDetailPage>` | `inventory.read` |
| `/backoffice/inventory/transfers/:id/edit` | `<TransferFormPage mode="edit">` | `inventory.transfer.create` |
| `/backoffice/inventory/wastage` | `<WastagePage>` | `inventory.read` |
| `/backoffice/inventory/production` | `<ProductionPage>` | `inventory.read` |
| `/backoffice/inventory/production/recipes/:productId` | `<RecipeEditorPage>` | `inventory.recipes.update` |
| `/backoffice/inventory/opname` | `<OpnameListPage>` | `inventory.read` |
| `/backoffice/inventory/opname/:id` | `<OpnameDetailPage>` | `inventory.opname.create` |
| `/backoffice/inventory/movements` | `<StockMovementsPage>` | `inventory.read` |
| `/backoffice/inventory/products/:id/dashboard` | `<ProductInventoryDashboard>` | `inventory.read` |
| `/backoffice/inventory/alerts` | `<InventoryAlertsPanel>` | `inventory.read` |
| `/backoffice/inventory/sections` | `<SectionsPage>` | `inventory.sections.update` |

### 4.3 Feature folders

```
apps/backoffice/src/features/inventory/
  components/
    AdjustModal.tsx
    ReceiveModal.tsx              # Pour PO reception → cf. spec Purchasing
    IncomingForm.tsx
    WasteModal.tsx
    WasteReasonSelect.tsx
    StockLevelRow.tsx
    LowStockBadge.tsx
    MovementBadge.tsx              # Couleur par movement_type
    MovementHistoryDrawer.tsx
    SectionFormModal.tsx
    LocationFormModal.tsx
  hooks/
    useStockLevels.ts
    useStockMovements.ts
    useAdjustStock.ts
    useReceiveStock.ts
    useIncomingStock.ts
    useWasteStock.ts
    useProductsForInventory.ts
    useLowStock.ts
    useReorderSuggestions.ts
    useProductDashboard.ts
    useSections.ts
    useLocations.ts

apps/backoffice/src/features/inventory-transfers/
  components/
    TransferFormFields.tsx
    TransferItemsTable.tsx
    TransferStatusBadge.tsx
    TransferReceiveModal.tsx
    TransferCancelConfirm.tsx
  hooks/
    useInternalTransfers.ts
    useTransferDetail.ts
    useCreateTransfer.ts
    useReceiveTransfer.ts
    useCancelTransfer.ts

apps/backoffice/src/features/inventory-production/
  components/
    ProductionForm.tsx
    ProductionHistoryTable.tsx
    ProductionSuggestionsPanel.tsx
    RecipeViewerModal.tsx
    RecipeEditorModal.tsx
    RecipeIngredientRow.tsx
    ProductionRevertModal.tsx
  hooks/
    useProductions.ts
    useRecord Production.ts
    useRevertProduction.ts
    useRecipes.ts
    useUpsertRecipe.ts
    useProductionSuggestions.ts

apps/backoffice/src/features/inventory-opname/
  components/
    OpnameCountTable.tsx
    OpnameAddProductModal.tsx
    OpnameFinalizeModal.tsx
    OpnameValidateButton.tsx
    OpnameStatusBadge.tsx
    OpnameVarianceCell.tsx
  hooks/
    useOpnames.ts
    useOpnameDetail.ts
    useCreateOpname.ts
    useAddOpnameItem.ts
    useSetOpnameCount.ts
    useFinalizeOpname.ts
    useValidateOpname.ts

apps/backoffice/src/features/inventory-movements/
  components/
    MovementsFilterBar.tsx
    MovementsTable.tsx
    MovementsAggregateChart.tsx
    MovementDrillDownDrawer.tsx
  hooks/
    useStockMovementsList.ts
    useMovementsAggregates.ts

apps/backoffice/src/features/inventory-alerts/
  components/
    InventoryAlertsPanel.tsx
    LowStockTab.tsx
    ReorderTab.tsx
    ProductionTab.tsx
    StockAlertsBadge.tsx
    ReorderActionButton.tsx        # → crée un PO draft (handoff Purchasing)

apps/backoffice/src/features/inventory-dashboard/
  components/
    ProductInventoryDashboard.tsx
    StockTimelineChart.tsx
    MovementBreakdownChart.tsx
    PurchasePriceTrendChart.tsx
    WeeklyConsumptionChart.tsx
    RecipeUsageTable.tsx
```

### 4.4 Pages

```
apps/backoffice/src/pages/inventory/
  StockListPage.tsx
  IncomingStockPage.tsx
  WastagePage.tsx
  TransfersListPage.tsx
  TransferFormPage.tsx
  TransferDetailPage.tsx
  ProductionPage.tsx
  RecipeEditorPage.tsx
  OpnameListPage.tsx
  OpnameDetailPage.tsx
  StockMovementsPage.tsx
  ProductDashboardPage.tsx
  AlertsPage.tsx
  SectionsPage.tsx
```

### 4.5 Domain package (`packages/domain/src/inventory/`)

```
inventory/
  index.ts
  types.ts                       # MovementType (étendu), StockLevel, StockMovement,
                                 # AdjustmentInput, ReceiveInput, IncomingInput,
                                 # WasteInput, TransferInput, ProductionInput,
                                 # OpnameInput, RecipeInput, SectionInput
  classifyMovement.ts            # → { direction: 'IN'|'OUT'|'NEUTRAL', isSale, isAdmin, isProduction, isTransfer }
  computeNewStock.ts             # (current, signedDelta) => number
  computeStockDelta.ts           # (movements[]) => signed sum
  validateAdjust.ts
  validateReceive.ts
  validateIncoming.ts
  validateWaste.ts
  validateTransfer.ts            # check from ≠ to, items > 0, etc.
  validateProduction.ts          # check qty > 0, recipe exists, ingredients available
  validateOpnameCount.ts
  validateRecipe.ts              # check no cycle (product can't be its own ingredient)
  computeRecipeCost.ts           # (recipe[], productionQty) => totalIngredientCost
  computeRecipeFeasibility.ts    # (recipe[], inventory[], productionQty) => boolean + missing[]
  alerts/
    classifySeverity.ts          # (current, threshold, settings) => 'critical'|'warning'|'ok'
    computeReorderQuantity.ts    # (avgDaily, lookback, currentStock) => suggestedQty
    computeStockoutDays.ts       # (currentStock, avgDailyUsage) => days
  units/
    convertQuantity.ts           # mirror du SQL convert_quantity()
    UNIT_TABLE.ts                # { kg→g: 1000, g→kg: 0.001, ... }
  __tests__/                     # ~60 unit tests
```

Toujours **IO-free** (pas de fetch / Supabase / React).

### 4.6 packages/utils

```
packages/utils/src/units/
  convertQuantity.ts             # ré-export de packages/domain/src/inventory/units/
  formatQuantity.ts              # display "1.5 kg" / "500 g" avec abréviations
  parseQuantityInput.ts          # parse "1.5kg" ou "1500g" en {value, unit}
```

### 4.7 packages/supabase

- Régénérer `packages/supabase/src/types.generated.ts` après toutes les migrations.
- Étendre `packages/supabase/src/rls/permissions.ts` `PermissionCode` union avec les **12 nouvelles perms** (cf. C8).

---

## 5. Tests — matrix

### 5.1 pgTAP (`supabase/tests/inventory.test.sql` + variantes par domaine)

| Domaine | # tests | Exemples |
|---|---|---|
| **Sections / Locations** | T1-T5 | seed 5 sections, FK CASCADE/RESTRICT, RLS perm-gated |
| **Stock movements (extensions)** | T6-T15 | CHECK reason, CHECK supplier_only_purchase, CHECK section consistency, idempotency UNIQUE, RLS lockdown |
| **Adjust / Receive / Incoming / Waste** | T16-T28 | happy path + perm denied + insufficient_stock + idempotent replay |
| **Transfers** | T29-T40 | create draft → pending → in_transit → received → 2 movements emitted, partial receive, cancel before pending only, send_directly skip pending, RLS lock concurrent receive |
| **Production / Recipes** | T41-T55 | upsert recipe désactive l'ancienne, record_production atomique, ingredients déduits avec conversion d'unité, JE COGS posté, revert réverse stock + JE contre-passation, suggestion priorisée |
| **Opname** | T56-T68 | create → add items snapshot expected, set count, finalize émet adjustments + JE, validate verrouille, cancel uniquement avant validation |
| **Movements aggregates** | T69-T75 | get_stock_movements filtré, aggregates groupés par type/section, drill-down |
| **Alerts** | T76-T82 | low_stock retourne uniquement < threshold, reorder_suggestions calcule avg_daily, stockout_days, suggested_qty |
| **Couplage comptable** | T83-T92 | trigger crée JE pour waste/adjustment/opname/production, refuse si fiscal period locked, double-entrée balanced, cancellation production crée JE contre-passation |
| **Concurrency / regression POS** | T93-T100 | adjust + sale concurrent serialize via FOR UPDATE, void/refund toujours OK, drift cache vs ledger = 0 après suite |

**Total cible** : ≥100 tests pgTAP.

### 5.2 Vitest domain (`packages/domain/src/inventory/__tests__/`)

~80 unit tests sur les 14 fichiers de validators / computers / alerts / units. Cible 100% line coverage.

### 5.3 Vitest live RPCs (`supabase/tests/functions/inventory-*.test.ts`)

| Fichier | Scenarios |
|---|---|
| `inventory-stock.test.ts` | adjust + receive + waste happy paths + RLS |
| `inventory-incoming.test.ts` | record_incoming_stock_v1 + sans supplier (cash) + avec supplier |
| `inventory-transfers.test.ts` | full cycle + send_directly + concurrent receive lock |
| `inventory-production.test.ts` | record_production + recipe + JE COGS + revert |
| `inventory-opname.test.ts` | full cycle + validate locks + cancel paths |
| `inventory-alerts.test.ts` | low_stock + reorder_suggestions + production_suggestions |
| `inventory-dashboard.test.ts` | get_product_dashboard payload complet |
| `inventory-concurrent.test.ts` | adjust + sale + transfer concurrent → final stock cohérent |

**Total cible** : ≥40 tests live RPCs.

### 5.4 Vitest backoffice (`apps/backoffice/src/**/__tests__/`)

| Fichier | Scenario |
|---|---|
| `Inventory.test.tsx` | StockListPage rend, filter category, low-stock toggle, pagination |
| `inventory-transfers/__tests__/TransferForm.test.tsx` | Validation form + send_directly |
| `inventory-transfers/__tests__/TransferReceive.test.tsx` | Réception partielle + total |
| `inventory-production/__tests__/ProductionForm.test.tsx` | Validation + recipe feasibility check |
| `inventory-production/__tests__/RecipeEditorModal.test.tsx` | CRUD ingredients + cycle detection |
| `inventory-opname/__tests__/OpnameDetail.test.tsx` | Add product → set count → finalize |
| `inventory-movements/__tests__/MovementsTable.test.tsx` | Filter par type/section/date |
| `inventory-alerts/__tests__/InventoryAlertsPanel.test.tsx` | 3 onglets renderize |
| `inventory-dashboard/__tests__/ProductInventoryDashboard.test.tsx` | Charts montés |
| `inventory.smoke.test.tsx` | Smoke E2E : MANAGER login → receive 20 → transfer 10 vers Kitchen → produce 5 baguettes (consume 1.25kg flour) → waste 2 → opname recompte 2 → adjust → vérifier history affiche tout |

**Total cible** : ≥50 tests BO.

### 5.5 Cible globale

≥100 nouveaux tests pgTAP + ≥80 unit domain + ≥40 live RPCs + ≥50 BO = **≥270 nouveaux tests**. Suite totale ≥ 920 passing (sessions 1-11 ≈ 620 + MVP session 12 ≈ 30).

---

## 6. Critères d'acceptation

### 6.1 Database & RPCs

- [ ] Les 30+ migrations s'appliquent sans erreur sur `pnpm db:reset`
- [ ] Tous les types TS regénérés via `pnpm db:types`, fichier committé
- [ ] **RLS lockdown** : un user `authenticated` ne peut faire AUCUN INSERT/UPDATE/DELETE direct sur les tables inventory (tests T11, T29, T56)
- [ ] **Idempotency** : 2 appels avec même `p_idempotency_key` → 1 seule row, même `movement_id` retourné (toutes les RPCs admin)
- [ ] **Concurrency** : adjust + sale + transfer concurrents serializés via row lock (test T100)
- [ ] **Reason CHECK** : INSERT direct waste sans reason → CHECK violation
- [ ] **Drift cache vs ledger** : test final `SUM(stock_movements.quantity) GROUP BY product_id` = `products.current_stock` pour tous les produits

### 6.2 Onglet Stock

- [ ] Page `/backoffice/inventory` : list paginée + search + category filter + low-stock toggle
- [ ] Badge low-stock affiché si `current_stock < min_stock_threshold AND min_stock_threshold > 0`
- [ ] Bouton Adjust ouvre AdjustModal (cf. C8 perms)
- [ ] Drawer history accessible depuis chaque ligne

### 6.3 Onglet Incoming

- [ ] Page `/backoffice/inventory/incoming` : form de saisie (produit + qty + section dest + supplier optionnel + note libre)
- [ ] Submit → mouvement `incoming` + `current_stock` mis à jour + `cost_price` rafraîchi si `unit_cost` fourni

### 6.4 Onglet Transfers

- [ ] Page list filtrable (status, sections, dates)
- [ ] TransferFormPage permet création multi-items + mode `Send directly` qui réceptionne immédiatement
- [ ] TransferDetailPage affiche timeline status + bouton Réception (avec qty_received par item)
- [ ] Réception émet 2 mouvements par item (`transfer_out` négatif + `transfer_in` positif)
- [ ] Cancel uniquement possible avant réception (test T39)

### 6.5 Onglet Wastage

- [ ] Page list des waste records (timeline, stats)
- [ ] WasteModal avec sélection raison (Expired / Damaged / Spoiled / Burnt / Tasting / Theft / Other)
- [ ] Submit → mouvement `waste` + JE auto (Dr COGS Waste / Cr Inventory)

### 6.6 Onglet Production

- [ ] Page `/backoffice/inventory/production` : list productions du jour + ProductionSuggestionsPanel
- [ ] ProductionForm : sélection produit fini + qty + qty_waste + batch + notes → submit
- [ ] Si recette manquante → erreur explicite, lien vers RecipeEditor
- [ ] Si stock ingrédient insuffisant → erreur explicite avec liste des manquants
- [ ] Submit → 1 production_in + N production_out (avec conversion d'unité) + JE COGS posté
- [ ] Page `/backoffice/inventory/production/recipes/:productId` : éditeur recette (add/edit/remove ingredients) avec détection de cycle
- [ ] Bouton Revert (ADMIN+) sur production récente → réverse mouvements + JE contre-passation

### 6.7 Onglet Opname

- [ ] Page list des opnames (status, section, date)
- [ ] Création opname : choix section (ou global) → status = draft
- [ ] OpnameDetail : add products → expected_quantity snapshot, set counts, voir variance
- [ ] Finalize : émet adjustments en batch + JE, status → finalized
- [ ] Validate (ADMIN+) : verrouille définitivement, status → validated

### 6.8 Onglet Movements

- [ ] Page list filtrable (product, types[], section, supplier, user, date range)
- [ ] Pagination 50/page, total count
- [ ] Drill-down sur référence d'origine (PO, opname, transfer, production, sale)
- [ ] Stats agrégées sur la période (volume in / out, top types)

### 6.9 Dashboard produit

- [ ] Page `/backoffice/inventory/products/:id/dashboard` accessible depuis chaque ligne stock
- [ ] KPIs : current, value, rotation
- [ ] StockTimelineChart 30/90j
- [ ] MovementBreakdownChart par type
- [ ] Si raw_material : RecipeUsageTable (qui consomme ce produit)
- [ ] PurchasePriceTrendChart (évolution prix d'achat)
- [ ] WeeklyConsumptionChart

### 6.10 Alertes

- [ ] StockAlertsBadge dans topbar avec compteur critical
- [ ] Page `/backoffice/inventory/alerts` avec 3 onglets (Low Stock / Reorder / Production)
- [ ] ReorderTab : action "Créer PO" → handoff vers `/backoffice/purchasing/purchase-orders/new` pré-rempli (cf. spec Purchasing)
- [ ] ProductionTab : action "Lancer production" → ouvre ProductionForm pré-rempli

### 6.11 Sections / Locations

- [ ] Page `/backoffice/inventory/sections` (ADMIN+) : CRUD sections + locations hiérarchiques
- [ ] Soft-delete d'une section ne casse pas les mouvements historiques (FK ON DELETE SET NULL)

### 6.12 Couplage comptable

- [ ] Trigger `tr_stock_movement_je` actif pour waste/adjustment/opname/production
- [ ] Aucun JE émis pour transfer_in/out (mouvement neutre)
- [ ] Aucun JE émis pour sale/sale_void (déjà géré par les RPCs POS)
- [ ] Refus opération si fiscal period closed (raise period_locked)

### 6.13 Permissions matrix

| Rôle | Lecture | Adjust | Receive/Waste/Incoming | Transfer create/receive | Opname create | Opname finalize | Production create | Production delete | Recipes update | Sections update |
|---|---|---|---|---|---|---|---|---|---|---|
| CASHIER | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| MANAGER | ✅ | ❌ | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ |
| ADMIN | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| SUPER_ADMIN | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

### 6.14 Qualité

- [ ] `pnpm typecheck` 0 erreur
- [ ] `pnpm lint` 0 warning
- [ ] `pnpm test` ≥270 nouveaux tests pass, suite totale ≥920
- [ ] `pnpm build` succès POS + backoffice

### 6.15 Régression POS

- [ ] checkout existant décrémente toujours via `complete_order_with_payment` v8 (smoke `pos-checkout.smoke.test.tsx` toujours vert)
- [ ] Void / refund restaurent toujours
- [ ] Aucun changement de signature des RPCs POS existants

---

## 7. Risques

| Risque | Mitigation |
|---|---|
| **Volume énorme — risque de dérive** | Découpage strict en 8 sous-phases (cf. INDEX). Chaque phase a un critère d'acceptation propre. |
| `products.current_stock` drift vs `SUM(stock_movements.quantity)` | Test pgTAP de réconciliation en fin de run. Cron hebdo `audit-stock-drift` (à créer session ultérieure). |
| `section_stock` drift vs `stock_movements` agrégés par section | Idem — cron `audit-section-stock-drift`. Pour MVP : recalcul manuel via opname global. |
| Trigger JE bloque production si fiscal period closed | Documenter dans onboarding ; UI affiche message clair. Manager doit déverrouiller la période avant de produire. |
| Cycle dans recettes (produit ingrédient de lui-même) | Validation `validateRecipe` côté domain + CHECK trigger côté DB qui détecte cycle direct (pour cycle indirect, validation côté hook avant submit). |
| Conversion d'unité manquante pour une paire | Helper `convert_quantity` raise `unit_conversion_missing` si paire non-seedée. UI propose d'ajouter la paire. |
| Récursion semi-finis non supportée | Documenté ; produire les semi-finis d'abord. Future session : `recursive_recipe_v2`. |
| Adjust abusé pour créer du stock fantôme | ADMIN+ only, audit_log row systématique avec reason >= 3 chars. |
| RLS sur opname multi-utilisateur | Tests T56-T68 vérifient que 2 utilisateurs MANAGER peuvent compter en parallèle sans collision. |
| Trigger fiscal period bloque opname finalize en fin de mois | Documenter ; finalize doit avoir lieu dans la période courante. |
| Total RPCs en plein boom — risque conflit migration numbers | Tous datés `20260516xxxxxx` ; 99 slots disponibles. Si dépassement → bumper à `20260517`. |
| `current_stock` pas filtré par section | section_stock cache résout ; UI dashboard utilise section_stock pour la vue par section. |
| Réception transfer non-atomique | Pattern V2 reference : optimistic lock sur status + idempotency check sur `(reference_type='transfer', reference_id=transfer_id)` avant émission mouvements. |
| Performance dashboard produit | RPC `get_product_dashboard_v1` retourne tout en 1 appel. Si lent (> 500ms), envisager view matérialisée `mv_product_inventory_dashboard` rafraîchie nightly. |
| Migration enum `movement_type` cassante pour types existants | `ALTER TYPE ... ADD VALUE` est non-destructif. Code existant continue de fonctionner. |
| Volume tests cible (≥270) → temps CI long | Lancer pgTAP en parallèle sur instances Postgres dédiées ; Vitest live regroupé en serveurs Supabase locaux par fichier. |

---

## 8. Dépendances sessions précédentes

| Dépendance | Origine | Usage session 12 complete |
|---|---|---|
| Table `stock_movements` + enum `movement_type` (sale/sale_void/production/purchase/waste/adjustment) | Session 1 | Étendue : nouveaux types + colonnes (sections, unit, supplier, idempotency, reason, unit_cost, metadata) |
| Table `products` (current_stock, cost_price, unit) | Session 1 | Étendue : min_stock_threshold |
| RPC `complete_order_with_payment` v8 + void/refund | Session 10 | **Inchangés** — continuent de décrémenter inline |
| Table `suppliers` | Session 11 | FK target stock_movements.supplier_id |
| Table `audit_log` | Session 12 hardening | Cible audit row systématique pour mouvements admin |
| Table `categories` | Session 1 | Filtre stock par catégorie |
| Tables `journal_entries` + `journal_entry_lines` | Session 1 (accounting) | Cible des triggers JE inventory |
| Function `check_fiscal_period_open` | Session accounting | Garde dans triggers JE |
| Function `has_permission()` | Sessions 5-11 (v6/v7) | Bumpée v8 pour ajouter 12 perms inventory.* |

---

## 9. Roadmap post-session 12

Cette session livre l'inventory complète conforme à la [référence Inventory](../../reference/04-modules/06-inventory-stock.md). Les évolutions futures :

- **Session 13** : Reports module — stock valuation, slow movers, top wasters, on-time delivery, exports XLSX/PDF (Module 14)
- **Session 14** : Multi-branch — table `branches`, ALTER `stock_movements ADD COLUMN branch_id`, transfer inter-branch
- **Session 15** : Stock reservations B2B — `stock_reservations`, `get_available_stock_v1`, expiration cleanup
- **Session 16** : Recipes récursifs (semi-finis) — `record_production_v1` cascade automatique sur les semi-finis
- **Session 17** : Batch / lot / expiration tracking (FEFO) — `stock_batches`, routing par DLC
- **Session 18** : Prévision de demande — modèle simple ARIMA / lissage exponentiel pour `get_reorder_suggestions_v2`
- **Session 19** : Mobile inventory app (Capacitor) — scanner barcode, opname terrain, transfer scan-to-receive

---

## 10. Glossaire

| Terme | Définition |
|---|---|
| **Section** | Zone fonctionnelle physique de la boutique (warehouse, kitchen, sales) |
| **Location** | Emplacement précis sous une section (rayon, étagère, frigo) — optionnel |
| **Movement** | Variation de stock signée inscrite dans le ledger immutable `stock_movements` |
| **Recipe / BOM** | Bill of Materials — produit fini → N ingrédients × quantités |
| **Production record** | Header d'une fournée — déclenche déduction matières + ajout produit fini |
| **Opname** | Inventaire physique d'une section avec saisie comptée → écarts |
| **Variance** | Écart entre quantité comptée et quantité système attendue |
| **Section stock** | Cache dénormalisé `(section_id, product_id, quantity)` pour la vue par section |
| **Idempotency key** | UUID client-side qui garantit qu'un appel répété ne crée pas de doublon |
| **JE** | Journal Entry — écriture comptable double-entrée |
| **COGS** | Cost of Goods Sold — coût des marchandises vendues / produites / perdues |
| **FEFO** | First Expired First Out — péremption-based routing (NON supporté V2/V3) |

---

**Fin du spec.** Décomposition en 8 sous-phases : [`../plans/2026-05-12-session-12-inventory-complete-INDEX.md`](../plans/2026-05-12-session-12-inventory-complete-INDEX.md).
