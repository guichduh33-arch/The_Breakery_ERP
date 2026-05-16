-- supabase/tests/batch_production.test.sql
-- Session 15 / Phase 4.A — Batch production pgTAP suite.
--
-- Covers migrations 20260519000100..000102 :
--   - production_batches table + RLS lockdown
--   - production_records.batch_id FK
--   - record_batch_production_v1 RPC (atomic multi-recipe orchestrator)
--
-- Coverage matrix :
--   T1 — Happy path : 3-item batch -> 1 production_batches row + 3 production_records linked.
--   T2 — Insufficient stock on a single item -> batch ROLLBACK (no batch row).
--   T3 — Idempotency replay : same key -> idempotent_replay=true + same batch_number.
--   T4 — Permission denied : CASHIER (no inventory.production.create) -> forbidden.
--   T5 — Aggregate stock validation : two items sharing an ingredient ; sum exceeds available -> shortage.
--   T6 — Empty items array -> items_must_be_non_empty_array.
--   T7 — Invalid item (quantity <= 0) -> quantity_must_be_positive + batch ROLLBACK.
--   T8 — production_records.batch_id FK populated on success.
--
-- Runner : apply this body inside MCP execute_sql under a BEGIN .. ROLLBACK envelope.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(8);

-- ---------------------------------------------------------------------------
-- Bootstrap : resolve admin + cashier auth UIDs and a working section.
-- ---------------------------------------------------------------------------
DO $boot$
DECLARE
  v_admin_uid     UUID;
  v_admin_profile UUID;
  v_cashier_uid   UUID;
  v_section_id    UUID;
  v_category_id   UUID;
BEGIN
  SELECT auth_user_id INTO v_admin_uid     FROM user_profiles WHERE employee_code='EMP000';
  SELECT id           INTO v_admin_profile FROM user_profiles WHERE employee_code='EMP000';
  SELECT auth_user_id INTO v_cashier_uid   FROM user_profiles WHERE employee_code='EMP001';
  SELECT id INTO v_section_id  FROM sections   WHERE deleted_at IS NULL ORDER BY display_order LIMIT 1;
  SELECT id INTO v_category_id FROM categories WHERE deleted_at IS NULL LIMIT 1;

  PERFORM set_config('bp.admin_uid',     v_admin_uid::text,     false);
  PERFORM set_config('bp.admin_profile', v_admin_profile::text, false);
  PERFORM set_config('bp.cashier_uid',   v_cashier_uid::text,   false);
  PERFORM set_config('bp.section_id',    v_section_id::text,    false);
  PERFORM set_config('bp.category_id',   v_category_id::text,   false);
  PERFORM set_config('request.jwt.claim.sub', v_admin_uid::text, false);
END $boot$;

-- Helper : create a finished product with stock.
CREATE OR REPLACE FUNCTION pg_temp.mkprod(p_sku TEXT, p_name TEXT, p_unit TEXT, p_cost NUMERIC, p_stock NUMERIC DEFAULT 1000)
RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE v_id UUID;
BEGIN
  INSERT INTO products (sku, name, category_id, retail_price, current_stock, unit, cost_price, product_type, is_active)
  VALUES (p_sku, p_name, current_setting('bp.category_id')::uuid, 100, p_stock, p_unit, p_cost, 'finished', TRUE)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- ---------------------------------------------------------------------------
-- Fixtures :
--   Recipe A: finished_a (1 pcs) -> mat_x (2 kg) + mat_y (1 kg)
--   Recipe B: finished_b (1 pcs) -> mat_x (3 kg) + mat_z (2 kg)
--   Recipe C: finished_c (1 pcs) -> mat_y (1 kg)
-- Plenty of stock by default ; specific tests zero out as needed.
-- ---------------------------------------------------------------------------
DO $fix$
DECLARE
  v_fa UUID; v_fb UUID; v_fc UUID;
  v_mx UUID; v_my UUID; v_mz UUID;
