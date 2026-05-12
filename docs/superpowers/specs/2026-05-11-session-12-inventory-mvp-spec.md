# The Breakery — Session 12 Spec : Inventory MVP (admin write path) — **SUPERSEDED**

> ⚠️ **STATUT : SUPERSEDED (2026-05-12)** — ce spec MVP couvrait ~15% du périmètre métier décrit dans `docs/objectif travail/INVENTORY.md`. Il est remplacé par :
> - **Spec complete** : `docs/superpowers/specs/2026-05-12-session-12-inventory-complete-spec.md`
> - **Plan-INDEX complete** : `docs/superpowers/plans/2026-05-12-session-12-inventory-complete-INDEX.md`
>
> Le contenu ci-dessous est conservé à titre **historique** (sert de référence pour la Phase 1 + Phase 2 de l'INDEX complete, qui implémentent le même périmètre minimal en première étape avant d'élargir aux 7 onglets).

---

# The Breakery — Session 12 Spec : Inventory MVP (admin write path)

> **Date** : 2026-05-11
> **Auteur** : guichduh33@gmail.com (suite session 11)
> **Statut** : ⚠️ Superseded — voir `2026-05-12-session-12-inventory-complete-spec.md`
> **Cible** : Compléter la couche admin du module Inventory — 4 RPCs (`record_stock_movement_v1` interne + `adjust_stock_v1` + `receive_stock_v1` + `waste_stock_v1`) + 1 RPC read (`get_stock_levels_v1`) + page backoffice (list + 3 modals + history drawer) + domain package pur + 30+ tests. Auto-decrement on sale est **déjà** câblé depuis session 1 ; cette session ferme le gap "admin sans accès DB".

---

## 0. Contexte

Le pipeline POS écrit déjà des `stock_movements` automatiquement à chaque vente (`complete_order_with_payment` v8), void (`void_order_rpc`) et refund partiel (`refund_order_rpc`). La table `stock_movements` existe depuis session 1 (`20260503000004_init_inventory.sql`) avec un enum `movement_type` couvrant : `sale`, `sale_void`, `production`, `purchase`, `waste`, `adjustment`. Le cache `products.current_stock DECIMAL(10,3)` reflète en temps réel le solde signé.

Ce qui manque : **l'écriture admin** — un manager qui veut ajuster un comptage physique, enregistrer une réception fournisseur, ou marquer une perte (waste) n'a aujourd'hui qu'un accès DB brut. Cette session livre :

- 4 RPCs SECURITY DEFINER versionnés (`record_stock_movement_v1` interne + 3 wrappers typés `adjust_stock_v1` / `receive_stock_v1` / `waste_stock_v1`)
- 1 RPC read paginé (`get_stock_levels_v1`) pour la list filtrable
- Permissions module `inventory.{read,adjust,receive,waste}` seedées sur MANAGER+ (sauf `adjust` réservé ADMIN+)
- RLS lockdown : `SELECT` perm-gated, `INSERT/UPDATE/DELETE` révoqués (RPCs SECURITY DEFINER uniquement)
- Idempotency UUID + audit_log row pour chaque mouvement admin
- Page BO `/backoffice/inventory` (list + filtres + low-stock badge)
- 3 modals (Adjust / Receive / Waste) + History drawer
- Package `packages/domain/src/inventory/` (validators, computeNewStock, classifyMovement — pure TS)
- 14 pgTAP + ~24 Vitest domain + 5 Vitest BO + 1 smoke

Cette session **ne touche pas** :
- Multi-branch / transfers entre dépôts (besoin `branches` table — déféré session 15)
- Product variants (size/color — pas de `product_variants` schema — déféré)
- Purchase orders / GRN headers (les `purchase` movements restent flat MVP)
- Recipes / BOM auto-decrement (ingrédients → besoin table `recipes` — session 13+)
- Stock opname / cycle count session (addendum si demande)
- Batch / expiration tracking (FIFO/LIFO — out of MVP)
- Reports inventory (valuation, slow movers — session 14)
- Modification de `complete_order` / `void_order_rpc` / `refund_order_rpc` (déjà câblés — aucune régression introduite)

---

## 1. Décisions actées

