# Session 8 — Promotions Engine Implementation Plan

> **Trace historique** : ce fichier documente une session de travail datée. Le fond reste l'enregistrement de cette date. Seules les références de chemin ont été alignées sur la nouvelle structure (voir [`../../README.md`](../../README.md)).
> **Last refreshed** : 2026-05-13
> **Modules de référence associés** : [`../../reference/04-modules/13-promotions-discounts.md`](../../reference/04-modules/13-promotions-discounts.md), [`../../reference/04-modules/02-pos-cart-orders.md`](../../reference/04-modules/02-pos-cart-orders.md).

> **STATUS — 2026-05-10 :** Implementation **COMPLETED** on branch `swarm/session-8`.
> - All 31 tasks across 6 phases shipped (commits `0f29ad6` → `ce5fecc`).
> - 643/643 unit tests green (138 POS + 301 domain + 176 UI + 27 utils + 1 backoffice).
> - 35/35 pgTAP tests green (20 evaluate_promotions + 15 RPCs integration).
> - 3 latent bugs in `create_tablet_order` / `complete_order_with_payment` discovered
>   via pgTAP and patched in migration `20260510000009_fix_promo_rpcs.sql`:
>   1. item shape (`quantity` → `qty`) not transformed before `evaluate_promotions`,
>   2. `name_snapshot` missing on promo-item `INSERT` (NOT NULL crash on BOGO/free),
>   3. `IF v_applied_promo IS NOT NULL` true even for JSON `null`.
> - **Task 6.3 (manual browser acceptance) pending** — last item before merging
>   `swarm/session-8` into `master`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Livrer un moteur de promotions auto-évaluées (4 forms : `percentage_off`, `fixed_off`, `bogo`, `free_product`) avec live preview POS/tablet, freeze à create_tablet_order time (P10), et persistance complète au checkout via `complete_order_with_payment` v6.

**Spec source:** `docs/workplan/specs/2026-05-07-session-8-promotions-engine-spec.md`

**Architecture:** Engine RPC Postgres `evaluate_promotions(p_items, p_customer_id, p_evaluation_ts)` autoritaire → consommé en preview live (debounce 300 ms) côté POS + tablet et re-appelé server-side au checkout. Persistance via table dédiée `order_promotions` (cart-level / item-level avec `metadata` JSONB snapshot) + colonnes `order_items.promotion_id` / `promotion_discount` / `is_free_from_promo` + `orders.promotion_total_amount`.

**Tech Stack:** Supabase Postgres (JSONB conditions + action_params), pgTAP, TypeScript domain (Vitest), React + Zustand (POS), shadcn/ui (badges/rows), react-query.

**Dépend de :** Sessions 1-7 (POS + tablet + customer categories + combos + manual discounts + loyalty multipliers).

**Phases :**
1. DB — 8 migrations + pgTAP (~10 tasks)
2. Domain — types + 9 evaluators + 4 action computeurs + selectBest + calculateTotals extend (~10 tasks)
3. UI — 3 composants partagés (~3 tasks)
4. POS — store + hooks + cart panel + payment terminal (~8 tasks)
5. Tablet — integration freeze flow (~2 tasks)
6. Smoke tests + acceptance (~3 tasks)

**À la fin :**
- 5 promos seedées (Happy Hour Bev, Spend50k, BOGO Croissant, Free Americano 100k+, VIP 20%) toutes éligibles selon contextes différents
- Best-only stacking auto. Stackable avec manual + redemption.
- P10 freeze tablet → POS pickup ne re-évalue pas
- P12 mutual exclusion : manual line discount → engine skip ce produit
- `pnpm lint` 0 warning, `pnpm typecheck` 0 erreur, `pnpm test` 600+ tests pass
- Tous les critères d'acceptation §6 du spec validés manuellement

---

## Phase 1 — Database

### Task 1.1 — Migration `init_promotions` (enum + table)

**Files:**
- Create: `supabase/migrations/20260510000001_init_promotions.sql`

- [ ] **Step 1: Créer le fichier de migration**

```sql
-- 20260510000001_init_promotions.sql
-- Session 8 / migration 1 : enum promotion_action_type + table promotions + RLS.
-- Spec: docs/workplan/specs/2026-05-07-session-8-promotions-engine-spec.md §3.1, §3.2, §3.12

CREATE TYPE promotion_action_type AS ENUM (
  'percentage_off',
  'fixed_off',
  'bogo',
  'free_product'
);

CREATE TABLE promotions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  slug            TEXT NOT NULL UNIQUE,
  description     TEXT,
  action_type     promotion_action_type NOT NULL,
  action_params   JSONB NOT NULL DEFAULT '{}'::JSONB,
  conditions      JSONB NOT NULL DEFAULT '{"all": []}'::JSONB,
  priority        INTEGER NOT NULL DEFAULT 0,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ,

  CHECK (jsonb_typeof(action_params) = 'object'),
  CHECK (jsonb_typeof(conditions) = 'object'),
  CHECK (conditions ? 'all')
);

CREATE INDEX idx_promotions_active
  ON promotions(action_type)
  WHERE deleted_at IS NULL AND is_active;

ALTER TABLE promotions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_read_active" ON promotions FOR SELECT
  USING (is_authenticated() AND deleted_at IS NULL AND is_active);
```

- [ ] **Step 2: Appliquer la migration**

```bash
supabase db reset
```

Expected: pas d'erreur, log "Applied migration 20260510000001_init_promotions".

- [ ] **Step 3: Vérifier la table dans psql**

```bash
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -c "\d promotions"
```

Expected: 12 colonnes listées, 3 CHECK constraints, RLS enabled.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260510000001_init_promotions.sql
git commit -m "feat(db): session 8 — init promotions table + enum + RLS"
```

---

### Task 1.2 — Migration `init_order_promotions`

**Files:**
- Create: `supabase/migrations/20260510000002_init_order_promotions.sql`

- [ ] **Step 1: Créer le fichier**

```sql
-- 20260510000002_init_order_promotions.sql
-- Session 8 / migration 2 : table d'audit order_promotions (cart-level OU item-level).
-- Spec: §3.5, §3.12.

CREATE TABLE order_promotions (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id             UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  promotion_id         UUID NOT NULL REFERENCES promotions(id) ON DELETE RESTRICT,
  target               TEXT NOT NULL CHECK (target IN ('cart', 'item')),
  target_order_item_id UUID REFERENCES order_items(id) ON DELETE CASCADE,
  discount_amount      DECIMAL(14,2) NOT NULL CHECK (discount_amount >= 0),
  free_item_added      BOOLEAN NOT NULL DEFAULT false,
  metadata             JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

  CHECK (
    (target = 'cart' AND target_order_item_id IS NULL) OR
    (target = 'item' AND target_order_item_id IS NOT NULL)
  )
);

CREATE INDEX idx_order_promotions_order ON order_promotions(order_id);
CREATE INDEX idx_order_promotions_promotion ON order_promotions(promotion_id);

ALTER TABLE order_promotions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_read" ON order_promotions FOR SELECT
  USING (is_authenticated());
-- Pas de WRITE policy : insert via RPC SECURITY DEFINER uniquement.
```

- [ ] **Step 2: Reset DB et vérifier**

```bash
supabase db reset
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -c "\d order_promotions"
```

Expected: 9 colonnes, 2 indexes, 2 CHECK constraints, RLS enabled.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260510000002_init_order_promotions.sql
git commit -m "feat(db): session 8 — order_promotions audit table"
```

---

### Task 1.3 — Migration ALTER order_items + orders

**Files:**
- Create: `supabase/migrations/20260510000003_add_order_items_promotion_cols.sql`

- [ ] **Step 1: Créer le fichier**

```sql
-- 20260510000003_add_order_items_promotion_cols.sql
-- Session 8 / migration 3 : ALTER order_items + orders pour promo persistence.
-- Spec: §3.6, §3.7.

ALTER TABLE order_items
  ADD COLUMN promotion_id        UUID REFERENCES promotions(id) ON DELETE SET NULL,
  ADD COLUMN promotion_discount  DECIMAL(14,2) NOT NULL DEFAULT 0
                                 CHECK (promotion_discount >= 0),
  ADD COLUMN is_free_from_promo  BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX idx_order_items_promotion
  ON order_items(promotion_id)
  WHERE promotion_id IS NOT NULL;

ALTER TABLE orders
  ADD COLUMN promotion_total_amount DECIMAL(14,2) NOT NULL DEFAULT 0
                                    CHECK (promotion_total_amount >= 0);
```

- [ ] **Step 2: Reset et vérifier**

```bash
supabase db reset
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -c "\d order_items" | grep -E "promotion_id|promotion_discount|is_free_from_promo"
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -c "\d orders" | grep "promotion_total_amount"
```

Expected: 3 nouvelles colonnes sur `order_items`, 1 sur `orders`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260510000003_add_order_items_promotion_cols.sql
git commit -m "feat(db): session 8 — ALTER order_items + orders for promotion cols"
```

---

### Task 1.4 — Migration `evaluate_promotions` RPC

**Files:**
- Create: `supabase/migrations/20260510000004_evaluate_promotions_rpc.sql`

- [ ] **Step 1: Créer le fichier (header + drop)**

```sql
-- 20260510000004_evaluate_promotions_rpc.sql
-- Session 8 / migration 4 : engine RPC qui evalue toutes les promos actives
-- contre p_items, p_customer_id, p_evaluation_ts et retourne best-only.
-- Spec: §3.8, conditions §3.4, action_params §3.3.

DO $drop$
DECLARE _r RECORD;
BEGIN
  FOR _r IN SELECT oid::regprocedure AS sig FROM pg_proc
    WHERE proname = 'evaluate_promotions' AND pronamespace = 'public'::regnamespace
  LOOP
    EXECUTE 'DROP FUNCTION ' || _r.sig::text || ' CASCADE';
  END LOOP;
END $drop$;
```

- [ ] **Step 2: Ajouter signature + DECLARE**

Append au fichier :

```sql
CREATE OR REPLACE FUNCTION evaluate_promotions(
  p_items          JSONB,
  p_customer_id    UUID DEFAULT NULL,
  p_evaluation_ts  TIMESTAMPTZ DEFAULT now()
) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_promo                 RECORD;
  v_condition             JSONB;
  v_eligible              BOOLEAN;
  v_skip_reason           TEXT;
  v_potential_discount    DECIMAL(14,2);
  v_subtotal              DECIMAL(14,2);
  v_matching_qty          INTEGER;
  v_matching_subtotal     DECIMAL(14,2);
  v_customer_category_id  UUID;
  v_customer_tier         TEXT;
  v_customer_first_order  BOOLEAN;
  v_local_time            TIME;
  v_local_dow             INTEGER;
  v_local_date            DATE;
  v_pairs                 INTEGER;
  v_buy_product_id        UUID;
  v_buy_qty               INTEGER;
  v_get_qty               INTEGER;
  v_get_discount_pct      INTEGER;
  v_get_discount_per_unit DECIMAL(14,2);
  v_target                TEXT;
  v_target_id             UUID;
  v_percentage            INTEGER;
  v_amount                DECIMAL(14,2);
  v_free_product_id       UUID;
  v_free_qty              INTEGER;
  v_buy_unit_price        DECIMAL(14,2);
  v_free_unit_price       DECIMAL(14,2);
  v_best_promo_id         UUID;
  v_best_promo_name       TEXT;
  v_best_action_type      promotion_action_type;
  v_best_target           TEXT;
  v_best_target_pid       UUID;
  v_best_discount         DECIMAL(14,2) := 0;
  v_best_items_to_add     JSONB := '[]'::JSONB;
  v_skipped               JSONB := '[]'::JSONB;
  v_item                  JSONB;
BEGIN
  -- (continue in next step)
END $$;
```

- [ ] **Step 3: Ajouter customer resolution + subtotal**

Insère le corps de la fonction (avant le `END $$;`) :

```sql
  -- Resolve customer category, tier, first_order
  IF p_customer_id IS NOT NULL THEN
    SELECT c.category_id INTO v_customer_category_id
      FROM customers c WHERE c.id = p_customer_id;
    IF v_customer_category_id IS NULL THEN
      SELECT id INTO v_customer_category_id FROM customer_categories
        WHERE is_default = true AND deleted_at IS NULL;
    END IF;
    SELECT
      CASE
        WHEN COALESCE(c.lifetime_points, 0) >= 5000 THEN 'Platinum'
        WHEN COALESCE(c.lifetime_points, 0) >= 2000 THEN 'Gold'
        WHEN COALESCE(c.lifetime_points, 0) >= 500  THEN 'Silver'
        ELSE 'Bronze'
      END,
      COALESCE(c.lifetime_orders, 0) = 0
      INTO v_customer_tier, v_customer_first_order
      FROM customers c WHERE c.id = p_customer_id;
  ELSE
    SELECT id INTO v_customer_category_id FROM customer_categories
      WHERE is_default = true AND deleted_at IS NULL;
    v_customer_tier := 'Bronze';
    v_customer_first_order := false;
  END IF;

  -- Time fields in Asia/Jakarta
  v_local_time := (p_evaluation_ts AT TIME ZONE 'Asia/Jakarta')::time;
  v_local_dow  := EXTRACT(dow FROM (p_evaluation_ts AT TIME ZONE 'Asia/Jakarta'))::int;
  v_local_date := (p_evaluation_ts AT TIME ZONE 'Asia/Jakarta')::date;

  -- Compute cart subtotal (post manual line discount)
  v_subtotal := 0;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_subtotal := v_subtotal +
      ((v_item->>'qty')::DECIMAL *
       ((v_item->>'unit_price')::DECIMAL + COALESCE((v_item->>'modifier_total')::DECIMAL, 0))) -
      COALESCE((v_item->>'manual_discount_amount')::DECIMAL, 0);
  END LOOP;