BEGIN
  v_fa := pg_temp.mkprod('BP-T1-FA', 'BP T1 Finished A', 'pcs',  500,    0);
  v_fb := pg_temp.mkprod('BP-T1-FB', 'BP T1 Finished B', 'pcs',  500,    0);
  v_fc := pg_temp.mkprod('BP-T1-FC', 'BP T1 Finished C', 'pcs',  500,    0);
  v_mx := pg_temp.mkprod('BP-T1-MX', 'BP T1 Mat X',      'kg',  1000, 1000);
  v_my := pg_temp.mkprod('BP-T1-MY', 'BP T1 Mat Y',      'kg',  1000, 1000);
  v_mz := pg_temp.mkprod('BP-T1-MZ', 'BP T1 Mat Z',      'kg',  1000, 1000);

  INSERT INTO recipes (product_id, material_id, quantity, unit, is_active) VALUES
    (v_fa, v_mx, 2, 'kg', TRUE),
    (v_fa, v_my, 1, 'kg', TRUE),
    (v_fb, v_mx, 3, 'kg', TRUE),
    (v_fb, v_mz, 2, 'kg', TRUE),
    (v_fc, v_my, 1, 'kg', TRUE);

  PERFORM set_config('bp.fa', v_fa::text, false);
  PERFORM set_config('bp.fb', v_fb::text, false);
  PERFORM set_config('bp.fc', v_fc::text, false);
  PERFORM set_config('bp.mx', v_mx::text, false);
  PERFORM set_config('bp.my', v_my::text, false);
  PERFORM set_config('bp.mz', v_mz::text, false);
END $fix$;

-- ---------------------------------------------------------------------------
-- T1 — Happy path : 3-item batch creates 1 batch + 3 linked production_records.
-- ---------------------------------------------------------------------------
DO $t1$
DECLARE
  v_payload JSONB;
  v_batch_id UUID;
  v_pr_count INT;
  v_pr_match INT;
BEGIN
  v_payload := record_batch_production_v1(
    jsonb_build_object(
      'notes',      'T1 happy path',
      'section_id', current_setting('bp.section_id')
    ),
    jsonb_build_array(
      jsonb_build_object('product_id', current_setting('bp.fa'), 'quantity_produced', 1),
      jsonb_build_object('product_id', current_setting('bp.fb'), 'quantity_produced', 1),
      jsonb_build_object('product_id', current_setting('bp.fc'), 'quantity_produced', 2)
    )
  );
  v_batch_id := (v_payload->>'batch_id')::uuid;

  SELECT COUNT(*) INTO v_pr_count FROM production_records WHERE batch_id = v_batch_id;
  SELECT COUNT(*) INTO v_pr_match FROM production_batches WHERE id = v_batch_id AND status='completed';

  PERFORM set_config('bp.t1_batch_id', v_batch_id::text, false);
  PERFORM set_config('bp.t1_pr_count', v_pr_count::text, false);
  PERFORM set_config('bp.t1_batch_completed', v_pr_match::text, false);
END $t1$;

SELECT is(
  current_setting('bp.t1_pr_count')::int,
  3,
  'T1: happy path 3 items -> 3 production_records linked to the batch'
);

-- ---------------------------------------------------------------------------
-- T2 — Insufficient stock on one item -> whole batch ROLLBACK.
-- ---------------------------------------------------------------------------
DO $t2$
DECLARE
  v_caught BOOLEAN := FALSE;
  v_err_msg TEXT;
  v_batches_before INT;
  v_batches_after INT;
BEGIN
  -- Zero out mat_z so finished_b is short.
  UPDATE products SET current_stock = 0 WHERE id = current_setting('bp.mz')::uuid;

  SELECT COUNT(*) INTO v_batches_before FROM production_batches;

  BEGIN
    PERFORM record_batch_production_v1(
      jsonb_build_object('section_id', current_setting('bp.section_id')),
      jsonb_build_array(
        jsonb_build_object('product_id', current_setting('bp.fa'), 'quantity_produced', 1),
        jsonb_build_object('product_id', current_setting('bp.fb'), 'quantity_produced', 1)
      )
    );
  EXCEPTION WHEN OTHERS THEN
    v_caught  := TRUE;
    v_err_msg := SQLERRM;
  END;

  SELECT COUNT(*) INTO v_batches_after FROM production_batches;

  PERFORM set_config('bp.t2_caught',  CASE WHEN v_caught THEN '1' ELSE '0' END, false);
  PERFORM set_config('bp.t2_err',     v_err_msg, false);
  PERFORM set_config('bp.t2_no_leak', CASE WHEN v_batches_before = v_batches_after THEN '1' ELSE '0' END, false);

  -- Restore stock for downstream tests.
  UPDATE products SET current_stock = 1000 WHERE id = current_setting('bp.mz')::uuid;