| # | Décision | Choix |
|---|---|---|
| **C1** | Source of truth | `stock_movements` (append-only ledger signé) + cache `products.current_stock` synchronisé inline par les RPCs existants. **Pas de nouvelle table `stock_quantities`** (duplication du cache). **Pas de table `branches`** (single-site MVP). |
| **C2** | Réutilisation enum | Aucun nouveau `movement_type` ajouté. `adjustment` couvre comptages manuels, `purchase` couvre réceptions, `waste` couvre pertes. Pas de `transfer_in/out` (différé multi-branch). |
| **C3** | Auto-decrement | **Pas de modification** des RPCs existants. `complete_order_with_payment` v8 + `void_order_rpc` + `refund_order_rpc` continuent d'écrire `stock_movements` + update `products.current_stock` inline en transaction. Trigger aurait risqué double-decrement + fire sur draft orders. Pattern RPC-as-source-of-truth conforme CLAUDE.md. |
| **C4** | RPC versioning | Tous les nouveaux RPCs sont `_v1` (jamais versionnés auparavant). Chaque RPC = migration séparée (convention sessions précédentes). |
| **C5** | Idempotency | Colonne `idempotency_key UUID UNIQUE` (NULL OK pour rows legacy — Postgres autorise multiples NULL). Replay d'un RPC admin avec même clé → retourne le `movement_id` existant, pas de doublon. |
| **C6** | Reason enforcement | CHECK constraint : `movement_type IN ('sale','sale_void')` OR `reason IS NOT NULL AND length(trim(reason)) >= 3`. Forensique traceable pour tout mouvement admin. |
| **C7** | RLS lockdown | `ENABLE ROW LEVEL SECURITY`, SELECT policy `has_permission(auth.uid(), 'inventory.read')`, `REVOKE INSERT, UPDATE, DELETE ON stock_movements FROM authenticated`. Seuls les RPCs SECURITY DEFINER écrivent. |
| **C8** | RBAC | `inventory.read` / `inventory.receive` / `inventory.waste` seedés MANAGER+ADMIN+SUPER_ADMIN. `inventory.adjust` réservé ADMIN+SUPER_ADMIN (ajustement = peut créer du stock sans paper trail fournisseur). Audit_log row systématique. **Implementation note** : `has_permission()` actuel (v6) hardcode les whitelists par rôle ; insérer dans `role_permissions` ne suffit PAS → migration 4 doit bumper `has_permission` (et son miroir `has_permission_for_profile`) en v7 pour ajouter `inventory.read/receive/waste` au whitelist MANAGER. ADMIN+ couverts par la branche unconditional-true. |
| **C9** | Negative stock | `adjust_stock_v1` refuse `p_new_qty < 0`. `waste_stock_v1` refuse `qty > current_stock` (P0002 `insufficient_stock`). `complete_order` continue de refuser via son check existant. |
| **C10** | Concurrency | `SELECT ... FOR UPDATE` sur la row `products` dans chaque RPC admin (cohérent avec `complete_order` v8). pgTAP test concurrent adjust + sale → final stock = somme deltas (no lost update). |
| **C11** | Supplier link | Colonne optionnelle `stock_movements.supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL` + CHECK `supplier_id IS NULL OR movement_type='purchase'`. |
| **C12** | Low-stock UX | Colonne optionnelle `products.min_stock_threshold DECIMAL(10,3) DEFAULT 0`. BO liste affiche badge rouge quand `current_stock < min_stock_threshold AND min_stock_threshold > 0`. POS badge = polish optionnel non bloquant. |
| **C13** | Sidebar BO | `BackofficeLayout` ajoute entrée "Inventory" dans le groupe "Operations" (sous "Suppliers"). PermissionGate `inventory.read`. Le placeholder `ComingSoonPage` actuel route `/inventory` est remplacé. |
| **C14** | Pattern de référence | Hooks/modals/drawer suivent le pattern `apps/backoffice/src/features/loyalty/` (sessions 3 + 11) — c'est le template adjust-with-reason le plus proche fonctionnellement. |

---

## 2. Stack additions

| Addition | Raison |
|---|---|
| Aucun nouveau package npm | Tout via Supabase JS + react-query + Zod existants |
| 1 nouvelle route `/backoffice/inventory` | Remplace le `<ComingSoonPage module="Inventory" />` actuel (`apps/backoffice/src/routes/index.tsx:52`), wrap dans `<PermissionGate required="inventory.read">` |
| 5 RPCs Postgres | `record_stock_movement_v1` (interne), `adjust_stock_v1`, `receive_stock_v1`, `waste_stock_v1`, `get_stock_levels_v1` |
| 4 perms | `inventory.read`, `inventory.adjust`, `inventory.receive`, `inventory.waste` |
| 1 nouveau package domain submodule | `packages/domain/src/inventory/` (types + validators + computeurs purs) |
| 6 hooks TanStack Query | `useStockLevels`, `useStockMovements`, `useAdjustStock`, `useReceiveStock`, `useWasteStock`, `useProductsForInventory` |
| 5 composants UI | `InventoryListPage`, `AdjustModal`, `ReceiveModal`, `WasteModal`, `MovementHistoryDrawer` |
| 2 colonnes ALTER | `stock_movements.{reason, unit_cost, idempotency_key, supplier_id}` + `products.min_stock_threshold` |