```

- [ ] **Step 4: Ajouter la boucle d'évaluation**

Append :

```sql
  -- Iterate active promotions ordered by priority DESC, created_at ASC
  FOR v_promo IN
    SELECT id, name, slug, action_type, action_params, conditions, priority, created_at
    FROM promotions
    WHERE deleted_at IS NULL AND is_active
    ORDER BY priority DESC, created_at ASC
  LOOP
    v_eligible := true;
    v_skip_reason := NULL;

    -- Evaluate ALL conditions (AND-logic)
    FOR v_condition IN SELECT * FROM jsonb_array_elements(v_promo.conditions->'all') LOOP
      CASE v_condition->>'type'
        WHEN 'cart_total_min' THEN
          IF v_subtotal < (v_condition->>'value')::DECIMAL THEN
            v_eligible := false; v_skip_reason := 'condition_failed:cart_total_min';
          END IF;
        WHEN 'product_in_cart' THEN
          SELECT COALESCE(SUM((i->>'qty')::INT), 0) INTO v_matching_qty
            FROM jsonb_array_elements(p_items) i
            WHERE (i->>'product_id')::UUID = (v_condition->>'product_id')::UUID;
          IF v_matching_qty < (v_condition->>'min_qty')::INT THEN
            v_eligible := false; v_skip_reason := 'condition_failed:product_in_cart';
          END IF;
        WHEN 'category_in_cart' THEN
          SELECT COALESCE(SUM((i->>'qty')::INT), 0) INTO v_matching_qty
            FROM jsonb_array_elements(p_items) i
            JOIN products p ON p.id = (i->>'product_id')::UUID
            WHERE p.category_id = (v_condition->>'category_id')::UUID;
          IF v_matching_qty < (v_condition->>'min_qty')::INT THEN
            v_eligible := false; v_skip_reason := 'condition_failed:category_in_cart';
          END IF;
        WHEN 'customer_category_in' THEN
          IF NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(v_condition->'category_ids') t
            WHERE t::UUID = v_customer_category_id
          ) THEN
            v_eligible := false; v_skip_reason := 'condition_failed:customer_category_in';
          END IF;
        WHEN 'time_window' THEN
          IF v_local_time < (v_condition->>'start')::time
             OR v_local_time > (v_condition->>'end')::time THEN
            v_eligible := false; v_skip_reason := 'condition_failed:time_window';
          END IF;
        WHEN 'weekday_in' THEN
          IF NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(v_condition->'days') t
            WHERE t::INT = v_local_dow
          ) THEN
            v_eligible := false; v_skip_reason := 'condition_failed:weekday_in';
          END IF;
        WHEN 'valid_dates' THEN
          IF v_local_date < (v_condition->>'from')::date
             OR v_local_date > (v_condition->>'until')::date THEN
            v_eligible := false; v_skip_reason := 'condition_failed:valid_dates';
          END IF;
        WHEN 'customer_in_loyalty_tier' THEN
          IF NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(v_condition->'tiers') t
            WHERE t = v_customer_tier
          ) THEN
            v_eligible := false; v_skip_reason := 'condition_failed:customer_in_loyalty_tier';
          END IF;
        WHEN 'first_order_only' THEN
          IF NOT v_customer_first_order THEN
            v_eligible := false; v_skip_reason := 'condition_failed:first_order_only';
          END IF;
      END CASE;
      EXIT WHEN NOT v_eligible;
    END LOOP;

    IF NOT v_eligible THEN
      v_skipped := v_skipped || jsonb_build_object('promotion_id', v_promo.id, 'reason', v_skip_reason);
      CONTINUE;
    END IF;
```

- [ ] **Step 5: Ajouter la P12 guard + compute discount**

Append (suite de la boucle) :

```sql
    -- P12: skip auto promo if any targeted item has manual_discount_amount > 0
    v_target := v_promo.action_params->>'target';
    v_target_id := NULLIF(v_promo.action_params->>'target_id', '')::UUID;

    IF v_promo.action_type = 'percentage_off' AND v_target = 'product' THEN
      IF EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_items) i
        WHERE (i->>'product_id')::UUID = v_target_id
          AND COALESCE((i->>'manual_discount_amount')::DECIMAL, 0) > 0
      ) THEN
        v_skipped := v_skipped || jsonb_build_object(
          'promotion_id', v_promo.id, 'reason', 'manual_discount_present');
        CONTINUE;
      END IF;
    ELSIF v_promo.action_type = 'percentage_off' AND v_target = 'category' THEN
      IF NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_items) i
        JOIN products p ON p.id = (i->>'product_id')::UUID
        WHERE p.category_id = v_target_id
          AND COALESCE((i->>'manual_discount_amount')::DECIMAL, 0) = 0
      ) THEN
        v_skipped := v_skipped || jsonb_build_object(
          'promotion_id', v_promo.id, 'reason', 'manual_discount_present');
        CONTINUE;
      END IF;
    ELSIF v_promo.action_type = 'bogo' THEN
      v_buy_product_id := (v_promo.action_params->>'buy_product_id')::UUID;
      IF EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_items) i
        WHERE (i->>'product_id')::UUID = v_buy_product_id
          AND COALESCE((i->>'manual_discount_amount')::DECIMAL, 0) > 0
      ) THEN
        v_skipped := v_skipped || jsonb_build_object(
          'promotion_id', v_promo.id, 'reason', 'manual_discount_present');
        CONTINUE;
      END IF;
    END IF;

    -- Compute potential discount per action_type
    v_potential_discount := 0;
    v_target_id := NULLIF(v_promo.action_params->>'target_id', '')::UUID;

    IF v_promo.action_type = 'percentage_off' THEN
      v_percentage := (v_promo.action_params->>'percentage')::INT;
      IF v_target = 'cart' THEN
        v_potential_discount := round_idr(v_subtotal * v_percentage / 100.0);
      ELSIF v_target = 'category' THEN
        SELECT COALESCE(SUM(
          ((i->>'qty')::DECIMAL *
           ((i->>'unit_price')::DECIMAL + COALESCE((i->>'modifier_total')::DECIMAL, 0))) -
          COALESCE((i->>'manual_discount_amount')::DECIMAL, 0)
        ), 0) INTO v_matching_subtotal
          FROM jsonb_array_elements(p_items) i
          JOIN products p ON p.id = (i->>'product_id')::UUID
          WHERE p.category_id = v_target_id;
        v_potential_discount := round_idr(v_matching_subtotal * v_percentage / 100.0);
      ELSIF v_target = 'product' THEN
        SELECT COALESCE(SUM(
          ((i->>'qty')::DECIMAL *
           ((i->>'unit_price')::DECIMAL + COALESCE((i->>'modifier_total')::DECIMAL, 0))) -
          COALESCE((i->>'manual_discount_amount')::DECIMAL, 0)
        ), 0) INTO v_matching_subtotal
          FROM jsonb_array_elements(p_items) i
          WHERE (i->>'product_id')::UUID = v_target_id;
        v_potential_discount := round_idr(v_matching_subtotal * v_percentage / 100.0);
      END IF;

    ELSIF v_promo.action_type = 'fixed_off' THEN
      v_amount := (v_promo.action_params->>'amount')::DECIMAL;
      v_potential_discount := LEAST(v_amount, v_subtotal);

    ELSIF v_promo.action_type = 'bogo' THEN
      v_buy_product_id := (v_promo.action_params->>'buy_product_id')::UUID;
      v_buy_qty := (v_promo.action_params->>'buy_qty')::INT;
      v_get_qty := (v_promo.action_params->>'get_qty')::INT;
      v_get_discount_pct := (v_promo.action_params->>'get_discount_pct')::INT;
      SELECT COALESCE(SUM((i->>'qty')::INT), 0) INTO v_matching_qty
        FROM jsonb_array_elements(p_items) i
        WHERE (i->>'product_id')::UUID = v_buy_product_id;
      v_pairs := v_matching_qty / (v_buy_qty + v_get_qty);
      SELECT retail_price INTO v_buy_unit_price FROM products WHERE id = v_buy_product_id;
      v_get_discount_per_unit := round_idr(v_buy_unit_price * v_get_discount_pct / 100.0);
      v_potential_discount := v_pairs * v_get_qty * v_get_discount_per_unit;

    ELSIF v_promo.action_type = 'free_product' THEN
      v_free_product_id := (v_promo.action_params->>'product_id')::UUID;
      v_free_qty := (v_promo.action_params->>'qty')::INT;
      SELECT retail_price INTO v_free_unit_price FROM products WHERE id = v_free_product_id;
      v_potential_discount := v_free_unit_price * v_free_qty;
    END IF;

    -- Track best (max discount, ties broken by priority DESC then created_at ASC, already sorted)
    IF v_potential_discount > v_best_discount THEN
      v_best_discount := v_potential_discount;
      v_best_promo_id := v_promo.id;
      v_best_promo_name := v_promo.name;
      v_best_action_type := v_promo.action_type;
      v_best_target := v_target;
      v_best_target_pid := CASE
        WHEN v_promo.action_type = 'percentage_off' AND v_target IN ('product') THEN v_target_id
        WHEN v_promo.action_type = 'bogo' THEN v_buy_product_id
        WHEN v_promo.action_type = 'free_product' THEN v_free_product_id
        ELSE NULL
      END;

      -- Build items_to_add for bogo / free_product
      IF v_promo.action_type = 'bogo' THEN
        v_best_items_to_add := jsonb_build_array(jsonb_build_object(
          'product_id', v_buy_product_id,
          'qty', v_pairs * v_get_qty,
          'unit_price', v_buy_unit_price,
          'promotion_discount', v_get_discount_per_unit,
          'is_free_from_promo', (v_get_discount_pct = 100),
          'split_from_existing', true
        ));
      ELSIF v_promo.action_type = 'free_product' THEN
        v_best_items_to_add := jsonb_build_array(jsonb_build_object(
          'product_id', v_free_product_id,
          'qty', v_free_qty,
          'unit_price', v_free_unit_price,
          'promotion_discount', v_free_unit_price,
          'is_free_from_promo', true,
          'split_from_existing', false
        ));
      ELSE
        v_best_items_to_add := '[]'::JSONB;
      END IF;
    ELSE
      v_skipped := v_skipped || jsonb_build_object(
        'promotion_id', v_promo.id, 'reason', 'not_best');
    END IF;
  END LOOP;

  -- Return best-only result
  IF v_best_promo_id IS NULL THEN
    RETURN jsonb_build_object(
      'applied_promotion', NULL,
      'skipped_promotions', v_skipped
    );
  END IF;

  RETURN jsonb_build_object(
    'applied_promotion', jsonb_build_object(
      'promotion_id', v_best_promo_id,
      'name', v_best_promo_name,
      'action_type', v_best_action_type,
      'target', COALESCE(v_best_target, 'cart'),
      'target_product_id', v_best_target_pid,
      'discount_amount', v_best_discount,
      'items_to_add', v_best_items_to_add
    ),
    'skipped_promotions', v_skipped
  );
```

- [ ] **Step 6: Reset DB et vérifier la fonction**

```bash
supabase db reset
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -c "\df evaluate_promotions"
```

Expected: 1 fonction listée avec signature `evaluate_promotions(jsonb, uuid, timestamp with time zone)`.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260510000004_evaluate_promotions_rpc.sql
git commit -m "feat(db): session 8 — evaluate_promotions RPC engine (4 forms, 9 conditions, best-only)"
```

---

### Task 1.5 — Migration `complete_order_with_payment` v6

**Files:**
- Create: `supabase/migrations/20260510000005_extend_complete_order_rpc_v6.sql`
- Reference: `supabase/migrations/20260508000003_extend_complete_order_rpc_v5.sql` (v5 source à copier-adapter)

- [ ] **Step 1: Drop overloads + signature v6**

```sql
-- 20260510000005_extend_complete_order_rpc_v6.sql
-- Session 8 / migration 5 : extend complete_order_with_payment v5 → v6.
-- Adds: p_evaluation_ts param, server-side evaluate_promotions call, items_to_add insertion,
--       order_promotions audit insert, orders.promotion_total_amount.
-- Stack order: items_total → promo → redemption → manual → total → tax extracted.
-- Spec: §3.9.

DO $drop$
DECLARE _r RECORD;
BEGIN
  FOR _r IN SELECT oid::regprocedure AS sig FROM pg_proc
    WHERE proname = 'complete_order_with_payment' AND pronamespace = 'public'::regnamespace
  LOOP
    EXECUTE 'DROP FUNCTION ' || _r.sig::text || ' CASCADE';
  END LOOP;
END $drop$;

CREATE OR REPLACE FUNCTION complete_order_with_payment(
  p_session_id              UUID,
  p_order_type              order_type,
  p_items                   JSONB,
  p_payment                 JSONB,
  p_idempotency_key         UUID             DEFAULT NULL,
  p_customer_id             UUID             DEFAULT NULL,
  p_loyalty_points_redeemed INTEGER          DEFAULT 0,
  p_table_number            TEXT             DEFAULT NULL,
  p_discount_amount         DECIMAL(14,2)    DEFAULT 0,
  p_discount_type           TEXT             DEFAULT NULL,
  p_discount_value          DECIMAL(14,2)    DEFAULT NULL,
  p_discount_reason         TEXT             DEFAULT NULL,
  p_discount_authorized_by  UUID             DEFAULT NULL,
  p_loyalty_multiplier      DECIMAL(4,2)     DEFAULT 1.0,
  p_evaluation_ts           TIMESTAMPTZ      DEFAULT now()
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
```

- [ ] **Step 2: Recopier le DECLARE de v5 et étendre**

Copier l'intégralité du `DECLARE` block de v5 (`20260508000003_extend_complete_order_rpc_v5.sql`) puis ajouter :

```sql
  v_promo_result          JSONB;
  v_applied_promo         JSONB;
  v_promo_total           DECIMAL(14,2) := 0;
  v_items_to_add          JSONB := '[]'::JSONB;
  v_added_item            JSONB;
  v_split_from_existing   BOOLEAN;
  v_promo_id_local        UUID;
  v_promo_name            TEXT;
  v_promo_action_type     promotion_action_type;
  v_promo_action_params   JSONB;
  v_promo_slug            TEXT;
  v_promo_target          TEXT;
  v_target_oi_id          UUID;
```

- [ ] **Step 3: Recopier le body v5 jusqu'au calcul `v_items_total`**

Copier la logique d'auth/idempotency/INSERT orders (sans la finalisation v_total) telle quelle de v5. S'arrêter juste après que `v_items_total` soit accumulé via la boucle d'INSERT order_items.

- [ ] **Step 4: Insérer le bloc évaluation promo + recalcul v_total**

Après que tous les `INSERT INTO order_items` p_items normaux soient faits, et que `v_items_total` soit la somme des `line_total` :

