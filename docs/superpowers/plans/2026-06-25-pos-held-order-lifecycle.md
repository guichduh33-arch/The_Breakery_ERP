# POS Held-Order Lifecycle (addition ouverte) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make "Send to Kitchen" dispatch the order to prep stations, park it in Held Orders, and clear the terminal; let a held *sent* order be reopened with its already-fired items locked & non-reprinted, accept new items, and print an "ADDITIONAL ORDER" KOT.

**Architecture:** The reopenable held order **is the real fired order** (`orders.status='pending_payment'`) flagged `is_held=true` — the "addition ouverte" model. Draft holds (`hold_order_v1`, `status='draft'`) stay for parking *before* firing; both live in `orders`, discriminated by `status`. Two new additive `_v1` RPCs (`hold_fired_order_v1`, `reopen_held_order_v1`) plus one data-only migration to route categories. `fire_counter_order_v4` is **not** touched — the item lock (`is_locked`) and append (`p_order_id`) mechanics already exist server-side. Front work is wiring: a cart `reopenOrder` action that rehydrates locks from `is_locked`, a hold-after-send call, a reopen branch in the held list, and an `additional` flag on the print payload.

**Tech Stack:** Supabase Postgres (cloud V3 dev `ikcyvlovptebroadgtvd`), plpgsql SECURITY DEFINER RPCs, React + Zustand (`cartStore`), TanStack Query, Vitest + Testing Library, pgTAP.

## Global Constraints

Copied verbatim from the spec + CLAUDE.md critical patterns. Every task's requirements implicitly include this section.

- **DB target is Supabase cloud V3 dev `ikcyvlovptebroadgtvd`** — apply migrations via MCP `apply_migration`, run SQL/pgTAP via MCP `execute_sql` (BEGIN/ROLLBACK envelope). **Never** `supabase start` / `db reset` / `run_pgtap.sh` (Docker retired). Subagents cannot call Supabase MCP — pgTAP runs, `apply_migration`, and types regen happen on the controller.
- **RPC versioning is monotone** — the two new RPCs are creations (`_v1`), never edits. `fire_counter_order_v4` stays untouched (no DROP/recreate).
- **REVOKE pair S25 (anon defense-in-depth)** on every new RPC: `REVOKE EXECUTE … FROM PUBLIC` + `REVOKE EXECUTE … FROM anon` + `GRANT EXECUTE … TO authenticated` + `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC`. Mirror `restore_held_order_v1` (`20260620000013`) + `20260620000016`.
- **`audit_logs.actor_id` REFERENCES `user_profiles(id)`** — resolve it from `auth.uid()` via `SELECT id FROM user_profiles WHERE auth_user_id = v_uid AND deleted_at IS NULL`. **Do not** insert `auth.uid()` directly (FK is to `user_profiles.id`, not `auth.users`).
- **No raw writes to `orders`/`order_items` from app code** — all writes go through RPCs.
- **Idempotence** — `hold`/`reopen` are naturally replayable (set `is_held` true/false); fire idempotence is unchanged (flavor-2 `p_client_uuid`).
- **Regen types after migrations** — `mcp__plugin_supabase_supabase__generate_typescript_types` → write to `packages/supabase/src/types.generated.ts` → commit. A missing regen is the #1 cause of broken CI.
- **Migration numbering is monotone** — highest existing NAME-block is `20260709000011`. This plan uses `20260710000010/11/12`. Re-check `supabase/migrations/` before applying and bump if anything landed in between.
- **Cheap-first test order** — `pnpm typecheck`, then `pnpm --filter @breakery/domain test`, then targeted POS smokes, then live RPC.

---

### Task 1: Route the sale categories to prep stations (Bloc 1 — data migration)

Unblocks the whole flow: today **100% of active products route `dispatch_station='none'`**, so `firableCount` is always 0 and the button is permanently disabled. This migration is **data-only** (no schema change), idempotent, reversible, targets stable category **names**.

Verified live in `ikcyvlovptebroadgtvd` (2026-06-25) — these 6 categories currently route `'none'` and hold the active sale products:

| Station | Categories (active product count) |
|---|---|
| `barista` | Coffee (13), Speciale Latte (5), Special Drinks (2) |
| `kitchen` | Simple Plate (5), Panini (3), Savoury Croissant (3) |

Everything else stays `none` (breads/viennoiserie = vitrine, cold/hot sandwiches, juices → deferred to Spec B). No "combos plate" category exists distinctly in the data — combos are not routed here.

> ⚠️ **User confirmation gate:** this mapping is a business-knowledge call (spec §4 Bloc 1). Before applying, confirm the 6 names with the user. If they amend the list, edit the `WHERE name IN (...)` sets below to match — the test in Step 3 reads the same list.

**Files:**
- Create: `supabase/migrations/20260710000010_route_categories_to_prep_stations.sql`
- Test: `supabase/tests/route_categories_prep_stations.test.sql` (pgTAP, controller-run via MCP)

**Interfaces:**
- Consumes: nothing.
- Produces: 6 categories now route to `barista`/`kitchen`. `useFireToStations.firableCount` becomes > 0 for carts containing their products. No exported code symbols.

- [ ] **Step 1: Write the migration**

```sql
-- 20260710000010_route_categories_to_prep_stations.sql
-- Spec A (POS held-order lifecycle), Bloc 1 — minimal, NON-ambiguous routing so
-- the Send-to-Kitchen flow becomes active & testable. Data-only, idempotent,
-- reversible. Targets stable category names. Full mapping (cold/hot sandwiches,
-- juices, viennoiserie) is deferred to Spec B.
--
-- DOWN (manual revert): UPDATE categories SET dispatch_station = 'none'
--   WHERE name IN ('Coffee','Speciale Latte','Special Drinks',
--                  'Simple Plate','Panini','Savoury Croissant');

UPDATE public.categories
   SET dispatch_station = 'barista'
 WHERE name IN ('Coffee', 'Speciale Latte', 'Special Drinks')
   AND dispatch_station IS DISTINCT FROM 'barista';

UPDATE public.categories
   SET dispatch_station = 'kitchen'
 WHERE name IN ('Simple Plate', 'Panini', 'Savoury Croissant')
   AND dispatch_station IS DISTINCT FROM 'kitchen';
```

- [ ] **Step 2: Apply the migration (controller, MCP)**

Apply via `mcp__plugin_supabase_supabase__apply_migration` with `project_id='ikcyvlovptebroadgtvd'`, `name='route_categories_to_prep_stations'`, body = the SQL above.

- [ ] **Step 3: Write the pgTAP verification test**

