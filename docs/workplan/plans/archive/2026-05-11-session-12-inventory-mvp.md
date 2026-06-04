# Session 12 — Inventory MVP Implementation Plan — **SUPERSEDED**

> **Trace historique** : ce fichier documente une session de travail datée. Le fond reste l'enregistrement de cette date. Seules les références de chemin ont été alignées sur la nouvelle structure (voir [`../../README.md`](../../README.md)).
> **Last refreshed** : 2026-05-13

> **Module concerné** : ce plan correspond au module [Inventory & Stock](../../reference/04-modules/06-inventory-stock.md). Pour la spec consolidée actuelle (Partie I fonctionnel + Partie II technique + Partie III backlog + Partie IV design), aller à la référence canonique.

> ⚠️ **STATUT : SUPERSEDED (2026-05-12)** — ce plan MVP est remplacé par le plan-INDEX multi-phases :
> - **Plan-INDEX complete** : [`./2026-05-12-session-12-inventory-complete-INDEX.md`](./2026-05-12-session-12-inventory-complete-INDEX.md)
> - **Spec source complete** : [`../specs/2026-05-12-session-12-inventory-complete-spec.md`](../../specs/archive/2026-05-12-session-12-inventory-complete-spec.md)
>
> Les Phase 1 + Phase 2 du plan-INDEX implémentent le périmètre décrit ici (foundations + RPCs admin core), puis les phases 3-8 ajoutent Transfers, Production, Opname, Movements, Alertes, Dashboard, et le couplage comptable automatique pour livrer le module **Inventory complete** conforme à la [référence Inventory](../../reference/04-modules/06-inventory-stock.md) (Partie I §1-20).
>
> Le contenu ci-dessous est conservé à titre **historique**.

---

# Session 12 — Inventory MVP Implementation Plan

> **Date** : 2026-05-11
> **Statut** : ⚠️ Superseded — voir [`./2026-05-12-session-12-inventory-complete-INDEX.md`](./2026-05-12-session-12-inventory-complete-INDEX.md)
> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Livrer le module Inventory MVP — couche admin (4 RPCs : `record_stock_movement_v1` interne + `adjust_stock_v1` ADMIN+ + `receive_stock_v1` MANAGER+ + `waste_stock_v1` MANAGER+) + 1 RPC read paginé (`get_stock_levels_v1`) + page backoffice `/inventory` (list + 3 modals + history drawer) + domain package pur + 30+ tests. Auto-decrement on sale **déjà câblé** depuis session 1 — aucune modification des RPCs existants.

**Spec source:** [`../specs/2026-05-11-session-12-inventory-mvp-spec.md`](../../specs/archive/2026-05-11-session-12-inventory-mvp-spec.md)

**Référence canonique** : [`../../reference/04-modules/06-inventory-stock.md`](../../reference/04-modules/06-inventory-stock.md) — Partie I §1-20 (vue fonctionnelle), Partie II §21-34 (référence technique), Partie III (backlog → [`../backlog-by-module/06-inventory-stock.md`](../backlog-by-module/06-inventory-stock.md)), Partie IV §35-43 (design & UX).

**Architecture:** 10 migrations additives → domain pur (`packages/domain/src/inventory/`) → feature folder backoffice → wiring routes/sidebar/perms → tests pgTAP + Vitest → docs. Aucun edge function. Aucune modification de `complete_order` / `void_order_rpc` / `refund_order_rpc`. Pattern UI repris de `apps/backoffice/src/features/loyalty/` (adjust-with-reason).

**Tech Stack:** PostgreSQL + Supabase RLS, React + Vite + Vitest, TanStack Query, Tailwind, react-router-dom, supabase-js, lucide-react, Zod.

**Dépend de:** Sessions 1 (`stock_movements`, `movement_type`, `is_authenticated`), 10 (RPC `complete_order_with_payment` v8 + `void_order_rpc` + `refund_order_rpc`, inchangés), 11 (`suppliers` table + `has_permission()`), 12 hardening (`audit_log` table).

**Conventions :**
- Toutes les migrations datées `20260516xxxxxx` (après session 11 `20260515000004`).
- Tests SQL → mix pgTAP (`supabase/tests/inventory.test.sql`) + tests live Vitest (`supabase/tests/functions/inventory-*.test.ts`, pattern session 10/11).
- Tests domain/ui → co-localisés dans `__tests__/` à côté du code.
- Commits : `feat(db|domain|ui|backoffice): session 12 — …`. Co-author Claude.