```sql
  v_promo_result := evaluate_promotions(p_items, p_customer_id, p_evaluation_ts);
  v_applied_promo := v_promo_result->'applied_promotion';

  IF v_applied_promo IS NOT NULL THEN
    v_promo_total           := (v_applied_promo->>'discount_amount')::DECIMAL;
    v_items_to_add          := v_applied_promo->'items_to_add';
    v_promo_id_local        := (v_applied_promo->>'promotion_id')::UUID;
    v_promo_name            := v_applied_promo->>'name';
    v_promo_action_type     := (v_applied_promo->>'action_type')::promotion_action_type;
    v_promo_target          := v_applied_promo->>'target';
    SELECT slug, action_params INTO v_promo_slug, v_promo_action_params
      FROM promotions WHERE id = v_promo_id_local;

    -- Apply: split (BOGO) / append (free_product) / mark (percentage_off)
    FOR v_added_item IN SELECT * FROM jsonb_array_elements(v_items_to_add) LOOP
      v_split_from_existing := (v_added_item->>'split_from_existing')::BOOLEAN;
      SELECT c.dispatch_station INTO v_dispatch_station
        FROM products p JOIN categories c ON c.id = p.category_id
        WHERE p.id = (v_added_item->>'product_id')::UUID;

      IF v_split_from_existing THEN
        UPDATE order_items
          SET quantity = quantity - (v_added_item->>'qty')::DECIMAL,
              line_total = line_total - ((v_added_item->>'qty')::DECIMAL * unit_price)
          WHERE id = (
            SELECT id FROM order_items
              WHERE order_id = v_order_id
                AND product_id = (v_added_item->>'product_id')::UUID
                AND promotion_id IS NULL
              ORDER BY created_at ASC LIMIT 1
          );
        v_items_total := v_items_total
          - ((v_added_item->>'qty')::DECIMAL * (v_added_item->>'unit_price')::DECIMAL)
          + ((v_added_item->>'qty')::DECIMAL * (v_added_item->>'unit_price')::DECIMAL);
      ELSE
        v_items_total := v_items_total
          + ((v_added_item->>'qty')::DECIMAL * (v_added_item->>'unit_price')::DECIMAL);
      END IF;

      INSERT INTO order_items (
        order_id, product_id, quantity, unit_price, modifiers, line_total,
        promotion_id, promotion_discount, is_free_from_promo,
        dispatch_station, kitchen_status
      ) VALUES (
        v_order_id, (v_added_item->>'product_id')::UUID,
        (v_added_item->>'qty')::DECIMAL, (v_added_item->>'unit_price')::DECIMAL,
        '[]'::JSONB,
        (v_added_item->>'qty')::DECIMAL * (v_added_item->>'unit_price')::DECIMAL,
        v_promo_id_local, (v_added_item->>'promotion_discount')::DECIMAL,
        (v_added_item->>'is_free_from_promo')::BOOLEAN,
        v_dispatch_station, 'pending'
      );
    END LOOP;

    -- percentage_off target=product/category : marquer les lignes existantes (skip si manual)
    IF v_promo_action_type = 'percentage_off' AND v_promo_target = 'product' THEN
      UPDATE order_items SET
        promotion_id = v_promo_id_local,
        promotion_discount = round_idr(line_total * (v_promo_action_params->>'percentage')::INT / 100.0)
      WHERE order_id = v_order_id
        AND product_id = (v_promo_action_params->>'target_id')::UUID
        AND discount_amount = 0
        AND promotion_id IS NULL;
    ELSIF v_promo_action_type = 'percentage_off' AND v_promo_target = 'category' THEN
      UPDATE order_items oi SET
        promotion_id = v_promo_id_local,
        promotion_discount = round_idr(oi.line_total * (v_promo_action_params->>'percentage')::INT / 100.0)
        FROM products p
        WHERE oi.order_id = v_order_id
          AND oi.product_id = p.id
          AND p.category_id = (v_promo_action_params->>'target_id')::UUID
          AND oi.discount_amount = 0
          AND oi.promotion_id IS NULL;
    END IF;

    -- INSERT order_promotions audit (1 row si target=cart, N rows si target=item)
    IF v_promo_target = 'cart' THEN
      INSERT INTO order_promotions (order_id, promotion_id, target, target_order_item_id,
                                     discount_amount, free_item_added, metadata)
      VALUES (v_order_id, v_promo_id_local, 'cart', NULL, v_promo_total, false,
              jsonb_build_object(
                'name_snapshot', v_promo_name,
                'slug_snapshot', v_promo_slug,
                'action_type_snapshot', v_promo_action_type::TEXT,
                'action_params_snapshot', v_promo_action_params
              ));
    ELSE
      INSERT INTO order_promotions (order_id, promotion_id, target, target_order_item_id,
                                     discount_amount, free_item_added, metadata)
      SELECT v_order_id, v_promo_id_local, 'item', oi.id, oi.promotion_discount,
             v_promo_action_type IN ('bogo', 'free_product'),
             jsonb_build_object(
               'name_snapshot', v_promo_name,
               'slug_snapshot', v_promo_slug,
               'action_type_snapshot', v_promo_action_type::TEXT,
               'action_params_snapshot', v_promo_action_params
             )
      FROM order_items oi
      WHERE oi.order_id = v_order_id AND oi.promotion_id = v_promo_id_local;
    END IF;
  END IF;

  v_total := v_items_total - v_promo_total - v_redemption_amount - p_discount_amount;
  IF v_total < 0 THEN
    RAISE EXCEPTION 'Discounts exceed items total' USING ERRCODE = 'check_violation';
  END IF;
  v_tax_amount := round_idr(v_total * v_tax_rate / (1 + v_tax_rate));

  UPDATE orders SET
    subtotal               = v_items_total,
    tax_amount             = v_tax_amount,
    total                  = v_total,
    promotion_total_amount = v_promo_total
  WHERE id = v_order_id;
```

- [ ] **Step 5: Conserver le reste du body v5 (INSERT order_payments, JE trigger fires, points earned)**

Le code après `UPDATE orders SET ... promotion_total_amount` reproduit v5 verbatim : INSERT `order_payments` (qui déclenche le trigger JE NET method), puis :

```sql
  IF p_customer_id IS NOT NULL THEN
    v_points_earned := FLOOR(v_total * p_loyalty_multiplier / 1000);
    UPDATE customers SET
      loyalty_points  = loyalty_points + v_points_earned - p_loyalty_points_redeemed,
      lifetime_points = lifetime_points + v_points_earned,
      lifetime_orders = lifetime_orders + 1
    WHERE id = p_customer_id;
    -- INSERT loyalty_transactions earn + (si redemption > 0) redeem rows
  END IF;

  RETURN jsonb_build_object(
    'order_id', v_order_id,
    'order_number', v_order_number,
    'total', v_total,
    'tax_amount', v_tax_amount,
    'change_given', v_change_given
  );
END $$;
```

- [ ] **Step 6: Reset DB et vérifier signature v6**

```bash
supabase db reset
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -c "\df complete_order_with_payment"
```

Expected: 16 paramètres (15 v5 + `p_evaluation_ts`).

- [ ] **Step 7: Smoke test manuel via psql**

```bash
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -c "
SELECT complete_order_with_payment(
  p_session_id  := (SELECT id FROM pos_sessions WHERE status='open' LIMIT 1),
  p_order_type  := 'dine_in',
  p_items       := jsonb_build_array(jsonb_build_object(
    'product_id', (SELECT id FROM products WHERE sku='SKU-CROISSANT'),
    'quantity', 2, 'unit_price', 35000, 'modifiers', '[]'::jsonb
  )),
  p_payment     := jsonb_build_object('method', 'cash', 'amount', 35000),
  p_evaluation_ts := '2026-05-12 10:00:00+08'::timestamptz
);
"
```

Expected: order_id retourné, total = 35000 (BOGO appliqué : 70k - 35k promo).

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20260510000005_extend_complete_order_rpc_v6.sql
git commit -m "feat(db): session 8 — complete_order_with_payment v6 (server-side promo eval + audit)"
```

---

### Task 1.6 — Migration `pay_existing_order` v3

**Files:**
- Create: `supabase/migrations/20260510000006_extend_pay_existing_order_rpc_v3.sql`
- Reference: `supabase/migrations/20260508000004_extend_pay_existing_order_rpc_v2.sql`

- [ ] **Step 1: Drop overloads + recopier signature v2**

La signature v3 est **identique** à v2 (pas de nouveau param). Seul le body change pour lire `orders.promotion_total_amount` déjà set par `create_tablet_order` (P10).

```sql
-- 20260510000006_extend_pay_existing_order_rpc_v3.sql
-- Session 8 / migration 6 : pay_existing_order v3.
-- P10 freeze : ne re-évalue PAS les promos. Lit orders.promotion_total_amount déjà set
-- par create_tablet_order. Math : v_total = v_items_total - v_promo_total - v_redemption - p_discount.
-- Spec: §3.10.

DO $drop$
DECLARE _r RECORD;
BEGIN
  FOR _r IN SELECT oid::regprocedure AS sig FROM pg_proc
    WHERE proname = 'pay_existing_order' AND pronamespace = 'public'::regnamespace
  LOOP
    EXECUTE 'DROP FUNCTION ' || _r.sig::text || ' CASCADE';
  END LOOP;
END $drop$;

-- Recopier signature v2 verbatim depuis 20260508000004.
```

- [ ] **Step 2: Recopier DECLARE v2 et ajouter v_promo_total**

```sql
DECLARE
  -- (réutiliser DECLARE de v2 verbatim)
  v_promo_total           DECIMAL(14,2) := 0;
```

- [ ] **Step 3: Recopier idempotency + status guard v2**

Conserver la logique v2 verbatim jusqu'au calcul de `v_items_total`.

- [ ] **Step 4: Lire promo_total au lieu de re-évaluer**

Remplacer la ligne v2 où elle calculait `v_total` par :

```sql
  -- v_items_total déjà calculé via SUM(line_total) FROM order_items WHERE order_id = p_order_id
  -- Lire la promo frozen
  SELECT COALESCE(promotion_total_amount, 0) INTO v_promo_total
    FROM orders WHERE id = p_order_id;

  v_redemption_amount := p_loyalty_points_redeemed * 10;
  v_total := v_items_total - v_promo_total - v_redemption_amount - p_discount_amount;
  IF v_total < 0 THEN
    RAISE EXCEPTION 'Discounts exceed items total' USING ERRCODE = 'check_violation';
  END IF;
  v_tax_amount := round_idr(v_total * v_tax_rate / (1 + v_tax_rate));
```

- [ ] **Step 5: Conserver UPDATE orders + INSERT payment + earn loyalty (verbatim v2)**

Aucune modification après la lecture du promo_total. La JE NET method reste valide car `v_total` inclut déjà la promo soustraite.

- [ ] **Step 6: Reset DB et vérifier**

```bash
supabase db reset
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -c "\df pay_existing_order"
```

Expected: 11 paramètres (identique v2).

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260510000006_extend_pay_existing_order_rpc_v3.sql
git commit -m "feat(db): session 8 — pay_existing_order v3 (P10 freeze, no re-eval)"
```

---

### Task 1.7 — Migration `create_tablet_order` extend (freeze promos)

**Files:**
- Create: `supabase/migrations/20260510000007_extend_create_tablet_order_rpc.sql`
- Reference: `supabase/migrations/20260507000003_create_tablet_order_rpc.sql`

- [ ] **Step 1: Drop + signature avec p_evaluation_ts**

```sql
-- 20260510000007_extend_create_tablet_order_rpc.sql
-- Session 8 / migration 7 : create_tablet_order évalue + freeze les promos au create-time.
-- pay_existing_order v3 lira ces valeurs au pickup sans re-eval.
-- Spec: §3.11.

DO $drop$
DECLARE _r RECORD;
BEGIN
  FOR _r IN SELECT oid::regprocedure AS sig FROM pg_proc
    WHERE proname = 'create_tablet_order' AND pronamespace = 'public'::regnamespace
  LOOP
    EXECUTE 'DROP FUNCTION ' || _r.sig::text || ' CASCADE';
  END LOOP;
END $drop$;

CREATE OR REPLACE FUNCTION create_tablet_order(
  p_session_id      UUID,
  p_table_number    TEXT,
  p_items           JSONB,
  p_customer_id     UUID DEFAULT NULL,
  p_idempotency_key UUID DEFAULT NULL,
  p_evaluation_ts   TIMESTAMPTZ DEFAULT now()
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
```

- [ ] **Step 2: Recopier DECLARE + body session-5 + ajouter promo vars**

Recopier verbatim le DECLARE et tout le body de la version session-5 jusqu'à ce que `v_order_id` soit obtenu et tous les `INSERT INTO order_items` p_items soient faits. Ajouter au DECLARE :

```sql
  v_promo_result          JSONB;
  v_applied_promo         JSONB;
  v_promo_total           DECIMAL(14,2) := 0;
  v_items_to_add          JSONB := '[]'::JSONB;
  v_added_item            JSONB;
  v_split_from_existing   BOOLEAN;
  v_promo_id_local        UUID;
  v_promo_name            TEXT;
  v_promo_action_type     promotion_action_type;
  v_promo_action_params   JSONB;
  v_promo_slug            TEXT;
  v_promo_target          TEXT;
  v_dispatch_station      TEXT;
```

- [ ] **Step 3: Insérer le bloc d'application promo (copier verbatim de Task 1.5 step 4)**

Le bloc qui apply la promo (split/append/mark + INSERT order_promotions) est **identique** à celui de `complete_order_with_payment` v6 step 4. Le copier intégralement après tous les INSERT order_items, AVANT le RETURN.

À la fin du bloc, ajouter :

```sql
  IF v_applied_promo IS NOT NULL THEN
    UPDATE orders SET promotion_total_amount = v_promo_total WHERE id = v_order_id;
  END IF;

  RETURN jsonb_build_object(
    'order_id', v_order_id,
    'order_number', v_order_number,
    'table_number', p_table_number
  );
END $$;
```

- [ ] **Step 4: Reset DB et vérifier**

```bash
supabase db reset
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -c "\df create_tablet_order"
```

Expected: 6 paramètres dont `p_evaluation_ts`.

- [ ] **Step 5: Smoke test manuel**

```bash
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -c "
SELECT create_tablet_order(
  p_session_id   := (SELECT id FROM pos_sessions WHERE status='open' LIMIT 1),
  p_table_number := 'T1',
  p_items        := jsonb_build_array(jsonb_build_object(
    'product_id', (SELECT id FROM products WHERE sku='SKU-AMERICANO'),
    'quantity', 1, 'unit_price', 35000, 'modifiers', '[]'::jsonb
  )),
  p_evaluation_ts := '2026-05-12 15:00:00+08'::timestamptz
);

SELECT promotion_total_amount FROM orders ORDER BY created_at DESC LIMIT 1;
"
```

Expected: `promotion_total_amount = 5250` (Happy Hour 15% sur 35k Americano).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260510000007_extend_create_tablet_order_rpc.sql
git commit -m "feat(db): session 8 — create_tablet_order freezes promos at create-time (P10)"
```

---

### Task 1.8 — Migration seed 5 promos demo

**Files:**
- Create: `supabase/migrations/20260510000008_seed_5_demo_promotions.sql`

- [ ] **Step 1: Créer le fichier seed**

```sql
-- 20260510000008_seed_5_demo_promotions.sql
-- Session 8 / migration 8 : 5 promos demo couvrant les 4 action_types et 9 condition_types.
-- Spec: §3.13.