---

## 3. Schéma DB — additions

### 3.1 Migrations à créer

```
20260516000001_extend_stock_movements_reason.sql       # ALTER : +reason, +unit_cost, +idempotency_key + DROP NOT NULL reference_id + CHECKs + index
20260516000002_link_stock_movements_supplier.sql       # ALTER : +supplier_id FK + CHECK + index partiel
20260516000003_init_stock_movements_rls.sql            # DROP auth_read policy + perm_read policy + REVOKE writes
20260516000004_seed_inventory_perms.sql                # 4 perms + role_permissions seed + has_permission v7 + has_permission_for_profile v7
20260516000005_add_products_min_stock.sql              # ALTER products : +min_stock_threshold
20260516000006_create_record_stock_movement_rpc.sql    # RPC interne — primitive
20260516000007_create_adjust_stock_rpc.sql             # RPC ADMIN+
20260516000008_create_receive_stock_rpc.sql            # RPC MANAGER+
20260516000009_create_waste_stock_rpc.sql              # RPC MANAGER+
20260516000010_create_get_stock_levels_rpc.sql         # RPC read paginé
```

### 3.2 ALTER stock_movements (migration 1)

```sql
ALTER TABLE stock_movements
  ADD COLUMN reason          TEXT,
  ADD COLUMN unit_cost       DECIMAL(14,2) CHECK (unit_cost IS NULL OR unit_cost >= 0),
  ADD COLUMN idempotency_key UUID UNIQUE;

-- reference_id was NOT NULL in session 1 (orders/refunds always carry an id).
-- Admin movements (adjustment/purchase/waste) have no parent reference → allow NULL,
-- but keep NOT NULL semantics for sale/sale_void via a partial CHECK.
ALTER TABLE stock_movements ALTER COLUMN reference_id DROP NOT NULL;

ALTER TABLE stock_movements
  ADD CONSTRAINT chk_stock_movements_reference_required_for_orders CHECK (
    movement_type NOT IN ('sale', 'sale_void')
    OR reference_id IS NOT NULL
  );

ALTER TABLE stock_movements
  ADD CONSTRAINT chk_stock_movements_reason_required CHECK (
    movement_type IN ('sale', 'sale_void')
    OR (reason IS NOT NULL AND length(trim(reason)) >= 3)
  );

CREATE INDEX idx_stock_movements_type_date
  ON stock_movements(movement_type, created_at DESC);

COMMENT ON COLUMN stock_movements.reason           IS 'Required for admin types (adjustment/waste/purchase/production). Free text >= 3 chars.';
COMMENT ON COLUMN stock_movements.unit_cost        IS 'Optional COGS per unit for purchase/production (informational MVP).';
COMMENT ON COLUMN stock_movements.idempotency_key  IS 'Client-supplied UUID to safely retry admin RPCs.';
```

### 3.3 ALTER stock_movements supplier (migration 2)

```sql
ALTER TABLE stock_movements
  ADD COLUMN supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL;

ALTER TABLE stock_movements
  ADD CONSTRAINT chk_supplier_only_on_purchase CHECK (
    supplier_id IS NULL OR movement_type = 'purchase'
  );

CREATE INDEX idx_stock_movements_supplier
  ON stock_movements(supplier_id, created_at DESC)
  WHERE supplier_id IS NOT NULL;
```

### 3.4 RLS lockdown (migration 3)

```sql
ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;

-- Note: replaces the permissive auth_read policy from 20260503000007_init_rls.sql
DROP POLICY IF EXISTS "auth_read" ON stock_movements;

CREATE POLICY "perm_read" ON stock_movements FOR SELECT
  USING (has_permission(auth.uid(), 'inventory.read'));

-- Lock writes to SECURITY DEFINER RPCs only
REVOKE INSERT, UPDATE, DELETE ON stock_movements FROM authenticated;
```

### 3.5 Perms seed + has_permission v7 (migration 4)

