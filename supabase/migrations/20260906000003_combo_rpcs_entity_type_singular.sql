-- Audit lot 1, P1 sécurité n°4 — suite : les deux RPC combo écrivent elles aussi
-- `entity_type = 'products'` (PLURIEL) dans audit_logs. Valeur canonique arbitrée
-- par Mamat le 2026-09-06 : 'product' au SINGULIER, celle que filtre l'onglet
-- History d'un produit. Les lignes historiques sont reprises par 20260906000005.
--
-- Aucun autre changement de comportement : gates, idempotence et validations sont
-- repris à l'identique du corps live (`pg_get_functiondef`), pas des fichiers
-- d'origine. Seuls bougent la valeur d'`entity_type` et le `rpc_version` tracé.

CREATE OR REPLACE FUNCTION public.upsert_combo_v3(
  p_combo jsonb,
  p_idempotency_key uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
  v_opt_pid       UUID;
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

  -- ADR-012 dec. 1 : un produit-parent est un groupe de variantes, il ne se vend
  -- pas (garde product_is_parent du money-path). Il ne peut donc pas etre une
  -- option de combo. Controle avant toute ecriture : ni produit cree, ni groupes
  -- supprimes si le payload est fautif.
  FOR v_group IN SELECT * FROM jsonb_array_elements(COALESCE(p_combo->'groups', '[]'::jsonb)) LOOP
    FOR v_opt IN SELECT * FROM jsonb_array_elements(COALESCE(v_group->'options', '[]'::jsonb)) LOOP
      v_opt_pid := NULLIF(v_opt->>'component_product_id', '')::uuid;
      IF EXISTS (
        SELECT 1 FROM products c
         WHERE c.parent_product_id = v_opt_pid
           AND c.is_active
           AND c.deleted_at IS NULL
      ) THEN
        RAISE EXCEPTION 'combo_option_is_parent: % est un groupe de variantes - choisissez une variante',
          COALESCE((SELECT name FROM products WHERE id = v_opt_pid), v_opt_pid::text)
          USING ERRCODE = 'check_violation';
      END IF;
    END LOOP;
  END LOOP;

  IF v_is_create THEN
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
      combo_base_price, combo_display_order,
      is_active, visible_on_pos
    ) VALUES (
      v_sku, p_combo->>'name', (p_combo->>'category_id')::uuid, v_base, 'combo',
      NULLIF(p_combo->>'description', ''), NULLIF(p_combo->>'image_url', ''),
      v_base, COALESCE((p_combo->>'display_order')::int, 0),
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
    VALUES (v_profile, 'combo.upserted', 'product', v_combo_id, jsonb_build_object(
      'sku', v_sku, 'created', v_is_create, 'rpc_version', 'v3'));

  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO combo_upsert_idempotency_keys (key, combo_product_id)
      VALUES (p_idempotency_key, v_combo_id)
      ON CONFLICT (key) DO NOTHING;
  END IF;

  RETURN jsonb_build_object('combo_product_id', v_combo_id, 'sku', v_sku, 'idempotent_replay', false);
END $$;

CREATE OR REPLACE FUNCTION public.delete_combo_v2(p_combo_product_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user      UUID;
  v_profile   UUID;
  v_deleted_at TIMESTAMPTZ;
  v_type      TEXT;
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
  IF NOT has_permission(v_user, 'combos.delete') THEN
    RAISE EXCEPTION 'Permission denied: combos.delete' USING ERRCODE = 'P0003';
  END IF;

  SELECT product_type, deleted_at INTO v_type, v_deleted_at
    FROM products WHERE id = p_combo_product_id;
  IF v_type IS NULL THEN
    RAISE EXCEPTION 'Combo not found: %', p_combo_product_id USING ERRCODE = 'P0002';
  END IF;
  IF v_type <> 'combo' THEN
    RAISE EXCEPTION 'Not a combo: %', p_combo_product_id USING ERRCODE = 'P0001';
  END IF;

  IF v_deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object('combo_product_id', p_combo_product_id, 'deleted', false);
  END IF;

  UPDATE products
    SET is_active = false, deleted_at = now(), updated_at = now()
    WHERE id = p_combo_product_id;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
    VALUES (v_profile, 'combo.deleted', 'product', p_combo_product_id,
            jsonb_build_object('rpc_version', 'v2'));

  RETURN jsonb_build_object('combo_product_id', p_combo_product_id, 'deleted', true);
END $$;

REVOKE EXECUTE ON FUNCTION public.upsert_combo_v3(jsonb, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.delete_combo_v2(uuid) FROM PUBLIC, anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.upsert_combo_v3(jsonb, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_combo_v2(uuid) TO authenticated;

DROP FUNCTION IF EXISTS public.upsert_combo_v2(jsonb, uuid);
DROP FUNCTION IF EXISTS public.delete_combo_v1(uuid);