**À la fin :**
- 4 RPCs admin SECURITY DEFINER + 1 RPC read paginé
- 4 nouvelles perms seedées + role mappings (MANAGER+ sauf `inventory.adjust` réservé ADMIN+)
- RLS lockdown sur `stock_movements` (writes via RPC uniquement)
- Page BO `/backoffice/inventory` fonctionnelle avec list + adjust + receive + waste + history
- Package domain `packages/domain/src/inventory/` (8 modules purs + 7 fichiers de tests)
- ≥30 nouveaux tests (suite ≥ 650 passing)
- `pnpm lint` 0 warning, `pnpm typecheck` 0 erreur, `pnpm build` succès POS + BO
- Tous les critères d'acceptation §6 du spec validés

---

## File Structure

| Action | Path |
|---|---|
| CREATE | `supabase/migrations/20260516000001_extend_stock_movements_reason.sql` |
| CREATE | `supabase/migrations/20260516000002_link_stock_movements_supplier.sql` |
| CREATE | `supabase/migrations/20260516000003_init_stock_movements_rls.sql` |
| CREATE | `supabase/migrations/20260516000004_seed_inventory_perms.sql` |
| CREATE | `supabase/migrations/20260516000005_add_products_min_stock.sql` |
| CREATE | `supabase/migrations/20260516000006_create_record_stock_movement_rpc.sql` |
| CREATE | `supabase/migrations/20260516000007_create_adjust_stock_rpc.sql` |
| CREATE | `supabase/migrations/20260516000008_create_receive_stock_rpc.sql` |
| CREATE | `supabase/migrations/20260516000009_create_waste_stock_rpc.sql` |
| CREATE | `supabase/migrations/20260516000010_create_get_stock_levels_rpc.sql` |
| REGEN  | `packages/supabase/src/types.generated.ts` (via `pnpm db:types`) |
| MODIFY | `packages/supabase/src/rls/permissions.ts` (add 4 codes to `PermissionCode` union) |
| CREATE | `packages/domain/src/inventory/types.ts` |
| CREATE | `packages/domain/src/inventory/computeNewStock.ts` |
| CREATE | `packages/domain/src/inventory/classifyMovement.ts` |
| CREATE | `packages/domain/src/inventory/validateAdjust.ts` |
| CREATE | `packages/domain/src/inventory/validateReceive.ts` |
| CREATE | `packages/domain/src/inventory/validateWaste.ts` |
| CREATE | `packages/domain/src/inventory/computeStockDelta.ts` |
| CREATE | `packages/domain/src/inventory/lowStockFilter.ts` |
| CREATE | `packages/domain/src/inventory/index.ts` |
| CREATE | `packages/domain/src/inventory/__tests__/{computeNewStock,classifyMovement,validateAdjust,validateReceive,validateWaste,computeStockDelta,lowStockFilter}.test.ts` |
| MODIFY | `packages/domain/src/index.ts` (re-export inventory module) |
| CREATE | `apps/backoffice/src/pages/Inventory.tsx` |
| CREATE | `apps/backoffice/src/features/inventory/components/{AdjustModal,ReceiveModal,WasteModal,MovementHistoryDrawer,StockLevelRow,LowStockBadge}.tsx` |
| CREATE | `apps/backoffice/src/features/inventory/hooks/{useStockLevels,useStockMovements,useAdjustStock,useReceiveStock,useWasteStock,useProductsForInventory}.ts` |
| MODIFY | `apps/backoffice/src/routes/index.tsx` (remplacer `<ComingSoonPage module="Inventory" />` par `<InventoryPage />` + `<PermissionGate>`) |
| MODIFY | `apps/backoffice/src/layouts/BackofficeLayout.tsx` (sidebar entry "Inventory" + `permission: 'inventory.read'` + groupe "Operations") |
| CREATE | `supabase/tests/inventory.test.sql` (pgTAP T1-T14) |
| CREATE | `supabase/tests/functions/inventory-rls.test.ts` (RLS sanity) |
| CREATE | `supabase/tests/functions/adjust-stock.test.ts` (RPC happy + perm + idempotency) |
| CREATE | `supabase/tests/functions/receive-stock.test.ts` |
| CREATE | `supabase/tests/functions/waste-stock.test.ts` |
| CREATE | `apps/backoffice/src/pages/__tests__/Inventory.test.tsx` |
| CREATE | `apps/backoffice/src/features/inventory/__tests__/{AdjustModal,ReceiveModal,WasteModal}.test.tsx` |
| CREATE | `apps/backoffice/src/__tests__/inventory.smoke.test.tsx` |

---

## Phase 1 — Database foundation

### Task 1.1 — Migration `extend_stock_movements_reason`

**Files:**
- Create: `supabase/migrations/20260516000001_extend_stock_movements_reason.sql`

- [ ] **Step 1: Créer le fichier de migration**