```sql
-- supabase/tests/route_categories_prep_stations.test.sql
BEGIN;
SELECT plan(3);

SELECT is(
  (SELECT count(*)::int FROM categories
    WHERE name IN ('Coffee','Speciale Latte','Special Drinks')
      AND dispatch_station = 'barista'),
  3, 'three barista categories routed');

SELECT is(
  (SELECT count(*)::int FROM categories
    WHERE name IN ('Simple Plate','Panini','Savoury Croissant')
      AND dispatch_station = 'kitchen'),
  3, 'three kitchen categories routed');

-- Idempotence: re-running the UPDATEs is a no-op (still routed, no error).
UPDATE categories SET dispatch_station = 'barista'
  WHERE name IN ('Coffee','Speciale Latte','Special Drinks')
    AND dispatch_station IS DISTINCT FROM 'barista';
SELECT is(
  (SELECT count(*)::int FROM categories WHERE dispatch_station = 'barista'
     AND name IN ('Coffee','Speciale Latte','Special Drinks')),
  3, 'idempotent re-apply leaves 3 barista categories');

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 4: Run the pgTAP test (controller, MCP)**

Run via `mcp__plugin_supabase_supabase__execute_sql` with the file body. Expected: 3/3 pass, no failing diagnostics.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260710000010_route_categories_to_prep_stations.sql \
        supabase/tests/route_categories_prep_stations.test.sql
git commit -m "feat(pos): route sale categories to prep stations (Spec A Bloc 1)"
```

---

### Task 2: `hold_fired_order_v1` RPC — park a fired order in Held Orders

Sets `is_held=true` on a fired (`pending_payment`, `created_via='pos'`) order so it leaves the terminal and appears in the held list. Additive `_v1` (the held path only touches Send-to-Kitchen, not direct checkout — so a new RPC is less invasive than bumping `fire_counter_order` to v5).

**Files:**
- Create: `supabase/migrations/20260710000011_create_hold_fired_order_v1.sql`
- Test: `supabase/tests/hold_fired_order_v1.test.sql` (pgTAP — REVOKE/ACL + signature; controller-run via MCP)

**Interfaces:**
- Consumes: `orders(id, status, created_via, is_held)`, `user_profiles(id, auth_user_id, deleted_at)`, `audit_logs`, `has_permission(uuid, text)`.
- Produces: `public.hold_fired_order_v1(p_order_id uuid) RETURNS void`. Raises `P0002` if no `pending_payment`/`pos` order matches. Audit action `order.held`.

- [ ] **Step 1: Write the migration**

```sql
-- 20260710000011_create_hold_fired_order_v1.sql
-- Spec A, Bloc 2 — park a FIRED counter order (pending_payment) in the held list
-- by flagging is_held=true, so Send-to-Kitchen can free the terminal while the
-- order stays alive in the DB ("addition ouverte"). Additive _v1; does NOT touch
-- fire_counter_order_v4. Idempotent (setting is_held=true twice is harmless).
-- Gate: pos.sale.create (CASHIER+). REVOKE pair S25.
CREATE OR REPLACE FUNCTION public.hold_fired_order_v1(p_order_id UUID)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_uid           UUID := auth.uid();
  v_actor_profile UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001';
  END IF;
  IF NOT has_permission(v_uid, 'pos.sale.create') THEN
    RAISE EXCEPTION 'Permission denied: pos.sale.create' USING ERRCODE = 'P0003';
  END IF;

  UPDATE orders
     SET is_held = true
   WHERE id = p_order_id
     AND status = 'pending_payment'
     AND created_via = 'pos';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'fired_order_not_found_or_not_holdable' USING ERRCODE = 'P0002';
  END IF;

  SELECT id INTO v_actor_profile
    FROM user_profiles WHERE auth_user_id = v_uid AND deleted_at IS NULL;
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
    VALUES (v_actor_profile, 'order.held', 'orders', p_order_id, '{}'::jsonb);
END $function$;

REVOKE EXECUTE ON FUNCTION public.hold_fired_order_v1(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.hold_fired_order_v1(UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION public.hold_fired_order_v1(UUID) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
```

- [ ] **Step 2: Apply the migration (controller, MCP)**

Apply via `apply_migration`, `name='create_hold_fired_order_v1'`.

- [ ] **Step 3: Write the pgTAP test (ACL + signature)**

```sql
-- supabase/tests/hold_fired_order_v1.test.sql
BEGIN;
SELECT plan(3);

SELECT has_function(
  'public', 'hold_fired_order_v1', ARRAY['uuid'],
  'hold_fired_order_v1(uuid) exists');

SELECT is(
  has_function_privilege('anon', 'public.hold_fired_order_v1(uuid)', 'EXECUTE'),
  false, 'anon cannot EXECUTE hold_fired_order_v1');

SELECT is(
  has_function_privilege('authenticated', 'public.hold_fired_order_v1(uuid)', 'EXECUTE'),
  true, 'authenticated can EXECUTE hold_fired_order_v1');

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 4: Run the pgTAP test (controller, MCP)**

Run via `execute_sql`. Expected: 3/3 pass. (Behavioral gate/P0002/audit coverage lands as live-RPC tests in Task 7's round-trip, which runs under a real PIN JWT.)

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260710000011_create_hold_fired_order_v1.sql \
        supabase/tests/hold_fired_order_v1.test.sql
git commit -m "feat(pos): hold_fired_order_v1 — park fired order in held list (Spec A Bloc 2)"
```

---

### Task 3: `reopen_held_order_v1` RPC — claim & rehydrate a held fired order

