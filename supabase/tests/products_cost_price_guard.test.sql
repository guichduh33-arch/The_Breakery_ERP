-- supabase/tests/products_cost_price_guard.test.sql
-- Session 22 / Phase 1.B.1 — pgTAP guard suite for update_cost_price_v1 +
-- products.cost_price direct-UPDATE revoke.
--
-- Coverage (6 asserts) :
--   T1.   Direct UPDATE cost_price as `authenticated` raises 42501 insufficient_privilege.
--   T2.   update_cost_price_v1 as SUPER_ADMIN happy path : returns movement_id +
--         cost_price actually mutated (lives_ok).
--   T2.b  products.cost_price actually mutated to 12.50.
--   T3.   receive_stock_v1 still updates cost_price via the WAC trigger
--         (regression guard — REVOKE column UPDATE must not break this path).
--   T4.   The cost_price_correction audit row was emitted with the expected payload.
--   T5.   Idempotent-replay envelope parity (fix _014) : second call with same
--         p_idempotency_key returns identical jsonb shape including `old_cost`.
--
-- Runner : wrapped in BEGIN ... ROLLBACK via Supabase MCP execute_sql.
--
-- Seeded users :
--   SUPER_ADMIN : 00000000-0000-0000-0000-000000000001 (has inventory.cost_correction
--                 via role_permissions seed in 20260526000011)
--   CASHIER     : 00000000-0000-0000-0000-000000000002 (no perm)
--   MANAGER     : 00000000-0000-0000-0000-000000000004 (has perm)

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(6);

-- ─────────────────────────────────────────────────────────────────────────────
-- Fixture : create a throwaway product (rolled back at the end) with a known
-- baseline (cost_price=0, current_stock=50, no recipe) so the suite no longer
-- depends on a specific live product. The previous BEV-AMER dependency broke
-- whenever catalog cleanup soft-deleted that product. The id is stashed in a
-- transaction-local GUC so every assert can reference it.
-- ─────────────────────────────────────────────────────────────────────────────
DO $fixture$
DECLARE
  v_cat UUID;
  v_id  UUID;
BEGIN
  SELECT id INTO v_cat FROM categories WHERE deleted_at IS NULL ORDER BY sort_order LIMIT 1;
  INSERT INTO products (sku, name, category_id, retail_price, unit, cost_price,
                        current_stock, product_type, is_semi_finished)
  VALUES ('TEST-COSTGUARD-' || substr(gen_random_uuid()::text, 1, 8),
          'Cost Guard Fixture', v_cat, 25.00, 'pcs', 0, 50, 'finished', false)
  RETURNING id INTO v_id;
  PERFORM set_config('breakery.costguard_pid', v_id::text, true);
END
$fixture$;

-- =============================================================================
-- T1 : direct UPDATE as `authenticated` role raises 42501 insufficient_privilege.
-- We switch to the `authenticated` role momentarily to test column-level GRANT
-- enforcement, then RESET. Using a sub-transaction so RESET is reached.
-- =============================================================================

SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$UPDATE products SET cost_price = 9.99 WHERE id = current_setting('breakery.costguard_pid')::uuid$$,
  '42501',
  NULL,
  'T1 direct UPDATE on products.cost_price as authenticated raises 42501'
);

RESET ROLE;

-- =============================================================================
-- T2 : update_cost_price_v1 as SUPER_ADMIN succeeds + cost_price actually mutated.
-- =============================================================================

DO $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', '00000000-0000-0000-0000-000000000001', 'role', 'authenticated')::TEXT,
    true);
END $$;

SELECT lives_ok(
  $$SELECT update_cost_price_v1(
      (SELECT id FROM products WHERE id = current_setting('breakery.costguard_pid')::uuid),
      12.50,
      'S22 pgTAP T2 — manual correction'
    )$$,
  'T2 SUPER_ADMIN can call update_cost_price_v1 (no exception)'
);

-- Verify cost_price mutated (was 0.00 → expected 12.50).
SELECT is(
  (SELECT cost_price FROM products WHERE id = current_setting('breakery.costguard_pid')::uuid),
  12.50::DECIMAL(14,2),
  'T2.b products.cost_price actually mutated to 12.50'
);

