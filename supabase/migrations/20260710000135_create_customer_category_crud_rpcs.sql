-- 20260710000135_create_customer_category_crud_rpcs.sql
-- S69 Volet A — CRUD RPCs for customer_categories (perms seeded S13, RLS already gated).
-- Closes deviation D-W6-CUSTCAT-01 (page was read-only for lack of write RPCs).

-- CREATE ------------------------------------------------------------------
CREATE FUNCTION create_customer_category_v1(
  p_name text, p_slug text, p_price_modifier_type price_modifier_type,
  p_discount_percentage numeric, p_points_multiplier numeric,
  p_loyalty_enabled boolean, p_color text, p_icon text, p_is_default boolean
) RETURNS customer_categories
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_actor UUID;
  v_row customer_categories;
BEGIN
  IF NOT has_permission(v_uid, 'customer_categories.create') THEN
    RAISE EXCEPTION 'permission_denied: customer_categories.create' USING ERRCODE = 'P0003';
  END IF;
  IF p_slug IS NULL OR btrim(p_slug) = '' THEN
    RAISE EXCEPTION 'slug_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_discount_percentage IS NULL OR p_discount_percentage < 0 OR p_discount_percentage > 100 THEN
    RAISE EXCEPTION 'invalid_discount' USING ERRCODE = 'P0001';
  END IF;
  IF p_points_multiplier IS NULL OR p_points_multiplier < 0 THEN
    RAISE EXCEPTION 'invalid_multiplier' USING ERRCODE = 'P0001';
  END IF;
  IF COALESCE(p_is_default, false) THEN
    UPDATE customer_categories SET is_default = false WHERE is_default AND deleted_at IS NULL;
  END IF;
  BEGIN
    INSERT INTO customer_categories(
      name, slug, price_modifier_type, discount_percentage, points_multiplier,
      loyalty_enabled, color, icon, is_default, is_active
    ) VALUES (
      p_name, p_slug, p_price_modifier_type, p_discount_percentage, p_points_multiplier,
      COALESCE(p_loyalty_enabled, true), p_color, p_icon, COALESCE(p_is_default, false), true
    ) RETURNING * INTO v_row;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'slug_taken' USING ERRCODE = 'P0001';
  END;

  SELECT id INTO v_actor FROM user_profiles WHERE auth_user_id = v_uid AND deleted_at IS NULL LIMIT 1;
  INSERT INTO audit_logs(actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_actor, 'customer_category.created', 'customer_categories', v_row.id,
          jsonb_build_object('slug', v_row.slug, 'modifier', v_row.price_modifier_type));
  RETURN v_row;
END $$;

-- UPDATE ------------------------------------------------------------------
CREATE FUNCTION update_customer_category_v1(
  p_id uuid, p_name text, p_slug text, p_price_modifier_type price_modifier_type,
  p_discount_percentage numeric, p_points_multiplier numeric,
  p_loyalty_enabled boolean, p_color text, p_icon text, p_is_default boolean
) RETURNS customer_categories
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_actor UUID;
  v_was_default boolean;
  v_row customer_categories;
BEGIN
  IF NOT has_permission(v_uid, 'customer_categories.update') THEN
    RAISE EXCEPTION 'permission_denied: customer_categories.update' USING ERRCODE = 'P0003';
  END IF;
  SELECT is_default INTO v_was_default FROM customer_categories WHERE id = p_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'category_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF p_discount_percentage IS NULL OR p_discount_percentage < 0 OR p_discount_percentage > 100 THEN
    RAISE EXCEPTION 'invalid_discount' USING ERRCODE = 'P0001';
  END IF;
  IF p_points_multiplier IS NULL OR p_points_multiplier < 0 THEN
    RAISE EXCEPTION 'invalid_multiplier' USING ERRCODE = 'P0001';
  END IF;
  IF v_was_default AND COALESCE(p_is_default, false) = false THEN
    RAISE EXCEPTION 'default_required' USING ERRCODE = 'P0001';
  END IF;
  IF COALESCE(p_is_default, false) AND NOT v_was_default THEN
    UPDATE customer_categories SET is_default = false WHERE is_default AND deleted_at IS NULL;
  END IF;
  BEGIN
    UPDATE customer_categories SET
      name = p_name, slug = p_slug, price_modifier_type = p_price_modifier_type,
      discount_percentage = p_discount_percentage, points_multiplier = p_points_multiplier,
      loyalty_enabled = COALESCE(p_loyalty_enabled, true), color = p_color, icon = p_icon,
      is_default = COALESCE(p_is_default, false)
    WHERE id = p_id RETURNING * INTO v_row;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'slug_taken' USING ERRCODE = 'P0001';
  END;

  SELECT id INTO v_actor FROM user_profiles WHERE auth_user_id = v_uid AND deleted_at IS NULL LIMIT 1;
  INSERT INTO audit_logs(actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_actor, 'customer_category.updated', 'customer_categories', v_row.id,
          jsonb_build_object('slug', v_row.slug));
  RETURN v_row;
END $$;

-- DELETE (soft) -----------------------------------------------------------
CREATE FUNCTION delete_customer_category_v1(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_actor UUID;
  v_is_default boolean;
  v_deleted timestamptz;
BEGIN
  IF NOT has_permission(v_uid, 'customer_categories.delete') THEN
    RAISE EXCEPTION 'permission_denied: customer_categories.delete' USING ERRCODE = 'P0003';
  END IF;
  SELECT is_default, deleted_at INTO v_is_default, v_deleted FROM customer_categories WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'category_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_deleted IS NOT NULL THEN
    RETURN; -- idempotent
  END IF;
  IF v_is_default THEN
    RAISE EXCEPTION 'cannot_delete_default' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM customers WHERE category_id = p_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'category_in_use' USING ERRCODE = 'P0001';
  END IF;
  UPDATE customer_categories SET deleted_at = now(), is_active = false WHERE id = p_id;

  SELECT id INTO v_actor FROM user_profiles WHERE auth_user_id = v_uid AND deleted_at IS NULL LIMIT 1;
  INSERT INTO audit_logs(actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_actor, 'customer_category.deleted', 'customer_categories', p_id, '{}'::jsonb);
END $$;

-- REVOKE trio (anon inherits EXECUTE via PUBLIC — must revoke PUBLIC too) ---
DO $$
DECLARE fn text;
BEGIN
  FOR fn IN SELECT unnest(ARRAY[
    'create_customer_category_v1(text,text,price_modifier_type,numeric,numeric,boolean,text,text,boolean)',
    'update_customer_category_v1(uuid,text,text,price_modifier_type,numeric,numeric,boolean,text,text,boolean)',
    'delete_customer_category_v1(uuid)'
  ]) LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', fn);
  END LOOP;
END $$;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
