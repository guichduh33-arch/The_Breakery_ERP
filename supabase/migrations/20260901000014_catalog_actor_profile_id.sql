-- 20260901000014_catalog_actor_profile_id.sql
--
-- Lot « actor_id transverse », volet catalogue — 20 RPC (produits, catégories,
-- variantes, sections, unités, modificateurs, drapeau test). Contexte et contrat
-- du helper : 20260901000013_current_profile_id_helper.sql.
--
-- Chacune de ces RPC posait sa variable auth.uid() (v_caller_id / v_user_id) dans
-- audit_logs.actor_id, dont la FK cible user_profiles(id). Pour tout compte créé par
-- le back-office (id <> auth_user_id), la création d'un produit, d'une catégorie,
-- d'une variante, d'une section, la mise à jour des unités ou des modificateurs
-- échouait en 23503 — le catalogue n'était vivant que pour les comptes seed.
-- Preuve du rouge sur le corps live de create_category_v1 (sonde en transaction
-- annulée, profil id <> auth_user_id, 2026-09-06) : « insert or update on table
-- "audit_logs" violates foreign key constraint "audit_logs_actor_id_fkey" ».
--
-- Transformation, identique pour les 20 corps :
--   · DECLARE : v_actor_profile UUID := _current_profile_id();
--   · la valeur posée dans audit_logs.actor_id devient v_actor_profile ;
--   · la variable auth.uid() est conservée pour has_permission(…), qui attend l'auth id ;
--   · les noms de version cités dans les messages d'erreur suivent le bump
--     (« use convert_parent_to_standalone_v2 instead »).
-- Rien d'autre ne bouge dans les corps.
--
-- Versioning monotone : _vN+1 créée, _vN droppée dans ce fichier, signatures
-- inchangées. PROVENANCE DES CORPS : pg_get_functiondef sur la base live, relevé
-- le 2026-09-06 ; le garde ci-dessous refuse la migration si un corps a dérivé —
-- retransformer depuis le live, jamais forcer.
--
-- Grants : miroir des grants live (authenticated + service_role) + REVOKE PUBLIC/anon
-- (anon hérite EXECUTE via PUBLIC). Types à régénérer (packages/supabase/src/types.generated.ts).