```sql
-- 20260516000001_extend_stock_movements_reason.sql
-- Session 12 / migration 1 : étendre stock_movements pour les admin movements
-- (reason + unit_cost + idempotency) ET autoriser reference_id NULL sur admin types.
-- Spec: docs/workplan/specs/2026-05-11-session-12-inventory-mvp-spec.md §3.2

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

COMMENT ON COLUMN stock_movements.reason          IS 'Required for admin types (adjustment/waste/purchase/production). Free text >= 3 chars.';
COMMENT ON COLUMN stock_movements.unit_cost       IS 'Optional COGS per unit for purchase/production (informational MVP).';
COMMENT ON COLUMN stock_movements.idempotency_key IS 'Client-supplied UUID to safely retry admin RPCs.';
```

- [ ] **Step 2: Appliquer**

```bash
pnpm db:reset
```

Expected: `Applied migration 20260516000001_extend_stock_movements_reason`.

### Task 1.2 — Migration `link_stock_movements_supplier`

**Files:**
- Create: `supabase/migrations/20260516000002_link_stock_movements_supplier.sql`

- [ ] **Step 1: Créer**

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

- [ ] **Step 2: Appliquer + valider FK + CHECK**

### Task 1.3 — Migration `init_stock_movements_rls`

**Files:**
- Create: `supabase/migrations/20260516000003_init_stock_movements_rls.sql`

- [ ] **Step 1: Créer (drop ancienne policy auth_read + nouvelle perm_read + revoke writes)**

```sql
ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY; -- idempotent if already on

-- Replace the permissive auth_read policy from session 1 (20260503000007_init_rls.sql)
DROP POLICY IF EXISTS "auth_read" ON stock_movements;

CREATE POLICY "perm_read" ON stock_movements FOR SELECT
  USING (has_permission(auth.uid(), 'inventory.read'));

REVOKE INSERT, UPDATE, DELETE ON stock_movements FROM authenticated;
-- SECURITY DEFINER RPCs continue to write via their owner role (postgres).
```

- [ ] **Step 2: Valider via psql en role `authenticated`** — INSERT direct refusé.

### Task 1.4 — Migration `seed_inventory_perms`

**Files:**
- Create: `supabase/migrations/20260516000004_seed_inventory_perms.sql`

- [ ] **Step 1: Insérer 4 permissions + role_permissions (documentaire) + bump has_permission v7**

CRITIQUE : `has_permission` v6 hardcode les whitelists par rôle (cf. `20260514000003_seed_loyalty_perms.sql`) et ne lit PAS `role_permissions`. Sans le bump v7, MANAGER ne pourra pas appeler les RPCs inventory même avec la row `role_permissions` seedée.

```sql
-- 1) Seed permission rows
INSERT INTO permissions (code, module, action, description) VALUES
  ('inventory.read',    'inventory', 'read',   'View stock levels + movement history'),
  ('inventory.adjust',  'inventory', 'update', 'Manual stock adjustment (count correction)'),
  ('inventory.receive', 'inventory', 'create', 'Record stock receipt from supplier (purchase)'),
  ('inventory.waste',   'inventory', 'update', 'Record stock waste / spoilage')
ON CONFLICT (code) DO NOTHING;

-- 2) Seed role_permissions (documentary — has_permission v7 below is the real gate;
--    role_permissions kept in sync for future generic perm-resolution).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
              WHERE table_schema='public' AND table_name='role_permissions') THEN
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
--    inventory.adjust covered by ADMIN/SUPER_ADMIN unconditional-true branch.
--    Strict copy of v6 from 20260514000003_seed_loyalty_perms.sql with 3 perms added.
CREATE OR REPLACE FUNCTION has_permission(p_uid UUID, p_perm TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_role TEXT;
BEGIN
  SELECT role_code INTO v_role FROM user_profiles WHERE auth_user_id = p_uid AND deleted_at IS NULL;
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

- [ ] **Step 2:** Appliquer + valider via `SELECT has_permission((SELECT auth_user_id FROM user_profiles WHERE role_code='MANAGER' LIMIT 1), 'inventory.read')` → `true`. Idem 'inventory.receive', 'inventory.waste'. 'inventory.adjust' pour MANAGER → `false`. ADMIN → tout `true`.

### Task 1.5 — Migration `add_products_min_stock`

**Files:**
- Create: `supabase/migrations/20260516000005_add_products_min_stock.sql`

```sql
ALTER TABLE products
  ADD COLUMN min_stock_threshold DECIMAL(10,3) NOT NULL DEFAULT 0
    CHECK (min_stock_threshold >= 0);