```sql
-- 1) Seed permission rows
INSERT INTO permissions (code, module, action, description) VALUES
  ('inventory.read',    'inventory', 'read',   'View stock levels + movement history'),
  ('inventory.adjust',  'inventory', 'update', 'Manual stock adjustment (count correction)'),
  ('inventory.receive', 'inventory', 'create', 'Record stock receipt from supplier (purchase)'),
  ('inventory.waste',   'inventory', 'update', 'Record stock waste / spoilage')
ON CONFLICT (code) DO NOTHING;

-- 2) Seed role_permissions (documentary; the actual gate is has_permission v7 below)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='role_permissions') THEN
    EXECUTE $q$
      INSERT INTO role_permissions (role_code, permission_code) VALUES
        ('MANAGER',     'inventory.read'),
        ('MANAGER',     'inventory.receive'),
        ('MANAGER',     'inventory.waste'),
        ('ADMIN',       'inventory.read'),
        ('ADMIN',       'inventory.adjust'),
        ('ADMIN',       'inventory.receive'),
        ('ADMIN',       'inventory.waste'),
        ('SUPER_ADMIN', 'inventory.read'),
        ('SUPER_ADMIN', 'inventory.adjust'),
        ('SUPER_ADMIN', 'inventory.receive'),
        ('SUPER_ADMIN', 'inventory.waste')
      ON CONFLICT DO NOTHING
    $q$;
  END IF;
END $$;

-- 3) has_permission v7 — adds inventory.{read,receive,waste} to MANAGER whitelist.
--    inventory.adjust covered by the unconditional ADMIN/SUPER_ADMIN branch.
--    Pattern : strict copy of 20260514000003_seed_loyalty_perms.sql v6 with 3 lines added.
CREATE OR REPLACE FUNCTION has_permission(p_uid UUID, p_perm TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_role TEXT;
BEGIN
  SELECT role_code INTO v_role FROM user_profiles WHERE auth_user_id = p_uid AND deleted_at IS NULL;
  IF v_role IS NULL THEN RETURN false; END IF;
  RETURN CASE
    WHEN v_role IN ('SUPER_ADMIN','ADMIN') THEN true
    WHEN v_role = 'MANAGER' THEN p_perm IN (
      -- carried from v6 :
      'pos.session.open','pos.session.close_own','pos.session.close_other',
      'pos.session.view_all','pos.sale.create','pos.sale.void','pos.sale.update',
      'pos.sale.refund','pos.sale.cancel_item',
      'products.read','products.create','products.update','payments.process','sales.discount',
      'promotions.read','promotions.create','promotions.update',
      'categories.read','categories.create','categories.update',
      'customers.read','customers.create','customers.update',
      'tables.read','tables.create','tables.update',
      'combos.read','combos.create','combos.update',
      'suppliers.read','suppliers.create','suppliers.update',
      'loyalty.read',
      -- v7 additions :
      'inventory.read','inventory.receive','inventory.waste'
    )
    WHEN v_role = 'CASHIER' THEN p_perm IN (
      'pos.session.open','pos.session.close_own','pos.sale.create','products.read','payments.process'
    )
    WHEN v_role = 'waiter' THEN p_perm IN ('sales.create','products.read')
    ELSE false
  END;
END $$;
COMMENT ON FUNCTION has_permission IS
  'v7 (session 12 inventory MVP): adds inventory.read/receive/waste to MANAGER. inventory.adjust covered by ADMIN/SUPER_ADMIN unconditional branch.';

-- Mirror has_permission_for_profile with the same matrix.
CREATE OR REPLACE FUNCTION has_permission_for_profile(p_profile_id UUID, p_perm TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_role TEXT;
BEGIN
  SELECT role_code INTO v_role FROM user_profiles WHERE id = p_profile_id AND deleted_at IS NULL;
  IF v_role IS NULL THEN RETURN false; END IF;
  RETURN CASE
    WHEN v_role IN ('SUPER_ADMIN','ADMIN') THEN true
    WHEN v_role = 'MANAGER' THEN p_perm IN (
      'pos.session.open','pos.session.close_own','pos.session.close_other',
      'pos.session.view_all','pos.sale.create','pos.sale.void','pos.sale.update',
      'pos.sale.refund','pos.sale.cancel_item',
      'products.read','products.create','products.update','payments.process','sales.discount',
      'promotions.read','promotions.create','promotions.update',
      'categories.read','categories.create','categories.update',
      'customers.read','customers.create','customers.update',
      'tables.read','tables.create','tables.update',
      'combos.read','combos.create','combos.update',
      'suppliers.read','suppliers.create','suppliers.update',
      'loyalty.read',
      'inventory.read','inventory.receive','inventory.waste'
    )
    WHEN v_role = 'CASHIER' THEN p_perm IN (
      'pos.session.open','pos.session.close_own','pos.sale.create','products.read','payments.process'
    )
    WHEN v_role = 'waiter' THEN p_perm IN ('sales.create','products.read')
    ELSE false
  END;
END $$;
```

### 3.6 RPC signatures

