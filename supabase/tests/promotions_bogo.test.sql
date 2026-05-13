-- supabase/tests/promotions_bogo.test.sql
-- Session 13 / Phase 2.C — pgTAP suite for `evaluate_promotions_v1`.
--
-- Runs against the deployed schema on staging
-- (`ikcyvlovptebroadgtvd`). Invoke via MCP `execute_sql` wrapped in
-- BEGIN…ROLLBACK so fixtures stay clean.
--
-- T_BOGO_01: function exists with right signature.
-- T_BOGO_02: BOGO new shape — 3 baguettes ⇒ 1 free, discount = unit_price.
-- T_BOGO_03: BOGO legacy shape (arrays) still works.
-- T_BOGO_04: Threshold subtotal — cart 150k @ 10% / cap 50k ⇒ discount 15k.
-- T_BOGO_05: Threshold quantity — cart qty 4 ≥ 3 ⇒ fixed 5k off.
-- T_BOGO_06: Bundle — cart [A,B,C] = 70k, bundle_price 50k ⇒ discount 20k.
-- T_BOGO_07: Expired promotion (end_at < now) is skipped.
-- T_BOGO_08: Day-of-week mismatch ⇒ skipped.
-- T_BOGO_09: Customer-category restriction skipped when no customer.
-- T_BOGO_10: Stacking — two stackable promos both apply.
--
-- ISOLATION STRATEGY: Each test reactivates only the promotion(s) it
-- needs via `UPDATE promotions SET is_active = (slug IN (...))`. The
-- DO-block fixture inserts all promos with `is_active=false` so they
-- don't fire until the relevant test enables them.

BEGIN;
SELECT plan(10);

DO $$
DECLARE
  v_cat_id  UUID;
  v_p_a_id  UUID;
  v_p_b_id  UUID;
  v_p_c_id  UUID;
  v_p_brd   UUID;
BEGIN
  INSERT INTO categories(name, slug)
  VALUES ('Test Cat 2C', 'test-cat-2c')
  RETURNING id INTO v_cat_id;

  INSERT INTO products(sku, name, retail_price, category_id, unit, is_active)
  VALUES
    ('TEST-BAG-2C', 'Test Baguette 2C',  15000, v_cat_id, 'unit', true),
    ('TEST-CRO-2C', 'Test Croissant 2C', 20000, v_cat_id, 'unit', true),
    ('TEST-COF-2C', 'Test Coffee 2C',    25000, v_cat_id, 'unit', true),
    ('TEST-JUS-2C', 'Test Jus 2C',       25000, v_cat_id, 'unit', true);

  SELECT id INTO v_p_a_id FROM products WHERE name = 'Test Baguette 2C';
  SELECT id INTO v_p_b_id FROM products WHERE name = 'Test Croissant 2C';
  SELECT id INTO v_p_c_id FROM products WHERE name = 'Test Coffee 2C';
  SELECT id INTO v_p_brd FROM products WHERE name = 'Test Jus 2C';

  -- Insert all fixtures with is_active=false so tests opt-in per case.
  INSERT INTO promotions(
    name, slug, type,
    bogo_buy_quantity, bogo_get_quantity, bogo_get_product_id,
    bogo_trigger_product_ids,
    priority, stackable_with_promo, is_active
  ) VALUES (
    'Test BOGO 2+1 Baguette', 'test-bogo-2-1-baguette', 'bogo',
    2, 1, v_p_a_id,
    ARRAY[v_p_a_id],
    100, false, false
  );

  INSERT INTO promotions(
    name, slug, type,
    bogo_trigger_product_ids, bogo_reward_product_ids,
    bogo_trigger_qty, bogo_reward_qty, bogo_reward_discount_pct,
    priority, stackable_with_promo, is_active
  ) VALUES (
    'Test BOGO Legacy', 'test-bogo-legacy', 'bogo',
    ARRAY[v_p_a_id], ARRAY[v_p_b_id],
    2, 1, 100,
    90, false, false
  );

  INSERT INTO promotions(
    name, slug, type,
    threshold_amount, threshold_type, discount_value, max_discount_amount,
    priority, stackable_with_promo, is_active
  ) VALUES (
    'Test Threshold Subtotal', 'test-threshold-subtotal', 'threshold',
    100000, 'subtotal', 10, 50000,
    80, false, false
  );

  INSERT INTO promotions(
    name, slug, type,
    threshold_amount, threshold_type, discount_value,
    priority, stackable_with_promo, is_active
  ) VALUES (
    'Test Threshold Quantity', 'test-threshold-quantity', 'threshold',
    3, 'quantity', 5000,
    70, false, false
  );

  INSERT INTO promotions(
    name, slug, type,
    bundle_product_ids, bundle_price,
    priority, stackable_with_promo, is_active
  ) VALUES (
    'Test Bundle', 'test-bundle', 'bundle',
    ARRAY[v_p_b_id, v_p_c_id, v_p_brd], 50000,
    60, false, false
  );

  INSERT INTO promotions(
    name, slug, type, scope, discount_value,
    start_at, end_at,
    priority, stackable_with_promo, is_active
  ) VALUES (
    'Test Expired', 'test-expired', 'percentage', 'cart', 10,
    '2025-01-01'::timestamptz, '2025-02-01'::timestamptz,
    150, false, false
  );

  INSERT INTO promotions(
    name, slug, type, scope, discount_value,
    day_of_week_mask,
    priority, stackable_with_promo, is_active
  ) VALUES (
    'Test DOW Skip', 'test-dow-skip', 'percentage', 'cart', 10,
    (1 << (((EXTRACT(ISODOW FROM now())::INT - 2 + 7) % 7))),
    140, false, false
  );

  INSERT INTO promotions(
    name, slug, type, scope, discount_value,
    customer_category_ids,
    priority, stackable_with_promo, is_active
  ) VALUES (
    'Test Cust Cat Required', 'test-cust-cat-required', 'percentage', 'cart', 5,
    ARRAY[gen_random_uuid()],
    130, false, false
  );

  INSERT INTO promotions(
    name, slug, type, scope, discount_value,
    priority, stackable_with_promo, is_active
  ) VALUES
    ('Test Stack A', 'test-stack-a', 'percentage',    'cart',    5, 200, true, false),
    ('Test Stack B', 'test-stack-b', 'fixed_amount',  'cart', 2500, 195, true, false);

  -- Disable any prod/seed promos for the duration of this transaction.
  UPDATE promotions
  SET is_active = false
  WHERE slug NOT LIKE 'test-%';