-- =============================================================================
-- T3 : receive_stock_v1 still updates cost_price via WAC (REVOKE doesn't break
-- the trigger path — trigger runs as postgres owner inheriting RPC privileges).
--
-- Combined into T2's assert count via a single regression check : we receive
-- 10 units at 20.00 unit_cost on BEV-AMER (current_stock=50, cost=12.50 post-T2).
-- WAC = round((50*12.50 + 10*20.00) / 60, 2) = round(13.7500, 2) = 13.75.
-- =============================================================================

SELECT receive_stock_v1(
  (SELECT id FROM products WHERE id = current_setting('breakery.costguard_pid')::uuid),
  10::DECIMAL(10,3),
  (SELECT id FROM suppliers WHERE is_active = true AND deleted_at IS NULL LIMIT 1),
  20.00::DECIMAL(14,2),
  'S22 pgTAP T3 — WAC regression smoke'
);

SELECT is(
  (SELECT cost_price FROM products WHERE id = current_setting('breakery.costguard_pid')::uuid),
  13.75::DECIMAL(14,2),
  'T3 receive_stock_v1 WAC path still updates cost_price (13.75 = round((50*12.50+10*20)/60,2))'
);

-- =============================================================================
-- T4 : the cost_price_correction audit row from T2 was emitted with the
-- expected metadata (old_cost=0.00, new_cost=12.50, reason set, qty=0).
-- =============================================================================

SELECT is(
  (SELECT COUNT(*)::INT
     FROM stock_movements
    WHERE movement_type = 'cost_price_correction'::movement_type
      AND product_id = (SELECT id FROM products WHERE id = current_setting('breakery.costguard_pid')::uuid)
      AND quantity = 0
      AND reason LIKE 'S22 pgTAP T2 — manual correction%'
      AND (metadata->>'old_cost')::NUMERIC = 0.00
      AND (metadata->>'new_cost')::NUMERIC = 12.50),
  1,
  'T4 stock_movements has exactly one cost_price_correction row with expected payload'
);

-- =============================================================================
-- T5 : idempotent-replay envelope parity (fix _014). Calling update_cost_price_v1
-- twice with the SAME p_idempotency_key must :
--   (a) NOT emit a second stock_movements row (single audit row total)
--   (b) Return an envelope containing `old_cost`, `new_cost`, `movement_id`,
--       `product_id`, `idempotent_replay`=true — matching the fresh-path shape.
-- The fix in 20260526000014 reconstructs old_cost from the persisted metadata.
-- =============================================================================

-- Two calls with the same fixed UUID idempotency key. The first creates the
-- audit row ; the second must short-circuit through the replay branch.
SELECT update_cost_price_v1(
  (SELECT id FROM products WHERE id = current_setting('breakery.costguard_pid')::uuid),
  15.00::DECIMAL(14,2),
  'S22 pgTAP T5 — idempotent replay',
  '11111111-1111-1111-1111-111111111111'::UUID
);

SELECT is(
  (
    SELECT (
      replay.envelope ? 'old_cost'
      AND replay.envelope ? 'new_cost'
      AND replay.envelope ? 'movement_id'
      AND replay.envelope ? 'product_id'
      AND (replay.envelope->>'idempotent_replay')::BOOLEAN = true
      AND (replay.envelope->>'old_cost')::NUMERIC IS NOT NULL
    )
    FROM (
      SELECT update_cost_price_v1(
        (SELECT id FROM products WHERE id = current_setting('breakery.costguard_pid')::uuid),
        15.00::DECIMAL(14,2),
        'S22 pgTAP T5 — idempotent replay',
        '11111111-1111-1111-1111-111111111111'::UUID
      ) AS envelope
    ) replay
  ),
  true,
  'T5 replay envelope contains old_cost + new_cost + movement_id + product_id + idempotent_replay=true (shape parity with fresh path)'
);

SELECT * FROM finish();
ROLLBACK;