```sql
-- internal primitive (called from typed wrappers only; rejects sale/sale_void types)
record_stock_movement_v1(
  p_product_id      UUID,
  p_movement_type   movement_type,
  p_quantity        DECIMAL(10,3),    -- SIGNED: + for IN, - for OUT
  p_reason          TEXT,
  p_unit_cost       DECIMAL(14,2)  DEFAULT NULL,
  p_supplier_id     UUID           DEFAULT NULL,
  p_idempotency_key UUID           DEFAULT NULL
) RETURNS JSONB

-- ADMIN+. Computes delta = new_qty - current_stock. No-op if delta=0.
adjust_stock_v1(
  p_product_id      UUID,
  p_new_qty         DECIMAL(10,3),
  p_reason          TEXT,
  p_idempotency_key UUID DEFAULT NULL
) RETURNS JSONB

-- MANAGER+. Requires qty > 0 + supplier active.
receive_stock_v1(
  p_product_id      UUID,
  p_quantity        DECIMAL(10,3),
  p_supplier_id     UUID,
  p_unit_cost       DECIMAL(14,2) DEFAULT NULL,
  p_reason          TEXT          DEFAULT NULL,  -- default: "Receipt from <supplier code>"
  p_idempotency_key UUID          DEFAULT NULL
) RETURNS JSONB

-- MANAGER+. Requires qty > 0 AND current_stock >= qty.
waste_stock_v1(
  p_product_id      UUID,
  p_quantity        DECIMAL(10,3),
  p_reason          TEXT,
  p_idempotency_key UUID DEFAULT NULL
) RETURNS JSONB

-- Read paginated, filterable
get_stock_levels_v1(
  p_category_id     UUID    DEFAULT NULL,
  p_search          TEXT    DEFAULT NULL,    -- ILIKE name + sku
  p_low_stock_only  BOOLEAN DEFAULT false,
  p_limit           INT     DEFAULT 50,
  p_offset          INT     DEFAULT 0
) RETURNS TABLE (
  product_id           UUID,
  sku                  TEXT,
  name                 TEXT,
  category_id          UUID,
  category_name        TEXT,
  current_stock        DECIMAL(10,3),
  min_stock_threshold  DECIMAL(10,3),
  last_movement_at     TIMESTAMPTZ,
  total_count          BIGINT
)
```

Tous les RPCs admin :
- `SECURITY DEFINER`, `SET search_path = public`
- Guard `auth.uid() IS NOT NULL` + `has_permission(auth.uid(), '<perm>')` check (raise `forbidden` P0003)
- `SELECT ... FOR UPDATE` sur la row `products` (lock)
- INSERT `stock_movements` + UPDATE `products.current_stock` en même TX
- INSERT `audit_log (action, subject_table, subject_id, payload, actor_profile_id)` — colonne réelle est `actor_profile_id` (cf. `20260515000002_init_audit_log.sql`), PAS `performed_by`
- Idempotent replay via `idempotency_key UNIQUE`
- Sign mismatch rejection : `purchase` qty doit être > 0, `waste` qty < 0 (négation interne), `adjustment` libre

