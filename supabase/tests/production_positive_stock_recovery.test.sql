-- Entrée positive sur un produit fini déficitaire, sans forcer les matières.
BEGIN;
\ir helpers/production_candidate.sql
SELECT plan(12);
SELECT set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
CREATE TEMP TABLE _recovery_results(label text, value text) ON COMMIT DROP;
DO $test$
DECLARE
  v_material uuid := gen_random_uuid();
  v_product uuid := gen_random_uuid();
  v_short_product uuid := gen_random_uuid();
  v_category uuid;
  v_section uuid;
  v_key uuid := gen_random_uuid();
  v_result jsonb;
  v_replay jsonb;
  v_before numeric;
  v_blocked boolean := false;
BEGIN
  SELECT id INTO STRICT v_category FROM categories WHERE deleted_at IS NULL LIMIT 1;
  SELECT id INTO STRICT v_section FROM sections WHERE deleted_at IS NULL LIMIT 1;
  INSERT INTO products(id,sku,name,category_id,retail_price,unit,track_inventory,deduct_stock,current_stock,cost_price)
  VALUES
    (v_material,'REC-M-'||v_material,'Recovery ingredient',v_category,0,'kg',true,false,2.685,100),
    (v_product,'REC-P-'||v_product,'Recovery finished',v_category,0,'pcs',true,true,-42,100),
    (v_short_product,'REC-S-'||v_short_product,'Recovery shortage',v_category,0,'pcs',true,true,-42,100);
  INSERT INTO recipes(product_id,material_id,quantity,unit,is_active) VALUES
    (v_product,v_material,0.033,'kg',true),
    (v_short_product,v_material,10,'kg',true);

  -- Le manager a create sans force_negative. Le produit reste négatif après +15.
  v_result := public.record_batch_production_v12(
    jsonb_build_object('section_id',v_section,'idempotency_key',v_key,
      'production_date','2026-11-03T06:30:00+08:00'),
    jsonb_build_array(jsonb_build_object('product_id',v_product,'quantity_produced',15)));
  INSERT INTO _recovery_results VALUES
    ('output',(SELECT current_stock::text FROM products WHERE id=v_product)),
    ('material',(SELECT current_stock::text FROM products WHERE id=v_material)),
    ('forced',COALESCE(v_result->>'forced_negative','false')),
    ('author',(SELECT (staff_id='00000000-0000-0000-0000-000000000004')::text
      FROM production_records WHERE batch_id=(v_result->>'batch_id')::uuid)),
    ('dated',(SELECT (production_date='2026-11-03T06:30:00+08:00'::timestamptz AND created_at=now())::text
      FROM production_records WHERE batch_id=(v_result->>'batch_id')::uuid)),
    ('ledger_in',(SELECT quantity::text FROM stock_movements WHERE product_id=v_product AND movement_type='production_in')),
    ('ledger_out',(SELECT quantity::text FROM stock_movements WHERE product_id=v_material AND movement_type='production_out'));

  v_replay := public.record_batch_production_v12(
    jsonb_build_object('section_id',v_section,'idempotency_key',v_key),
    jsonb_build_array(jsonb_build_object('product_id',v_product,'quantity_produced',15)));
  INSERT INTO _recovery_results VALUES
    ('replay',(v_replay->>'idempotent_replay')),
    ('same_batch',((v_replay->>'batch_id')=(v_result->>'batch_id'))::text),
    ('once',(SELECT count(*)::text FROM stock_movements WHERE product_id=v_product));

  v_before := (SELECT current_stock FROM products WHERE id=v_material);
  BEGIN
    PERFORM public.record_batch_production_v12(
      jsonb_build_object('section_id',v_section,'idempotency_key',gen_random_uuid()),
      jsonb_build_array(jsonb_build_object('product_id',v_short_product,'quantity_produced',1)));
  EXCEPTION WHEN SQLSTATE 'P0002' THEN
    v_blocked := SQLERRM IN ('insufficient_stock','stock_operation_rejected');
  END;
  INSERT INTO _recovery_results VALUES
    ('blocked',v_blocked::text),
    ('atomic',((SELECT current_stock FROM products WHERE id=v_material)=v_before
      AND NOT EXISTS(SELECT 1 FROM production_records WHERE product_id=v_short_product))::text);
END $test$;
SELECT is((SELECT value::numeric FROM _recovery_results WHERE label='output'),-27::numeric,'positive production reduces the finished-goods deficit');
SELECT is((SELECT value::numeric FROM _recovery_results WHERE label='material'),2.190::numeric,'only required ingredients are consumed');
SELECT is((SELECT value FROM _recovery_results WHERE label='forced'),'false','a manager can recover stock without force permission');
SELECT is((SELECT value FROM _recovery_results WHERE label='author'),'true','creator profile is recorded');
SELECT is((SELECT value FROM _recovery_results WHERE label='dated'),'true','production date and creation timestamp stay distinct');
SELECT is((SELECT value::numeric FROM _recovery_results WHERE label='ledger_in'),15::numeric,'finished goods have a positive ledger entry');
SELECT is((SELECT value::numeric FROM _recovery_results WHERE label='ledger_out'),-0.495::numeric,'ingredients retain their negative ledger entry');
SELECT is((SELECT value FROM _recovery_results WHERE label='replay'),'true','retry is idempotent');
SELECT is((SELECT value FROM _recovery_results WHERE label='same_batch'),'true','retry returns the same batch');
SELECT is((SELECT value::int FROM _recovery_results WHERE label='once'),1,'retry never doubles the production');
SELECT is((SELECT value FROM _recovery_results WHERE label='blocked'),'true','ingredient shortage still blocks without force');
SELECT is((SELECT value FROM _recovery_results WHERE label='atomic'),'true','rejected production leaves no partial effects');
SELECT * FROM finish();
ROLLBACK;