COMMENT ON COLUMN products.min_stock_threshold IS 'Low-stock UI badge trigger. 0 = disabled (no badge).';
```

- [ ] Apply + verify column appears in `\d products`.

### Task 1.6 — Regen types

- [ ] `pnpm db:types`
- [ ] `git diff packages/supabase/src/types.generated.ts` montre : nouvelles colonnes sur `stock_movements` (reason, unit_cost, idempotency_key, supplier_id) + `products.min_stock_threshold` + 4 nouvelles entrées dans permissions.
- [ ] Commit `feat(db): session 12 — extend stock_movements + add min_stock_threshold + seed inventory perms`.

---

## Phase 2 — RPCs (SECURITY DEFINER)

### Task 2.1 — RPC `record_stock_movement_v1` (interne)

**Files:**
- Create: `supabase/migrations/20260516000006_create_record_stock_movement_rpc.sql`

- [ ] **Step 1: Implémentation**

```sql
CREATE OR REPLACE FUNCTION record_stock_movement_v1(
  p_product_id      UUID,
  p_movement_type   movement_type,
  p_quantity        DECIMAL(10,3),
  p_reason          TEXT,
  p_unit_cost       DECIMAL(14,2)  DEFAULT NULL,
  p_supplier_id     UUID           DEFAULT NULL,
  p_idempotency_key UUID           DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid      UUID := auth.uid();
  v_profile  UUID;
  v_current  DECIMAL(10,3);
  v_new      DECIMAL(10,3);
  v_mvt_id   UUID;
BEGIN
  -- Auth + perm checks done in calling wrappers; this primitive trusts caller.
  -- But hard-reject sale/sale_void coming from non-order paths.
  IF p_movement_type IN ('sale', 'sale_void') THEN
    RAISE EXCEPTION 'record_stock_movement_v1 cannot be called with movement_type=%', p_movement_type;
  END IF;

  IF p_quantity = 0 THEN
    RAISE EXCEPTION 'quantity_must_be_nonzero';
  END IF;

  IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'reason_required';
  END IF;

  -- Idempotency replay
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_mvt_id FROM stock_movements WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN
      SELECT current_stock INTO v_new FROM products WHERE id = p_product_id;
      RETURN jsonb_build_object(
        'movement_id', v_mvt_id, 'product_id', p_product_id,
        'new_current_stock', v_new, 'idempotent_replay', true
      );
    END IF;
  END IF;

  SELECT id INTO v_profile FROM user_profiles WHERE auth_user_id = v_uid AND deleted_at IS NULL;
  IF v_profile IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003'; END IF;

  -- Lock product row + read current stock
  SELECT current_stock INTO v_current FROM products WHERE id = p_product_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'product_not_found' USING ERRCODE='P0002'; END IF;

  v_new := v_current + p_quantity;
  -- Negative-stock guard: only adjustment is allowed to go to >=0; others can't go below 0
  IF v_new < 0 THEN
    RAISE EXCEPTION 'insufficient_stock' USING ERRCODE='P0002';
  END IF;

  INSERT INTO stock_movements (
    product_id, movement_type, quantity, reason, unit_cost,
    supplier_id, idempotency_key, reference_type, created_by
  ) VALUES (
    p_product_id, p_movement_type, p_quantity, p_reason, p_unit_cost,
    p_supplier_id, p_idempotency_key, 'admin_action', v_profile
  ) RETURNING id INTO v_mvt_id;

  UPDATE products SET current_stock = v_new WHERE id = p_product_id;

  -- audit_log column is actor_profile_id (cf. 20260515000002_init_audit_log.sql)
  INSERT INTO audit_log (action, subject_table, subject_id, payload, actor_profile_id)
  VALUES (
    'stock.movement', 'stock_movements', v_mvt_id,
    jsonb_build_object(
      'movement_type', p_movement_type, 'quantity', p_quantity,
      'reason', p_reason, 'new_current_stock', v_new,
      'idempotency_key', p_idempotency_key
    ),
    v_profile
  );

  RETURN jsonb_build_object(
    'movement_id', v_mvt_id, 'product_id', p_product_id,
    'new_current_stock', v_new, 'idempotent_replay', false
  );
END $$;

-- CRITICAL : this is an internal primitive. It does NOT check has_permission
-- (the wrappers do). Without REVOKE EXECUTE, any authenticated user could
-- invoke it directly and bypass the wrapper perm gates.
REVOKE EXECUTE ON FUNCTION record_stock_movement_v1 FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION record_stock_movement_v1 FROM authenticated;
-- The SECURITY DEFINER owner (postgres) keeps EXECUTE implicitly; the wrappers
-- below are SECURITY DEFINER too, so they run as owner and can call this.

COMMENT ON FUNCTION record_stock_movement_v1 IS
  'INTERNAL primitive — only callable by other SECURITY DEFINER functions running as owner. '
  'Authenticated users MUST go through adjust_stock_v1 / receive_stock_v1 / waste_stock_v1 which gate by has_permission.';
```

Note : `stock_movements.reference_id` est laissé NULL pour les admin movements (autorisé depuis migration 1). `reference_type='admin_action'` documente le contexte sans nécessiter un id externe.

- [ ] **Step 2: Apply + smoke direct via psql** : `SELECT record_stock_movement_v1('<product-uuid>', 'adjustment', 5, 'test smoke');` retourne JSON.

### Task 2.2 — RPC `adjust_stock_v1`

**Files:**
- Create: `supabase/migrations/20260516000007_create_adjust_stock_rpc.sql`

```sql
CREATE OR REPLACE FUNCTION adjust_stock_v1(
  p_product_id      UUID,
  p_new_qty         DECIMAL(10,3),
  p_reason          TEXT,
  p_idempotency_key UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_current DECIMAL(10,3);
  v_delta   DECIMAL(10,3);
BEGIN
  IF NOT has_permission(auth.uid(), 'inventory.adjust') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;
  IF p_new_qty < 0 THEN
    RAISE EXCEPTION 'negative_qty_not_allowed';
  END IF;

  SELECT current_stock INTO v_current FROM products WHERE id = p_product_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'product_not_found' USING ERRCODE='P0002'; END IF;

  v_delta := p_new_qty - v_current;
  IF v_delta = 0 THEN
    -- No-op but still idempotent: return current state
    RETURN jsonb_build_object('movement_id', NULL, 'product_id', p_product_id,
      'new_current_stock', v_current, 'noop', true);
  END IF;

  RETURN record_stock_movement_v1(
    p_product_id     := p_product_id,
    p_movement_type  := 'adjustment',
    p_quantity       := v_delta,
    p_reason         := p_reason,
    p_idempotency_key := p_idempotency_key
  );
END $$;

REVOKE EXECUTE ON FUNCTION adjust_stock_v1 FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION adjust_stock_v1 TO authenticated;

COMMENT ON FUNCTION adjust_stock_v1 IS
  'ADMIN+. Set product stock to p_new_qty. Computes signed delta and records an "adjustment" movement. '
  'No-op (returns noop=true) if delta=0; idempotency_key is NOT persisted in that case.';
```

### Task 2.3 — RPC `receive_stock_v1`

**Files:**
- Create: `supabase/migrations/20260516000008_create_receive_stock_rpc.sql`

```sql
CREATE OR REPLACE FUNCTION receive_stock_v1(
  p_product_id      UUID,
  p_quantity        DECIMAL(10,3),
  p_supplier_id     UUID,
  p_unit_cost       DECIMAL(14,2) DEFAULT NULL,
  p_reason          TEXT          DEFAULT NULL,
  p_idempotency_key UUID          DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_supplier_code TEXT;
  v_reason TEXT := p_reason;
BEGIN
  IF NOT has_permission(auth.uid(), 'inventory.receive') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;
  IF p_quantity <= 0 THEN
    RAISE EXCEPTION 'quantity_must_be_positive';
  END IF;

  SELECT code INTO v_supplier_code FROM suppliers
   WHERE id = p_supplier_id AND is_active = true AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'supplier_not_found_or_inactive' USING ERRCODE='P0002';
  END IF;

  IF v_reason IS NULL OR length(trim(v_reason)) < 3 THEN
    v_reason := 'Receipt from ' || v_supplier_code;
  END IF;

  RETURN record_stock_movement_v1(
    p_product_id      := p_product_id,
    p_movement_type   := 'purchase',
    p_quantity        := p_quantity,
    p_reason          := v_reason,
    p_unit_cost       := p_unit_cost,
    p_supplier_id     := p_supplier_id,
    p_idempotency_key := p_idempotency_key
  );
END $$;

REVOKE EXECUTE ON FUNCTION receive_stock_v1 FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION receive_stock_v1 TO authenticated;

COMMENT ON FUNCTION receive_stock_v1 IS
  'MANAGER+. Record a stock receipt from an active supplier. Inserts a movement of type "purchase". '
  'p_reason defaults to "Receipt from <supplier code>" when NULL.';
```

### Task 2.4 — RPC `waste_stock_v1`

**Files:**
- Create: `supabase/migrations/20260516000009_create_waste_stock_rpc.sql`

```sql
CREATE OR REPLACE FUNCTION waste_stock_v1(
  p_product_id      UUID,
  p_quantity        DECIMAL(10,3),
  p_reason          TEXT,
  p_idempotency_key UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_current DECIMAL(10,3);
BEGIN
  IF NOT has_permission(auth.uid(), 'inventory.waste') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;
  IF p_quantity <= 0 THEN
    RAISE EXCEPTION 'quantity_must_be_positive';
  END IF;

  SELECT current_stock INTO v_current FROM products WHERE id = p_product_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'product_not_found' USING ERRCODE='P0002'; END IF;
  IF v_current < p_quantity THEN
    RAISE EXCEPTION 'insufficient_stock' USING ERRCODE='P0002';
  END IF;

  RETURN record_stock_movement_v1(
    p_product_id      := p_product_id,
    p_movement_type   := 'waste',
    p_quantity        := -p_quantity,  -- negate (we receive a positive qty from caller)
    p_reason          := p_reason,
    p_idempotency_key := p_idempotency_key
  );
END $$;

REVOKE EXECUTE ON FUNCTION waste_stock_v1 FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION waste_stock_v1 TO authenticated;

COMMENT ON FUNCTION waste_stock_v1 IS
  'MANAGER+. Record stock waste/spoilage. p_quantity MUST be positive (the RPC negates internally). '
  'Refuses if p_quantity > current_stock (insufficient_stock P0002).';
```

### Task 2.5 — RPC `get_stock_levels_v1`

**Files:**
- Create: `supabase/migrations/20260516000010_create_get_stock_levels_rpc.sql`

```sql
CREATE OR REPLACE FUNCTION get_stock_levels_v1(
  p_category_id    UUID    DEFAULT NULL,
  p_search         TEXT    DEFAULT NULL,
  p_low_stock_only BOOLEAN DEFAULT false,
  p_limit          INT     DEFAULT 50,
  p_offset         INT     DEFAULT 0
) RETURNS TABLE (
  product_id          UUID,
  sku                 TEXT,
  name                TEXT,
  category_id         UUID,
  category_name       TEXT,
  current_stock       DECIMAL(10,3),
  min_stock_threshold DECIMAL(10,3),
  last_movement_at    TIMESTAMPTZ,
  total_count         BIGINT
)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public
AS $$
BEGIN
  IF NOT has_permission(auth.uid(), 'inventory.read') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;

  RETURN QUERY
  WITH filtered AS (
    SELECT p.id, p.sku, p.name, p.category_id, c.name AS cat_name,
           p.current_stock, p.min_stock_threshold,
           (SELECT max(sm.created_at) FROM stock_movements sm WHERE sm.product_id = p.id) AS last_mvt
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
     WHERE p.deleted_at IS NULL
       AND (p_category_id IS NULL OR p.category_id = p_category_id)
       AND (p_search IS NULL OR p.name ILIKE '%' || p_search || '%' OR p.sku ILIKE '%' || p_search || '%')
       AND (NOT p_low_stock_only
            OR (p.min_stock_threshold > 0 AND p.current_stock < p.min_stock_threshold))
  ), counted AS (SELECT COUNT(*) AS total FROM filtered)
  SELECT f.id, f.sku, f.name, f.category_id, f.cat_name,
         f.current_stock, f.min_stock_threshold, f.last_mvt,
         (SELECT total FROM counted)
    FROM filtered f
   ORDER BY f.name
   LIMIT p_limit OFFSET p_offset;
END $$;

REVOKE EXECUTE ON FUNCTION get_stock_levels_v1 FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION get_stock_levels_v1 TO authenticated;
-- Note: SECURITY INVOKER + perm check via has_permission(auth.uid(), 'inventory.read').
```

- [ ] **Step 1-5**: Appliquer chaque RPC, smoke direct via psql, commit `feat(db): session 12 — record_stock_movement + adjust/receive/waste/get_stock_levels RPCs`.

---

## Phase 3 — Domain package (parallelizable avec Phase 2 une fois types regenerated)

### Task 3.1 — Types + barrel

**Files:** `packages/domain/src/inventory/types.ts`, `index.ts`

- [ ] Définir : `MovementType`, `StockMovement`, `StockLevel`, `AdjustmentInput`, `ReceiveInput`, `WasteInput`, `ValidationResult<T>`
- [ ] Définir aussi `StockMovementRpcResult` (le JSONB renvoyé par les 3 wrappers) :
```ts
export type StockMovementRpcResult = {
  movement_id: string | null;   // null only when adjust_stock_v1 no-op (delta=0)
  product_id: string;
  new_current_stock: number;
  idempotent_replay?: boolean;
  noop?: boolean;
};
```
- [ ] `index.ts` ré-exporte tout. Les hooks TanStack consomment `StockMovementRpcResult` au lieu de re-typer inline.

### Task 3.2 — Pure functions

**Files:**
- `computeNewStock.ts` : `(current: number, signedDelta: number) => number`
- `classifyMovement.ts` : `(mvt: StockMovement) => { direction: 'IN'|'OUT', isSale, isAdmin }`
- `validateAdjust.ts`, `validateReceive.ts`, `validateWaste.ts` (chacune retourne `ValidationResult`)
- `computeStockDelta.ts` : `(movements[]) => number` (sum signed)
- `lowStockFilter.ts` : `(products[]) => products[]`

- [ ] Aucun import de fetch / Supabase / React.

### Task 3.3 — Tests Vitest co-localisés

**Files:** `packages/domain/src/inventory/__tests__/*.test.ts` (7 fichiers)

- [ ] ≥24 tests : edge cases (0, negatif, undefined, NaN, decimal precision)
- [ ] `pnpm --filter @breakery/domain test` 100% pass
- [ ] Commit `feat(domain): session 12 — inventory pure module + 24 unit tests`

### Task 3.4 — Re-export depuis `packages/domain/src/index.ts`

- [ ] Ajouter `export * from './inventory/index.js'`

### Task 3.5 — Étendre `packages/supabase/src/rls/permissions.ts`

- [ ] Ajouter 4 codes au type union `PermissionCode`
- [ ] Commit `feat(packages): session 12 — domain inventory + permission codes`

---

## Phase 4 — Backoffice UI

### Task 4.1 — Page wiring (route + sidebar + perm gate)

**Files:**
- Modify: `apps/backoffice/src/routes/index.tsx` (ligne 52 — remplacer `<ComingSoonPage module="Inventory" />` par `<Suspense><InventoryPage /></Suspense>` wrap dans `<PermissionGate required="inventory.read">`)
- Modify: `apps/backoffice/src/layouts/BackofficeLayout.tsx` (ligne 25 — ajouter `permission: 'inventory.read'` sur l'entrée Inventory, déplacer dans groupe "Operations", icône `Package`)

### Task 4.2 — Hooks TanStack Query

**Files:** `apps/backoffice/src/features/inventory/hooks/*.ts` (6 fichiers)

- [ ] `useStockLevels(filters)` → `rpc('get_stock_levels_v1', filters)` (queryKey: `['stock-levels', filters]`)
- [ ] `useStockMovements(productId, page)` → `table('stock_movements').select(...).eq('product_id', productId).order('created_at', desc).range(...)` (queryKey: `['stock-movements', productId, page]`)
- [ ] `useAdjustStock` → mutation `rpc('adjust_stock_v1', ...)` + invalidate `['stock-levels']` + `['stock-movements', productId]`
- [ ] `useReceiveStock` → mutation `rpc('receive_stock_v1', ...)` + invalidate
- [ ] `useWasteStock` → mutation `rpc('waste_stock_v1', ...)` + invalidate
- [ ] `useProductsForInventory(search)` → `table('products').select('id,sku,name,current_stock').ilike('name', ...)` typeahead helper

Pattern reference : `apps/backoffice/src/features/loyalty/hooks/useAdjustLoyaltyPoints.ts` (classification d'erreurs : forbidden/insufficient_stock/reason_required).

### Task 4.3 — Composants modals + drawer

**Files:** `apps/backoffice/src/features/inventory/components/*.tsx`

- [ ] `AdjustModal.tsx` — Form contrôlé : product search (typeahead), `new_qty` input, `reason` textarea (Zod min 3 chars), preview du delta (`new_qty - current_stock`), submit → `useAdjustStock`. Génère un `idempotency_key = crypto.randomUUID()` au mount.
- [ ] `ReceiveModal.tsx` — Form : product typeahead, supplier dropdown (table `suppliers` is_active=true), `quantity > 0`, `unit_cost optional`, `reason optional` (default "Receipt from <code>"), submit → `useReceiveStock`.
- [ ] `WasteModal.tsx` — Form : product, `quantity > 0` capped at `current_stock`, `reason` select (Expired/Damaged/Spoiled/Other → free text), submit → `useWasteStock`.
- [ ] `MovementHistoryDrawer.tsx` — Slide-in droite, header `<product name>`, list paginée (50/page) avec colonnes Date, Type (badge couleur), Qty (signé), Reason/Reference, Created_by.
- [ ] `StockLevelRow.tsx` — Table row : SKU, Name, Category, On hand (+ `<LowStockBadge>`), Last movement, Actions dropdown.
- [ ] `LowStockBadge.tsx` — Affiche badge rouge si `current_stock < min_stock_threshold && min_stock_threshold > 0`.

### Task 4.4 — Page `Inventory.tsx`

**Files:** `apps/backoffice/src/pages/Inventory.tsx`

- [ ] Header avec filters (Search input, Category dropdown depuis `useCategories`, Low-stock toggle)
- [ ] Toolbar avec 3 boutons gated par perms (`<PermissionGate required="inventory.adjust" hideIfDenied>` pour Adjust, idem pour Receive/Waste)
- [ ] Table via `useStockLevels` + pagination
- [ ] State modal control (Adjust/Receive/Waste/History)
- [ ] Empty state si aucun produit

Pattern reference : `apps/backoffice/src/pages/Loyalty.tsx`.

- [ ] Commit `feat(backoffice): session 12 — inventory page + 3 modals + history drawer + hooks`

---

## Phase 5 — Tests

### Task 5.1 — pgTAP (`supabase/tests/inventory.test.sql`) + Vitest concurrency

- [ ] T1-T14 selon spec §5.1
- [ ] **T15** : `record_stock_movement_v1` invoqué directement via SET ROLE authenticated → `throws_ok` permission denied (vérifie REVOKE EXECUTE)
- [ ] **T16** (Vitest live, `supabase/tests/functions/inventory-concurrent.test.ts`) : 2 connections parallèles via Promise.all (`adjust_stock_v1` + sale via `complete_order_with_payment`) → assert final stock = somme deltas (FOR UPDATE row lock serialize)
- [ ] Run via `pnpm test:pgtap` + `pnpm --filter @breakery/supabase test inventory-concurrent`

### Task 5.2 — Tests Vitest live RPCs

**Files:** `supabase/tests/functions/{adjust-stock,receive-stock,waste-stock,inventory-rls}.test.ts`

- [ ] Pattern session 10 (`pos-checkout.test.ts`) : seed DB, sign-in MANAGER/ADMIN, appel RPC via `supabase.rpc(...)`, assertions sur DB rows.
- [ ] Couvrir : happy path, perm denied (CASHIER → forbidden), insufficient_stock, idempotency replay, supplier inactif.

### Task 5.3 — Tests Vitest backoffice

**Files:** `apps/backoffice/src/pages/__tests__/Inventory.test.tsx` + 3 modals tests + smoke

- [ ] Vitest + React Testing Library + msw pour mock Supabase.
- [ ] Smoke `inventory.smoke.test.tsx` : flow E2E MANAGER (receive 20 → waste 3) puis ADMIN (adjust to 50 → history 3 rows).

### Task 5.4 — Run full suite

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

- [ ] 0 erreur typecheck, 0 warning lint, ≥30 nouveaux tests pass, build POS + BO succès.
- [ ] Commit `test(inventory): session 12 — pgTAP T1-T14 + RPC integration + BO unit + smoke`

---

## Phase 6 — Validation manuelle + docs

### Task 6.1 — Acceptance manuelle dans le navigateur

- [ ] `pnpm db:reset` → seed
- [ ] `pnpm --filter @breakery/backoffice dev` → ouvrir http://localhost:5174
- [ ] Login MANAGER → `/backoffice/inventory` → list visible, badge low-stock OK
- [ ] Cliquer Receive → form, sélectionner produit X, supplier, qty=20 → submit → row update
- [ ] Cliquer Waste → form, qty=3, reason "Expired" → submit → row update
- [ ] Cliquer Adjust → bouton **caché** ou désactivé (perm refusée)
- [ ] Logout, login ADMIN → bouton Adjust visible → ouvrir → set produit Y new_qty=50, reason "Recompte" → submit → row update + history drawer affiche 3 movements
- [ ] Logout, login CASHIER → menu sidebar Inventory **caché**, GET /backoffice/inventory → redirect

### Task 6.2 — Regression POS

- [ ] `pnpm --filter @breakery/pos dev` → http://localhost:5173
- [ ] Faire un order complet de 3 items → confirmer `stock_movements` 3 rows `sale` + `current_stock` décrémenté.
- [ ] Voider un order → `sale_void` movements + `current_stock` restauré.
- [ ] Smoke tests `pos-checkout.smoke.test.tsx` toujours vert.

### Task 6.3 — Commit final + PR

- [ ] Vérifier `git status` propre
- [ ] Vérifier `packages/supabase/src/types.generated.ts` committé
- [ ] Pousser branche `swarm/session-12-inventory`
- [ ] Ouvrir PR vers `master` : titre `feat(inventory): session 12 — admin write path (adjust/receive/waste) + BO UI`
- [ ] PR body : résumé des 10 migrations, 5 RPCs, perms, files modifiés, tests ajoutés, acceptance video/screenshots

---

## Verification commands (one-shot)

```bash
# Apply migrations from scratch + regen types
pnpm db:reset && pnpm db:types

# Full quality gate
pnpm typecheck && pnpm lint && pnpm test --concurrency=1 && pnpm build

# pgTAP only
pnpm test:pgtap

# Targeted RPC tests
pnpm --filter @breakery/supabase test inventory

# BO smoke
pnpm --filter @breakery/backoffice test inventory.smoke
```

Expected at the end :
- 10 migrations applied
- `types.generated.ts` updated and committed
- 0 typecheck errors, 0 lint warnings
- ≥30 new tests passing, total suite ≥ 650
- POS + BO builds successful
- All acceptance criteria in spec §6 ticked

---

## Out of scope (déféré sessions futures — cf. spec §9)

- Multi-branch / transfer_stock → session 15
- Recipes / BOM auto-decrement → session 13
- Purchase orders / GRN headers → session 16
- Cost layers (FIFO/LIFO/avg) → session 16
- Batch / expiration tracking → session 18+
- Reports inventory (valuation, slow movers) → session 14
- Low-stock email alerts (Edge Function) → session 14
- POS low-stock badge sur ProductCard → polish optionnel, peut être inclus si temps reste (cf. spec §4.2)

---

**Fin du plan.** Pour exécuter : utiliser `superpowers:subagent-driven-development` ou `superpowers:executing-plans` skill, task par task.