**EXECUTE grants** (sécurité critique) :
- `record_stock_movement_v1` est **interne** : `REVOKE EXECUTE ON FUNCTION record_stock_movement_v1 FROM PUBLIC, authenticated;` à la fin de sa migration. Comme c'est `SECURITY DEFINER` et qu'il ne fait pas de perm-check (les wrappers s'en chargent), il DOIT être inaccessible aux rôles authentifiés sinon bypass des wrappers possible.
- `adjust_stock_v1`, `receive_stock_v1`, `waste_stock_v1`, `get_stock_levels_v1` : `REVOKE EXECUTE ... FROM PUBLIC;` + `GRANT EXECUTE ... TO authenticated;` à la fin de chaque migration (pattern `adjust_loyalty_points` v6, lignes 91-92).
- pgTAP T15 vérifie que `record_stock_movement_v1` raise sur appel direct par role `authenticated`.

### 3.7 ALTER products (migration 5)

```sql
ALTER TABLE products
  ADD COLUMN min_stock_threshold DECIMAL(10,3) NOT NULL DEFAULT 0
    CHECK (min_stock_threshold >= 0);

COMMENT ON COLUMN products.min_stock_threshold IS 'Low-stock UI badge trigger. 0 = disabled (no badge).';
```

---

## 4. Frontend additions

### 4.1 Backoffice

**Routes** : `apps/backoffice/src/routes/index.tsx` (ligne 52) — remplacer `<ComingSoonPage module="Inventory" />` par `<InventoryPage />`. Wrap dans `<PermissionGate required="inventory.read">`.

**Sidebar** : `apps/backoffice/src/layouts/BackofficeLayout.tsx` (ligne 25) — l'entrée "Inventory" existe déjà ; ajouter `permission: 'inventory.read'` et déplacer dans le groupe "Operations". Icône `Package` (lucide-react).

**Pages** : `apps/backoffice/src/pages/Inventory.tsx`
- Header : filtres (Search ILIKE name/sku, Category dropdown, Low-stock toggle)
- Toolbar : `[+ Adjust]` (perm `inventory.adjust`), `[+ Receive]` (perm `inventory.receive`), `[+ Waste]` (perm `inventory.waste`)
- Table : SKU, Name, Category, On hand (+ low-stock badge), Last movement, Actions (View history / Adjust / Receive / Waste)
- Pagination 50/page via `get_stock_levels_v1`

**Feature folder** : `apps/backoffice/src/features/inventory/`

```
components/
  AdjustModal.tsx           # Form : new_qty + reason + delta preview
  ReceiveModal.tsx          # Form : product typeahead + supplier dropdown + qty + unit_cost + reason
  WasteModal.tsx            # Form : product + qty (capped at current_stock) + reason (select+free)
  MovementHistoryDrawer.tsx # Slide-in, paginated list of movements for one product
  StockLevelRow.tsx         # Table row component
  LowStockBadge.tsx         # Red badge if current_stock < min_stock_threshold > 0
hooks/
  useStockLevels.ts         # TanStack Query → rpc('get_stock_levels_v1', filters)
  useStockMovements.ts      # TanStack Query → table('stock_movements').eq(product_id, ...).range(...)
  useAdjustStock.ts         # TanStack Mutation → rpc('adjust_stock_v1', ...) + invalidate + audit
  useReceiveStock.ts        # Mutation → rpc('receive_stock_v1', ...)
  useWasteStock.ts          # Mutation → rpc('waste_stock_v1', ...)
  useProductsForInventory.ts # typeahead helper for ReceiveModal/WasteModal
```

Patterns à reproduire (références exactes) :
- Adjust pattern : `apps/backoffice/src/features/loyalty/hooks/useAdjustLoyaltyPoints.ts`
- History drawer pattern : `apps/backoffice/src/features/loyalty/hooks/useCustomerLoyaltyHistory.ts`
- Page layout pattern : `apps/backoffice/src/pages/Loyalty.tsx`

### 4.2 POS

Aucune modification UI bloquante. Optionnel (polish) : `apps/pos/src/features/catalog/components/ProductCard.tsx` — afficher un badge "Low stock" si `current_stock < min_stock_threshold && min_stock_threshold > 0`. **Non bloquant pour acceptance**.

### 4.3 Domain package (`packages/domain/src/inventory/`)

```
index.ts                  # barrel
types.ts                  # MovementType, StockMovement, StockLevel, AdjustmentInput, ReceiveInput, WasteInput, ValidationResult
computeNewStock.ts        # (current: number, signedDelta: number) => number
classifyMovement.ts       # (mvt: StockMovement) => { direction: 'IN'|'OUT', isSale, isAdmin }
validateAdjust.ts         # AdjustmentInput → ValidationResult
validateReceive.ts        # ReceiveInput → ValidationResult
validateWaste.ts          # WasteInput (needs currentStock) → ValidationResult
computeStockDelta.ts      # (movements: StockMovement[]) => number  (sum signed)
lowStockFilter.ts         # (products: Product[]) => Product[]
__tests__/
  computeNewStock.test.ts
  validateAdjust.test.ts
  validateReceive.test.ts
  validateWaste.test.ts
  classifyMovement.test.ts
  computeStockDelta.test.ts
  lowStockFilter.test.ts
```

Pure TS, IO-free, fully unit-testable. Exporté via `packages/domain/src/index.ts`.

### 4.4 packages/supabase

- Régénérer `packages/supabase/src/types.generated.ts` via `pnpm db:types` après les migrations. Commit le diff.
- Étendre `packages/supabase/src/rls/permissions.ts` `PermissionCode` union avec les 4 nouvelles perms.

---

## 5. Tests matrix

### 5.1 pgTAP (`supabase/tests/inventory.test.sql` + extension de `supabase/tests/functions/inventory-rls.test.ts`)

| # | Test | Asserts |
|---|---|---|
| T1 | `record_stock_movement_v1` rejette `sale` movement_type | `throws_ok` |
| T2 | `record_stock_movement_v1` rejette `quantity = 0` | `throws_ok` |
| T3 | `adjust_stock_v1` happy path 10→15 | `current_stock=15`, movement signé +5, audit_log row |
| T4 | `adjust_stock_v1` idempotent (même `p_idempotency_key`) | 1 seule row movement, même `movement_id` retourné |
| T5 | `adjust_stock_v1` sans perm `inventory.adjust` | `throws_ok` P0003 |
| T6 | `adjust_stock_v1` `p_new_qty < 0` | `throws_ok` |
| T7 | `receive_stock_v1` happy path + supplier link | `quantity > 0`, `supplier_id` set, movement_type=`purchase` |
| T8 | `receive_stock_v1` supplier inactif/inexistant | `throws_ok` P0002 |
| T9 | `waste_stock_v1` qty > on-hand | `throws_ok` P0002 `insufficient_stock` |
| T10 | `waste_stock_v1` happy path | `current_stock` decremented, movement `-qty` |
| T11 | RLS : direct INSERT/UPDATE/DELETE bloqué pour `authenticated` | RLS denied |
| T12 | `get_stock_levels_v1` filtre `low_stock_only` | retourne uniquement rows avec `current_stock < min_stock_threshold > 0` |
| T13 | Concurrent `adjust` + sale serializés via row lock | final stock = somme deltas (no lost update) |
| T14 | `void_order_rpc` + `refund_order_rpc` sanity (regression) | inserts `sale_void` movements, restaure `current_stock` |
| T15 | `record_stock_movement_v1` invoqué directement par role `authenticated` | `throws_ok` permission denied (REVOKE EXECUTE en place) |
| T16 | `adjust_stock_v1` concurrent + sale via 2 connections (Vitest live, `supabase/tests/functions/inventory-concurrent.test.ts`) | Final stock = somme deltas (FOR UPDATE row lock évite lost update) |

### 5.2 Vitest domain (`packages/domain/src/inventory/__tests__/`)

~24 unit tests : 4-6 cases × 6 validators/computers. Target 100% line coverage validators.

### 5.3 Vitest backoffice

| Fichier | Scenario |
|---|---|
| `apps/backoffice/src/pages/__tests__/Inventory.test.tsx` | Liste rend, filter category, toggle low-stock, pagination |
| `apps/backoffice/src/features/inventory/__tests__/AdjustModal.test.tsx` | Validation form, delta preview, submit appelle hook |
| `apps/backoffice/src/features/inventory/__tests__/ReceiveModal.test.tsx` | Supplier typeahead, qty validation, unit_cost optional |
| `apps/backoffice/src/features/inventory/__tests__/WasteModal.test.tsx` | Qty cap at current_stock, reason required |
| `apps/backoffice/src/__tests__/inventory.smoke.test.tsx` | E2E flow : login MANAGER → list → receive 20 → waste 3 → ADMIN re-login → adjust to 50 → history shows 3 rows |

**Cible** : ~30 tests nouveaux. Suite totale ≥ 650 passing (sessions 1-11 = ~620).

---

## 6. Critères d'acceptation

- [ ] Les 10 migrations s'appliquent sans erreur sur `pnpm db:reset`
- [ ] `pnpm typecheck` 0 erreur ; `pnpm lint` 0 warning ; `pnpm build` succès POS + backoffice
- [ ] `pnpm test` passe ≥ 30 nouveaux tests (domain + pgTAP + backoffice)
- [ ] **RLS lockdown** : un user `authenticated` ne peut PAS faire un INSERT/UPDATE/DELETE direct sur `stock_movements` (test psql en role `authenticated` → permission denied)
- [ ] **Idempotency** : 2 appels `adjust_stock_v1` avec même `p_idempotency_key` → 1 seule row movement, même `movement_id` retourné
- [ ] **Reason CHECK** : INSERT direct `stock_movements (movement_type='waste', reason=NULL)` → CHECK violation
- [ ] **Concurrency** : pgTAP T13 vert (row lock sur products serialize adjust + sale)
- [ ] **Backoffice UI MANAGER** : login MANAGER → `/backoffice/inventory` liste tous les produits avec `current_stock` + badge low-stock (si seuil configuré). Receive 20 unités produit X → row mise à jour. Waste 3 → row mise à jour. Bouton "Adjust" est **désactivé/caché** (perm refusée).
- [ ] **Backoffice UI ADMIN** : re-login ADMIN → bouton "Adjust" visible → ouvre AdjustModal → set produit Y à count=50 → success → row update → ouvrir History drawer → mouvement `adjustment` visible avec delta + reason
- [ ] **Regression POS** : checkout existant décrémente toujours via `complete_order_with_payment` v8 (smoke `pos-checkout.smoke.test.tsx` toujours vert). Void/refund restaurent toujours (smokes existants verts).
- [ ] **Permissions matrix** : CASHIER → `/backoffice/inventory` → redirect (perm refusée, pas d'entrée sidebar). MANAGER → Receive/Waste visible, Adjust caché. ADMIN → tout visible.
- [ ] `packages/supabase/src/types.generated.ts` régénéré et committé
- [ ] Commits conventional + co-author Claude : `feat(db|domain|ui|backoffice): session 12 — …`

---

## 7. Risques

| Risque | Mitigation |
|---|---|
| `products.current_stock` drift vs `SUM(stock_movements.quantity)` | pgTAP test de réconciliation en fin de run — assert égalité pour tous les produits. Drift → investiguer le RPC fautif. |
| `adjust_stock_v1` abusé pour "créer du stock" sans paper trail | ADMIN+ only. `audit_log` row systématique (`action='stock.movement'` + reason). Forensique complète. |
| Idempotency key NULL sur rows legacy | UNIQUE Postgres autorise multiples NULL → backward-compatible |
| Conflit de numéro de migration si autre session ajoute `branches` en parallèle | Spec explicite "single-branch assumed". Future session multi-branch (session 15) devra `ALTER stock_movements ADD COLUMN branch_id` + backfill |
| Lost update sur adjust + sale concurrent | `FOR UPDATE` sur row `products` dans tous les RPCs (cohérent `complete_order` v8). pgTAP T13 vérifie. |
| `min_stock_threshold` default 0 masque les alertes | UI ne montre le badge que quand `min_stock_threshold > 0` — false positives évités, manager configure par produit |
| Negative stock côté `adjust` | Bloqué via `p_new_qty >= 0` check explicite dans le RPC |
| DROP POLICY "auth_read" sur stock_movements pourrait casser réutilisations | Vérifier que la nouvelle `perm_read` couvre tous les call sites authentifiés. Tests pgTAP T11 + smoke. |
| `record_stock_movement_v1` bypass des wrappers via appel direct | `REVOKE EXECUTE FROM PUBLIC, authenticated` en fin de migration 6. pgTAP T15 vérifie. |
| `audit_log` colonne `actor_profile_id` (pas `performed_by`) | Convention documentée dans spec §3.6 et plan Task 2.1 ; tests pgTAP T3 assert qu'une row audit_log est créée avec le bon profile id. |

---

## 8. Dépendances sessions précédentes

| Dépendance | Origine | Usage session 12 |
|---|---|---|
| Table `stock_movements` | Session 1 migration `20260503000004_init_inventory.sql` | ALTER : +reason, +unit_cost, +idempotency_key, +supplier_id |
| Enum `movement_type` | Session 1 migration `20260503000000_init_extensions_enums.sql` | Réutilisé tel quel (pas d'extension) |
| Table `products` | Session 1 migration `20260503000002_init_catalog.sql` | ALTER : +min_stock_threshold |
| RPC `complete_order_with_payment` v8 | Session 10 | **Inchangé** — continue de décrémenter inline |
| RPC `void_order_rpc` + `refund_order_rpc` | Session 10 | **Inchangés** — continue de restaurer inline |
| Table `suppliers` | Session 11 migration `20260513000001_init_suppliers.sql` | FK target pour `stock_movements.supplier_id` |
| Table `audit_log` | Session 12 hardening migration `20260515000002_init_audit_log.sql` | Cible pour les audit rows |
| Fonctions `has_permission()` + `is_authenticated()` | Sessions 5-10 | Réutilisées dans RLS + RPCs |

---

## 9. Roadmap post-session 12

Cette session ferme uniquement l'admin write path en MVP. Les sessions suivantes ouvrent :

- **Session 13** : Recipes / BOM — auto-decrement ingrédients sur vente combo (besoin table `recipes`, `recipe_ingredients`, modif `complete_order` v9)
- **Session 14** : Reports module — stock valuation, slow movers, top wasters, exports XLSX/PDF (Module 14) + low-stock alerts email Edge Function
- **Session 15** : Multi-branch — table `branches`, ALTER `stock_movements ADD COLUMN branch_id`, transfer RPCs, multi-cash drawer, hub-printing, POS lit stock par branche
- **Session 16** : Purchase orders / GRN headers — workflow PO → GRN → stock receipt avec quantités attendues vs reçues + cost layers FIFO/avg
- **Session 17** : Stock opname / cycle count — sessions de comptage, variance reports, lock par batch
- **Session 18+** : Batch / expiration tracking — `stock_batches`, FEFO routing

---

**Fin du spec.** Implémentation détaillée dans le plan : `docs/superpowers/plans/2026-05-11-session-12-inventory-mvp.md`.
