-- Le remplacement des modificateurs publie un signal catalogue, sans écrire le stock produit.
BEGIN;
\ir helpers/pin_session.sql
SELECT plan(10);
DO $$
DECLARE v_auth uuid; v_category uuid; v_product uuid;
BEGIN
  SELECT auth_user_id INTO STRICT v_auth FROM public.user_profiles
  WHERE is_active AND deleted_at IS NULL AND public.has_permission(auth_user_id,'products.modifiers.update')
  ORDER BY employee_code LIMIT 1;
  PERFORM pg_temp.authenticate_pin(v_auth);
  INSERT INTO public.categories(name,slug) VALUES ('Modifier freshness fixture','modifier-freshness-' || gen_random_uuid())
    RETURNING id INTO v_category;
  INSERT INTO public.products(name,sku,category_id,retail_price,current_stock)
    VALUES ('Modifier freshness fixture','MOD-FRESH-' || gen_random_uuid(),v_category,10000,7)
    RETURNING id INTO v_product;
  PERFORM set_config('cm.product',v_product::text,true);
  PERFORM set_config('cm.before',(SELECT revision::text FROM public.ui_invalidation_topics WHERE topic='catalog'),true);
END $$;
SELECT ok(to_regprocedure('public.upsert_product_modifiers_v2(uuid,jsonb)') IS NULL,'old modifiers signature removed');
SELECT ok(NOT has_function_privilege('anon','public.upsert_product_modifiers_v3(uuid,jsonb)','EXECUTE'),
  'anon cannot call the modifiers writer');
SELECT throws_ok($q$ SELECT public.upsert_product_modifiers_v3(gen_random_uuid(),'[]') $q$,
  'P0002','product_not_found','missing product still fails before mutation');
SELECT is((SELECT revision::text FROM public.ui_invalidation_topics WHERE topic='catalog'),current_setting('cm.before'),
  'failed replacement emits no catalog signal');
SELECT public.upsert_product_modifiers_v3(current_setting('cm.product')::uuid,
  '[{"group_name":"Milk","group_sort_order":0,"group_required":true,"group_type":"single_select","options":[{"option_label":"Oat","option_sort_order":0,"price_adjustment":2000,"is_default":false}]}]');
SELECT isnt((SELECT revision::text FROM public.ui_invalidation_topics WHERE topic='catalog'),current_setting('cm.before'),
  'saving modifiers changes the catalog signal');
SELECT is((SELECT price_adjustment FROM public.product_modifiers WHERE product_id=current_setting('cm.product')::uuid
  AND deleted_at IS NULL),2000::numeric,'modifier payload is saved without changing its contract');
SELECT is((SELECT current_stock FROM public.products WHERE id=current_setting('cm.product')::uuid),7::numeric,
  'saving modifiers does not update the product stock');
SELECT is((SELECT count(*)::integer FROM public.audit_logs WHERE action='product.modifiers'
  AND entity_id=current_setting('cm.product')::uuid AND actor_id=(SELECT id FROM public.user_profiles WHERE auth_user_id=auth.uid())),
  1,'audit uses the real profile actor');
SELECT set_config('cm.before',(SELECT revision::text FROM public.ui_invalidation_topics WHERE topic='catalog'),true);
SELECT public.upsert_product_modifiers_v3(current_setting('cm.product')::uuid,'[]');
SELECT isnt((SELECT revision::text FROM public.ui_invalidation_topics WHERE topic='catalog'),current_setting('cm.before'),
  'removing all groups also changes the catalog signal');
SELECT is((SELECT count(*)::integer FROM public.product_modifiers WHERE product_id=current_setting('cm.product')::uuid
  AND deleted_at IS NULL),0,'removal preserves REPLACE semantics');
SELECT * FROM finish();
ROLLBACK;