END $$;

-- ============================================================
-- T_BOGO_01 — function signature.
-- ============================================================
SELECT has_function(
  'public', 'evaluate_promotions_v1',
  ARRAY['jsonb','uuid','numeric'],
  'evaluate_promotions_v1 exists with (jsonb, uuid, numeric) signature'
);

-- ============================================================
-- T_BOGO_02 — BOGO new shape.
-- ============================================================
UPDATE promotions SET is_active = (slug = 'test-bogo-2-1-baguette') WHERE slug LIKE 'test-%';
WITH payload AS (
  SELECT evaluate_promotions_v1(
    jsonb_build_array(jsonb_build_object(
      'line_id','L1',
      'product_id',(SELECT id FROM products WHERE name='Test Baguette 2C'),
      'quantity',3,'unit_price',15000
    )),
    NULL, NULL
  ) AS r
)
SELECT is(
  (r -> 'applied_promotions' -> 0 ->> 'discount_amount')::NUMERIC,
  15000::NUMERIC,
  'T_BOGO_02: 3 baguettes (15k each) ⇒ discount = 15k'
) FROM payload;

-- ============================================================
-- T_BOGO_03 — BOGO legacy shape.
-- ============================================================
UPDATE promotions SET is_active = (slug = 'test-bogo-legacy') WHERE slug LIKE 'test-%';
WITH payload AS (
  SELECT evaluate_promotions_v1(
    jsonb_build_array(
      jsonb_build_object('line_id','L1','product_id',(SELECT id FROM products WHERE name='Test Baguette 2C'),'quantity',2,'unit_price',15000),
      jsonb_build_object('line_id','L2','product_id',(SELECT id FROM products WHERE name='Test Croissant 2C'),'quantity',1,'unit_price',20000)
    ),
    NULL, NULL
  ) AS r
)
SELECT is(
  (r -> 'applied_promotions' -> 0 ->> 'discount_amount')::NUMERIC,
  20000::NUMERIC,
  'T_BOGO_03: legacy BOGO discounts 1 croissant @ 100% = 20k'
) FROM payload;

-- ============================================================
-- T_BOGO_04 — Threshold subtotal.
-- ============================================================
UPDATE promotions SET is_active = (slug = 'test-threshold-subtotal') WHERE slug LIKE 'test-%';
WITH payload AS (
  SELECT evaluate_promotions_v1(
    jsonb_build_array(jsonb_build_object(
      'line_id','L1','product_id',(SELECT id FROM products WHERE name='Test Croissant 2C'),
      'quantity',3,'unit_price',50000
    )),
    NULL, NULL
  ) AS r
)
SELECT is(
  (r ->> 'total_discount')::NUMERIC,
  15000::NUMERIC,
  'T_BOGO_04: 150k subtotal threshold @ 10% ⇒ 15k discount (cap 50k not hit)'
) FROM payload;

