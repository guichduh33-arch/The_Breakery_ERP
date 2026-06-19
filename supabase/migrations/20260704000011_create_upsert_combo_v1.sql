-- 20260704000011_create_upsert_combo_v1.sql
-- Session 47 / Wave A — upsert_combo_v1 (create/update a combo + its choice groups).
-- DEV-S47-A2-01: gates reuse the pre-existing combos.{create,update} perms
-- (seeded S11, MANAGER has both, ADMIN+ all) instead of a new products.combos.write.

CREATE TABLE IF NOT EXISTS combo_upsert_idempotency_keys (
  key              UUID PRIMARY KEY,
  combo_product_id UUID NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE combo_upsert_idempotency_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON combo_upsert_idempotency_keys FROM anon;

CREATE OR REPLACE FUNCTION upsert_combo_v1(p_combo jsonb, p_idempotency_key uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_user          UUID;
  v_profile       UUID;
  v_combo_id      UUID;
  v_sku           TEXT;
  v_existing      UUID;
  v_base          NUMERIC(12,2);
  v_combo_count   INTEGER;
  v_is_create     BOOLEAN;
  v_group         JSONB;
  v_opt           JSONB;
  v_group_id      UUID;
  v_group_type    TEXT;
  v_is_required   BOOLEAN;
  v_min           INTEGER;
  v_max           INTEGER;
  v_opt_count     INTEGER;
  v_default_count INTEGER;
  i               INTEGER;
BEGIN
  v_user := auth.uid();
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001';
  END IF;
  SELECT id INTO v_profile FROM user_profiles
    WHERE auth_user_id = v_user AND deleted_at IS NULL;
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'User profile not found' USING ERRCODE = 'P0001';
  END IF;

  -- Idempotency replay (flavor 2: dedicated keys table).
  IF p_idempotency_key IS NOT NULL THEN
    SELECT combo_product_id INTO v_existing
      FROM combo_upsert_idempotency_keys WHERE key = p_idempotency_key;
    IF v_existing IS NOT NULL THEN
      RETURN jsonb_build_object(
        'combo_product_id', v_existing,
        'sku',              (SELECT sku FROM products WHERE id = v_existing),
        'idempotent_replay', true);
    END IF;
  END IF;

  v_combo_id  := NULLIF(p_combo->>'combo_product_id', '')::uuid;
  v_is_create := v_combo_id IS NULL;

  -- Authority gate: create path needs combos.create, update path combos.update.
  IF v_is_create THEN
    IF NOT has_permission(v_user, 'combos.create') THEN
      RAISE EXCEPTION 'Permission denied: combos.create' USING ERRCODE = 'P0003';
    END IF;
  ELSE
    IF NOT has_permission(v_user, 'combos.update') THEN
      RAISE EXCEPTION 'Permission denied: combos.update' USING ERRCODE = 'P0003';
    END IF;
  END IF;

  IF COALESCE(btrim(p_combo->>'name'), '') = '' THEN
    RAISE EXCEPTION 'Combo name is required' USING ERRCODE = 'P0001';
  END IF;
  IF NULLIF(p_combo->>'category_id', '') IS NULL THEN
    RAISE EXCEPTION 'category_id is required' USING ERRCODE = 'P0001';
  END IF;
  v_base := COALESCE((p_combo->>'base_price')::numeric, 0);
  IF v_base < 0 THEN
    RAISE EXCEPTION 'base_price must be >= 0' USING ERRCODE = 'P0001';
  END IF;

  IF v_is_create THEN
    -- Resolve a unique SKU: caller-supplied (must be free) or auto COMBO-NNN.
    v_sku := NULLIF(p_combo->>'sku', '');
    IF v_sku IS NOT NULL THEN
      IF EXISTS (SELECT 1 FROM products WHERE sku = v_sku) THEN
        RAISE EXCEPTION 'SKU already exists: %', v_sku USING ERRCODE = 'P0001';
      END IF;
    ELSE
      SELECT count(*) INTO v_combo_count FROM products WHERE product_type = 'combo';
      FOR i IN 1..200 LOOP
        v_sku := 'COMBO-' || lpad((v_combo_count + i)::text, 3, '0');
        EXIT WHEN NOT EXISTS (SELECT 1 FROM products WHERE sku = v_sku);
      END LOOP;
    END IF;

    INSERT INTO products (
      sku, name, category_id, retail_price, product_type, description, image_url,
      combo_base_price, combo_display_order, combo_available_from, combo_available_to,
      is_active, visible_on_pos
    ) VALUES (
      v_sku, p_combo->>'name', (p_combo->>'category_id')::uuid, v_base, 'combo',
      NULLIF(p_combo->>'description', ''), NULLIF(p_combo->>'image_url', ''),
      v_base, COALESCE((p_combo->>'display_order')::int, 0),
      NULLIF(p_combo->>'available_from', '')::time, NULLIF(p_combo->>'available_to', '')::time,
      COALESCE((p_combo->>'is_active')::boolean, true),
      COALESCE((p_combo->>'visible_on_pos')::boolean, true)
    ) RETURNING id INTO v_combo_id;
  ELSE
    UPDATE products SET
      name                 = p_combo->>'name',
      category_id          = (p_combo->>'category_id')::uuid,
      retail_price         = v_base,
      combo_base_price     = v_base,
      description          = NULLIF(p_combo->>'description', ''),
      image_url            = NULLIF(p_combo->>'image_url', ''),
      combo_display_order  = COALESCE((p_combo->>'display_order')::int, 0),
      combo_available_from = NULLIF(p_combo->>'available_from', '')::time,
      combo_available_to   = NULLIF(p_combo->>'available_to', '')::time,
      is_active            = COALESCE((p_combo->>'is_active')::boolean, true),
      visible_on_pos       = COALESCE((p_combo->>'visible_on_pos')::boolean, true),
      product_type         = 'combo',
      updated_at           = now()
    WHERE id = v_combo_id AND product_type = 'combo' AND deleted_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Combo not found: %', v_combo_id USING ERRCODE = 'P0002';
    END IF;
    SELECT sku INTO v_sku FROM products WHERE id = v_combo_id;
  END IF;

  -- REPLACE semantics for groups (cascade drops options).
  DELETE FROM combo_groups WHERE combo_product_id = v_combo_id;

  FOR v_group IN SELECT * FROM jsonb_array_elements(COALESCE(p_combo->'groups', '[]'::jsonb)) LOOP
    v_group_type  := v_group->>'group_type';
    IF v_group_type NOT IN ('single', 'multi') THEN
      RAISE EXCEPTION 'Invalid group_type: %', v_group_type USING ERRCODE = 'P0001';
    END IF;
    v_is_required := COALESCE((v_group->>'is_required')::boolean, false);
    v_min := COALESCE((v_group->>'min_select')::int, CASE WHEN v_is_required THEN 1 ELSE 0 END);
    v_max := COALESCE((v_group->>'max_select')::int, 1);
    IF v_group_type = 'single' THEN v_max := 1; END IF;
    IF v_is_required AND v_min < 1 THEN v_min := 1; END IF;
    IF v_min > v_max THEN
      RAISE EXCEPTION 'group "%": min_select > max_select', v_group->>'name' USING ERRCODE = 'P0001';
    END IF;

    v_opt_count := jsonb_array_length(COALESCE(v_group->'options', '[]'::jsonb));
    IF v_opt_count < 1 THEN
      RAISE EXCEPTION 'group "%" needs at least one option', v_group->>'name' USING ERRCODE = 'P0001';
    END IF;
    IF v_min > v_opt_count THEN
      RAISE EXCEPTION 'group "%": min_select exceeds option count', v_group->>'name' USING ERRCODE = 'P0001';
    END IF;

    SELECT count(*) INTO v_default_count
      FROM jsonb_array_elements(v_group->'options') o
      WHERE COALESCE((o->>'is_default')::boolean, false);
    IF v_group_type = 'single' AND v_is_required AND v_default_count <> 1 THEN
      RAISE EXCEPTION 'single required group "%" needs exactly one default option', v_group->>'name'
        USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO combo_groups (
      combo_product_id, name, group_type, is_required, min_select, max_select, sort_order
    ) VALUES (
      v_combo_id, v_group->>'name', v_group_type, v_is_required, v_min, v_max,
      COALESCE((v_group->>'sort_order')::int, 0)
    ) RETURNING id INTO v_group_id;

    FOR v_opt IN SELECT * FROM jsonb_array_elements(v_group->'options') LOOP
      INSERT INTO combo_group_options (
        group_id, component_product_id, surcharge, is_default, sort_order
      ) VALUES (
        v_group_id, (v_opt->>'component_product_id')::uuid,
        COALESCE((v_opt->>'surcharge')::numeric, 0),
        COALESCE((v_opt->>'is_default')::boolean, false),
        COALESCE((v_opt->>'sort_order')::int, 0)
      );
    END LOOP;
  END LOOP;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
    VALUES (v_profile, 'combo.upserted', 'products', v_combo_id, jsonb_build_object(
      'sku', v_sku, 'created', v_is_create, 'rpc_version', 'v1'));

  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO combo_upsert_idempotency_keys (key, combo_product_id)
      VALUES (p_idempotency_key, v_combo_id)
      ON CONFLICT (key) DO NOTHING;
  END IF;

  RETURN jsonb_build_object('combo_product_id', v_combo_id, 'sku', v_sku, 'idempotent_replay', false);
END $function$;