DO $$
DECLARE
  v_expected CONSTANT jsonb := jsonb_build_object(
    'create_product_v2',               'd822a618bd759d9bc9417fd9eb9d455c',
    'update_product_v2',               '39f4e2e6378bf206efb97042cfd844be',
    'delete_product_v1',               '75bb3db0885c151e4d27ade24cda3164',
    'create_category_v1',              'e2ecd076962ed9c417f2a2bed4e09363',
    'update_category_v1',              'bb2af6ecdfdfc06bba49f4c08860c932',
    'delete_category_v1',              '00f6385bc3a0e6d2dc50ee6a15d0d7d3',
    'reorder_categories_v1',           '72e996b37557e05f68d6c9adc54c5197',
    'set_product_is_test_v1',          'f0a83405431415882098909f90859f1d',
    'set_product_base_unit_v1',        '901280174682bec376458f4650df6515',
    'set_product_sections_v1',         'c065b8047e56b6274a7eb445a5787989',
    'set_product_units_v1',            '5447b0da269b4b00165bab11f2963f8f',
    'upsert_product_modifiers_v1',     '7e90b7a779297c70daa7611db4b76690',
    'create_variant_v1',               '1b7c7f63c9f9c402cac4ffb952af614f',
    'update_variant_v1',               'af0f0585054f5cf1dbf00733ae99babd',
    'delete_variant_v1',               '57667269845250f8881becebac98daaa',
    'reorder_variants_v1',             '127fd0a542f37e30dafd5855ba5c140e',
    'convert_product_to_parent_v1',    '1e4e4057ba0cf41e3a6e200830f85f85',
    'convert_parent_to_standalone_v1', '7605c141d11b61e6d7a1aa8c0118bd2c',
    'upsert_section_v1',               '0c5ec2b3bd6e74b414e6a175348e8928',
    'delete_section_v1',               'cfc79b03f8cb6aae5affa3b6d6964e25'
  );
  v_name TEXT;
  v_md5  TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public' AND p.proname = '_current_profile_id') THEN
    RAISE EXCEPTION '_current_profile_id absent — appliquer 20260901000013 d''abord';
  END IF;
  FOR v_name IN SELECT jsonb_object_keys(v_expected) LOOP
    SELECT md5(regexp_replace(pg_get_functiondef(p.oid), '\s', '', 'g')) INTO v_md5
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = v_name;
    IF v_md5 IS DISTINCT FROM (v_expected ->> v_name) THEN
      RAISE EXCEPTION 'corps live de % inattendu (md5 %) — il a dérivé depuis le relevé du 2026-09-06, retransformer depuis pg_get_functiondef', v_name, v_md5;
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- create_product_v2 -> v3
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_product_v3(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor_profile UUID := _current_profile_id();  -- audit_logs.actor_id = user_profiles.id, jamais auth.uid()
  v_caller_id CONSTANT UUID := auth.uid();
  -- Lot 6b : 'tax_inclusive' retiré (flag produit déprécié — le mode fiscal
  -- est global, business_config.tax_inclusive ; la colonne garde son DEFAULT).
  v_allowed   CONSTANT TEXT[] := ARRAY[
    'name','sku','category_id','description',
    'retail_price','wholesale_price','cost_price',
    'image_url',
    'is_active','is_favorite','is_semi_finished',
    'visible_on_pos','available_for_sale','track_inventory','deduct_stock',
    'is_display_item','dispatch_stations',
    'min_stock_threshold','target_gross_margin_pct','default_shelf_life_hours',
    'product_type','unit'
  ];
  v_key TEXT; v_ignored TEXT[] := ARRAY[]::TEXT[];
  v_name TEXT; v_sku TEXT; v_category_id UUID; v_retail NUMERIC; v_unit TEXT; v_id UUID; v_row products%ROWTYPE;
BEGIN
  IF NOT has_permission(v_caller_id, 'products.create') THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
  END IF;
  FOR v_key IN SELECT jsonb_object_keys(p_payload) LOOP
    IF NOT (v_key = ANY (v_allowed)) THEN v_ignored := array_append(v_ignored, v_key); END IF;
  END LOOP;
  v_name := NULLIF(trim(p_payload->>'name'), '');
  v_sku  := NULLIF(trim(p_payload->>'sku'), '');
  v_category_id := NULLIF(p_payload->>'category_id', '')::UUID;
  v_retail := COALESCE((p_payload->>'retail_price')::NUMERIC, 0);
  v_unit := COALESCE(NULLIF(trim(p_payload->>'unit'), ''), 'pcs');
  IF v_name IS NULL OR v_sku IS NULL OR v_category_id IS NULL THEN
    RAISE EXCEPTION 'missing_required_fields' USING ERRCODE='22023', HINT='name, sku and category_id are required';
  END IF;
  IF v_retail < 0 THEN
    RAISE EXCEPTION 'invalid_retail_price' USING ERRCODE='22023', HINT='retail_price must be >= 0';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM categories WHERE id = v_category_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'category_not_found' USING ERRCODE='P0002';
  END IF;
  IF EXISTS (SELECT 1 FROM products WHERE sku = v_sku AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'sku_taken' USING ERRCODE='23505', HINT=format('A product with sku=%s already exists', v_sku);
  END IF;
  INSERT INTO products (
    sku, name, category_id, description,
    retail_price, wholesale_price, cost_price,
    image_url,
    is_active, is_favorite, is_semi_finished,
    visible_on_pos, available_for_sale, track_inventory, deduct_stock,
    is_display_item, dispatch_stations,
    min_stock_threshold, target_gross_margin_pct, default_shelf_life_hours,
    product_type, unit
  ) VALUES (
    v_sku, v_name, v_category_id, p_payload->>'description',
    v_retail, NULLIF(p_payload->>'wholesale_price','')::NUMERIC, COALESCE((p_payload->>'cost_price')::NUMERIC, 0),
    p_payload->>'image_url',
    COALESCE((p_payload->>'is_active')::BOOLEAN, true), COALESCE((p_payload->>'is_favorite')::BOOLEAN, false),
    COALESCE((p_payload->>'is_semi_finished')::BOOLEAN, false),
    COALESCE((p_payload->>'visible_on_pos')::BOOLEAN, true), COALESCE((p_payload->>'available_for_sale')::BOOLEAN, true),
    COALESCE((p_payload->>'track_inventory')::BOOLEAN, true), COALESCE((p_payload->>'deduct_stock')::BOOLEAN, true),
    COALESCE((p_payload->>'is_display_item')::BOOLEAN, false),
    CASE WHEN jsonb_typeof(p_payload->'dispatch_stations') = 'array'
         THEN ARRAY(SELECT jsonb_array_elements_text(p_payload->'dispatch_stations'))
         ELSE NULL END,
    COALESCE((p_payload->>'min_stock_threshold')::NUMERIC, 0),
    NULLIF(p_payload->>'target_gross_margin_pct','')::NUMERIC, NULLIF(p_payload->>'default_shelf_life_hours','')::INTEGER,
    COALESCE(NULLIF(p_payload->>'product_type',''), 'finished'), v_unit
  ) RETURNING * INTO v_row;
  v_id := v_row.id;
  INSERT INTO product_unit_contexts (product_id, stock_opname_unit, recipe_unit, purchase_unit, sales_unit)
    VALUES (v_id, v_unit, v_unit, v_unit, v_unit) ON CONFLICT (product_id) DO NOTHING;
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, payload, metadata)
    VALUES (v_actor_profile, 'product.create', 'product', v_id, p_payload, jsonb_build_object('ignored_fields', v_ignored));
  RETURN jsonb_build_object('product', to_jsonb(v_row), 'ignored_fields', to_jsonb(v_ignored));
END $function$;

REVOKE ALL ON FUNCTION public.create_product_v3(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_product_v3(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_product_v3(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_product_v3(jsonb) TO service_role;
COMMENT ON FUNCTION public.create_product_v3(jsonb) IS
  'Lot 6b — création produit (allowlist 21 cols + product_unit_contexts seed). v2 : tax_inclusive retiré de l''allowlist. v3 (2026-09-06) : audit_logs.actor_id = user_profiles.id via _current_profile_id() (v2 écrivait auth.uid(), 23503 pour tout compte créé par le back-office).';

-- ---------------------------------------------------------------------------
-- update_product_v2 -> v3
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_product_v3(p_product_id uuid, p_patch jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor_profile UUID := _current_profile_id();  -- audit_logs.actor_id = user_profiles.id, jamais auth.uid()
  v_caller_id      UUID := auth.uid();
  -- Lot 6b : 'tax_inclusive' retiré (flag produit déprécié — le mode fiscal
  -- est global, business_config.tax_inclusive ; patch renvoyé en ignored_fields).
  v_allowed_fields CONSTANT TEXT[] := ARRAY[
    'name', 'sku', 'category_id', 'description',
    'retail_price', 'wholesale_price', 'image_url',
    'is_active', 'is_favorite', 'is_semi_finished',
    'visible_on_pos', 'available_for_sale', 'track_inventory', 'deduct_stock',
    'is_display_item', 'dispatch_stations',
    'min_stock_threshold', 'target_gross_margin_pct', 'default_shelf_life_hours'
  ];
  v_key TEXT; v_ignored_fields TEXT[] := ARRAY[]::TEXT[]; v_product products%ROWTYPE;
BEGIN
  IF NOT has_permission(v_caller_id, 'products.update') THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM products WHERE id = p_product_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'product_not_found' USING ERRCODE = 'P0002';
  END IF;
  FOR v_key IN SELECT jsonb_object_keys(p_patch) LOOP
    IF NOT (v_key = ANY (v_allowed_fields)) THEN v_ignored_fields := array_append(v_ignored_fields, v_key); END IF;
  END LOOP;
  UPDATE products SET
    name = COALESCE((p_patch->>'name')::TEXT, name),
    sku = COALESCE((p_patch->>'sku')::TEXT, sku),
    category_id = COALESCE((p_patch->>'category_id')::UUID, category_id),
    description = COALESCE((p_patch->>'description')::TEXT, description),
    retail_price = COALESCE((p_patch->>'retail_price')::NUMERIC, retail_price),
    wholesale_price = COALESCE((p_patch->>'wholesale_price')::NUMERIC, wholesale_price),
    image_url = COALESCE((p_patch->>'image_url')::TEXT, image_url),
    is_active = COALESCE((p_patch->>'is_active')::BOOLEAN, is_active),
    is_favorite = COALESCE((p_patch->>'is_favorite')::BOOLEAN, is_favorite),
    is_semi_finished = COALESCE((p_patch->>'is_semi_finished')::BOOLEAN, is_semi_finished),
    visible_on_pos = COALESCE((p_patch->>'visible_on_pos')::BOOLEAN, visible_on_pos),
    available_for_sale = COALESCE((p_patch->>'available_for_sale')::BOOLEAN, available_for_sale),
    track_inventory = COALESCE((p_patch->>'track_inventory')::BOOLEAN, track_inventory),
    deduct_stock = COALESCE((p_patch->>'deduct_stock')::BOOLEAN, deduct_stock),
    is_display_item = COALESCE((p_patch->>'is_display_item')::BOOLEAN, is_display_item),
    -- Override multi-station : clé présente => pose (array) ou efface (null) ; absente => inchangé.
    dispatch_stations = CASE
      WHEN p_patch ? 'dispatch_stations'
      THEN (CASE WHEN jsonb_typeof(p_patch->'dispatch_stations') = 'array'
                 THEN ARRAY(SELECT jsonb_array_elements_text(p_patch->'dispatch_stations'))
                 ELSE NULL END)
      ELSE dispatch_stations END,
    min_stock_threshold = COALESCE((p_patch->>'min_stock_threshold')::NUMERIC, min_stock_threshold),
    target_gross_margin_pct = COALESCE((p_patch->>'target_gross_margin_pct')::NUMERIC, target_gross_margin_pct),
    default_shelf_life_hours = COALESCE((p_patch->>'default_shelf_life_hours')::INTEGER, default_shelf_life_hours),
    updated_at = now()
  WHERE id = p_product_id RETURNING * INTO v_product;
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, payload, metadata)
    VALUES (v_actor_profile, 'product.update', 'product', p_product_id, p_patch, jsonb_build_object('ignored_fields', v_ignored_fields));
  RETURN jsonb_build_object('product', to_jsonb(v_product), 'ignored_fields', to_jsonb(v_ignored_fields));
END $function$;

REVOKE ALL ON FUNCTION public.update_product_v3(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_product_v3(uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_product_v3(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_product_v3(uuid, jsonb) TO service_role;
COMMENT ON FUNCTION public.update_product_v3(uuid, jsonb) IS
  'Lot 6b — patch produit (allowlist 18 cols, ignored_fields renvoyés). v2 : tax_inclusive retiré de l''allowlist. v3 (2026-09-06) : audit_logs.actor_id = user_profiles.id via _current_profile_id() (v2 écrivait auth.uid()).';

-- ---------------------------------------------------------------------------
-- delete_product_v1 -> v2
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_product_v2(p_product_id uuid, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor_profile UUID := _current_profile_id();  -- audit_logs.actor_id = user_profiles.id, jamais auth.uid()
  v_caller_id      UUID := auth.uid();
  v_product        products%ROWTYPE;
  v_active_variants INT;
BEGIN
  -- Auth-first: check permission before any data access
  IF NOT public.has_permission(v_caller_id, 'products.delete') THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
  END IF;

  -- Load the product row regardless of deleted_at/is_active so that:
  --   • a replay on an already-deleted product finds the row and returns idempotent_replay
  --   • a true 404 (id never existed) still raises P0002
  SELECT * INTO v_product FROM products WHERE id = p_product_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'product_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- Idempotency: keyed on deleted_at, NOT is_active.
  -- A deactivated (is_active=false) but not yet deleted (deleted_at NULL) product
  -- must still proceed to set deleted_at, so we only replay if deleted_at is already set.
  IF v_product.deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'product_id',        p_product_id,
      'deleted',           true,
      'idempotent_replay', true
    );
  END IF;

  -- D2 guard: refuse to delete a parent that still has active child variants.
  -- Caller must delete/deactivate all children first, or dissolve the parent
  -- via convert_parent_to_standalone_v2.
  SELECT COUNT(*) INTO v_active_variants
    FROM products
   WHERE parent_product_id = p_product_id
     AND is_active         = true
     AND deleted_at        IS NULL;

  IF v_active_variants > 0 THEN
    RAISE EXCEPTION 'parent_has_active_variants'
      USING ERRCODE = 'P0001',
            DETAIL  = jsonb_build_object('active_variant_count', v_active_variants)::TEXT;
  END IF;

  -- Remove from catalog: set both flags so every filter path sees the product gone.
  --   is_active = false   → excluded from POS product grid + BO Inactive badge (was correct)
  --   deleted_at = now()  → excluded by useProducts .is('deleted_at', null) catalog filter
  UPDATE products
     SET is_active  = false,
         deleted_at = now(),
         updated_at = now()
   WHERE id = p_product_id;

  -- Audit (canonical cols: actor_id / action / entity_type / entity_id / metadata)
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    v_actor_profile,
    'product.deleted',
    'product',
    p_product_id,
    jsonb_build_object(
      'sku',             v_product.sku,
      'name',            v_product.name,
      'idempotency_key', p_idempotency_key
    )
  );

  RETURN jsonb_build_object(
    'product_id',        p_product_id,
    'deleted',           true,
    'idempotent_replay', false
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.delete_product_v2(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_product_v2(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.delete_product_v2(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_product_v2(uuid, uuid) TO service_role;
COMMENT ON FUNCTION public.delete_product_v2(uuid, uuid) IS
  'Soft-delete d''un produit (is_active=false + deleted_at=now()), replay sur deleted_at. Guards : product_not_found (P0002), parent_has_active_variants (P0001). Porte products.delete. Audit product.deleted. v2 (2026-09-06) : audit_logs.actor_id = user_profiles.id via _current_profile_id() (v1 écrivait auth.uid()).';

-- ---------------------------------------------------------------------------
-- create_category_v1 -> v2
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_category_v2(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor_profile UUID := _current_profile_id();  -- audit_logs.actor_id = user_profiles.id, jamais auth.uid()
  v_caller_id UUID := auth.uid();
  v_name      TEXT;
  v_slug      TEXT;
  v_sort      INTEGER;
  v_type      TEXT;
  v_row       categories%ROWTYPE;
BEGIN
  IF NOT has_permission(v_caller_id, 'categories.create') THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
  END IF;

  v_name := NULLIF(trim(p_payload->>'name'), '');
  v_slug := NULLIF(trim(lower(p_payload->>'slug')), '');
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'missing_required_fields'
      USING ERRCODE = '22023', HINT = 'name is required';
  END IF;

  IF v_slug IS NULL THEN
    v_slug := regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g');
    v_slug := regexp_replace(v_slug, '^-|-$', '', 'g');
  END IF;

  IF EXISTS (SELECT 1 FROM categories WHERE slug = v_slug AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'slug_taken'
      USING ERRCODE = '23505', HINT = format('A category with slug=%s already exists', v_slug);
  END IF;

  v_type := COALESCE(NULLIF(p_payload->>'category_type',''), 'finished');
  IF v_type NOT IN ('raw_material','semi_finished','finished') THEN
    RAISE EXCEPTION 'invalid_category_type'
      USING ERRCODE = '22023', HINT = 'category_type must be raw_material|semi_finished|finished';
  END IF;

  v_sort := COALESCE(
    (p_payload->>'sort_order')::INTEGER,
    (SELECT COALESCE(MAX(sort_order), 0) + 10 FROM categories WHERE deleted_at IS NULL)
  );

  INSERT INTO categories (name, slug, sort_order, is_active, dispatch_station, kds_station, show_in_pos, category_type)
  VALUES (
    v_name,
    v_slug,
    v_sort,
    COALESCE((p_payload->>'is_active')::BOOLEAN, true),
    COALESCE(NULLIF(p_payload->>'dispatch_station',''), 'none'),
    COALESCE(NULLIF(p_payload->>'kds_station',''), 'expo'),
    COALESCE((p_payload->>'show_in_pos')::BOOLEAN, true),
    v_type
  ) RETURNING * INTO v_row;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_actor_profile, 'category.create', 'category', v_row.id, p_payload);

  RETURN to_jsonb(v_row);
END;
$function$;

REVOKE ALL ON FUNCTION public.create_category_v2(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_category_v2(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_category_v2(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_category_v2(jsonb) TO service_role;
COMMENT ON FUNCTION public.create_category_v2(jsonb) IS
  'Création de catégorie (auto-slug, sort_order en fin, show_in_pos/category_type). Porte categories.create. v2 (2026-09-06) : audit_logs.actor_id = user_profiles.id via _current_profile_id() (v1 écrivait auth.uid()).';

-- ---------------------------------------------------------------------------
-- update_category_v1 -> v2
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_category_v2(p_category_id uuid, p_patch jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor_profile UUID := _current_profile_id();  -- audit_logs.actor_id = user_profiles.id, jamais auth.uid()
  v_caller_id UUID := auth.uid();
  v_allowed   CONSTANT TEXT[] := ARRAY[
    'name','slug','sort_order','is_active','dispatch_station','kds_station','show_in_pos','category_type'
  ];
  v_key       TEXT;
  v_ignored   TEXT[] := ARRAY[]::TEXT[];
  v_new_slug  TEXT;
  v_new_type  TEXT;
  v_row       categories%ROWTYPE;
BEGIN
  IF NOT has_permission(v_caller_id, 'categories.update') THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM categories WHERE id = p_category_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'category_not_found' USING ERRCODE = 'P0002';
  END IF;

  FOR v_key IN SELECT jsonb_object_keys(p_patch)
  LOOP
    IF NOT (v_key = ANY (v_allowed)) THEN
      v_ignored := array_append(v_ignored, v_key);
    END IF;
  END LOOP;

  v_new_slug := NULLIF(trim(lower(p_patch->>'slug')), '');
  IF v_new_slug IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM categories
        WHERE slug = v_new_slug AND id <> p_category_id AND deleted_at IS NULL
     ) THEN
    RAISE EXCEPTION 'slug_taken'
      USING ERRCODE = '23505', HINT = format('A category with slug=%s already exists', v_new_slug);
  END IF;

  v_new_type := NULLIF(p_patch->>'category_type','');
  IF v_new_type IS NOT NULL AND v_new_type NOT IN ('raw_material','semi_finished','finished') THEN
    RAISE EXCEPTION 'invalid_category_type'
      USING ERRCODE = '22023', HINT = 'category_type must be raw_material|semi_finished|finished';
  END IF;

  UPDATE categories SET
    name             = COALESCE((p_patch->>'name')::TEXT, name),
    slug             = COALESCE(v_new_slug, slug),
    sort_order       = COALESCE((p_patch->>'sort_order')::INTEGER, sort_order),
    is_active        = COALESCE((p_patch->>'is_active')::BOOLEAN, is_active),
    dispatch_station = COALESCE((p_patch->>'dispatch_station')::TEXT, dispatch_station),
    kds_station      = COALESCE((p_patch->>'kds_station')::TEXT, kds_station),
    show_in_pos      = COALESCE((p_patch->>'show_in_pos')::BOOLEAN, show_in_pos),
    category_type    = COALESCE(v_new_type, category_type),
    updated_at       = now()
  WHERE id = p_category_id
  RETURNING * INTO v_row;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, payload, metadata)
  VALUES (v_actor_profile, 'category.update', 'category', p_category_id, p_patch,
          jsonb_build_object('ignored_fields', v_ignored));

  RETURN jsonb_build_object(
    'category',       to_jsonb(v_row),
    'ignored_fields', to_jsonb(v_ignored)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.update_category_v2(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_category_v2(uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_category_v2(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_category_v2(uuid, jsonb) TO service_role;
COMMENT ON FUNCTION public.update_category_v2(uuid, jsonb) IS
  'Patch de catégorie (allowlist 8 cols, ignored_fields renvoyés). Porte categories.update. v2 (2026-09-06) : audit_logs.actor_id = user_profiles.id via _current_profile_id() (v1 écrivait auth.uid()).';

-- ---------------------------------------------------------------------------
-- delete_category_v1 -> v2
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_category_v2(p_category_id uuid, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor_profile UUID := _current_profile_id();  -- audit_logs.actor_id = user_profiles.id, jamais auth.uid()
  v_caller_id     UUID := auth.uid();
  v_category      categories%ROWTYPE;
  v_product_count INT;
BEGIN
  -- Auth-first
  IF NOT public.has_permission(v_caller_id, 'categories.delete') THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
  END IF;

  -- Load regardless of deleted_at so replay finds the row and a true 404 still raises.
  SELECT * INTO v_category FROM categories WHERE id = p_category_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'category_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- Idempotent replay: already soft-deleted.
  IF v_category.deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object('category_id', p_category_id, 'deleted', true, 'idempotent_replay', true);
  END IF;

  -- Guard: refuse to delete a category still holding products (would orphan them).
  SELECT COUNT(*) INTO v_product_count
    FROM products
   WHERE category_id = p_category_id
     AND deleted_at  IS NULL;

  IF v_product_count > 0 THEN
    RAISE EXCEPTION 'category_has_products'
      USING ERRCODE = 'P0001',
            DETAIL  = jsonb_build_object('product_count', v_product_count)::TEXT;
  END IF;

  UPDATE categories
     SET is_active  = false,
         deleted_at = now(),
         updated_at = now()
   WHERE id = p_category_id;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    v_actor_profile, 'category.deleted', 'category', p_category_id,
    jsonb_build_object('name', v_category.name, 'slug', v_category.slug, 'idempotency_key', p_idempotency_key)
  );

  RETURN jsonb_build_object('category_id', p_category_id, 'deleted', true, 'idempotent_replay', false);
END;
$function$;

REVOKE ALL ON FUNCTION public.delete_category_v2(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_category_v2(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.delete_category_v2(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_category_v2(uuid, uuid) TO service_role;
COMMENT ON FUNCTION public.delete_category_v2(uuid, uuid) IS
  'Soft-delete d''une catégorie (is_active=false + deleted_at=now()), replay sur deleted_at. Guards : category_not_found (P0002), category_has_products (P0001). Porte categories.delete. Audit category.deleted. v2 (2026-09-06) : audit_logs.actor_id = user_profiles.id via _current_profile_id() (v1 écrivait auth.uid()).';

-- ---------------------------------------------------------------------------
-- reorder_categories_v1 -> v2
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reorder_categories_v2(p_ordered_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor_profile UUID := _current_profile_id();  -- audit_logs.actor_id = user_profiles.id, jamais auth.uid()
  v_caller_id UUID := auth.uid();
  v_count_in  INTEGER;
  v_count_db  INTEGER;
  v_id        UUID;
  v_pos       INTEGER := 10;
BEGIN
  IF NOT has_permission(v_caller_id, 'categories.update') THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
  END IF;

  v_count_in := COALESCE(array_length(p_ordered_ids, 1), 0);
  IF v_count_in = 0 THEN
    RAISE EXCEPTION 'empty_input'
      USING ERRCODE = '22023', HINT = 'p_ordered_ids must contain at least one id';
  END IF;

  IF v_count_in <> (SELECT count(DISTINCT x) FROM unnest(p_ordered_ids) AS x) THEN
    RAISE EXCEPTION 'duplicate_ids'
      USING ERRCODE = '22023', HINT = 'p_ordered_ids must not contain duplicates';
  END IF;

  SELECT count(*) INTO v_count_db FROM categories WHERE deleted_at IS NULL;
  IF v_count_in <> v_count_db
     OR EXISTS (
       SELECT 1 FROM unnest(p_ordered_ids) AS input_id
        LEFT JOIN categories c ON c.id = input_id AND c.deleted_at IS NULL
        WHERE c.id IS NULL
     ) THEN
    RAISE EXCEPTION 'incomplete_ordered_ids'
      USING ERRCODE = '22023',
            HINT = 'p_ordered_ids must list every live category exactly once';
  END IF;

  FOREACH v_id IN ARRAY p_ordered_ids LOOP
    UPDATE categories SET sort_order = v_pos, updated_at = now()
     WHERE id = v_id;
    v_pos := v_pos + 10;
  END LOOP;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_actor_profile, 'category.reorder', 'category', NULL,
          jsonb_build_object('ordered_ids', p_ordered_ids));

  RETURN jsonb_build_object(
    'count',       v_count_in,
    'ordered_ids', to_jsonb(p_ordered_ids)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.reorder_categories_v2(uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reorder_categories_v2(uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.reorder_categories_v2(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reorder_categories_v2(uuid[]) TO service_role;
COMMENT ON FUNCTION public.reorder_categories_v2(uuid[]) IS
  'Réordonne les catégories (sort_order 10, 20, … dans l''ordre donné), couverture complète exigée. Porte categories.update. v2 (2026-09-06) : audit_logs.actor_id = user_profiles.id via _current_profile_id() (v1 écrivait auth.uid()).';

-- ---------------------------------------------------------------------------
-- set_product_is_test_v1 -> v2
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_product_is_test_v2(p_product_id uuid, p_is_test boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor_profile UUID := _current_profile_id();  -- audit_logs.actor_id = user_profiles.id, jamais auth.uid()
  v_caller_id CONSTANT UUID := auth.uid();
  v_row products%ROWTYPE;
BEGIN
  IF NOT has_permission(v_caller_id, 'products.test_flag.update') THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
  END IF;

  UPDATE products
     SET is_test = p_is_test, updated_at = now()
   WHERE id = p_product_id AND deleted_at IS NULL
   RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'product_not_found' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, payload, metadata)
    VALUES (v_actor_profile, 'product.set_test_flag', 'product', p_product_id,
            jsonb_build_object('is_test', p_is_test),
            jsonb_build_object('sku', v_row.sku));

  RETURN jsonb_build_object('product_id', p_product_id, 'is_test', v_row.is_test);
END $function$;

REVOKE ALL ON FUNCTION public.set_product_is_test_v2(uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_product_is_test_v2(uuid, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_product_is_test_v2(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_product_is_test_v2(uuid, boolean) TO service_role;
COMMENT ON FUNCTION public.set_product_is_test_v2(uuid, boolean) IS
  'Pose le drapeau is_test d''un produit. Porte products.test_flag.update. v2 (2026-09-06) : audit_logs.actor_id = user_profiles.id via _current_profile_id() (v1 écrivait auth.uid()).';

-- ---------------------------------------------------------------------------
-- set_product_base_unit_v1 -> v2
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_product_base_unit_v2(p_product_id uuid, p_new_unit text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor_profile UUID := _current_profile_id();  -- audit_logs.actor_id = user_profiles.id, jamais auth.uid()
  v_caller_id      UUID := auth.uid();
  v_old_unit       TEXT;
  v_stock          NUMERIC;
  v_cost           NUMERIC;
  v_movements      INT;
  v_display        NUMERIC;
  v_new            TEXT := btrim(p_new_unit);
  v_factor         NUMERIC;
  v_cost_converted BOOLEAN := FALSE;
  v_new_cost       NUMERIC;
BEGIN
  IF NOT has_permission(v_caller_id, 'products.units.update') THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
  END IF;
  IF v_new IS NULL OR v_new = '' THEN
    RAISE EXCEPTION 'unit_required' USING ERRCODE = '22023';
  END IF;

  SELECT unit, COALESCE(current_stock, 0), cost_price
    INTO v_old_unit, v_stock, v_cost
    FROM products
   WHERE id = p_product_id AND deleted_at IS NULL
   FOR UPDATE;
  IF v_old_unit IS NULL THEN
    RAISE EXCEPTION 'product_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_new = v_old_unit THEN
    RAISE EXCEPTION 'unit_unchanged' USING ERRCODE = 'P0001';
  END IF;

  -- Safety guard: nothing recorded against the old unit may exist.
  SELECT count(*)            INTO v_movements FROM stock_movements WHERE product_id = p_product_id;
  SELECT COALESCE(SUM(quantity), 0) INTO v_display FROM display_stock   WHERE product_id = p_product_id;
  IF v_stock <> 0 OR v_movements > 0 OR v_display <> 0 THEN
    RAISE EXCEPTION 'base_unit_change_requires_zero_stock'
      USING ERRCODE = 'P0001',
            DETAIL  = format('stock=%s movements=%s display=%s', v_stock, v_movements, v_display),
            HINT    = 'Zero out stock and ensure no stock movements before changing the base unit.';
  END IF;

  -- Convert cost_price when a global conversion old→new exists; otherwise leave it.
  -- cost per new unit = cost per old unit × (old units per 1 new unit).
  IF v_cost IS NOT NULL AND v_cost <> 0 THEN
    BEGIN
      v_factor   := public.convert_quantity(1, v_new, v_old_unit);
      v_new_cost := v_cost * v_factor;
      v_cost_converted := TRUE;
    EXCEPTION WHEN OTHERS THEN
      v_cost_converted := FALSE;
    END;
  END IF;

  UPDATE products
     SET unit       = v_new,
         cost_price = CASE WHEN v_cost_converted THEN v_new_cost ELSE cost_price END,
         updated_at = now()
   WHERE id = p_product_id;

  -- Reset units defined against the old base.
  UPDATE product_unit_alternatives
     SET deleted_at = now(), updated_at = now()
   WHERE product_id = p_product_id AND deleted_at IS NULL;
  DELETE FROM product_unit_contexts WHERE product_id = p_product_id;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_actor_profile, 'product.base_unit_changed', 'product', p_product_id,
          jsonb_build_object('from', v_old_unit, 'to', v_new,
                             'cost_price_converted', v_cost_converted));

  RETURN jsonb_build_object(
    'product_id',            p_product_id,
    'old_unit',             v_old_unit,
    'new_unit',             v_new,
    'cost_price_converted', v_cost_converted
  );
END $function$;

REVOKE ALL ON FUNCTION public.set_product_base_unit_v2(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_product_base_unit_v2(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_product_base_unit_v2(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_product_base_unit_v2(uuid, text) TO service_role;
COMMENT ON FUNCTION public.set_product_base_unit_v2(uuid, text) IS
  'Change products.unit (unité de base) : refus si stock, mouvements ou vitrine non nuls (base_unit_change_requires_zero_stock) ; réinitialise unités alternatives et contextes ; convertit cost_price quand une conversion globale existe. Porte products.units.update. v2 (2026-09-06) : audit_logs.actor_id = user_profiles.id via _current_profile_id() (v1 écrivait auth.uid()).';

-- ---------------------------------------------------------------------------
-- set_product_sections_v1 -> v2
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_product_sections_v2(p_product_id uuid, p_section_ids uuid[], p_primary_section_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor_profile UUID := _current_profile_id();  -- audit_logs.actor_id = user_profiles.id, jamais auth.uid()
  v_caller_id UUID := auth.uid();
BEGIN
  IF NOT has_permission(v_caller_id, 'products.sections.update') THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
  END IF;

  IF p_primary_section_id IS NOT NULL
     AND NOT (p_primary_section_id = ANY(p_section_ids)) THEN
    RAISE EXCEPTION 'primary_section_must_be_in_set'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM products WHERE id = p_product_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'product_not_found' USING ERRCODE = 'P0002';
  END IF;

  DELETE FROM product_sections
   WHERE product_id = p_product_id
     AND section_id <> ALL(p_section_ids);

  UPDATE product_sections
     SET is_primary = false
   WHERE product_id = p_product_id
     AND is_primary = true
     AND (p_primary_section_id IS NULL OR section_id <> p_primary_section_id);

  INSERT INTO product_sections (product_id, section_id, is_primary)
  SELECT p_product_id, sid, (sid = p_primary_section_id)
    FROM unnest(p_section_ids) AS sid
  ON CONFLICT (product_id, section_id) DO UPDATE SET
    is_primary = EXCLUDED.is_primary;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_actor_profile, 'product.sections', 'product', p_product_id,
          jsonb_build_object('section_ids', p_section_ids, 'primary', p_primary_section_id));

  RETURN jsonb_build_object(
    'sections', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                          'section_id', ps.section_id,
                          'is_primary', ps.is_primary,
                          'section', to_jsonb(s.*)))
                   FROM product_sections ps
                   JOIN sections s ON s.id = ps.section_id
                   WHERE ps.product_id = p_product_id),
                   '[]'::JSONB)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.set_product_sections_v2(uuid, uuid[], uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_product_sections_v2(uuid, uuid[], uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_product_sections_v2(uuid, uuid[], uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_product_sections_v2(uuid, uuid[], uuid) TO service_role;
COMMENT ON FUNCTION public.set_product_sections_v2(uuid, uuid[], uuid) IS
  'Remplace le M2M produit-sections (DELETE des absentes + UPSERT des données), primaire exigée dans l''ensemble, réaffectation en deux temps. Porte products.sections.update. v2 (2026-09-06) : audit_logs.actor_id = user_profiles.id via _current_profile_id() (v1 écrivait auth.uid()).';

-- ---------------------------------------------------------------------------
-- set_product_units_v1 -> v2
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_product_units_v2(p_product_id uuid, p_alts jsonb, p_contexts jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor_profile UUID := _current_profile_id();  -- audit_logs.actor_id = user_profiles.id, jamais auth.uid()
  v_caller_id UUID := auth.uid();
  v_base_unit TEXT;
  v_valid_codes TEXT[];
  v_ctx_keys TEXT[] := ARRAY['stock_opname_unit', 'recipe_unit', 'purchase_unit', 'sales_unit'];
  v_k TEXT;
  v_v TEXT;
BEGIN
  IF NOT has_permission(v_caller_id, 'products.units.update') THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
  END IF;

  SELECT unit INTO v_base_unit FROM products
   WHERE id = p_product_id AND deleted_at IS NULL;
  IF v_base_unit IS NULL THEN
    RAISE EXCEPTION 'product_not_found' USING ERRCODE = 'P0002';
  END IF;

  UPDATE product_unit_alternatives
     SET deleted_at = now(), updated_at = now()
   WHERE product_id = p_product_id
     AND deleted_at IS NULL
     AND code NOT IN (
       SELECT (elt->>'code')::TEXT FROM jsonb_array_elements(p_alts) elt
     );

  INSERT INTO product_unit_alternatives (product_id, code, factor_to_base, tags, display_order)
  SELECT
    p_product_id,
    (elt->>'code')::TEXT,
    (elt->>'factor_to_base')::NUMERIC,
    COALESCE(
      ARRAY(SELECT jsonb_array_elements_text(elt->'tags'))::TEXT[],
      '{}'::TEXT[]
    ),
    COALESCE((elt->>'display_order')::INTEGER, 0)
  FROM jsonb_array_elements(p_alts) elt
  ON CONFLICT (product_id, code) WHERE deleted_at IS NULL
  DO UPDATE SET
    factor_to_base = EXCLUDED.factor_to_base,
    tags           = EXCLUDED.tags,
    display_order  = EXCLUDED.display_order,
    updated_at     = now();

  v_valid_codes := ARRAY[v_base_unit] || ARRAY(
    SELECT code FROM product_unit_alternatives
     WHERE product_id = p_product_id AND deleted_at IS NULL
  );

  FOREACH v_k IN ARRAY v_ctx_keys LOOP
    v_v := p_contexts->>v_k;
    IF v_v IS NULL OR v_v <> ALL(v_valid_codes) THEN
      RAISE EXCEPTION 'invalid_context_unit'
        USING HINT = format('Context %s references unknown unit %s', v_k, v_v),
              ERRCODE = '22023';
    END IF;
  END LOOP;

  INSERT INTO product_unit_contexts (product_id, stock_opname_unit, recipe_unit, purchase_unit, sales_unit)
  VALUES (
    p_product_id,
    p_contexts->>'stock_opname_unit',
    p_contexts->>'recipe_unit',
    p_contexts->>'purchase_unit',
    p_contexts->>'sales_unit'
  )
  ON CONFLICT (product_id) DO UPDATE SET
    stock_opname_unit = EXCLUDED.stock_opname_unit,
    recipe_unit       = EXCLUDED.recipe_unit,
    purchase_unit     = EXCLUDED.purchase_unit,
    sales_unit        = EXCLUDED.sales_unit,
    updated_at        = now();

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_actor_profile, 'product.units', 'product', p_product_id,
          jsonb_build_object('alts', p_alts, 'contexts', p_contexts));

  RETURN jsonb_build_object(
    'alternatives', COALESCE((SELECT jsonb_agg(to_jsonb(a.*))
                       FROM product_unit_alternatives a
                       WHERE a.product_id = p_product_id AND a.deleted_at IS NULL),
                       '[]'::JSONB),
    'contexts',     (SELECT to_jsonb(c.*) FROM product_unit_contexts c
                       WHERE c.product_id = p_product_id)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.set_product_units_v2(uuid, jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_product_units_v2(uuid, jsonb, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_product_units_v2(uuid, jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_product_units_v2(uuid, jsonb, jsonb) TO service_role;
COMMENT ON FUNCTION public.set_product_units_v2(uuid, jsonb, jsonb) IS
  'Remplace les unités alternatives et upserte les contextes d''un produit. Porte products.units.update. v2 (2026-09-06) : audit_logs.actor_id = user_profiles.id via _current_profile_id() (v1 écrivait auth.uid()).';

-- ---------------------------------------------------------------------------
-- upsert_product_modifiers_v1 -> v2
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.upsert_product_modifiers_v2(p_product_id uuid, p_groups jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor_profile UUID := _current_profile_id();  -- audit_logs.actor_id = user_profiles.id, jamais auth.uid()
  v_caller_id UUID := auth.uid();
  v_group  JSONB;
  v_option JSONB;
  v_gname  TEXT;
BEGIN
  IF NOT has_permission(v_caller_id, 'products.modifiers.update') THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM products WHERE id = p_product_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'product_not_found' USING ERRCODE = 'P0002';
  END IF;

  UPDATE product_modifiers
     SET deleted_at = now(), is_active = false, updated_at = now()
   WHERE product_id = p_product_id
     AND deleted_at IS NULL;

  FOR v_group IN SELECT * FROM jsonb_array_elements(p_groups)
  LOOP
    v_gname := v_group->>'group_name';

    FOR v_option IN SELECT * FROM jsonb_array_elements(v_group->'options')
    LOOP
      INSERT INTO product_modifiers (
        product_id, group_name, group_sort_order, group_required, group_type,
        option_label, option_sort_order, price_adjustment, is_default,
        ingredients_to_deduct
      )
      VALUES (
        p_product_id,
        v_gname,
        COALESCE((v_group->>'group_sort_order')::INTEGER, 0),
        COALESCE((v_group->>'group_required')::BOOLEAN, false),
        (v_group->>'group_type')::modifier_group_type,
        v_option->>'option_label',
        COALESCE((v_option->>'option_sort_order')::INTEGER, 0),
        COALESCE((v_option->>'price_adjustment')::NUMERIC, 0),
        COALESCE((v_option->>'is_default')::BOOLEAN, false),
        COALESCE(v_option->'ingredients_to_deduct', '[]'::JSONB)
      )
      ON CONFLICT (product_id, category_id, group_name, option_label)
      DO UPDATE SET
        group_sort_order      = EXCLUDED.group_sort_order,
        group_required        = EXCLUDED.group_required,
        group_type            = EXCLUDED.group_type,
        option_sort_order     = EXCLUDED.option_sort_order,
        price_adjustment      = EXCLUDED.price_adjustment,
        is_default            = EXCLUDED.is_default,
        ingredients_to_deduct = EXCLUDED.ingredients_to_deduct,
        is_active             = true,
        deleted_at            = NULL,
        updated_at            = now();
    END LOOP;
  END LOOP;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_actor_profile, 'product.modifiers', 'product', p_product_id, p_groups);

  RETURN jsonb_build_object(
    'modifiers', COALESCE((SELECT jsonb_agg(to_jsonb(pm.*))
                    FROM product_modifiers pm
                    WHERE pm.product_id = p_product_id
                      AND pm.deleted_at IS NULL), '[]'::JSONB)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.upsert_product_modifiers_v2(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.upsert_product_modifiers_v2(uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.upsert_product_modifiers_v2(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_product_modifiers_v2(uuid, jsonb) TO service_role;
COMMENT ON FUNCTION public.upsert_product_modifiers_v2(uuid, jsonb) IS
  'UPSERT des modificateurs d''un produit (soft-delete puis reprise). Porte products.modifiers.update. v2 (2026-09-06) : audit_logs.actor_id = user_profiles.id via _current_profile_id() (v1 écrivait auth.uid()).';

-- ---------------------------------------------------------------------------
-- create_variant_v1 -> v2
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_variant_v2(p_parent_id uuid, p_variant_label text, p_sku text, p_retail_price numeric, p_cost_price numeric DEFAULT NULL::numeric, p_unit text DEFAULT NULL::text, p_sort_order integer DEFAULT NULL::integer, p_name text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor_profile UUID := _current_profile_id();  -- audit_logs.actor_id = user_profiles.id, jamais auth.uid()
  v_user_id    UUID := auth.uid();
  v_parent     RECORD;
  v_new_id     UUID := gen_random_uuid();
  v_sort       INTEGER;
  v_name       TEXT;
  v_axis       variant_axis_type;
BEGIN
  IF NOT has_permission(v_user_id, 'products.variants.write') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0003';
  END IF;

  SELECT * INTO v_parent FROM products WHERE id = p_parent_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'parent_not_found: %', p_parent_id USING ERRCODE = 'P0002';
  END IF;

  IF v_parent.parent_product_id IS NOT NULL THEN
    RAISE EXCEPTION 'parent_is_variant: cannot add variant to a variant' USING ERRCODE = 'P0004';
  END IF;

  -- variant_axis is stored on siblings (parent has variant_axis NULL per XOR check).
  SELECT variant_axis INTO v_axis
    FROM products
   WHERE parent_product_id = p_parent_id AND deleted_at IS NULL
   LIMIT 1;

  IF v_axis IS NULL THEN
    RAISE EXCEPTION 'parent_has_no_variants: use convert_product_to_parent_v2 first' USING ERRCODE = 'P0004';
  END IF;

  -- M8 audit fix: SKU pre-check (products.sku is GLOBAL UNIQUE, not partial on
  -- deleted_at) → clean 'sku_taken' instead of the raw 23505 constraint text.
  IF p_sku IS NULL OR btrim(p_sku) = '' THEN
    RAISE EXCEPTION 'sku_required' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM products WHERE sku = p_sku) THEN
    RAISE EXCEPTION 'sku_taken: %', p_sku USING ERRCODE = 'P0004';
  END IF;

  IF p_sort_order IS NULL THEN
    SELECT COALESCE(MAX(variant_sort_order), 0) + 10 INTO v_sort
      FROM products WHERE parent_product_id = p_parent_id AND deleted_at IS NULL;
  ELSE
    v_sort := p_sort_order;
  END IF;

  v_name := COALESCE(p_name, v_parent.name || ' ' || p_variant_label);

  INSERT INTO products (
    id, name, sku, category_id, unit,
    retail_price, cost_price,
    visible_on_pos, available_for_sale, track_inventory, deduct_stock,
    is_active, description, created_at, updated_at,
    parent_product_id, variant_label, variant_axis, variant_sort_order
  )
  VALUES (
    v_new_id,
    v_name,
    p_sku,
    v_parent.category_id,
    COALESCE(p_unit, v_parent.unit),
    p_retail_price,
    COALESCE(p_cost_price, 0),
    v_parent.visible_on_pos,
    v_parent.available_for_sale,
    v_parent.track_inventory,
    v_parent.deduct_stock,
    true,
    v_parent.description,
    now(), now(),
    p_parent_id,
    p_variant_label,
    v_axis,
    v_sort
  );

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (
    v_actor_profile,
    'products.variant.created',
    'product',
    v_new_id,
    jsonb_build_object(
      'parent_id', p_parent_id,
      'variant_label', p_variant_label,
      'sku', p_sku,
      'retail_price', p_retail_price
    )
  );

  RETURN v_new_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_variant_v2(uuid, text, text, numeric, numeric, text, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_variant_v2(uuid, text, text, numeric, numeric, text, integer, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_variant_v2(uuid, text, text, numeric, numeric, text, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_variant_v2(uuid, text, text, numeric, numeric, text, integer, text) TO service_role;
COMMENT ON FUNCTION public.create_variant_v2(uuid, text, text, numeric, numeric, text, integer, text) IS
  'Ajoute une variante à un produit parent (axe hérité des sœurs, pré-contrôle SKU sku_taken). Porte products.variants.write. v2 (2026-09-06) : audit_logs.actor_id = user_profiles.id via _current_profile_id() (v1 écrivait auth.uid()).';

-- ---------------------------------------------------------------------------
-- update_variant_v1 -> v2
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_variant_v2(p_variant_id uuid, p_patch jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor_profile UUID := _current_profile_id();  -- audit_logs.actor_id = user_profiles.id, jamais auth.uid()
  v_user_id    UUID := auth.uid();
  v_variant    RECORD;
  v_old_label  TEXT;
BEGIN
  IF NOT has_permission(v_user_id, 'products.variants.write') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0003';
  END IF;

  SELECT * INTO v_variant FROM products WHERE id = p_variant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'variant_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_variant.parent_product_id IS NULL THEN
    RAISE EXCEPTION 'not_a_variant: % is not a variant', p_variant_id USING ERRCODE = 'P0004';
  END IF;

  v_old_label := v_variant.variant_label;

  -- 4-col allowlist patch
  UPDATE products
     SET variant_label      = COALESCE(p_patch->>'variant_label', variant_label),
         sku                = COALESCE(p_patch->>'sku', sku),
         retail_price       = COALESCE((p_patch->>'retail_price')::NUMERIC, retail_price),
         variant_sort_order = COALESCE((p_patch->>'variant_sort_order')::INTEGER, variant_sort_order),
         updated_at         = now()
   WHERE id = p_variant_id;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (
    v_actor_profile,
    'products.variant.updated',
    'product',
    p_variant_id,
    jsonb_build_object('patch', p_patch, 'old_label', v_old_label)
  );

  RETURN p_variant_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.update_variant_v2(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_variant_v2(uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_variant_v2(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_variant_v2(uuid, jsonb) TO service_role;
COMMENT ON FUNCTION public.update_variant_v2(uuid, jsonb) IS
  'Patch d''une variante (allowlist 4 cols). Porte products.variants.write. v2 (2026-09-06) : audit_logs.actor_id = user_profiles.id via _current_profile_id() (v1 écrivait auth.uid()).';

-- ---------------------------------------------------------------------------
-- delete_variant_v1 -> v2
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_variant_v2(p_variant_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor_profile UUID := _current_profile_id();  -- audit_logs.actor_id = user_profiles.id, jamais auth.uid()
  v_user_id      UUID := auth.uid();
  v_variant      RECORD;
  v_active_count INTEGER;
BEGIN
  IF NOT has_permission(v_user_id, 'products.variants.write') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0003';
  END IF;

  SELECT * INTO v_variant FROM products WHERE id = p_variant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'variant_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_variant.parent_product_id IS NULL THEN
    RAISE EXCEPTION 'not_a_variant' USING ERRCODE = 'P0004';
  END IF;

  SELECT COUNT(*) INTO v_active_count
    FROM products
   WHERE parent_product_id = v_variant.parent_product_id
     AND is_active = true
     AND deleted_at IS NULL;

  IF v_active_count <= 1 THEN
    RAISE EXCEPTION 'last_variant_remaining: use convert_parent_to_standalone_v2 instead' USING ERRCODE = 'P0004';
  END IF;

  UPDATE products
     SET is_active = false, updated_at = now()
   WHERE id = p_variant_id;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (
    v_actor_profile,
    'products.variant.deactivated',
    'product',
    p_variant_id,
    jsonb_build_object('parent_id', v_variant.parent_product_id, 'label', v_variant.variant_label)
  );

  RETURN p_variant_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.delete_variant_v2(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_variant_v2(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.delete_variant_v2(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_variant_v2(uuid) TO service_role;
COMMENT ON FUNCTION public.delete_variant_v2(uuid) IS
  'Désactive une variante (refus sur la dernière active : last_variant_remaining). Porte products.variants.write. v2 (2026-09-06) : audit_logs.actor_id = user_profiles.id via _current_profile_id() (v1 écrivait auth.uid()).';

-- ---------------------------------------------------------------------------
-- reorder_variants_v1 -> v2
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reorder_variants_v2(p_parent_id uuid, p_ordered_variant_ids uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor_profile UUID := _current_profile_id();  -- audit_logs.actor_id = user_profiles.id, jamais auth.uid()
  v_user_id     UUID := auth.uid();
  v_expected    INTEGER;
  v_provided    INTEGER;
  v_assigned    INTEGER := 0;
  v_id          UUID;
  v_sort        INTEGER := 10;
BEGIN
  IF NOT has_permission(v_user_id, 'products.variants.write') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0003';
  END IF;

  v_provided := COALESCE(array_length(p_ordered_variant_ids, 1), 0);

  SELECT COUNT(*) INTO v_expected
    FROM products p
   WHERE p.parent_product_id = p_parent_id
     AND p.is_active = true
     AND p.deleted_at IS NULL;

  IF v_provided != v_expected THEN
    RAISE EXCEPTION 'incomplete_coverage: expected % active variants, got %', v_expected, v_provided
      USING ERRCODE = 'P0004';
  END IF;

  -- Validate every id belongs to this parent.
  IF EXISTS (
    SELECT 1
      FROM unnest(p_ordered_variant_ids) AS v(variant_id)
     WHERE NOT EXISTS (
       SELECT 1 FROM products p2
        WHERE p2.id = v.variant_id AND p2.parent_product_id = p_parent_id
     )
  ) THEN
    RAISE EXCEPTION 'invalid_variant_id: some ids do not belong to parent %', p_parent_id USING ERRCODE = 'P0004';
  END IF;

  FOREACH v_id IN ARRAY p_ordered_variant_ids LOOP
    UPDATE products p
       SET variant_sort_order = v_sort, updated_at = now()
     WHERE p.id = v_id;
    v_sort := v_sort + 10;
    v_assigned := v_assigned + 1;
  END LOOP;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (
    v_actor_profile,
    'products.variants.reordered',
    'product',
    p_parent_id,
    jsonb_build_object('parent_id', p_parent_id, 'count', v_assigned)
  );

  RETURN v_assigned;
END;
$function$;

REVOKE ALL ON FUNCTION public.reorder_variants_v2(uuid, uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reorder_variants_v2(uuid, uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.reorder_variants_v2(uuid, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reorder_variants_v2(uuid, uuid[]) TO service_role;
COMMENT ON FUNCTION public.reorder_variants_v2(uuid, uuid[]) IS
  'Réordonne les variantes actives d''un parent (couverture complète exigée). Porte products.variants.write. v2 (2026-09-06) : audit_logs.actor_id = user_profiles.id via _current_profile_id() (v1 écrivait auth.uid()).';

-- ---------------------------------------------------------------------------
-- convert_product_to_parent_v1 -> v2
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.convert_product_to_parent_v2(p_product_id uuid, p_first_variant_label text, p_variant_axis variant_axis_type, p_first_variant_name text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor_profile UUID := _current_profile_id();  -- audit_logs.actor_id = user_profiles.id, jamais auth.uid()
  v_user_id    UUID;
  v_product    RECORD;
  v_parent_id  UUID := gen_random_uuid();
BEGIN
  v_user_id := auth.uid();

  IF NOT has_permission(v_user_id, 'products.variants.write') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0003';
  END IF;

  SELECT * INTO v_product FROM products WHERE id = p_product_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'product_not_found: %', p_product_id USING ERRCODE = 'P0002';
  END IF;

  IF v_product.parent_product_id IS NOT NULL THEN
    RAISE EXCEPTION 'already_variant: % is already a variant', p_product_id USING ERRCODE = 'P0004';
  END IF;

  IF EXISTS (SELECT 1 FROM products WHERE parent_product_id = p_product_id) THEN
    RAISE EXCEPTION 'already_parent: % is already a parent', p_product_id USING ERRCODE = 'P0004';
  END IF;

  IF p_first_variant_label IS NULL OR length(trim(p_first_variant_label)) = 0 THEN
    RAISE EXCEPTION 'invalid_label: first_variant_label is required' USING ERRCODE = 'P0004';
  END IF;

  -- Pre-check candidate parent SKU to surface a clean error instead of raw 23505.
  IF EXISTS (SELECT 1 FROM products WHERE sku = v_product.sku || '-PARENT') THEN
    RAISE EXCEPTION 'sku_collision: parent SKU % already exists', v_product.sku || '-PARENT'
      USING ERRCODE = 'P0004';
  END IF;

  -- DECISION : existing UUID becomes the FIRST VARIANT. A new parent product is inserted.
  -- Update existing product : set parent_product_id = NEW parent_uuid, variant_label, variant_axis.
  -- Existing FKs (stock, orders, recipes) still resolve via existing UUID = first variant.
  -- Parent product has no own stock / orders / recipe — it's a logical grouping only.

  INSERT INTO products (
    id, name, sku, category_id, unit, retail_price, cost_price,
    visible_on_pos, available_for_sale, track_inventory, deduct_stock,
    is_active, description, created_at, updated_at,
    parent_product_id, variant_label, variant_axis
  )
  VALUES (
    v_parent_id,
    v_product.name,
    v_product.sku || '-PARENT',  -- avoid SKU collision
    v_product.category_id,
    v_product.unit,
    v_product.retail_price,
    0,                            -- parent has no own cost
    v_product.visible_on_pos,
    v_product.available_for_sale,
    false,                        -- parent has no own inventory
    false,
    v_product.is_active,
    v_product.description,
    now(), now(),
    NULL, NULL, NULL
  );

  -- Re-link the existing product as the first variant.
  UPDATE products
     SET parent_product_id  = v_parent_id,
         variant_label      = p_first_variant_label,
         variant_axis       = p_variant_axis,
         variant_sort_order = 10,
         name               = COALESCE(p_first_variant_name, v_product.name || ' ' || p_first_variant_label),
         updated_at         = now()
   WHERE id = p_product_id;

  -- Audit log row.
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (
    v_actor_profile,
    'products.variant.parent_created',
    'product',
    v_parent_id,
    jsonb_build_object(
      'parent_id',           v_parent_id,
      'first_variant_id',    p_product_id,
      'first_variant_label', p_first_variant_label,
      'variant_axis',        p_variant_axis,
      'name_preserved',      (p_first_variant_name IS NULL)
    )
  );

  RETURN v_parent_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.convert_product_to_parent_v2(uuid, text, variant_axis_type, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.convert_product_to_parent_v2(uuid, text, variant_axis_type, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.convert_product_to_parent_v2(uuid, text, variant_axis_type, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.convert_product_to_parent_v2(uuid, text, variant_axis_type, text) TO service_role;
COMMENT ON FUNCTION public.convert_product_to_parent_v2(uuid, text, variant_axis_type, text) IS
  'Convertit un produit autonome en parent + première variante : insère un NOUVEAU parent, l''UUID existant devient la première variante (les FK stock/commandes/recettes continuent de pointer la variante). Porte products.variants.write. v2 (2026-09-06) : audit_logs.actor_id = user_profiles.id via _current_profile_id() (v1 écrivait auth.uid()).';

-- ---------------------------------------------------------------------------
-- convert_parent_to_standalone_v1 -> v2
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.convert_parent_to_standalone_v2(p_parent_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor_profile UUID := _current_profile_id();  -- audit_logs.actor_id = user_profiles.id, jamais auth.uid()
  v_user_id      UUID := auth.uid();
  v_active_count INTEGER;
  v_variant_id   UUID;
BEGIN
  IF NOT has_permission(v_user_id, 'products.variants.write') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0003';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM products WHERE id = p_parent_id AND parent_product_id IS NULL) THEN
    RAISE EXCEPTION 'parent_not_found_or_is_variant' USING ERRCODE = 'P0002';
  END IF;

  SELECT COUNT(*) INTO v_active_count
    FROM products WHERE parent_product_id = p_parent_id AND is_active = true AND deleted_at IS NULL;

  IF v_active_count > 1 THEN
    RAISE EXCEPTION 'multiple_variants_remaining: cannot dissolve parent with % active variants', v_active_count USING ERRCODE = 'P0004';
  END IF;

  IF v_active_count = 1 THEN
    SELECT id INTO v_variant_id
      FROM products WHERE parent_product_id = p_parent_id AND is_active = true AND deleted_at IS NULL;

    -- Flip the lone active variant into a standalone product : NULL-out all 3 variant cols.
    UPDATE products
       SET parent_product_id = NULL,
           variant_label     = NULL,
           variant_axis      = NULL,
           variant_sort_order = 0,
           updated_at        = now()
     WHERE id = v_variant_id;

    -- Detach any previously-soft-deleted siblings — NULL out ALL THREE variant cols + reset sort_order
    -- so they satisfy the products_variant_xor CHECK (the previous version only NULLed parent_product_id
    -- which left variant_label + variant_axis populated → 23514).
    UPDATE products
       SET parent_product_id = NULL,
           variant_label     = NULL,
           variant_axis      = NULL,
           variant_sort_order = 0,
           updated_at        = now()
     WHERE parent_product_id = p_parent_id;

    -- Hard delete the orphan parent (frees the "-PARENT" SKU for future conversions).
    DELETE FROM products WHERE id = p_parent_id;
  ELSE
    -- 0 active variants : detach any inactive siblings (NULL all 3 cols), then hard-delete the parent.
    UPDATE products
       SET parent_product_id = NULL,
           variant_label     = NULL,
           variant_axis      = NULL,
           variant_sort_order = 0,
           updated_at        = now()
     WHERE parent_product_id = p_parent_id;

    DELETE FROM products WHERE id = p_parent_id;
  END IF;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (
    v_actor_profile,
    'products.variant.parent_dissolved',
    'product',
    p_parent_id,
    jsonb_build_object('promoted_variant_id', v_variant_id, 'remaining_active', v_active_count)
  );

  RETURN COALESCE(v_variant_id, p_parent_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.convert_parent_to_standalone_v2(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.convert_parent_to_standalone_v2(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.convert_parent_to_standalone_v2(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.convert_parent_to_standalone_v2(uuid) TO service_role;
COMMENT ON FUNCTION public.convert_parent_to_standalone_v2(uuid) IS
  'Dissout un parent : la dernière variante active redevient un produit autonome, le parent orphelin est supprimé (refus au-delà d''une variante active). Porte products.variants.write. v2 (2026-09-06) : audit_logs.actor_id = user_profiles.id via _current_profile_id() (v1 écrivait auth.uid()).';

-- ---------------------------------------------------------------------------
-- upsert_section_v1 -> v2
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.upsert_section_v2(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor_profile UUID := _current_profile_id();  -- audit_logs.actor_id = user_profiles.id, jamais auth.uid()
  v_caller_id CONSTANT UUID := auth.uid();
  v_id UUID := NULLIF(p_payload->>'id', '')::UUID;
  v_code TEXT := upper(NULLIF(trim(p_payload->>'code'), ''));
  v_name TEXT := NULLIF(trim(p_payload->>'name'), '');
  v_kind TEXT := NULLIF(trim(p_payload->>'kind'), '');
  v_is_active BOOLEAN := COALESCE((p_payload->>'is_active')::BOOLEAN, true);
  v_display_order INTEGER := COALESCE((p_payload->>'display_order')::INTEGER, 0);
  v_row sections%ROWTYPE;
  v_action TEXT;
BEGIN
  IF NOT has_permission(v_caller_id, 'inventory.sections.update') THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
  END IF;

  IF v_name IS NULL OR v_kind IS NULL OR (v_id IS NULL AND v_code IS NULL) THEN
    RAISE EXCEPTION 'missing_required_fields' USING ERRCODE = '22023',
      HINT = 'name, kind (and code on create) are required';
  END IF;
  IF v_kind NOT IN ('warehouse', 'production', 'sales') THEN
    RAISE EXCEPTION 'invalid_kind' USING ERRCODE = '22023',
      HINT = 'kind must be warehouse | production | sales';
  END IF;
  IF v_display_order < 0 THEN
    RAISE EXCEPTION 'invalid_display_order' USING ERRCODE = '22023';
  END IF;

  IF v_id IS NULL THEN
    -- create (23505 naturel si code déjà pris)
    INSERT INTO sections (code, name, kind, is_active, display_order)
      VALUES (v_code, v_name, v_kind, v_is_active, v_display_order)
      RETURNING * INTO v_row;
    v_action := 'section.create';
  ELSE
    -- update — le code est immuable (le formulaire le fige aussi) : ignoré.
    UPDATE sections
       SET name = v_name, kind = v_kind, is_active = v_is_active,
           display_order = v_display_order, updated_at = now()
     WHERE id = v_id AND deleted_at IS NULL
     RETURNING * INTO v_row;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'section_not_found' USING ERRCODE = 'P0002';
    END IF;
    v_action := 'section.update';
  END IF;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, payload, metadata)
    VALUES (v_actor_profile, v_action, 'section', v_row.id, p_payload,
            jsonb_build_object('code', v_row.code));

  RETURN to_jsonb(v_row);
END $function$;

REVOKE ALL ON FUNCTION public.upsert_section_v2(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.upsert_section_v2(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.upsert_section_v2(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_section_v2(jsonb) TO service_role;
COMMENT ON FUNCTION public.upsert_section_v2(jsonb) IS
  'Crée ou met à jour une section (code immuable en mise à jour). Porte inventory.sections.update. v2 (2026-09-06) : audit_logs.actor_id = user_profiles.id via _current_profile_id() (v1 écrivait auth.uid()).';

-- ---------------------------------------------------------------------------
-- delete_section_v1 -> v2
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_section_v2(p_section_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor_profile UUID := _current_profile_id();  -- audit_logs.actor_id = user_profiles.id, jamais auth.uid()
  v_caller_id CONSTANT UUID := auth.uid();
  v_row sections%ROWTYPE;
BEGIN
  IF NOT has_permission(v_caller_id, 'inventory.sections.update') THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
  END IF;

  UPDATE sections
     SET deleted_at = now(), is_active = false, updated_at = now()
   WHERE id = p_section_id AND deleted_at IS NULL
   RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'section_not_found' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, payload, metadata)
    VALUES (v_actor_profile, 'section.delete', 'section', p_section_id,
            jsonb_build_object('soft_delete', true),
            jsonb_build_object('code', v_row.code));

  RETURN jsonb_build_object('section_id', p_section_id, 'deleted', true);
END $function$;

REVOKE ALL ON FUNCTION public.delete_section_v2(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_section_v2(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.delete_section_v2(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_section_v2(uuid) TO service_role;
COMMENT ON FUNCTION public.delete_section_v2(uuid) IS
  'Soft-delete d''une section. Porte inventory.sections.update. v2 (2026-09-06) : audit_logs.actor_id = user_profiles.id via _current_profile_id() (v1 écrivait auth.uid()).';

-- ---------------------------------------------------------------------------
-- Anciennes versions droppées (versioning monotone)
-- ---------------------------------------------------------------------------
DROP FUNCTION public.create_product_v2(jsonb);
DROP FUNCTION public.update_product_v2(uuid, jsonb);
DROP FUNCTION public.delete_product_v1(uuid, uuid);
DROP FUNCTION public.create_category_v1(jsonb);
DROP FUNCTION public.update_category_v1(uuid, jsonb);
DROP FUNCTION public.delete_category_v1(uuid, uuid);
DROP FUNCTION public.reorder_categories_v1(uuid[]);
DROP FUNCTION public.set_product_is_test_v1(uuid, boolean);
DROP FUNCTION public.set_product_base_unit_v1(uuid, text);
DROP FUNCTION public.set_product_sections_v1(uuid, uuid[], uuid);
DROP FUNCTION public.set_product_units_v1(uuid, jsonb, jsonb);
DROP FUNCTION public.upsert_product_modifiers_v1(uuid, jsonb);
DROP FUNCTION public.create_variant_v1(uuid, text, text, numeric, numeric, text, integer, text);
DROP FUNCTION public.update_variant_v1(uuid, jsonb);
DROP FUNCTION public.delete_variant_v1(uuid);
DROP FUNCTION public.reorder_variants_v1(uuid, uuid[]);
DROP FUNCTION public.convert_product_to_parent_v1(uuid, text, variant_axis_type, text);
DROP FUNCTION public.convert_parent_to_standalone_v1(uuid);
DROP FUNCTION public.upsert_section_v1(jsonb);
DROP FUNCTION public.delete_section_v1(uuid);

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