-- ============================================================
-- T_BOGO_05 — Threshold quantity.
-- ============================================================
UPDATE promotions SET is_active = (slug = 'test-threshold-quantity') WHERE slug LIKE 'test-%';
WITH payload AS (
  SELECT evaluate_promotions_v1(
    jsonb_build_array(jsonb_build_object(
      'line_id','L1','product_id',(SELECT id FROM products WHERE name='Test Croissant 2C'),
      'quantity',4,'unit_price',5000
    )),
    NULL, NULL
  ) AS r
)
SELECT is(
  (r ->> 'total_discount')::NUMERIC,
  5000::NUMERIC,
  'T_BOGO_05: 4 units ≥ threshold 3 ⇒ 5k fixed off'
) FROM payload;

-- ============================================================
-- T_BOGO_06 — Bundle.
-- ============================================================
UPDATE promotions SET is_active = (slug = 'test-bundle') WHERE slug LIKE 'test-%';
WITH payload AS (
  SELECT evaluate_promotions_v1(
    jsonb_build_array(
      jsonb_build_object('line_id','L1','product_id',(SELECT id FROM products WHERE name='Test Croissant 2C'),'quantity',1,'unit_price',20000),
      jsonb_build_object('line_id','L2','product_id',(SELECT id FROM products WHERE name='Test Coffee 2C'),   'quantity',1,'unit_price',25000),
      jsonb_build_object('line_id','L3','product_id',(SELECT id FROM products WHERE name='Test Jus 2C'),      'quantity',1,'unit_price',25000)
    ),
    NULL, NULL
  ) AS r
)
SELECT is(
  (r ->> 'total_discount')::NUMERIC,
  20000::NUMERIC,
  'T_BOGO_06: bundle 70k − 50k ⇒ 20k off'
) FROM payload;

-- ============================================================
-- T_BOGO_07 — Expired promotion.
-- ============================================================
UPDATE promotions SET is_active = (slug = 'test-expired') WHERE slug LIKE 'test-%';
WITH payload AS (
  SELECT evaluate_promotions_v1(
    jsonb_build_array(jsonb_build_object(
      'line_id','L1','product_id',(SELECT id FROM products WHERE name='Test Croissant 2C'),
      'quantity',5,'unit_price',1000
    )),
    NULL, NULL
  ) AS r
)
SELECT is(
  jsonb_array_length(r -> 'applied_promotions'),
  0,
  'T_BOGO_07: expired promotion does not apply'
) FROM payload;

-- ============================================================
-- T_BOGO_08 — Day-of-week mismatch.
-- ============================================================
UPDATE promotions SET is_active = (slug = 'test-dow-skip') WHERE slug LIKE 'test-%';
WITH payload AS (
  SELECT evaluate_promotions_v1(
    jsonb_build_array(jsonb_build_object(
      'line_id','L1','product_id',(SELECT id FROM products WHERE name='Test Croissant 2C'),
      'quantity',1,'unit_price',1000
    )),
    NULL, NULL
  ) AS r
)
SELECT is(
  jsonb_array_length(r -> 'applied_promotions'),
  0,
  'T_BOGO_08: day-of-week mismatch skips promotion'
) FROM payload;

-- ============================================================
-- T_BOGO_09 — Customer-category restriction.
-- ============================================================
UPDATE promotions SET is_active = (slug = 'test-cust-cat-required') WHERE slug LIKE 'test-%';
WITH payload AS (
  SELECT evaluate_promotions_v1(
    jsonb_build_array(jsonb_build_object(
      'line_id','L1','product_id',(SELECT id FROM products WHERE name='Test Croissant 2C'),
      'quantity',1,'unit_price',1000
    )),
    NULL, NULL
  ) AS r
)
SELECT is(
  jsonb_array_length(r -> 'applied_promotions'),
  0,
  'T_BOGO_09: customer-category required ⇒ skipped without customer'
) FROM payload;

-- ============================================================
-- T_BOGO_10 — Stacking.
-- ============================================================
UPDATE promotions SET is_active = (slug IN ('test-stack-a','test-stack-b')) WHERE slug LIKE 'test-%';
WITH payload AS (
  SELECT evaluate_promotions_v1(
    jsonb_build_array(jsonb_build_object(
      'line_id','L1','product_id',(SELECT id FROM products WHERE name='Test Croissant 2C'),
      'quantity',2,'unit_price',50000
    )),
    NULL, NULL
  ) AS r
)
SELECT is(
  jsonb_array_length(r -> 'applied_promotions'),
  2,
  'T_BOGO_10: both stackable promotions apply'
) FROM payload;

SELECT * FROM finish();
ROLLBACK;