INSERT INTO promotions (name, slug, action_type, action_params, conditions, priority) VALUES
  ('Happy Hour Beverages 15% off', 'happy-hour-bev', 'percentage_off',
   jsonb_build_object('percentage', 15, 'target', 'category',
                      'target_id', (SELECT id FROM categories WHERE slug='beverage')),
   jsonb_build_object('all', jsonb_build_array(
     jsonb_build_object('type', 'category_in_cart',
                        'category_id', (SELECT id FROM categories WHERE slug='beverage'),
                        'min_qty', 1),
     jsonb_build_object('type', 'time_window', 'start', '14:00', 'end', '17:00', 'tz', 'Asia/Jakarta'),
     jsonb_build_object('type', 'weekday_in', 'days', jsonb_build_array(1,2,3,4,5)),
     jsonb_build_object('type', 'valid_dates', 'from', '2026-01-01', 'until', '2027-01-01')
   )), 10),

  ('Spend 50k Get 5k off', 'spend-50k-5k-off', 'fixed_off',
   jsonb_build_object('amount', 5000, 'target', 'cart'),
   jsonb_build_object('all', jsonb_build_array(
     jsonb_build_object('type', 'cart_total_min', 'value', 50000)
   )), 5),

  ('BOGO Croissant', 'bogo-croissant', 'bogo',
   jsonb_build_object('buy_product_id', (SELECT id FROM products WHERE sku='SKU-CROISSANT'),
                      'buy_qty', 1, 'get_qty', 1, 'get_discount_pct', 100),
   jsonb_build_object('all', jsonb_build_array(
     jsonb_build_object('type', 'product_in_cart',
                        'product_id', (SELECT id FROM products WHERE sku='SKU-CROISSANT'),
                        'min_qty', 2)
   )), 8),

  ('Free Americano on 100k+', 'free-americano-100k', 'free_product',
   jsonb_build_object('product_id', (SELECT id FROM products WHERE sku='SKU-AMERICANO'), 'qty', 1),
   jsonb_build_object('all', jsonb_build_array(
     jsonb_build_object('type', 'cart_total_min', 'value', 100000)
   )), 7),

  ('VIP Birthday 20% off cart', 'vip-20-off', 'percentage_off',
   jsonb_build_object('percentage', 20, 'target', 'cart'),
   jsonb_build_object('all', jsonb_build_array(
     jsonb_build_object('type', 'customer_category_in',
                        'category_ids', jsonb_build_array((SELECT id FROM customer_categories WHERE slug='vip'))),
     jsonb_build_object('type', 'cart_total_min', 'value', 30000)
   )), 6);
```

- [ ] **Step 2: Reset DB et vérifier 5 rows**

```bash
supabase db reset
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -c "SELECT slug, action_type, priority FROM promotions ORDER BY priority DESC;"
```

Expected: 5 rows. priority desc : happy-hour-bev (10), bogo-croissant (8), free-americano-100k (7), vip-20-off (6), spend-50k-5k-off (5).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260510000008_seed_5_demo_promotions.sql
git commit -m "feat(db): session 8 — seed 5 demo promotions (4 forms × 9 conditions)"
```

---

### Task 1.9 — pgTAP tests pour evaluate_promotions + RPCs

**Files:**
- Create: `supabase/tests/promotions_engine.sql`

- [ ] **Step 1: Créer le squelette pgTAP**

```sql
-- supabase/tests/promotions_engine.sql
-- pgTAP tests : evaluate_promotions + complete_order_with_payment v6 + create_tablet_order freeze.
BEGIN;
SELECT plan(20);

-- Test 1: cart vide → applied null
SELECT is(
  evaluate_promotions('[]'::jsonb, NULL, '2026-05-12 15:00:00+08'::timestamptz)->'applied_promotion',
  'null'::jsonb,
  'cart vide → null applied'
);
```

- [ ] **Step 2: Étoffer 19 tests supplémentaires (couvrant les 9 evaluators + 4 actions + best-only + P12)**

Cas à couvrir explicitement (1 SELECT is/ok par cas) :

| # | Cas | Assertion |
|---|---|---|
| 2 | Happy Hour eligible mardi 15h, beverage cart | `applied->>'name'` = 'Happy Hour Beverages 15% off' |
| 3 | Happy Hour skipped à 13:59 | `applied IS NULL` |
| 4 | Happy Hour skipped samedi (dow=6) | `applied IS NULL` |
| 5 | BOGO eligible avec 2 croissants | `applied->>'action_type'` = 'bogo' |
| 6 | BOGO discount = 35000 | `(applied->>'discount_amount')::DECIMAL = 35000` |
| 7 | BOGO items_to_add structure | `applied->'items_to_add'->0->>'split_from_existing'` = 'true' |
| 8 | Free Americano eligible cart 105k | `applied->>'name'` = 'Free Americano on 100k+' |
| 9 | Free Americano items_to_add | `(applied->'items_to_add'->0->>'qty')::INT = 1` |
| 10 | VIP 20% off avec customer VIP | `applied->>'name'` = 'VIP Birthday 20% off cart' |
| 11 | VIP 20% skipped sans customer | `applied IS NULL` |
| 12 | Customer NULL → default category resolved | (eligible ou skip selon Retail) |
| 13 | first_order_only → 0 lifetime_orders pass | (créer customer test, eligible) |
| 14 | first_order_only → 1+ lifetime_orders skip | (eligible = NULL) |
| 15 | P12 BOGO skipped si manual_discount | `applied IS NULL OR action_type != 'bogo'` |
| 16 | Best-only multi-eligibles → max | seul 1 retourné, autres dans `skipped[]` |
| 17 | Skipped reasons populées | `jsonb_array_length(skipped) >= 1` quand applicable |
| 18 | complete_order v6 BOGO → 2 order_items rows | `(SELECT COUNT(*) FROM order_items WHERE order_id = X) = 2` |
| 19 | complete_order v6 free_product → 1 row supplémentaire is_free | `EXISTS WHERE is_free_from_promo=true` |
| 20 | order_promotions metadata snapshot | `metadata->>'name_snapshot' = 'BOGO Croissant'` |

- [ ] **Step 3: Run pgTAP**

```bash
supabase test db
```

Expected: 20/20 tests pass.

- [ ] **Step 4: Commit**

```bash
git add supabase/tests/promotions_engine.sql
git commit -m "test(db): session 8 — pgTAP for evaluate_promotions + RPC integration (20 tests)"
```

---

## Phase 2 — Domain

### Task 2.1 — Domain types `promotions/types.ts`

**Files:**
- Create: `packages/domain/src/promotions/types.ts`
- Create: `packages/domain/src/promotions/index.ts`
- Modify: `packages/domain/src/index.ts`

- [ ] **Step 1: Créer `types.ts` avec tous les types**

```ts
// packages/domain/src/promotions/types.ts
// Spec §4.1 — types principaux.

export type PromotionActionType = 'percentage_off' | 'fixed_off' | 'bogo' | 'free_product';

export type PromotionTarget = 'cart' | 'category' | 'product';

export interface Promotion {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  action_type: PromotionActionType;
  action_params: Record<string, unknown>;
  conditions: { all: PromotionCondition[] };
  priority: number;
  is_active: boolean;
}

export type PromotionCondition =
  | { type: 'cart_total_min'; value: number }
  | { type: 'product_in_cart'; product_id: string; min_qty: number }
  | { type: 'category_in_cart'; category_id: string; min_qty: number }
  | { type: 'customer_category_in'; category_ids: string[] }
  | { type: 'time_window'; start: string; end: string; tz: string }
  | { type: 'weekday_in'; days: number[] }
  | { type: 'valid_dates'; from: string; until: string }
  | {
      type: 'customer_in_loyalty_tier';
      tiers: Array<'Bronze' | 'Silver' | 'Gold' | 'Platinum'>;
    }
  | { type: 'first_order_only' };

export interface ItemToAdd {
  product_id: string;
  qty: number;
  unit_price: number;
  promotion_discount: number;
  is_free_from_promo: boolean;
  split_from_existing?: boolean;
}

export interface AppliedPromotion {
  promotion_id: string;
  name: string;
  action_type: PromotionActionType;
  target: 'cart' | 'item';
  target_product_id: string | null;
  discount_amount: number;
  items_to_add: ItemToAdd[];
}

export interface SkippedPromotion {
  promotion_id: string;
  reason: string;
}

export interface EvaluationResult {
  applied_promotion: AppliedPromotion | null;
  skipped_promotions: SkippedPromotion[];
}

export interface EvaluationContext {
  items: Array<{
    product_id: string;
    category_id: string;
    qty: number;
    unit_price: number;
    modifier_total: number;
    manual_discount_amount: number;
  }>;
  customer_category_id: string | null;
  customer_tier: 'Bronze' | 'Silver' | 'Gold' | 'Platinum';
  customer_first_order: boolean;
  evaluation_ts: Date;
}
```

- [ ] **Step 2: Créer `index.ts`**

```ts
// packages/domain/src/promotions/index.ts
export * from './types.js';
export { isPromotionEligible } from './conditions/isPromotionEligible.js';
export { computePotentialDiscount } from './actions/computePotentialDiscount.js';
export { selectBestPromotion } from './selectBestPromotion.js';
export { validateActionParams } from './validateActionParams.js';
export {
  evaluateCartTotalMin,
  evaluateProductInCart,
  evaluateCategoryInCart,
  evaluateCustomerCategoryIn,
  evaluateTimeWindow,
  evaluateWeekdayIn,
  evaluateValidDates,
  evaluateCustomerInLoyaltyTier,
  evaluateFirstOrderOnly,
} from './conditions/evaluators.js';
```

- [ ] **Step 3: Re-exporter depuis `packages/domain/src/index.ts`**

Ajouter à la fin :

```ts
export * from './promotions/index.js';
```

- [ ] **Step 4: Vérifier typecheck**

```bash
pnpm --filter @breakery/domain typecheck
```

Expected: 0 erreur (les helpers référencés ne sont pas encore créés mais leurs fichiers seront ajoutés dans tasks suivantes — l'index export les expose en avance et provoquera des erreurs si exécuté avant tasks 2.2-2.6 ; **alternative** : commenter les exports helpers dans `index.ts` pour ce step, les décommenter dans la task qui crée chaque fichier).

- [ ] **Step 5: Commit (sans helpers — index commenté)**

Pour Step 4 si erreurs : commenter dans `index.ts` les exports `isPromotionEligible`, `computePotentialDiscount`, `selectBestPromotion`, `validateActionParams`, `evaluate*` jusqu'à ce que les fichiers existent.

```bash
git add packages/domain/src/promotions/types.ts packages/domain/src/promotions/index.ts packages/domain/src/index.ts
git commit -m "feat(domain): session 8 — promotions types module"
```

---

### Task 2.2 — Domain condition evaluators (9 fonctions)

**Files:**
- Create: `packages/domain/src/promotions/conditions/evaluators.ts`
- Create: `packages/domain/src/promotions/conditions/__tests__/evaluators.test.ts`

- [ ] **Step 1: Écrire les 9 tests qui échouent**

```ts
// packages/domain/src/promotions/conditions/__tests__/evaluators.test.ts
import { describe, it, expect } from 'vitest';
import {
  evaluateCartTotalMin,
  evaluateProductInCart,
  evaluateCategoryInCart,
  evaluateCustomerCategoryIn,
  evaluateTimeWindow,
  evaluateWeekdayIn,
  evaluateValidDates,
  evaluateCustomerInLoyaltyTier,
  evaluateFirstOrderOnly,
} from '../evaluators.js';
import type { EvaluationContext } from '../../types.js';

const baseCtx = (overrides: Partial<EvaluationContext> = {}): EvaluationContext => ({
  items: [],
  customer_category_id: null,
  customer_tier: 'Bronze',
  customer_first_order: false,
  evaluation_ts: new Date('2026-05-12T15:00:00+08:00'),
  ...overrides,
});

describe('cart_total_min', () => {
  it('passes when subtotal >= value', () => {
    const ctx = baseCtx({
      items: [{ product_id: 'p', category_id: 'c', qty: 1, unit_price: 50000, modifier_total: 0, manual_discount_amount: 0 }],
    });
    expect(evaluateCartTotalMin(ctx, { type: 'cart_total_min', value: 50000 })).toBe(true);
  });
  it('fails when subtotal < value (49999)', () => {
    const ctx = baseCtx({
      items: [{ product_id: 'p', category_id: 'c', qty: 1, unit_price: 49999, modifier_total: 0, manual_discount_amount: 0 }],
    });
    expect(evaluateCartTotalMin(ctx, { type: 'cart_total_min', value: 50000 })).toBe(false);
  });
});

describe('product_in_cart', () => {
  it('passes when qty >= min_qty', () => {
    const ctx = baseCtx({
      items: [{ product_id: 'P1', category_id: 'c', qty: 2, unit_price: 100, modifier_total: 0, manual_discount_amount: 0 }],
    });
    expect(evaluateProductInCart(ctx, { type: 'product_in_cart', product_id: 'P1', min_qty: 2 })).toBe(true);
  });
  it('fails when product not in cart', () => {
    const ctx = baseCtx({ items: [] });
    expect(evaluateProductInCart(ctx, { type: 'product_in_cart', product_id: 'P1', min_qty: 1 })).toBe(false);
  });
});

describe('category_in_cart', () => {
  it('passes when sum qty for category >= min_qty', () => {
    const ctx = baseCtx({
      items: [
        { product_id: 'P1', category_id: 'CAT1', qty: 1, unit_price: 100, modifier_total: 0, manual_discount_amount: 0 },
        { product_id: 'P2', category_id: 'CAT1', qty: 2, unit_price: 100, modifier_total: 0, manual_discount_amount: 0 },
      ],
    });
    expect(evaluateCategoryInCart(ctx, { type: 'category_in_cart', category_id: 'CAT1', min_qty: 3 })).toBe(true);
  });
});

describe('customer_category_in', () => {
  it('passes when customer category in list', () => {
    const ctx = baseCtx({ customer_category_id: 'VIP' });
    expect(evaluateCustomerCategoryIn(ctx, { type: 'customer_category_in', category_ids: ['VIP', 'STAFF'] })).toBe(true);
  });
  it('fails when customer category null and list does not include null', () => {
    const ctx = baseCtx({ customer_category_id: null });
    expect(evaluateCustomerCategoryIn(ctx, { type: 'customer_category_in', category_ids: ['VIP'] })).toBe(false);
  });
});

describe('time_window', () => {
  it('passes at 15:00 within 14:00-17:00', () => {
    const ctx = baseCtx({ evaluation_ts: new Date('2026-05-12T15:00:00+08:00') });
    expect(evaluateTimeWindow(ctx, { type: 'time_window', start: '14:00', end: '17:00', tz: 'Asia/Jakarta' })).toBe(true);
  });
  it('fails at 13:59', () => {
    const ctx = baseCtx({ evaluation_ts: new Date('2026-05-12T13:59:00+08:00') });
    expect(evaluateTimeWindow(ctx, { type: 'time_window', start: '14:00', end: '17:00', tz: 'Asia/Jakarta' })).toBe(false);
  });
  it('passes inclusively at 14:00 and 17:00', () => {
    const ctx14 = baseCtx({ evaluation_ts: new Date('2026-05-12T14:00:00+08:00') });
    const ctx17 = baseCtx({ evaluation_ts: new Date('2026-05-12T17:00:00+08:00') });
    expect(evaluateTimeWindow(ctx14, { type: 'time_window', start: '14:00', end: '17:00', tz: 'Asia/Jakarta' })).toBe(true);
    expect(evaluateTimeWindow(ctx17, { type: 'time_window', start: '14:00', end: '17:00', tz: 'Asia/Jakarta' })).toBe(true);
  });
});

describe('weekday_in', () => {
  it('passes mardi (dow=2)', () => {
    const ctx = baseCtx({ evaluation_ts: new Date('2026-05-12T10:00:00+08:00') });
    expect(evaluateWeekdayIn(ctx, { type: 'weekday_in', days: [1, 2, 3, 4, 5] })).toBe(true);
  });
  it('fails samedi (dow=6) when only 1-5', () => {
    const ctx = baseCtx({ evaluation_ts: new Date('2026-05-16T10:00:00+08:00') });
    expect(evaluateWeekdayIn(ctx, { type: 'weekday_in', days: [1, 2, 3, 4, 5] })).toBe(false);
  });
});

describe('valid_dates', () => {
  it('passes inclusivement aux bornes', () => {
    const ctx = baseCtx({ evaluation_ts: new Date('2026-01-01T00:00:00+08:00') });
    expect(evaluateValidDates(ctx, { type: 'valid_dates', from: '2026-01-01', until: '2027-01-01' })).toBe(true);
  });
});

describe('customer_in_loyalty_tier', () => {
  it('passes Gold in [Gold, Platinum]', () => {
    const ctx = baseCtx({ customer_tier: 'Gold' });
    expect(evaluateCustomerInLoyaltyTier(ctx, { type: 'customer_in_loyalty_tier', tiers: ['Gold', 'Platinum'] })).toBe(true);
  });
});

describe('first_order_only', () => {
  it('passes when first_order = true', () => {
    const ctx = baseCtx({ customer_first_order: true });
    expect(evaluateFirstOrderOnly(ctx, { type: 'first_order_only' })).toBe(true);
  });
  it('fails when first_order = false', () => {
    const ctx = baseCtx({ customer_first_order: false });
    expect(evaluateFirstOrderOnly(ctx, { type: 'first_order_only' })).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests pour confirmer 17 fails**

```bash
pnpm --filter @breakery/domain test promotions/conditions/evaluators
```

Expected: tous les tests fail avec "Cannot find module '../evaluators.js'".

- [ ] **Step 3: Implémenter les 9 evaluators**

```ts
// packages/domain/src/promotions/conditions/evaluators.ts
// Spec §3.4 — 9 condition types. Mirror server-side logic.

import type { EvaluationContext, PromotionCondition } from '../types.js';

export function evaluateCartTotalMin(
  ctx: EvaluationContext,
  cond: Extract<PromotionCondition, { type: 'cart_total_min' }>,
): boolean {
  const subtotal = ctx.items.reduce(
    (sum, i) => sum + i.qty * (i.unit_price + i.modifier_total) - i.manual_discount_amount,
    0,
  );
  return subtotal >= cond.value;
}

export function evaluateProductInCart(
  ctx: EvaluationContext,
  cond: Extract<PromotionCondition, { type: 'product_in_cart' }>,
): boolean {
  const qty = ctx.items
    .filter((i) => i.product_id === cond.product_id)
    .reduce((sum, i) => sum + i.qty, 0);
  return qty >= cond.min_qty;
}

export function evaluateCategoryInCart(
  ctx: EvaluationContext,
  cond: Extract<PromotionCondition, { type: 'category_in_cart' }>,
): boolean {
  const qty = ctx.items
    .filter((i) => i.category_id === cond.category_id)
    .reduce((sum, i) => sum + i.qty, 0);
  return qty >= cond.min_qty;
}

export function evaluateCustomerCategoryIn(
  ctx: EvaluationContext,
  cond: Extract<PromotionCondition, { type: 'customer_category_in' }>,
): boolean {
  if (ctx.customer_category_id === null) return false;
  return cond.category_ids.includes(ctx.customer_category_id);
}

function localTimeFields(ts: Date, tz: string): { time: string; dow: number; date: string } {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
    weekday: 'short',
  });
  const parts = Object.fromEntries(fmt.formatToParts(ts).map((p) => [p.type, p.value]));
  const dowMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    time: `${parts.hour}:${parts.minute}`,
    dow: dowMap[parts.weekday] ?? 0,
    date: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

