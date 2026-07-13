-- 20260712000161_floor_plan_sections_crud.sql
-- S75 Lot 1 — real floor sections + RPC-only writes on restaurant_tables.
-- Replaces the sort_order>=100 front-end hack (FloorPlanModal/FloorPlanView).

CREATE TABLE table_sections (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active  BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
ALTER TABLE table_sections ENABLE ROW LEVEL SECURITY;
CREATE POLICY auth_read ON table_sections FOR SELECT TO authenticated USING (true);
REVOKE ALL ON table_sections FROM anon, PUBLIC;
GRANT SELECT ON table_sections TO authenticated;  -- writes via RPCs only

ALTER TABLE restaurant_tables ADD COLUMN section_id UUID REFERENCES table_sections(id);

-- Seed + backfill from the legacy front hack (sort_order >= 100 = Terrace).
INSERT INTO table_sections (name, sort_order) VALUES ('Interior', 0), ('Terrace', 100);
UPDATE restaurant_tables SET section_id =
  (SELECT id FROM table_sections
   WHERE name = CASE WHEN restaurant_tables.sort_order >= 100 THEN 'Terrace' ELSE 'Interior' END);

-- S11 direct-write policies bypass the occupied-guard + audit below → RPC-only now.
DROP POLICY IF EXISTS perm_create ON restaurant_tables;
DROP POLICY IF EXISTS perm_update ON restaurant_tables;

CREATE FUNCTION create_table_section_v1(p_name text, p_sort_order int)
RETURNS table_sections LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid UUID := auth.uid(); v_actor UUID; v_row table_sections;
BEGIN
  IF NOT has_permission(v_uid, 'tables.create') THEN
    RAISE EXCEPTION 'permission_denied: tables.create' USING ERRCODE = 'P0003';
  END IF;
  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'name_required' USING ERRCODE = 'P0001';
  END IF;
  BEGIN
    INSERT INTO table_sections (name, sort_order) VALUES (btrim(p_name), COALESCE(p_sort_order, 0))
    RETURNING * INTO v_row;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'name_taken' USING ERRCODE = 'P0001';
  END;
  SELECT id INTO v_actor FROM user_profiles WHERE auth_user_id = v_uid AND deleted_at IS NULL LIMIT 1;
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_actor, 'table_section.created', 'table_sections', v_row.id, jsonb_build_object('name', v_row.name));
  RETURN v_row;
END $$;

CREATE FUNCTION update_table_section_v1(p_id uuid, p_name text, p_sort_order int, p_is_active boolean)
RETURNS table_sections LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid UUID := auth.uid(); v_actor UUID; v_old table_sections; v_row table_sections;
BEGIN
  IF NOT has_permission(v_uid, 'tables.update') THEN
    RAISE EXCEPTION 'permission_denied: tables.update' USING ERRCODE = 'P0003';
  END IF;
  SELECT * INTO v_old FROM table_sections WHERE id = p_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'section_not_found' USING ERRCODE = 'P0002'; END IF;
  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'name_required' USING ERRCODE = 'P0001';
  END IF;
  -- Deactivating a section that still holds active tables would orphan them on POS.
  IF v_old.is_active AND COALESCE(p_is_active, true) = false
     AND EXISTS (SELECT 1 FROM restaurant_tables WHERE section_id = p_id AND is_active) THEN
    RAISE EXCEPTION 'section_in_use' USING ERRCODE = 'P0001';
  END IF;
  BEGIN
    UPDATE table_sections SET name = btrim(p_name), sort_order = COALESCE(p_sort_order, sort_order),
      is_active = COALESCE(p_is_active, is_active), updated_at = now()
    WHERE id = p_id RETURNING * INTO v_row;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'name_taken' USING ERRCODE = 'P0001';
  END;
  SELECT id INTO v_actor FROM user_profiles WHERE auth_user_id = v_uid AND deleted_at IS NULL LIMIT 1;
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_actor, 'table_section.updated', 'table_sections', p_id,
          jsonb_build_object('before', jsonb_build_object('name', v_old.name, 'sort_order', v_old.sort_order, 'is_active', v_old.is_active),
                             'after',  jsonb_build_object('name', v_row.name, 'sort_order', v_row.sort_order, 'is_active', v_row.is_active)));
  RETURN v_row;
END $$;

CREATE FUNCTION delete_table_section_v1(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid UUID := auth.uid(); v_actor UUID; v_deleted timestamptz;
BEGIN
  IF NOT has_permission(v_uid, 'tables.delete') THEN
    RAISE EXCEPTION 'permission_denied: tables.delete' USING ERRCODE = 'P0003';
  END IF;
  SELECT deleted_at INTO v_deleted FROM table_sections WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'section_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_deleted IS NOT NULL THEN RETURN; END IF;  -- idempotent
  IF EXISTS (SELECT 1 FROM restaurant_tables WHERE section_id = p_id AND is_active) THEN
    RAISE EXCEPTION 'section_in_use' USING ERRCODE = 'P0001';
  END IF;
  UPDATE table_sections SET deleted_at = now(), is_active = false, updated_at = now() WHERE id = p_id;
  SELECT id INTO v_actor FROM user_profiles WHERE auth_user_id = v_uid AND deleted_at IS NULL LIMIT 1;
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_actor, 'table_section.deleted', 'table_sections', p_id, '{}'::jsonb);
END $$;

