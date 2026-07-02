-- 20260710000087_repoint_audit_writers_to_audit_logs.sql
-- S56 P2.2 (audit T6) : consolidation audit — les 26 dernières RPCs écrivant
-- via la vue compat audit_log sont repointées sur la table audit_logs.
-- In-place CREATE OR REPLACE (précédent _077/_078) : signatures, grants et
-- comportements inchangés — seuls le nom de la cible et la liste de colonnes
-- changent (mapping du trigger compat S13 reproduit à l'identique :
-- subject_table→entity_type, subject_id→entity_id, payload→metadata,
-- actor_profile_id→actor_id).
--
-- duplicate_recipe_v1 est traité EXPLICITEMENT ci-dessous (avant le DO block)
-- car il LIT aussi la vue pour son replay d'idempotence : le SELECT devient
-- `metadata AS payload FROM audit_logs` (l'alias préserve les références
-- v_existing.payload du corps) et `ORDER BY occurred_at` → `created_at`.

CREATE OR REPLACE FUNCTION public.duplicate_recipe_v1(p_source_product_id uuid, p_target_product_id uuid, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid       UUID := auth.uid();
  v_profile   UUID;
  v_existing  RECORD;
  v_rows_copied INT;
  v_payload   JSONB;
  v_has_cycle BOOLEAN;
BEGIN
  IF NOT has_permission(v_uid, 'inventory.recipes.update') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;

  IF p_source_product_id IS NULL OR p_target_product_id IS NULL THEN
    RAISE EXCEPTION 'product_not_found' USING ERRCODE='P0002';
  END IF;

  IF p_source_product_id = p_target_product_id THEN
    RAISE EXCEPTION 'source_equals_target' USING ERRCODE='P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM products
     WHERE id = p_source_product_id
       AND is_active = TRUE
       AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'product_not_found'
      USING ERRCODE = 'P0002',
            DETAIL  = format('source product %s missing or inactive', p_source_product_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM products
     WHERE id = p_target_product_id
       AND is_active = TRUE
       AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'product_not_found'
      USING ERRCODE = 'P0002',
            DETAIL  = format('target product %s missing or inactive', p_target_product_id);
  END IF;

  SELECT id INTO v_profile FROM user_profiles
    WHERE auth_user_id = v_uid AND deleted_at IS NULL;
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT metadata AS payload INTO v_existing
      FROM audit_logs
     WHERE action = 'recipe.duplicated'
       AND metadata->>'idempotency_key' = p_idempotency_key::text
     ORDER BY created_at DESC
     LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'source_product_id', v_existing.payload->>'source_product_id',
        'target_product_id', v_existing.payload->>'target_product_id',
        'rows_copied',       (v_existing.payload->>'rows_copied')::INT,
        'idempotent_replay', TRUE
      );
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM recipes
     WHERE product_id = p_target_product_id
       AND is_active  = TRUE
       AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'target_has_active_recipes'
      USING ERRCODE = 'P0001',
            DETAIL  = format('target product %s already has active recipe rows', p_target_product_id);
  END IF;

  WITH RECURSIVE descendants(material_id, depth, path) AS (
    SELECT r.material_id, 1, ARRAY[r.material_id]::UUID[]
      FROM recipes r
     WHERE r.product_id = p_source_product_id
       AND r.is_active  = TRUE
       AND r.deleted_at IS NULL
    UNION ALL
    SELECT r.material_id, d.depth + 1, d.path || r.material_id
      FROM descendants d
      JOIN recipes r ON r.product_id = d.material_id
     WHERE r.is_active  = TRUE
       AND r.deleted_at IS NULL
       AND d.depth < 6
       AND NOT (r.material_id = ANY(d.path))
  )
  SELECT EXISTS (
    SELECT 1 FROM descendants WHERE material_id = p_target_product_id
  ) INTO v_has_cycle;

  IF v_has_cycle THEN
    RAISE EXCEPTION 'recipe_cycle_detected'
      USING ERRCODE = 'P0001',
            DETAIL  = format('cloning recipe of %s onto %s would form a cycle', p_source_product_id, p_target_product_id);
  END IF;

  WITH cloned AS (
    INSERT INTO recipes (
      product_id, material_id, quantity, unit, notes, is_active, created_at, updated_at
    )
    SELECT
      p_target_product_id,
      r.material_id,
      r.quantity,
      r.unit,
      r.notes,
      TRUE,
      now(),
      now()
    FROM recipes r
    WHERE r.product_id = p_source_product_id
      AND r.is_active  = TRUE
      AND r.deleted_at IS NULL
    RETURNING id
  )
  SELECT COUNT(*) INTO v_rows_copied FROM cloned;

  v_payload := jsonb_build_object(
    'source_product_id', p_source_product_id,
    'target_product_id', p_target_product_id,
    'rows_copied',       v_rows_copied,
    'idempotency_key',   p_idempotency_key
  );

  INSERT INTO audit_logs (action, entity_type, entity_id, metadata, actor_id)
  VALUES ('recipe.duplicated', 'recipes', p_target_product_id, v_payload, v_profile);

  RETURN jsonb_build_object(
    'source_product_id', p_source_product_id,
    'target_product_id', p_target_product_id,
    'rows_copied',       v_rows_copied,
    'idempotent_replay', FALSE
  );
END $function$;

-- Les 25 writers restants partagent exactement 2 formes de liste de colonnes
-- (vérifié live 2026-07-03) : la réécriture est programmatique, déterministe
-- et FAIL-FAST — toute forme inattendue lève une exception et annule la
-- transaction de migration.
DO $do$
DECLARE
  r      record;
  v_def  text;
  v_new  text;
  v_cnt  int := 0;
BEGIN
  FOR r IN
    SELECT p.oid
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosrc ~* 'INSERT\s+INTO\s+(public\.)?audit_log\M'
  LOOP
    v_def := pg_get_functiondef(r.oid);
    v_new := regexp_replace(
      v_def,
      'INSERT\s+INTO\s+(?:public\.)?audit_log\s*\(\s*action\s*,\s*subject_table\s*,\s*subject_id\s*,\s*payload\s*,\s*actor_profile_id\s*\)',
      'INSERT INTO audit_logs (action, entity_type, entity_id, metadata, actor_id)',
      'gi');
    v_new := regexp_replace(
      v_new,
      'INSERT\s+INTO\s+(?:public\.)?audit_log\s*\(\s*actor_profile_id\s*,\s*action\s*,\s*subject_table\s*,\s*subject_id\s*,\s*payload\s*\)',
      'INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)',
      'gi');
    IF v_new = v_def THEN
      RAISE EXCEPTION 'unexpected audit_log INSERT column list in %', r.oid::regprocedure;
    END IF;
    EXECUTE v_new;
    v_cnt := v_cnt + 1;
  END LOOP;
  -- Compte épinglé sur l'état live du 2026-07-03 ; un replay from-scratch de la lignée pourrait légitimement différer et devra ajuster cette assertion.
  IF v_cnt <> 25 THEN
    RAISE EXCEPTION 'expected 25 remaining writers (26 minus duplicate_recipe_v1), rewrote %', v_cnt;
  END IF;
  -- Post-condition dure : plus aucun accès à la vue depuis une fonction.
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND (p.prosrc ~* 'INSERT\s+INTO\s+(public\.)?audit_log\M'
        OR p.prosrc ~* '(FROM|JOIN)\s+(public\.)?audit_log\M')
  ) THEN
    RAISE EXCEPTION 'audit_log view still referenced by at least one function';
  END IF;
END
$do$;