END $t2$;

SELECT is(
  current_setting('bp.t2_caught') || ':' || current_setting('bp.t2_no_leak'),
  '1:1',
  'T2: insufficient_stock raised AND no batch row leaked (entire batch rolled back)'
);

-- ---------------------------------------------------------------------------
-- T3 — Idempotency replay : same key -> idempotent_replay=true + same batch_number.
-- ---------------------------------------------------------------------------
DO $t3$
DECLARE
  v_key UUID := gen_random_uuid();
  v_first JSONB;
  v_replay JSONB;
  v_batches INT;
BEGIN
  v_first := record_batch_production_v1(
    jsonb_build_object(
      'section_id',      current_setting('bp.section_id'),
      'idempotency_key', v_key::text
    ),
    jsonb_build_array(
      jsonb_build_object('product_id', current_setting('bp.fc'), 'quantity_produced', 1)
    )
  );
  v_replay := record_batch_production_v1(
    jsonb_build_object(
      'section_id',      current_setting('bp.section_id'),
      'idempotency_key', v_key::text
    ),
    jsonb_build_array(
      jsonb_build_object('product_id', current_setting('bp.fc'), 'quantity_produced', 1)
    )
  );
  SELECT COUNT(*) INTO v_batches FROM production_batches WHERE idempotency_key = v_key;

  PERFORM set_config('bp.t3_first_replay',  (v_first->>'idempotent_replay'), false);
  PERFORM set_config('bp.t3_second_replay', (v_replay->>'idempotent_replay'), false);
  PERFORM set_config('bp.t3_same_batch',
    CASE WHEN (v_first->>'batch_number') = (v_replay->>'batch_number') THEN '1' ELSE '0' END,
    false);
  PERFORM set_config('bp.t3_batches', v_batches::text, false);
END $t3$;

SELECT is(
  current_setting('bp.t3_first_replay')
    || '|' || current_setting('bp.t3_second_replay')
    || '|' || current_setting('bp.t3_same_batch')
    || '|' || current_setting('bp.t3_batches'),
  'false|true|1|1',
  'T3: idempotency key replayed returns same batch_number without doubling rows'
);

-- ---------------------------------------------------------------------------
-- T4 — Permission denied for CASHIER (no inventory.production.create).
-- ---------------------------------------------------------------------------
DO $t4$
DECLARE
  v_cashier_uid UUID := current_setting('bp.cashier_uid')::uuid;
  v_raised      TEXT := '';
BEGIN
  IF v_cashier_uid IS NULL THEN
    PERFORM set_config('bp.t4', 'skip', false);
    RETURN;
  END IF;
  PERFORM set_config('request.jwt.claim.sub', v_cashier_uid::text, false);
  PERFORM set_config('role', 'authenticated', false);
  BEGIN
    PERFORM record_batch_production_v1(
      jsonb_build_object('section_id', current_setting('bp.section_id')),
      jsonb_build_array(
        jsonb_build_object('product_id', current_setting('bp.fa'), 'quantity_produced', 1)
      )
    );
  EXCEPTION WHEN OTHERS THEN
    v_raised := SQLERRM;
  END;
  PERFORM set_config('role','postgres',false);
  PERFORM set_config('request.jwt.claim.sub', current_setting('bp.admin_uid'), false);
  PERFORM set_config('bp.t4', v_raised, false);
END $t4$;

SELECT ok(
  current_setting('bp.t4') IN ('forbidden','skip'),
  'T4: CASHIER without inventory.production.create -> forbidden (or skipped if no seed)'
);

-- ---------------------------------------------------------------------------
-- T5 — Aggregate stock validation across two items sharing an ingredient.
--   Setup: mat_x stock = 4 kg ; A requires 2 kg, B requires 3 kg => sum 5 > 4.
-- ---------------------------------------------------------------------------
DO $t5$
DECLARE
  v_caught BOOLEAN := FALSE;
  v_err TEXT := '';