CREATE FUNCTION create_restaurant_table_v1(p_name text, p_seats int, p_section_id uuid, p_sort_order int)
RETURNS restaurant_tables LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid UUID := auth.uid(); v_actor UUID; v_row restaurant_tables;
BEGIN
  IF NOT has_permission(v_uid, 'tables.create') THEN
    RAISE EXCEPTION 'permission_denied: tables.create' USING ERRCODE = 'P0003';
  END IF;
  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'name_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_seats IS NULL OR p_seats < 1 OR p_seats > 20 THEN
    RAISE EXCEPTION 'invalid_seats' USING ERRCODE = 'P0001';
  END IF;
  IF p_section_id IS NOT NULL AND NOT EXISTS
     (SELECT 1 FROM table_sections WHERE id = p_section_id AND is_active AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'section_not_found' USING ERRCODE = 'P0001';
  END IF;
  BEGIN
    INSERT INTO restaurant_tables (name, seats, section_id, sort_order)
    VALUES (btrim(p_name), p_seats, p_section_id, COALESCE(p_sort_order, 0)) RETURNING * INTO v_row;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'name_taken' USING ERRCODE = 'P0001';
  END;
  SELECT id INTO v_actor FROM user_profiles WHERE auth_user_id = v_uid AND deleted_at IS NULL LIMIT 1;
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_actor, 'table.created', 'restaurant_tables', v_row.id, jsonb_build_object('name', v_row.name, 'seats', v_row.seats));
  RETURN v_row;
END $$;

CREATE FUNCTION update_restaurant_table_v1(p_id uuid, p_name text, p_seats int, p_section_id uuid, p_sort_order int, p_is_active boolean)
RETURNS restaurant_tables LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid UUID := auth.uid(); v_actor UUID; v_old restaurant_tables; v_row restaurant_tables;
BEGIN
  IF NOT has_permission(v_uid, 'tables.update') THEN
    RAISE EXCEPTION 'permission_denied: tables.update' USING ERRCODE = 'P0003';
  END IF;
  SELECT * INTO v_old FROM restaurant_tables WHERE id = p_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'table_not_found' USING ERRCODE = 'P0002'; END IF;
  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'name_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_seats IS NULL OR p_seats < 1 OR p_seats > 20 THEN
    RAISE EXCEPTION 'invalid_seats' USING ERRCODE = 'P0001';
  END IF;
  IF p_section_id IS NOT NULL AND NOT EXISTS
     (SELECT 1 FROM table_sections WHERE id = p_section_id AND is_active AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'section_not_found' USING ERRCODE = 'P0001';
  END IF;
  -- orders.table_number references the table BY NAME: renaming or deactivating a
  -- table under a live order would orphan it (occupancy map keyed by name).
  IF (btrim(p_name) <> v_old.name OR (v_old.is_active AND COALESCE(p_is_active, true) = false))
     AND EXISTS (SELECT 1 FROM orders WHERE table_number = v_old.name
                 AND status NOT IN ('completed', 'voided')) THEN
    RAISE EXCEPTION 'table_occupied' USING ERRCODE = 'P0001';
  END IF;
  BEGIN
    UPDATE restaurant_tables SET name = btrim(p_name), seats = p_seats, section_id = p_section_id,
      sort_order = COALESCE(p_sort_order, sort_order), is_active = COALESCE(p_is_active, is_active),
      updated_at = now()
    WHERE id = p_id RETURNING * INTO v_row;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'name_taken' USING ERRCODE = 'P0001';
  END;
  SELECT id INTO v_actor FROM user_profiles WHERE auth_user_id = v_uid AND deleted_at IS NULL LIMIT 1;
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_actor, 'table.updated', 'restaurant_tables', p_id,
          jsonb_build_object('before', jsonb_build_object('name', v_old.name, 'seats', v_old.seats, 'section_id', v_old.section_id, 'is_active', v_old.is_active),
                             'after',  jsonb_build_object('name', v_row.name, 'seats', v_row.seats, 'section_id', v_row.section_id, 'is_active', v_row.is_active)));
  RETURN v_row;
END $$;

CREATE FUNCTION delete_restaurant_table_v1(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid UUID := auth.uid(); v_actor UUID; v_old restaurant_tables;
BEGIN
  IF NOT has_permission(v_uid, 'tables.delete') THEN
    RAISE EXCEPTION 'permission_denied: tables.delete' USING ERRCODE = 'P0003';
  END IF;
  SELECT * INTO v_old FROM restaurant_tables WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'table_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_old.deleted_at IS NOT NULL THEN RETURN; END IF;  -- idempotent
  IF EXISTS (SELECT 1 FROM orders WHERE table_number = v_old.name
             AND status NOT IN ('completed', 'voided')) THEN
    RAISE EXCEPTION 'table_occupied' USING ERRCODE = 'P0001';
  END IF;
  UPDATE restaurant_tables SET deleted_at = now(), is_active = false, updated_at = now() WHERE id = p_id;
  SELECT id INTO v_actor FROM user_profiles WHERE auth_user_id = v_uid AND deleted_at IS NULL LIMIT 1;
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_actor, 'table.deleted', 'restaurant_tables', p_id, jsonb_build_object('name', v_old.name));
END $$;

DO $$
DECLARE fn text;
BEGIN
  FOR fn IN SELECT unnest(ARRAY[
    'create_table_section_v1(text,int)', 'update_table_section_v1(uuid,text,int,boolean)',
    'delete_table_section_v1(uuid)',
    'create_restaurant_table_v1(text,int,uuid,int)',
    'update_restaurant_table_v1(uuid,text,int,uuid,int,boolean)',
    'delete_restaurant_table_v1(uuid)'
  ]) LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', fn);
  END LOOP;
END $$;