export function evaluateTimeWindow(
  ctx: EvaluationContext,
  cond: Extract<PromotionCondition, { type: 'time_window' }>,
): boolean {
  const { time } = localTimeFields(ctx.evaluation_ts, cond.tz);
  return time >= cond.start && time <= cond.end;
}

export function evaluateWeekdayIn(
  ctx: EvaluationContext,
  cond: Extract<PromotionCondition, { type: 'weekday_in' }>,
): boolean {
  const { dow } = localTimeFields(ctx.evaluation_ts, 'Asia/Jakarta');
  return cond.days.includes(dow);
}

export function evaluateValidDates(
  ctx: EvaluationContext,
  cond: Extract<PromotionCondition, { type: 'valid_dates' }>,
): boolean {
  const { date } = localTimeFields(ctx.evaluation_ts, 'Asia/Jakarta');
  return date >= cond.from && date <= cond.until;
}

export function evaluateCustomerInLoyaltyTier(
  ctx: EvaluationContext,
  cond: Extract<PromotionCondition, { type: 'customer_in_loyalty_tier' }>,
): boolean {
  return cond.tiers.includes(ctx.customer_tier);
}

export function evaluateFirstOrderOnly(
  ctx: EvaluationContext,
  _cond: Extract<PromotionCondition, { type: 'first_order_only' }>,
): boolean {
  return ctx.customer_first_order;
}
```

- [ ] **Step 4: Run tests, expect all pass**

```bash
pnpm --filter @breakery/domain test promotions/conditions/evaluators
```

Expected: 17 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/promotions/conditions/
git commit -m "feat(domain): session 8 — 9 condition evaluators (mirror engine, AND-logic units)"
```

---

### Task 2.3 — Domain `isPromotionEligible` (AND-logic)

**Files:**
- Create: `packages/domain/src/promotions/conditions/isPromotionEligible.ts`
- Create: `packages/domain/src/promotions/conditions/__tests__/isPromotionEligible.test.ts`

- [ ] **Step 1: Écrire le test failing**

```ts
// packages/domain/src/promotions/conditions/__tests__/isPromotionEligible.test.ts
import { describe, it, expect } from 'vitest';
import { isPromotionEligible } from '../isPromotionEligible.js';
import type { EvaluationContext, Promotion } from '../../types.js';

const ctx: EvaluationContext = {
  items: [{ product_id: 'P1', category_id: 'CAT1', qty: 1, unit_price: 50000, modifier_total: 0, manual_discount_amount: 0 }],
  customer_category_id: null,
  customer_tier: 'Bronze',
  customer_first_order: false,
  evaluation_ts: new Date('2026-05-12T15:00:00+08:00'),
};

const baseP = (conditions: Promotion['conditions'] = { all: [] }): Promotion => ({
  id: 'P', name: 'X', slug: 'x', description: null, action_type: 'fixed_off',
  action_params: {}, conditions, priority: 0, is_active: true,
});

describe('isPromotionEligible', () => {
  it('returns true with empty conditions (vacuously true)', () => {
    expect(isPromotionEligible(baseP({ all: [] }), ctx)).toBe(true);
  });
  it('returns true when all conditions pass', () => {
    expect(isPromotionEligible(baseP({ all: [
      { type: 'cart_total_min', value: 30000 },
      { type: 'product_in_cart', product_id: 'P1', min_qty: 1 },
    ]}), ctx)).toBe(true);
  });
  it('returns false if any condition fails', () => {
    expect(isPromotionEligible(baseP({ all: [
      { type: 'cart_total_min', value: 30000 },
      { type: 'cart_total_min', value: 99999 },
    ]}), ctx)).toBe(false);
  });
});
```

- [ ] **Step 2: Run pour confirmer fail**

```bash
pnpm --filter @breakery/domain test promotions/conditions/isPromotionEligible
```

- [ ] **Step 3: Implémenter**

```ts
// packages/domain/src/promotions/conditions/isPromotionEligible.ts
import type { EvaluationContext, Promotion, PromotionCondition } from '../types.js';
import {
  evaluateCartTotalMin,
  evaluateProductInCart,
  evaluateCategoryInCart,
  evaluateCustomerCategoryIn,
  evaluateTimeWindow,
  evaluateWeekdayIn,
  evaluateValidDates,
  evaluateCustomerInLoyaltyTier,
  evaluateFirstOrderOnly,
} from './evaluators.js';

export function isPromotionEligible(promo: Promotion, ctx: EvaluationContext): boolean {
  return promo.conditions.all.every((cond) => evaluateCondition(cond, ctx));
}

function evaluateCondition(cond: PromotionCondition, ctx: EvaluationContext): boolean {
  switch (cond.type) {
    case 'cart_total_min':            return evaluateCartTotalMin(ctx, cond);
    case 'product_in_cart':           return evaluateProductInCart(ctx, cond);
    case 'category_in_cart':          return evaluateCategoryInCart(ctx, cond);
    case 'customer_category_in':      return evaluateCustomerCategoryIn(ctx, cond);
    case 'time_window':               return evaluateTimeWindow(ctx, cond);
    case 'weekday_in':                return evaluateWeekdayIn(ctx, cond);
    case 'valid_dates':               return evaluateValidDates(ctx, cond);
    case 'customer_in_loyalty_tier':  return evaluateCustomerInLoyaltyTier(ctx, cond);
    case 'first_order_only':          return evaluateFirstOrderOnly(ctx, cond);
  }
}
```

- [ ] **Step 4: Run tests pass**

```bash
pnpm --filter @breakery/domain test promotions/conditions/isPromotionEligible
```

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/promotions/conditions/isPromotionEligible.ts packages/domain/src/promotions/conditions/__tests__/isPromotionEligible.test.ts
git commit -m "feat(domain): session 8 — isPromotionEligible (AND-logic dispatcher)"
```

---

### Task 2.4 — Domain `computePotentialDiscount` (4 actions)

**Files:**
- Create: `packages/domain/src/promotions/actions/computePotentialDiscount.ts`
- Create: `packages/domain/src/promotions/actions/__tests__/computePotentialDiscount.test.ts`

- [ ] **Step 1: Écrire les 6 tests qui échouent**

```ts
// packages/domain/src/promotions/actions/__tests__/computePotentialDiscount.test.ts
import { describe, it, expect } from 'vitest';
import { computePotentialDiscount } from '../computePotentialDiscount.js';
import type { Promotion, EvaluationContext } from '../../types.js';

const ctx: EvaluationContext = {
  items: [
    { product_id: 'AMER', category_id: 'BEV', qty: 1, unit_price: 35000, modifier_total: 0, manual_discount_amount: 0 },
    { product_id: 'CROI', category_id: 'BAK', qty: 2, unit_price: 35000, modifier_total: 0, manual_discount_amount: 0 },
  ],
  customer_category_id: null,
  customer_tier: 'Bronze',
  customer_first_order: false,
  evaluation_ts: new Date('2026-05-12T10:00:00+08:00'),
};

const promo = (action_type: Promotion['action_type'], action_params: Record<string, unknown>): Promotion => ({
  id: 'P', name: 'X', slug: 'x', description: null, action_type,
  action_params, conditions: { all: [] }, priority: 0, is_active: true,
});

