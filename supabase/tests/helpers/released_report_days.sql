-- Précondition de lecture des rapports, réservée au propriétaire de la transaction.
-- Ces états synthétiques ne prouvent ni le parcours de comptage ni sa libération.
-- Inclure après BEGIN ; le ROLLBACK enlève comptages, produits et libérations.
CREATE OR REPLACE FUNCTION pg_temp.fixture_released_days(p_start date,p_end date)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fixture$
DECLARE v_day date; v_owner uuid; v_counter uuid; v_count uuid; v_product uuid;
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'fixture_owner_required'; END IF;
 IF p_start IS NULL OR p_end IS NULL OR p_start>p_end OR p_end>current_date THEN
  RAISE EXCEPTION 'fixture_requires_past_or_current_days'; END IF;
 SELECT id INTO STRICT v_owner FROM user_profiles WHERE role_code='SUPER_ADMIN'
  AND is_active AND deleted_at IS NULL AND auth_user_id IS NOT NULL ORDER BY id LIMIT 1;
 SELECT id INTO STRICT v_counter FROM user_profiles WHERE id<>v_owner
  AND role_code<>'SUPER_ADMIN' AND is_active AND deleted_at IS NULL ORDER BY id LIMIT 1;
 FOR v_day IN SELECT generate_series(GREATEST(p_start,(SELECT activated_on FROM business_day_visibility_config WHERE id)),p_end,interval '1 day')::date LOOP
  IF EXISTS(SELECT 1 FROM business_day_releases WHERE day=v_day) THEN CONTINUE; END IF;
  INSERT INTO products(sku,name,category_id,retail_price,cost_price,unit,current_stock)
   VALUES('PGTAP-RELEASE-'||gen_random_uuid(),'Released report fixture',
    (SELECT id FROM categories WHERE deleted_at IS NULL LIMIT 1),0,0,'pcs',0) RETURNING id INTO v_product;
  INSERT INTO inventory_counts(count_number,status,created_by,finalized_by,finalized_at,business_day)
   VALUES(next_count_number(),'finalized',v_counter,v_owner,now(),v_day) RETURNING id INTO v_count;
  INSERT INTO inventory_count_items(count_id,product_id,expected_qty,counted_qty,unit,counted_by)
   VALUES(v_count,v_product,0,0,'pcs',v_counter);
  INSERT INTO business_day_releases(day,count_id,released_by) VALUES(v_day,v_count,v_owner);
 END LOOP;
END $fixture$;
REVOKE ALL ON FUNCTION pg_temp.fixture_released_days(date,date) FROM PUBLIC,anon,authenticated;