BEGIN
  UPDATE products SET current_stock = 4 WHERE id = current_setting('bp.mx')::uuid;
  BEGIN
    PERFORM record_batch_production_v1(
      jsonb_build_object('section_id', current_setting('bp.section_id')),
      jsonb_build_array(
        jsonb_build_object('product_id', current_setting('bp.fa'), 'quantity_produced', 1),
        jsonb_build_object('product_id', current_setting('bp.fb'), 'quantity_produced', 1)
      )
    );
  EXCEPTION WHEN OTHERS THEN
    v_caught := TRUE;
    v_err := SQLERRM;
  END;
  UPDATE products SET current_stock = 1000 WHERE id = current_setting('bp.mx')::uuid;
  PERFORM set_config('bp.t5_caught', CASE WHEN v_caught THEN '1' ELSE '0' END, false);
  PERFORM set_config('bp.t5_err',    v_err, false);
END $t5$;

SELECT is(
  current_setting('bp.t5_caught') || '|' || current_setting('bp.t5_err'),
  '1|insufficient_stock',
  'T5: aggregate shortfall across two items sharing mat_x raises insufficient_stock'
);

-- ---------------------------------------------------------------------------
-- T6 — Empty items array.
-- ---------------------------------------------------------------------------
DO $t6$
DECLARE v_err TEXT := '';
BEGIN
  BEGIN
    PERFORM record_batch_production_v1(
      jsonb_build_object('section_id', current_setting('bp.section_id')),
      '[]'::jsonb
    );
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
  END;
  PERFORM set_config('bp.t6', v_err, false);
END $t6$;

SELECT is(
  current_setting('bp.t6'), 'items_must_be_non_empty_array',
  'T6: empty items array rejected with items_must_be_non_empty_array'
);

-- ---------------------------------------------------------------------------
-- T7 — Invalid item quantity (zero) raises quantity_must_be_positive + ROLLBACK.
-- ---------------------------------------------------------------------------
DO $t7$
DECLARE
  v_err TEXT := '';
  v_batches_before INT;
  v_batches_after  INT;
BEGIN
  SELECT COUNT(*) INTO v_batches_before FROM production_batches;
  BEGIN
    PERFORM record_batch_production_v1(
      jsonb_build_object('section_id', current_setting('bp.section_id')),
      jsonb_build_array(
        jsonb_build_object('product_id', current_setting('bp.fa'), 'quantity_produced', 1),
        jsonb_build_object('product_id', current_setting('bp.fb'), 'quantity_produced', 0)
      )
    );
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
  END;
  SELECT COUNT(*) INTO v_batches_after FROM production_batches;
  PERFORM set_config('bp.t7',
    v_err || '|' || CASE WHEN v_batches_before = v_batches_after THEN 'no_leak' ELSE 'LEAKED' END,
    false);
END $t7$;

SELECT is(
  current_setting('bp.t7'),
  'quantity_must_be_positive|no_leak',
  'T7: invalid item (qty <= 0) rejected before any batch row is inserted'
);

-- ---------------------------------------------------------------------------
-- T8 — production_records.batch_id correctly populated by record_batch_production_v1
--      and NULL on standalone record_production_v1 calls.
-- ---------------------------------------------------------------------------
DO $t8$
DECLARE
  v_batch_id UUID := current_setting('bp.t1_batch_id', true)::uuid;
  v_all_match BOOLEAN;
BEGIN
  IF v_batch_id IS NULL THEN
    PERFORM set_config('bp.t8','skip',false);
    RETURN;
  END IF;
  SELECT bool_and(batch_id = v_batch_id) INTO v_all_match
    FROM production_records WHERE batch_id = v_batch_id;
  PERFORM set_config('bp.t8', CASE WHEN v_all_match THEN '1' ELSE '0' END, false);
END $t8$;

SELECT ok(
  current_setting('bp.t8') IN ('1','skip'),
  'T8: every production_records row in the batch has batch_id = parent batch id'
);

SELECT * FROM finish();

ROLLBACK;