Returns the order + items (with `order_items.id`, `is_locked`, `kitchen_status`) for cart rehydration and sets `is_held=false` (a **claim** so two terminals can't open the same order). Unlike `restore_held_order_v1`, it **does not delete** the order — it stays the live fired order.

**Files:**
- Create: `supabase/migrations/20260710000012_create_reopen_held_order_v1.sql`
- Test: `supabase/tests/reopen_held_order_v1.test.sql` (pgTAP — ACL + signature; controller-run via MCP)

**Interfaces:**
- Consumes: `orders(id, status, is_held, order_number, order_type, customer_id, table_number, notes)`, `order_items(id, product_id, name_snapshot, unit_price, quantity, modifiers, is_locked, kitchen_status, created_at)`, `has_permission`, `audit_logs`, `user_profiles`.
- Produces: `public.reopen_held_order_v1(p_order_id uuid) RETURNS jsonb`. Envelope keys: `order_id`, `order_number`, `order_type`, `customerId`, `tableNumber`, `notes`, `items[]` where each item = `{ id, product_id, name, unit_price, quantity, modifiers, is_locked, kitchen_status }`. Raises `P0002` if not a held order. Audit action `order.reopened`.

- [ ] **Step 1: Write the migration**

```sql
-- 20260710000012_create_reopen_held_order_v1.sql
-- Spec A, Bloc 3 — reopen a held FIRED order without deleting it. Returns the
-- cart payload (items carry order_items.id + is_locked + kitchen_status so the
-- client rehydrates the lock/print state) and CLAIMS the order by setting
-- is_held=false (prevents two terminals opening the same addition). Keeps
-- status='pending_payment'. Gate: pos.sale.create. REVOKE pair S25.
CREATE OR REPLACE FUNCTION public.reopen_held_order_v1(p_order_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_uid           UUID := auth.uid();
  v_order         RECORD;
  v_items         JSONB;
  v_actor_profile UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001';
  END IF;
  IF NOT has_permission(v_uid, 'pos.sale.create') THEN
    RAISE EXCEPTION 'Permission denied: pos.sale.create' USING ERRCODE = 'P0003';
  END IF;

  -- Claim: only a currently-held, pending_payment order can be reopened. A 2nd
  -- concurrent reopen sees is_held already false → 0 rows → P0002 ("already open").
  UPDATE orders
     SET is_held = false
   WHERE id = p_order_id
     AND is_held = true
     AND status = 'pending_payment'
   RETURNING id, order_number, order_type, customer_id, table_number, notes
     INTO v_order;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'held_order_not_found_or_already_open' USING ERRCODE = 'P0002';
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
           'id',             oi.id,
           'product_id',     oi.product_id,
           'name',           oi.name_snapshot,
           'unit_price',     oi.unit_price,
           'quantity',       oi.quantity,
           'modifiers',      COALESCE(oi.modifiers, '[]'::jsonb),
           'is_locked',      oi.is_locked,
           'kitchen_status', oi.kitchen_status
         ) ORDER BY oi.created_at)
    INTO v_items
  FROM order_items oi WHERE oi.order_id = p_order_id;

  SELECT id INTO v_actor_profile
    FROM user_profiles WHERE auth_user_id = v_uid AND deleted_at IS NULL;
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
    VALUES (v_actor_profile, 'order.reopened', 'orders', p_order_id, '{}'::jsonb);

  RETURN jsonb_build_object(
    'order_id',    v_order.id,
    'order_number',v_order.order_number,
    'order_type',  v_order.order_type,
    'customerId',  v_order.customer_id,
    'tableNumber', v_order.table_number,
    'notes',       v_order.notes,
    'items',       COALESCE(v_items, '[]'::jsonb)
  );
END $function$;

REVOKE EXECUTE ON FUNCTION public.reopen_held_order_v1(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reopen_held_order_v1(UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION public.reopen_held_order_v1(UUID) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
```

- [ ] **Step 2: Apply the migration (controller, MCP)**

Apply via `apply_migration`, `name='create_reopen_held_order_v1'`.

- [ ] **Step 3: Write the pgTAP test (ACL + signature)**

```sql
-- supabase/tests/reopen_held_order_v1.test.sql
BEGIN;
SELECT plan(3);

SELECT has_function(
  'public', 'reopen_held_order_v1', ARRAY['uuid'],
  'reopen_held_order_v1(uuid) exists');

SELECT is(
  has_function_privilege('anon', 'public.reopen_held_order_v1(uuid)', 'EXECUTE'),
  false, 'anon cannot EXECUTE reopen_held_order_v1');

SELECT is(
  has_function_privilege('authenticated', 'public.reopen_held_order_v1(uuid)', 'EXECUTE'),
  true, 'authenticated can EXECUTE reopen_held_order_v1');

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 4: Run the pgTAP test (controller, MCP)**

Run via `execute_sql`. Expected: 3/3 pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260710000012_create_reopen_held_order_v1.sql \
        supabase/tests/reopen_held_order_v1.test.sql
git commit -m "feat(pos): reopen_held_order_v1 — claim & rehydrate held fired order (Spec A Bloc 3)"
```

---

### Task 4: Regenerate TypeScript types

The two new RPCs add entries under `Database['public']['Functions']`. The front-end tasks (5–9) depend on `supabase.rpc('hold_fired_order_v1' | 'reopen_held_order_v1', …)` typechecking. Regen now, before any FE work.

**Files:**
- Modify: `packages/supabase/src/types.generated.ts`

**Interfaces:**
- Consumes: the applied migrations from Tasks 2–3.
- Produces: `supabase.rpc('hold_fired_order_v1', { p_order_id })` and `supabase.rpc('reopen_held_order_v1', { p_order_id })` are typed.

- [ ] **Step 1: Regenerate (controller, MCP)**

Call `mcp__plugin_supabase_supabase__generate_typescript_types` for `ikcyvlovptebroadgtvd`; write the returned `types` string to `packages/supabase/src/types.generated.ts` (overwrite).

- [ ] **Step 2: Verify the new functions are present**

Run: `grep -n "hold_fired_order_v1\|reopen_held_order_v1" packages/supabase/src/types.generated.ts`
Expected: both names appear under the Functions block.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @breakery/supabase typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/supabase/src/types.generated.ts
git commit -m "chore(types): regen for hold_fired_order_v1 + reopen_held_order_v1"
```

---

### Task 5: `cartStore.reopenOrder` action — rehydrate a fired order with locks

A new store action that loads a reopened order's items into the cart **reusing `order_items.id` as the line id** (stable lock tracking), pushes already-fired (`is_locked=true`) items into both `lockedItemIds` (non-editable, excluded from the next fire's RPC) **and** `printedItemIds` (not reprinted), and sets `pickedUpOrderId` to the order id so the next fire appends and checkout routes to `pay_existing_order`.

**Files:**
- Modify: `apps/pos/src/stores/cartStore.ts`
- Test: `apps/pos/src/stores/__tests__/cartStore.reopen.test.ts`

**Interfaces:**
- Consumes: `Cart`, `CartItem`, `OrderType`, `SelectedModifiers` from `@breakery/domain`.
- Produces: a new method on `CartState`:
  ```ts
  reopenOrder: (payload: ReopenOrderPayload) => void
  ```
  and exported types:
  ```ts
  export interface ReopenOrderItem {
    id: string;
    product_id: string;
    name: string;
    unit_price: number;
    quantity: number;
    modifiers: unknown;
    is_locked: boolean;
    kitchen_status: string | null;
  }
  export interface ReopenOrderPayload {
    order_id: string;
    order_type: string;
    customerId: string | null;
    tableNumber: string | null;
    notes: string | null;
    items: ReopenOrderItem[];
  }
  ```

- [ ] **Step 1: Write the failing test**

```ts
// apps/pos/src/stores/__tests__/cartStore.reopen.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useCartStore } from '@/stores/cartStore';
import type { ReopenOrderPayload } from '@/stores/cartStore';

const PAYLOAD: ReopenOrderPayload = {
  order_id: 'order-77',
  order_type: 'dine_in',
  customerId: null,
  tableNumber: '5',
  notes: null,
  items: [
    { id: 'oi-1', product_id: 'p1', name: 'Latte', unit_price: 30000, quantity: 1, modifiers: [], is_locked: true, kitchen_status: 'pending' },
    { id: 'oi-2', product_id: 'p2', name: 'Panini', unit_price: 45000, quantity: 2, modifiers: [], is_locked: false, kitchen_status: null },
  ],
};

beforeEach(() => {
  useCartStore.setState({
    cart: { items: [], order_type: 'take_out' },
    lockedItemIds: [], printedItemIds: [], attachedCustomer: null,
    pickedUpOrderId: null, appliedPromotions: [], dismissedPromotionIds: new Set(),
    isOffline: false,
  } as never);
});

describe('cartStore.reopenOrder', () => {
  it('loads items reusing order_items.id as the cart line id', () => {
    useCartStore.getState().reopenOrder(PAYLOAD);
    const ids = useCartStore.getState().cart.items.map((i) => i.id);
    expect(ids).toEqual(['oi-1', 'oi-2']);
    expect(useCartStore.getState().cart.tableNumber).toBe('5');
    expect(useCartStore.getState().cart.order_type).toBe('dine_in');
  });

  it('rehydrates locked items into BOTH lockedItemIds and printedItemIds', () => {
    useCartStore.getState().reopenOrder(PAYLOAD);
    expect(useCartStore.getState().lockedItemIds).toEqual(['oi-1']);
    expect(useCartStore.getState().printedItemIds).toEqual(['oi-1']);
  });

  it('sets pickedUpOrderId so the next fire appends to this order', () => {
    useCartStore.getState().reopenOrder(PAYLOAD);
    expect(useCartStore.getState().pickedUpOrderId).toBe('order-77');
  });

  it('locked items are not editable; unlocked items are', () => {
    useCartStore.getState().reopenOrder(PAYLOAD);
    expect(useCartStore.getState().canEdit('oi-1')).toBe(false);
    expect(useCartStore.getState().canEdit('oi-2')).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @breakery/app-pos test cartStore.reopen`
Expected: FAIL — `reopenOrder is not a function` / type `ReopenOrderPayload` not exported.

- [ ] **Step 3: Add the types + action**

In `apps/pos/src/stores/cartStore.ts`, add the exported types just above `interface CartState` (after the `CustomerWithCategory` type):

```ts
export interface ReopenOrderItem {
  id: string;
  product_id: string;
  name: string;
  unit_price: number;
  quantity: number;
  modifiers: unknown;
  is_locked: boolean;
  kitchen_status: string | null;
}
export interface ReopenOrderPayload {
  order_id: string;
  order_type: string;
  customerId: string | null;
  tableNumber: string | null;
  notes: string | null;
  items: ReopenOrderItem[];
}
```

Add the method to the `CartState` interface, next to `restoreCart`:

```ts
  /**
   * Spec A (held-order lifecycle) — rehydrate a REOPENED fired order. Unlike
   * `restoreCart` (draft, fresh ids, no locks), this reuses each
   * `order_items.id` as the cart line id and pushes already-fired
   * (`is_locked`) lines into BOTH `lockedItemIds` (non-editable, excluded from
   * the next fire's RPC) AND `printedItemIds` (never reprinted). Sets
   * `pickedUpOrderId` so the next fire appends and checkout pays the existing
   * order.
   */
  reopenOrder: (payload: ReopenOrderPayload) => void;
```

Implement it inside the store object, right after `restoreCart`:

```ts
      reopenOrder: (payload) =>
        set(() => {
          const items: CartItem[] = payload.items.map((it) => ({
            id: it.id,
            product_id: it.product_id,
            name: it.name,
            unit_price: it.unit_price,
            quantity: it.quantity,
            modifiers: (it.modifiers ?? []) as SelectedModifiers,
          }));
          const lockedIds = payload.items.filter((it) => it.is_locked).map((it) => it.id);

          const cart: Cart = { items, order_type: payload.order_type as OrderType };
          if (payload.customerId !== null) cart.customerId = payload.customerId;
          if (payload.tableNumber !== null) cart.tableNumber = payload.tableNumber;

          return {
            cart,
            // Locked = already fired → non-editable AND non-reprinted.
            lockedItemIds: lockedIds,
            printedItemIds: lockedIds,
            attachedCustomer: null,
            pickedUpOrderId: payload.order_id,
            appliedPromotions: [],
            dismissedPromotionIds: new Set<string>(),
          };
        }),
```

(`OrderType` is already imported in the file's type import block — no new import needed.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @breakery/app-pos test cartStore.reopen`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck + commit**

```bash
pnpm --filter @breakery/app-pos typecheck
git add apps/pos/src/stores/cartStore.ts apps/pos/src/stores/__tests__/cartStore.reopen.test.ts
git commit -m "feat(pos): cartStore.reopenOrder rehydrates fired-order locks (Spec A Bloc 3)"
```

---

### Task 6: Send to Kitchen → hold the fired order & clear the terminal (Bloc 2 wiring)

After a successful manual fire **and** print, call `hold_fired_order_v1(order_id)` then reset the terminal so the cashier is free for the next customer. The order lives on in the DB and surfaces in Held Orders. The direct-checkout auto-fire path (`printOnly`) is untouched — it never goes through this button.

**Files:**
- Create: `apps/pos/src/features/cart/hooks/useHoldFiredOrder.ts`
- Modify: `apps/pos/src/features/cart/SendToKitchenButton.tsx`
- Test: `apps/pos/src/features/cart/__tests__/send-to-kitchen-holds.smoke.test.tsx`

**Interfaces:**
- Consumes: `cartStore.pickedUpOrderId` (set by `useFireToStations` after the fire persists), `resetCartAfterCheckout` from `@/stores/cartStore`, `supabase.rpc('hold_fired_order_v1', …)` (typed in Task 4).
- Produces: `useHoldFiredOrder()` returning a `useMutation` whose `mutateAsync(orderId: string)` calls the RPC and invalidates `['held-orders']`.

- [ ] **Step 1: Write the hook**

```ts
// apps/pos/src/features/cart/hooks/useHoldFiredOrder.ts
// Spec A, Bloc 2 — flag a freshly-fired counter order is_held=true so it leaves
// the terminal and appears in Held Orders ("addition ouverte"). Used by
// SendToKitchenButton after the fire + print succeed.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export function useHoldFiredOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (orderId: string): Promise<void> => {
      const { error } = await supabase.rpc('hold_fired_order_v1', { p_order_id: orderId });
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['held-orders'] });
    },
  });
}
```

- [ ] **Step 2: Write the failing smoke test**

```tsx
// apps/pos/src/features/cart/__tests__/send-to-kitchen-holds.smoke.test.tsx
/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const fireMutate = vi.fn().mockResolvedValue([{ role: 'barista', ok: true, itemIds: ['l1'] }]);
const holdMutate = vi.fn().mockResolvedValue(undefined);
const resetTerminal = vi.fn();

vi.mock('../hooks/useFireToStations', () => ({
  useFireToStations: () => ({
    mutation: { mutateAsync: fireMutate, isPending: false },
    firableCount: 1,
    unroutedCount: 0,
  }),
}));
vi.mock('../hooks/useHoldFiredOrder', () => ({
  useHoldFiredOrder: () => ({ mutateAsync: holdMutate, isPending: false }),
}));
vi.mock('@/stores/cartStore', async (orig) => {
  const mod = await orig<typeof import('@/stores/cartStore')>();
  return { ...mod, resetCartAfterCheckout: resetTerminal };
});
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));

import { SendToKitchenButton } from '../SendToKitchenButton';
import { useCartStore } from '@/stores/cartStore';

function wrap(n: React.ReactElement) {
  return <QueryClientProvider client={new QueryClient()}>{n}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  useCartStore.setState({
    cart: { items: [{ id: 'l1', product_id: 'p1', name: 'Latte', unit_price: 30000, quantity: 1, modifiers: [] }], order_type: 'dine_in' },
    lockedItemIds: [], printedItemIds: [], attachedCustomer: null,
    pickedUpOrderId: 'order-99', appliedPromotions: [], dismissedPromotionIds: new Set(), isOffline: false,
  } as never);
});

describe('SendToKitchenButton — hold after send', () => {
  it('holds the fired order then clears the terminal', async () => {
    render(wrap(<SendToKitchenButton />));
    fireEvent.click(screen.getByRole('button', { name: /send to kitchen/i }));
    await waitFor(() => expect(fireMutate).toHaveBeenCalled());
    await waitFor(() => expect(holdMutate).toHaveBeenCalledWith('order-99'));
    await waitFor(() => expect(resetTerminal).toHaveBeenCalled());
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @breakery/app-pos test send-to-kitchen-holds`
Expected: FAIL — `holdMutate`/`resetTerminal` never called (button doesn't hold yet).

- [ ] **Step 4: Wire hold + reset into the button**

In `apps/pos/src/features/cart/SendToKitchenButton.tsx`:

Add imports near the top:

```ts
import { useCartStore, resetCartAfterCheckout } from '@/stores/cartStore';
import { useHoldFiredOrder } from './hooks/useHoldFiredOrder';
```

(Replace the existing `import { useCartStore } from '@/stores/cartStore';` line with the combined import above.)

Inside the component, after `const { mutation, firableCount, unroutedCount } = useFireToStations();`:

```ts
  const holdFired = useHoldFiredOrder();
```

In `handleClick`, after the per-station toast loop and the `unroutedAtFire` warning block, **before** the closing `}` of the `try`, add:

```ts
      // Spec A Bloc 2 — park the fired order in Held Orders and free the
      // terminal for the next customer. The order persists in the DB (held);
      // it reappears in the held list and can be reopened later. Best-effort:
      // a hold failure leaves the order on the terminal (still payable), so we
      // only reset after the hold succeeds.
      const orderId = useCartStore.getState().pickedUpOrderId;
      if (orderId) {
        try {
          await holdFired.mutateAsync(orderId);
          resetCartAfterCheckout();
          toast.info('Order sent & parked in Held Orders');
        } catch (holdErr) {
          const he = holdErr as Error;
          toast.error(`Sent to kitchen, but could not park the order: ${he.message}`);
        }
      }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @breakery/app-pos test send-to-kitchen-holds`
Expected: PASS.

- [ ] **Step 6: Run the existing Send-to-Kitchen smokes (no regression)**

Run: `pnpm --filter @breakery/app-pos test fire-unrouted-warning bottom-bar-hierarchy`
Expected: PASS (unchanged behavior — these don't set `pickedUpOrderId`, so the new hold block is skipped).

- [ ] **Step 7: Typecheck + commit**

```bash
pnpm --filter @breakery/app-pos typecheck
git add apps/pos/src/features/cart/hooks/useHoldFiredOrder.ts \
        apps/pos/src/features/cart/SendToKitchenButton.tsx \
        apps/pos/src/features/cart/__tests__/send-to-kitchen-holds.smoke.test.tsx
git commit -m "feat(pos): Send to Kitchen parks the fired order & clears the terminal (Spec A Bloc 2)"
```

---

### Task 7: `useReopenHeldOrder` hook + live RPC round-trip

The reopen counterpart of `useRestoreHeldOrder`: calls `reopen_held_order_v1`, rehydrates via `cartStore.reopenOrder`, then best-effort refetches the customer badge (same `get_customer_v2` pattern). Plus a live-RPC test proving the DB round-trip (hold → reopen) preserves locks and that `is_held` flips correctly.

**Files:**
- Create: `apps/pos/src/features/heldOrders/hooks/useReopenHeldOrder.ts`
- Test (unit/smoke, mocked RPC): `apps/pos/src/features/heldOrders/__tests__/reopen-held-order.smoke.test.tsx`
- Test (live RPC, controller-run): `supabase/tests/functions/reopen-held-order-v1.test.ts`

**Interfaces:**
- Consumes: `supabase.rpc('reopen_held_order_v1', …)`, `cartStore.reopenOrder` + `ReopenOrderPayload` (Task 5), `get_customer_v2`, `attachCustomer`.
- Produces: `useReopenHeldOrder()` → `useMutation` whose `mutateAsync(orderId: string): Promise<string>` resolves to the `order_id` and invalidates `['held-orders']`.

- [ ] **Step 1: Write the hook**

```ts
// apps/pos/src/features/heldOrders/hooks/useReopenHeldOrder.ts
// Spec A, Bloc 3 — reopen a held FIRED order (status='pending_payment') via
// reopen_held_order_v1. Unlike useRestoreHeldOrder (draft, deletes server-side,
// fresh ids), this preserves order_items.id + lock state so already-fired lines
// stay non-editable / non-reprinted. The RPC claims the order (is_held=false).
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useCartStore } from '@/stores/cartStore';
import type { ReopenOrderPayload } from '@/stores/cartStore';
import type { CustomerWithCategory } from '@/features/customers/hooks/useCustomerSearch';

export function useReopenHeldOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (orderId: string): Promise<string> => {
      const { data, error } = await supabase.rpc('reopen_held_order_v1', {
        p_order_id: orderId,
      });
      if (error) throw error;
      const payload = data as unknown as ReopenOrderPayload;

      useCartStore.getState().reopenOrder(payload);

      // Best-effort customer badge restore (mirrors useRestoreHeldOrder): pricing
      // runs off cart.customerId (already set by reopenOrder), so a lookup miss
      // just leaves the badge absent. Definer RPC get_customer_v2 survives the
      // customers.read SELECT gate.
      if (payload.customerId !== null) {
        try {
          const { data: customers } = await supabase.rpc('get_customer_v2', {
            p_id: payload.customerId,
          });
          const customer = (customers ?? [])[0];
          if (customer) {
            useCartStore.getState().attachCustomer({
              ...customer,
              category: (customer as { category?: unknown }).category ?? null,
            } as unknown as CustomerWithCategory);
          }
        } catch {
          // best-effort
        }
      }

      return payload.order_id;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['held-orders'] });
    },
  });
}
```

- [ ] **Step 2: Write the failing smoke test (mocked RPC)**

```tsx
// apps/pos/src/features/heldOrders/__tests__/reopen-held-order.smoke.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const rpc = vi.fn();
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));

import { useReopenHeldOrder } from '../hooks/useReopenHeldOrder';
import { useCartStore } from '@/stores/cartStore';

function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  useCartStore.setState({
    cart: { items: [], order_type: 'take_out' },
    lockedItemIds: [], printedItemIds: [], attachedCustomer: null,
    pickedUpOrderId: null, appliedPromotions: [], dismissedPromotionIds: new Set(), isOffline: false,
  } as never);
});

describe('useReopenHeldOrder', () => {
  it('rehydrates the fired order with locked lines into the cart', async () => {
    rpc.mockResolvedValueOnce({
      data: {
        order_id: 'order-5', order_number: '#0005', order_type: 'dine_in',
        customerId: null, tableNumber: '7', notes: null,
        items: [
          { id: 'oi-1', product_id: 'p1', name: 'Latte', unit_price: 30000, quantity: 1, modifiers: [], is_locked: true, kitchen_status: 'pending' },
        ],
      },
      error: null,
    });

    const { result } = renderHook(() => useReopenHeldOrder(), { wrapper });
    const orderId = await result.current.mutateAsync('order-5');

    expect(orderId).toBe('order-5');
    await waitFor(() => {
      const s = useCartStore.getState();
      expect(s.pickedUpOrderId).toBe('order-5');
      expect(s.cart.items.map((i) => i.id)).toEqual(['oi-1']);
      expect(s.lockedItemIds).toEqual(['oi-1']);
      expect(s.printedItemIds).toEqual(['oi-1']);
    });
  });
});
```

- [ ] **Step 3: Run the smoke test to verify it fails, then passes**

Run: `pnpm --filter @breakery/app-pos test reopen-held-order`
Expected: initially the hook file may not exist → FAIL; after Step 1 is in place it should PASS. (If you authored Step 1 first, this is a straight PASS — that is fine, the test still pins the contract.)

- [ ] **Step 4: Write the live-RPC round-trip test (controller-run)**

Mirror the auth setup of `supabase/tests/functions/pay-existing-order-v4.test.ts` (PIN-JWT login helper). The test:

```ts
// supabase/tests/functions/reopen-held-order-v1.test.ts
// Live RPC round-trip (V3 dev cloud). Mirrors the login/seed helpers used by the
// other supabase/tests/functions specs. Skipped when live env vars are absent.
import { describe, it, expect } from 'vitest';
// import { signInCashier, adminClient } from './_helpers'; // reuse the suite's helpers

describe.skipIf(!process.env.SUPABASE_TEST_LIVE)('reopen_held_order_v1 (live)', () => {
  it('hold → reopen preserves locks, flips is_held false→…→reopened, no item dup', async () => {
    // 1. As CASHIER, fire a counter order (fire_counter_order_v4) → order_id, items is_locked=true.
    // 2. hold_fired_order_v1(order_id) → row now is_held=true (appears in held list).
    // 3. reopen_held_order_v1(order_id) → returns items[] with is_locked=true + order_items.id;
    //    DB row is_held=false; order NOT deleted (still status='pending_payment').
    // 4. A 2nd reopen_held_order_v1(order_id) throws P0002 (already open / not held).
    // 5. Append a NEW item via fire_counter_order_v4(p_order_id=order_id) → exactly ONE new
    //    order_items row (the locked lines were excluded client-side); total item count = N+1.
    expect(true).toBe(true); // replace with the real assertions per the suite's helpers
  });
});
```

> The executor fills the steps using the existing `supabase/tests/functions` helpers (login as a cashier via PIN-JWT, admin client for seeding/cleanup). Keep it `describe.skipIf` so CI without live creds stays green, matching the suite.

- [ ] **Step 5: Run the live RPC test (controller, where live creds exist)**

Run: `pnpm --filter @breakery/supabase test reopen-held-order-v1`
Expected: PASS when `SUPABASE_TEST_LIVE` is set; SKIPPED otherwise.

- [ ] **Step 6: Typecheck + commit**

```bash
pnpm --filter @breakery/app-pos typecheck
git add apps/pos/src/features/heldOrders/hooks/useReopenHeldOrder.ts \
        apps/pos/src/features/heldOrders/__tests__/reopen-held-order.smoke.test.tsx \
        supabase/tests/functions/reopen-held-order-v1.test.ts
git commit -m "feat(pos): useReopenHeldOrder + live round-trip (Spec A Bloc 3)"
```

---

### Task 8: Held list discriminates draft vs sent, and routes to reopen

`useHeldOrdersQuery` now selects `status` (and `sent_to_kitchen_at`) so the modal can branch: `status='draft'` → existing `restore_held_order_v1` path; `status='pending_payment'` → new `reopen_held_order_v1` path. A badge distinguishes "Draft" vs "Sent". Fired orders carry `total=0` (computed at payment) — the card hides the amount when it is 0 to avoid showing "Rp 0".

**Files:**
- Modify: `apps/pos/src/features/heldOrders/hooks/useHeldOrdersQuery.ts`
- Modify: `apps/pos/src/features/cart/HeldOrdersModal.tsx`
- Test: `apps/pos/src/features/heldOrders/__tests__/held-list-reopen-branch.smoke.test.tsx`

**Interfaces:**
- Consumes: `useReopenHeldOrder` (Task 7), `useRestoreHeldOrder` (existing).
- Produces: `HeldOrderRow` gains `status: string` and `sent_to_kitchen_at: string | null`. The modal calls reopen vs restore based on `row.status`.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/pos/src/features/heldOrders/__tests__/held-list-reopen-branch.smoke.test.tsx
/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const reopenMutate = vi.fn().mockResolvedValue('order-5');
const restoreMutate = vi.fn().mockResolvedValue('order-9');

vi.mock('@/features/heldOrders/hooks/useHeldOrdersQuery', () => ({
  useHeldOrdersQuery: () => ({
    data: [
      { id: 'order-5', order_number: '#0005', table_number: '7', notes: null, total: 0, created_at: '2026-06-25T10:00:00Z', status: 'pending_payment', sent_to_kitchen_at: '2026-06-25T09:59:00Z' },
      { id: 'order-9', order_number: 'HELD-x', table_number: null, notes: null, total: 50000, created_at: '2026-06-25T10:01:00Z', status: 'draft', sent_to_kitchen_at: null },
    ],
    isLoading: false,
  }),
}));
vi.mock('@/features/heldOrders/hooks/useReopenHeldOrder', () => ({ useReopenHeldOrder: () => ({ mutateAsync: reopenMutate }) }));
vi.mock('@/features/heldOrders/hooks/useRestoreHeldOrder', () => ({ useRestoreHeldOrder: () => ({ mutateAsync: restoreMutate }) }));
vi.mock('@/features/heldOrders/hooks/useDiscardHeldOrder', () => ({ useDiscardHeldOrder: () => ({ mutateAsync: vi.fn() }) }));
vi.mock('@/features/heldOrders/hooks/useHeldOrdersRealtime', () => ({ useHeldOrdersRealtime: () => {} }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { HeldOrdersModal } from '@/features/cart/HeldOrdersModal';
import { useCartStore } from '@/stores/cartStore';

function wrap(n: React.ReactElement) {
  return <QueryClientProvider client={new QueryClient()}>{n}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  useCartStore.setState({
    cart: { items: [], order_type: 'take_out' },
    lockedItemIds: [], printedItemIds: [], attachedCustomer: null,
    pickedUpOrderId: null, appliedPromotions: [], dismissedPromotionIds: new Set(), isOffline: false,
  } as never);
});

describe('HeldOrdersModal — draft vs sent branch', () => {
  it('routes a sent (pending_payment) order to reopen', async () => {
    render(wrap(<HeldOrdersModal open onClose={() => {}} />));
    fireEvent.click(screen.getByRole('button', { name: /restore held order #0005/i }));
    await waitFor(() => expect(reopenMutate).toHaveBeenCalledWith('order-5'));
    expect(restoreMutate).not.toHaveBeenCalled();
  });

  it('routes a draft order to restore', async () => {
    render(wrap(<HeldOrdersModal open onClose={() => {}} />));
    fireEvent.click(screen.getByRole('button', { name: /restore held order HELD-x/i }));
    await waitFor(() => expect(restoreMutate).toHaveBeenCalledWith('order-9'));
    expect(reopenMutate).not.toHaveBeenCalled();
  });

  it('shows a Sent badge for fired orders and a Draft badge for drafts', () => {
    render(wrap(<HeldOrdersModal open onClose={() => {}} />));
    expect(screen.getByText(/sent/i)).toBeInTheDocument();
    expect(screen.getByText(/draft/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @breakery/app-pos test held-list-reopen-branch`
Expected: FAIL — `HeldOrderRow` has no `status`; modal only calls restore; no Sent/Draft badge.

- [ ] **Step 3: Extend the query**

In `apps/pos/src/features/heldOrders/hooks/useHeldOrdersQuery.ts`, extend `HeldOrderRow` and the select:

```ts
export interface HeldOrderRow {
  id: string;
  order_number: string;
  table_number: string | null;
  notes: string | null;
  total: number;
  created_at: string;
  status: string;
  sent_to_kitchen_at: string | null;
}
```

```ts
        .select('id, order_number, table_number, notes, total, created_at, status, sent_to_kitchen_at')
```

- [ ] **Step 4: Branch the modal + add badges**

In `apps/pos/src/features/cart/HeldOrdersModal.tsx`:

Add the reopen hook import next to the restore import:

```ts
import { useReopenHeldOrder } from '@/features/heldOrders/hooks/useReopenHeldOrder';
```

In `HeldOrdersModal`, add `const reopen = useReopenHeldOrder();` next to `const restore = useRestoreHeldOrder();`, and rewrite `doRestore` to branch on the row's status. Change the signature to take the row:

```ts
  async function doRestore(row: HeldOrderRow): Promise<void> {
    if (row.status === 'pending_payment') {
      await reopen.mutateAsync(row.id);
    } else {
      await restore.mutateAsync(row.id);
    }
    onClose();
  }
```

Update `handleRestoreTap` to take the row and pass it through:

```ts
  function handleRestoreTap(row: HeldOrderRow): void {
    if (pickedUpOrderId) {
      toast.error('Finish or void the current fired order before restoring a held one.');
      return;
    }
    if (cartHasItems) {
      setConfirmRow(row);
      return;
    }
    void doRestore(row);
  }
```

Replace the `confirmId` state with a row (so the replace-confirm path also branches):

```ts
  const [confirmRow, setConfirmRow] = useState<HeldOrderRow | null>(null);
```

```ts
  function handleConfirmReplace(): void {
    if (confirmRow) {
      void doRestore(confirmRow);
      setConfirmRow(null);
    }
  }
```

Update the card render call and the replace dialog `open`/`onOpenChange`:

```tsx
                  <HeldOrderCard
                    key={row.id}
                    row={row}
                    onRestore={() => handleRestoreTap(row)}
                    onDelete={() => handleDelete(row.id)}
                  />
```

```tsx
      <Dialog open={confirmRow !== null} onOpenChange={(o) => !o && setConfirmRow(null)}>
```

```tsx
              onClick={() => setConfirmRow(null)}
```

In `HeldOrderCard`, add a Sent/Draft badge in the header strip (next to the existing table badge). Add it right after the `font-mono` label span:

```tsx
          <span
            className={cn(
              'inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-widest',
              row.status === 'pending_payment'
                ? 'bg-gold/20 text-gold'
                : 'bg-bg-overlay text-text-muted',
            )}
          >
            {row.status === 'pending_payment' ? 'Sent' : 'Draft'}
          </span>
```

In `HeldOrderCard`'s footer, hide the amount when `row.total` is 0 (fired orders compute their total at payment) — replace the `<Currency …>` line with:

```tsx
          {row.total > 0 ? (
            <Currency amount={row.total} emphasis="gold" className="text-xl font-semibold" />
          ) : (
            <span className="text-sm text-text-muted">—</span>
          )}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @breakery/app-pos test held-list-reopen-branch`
Expected: PASS (3 tests).

- [ ] **Step 6: Run the existing held-orders query smoke (no regression)**

Run: `pnpm --filter @breakery/app-pos test held-orders-query`
Expected: PASS (extending the select is additive). If the existing test asserts the exact select string, update it to include the two new columns.

- [ ] **Step 7: Typecheck + commit**

```bash
pnpm --filter @breakery/app-pos typecheck
git add apps/pos/src/features/heldOrders/hooks/useHeldOrdersQuery.ts \
        apps/pos/src/features/cart/HeldOrdersModal.tsx \
        apps/pos/src/features/heldOrders/__tests__/held-list-reopen-branch.smoke.test.tsx
git commit -m "feat(pos): held list branches draft→restore / sent→reopen with badges (Spec A Bloc 3)"
```

---

### Task 9: "ADDITIONAL ORDER" KOT flag on appended fires (Bloc 4)

When the fire is an **append** to an already-reopened order (the order existed at fire time and it is not the post-payment `printOnly` path), the station ticket carries `additional: true` so the print template (print-server side) renders an "ADDITIONAL ORDER" header. Phase-1 lines are not reprinted — already guaranteed by `printedItemIds` rehydrated in Task 5/7.

**Files:**
- Modify: `apps/pos/src/services/print/printService.ts`
- Modify: `apps/pos/src/features/cart/hooks/useFireToStations.ts`
- Test: `apps/pos/src/features/cart/__tests__/fire-additional-flag.smoke.test.tsx`

**Interfaces:**
- Consumes: `cartStore.pickedUpOrderId` (set ⇒ this fire appends to an existing order), `FireContext.printOnly`, `getMockPrintBuffer`/`clearMockPrintBuffer` from the print service.
- Produces: `StationTicketPayload` gains `additional?: boolean`. `useFireToStations` sets it `true` exactly when `pickedUpOrderId` was already set at fire start **and** not `printOnly`.

- [ ] **Step 1: Add the field to the payload type**

In `apps/pos/src/services/print/printService.ts`, add to `StationTicketPayload` (after `items`):

```ts
  /**
   * Spec A Bloc 4 — true when these lines are a 2nd-phase append to a reopened
   * order. The print template renders an "ADDITIONAL ORDER" header so the
   * station knows it's a top-up, not a fresh ticket.
   */
  additional?: boolean;
```

- [ ] **Step 2: Write the failing smoke test**

```tsx
// apps/pos/src/features/cart/__tests__/fire-additional-flag.smoke.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Force the print service mock buffer (VITE_PRINT_MOCK path).
vi.stubEnv('VITE_PRINT_MOCK', '1');

const rpc = vi.fn().mockResolvedValue({
  data: { order_id: 'order-1', order_number: '#0001', idempotent_replay: false }, error: null,
});
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));
vi.mock('../hooks/useStationPrinters', () => ({
  useStationPrinters: () => ({ data: new Map([['barista', { ip_address: '1.1.1.1', port: 9100 }]]) }),
}));
vi.mock('../hooks/useStationMap', () => ({
  useStationMap: () => ({ data: { p1: 'barista' } }),
  getStationMap: async () => ({ p1: 'barista' }),
}));

import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useFireToStations } from '../hooks/useFireToStations';
import { useCartStore } from '@/stores/cartStore';
import { useShiftStore } from '@/stores/shiftStore';
import { getMockPrintBuffer, clearMockPrintBuffer } from '@/services/print/printService';

function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  clearMockPrintBuffer();
  useShiftStore.setState({ current: { id: 'shift-1' } } as never);
  useCartStore.setState({
    cart: { items: [{ id: 'l1', product_id: 'p1', name: 'Latte', unit_price: 30000, quantity: 1, modifiers: [] }], order_type: 'dine_in' },
    lockedItemIds: [], printedItemIds: [], attachedCustomer: null,
    pickedUpOrderId: 'order-1', // already reopened → this fire is an append
    appliedPromotions: [], dismissedPromotionIds: new Set(), isOffline: false,
  } as never);
});

describe('useFireToStations — additional flag', () => {
  it('marks the station ticket additional when appending to a reopened order', async () => {
    const { result } = renderHook(() => useFireToStations(), { wrapper });
    await act(async () => { await result.current.mutation.mutateAsync(undefined); });
    const stationEntries = getMockPrintBuffer().filter((e) => e.kind === 'prep');
    expect(stationEntries.length).toBeGreaterThan(0);
    expect(stationEntries.every((e) => (e.payload as { additional?: boolean }).additional === true)).toBe(true);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @breakery/app-pos test fire-additional-flag`
Expected: FAIL — `additional` is `undefined` on the buffered payload.

- [ ] **Step 4: Set the flag in `useFireToStations`**

In `apps/pos/src/features/cart/hooks/useFireToStations.ts`, inside `mutationFn`, capture whether this fire is an append **before** any state mutation. Right after `const { orderNumber, tableNumber, printOnly = false } = ctx ?? {};` add:

```ts
      // Spec A Bloc 4 — this fire is an "additional order" (2nd phase) when the
      // order already exists on the terminal (reopened ⇒ pickedUpOrderId set)
      // and we are not in the post-payment printOnly path.
      const isAdditional = !printOnly && useCartStore.getState().pickedUpOrderId !== null;
```

Then in the `payload` object construction (the `StationTicketPayload`), add the field after `items: …,`:

```ts
            ...(isAdditional ? { additional: true } : {}),
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @breakery/app-pos test fire-additional-flag`
Expected: PASS.

- [ ] **Step 6: Typecheck + commit**

```bash
pnpm --filter @breakery/app-pos typecheck
git add apps/pos/src/services/print/printService.ts \
        apps/pos/src/features/cart/hooks/useFireToStations.ts \
        apps/pos/src/features/cart/__tests__/fire-additional-flag.smoke.test.tsx
git commit -m "feat(pos): ADDITIONAL ORDER flag on appended station tickets (Spec A Bloc 4)"
```

> **Note (out of repo):** the actual "ADDITIONAL ORDER" header rendering lives in the external print-bridge server (`localhost:3001`, `/print/ticket`). This task ships the **payload contract** (`additional: boolean`); coordinate the header text with whoever owns the print-bridge template. The flag is forwarded verbatim by `printStationTicket` (it spreads `...payload` into the POST body).

---

### Task 10: Full-suite verification & workplan bump

**Files:**
- Modify: `CLAUDE.md` (Active Workplan "In flight" bullet)

- [ ] **Step 1: Typecheck the whole repo**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 2: Run the POS + domain suites**

Run: `pnpm --filter @breakery/app-pos test && pnpm --filter @breakery/domain test`
Expected: PASS (modulo any pre-existing env-gated baseline failures — confirm each failure predates this branch before dismissing it; never wave through a new red).

- [ ] **Step 3: Build**

Run: `pnpm build`
Expected: PASS (clean build).

- [ ] **Step 4: Re-run the three pgTAP files on the controller (MCP)**

Run each of `supabase/tests/route_categories_prep_stations.test.sql`, `hold_fired_order_v1.test.sql`, `reopen_held_order_v1.test.sql` via `execute_sql`.
Expected: all green.

- [ ] **Step 5: Bump the Active Workplan**

In `CLAUDE.md`, update the **In flight** bullet to note Spec A (POS held-order lifecycle) shipped: data-routing migration + `hold_fired_order_v1` + `reopen_held_order_v1` (cloud `20260710000010/11/12`, types regen'd), `cartStore.reopenOrder`, Send-to-Kitchen parks+clears, held list draft/sent branch, ADDITIONAL KOT flag. Link this plan and the spec. Note Spec B (display station, waiter destination, full category mapping) as the remaining follow-up.

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: note Spec A POS held-order lifecycle shipped"
```

---

## Spec Coverage Check

- §4 Bloc 1 (routing) → **Task 1**.
- §4 Bloc 2 (`hold_fired_order_v1`, REVOKE pair, hold-after-send + clear terminal, checkout unchanged) → **Task 2** (RPC) + **Task 6** (wiring). Checkout `printOnly` path is deliberately not routed through the button (Task 6 only fires on the manual button; Task 9 Step 4 guards `additional` with `!printOnly`).
- §4 Bloc 3 (`reopen_held_order_v1` returns items+locks, sets `is_held=false`, no delete, audit; `cartStore.reopenOrder`; held list status branch + badge) → **Tasks 3, 5, 7, 8**.
- §4 Bloc 4 (append fire excludes locked lines — already in `fire_counter_order_v4`/`useFireToStations`; `additional` flag; phase-1 not reprinted via `printedItemIds`) → **Task 9** + locks rehydrated in **Tasks 5/7**.
- §5 invariants (RPC versioning monotone, REVOKE S25, idempotence, audit, void path, RPC-only writes, types regen, concurrency claim) → Global Constraints + **Tasks 2/3** (REVOKE, audit, claim), **Task 4** (types). Void path: a reopened order has `pickedUpOrderId` set ⇒ `useVoidServerOrder` already routes it through the void-order EF (verified in `useVoidServerOrder.ts`); no change needed — confirmed, not re-tested here.
- §6 tests → pgTAP (Tasks 1/2/3), Vitest live RPC (Task 7), POS smokes (Tasks 6/8/9), domain/store unit (Task 5), cheap-first ordering (Task 10).
- §7 risks → the `total=0` display wrinkle for fired held orders is handled in Task 8 Step 4 (hide amount when 0). The waiter/multi-destination reserve is explicitly Spec B (out of scope).
- §8 Suite (Spec B) → noted in Task 10 Step 5, not implemented.