describe('computePotentialDiscount', () => {
  it('percentage_off cart 20% → 21000 (105k × 0.2)', () => {
    const r = computePotentialDiscount(promo('percentage_off', { percentage: 20, target: 'cart' }), ctx, {});
    expect(r.discount).toBe(21000);
  });
  it('percentage_off category BEV 15% → 5250', () => {
    const r = computePotentialDiscount(
      promo('percentage_off', { percentage: 15, target: 'category', target_id: 'BEV' }),
      ctx, {});
    expect(r.discount).toBe(5250);
  });
  it('fixed_off 5000 cart → 5000 (clamped to subtotal)', () => {
    const r = computePotentialDiscount(promo('fixed_off', { amount: 5000, target: 'cart' }), ctx, {});
    expect(r.discount).toBe(5000);
  });
  it('fixed_off 999999 cart → clamped à 105000', () => {
    const r = computePotentialDiscount(promo('fixed_off', { amount: 999999, target: 'cart' }), ctx, {});
    expect(r.discount).toBe(105000);
  });
  it('bogo CROI 1+1 100% → 35000 + items_to_add', () => {
    const r = computePotentialDiscount(
      promo('bogo', { buy_product_id: 'CROI', buy_qty: 1, get_qty: 1, get_discount_pct: 100 }),
      ctx, { CROI: 35000 });
    expect(r.discount).toBe(35000);
    expect(r.items_to_add).toHaveLength(1);
    expect(r.items_to_add[0]?.is_free_from_promo).toBe(true);
    expect(r.items_to_add[0]?.split_from_existing).toBe(true);
  });
  it('free_product AMER qty 1 → 35000 + items_to_add', () => {
    const r = computePotentialDiscount(
      promo('free_product', { product_id: 'AMER', qty: 1 }),
      ctx, { AMER: 35000 });
    expect(r.discount).toBe(35000);
    expect(r.items_to_add[0]?.split_from_existing).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests fail**

```bash
pnpm --filter @breakery/domain test promotions/actions/computePotentialDiscount
```

- [ ] **Step 3: Implémenter**

```ts
// packages/domain/src/promotions/actions/computePotentialDiscount.ts
// Spec §3.8 — math discount par action_type. Mirror engine RPC.
import { roundIdr } from '@breakery/utils';
import type { EvaluationContext, ItemToAdd, Promotion } from '../types.js';

export interface PotentialDiscount {
  discount: number;
  items_to_add: ItemToAdd[];
  target: 'cart' | 'item';
  target_product_id: string | null;
}

export function computePotentialDiscount(
  promo: Promotion,
  ctx: EvaluationContext,
  retailPrices: Record<string, number>,
): PotentialDiscount {
  const subtotal = ctx.items.reduce(
    (sum, i) => sum + i.qty * (i.unit_price + i.modifier_total) - i.manual_discount_amount,
    0,
  );

  if (promo.action_type === 'percentage_off') {
    const pct = Number(promo.action_params.percentage ?? 0);
    const target = String(promo.action_params.target ?? 'cart');
    const targetId = (promo.action_params.target_id as string) ?? null;
    if (target === 'cart') {
      return { discount: roundIdr((subtotal * pct) / 100), items_to_add: [], target: 'cart', target_product_id: null };
    }
    const matchingSubtotal = ctx.items
      .filter((i) => (target === 'category' ? i.category_id === targetId : i.product_id === targetId))
      .reduce((sum, i) => sum + i.qty * (i.unit_price + i.modifier_total) - i.manual_discount_amount, 0);
    return { discount: roundIdr((matchingSubtotal * pct) / 100), items_to_add: [], target: 'item', target_product_id: target === 'product' ? targetId : null };
  }

  if (promo.action_type === 'fixed_off') {
    const amount = Number(promo.action_params.amount ?? 0);
    return { discount: Math.min(amount, subtotal), items_to_add: [], target: 'cart', target_product_id: null };
  }

  if (promo.action_type === 'bogo') {
    const buyProductId = String(promo.action_params.buy_product_id);
    const buyQty = Number(promo.action_params.buy_qty ?? 1);
    const getQty = Number(promo.action_params.get_qty ?? 1);
    const getDiscountPct = Number(promo.action_params.get_discount_pct ?? 100);
    const matchingQty = ctx.items.filter((i) => i.product_id === buyProductId).reduce((s, i) => s + i.qty, 0);
    const pairs = Math.floor(matchingQty / (buyQty + getQty));
    const unitPrice = retailPrices[buyProductId] ?? 0;
    const discountPerUnit = roundIdr((unitPrice * getDiscountPct) / 100);
    const discount = pairs * getQty * discountPerUnit;
    return {
      discount,
      items_to_add: pairs > 0 ? [{
        product_id: buyProductId,
        qty: pairs * getQty,
        unit_price: unitPrice,
        promotion_discount: discountPerUnit,
        is_free_from_promo: getDiscountPct === 100,
        split_from_existing: true,
      }] : [],
      target: 'item',
      target_product_id: buyProductId,
    };
  }

  // free_product
  const freeProductId = String(promo.action_params.product_id);
  const freeQty = Number(promo.action_params.qty ?? 1);
  const unitPrice = retailPrices[freeProductId] ?? 0;
  return {
    discount: unitPrice * freeQty,
    items_to_add: [{
      product_id: freeProductId,
      qty: freeQty,
      unit_price: unitPrice,
      promotion_discount: unitPrice,
      is_free_from_promo: true,
      split_from_existing: false,
    }],
    target: 'item',
    target_product_id: freeProductId,
  };
}
```

- [ ] **Step 4: Run tests pass**

```bash
pnpm --filter @breakery/domain test promotions/actions/computePotentialDiscount
```

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/promotions/actions/
git commit -m "feat(domain): session 8 — computePotentialDiscount (4 action types)"
```

---

### Task 2.5 — Domain `selectBestPromotion`

**Files:**
- Create: `packages/domain/src/promotions/selectBestPromotion.ts`
- Create: `packages/domain/src/promotions/__tests__/selectBestPromotion.test.ts`

- [ ] **Step 1: Écrire les tests qui échouent**

```ts
// packages/domain/src/promotions/__tests__/selectBestPromotion.test.ts
import { describe, it, expect } from 'vitest';
import { selectBestPromotion } from '../selectBestPromotion.js';
import type { Promotion } from '../types.js';

const p = (id: string, priority: number, created_at: string): Promotion & { created_at: string } => ({
  id, name: id, slug: id, description: null,
  action_type: 'fixed_off', action_params: {}, conditions: { all: [] },
  priority, is_active: true, created_at,
});

describe('selectBestPromotion', () => {
  it('returns null when input empty', () => {
    expect(selectBestPromotion([])).toBeNull();
  });
  it('returns the only candidate', () => {
    const a = p('A', 0, '2026-01-01');
    expect(selectBestPromotion([{ promo: a, discount: 1000 }])?.promo.id).toBe('A');
  });
  it('picks max discount', () => {
    const a = p('A', 0, '2026-01-01');
    const b = p('B', 0, '2026-01-01');
    expect(selectBestPromotion([
      { promo: a, discount: 1000 },
      { promo: b, discount: 5000 },
    ])?.promo.id).toBe('B');
  });
  it('tie → priority DESC wins', () => {
    const a = p('A', 5, '2026-01-01');
    const b = p('B', 10, '2026-01-01');
    expect(selectBestPromotion([
      { promo: a, discount: 1000 },
      { promo: b, discount: 1000 },
    ])?.promo.id).toBe('B');
  });
  it('tie + same priority → created_at ASC wins', () => {
    const a = p('A', 5, '2026-01-01');
    const b = p('B', 5, '2026-02-01');
    expect(selectBestPromotion([
      { promo: a, discount: 1000 },
      { promo: b, discount: 1000 },
    ])?.promo.id).toBe('A');
  });
});
```

- [ ] **Step 2: Run fail**

```bash
pnpm --filter @breakery/domain test promotions/__tests__/selectBestPromotion
```

- [ ] **Step 3: Implémenter**

```ts
// packages/domain/src/promotions/selectBestPromotion.ts
import type { Promotion } from './types.js';

export interface PromotionCandidate {
  promo: Promotion & { created_at?: string };
  discount: number;
}

export function selectBestPromotion(candidates: PromotionCandidate[]): PromotionCandidate | null {
  if (candidates.length === 0) return null;
  const sorted = [...candidates].sort((a, b) => {
    if (b.discount !== a.discount) return b.discount - a.discount;
    if (b.promo.priority !== a.promo.priority) return b.promo.priority - a.promo.priority;
    const ca = a.promo.created_at ?? '';
    const cb = b.promo.created_at ?? '';
    return ca.localeCompare(cb);
  });
  return sorted[0] ?? null;
}
```

- [ ] **Step 4: Run pass**

```bash
pnpm --filter @breakery/domain test promotions/__tests__/selectBestPromotion
```

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/promotions/selectBestPromotion.ts packages/domain/src/promotions/__tests__/selectBestPromotion.test.ts
git commit -m "feat(domain): session 8 — selectBestPromotion (max discount, tie priority/created_at)"
```

---

### Task 2.6 — Domain `validateActionParams`

**Files:**
- Create: `packages/domain/src/promotions/validateActionParams.ts`
- Create: `packages/domain/src/promotions/__tests__/validateActionParams.test.ts`

- [ ] **Step 1: Tests failing**

```ts
// packages/domain/src/promotions/__tests__/validateActionParams.test.ts
import { describe, it, expect } from 'vitest';
import { validateActionParams } from '../validateActionParams.js';

describe('validateActionParams', () => {
  it('percentage_off cart valid', () => {
    expect(validateActionParams('percentage_off', { percentage: 20, target: 'cart' })).toEqual({ ok: true });
  });
  it('percentage_off product missing target_id → invalid', () => {
    const r = validateActionParams('percentage_off', { percentage: 20, target: 'product' });
    expect(r.ok).toBe(false);
  });
  it('percentage_off > 100 invalid', () => {
    expect(validateActionParams('percentage_off', { percentage: 150, target: 'cart' }).ok).toBe(false);
  });
  it('fixed_off non-cart target invalid', () => {
    expect(validateActionParams('fixed_off', { amount: 1000, target: 'product' }).ok).toBe(false);
  });
  it('bogo missing buy_product_id invalid', () => {
    expect(validateActionParams('bogo', { buy_qty: 1, get_qty: 1, get_discount_pct: 100 }).ok).toBe(false);
  });
  it('free_product valid', () => {
    expect(validateActionParams('free_product', { product_id: 'P', qty: 1 }).ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run fail**

- [ ] **Step 3: Implémenter**

```ts
// packages/domain/src/promotions/validateActionParams.ts
import type { PromotionActionType } from './types.js';

export type ValidationResult = { ok: true } | { ok: false; reason: string };

export function validateActionParams(
  type: PromotionActionType,
  params: Record<string, unknown>,
): ValidationResult {
  if (type === 'percentage_off') {
    const pct = Number(params.percentage);
    if (!Number.isFinite(pct) || pct <= 0 || pct > 100) return { ok: false, reason: 'percentage out of (0, 100]' };
    const target = params.target;
    if (target !== 'cart' && target !== 'category' && target !== 'product') return { ok: false, reason: 'invalid target' };
    if ((target === 'category' || target === 'product') && !params.target_id) return { ok: false, reason: 'target_id required' };
    return { ok: true };
  }
  if (type === 'fixed_off') {
    if (params.target !== 'cart') return { ok: false, reason: 'fixed_off only supports cart target v1' };
    if (!Number.isFinite(Number(params.amount)) || Number(params.amount) <= 0) return { ok: false, reason: 'amount must be > 0' };
    return { ok: true };
  }
  if (type === 'bogo') {
    if (!params.buy_product_id) return { ok: false, reason: 'buy_product_id required' };
    if (!Number.isFinite(Number(params.buy_qty)) || Number(params.buy_qty) < 1) return { ok: false, reason: 'buy_qty >= 1' };
    if (!Number.isFinite(Number(params.get_qty)) || Number(params.get_qty) < 1) return { ok: false, reason: 'get_qty >= 1' };
    const pct = Number(params.get_discount_pct);
    if (!Number.isFinite(pct) || pct <= 0 || pct > 100) return { ok: false, reason: 'get_discount_pct out of (0, 100]' };
    return { ok: true };
  }
  // free_product
  if (!params.product_id) return { ok: false, reason: 'product_id required' };
  if (!Number.isFinite(Number(params.qty)) || Number(params.qty) < 1) return { ok: false, reason: 'qty >= 1' };
  return { ok: true };
}
```

- [ ] **Step 4: Run pass**

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/promotions/validateActionParams.ts packages/domain/src/promotions/__tests__/validateActionParams.test.ts
git commit -m "feat(domain): session 8 — validateActionParams (4 action types pre-insert)"
```

---

### Task 2.7 — Extend `cart/calculateTotals` avec promo

**Files:**
- Modify: `packages/domain/src/cart/calculateTotals.ts`
- Modify: `packages/domain/src/cart/__tests__/calculateTotals.test.ts`
- Modify: `packages/domain/src/types/cart.ts` (ajouter `promotionTotal?: number` à Cart)

- [ ] **Step 1: Étendre type Cart**

Ajouter dans `packages/domain/src/types/cart.ts` :

```ts
// Ajouter au type Cart existant :
//   promotionTotal?: number;  // somme cumul des promotion_discount appliqués (cart-level + item-level)
```

- [ ] **Step 2: Écrire les tests étendus**

Ajouter dans `calculateTotals.test.ts` :

```ts
describe('calculateTotals — promo (session 8)', () => {
  it('subtracts promotionTotal between subtotal and redemption', () => {
    const cart: Cart = {
      items: [{ id: '1', product_id: 'P', name: 'X', unit_price: 50000, quantity: 1, modifiers: [] }],
      order_type: 'dine_in',
      promotionTotal: 5000,
    };
    const totals = calculateTotals(cart, 0.1);
    // 50000 - 5000 = 45000 (promo) ; pas de redemption ni manual ; total=45000
    expect(totals.total).toBe(45000);
  });
  it('stack: subtotal − promo − redemption − manual', () => {
    const cart: Cart = {
      items: [{ id: '1', product_id: 'P', name: 'X', unit_price: 50000, quantity: 1, modifiers: [] }],
      order_type: 'dine_in',
      promotionTotal: 5000,
      loyaltyPointsToRedeem: 100,
      cartDiscount: { type: 'percentage', value: 5, amount: 0, reason: 'test', authorized_by: null },
    };
    const totals = calculateTotals(cart, 0.1);
    // 50000 − 5000 = 45000 → −1000 redemption = 44000 → 5% manual = 2200 → 41800
    expect(totals.total).toBe(41800);
  });
  it('throws DiscountExceedsTotalError if promo+redemption+manual > items_total', () => {
    const cart: Cart = {
      items: [{ id: '1', product_id: 'P', name: 'X', unit_price: 1000, quantity: 1, modifiers: [] }],
      order_type: 'dine_in',
      promotionTotal: 500,
      loyaltyPointsToRedeem: 100,  // 1000 IDR
    };
    expect(() => calculateTotals(cart, 0.1)).toThrow(/Discounts exceed/);
  });
});
```

- [ ] **Step 3: Modifier `calculateTotals`**

Insérer la promo step entre items_total et redemption :

```ts
// Après le for items et items_total computed :
const promotion_total = cart.promotionTotal ?? 0;
const post_promotion = items_total - promotion_total;

if (post_promotion < 0) throw new DiscountExceedsTotalError();

const redemption_amount = pointsToValue(cart.loyaltyPointsToRedeem ?? 0);
if (redemption_amount > post_promotion) throw new RedemptionExceedsTotalError();

const post_redemption = post_promotion - redemption_amount;
// (le reste : cart_discount + total + tax inchangé sauf qu'il opère sur post_redemption)
```

- [ ] **Step 4: Run tests pass**

```bash
pnpm --filter @breakery/domain test cart/calculateTotals
```

Expected: anciens tests pass + 3 nouveaux pass.

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/cart/calculateTotals.ts packages/domain/src/cart/__tests__/calculateTotals.test.ts packages/domain/src/types/cart.ts
git commit -m "feat(domain): session 8 — calculateTotals subtracts promotionTotal before redemption"
```

---

### Task 2.8 — Extend `OrderItem` type avec promotion fields

**Files:**
- Modify: `packages/domain/src/types/order.ts`

- [ ] **Step 1: Ajouter les champs**

Modifier `OrderPayloadItem` pour inclure :

```ts
export interface OrderPayloadItem {
  // (existing fields)
  promotion_id?: string;
  promotion_discount?: number;
  is_free_from_promo?: boolean;
}
```

Et ajouter dans `OrderPayload` :

```ts
  evaluation_ts?: string;  // ISO timestamp pour le RPC server-side eval
```

- [ ] **Step 2: Vérifier typecheck**

```bash
pnpm --filter @breakery/domain typecheck
```

- [ ] **Step 3: Commit**

```bash
git add packages/domain/src/types/order.ts
git commit -m "feat(domain): session 8 — extend OrderPayloadItem + OrderPayload with promotion fields"
```

---

## Phase 3 — UI shared components

### Task 3.1 — UI `PromotionLineRow.tsx`

**Files:**
- Create: `packages/ui/src/components/PromotionLineRow.tsx`
- Create: `packages/ui/src/components/__tests__/PromotionLineRow.test.tsx`

- [ ] **Step 1: Test failing**

```tsx
// packages/ui/src/components/__tests__/PromotionLineRow.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PromotionLineRow } from '../PromotionLineRow.js';

describe('PromotionLineRow', () => {
  it('renders name + discount amount formatted IDR', () => {
    render(<PromotionLineRow name="Happy Hour" discount_amount={5250} />);
    expect(screen.getByText(/Happy Hour/)).toBeInTheDocument();
    expect(screen.getByText(/5\.250|5,250/)).toBeInTheDocument();
  });
  it('renders subtitle when provided', () => {
    render(<PromotionLineRow name="Promo X" discount_amount={1000} subtitle="−15% category" />);
    expect(screen.getByText('−15% category')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run fail**

```bash
pnpm --filter @breakery/ui test PromotionLineRow
```

- [ ] **Step 3: Implémenter**

```tsx
// packages/ui/src/components/PromotionLineRow.tsx
import { Tag } from 'lucide-react';
import { Currency } from './Currency.js';

interface PromotionLineRowProps {
  name: string;
  discount_amount: number;
  subtitle?: string;
  className?: string;
}

export function PromotionLineRow({ name, discount_amount, subtitle, className = '' }: PromotionLineRowProps) {
  return (
    <div className={`flex items-center justify-between text-success-fg ${className}`}>
      <div className="flex items-center gap-2">
        <Tag className="h-4 w-4" />
        <div>
          <div className="text-sm">Promo: {name}</div>
          {subtitle && <div className="text-xs text-text-secondary">{subtitle}</div>}
        </div>
      </div>
      <span className="text-sm font-mono">−<Currency value={discount_amount} /></span>
    </div>
  );
}
```

- [ ] **Step 4: Run pass**

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/components/PromotionLineRow.tsx packages/ui/src/components/__tests__/PromotionLineRow.test.tsx
git commit -m "feat(ui): session 8 — PromotionLineRow (breakdown row, success-fg style)"
```

---

### Task 3.2 — UI `PromotionBadge.tsx`

**Files:**
- Create: `packages/ui/src/components/PromotionBadge.tsx`
- Create: `packages/ui/src/components/__tests__/PromotionBadge.test.tsx`

- [ ] **Step 1: Tests failing**

```tsx
// packages/ui/src/components/__tests__/PromotionBadge.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PromotionBadge } from '../PromotionBadge.js';

describe('PromotionBadge', () => {
  it('renders FREE label when isFree=true', () => {
    render(<PromotionBadge promotionName="BOGO" discountAmount={35000} isFree />);
    expect(screen.getByText(/FREE|BOGO/)).toBeInTheDocument();
  });
  it('renders percentage label when isFree=false', () => {
    render(<PromotionBadge promotionName="Happy Hour" discountAmount={5250} isFree={false} />);
    expect(screen.getByText(/Happy Hour|−/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run fail**

- [ ] **Step 3: Implémenter**

```tsx
// packages/ui/src/components/PromotionBadge.tsx
interface PromotionBadgeProps {
  promotionName: string;
  discountAmount: number;
  isFree: boolean;
}

export function PromotionBadge({ promotionName, discountAmount: _amount, isFree }: PromotionBadgeProps) {
  const label = isFree ? `${promotionName} FREE` : `${promotionName}`;
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-success-bg text-success-fg">
      {label}
    </span>
  );
}
```

- [ ] **Step 4: Run pass + commit**

```bash
git add packages/ui/src/components/PromotionBadge.tsx packages/ui/src/components/__tests__/PromotionBadge.test.tsx
git commit -m "feat(ui): session 8 — PromotionBadge (inline pill on cart line)"
```

---

### Task 3.3 — UI `FreeItemRow.tsx`

**Files:**
- Create: `packages/ui/src/components/FreeItemRow.tsx`
- Create: `packages/ui/src/components/__tests__/FreeItemRow.test.tsx`

- [ ] **Step 1: Test**

```tsx
// packages/ui/src/components/__tests__/FreeItemRow.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FreeItemRow } from '../FreeItemRow.js';

describe('FreeItemRow', () => {
  it('renders product name + FREE badge + promo subtitle', () => {
    render(<FreeItemRow productName="Americano" promotionName="Free Americano on 100k+" />);
    expect(screen.getByText('Americano')).toBeInTheDocument();
    expect(screen.getByText(/FREE/i)).toBeInTheDocument();
    expect(screen.getByText('Free Americano on 100k+')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Implémenter**

```tsx
// packages/ui/src/components/FreeItemRow.tsx
import { Gift } from 'lucide-react';

interface FreeItemRowProps {
  productName: string;
  promotionName: string;
}

export function FreeItemRow({ productName, promotionName }: FreeItemRowProps) {
  return (
    <div className="flex items-center justify-between p-2 rounded bg-success-bg/30 border border-success-fg/20">
      <div className="flex items-center gap-2">
        <Gift className="h-4 w-4 text-success-fg" />
        <div>
          <div className="font-medium">{productName}</div>
          <div className="text-xs text-text-secondary">{promotionName}</div>
        </div>
      </div>
      <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-success-fg text-success-bg">FREE</span>
    </div>
  );
}
```

- [ ] **Step 3: Run pass + commit**

```bash
git add packages/ui/src/components/FreeItemRow.tsx packages/ui/src/components/__tests__/FreeItemRow.test.tsx
git commit -m "feat(ui): session 8 — FreeItemRow (auto-add free product display)"
```

---

## Phase 4 — POS app integration

### Task 4.1 — Hook `usePromotions`

**Files:**
- Create: `apps/pos/src/features/promotions/hooks/usePromotions.ts`

- [ ] **Step 1: Implémenter**

```ts
// apps/pos/src/features/promotions/hooks/usePromotions.ts
import { useQuery } from '@tanstack/react-query';
import type { Promotion } from '@breakery/domain';
import { supabase } from '@/lib/supabase';

export function usePromotions() {
  return useQuery({
    queryKey: ['promotions', 'active'],
    queryFn: async (): Promise<Promotion[]> => {
      const { data, error } = await supabase
        .from('promotions')
        .select('id, name, slug, description, action_type, action_params, conditions, priority, is_active')
        .is('deleted_at', null)
        .eq('is_active', true)
        .order('priority', { ascending: false });
      if (error) throw error;
      return (data ?? []) as Promotion[];
    },
    staleTime: 60_000,
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/pos/src/features/promotions/hooks/usePromotions.ts
git commit -m "feat(pos): session 8 — usePromotions hook (cached 60s)"
```

---

### Task 4.2 — Hook `useEvaluatePromotionsLive` (debounced 300 ms)

**Files:**
- Create: `apps/pos/src/features/promotions/hooks/useEvaluatePromotionsLive.ts`

- [ ] **Step 1: Implémenter**

```ts
// apps/pos/src/features/promotions/hooks/useEvaluatePromotionsLive.ts
import { useEffect, useRef, useState } from 'react';
import type { EvaluationResult } from '@breakery/domain';
import { supabase } from '@/lib/supabase';
import { useCartStore } from '@/stores/cartStore';

export function useEvaluatePromotionsLive(): EvaluationResult | null {
  const [result, setResult] = useState<EvaluationResult | null>(null);
  const items = useCartStore((s) => s.cart.items);
  const customerId = useCartStore((s) => s.cart.customerId);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);

    if (items.length === 0) {
      setResult({ applied_promotion: null, skipped_promotions: [] });
      return;
    }

    timerRef.current = setTimeout(async () => {
      const p_items = items.map((i) => ({
        product_id: i.product_id,
        qty: i.quantity,
        unit_price: i.unit_price,
        modifier_total: i.modifiers?.reduce((s, m) => s + (m.price_adjustment ?? 0), 0) ?? 0,
        manual_discount_amount: i.discount?.amount ?? 0,
      }));
      const { data, error } = await supabase.rpc('evaluate_promotions', {
        p_items,
        p_customer_id: customerId ?? null,
        p_evaluation_ts: new Date().toISOString(),
      });
      if (!error && data) setResult(data as unknown as EvaluationResult);
    }, 300);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [items, customerId]);

  return result;
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/pos/src/features/promotions/hooks/useEvaluatePromotionsLive.ts
git commit -m "feat(pos): session 8 — useEvaluatePromotionsLive (debounce 300ms RPC)"
```

---

### Task 4.3 — Cart store extend (`appliedPromotion`, `previewItems`)

**Files:**
- Modify: `apps/pos/src/stores/cartStore.ts`

- [ ] **Step 1: Ajouter state + actions**

Modifier `CartState` pour inclure :

```ts
  appliedPromotion: import('@breakery/domain').AppliedPromotion | null;
  previewItems: import('@breakery/domain').ItemToAdd[];

  setAppliedPromotion: (p: AppliedPromotion | null) => void;
  setPreviewItems: (items: ItemToAdd[]) => void;
  clearPromotionPreview: () => void;
```

Implémenter dans `create<CartState>()` :

```ts
      appliedPromotion: null,
      previewItems: [],
      setAppliedPromotion: (p) =>
        set((s) => ({
          appliedPromotion: p,
          cart: { ...s.cart, promotionTotal: p?.discount_amount ?? 0 },
        })),
      setPreviewItems: (items) => set({ previewItems: items }),
      clearPromotionPreview: () =>
        set((s) => ({
          appliedPromotion: null,
          previewItems: [],
          cart: { ...s.cart, promotionTotal: 0 },
        })),
```

- [ ] **Step 2: Modifier `resetCartAfterCheckout`**

Ajouter dans le `set` callback :

```ts
      appliedPromotion: null,
      previewItems: [],
      // promotionTotal cleared via cart spread elsewhere
```

- [ ] **Step 3: Run typecheck**

```bash
pnpm --filter @breakery/pos typecheck
```

- [ ] **Step 4: Commit**

```bash
git add apps/pos/src/stores/cartStore.ts
git commit -m "feat(pos): session 8 — cartStore extends with appliedPromotion + previewItems"
```

---

### Task 4.4 — Hook `useEvaluatePromotionsLive` → cartStore wiring

**Files:**
- Create: `apps/pos/src/features/promotions/hooks/usePromotionsPreview.ts`

- [ ] **Step 1: Créer le wiring hook**

```ts
// apps/pos/src/features/promotions/hooks/usePromotionsPreview.ts
import { useEffect } from 'react';
import { useEvaluatePromotionsLive } from './useEvaluatePromotionsLive.js';
import { useCartStore } from '@/stores/cartStore';

export function usePromotionsPreview(): void {
  const result = useEvaluatePromotionsLive();
  const setApplied = useCartStore((s) => s.setAppliedPromotion);
  const setPreview = useCartStore((s) => s.setPreviewItems);

  useEffect(() => {
    if (!result) return;
    setApplied(result.applied_promotion);
    setPreview(result.applied_promotion?.items_to_add ?? []);
  }, [result, setApplied, setPreview]);
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/pos/src/features/promotions/hooks/usePromotionsPreview.ts
git commit -m "feat(pos): session 8 — usePromotionsPreview wires live RPC to cartStore"
```

---

### Task 4.5 — `PromotionsSummary` component

**Files:**
- Create: `apps/pos/src/features/promotions/components/PromotionsSummary.tsx`

- [ ] **Step 1: Implémenter**

```tsx
// apps/pos/src/features/promotions/components/PromotionsSummary.tsx
import { PromotionLineRow } from '@breakery/ui';
import { useCartStore } from '@/stores/cartStore';

export function PromotionsSummary() {
  const applied = useCartStore((s) => s.appliedPromotion);
  if (!applied) return null;
  return (
    <div className="border-t border-border-subtle pt-2">
      <div className="text-xs text-text-secondary uppercase tracking-wide mb-1">Promotions</div>
      <PromotionLineRow name={applied.name} discount_amount={applied.discount_amount} />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/pos/src/features/promotions/components/PromotionsSummary.tsx
git commit -m "feat(pos): session 8 — PromotionsSummary block in ActiveOrderPanel"
```

---

### Task 4.6 — Mount preview hook + summary in `ActiveOrderPanel`

**Files:**
- Modify: `apps/pos/src/features/cart/ActiveOrderPanel.tsx`

- [ ] **Step 1: Importer + monter**

```tsx
// Ajouter en haut :
import { PromotionsSummary } from '@/features/promotions/components/PromotionsSummary';
import { usePromotionsPreview } from '@/features/promotions/hooks/usePromotionsPreview';
import { FreeItemRow } from '@breakery/ui';
import { useCartStore } from '@/stores/cartStore';

// Dans le composant :
export function ActiveOrderPanel() {
  usePromotionsPreview();
  const previewItems = useCartStore((s) => s.previewItems);
  // ... existant ...

  return (
    <div>
      {/* items list existante */}

      {/* Preview free/BOGO items (auto-add, read-only) */}
      {previewItems.filter((i) => !i.split_from_existing).map((i) => (
        <FreeItemRow key={i.product_id}
          productName={/* fetch product name via products query, ou via cartStore lookup */ i.product_id}
          promotionName={useCartStore.getState().appliedPromotion?.name ?? ''} />
      ))}

      {/* Promotions summary entre items et discount manual */}
      <PromotionsSummary />

      {/* discount manual section + redemption section existantes */}
    </div>
  );
}
```

> **Note** : pour le `productName` du `FreeItemRow`, étendre `usePromotions` ou créer `useProductsById` query. Alternative pragmatique : passer `previewItem.product_id` et résoudre dans le composant via le hook produits déjà chargé pour le grid.

- [ ] **Step 2: Run dev server et test à l'œil**

```bash
pnpm --filter @breakery/pos dev
```

Ouvrir http://localhost:5173, ajouter 2 croissants → vérifier que `FreeItemRow` "BOGO" apparaît (split_from_existing=true côté store, pas affiché en preview), `PromotionsSummary` affiche `Promo: BOGO Croissant −35 000`.

- [ ] **Step 3: Commit**

```bash
git add apps/pos/src/features/cart/ActiveOrderPanel.tsx
git commit -m "feat(pos): session 8 — ActiveOrderPanel mounts promo preview + summary"
```

---

### Task 4.7 — `CartItemRow` render `PromotionBadge`

**Files:**
- Modify: `apps/pos/src/features/cart/CartItemRow.tsx`

- [ ] **Step 1: Display badge sur item promo**

```tsx
// Ajouter :
import { PromotionBadge } from '@breakery/ui';
import { useCartStore } from '@/stores/cartStore';

// Dans le composant CartItemRow ; on regarde l'appliedPromotion pour matcher cet item :
const applied = useCartStore((s) => s.appliedPromotion);
const isPromoTarget = applied !== null && (
  applied.target_product_id === item.product_id ||
  applied.action_type === 'percentage_off' && applied.target === 'cart'
);

// Render dans le JSX, sous le name :
{isPromoTarget && (
  <PromotionBadge
    promotionName={applied.name}
    discountAmount={applied.discount_amount}
    isFree={item.is_free_from_promo ?? false}
  />
)}
```

> **Note** : pour le BOGO split row, l'`is_free_from_promo` n'est pas accessible côté cart UI v1 (c'est uniquement post-checkout via DB). v1 simplification : badge "BOGO" sur tous les items du buy_product_id. La distinction free vs paid est server-side au checkout.

- [ ] **Step 2: Commit**

```bash
git add apps/pos/src/features/cart/CartItemRow.tsx
git commit -m "feat(pos): session 8 — CartItemRow shows PromotionBadge on targeted items"
```

---

### Task 4.8 — `PaymentTerminal` breakdown extended

**Files:**
- Modify: `apps/pos/src/features/payment/PaymentTerminal.tsx`

- [ ] **Step 1: Ajouter ligne `Promo: <name>` dans breakdown**

Trouver le breakdown actuel (Subtotal / Loyalty redemption / Manual discount / Total) et insérer entre Subtotal et Loyalty :

```tsx
import { PromotionLineRow } from '@breakery/ui';
import { useCartStore } from '@/stores/cartStore';

// Dans le composant :
const applied = useCartStore((s) => s.appliedPromotion);

// Dans le breakdown JSX :
{applied && (
  <PromotionLineRow
    name={applied.name}
    discount_amount={applied.discount_amount}
  />
)}
```

> Le `After promos = Subtotal − applied.discount_amount` est implicite : `calculateTotals` (extended task 2.7) renvoie `total` déjà post-promo (via `cart.promotionTotal`).

- [ ] **Step 2: Smoke test à l'œil**

Ouvrir POS, ajouter 2 croissants → ouvrir PaymentTerminal → vérifier :
```
Subtotal              IDR 70 000
Promo: BOGO Croissant −IDR 35 000
Total                 IDR 35 000
```

- [ ] **Step 3: Commit**

```bash
git add apps/pos/src/features/payment/PaymentTerminal.tsx
git commit -m "feat(pos): session 8 — PaymentTerminal breakdown adds Promo line"
```

---

### Task 4.9 — `useCheckout` forward `p_evaluation_ts`

**Files:**
- Modify: `apps/pos/src/features/payment/hooks/useCheckout.ts`
- Modify: `packages/domain/src/orders/buildOrderPayload.ts` (forward evaluation_ts)
- Modify: `supabase/functions/process-payment/index.ts` (Edge Function passes through)

- [ ] **Step 1: Forward dans useCheckout (RPC pay_existing_order ne reçoit pas — frozen)**

Pour `pay_existing_order` : pas de modif (P10 freeze).

Pour `process-payment` Edge Function path (créer un nouveau order) : modifier le payload pour inclure `evaluation_ts: new Date().toISOString()`.

```ts
// Dans useCheckout, dans l'appel Edge Function :
const payload = buildOrderPayload(sessionId, cartWithLoyalty, input.payment, idempotencyKey, lifetimePoints, multiplier);
payload.evaluation_ts = new Date().toISOString();
```

- [ ] **Step 2: Modifier `buildOrderPayload` pour accepter `evaluation_ts`**

Ajouter param optionnel et forward.

- [ ] **Step 3: Modifier `process-payment` EF pour forward `p_evaluation_ts` au RPC complete_order_with_payment**

```ts
// supabase/functions/process-payment/index.ts
const { data, error } = await supabase.rpc('complete_order_with_payment', {
  // ... existing params
  p_evaluation_ts: payload.evaluation_ts ?? new Date().toISOString(),
});
```

- [ ] **Step 4: Commit**

```bash
git add apps/pos/src/features/payment/hooks/useCheckout.ts packages/domain/src/orders/buildOrderPayload.ts supabase/functions/process-payment/index.ts
git commit -m "feat(pos): session 8 — checkout forwards p_evaluation_ts (server re-eval)"
```

---

## Phase 5 — Tablet integration (freeze flow P10)

> **Note structure** : la fonction "tablet" est intégrée dans `apps/pos/src/features/tablet/` (cf. README session 5). Pas d'app tablet séparée.

### Task 5.1 — `tabletCartStore` + `TabletCart` live preview

**Files:**
- Modify: `apps/pos/src/stores/tabletCartStore.ts`
- Modify: `apps/pos/src/features/tablet/components/TabletCart.tsx` (ou équivalent)

- [ ] **Step 1: Ajouter appliedPromotion + previewItems au tabletCartStore**

Mêmes champs que `cartStore` (Task 4.3) avec leurs setters. Persiste en sessionStorage avec la clé `breakery.tablet-cart.v2`.

- [ ] **Step 2: Hook `useTabletEvaluatePromotionsLive`**

Créer `apps/pos/src/features/tablet/hooks/useTabletEvaluatePromotionsLive.ts` similaire à `useEvaluatePromotionsLive` mais lit depuis `useTabletCartStore`.

- [ ] **Step 3: Mount preview dans `TabletCart` composant**

Importer + appeler `useTabletEvaluatePromotionsLive` dans le composant tablet, set `appliedPromotion` + `previewItems` dans le store, render `<PromotionsSummary />` (variant qui lit `tabletCartStore` au lieu de `cartStore` — créer un prop `useStore` ou un component `TabletPromotionsSummary`).

- [ ] **Step 4: Commit**

```bash
git add apps/pos/src/stores/tabletCartStore.ts apps/pos/src/features/tablet/
git commit -m "feat(pos): session 8 — tablet live promo preview (same UX as POS)"
```

---

### Task 5.2 — Tablet checkout forward `p_evaluation_ts`

**Files:**
- Modify: `apps/pos/src/features/tablet/hooks/useTabletCheckout.ts` (ou équivalent qui appelle `create_tablet_order`)

- [ ] **Step 1: Forward le param**

```ts
const { data, error } = await supabase.rpc('create_tablet_order', {
  p_session_id: sessionId,
  p_table_number: tableNumber,
  p_items,
  p_customer_id: customerId ?? null,
  p_idempotency_key: idempotencyKey ?? null,
  p_evaluation_ts: new Date().toISOString(),
});
```

- [ ] **Step 2: Smoke test à l'œil**

Ouvrir tablet vue, sélectionner table T1, ajouter 1 Americano à 14:30 mardi → submit → vérifier en DB :

```bash
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -c "
SELECT o.order_number, o.promotion_total_amount, op.metadata->>'name_snapshot'
FROM orders o LEFT JOIN order_promotions op ON op.order_id = o.id
ORDER BY o.created_at DESC LIMIT 1;
"
```

Expected: `promotion_total_amount = 5250`, `name_snapshot = 'Happy Hour Beverages 15% off'`.

Repickup côté POS à 17:30 (après HH window) → checkout — la promo est gardée frozen, le total reste 35000−5250 = 29750.

- [ ] **Step 3: Commit**

```bash
git add apps/pos/src/features/tablet/hooks/
git commit -m "feat(pos): session 8 — tablet checkout forwards p_evaluation_ts (freeze)"
```

---

## Phase 6 — Smoke tests + acceptance

### Task 6.1 — Vitest smoke tests POS (8 scénarios spec §5)

**Files:**
- Create: `apps/pos/src/features/promotions/__tests__/promotion-percentage-cart.smoke.test.tsx`
- Create: `apps/pos/src/features/promotions/__tests__/promotion-bogo.smoke.test.tsx`
- Create: `apps/pos/src/features/promotions/__tests__/promotion-free-product.smoke.test.tsx`
- Create: `apps/pos/src/features/promotions/__tests__/promotion-best-only.smoke.test.tsx`
- Create: `apps/pos/src/features/promotions/__tests__/promotion-stack-with-manual-loyalty.smoke.test.tsx`
- Create: `apps/pos/src/features/promotions/__tests__/promotion-vs-manual-line.smoke.test.tsx`
- Create: `apps/pos/src/features/promotions/__tests__/promotion-customer-target.smoke.test.tsx`
- Create: `apps/pos/src/features/promotions/__tests__/promotion-tablet-freeze.smoke.test.tsx`

- [ ] **Step 1: Skeleton commun (helper `setupPromoCart`)**

Créer un helper qui mock `supabase.rpc('evaluate_promotions')` et seed un cart, customer, time. Réutilisé par tous les smoke tests.

- [ ] **Step 2: Écrire les 8 smoke tests**

Pour chaque scénario du §5, suivre le pattern :
- Render `<ActiveOrderPanel>` + `<PaymentTerminal>` dans MemoryRouter + QueryClientProvider
- Inject mock RPC response
- Assert UI : badge présent, breakdown line correcte, total correct
- Pour `tablet-freeze` : mock `create_tablet_order` puis `pay_existing_order`, vérifier que la promo est lue frozen sans re-eval

Les détails (assertions exactes, expected values) viennent du spec §6 critères d'acceptation.

- [ ] **Step 3: Run all smoke tests**

```bash
pnpm --filter @breakery/pos test promotion
```

Expected: 8 tests pass.

- [ ] **Step 4: Commit**

```bash
git add apps/pos/src/features/promotions/__tests__/
git commit -m "test(pos): session 8 — 8 smoke tests for promotion engine UX"
```

---

### Task 6.2 — Run full test suite + lint + typecheck

- [ ] **Step 1: Lint**

```bash
pnpm lint
```

Expected: 0 warning, 0 error.

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

Expected: 0 erreur.

- [ ] **Step 3: All tests**

```bash
pnpm test
```

Expected: 600+ tests pass (incluant nouveaux tests session 8).

- [ ] **Step 4: pgTAP**

```bash
supabase test db
```

Expected: 20/20 promotions_engine tests pass.

- [ ] **Step 5: Si erreurs, fix et commit**

Itérer jusqu'à green. Chaque fix → commit séparé `fix(layer): session 8 — <issue>`.

---

### Task 6.3 — Acceptance manuelle (§6 spec)

- [ ] **Step 1: Smoke test sur dev server**

```bash
pnpm --filter @breakery/pos dev
```

Suivre les 14 critères §6 du spec un par un. Pour chaque coche du spec, exécuter la séquence UI et vérifier visuellement + DB.

| Critère | Action | Vérification |
|---|---|---|
| Migrations 1→8 | `supabase db reset` | log "Applied migration 20260510...8" |
| Seed 5 promos | `psql -c "SELECT count(*) FROM promotions"` | `5` |
| Live preview HH 14:05 mardi | Login admin → dev server time = 14:05 mardi → tap Americano | `PromotionsSummary` affiche `Promo: Happy Hour Beverages 15% off : −5 250` |
| Live preview HH 13:59 | time = 13:59 mardi → tap Americano | Pas de PromotionsSummary |
| BOGO Croissant | tap croissant 2× | `PromotionBadge` "BOGO Free" visible. Checkout → DB : 2 order_items, 1 avec `is_free_from_promo=true` |
| Free product 105k+ | cart 105k | `FreeItemRow` Americano FREE affichée. Checkout → 1 order_item supplémentaire |
| Best-only | cart Bev 50k → HH (-7500) ET Spend50k (-5000) | Affiche **uniquement** HH (max). DB : `skipped_promotions[].reason='not_best'` pour Spend50k |
| Stack manual+redeem+promo | cart Bev 50k + redeem 100 + manual 5% | Total 39 425. JE balanced |
| P12 conflict | 2 croissants + manual line 20% sur ligne 1 | BOGO **skipped** (DB : skipped reason `manual_discount_present`). Pas de promo affichée |
| VIP target | attach VIP customer + cart 35k | VIP 20% off appliquée → −7000 |
| Customer NULL → default | pas de customer + cart 35k | VIP promo skipped, autres éligibles selon contexte |
| Tablet freeze | tablet 16:55 mardi 2 Bev → submit → POS pickup 17:05 → pay | DB : `promotion_total_amount = ` HH freeze, total cohérent |
| Tablet out-of-window | tablet 17:05 mardi → submit | Pas de promo frozen |
| JE balanced v6 | cart 50k − promo 5k − redeem 1k − manual 2k = 42k | DR Cash = CR Sales + CR Tax + CR Discount/loyalty |
| Constraint violations | INSERT promotion sans `all` | RAISE check_violation |
| Negative total guard | cart 1000 + promo 500 + redeem 100 + manual 1000 | RAISE 'Discounts exceed items total' |

- [ ] **Step 2: Si tout pass, créer la PR/merge swarm/session-8**

```bash
git checkout master
git merge --no-ff swarm/session-8 -m "Merge branch 'swarm/session-8'"
git log --oneline -10
```

- [ ] **Step 3: Tag final**

```bash
git tag -a session-8-complete -m "Session 8 — Promotions Engine complete"
```

---

## Self-Review checklist (post-écriture, à exécuter avant transition)

- [ ] **Spec coverage** : Section §3.1 (enum) → Task 1.1 ✅. §3.2 (table) → 1.1 ✅. §3.3 (action_params) → 2.6 (validate) + 2.4 (compute). §3.4 (conditions) → 2.2 + 2.3. §3.5 (order_promotions) → 1.2. §3.6/3.7 → 1.3. §3.8 → 1.4. §3.9 → 1.5. §3.10 → 1.6. §3.11 → 1.7. §3.12 (RLS) → 1.1 + 1.2. §3.13 (seed) → 1.8. §3.14 (migrations list) → covered tasks 1.1-1.8. §4.1 (domain) → 2.1-2.7. §4.2 (UI) → 3.1-3.3. §4.3 (POS) → 4.1-4.9. §4.4 (Tablet) → 5.1-5.2. §4.5 (PaymentTerminal breakdown) → 4.8. §4.6 (KDS impact none) → confirmed no task needed. §5 (tests) → 1.9 + 2.x test files + 6.1 smoke. §6 (acceptance) → 6.3.
- [ ] **Placeholders** : aucun TBD/TODO restant. Quelques "réutiliser logique session N verbatim" dans tasks 1.5-1.7 — c'est du copier-collage explicite, pas un placeholder.
- [ ] **Type consistency** : `AppliedPromotion`, `ItemToAdd`, `EvaluationResult`, `Promotion`, `PromotionCondition`, `EvaluationContext` utilisés cohéremment de Task 2.1 → 2.7 → 4.x.
- [ ] **Ambiguïté** : `PromotionTarget` exporté mais non utilisé dans v1 (target côté DB est `'cart'|'category'|'product'`, côté `AppliedPromotion` simplifié à `'cart'|'item'`) — gardé exporté pour validateActionParams, qui consomme `'cart'|'category'|'product'`. Cohérent.

---

## Execution Handoff

**Plan complet écrit** : 31 tâches sur 6 phases (DB 9, Domain 8, UI 3, POS 9, Tablet 2, smoke+acceptance 3).

**Estimation** : ~6-8 heures d'implémentation continue, à coder en branche `swarm/session-8` puis merge fast-forward.

**Deux options d'exécution :**

1. **Subagent-Driven** (recommandé) — un agent fresh par task, review entre chaque, itération rapide. **REQUIRED SUB-SKILL** : `superpowers:subagent-driven-development`.

2. **Inline Execution** — exécution dans cette session avec checkpoints. **REQUIRED SUB-SKILL** : `superpowers:executing-plans`.

Quelle approche veux-tu ?

