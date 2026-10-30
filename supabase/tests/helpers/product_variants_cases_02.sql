-- ────────────────────────────────────────────────────────────────────────────
-- T14 : CHECK products_variant_xor rejects partial NULL on INSERT.
--       parent_product_id IS NOT NULL but variant_label/axis IS NULL → 23514.
--
--       Note : BEFORE INSERT triggers fire before CHECK constraints. So if
--       we used a variant UUID (like s27c_nest_a) as parent_product_id, the
--       anti-nesting trigger would fire FIRST with P0004 — masking the
--       CHECK we want to assert. We use a fresh standalone product as the
--       referenced parent so the trigger does NOT fire, leaving the CHECK
--       to be the first thing to reject the row.
-- ────────────────────────────────────────────────────────────────────────────

DO $t14_setup$
DECLARE
  v_cat_id  UUID := current_setting('breakery.s27c_cat_id')::UUID;
  v_ref_id  UUID := gen_random_uuid();
BEGIN
  INSERT INTO products (id, name, sku, category_id, unit, retail_price, cost_price, is_active, created_at, updated_at)
  VALUES (v_ref_id, 'PGTAP_S27C_T14_REF', 'PGTAPT14REF', v_cat_id, 'pcs', 1, 1, true, now(), now());
  PERFORM set_config('breakery.s27c_t14_ref', v_ref_id::TEXT, false);
END $t14_setup$;

SELECT throws_ok(
  format(
    $q$INSERT INTO products (id, name, sku, category_id, unit, retail_price, cost_price, is_active, created_at, updated_at, parent_product_id)
         VALUES (gen_random_uuid(), 'BAD', 'PGTAPBAD', %L::UUID, 'pcs', 1, 1, true, now(), now(), %L::UUID)$q$,
    current_setting('breakery.s27c_cat_id'),
    current_setting('breakery.s27c_t14_ref')
  ),
  '23514',
  NULL,
  'T14 CHECK products_variant_xor rejects partial NULL (23514)'
);

-- ────────────────────────────────────────────────────────────────────────────
-- T15 : XOR fix corrective regression — dissolve with soft-deleted siblings
--       must succeed. The previous version of convert_parent_to_standalone_v2
--       NULLed only parent_product_id on soft-deleted siblings, leaving
--       variant_label + variant_axis populated → 23514 violation of the
--       products_variant_xor CHECK aborted the dissolve transaction.
--       Migration 20260524012658_bump_convert_parent_to_standalone_v1_xor_fix
--       NULLs all 3 variant cols + resets sort_order, satisfying the CHECK.
--
--       Flow : fresh standalone → convert_product_to_parent (var1) → add var2
--       → soft-delete var2 → dissolve. Expect : no exception, parent deleted,
--       var2 fully detached AND still soft-deleted (is_active = false).
-- ────────────────────────────────────────────────────────────────────────────

DO $t15_setup$
DECLARE
  v_cat_id   UUID := current_setting('breakery.s27c_cat_id')::UUID;
  v_p_id     UUID := gen_random_uuid();
  v_parent   UUID;
  v_var2     UUID;
  v_returned UUID;
BEGIN
  INSERT INTO products (
    id, name, sku, category_id, unit, retail_price, cost_price,
    visible_on_pos, available_for_sale, track_inventory, deduct_stock,
    is_active, created_at, updated_at
  )
  VALUES (
    v_p_id, 'PGTAP_S27C_XORFIX', 'PGTAPXORFIX', v_cat_id, 'pcs',
    100, 50, true, true, true, true, true, now(), now()
  );

  v_parent := convert_product_to_parent_v2(v_p_id, 'V1', 'flavor'::variant_axis_type);
  v_var2   := create_variant_v2(v_parent, 'V2', 'PGTAPXORFIX-V2', 120);
  PERFORM delete_variant_v2(v_var2);  -- soft-delete V2 → is_active=false

  -- The dissolve : pre-fix this would raise 23514 on the orphan-sibling UPDATE.
  v_returned := convert_parent_to_standalone_v2(v_parent);

  PERFORM set_config('breakery.s27c_xorfix_parent', v_parent::TEXT, false);
  PERFORM set_config('breakery.s27c_xorfix_var2',   v_var2::TEXT,   false);
  PERFORM set_config('breakery.s27c_xorfix_p_id',   v_p_id::TEXT,   false);
END $t15_setup$;

SELECT ok(
  NOT EXISTS (SELECT 1 FROM products WHERE id = current_setting('breakery.s27c_xorfix_parent')::UUID),
  'T15 dissolve with soft-deleted siblings succeeds — parent hard-deleted'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM products
     WHERE id = current_setting('breakery.s27c_xorfix_var2')::UUID
       AND parent_product_id IS NULL
       AND variant_label IS NULL
       AND variant_axis IS NULL
       AND variant_sort_order = 0
       AND is_active = false
  ),
  'T15b ex-soft-deleted sibling fully detached (all 3 variant cols NULL, sort_order=0, still soft-deleted)'
);

SELECT * FROM finish();
