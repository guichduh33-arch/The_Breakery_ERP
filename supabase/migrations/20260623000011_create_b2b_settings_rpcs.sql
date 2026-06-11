-- 20260623000011_create_b2b_settings_rpcs.sql
-- Session 39 \ Wave A \ Task A2 (BO-15) — RPCs get_b2b_settings_v1 + update_b2b_settings_v1.
-- Accès : settings.read pour GET, settings.update pour UPDATE (perms existantes S13).

-- ---------------------------------------------------------------------------
-- get_b2b_settings_v1 : lecture publique (MANAGER+) de la config B2B.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_b2b_settings_v1()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_row       b2b_settings%ROWTYPE;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  IF NOT has_permission(v_caller_id, 'settings.read') THEN
    RAISE EXCEPTION 'Permission denied: settings.read' USING ERRCODE = 'P0003';
  END IF;

  SELECT * INTO v_row FROM public.b2b_settings WHERE id = 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'b2b_settings singleton (id=1) missing' USING ERRCODE = 'P0002';
  END IF;

  RETURN to_jsonb(v_row);
END;
$$;

COMMENT ON FUNCTION public.get_b2b_settings_v1() IS
  'S39 BO-15 — Retourne la config B2B singleton. Gate: settings.read.';

-- ---------------------------------------------------------------------------
-- update_b2b_settings_v1 : mise à jour partielle de la config B2B.
-- Patch semantics : seules les clés présentes dans p_patch sont modifiées.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_b2b_settings_v1(p_patch JSONB)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id       UUID := auth.uid();
  v_profile_id      UUID;
  v_old             b2b_settings%ROWTYPE;
  v_new_dpt         TEXT;
  v_new_apt         JSONB;
  v_new_cod         INT;
  v_new_ab          JSONB;
  v_allowed_keys    TEXT[] := ARRAY['default_payment_terms','available_payment_terms','critical_overdue_days','aging_buckets'];
  v_key             TEXT;
  v_term            JSONB;
  v_bucket          JSONB;
  v_bucket_prev_max INT;
  v_bucket_min      INT;
  v_bucket_max      INT;
  v_bucket_label    TEXT;
  v_bucket_idx      INT;
  v_bucket_count    INT;
  v_result          b2b_settings%ROWTYPE;
BEGIN
  -- Auth + perm gate
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  IF NOT has_permission(v_caller_id, 'settings.update') THEN
    RAISE EXCEPTION 'Permission denied: settings.update' USING ERRCODE = 'P0003';
  END IF;

  -- Resolve profile id for updated_by
  SELECT id INTO v_profile_id FROM public.user_profiles
  WHERE auth_user_id = v_caller_id AND deleted_at IS NULL LIMIT 1;

  -- p_patch must be a JSONB object
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'p_patch must be a JSON object' USING ERRCODE = 'P0001';
  END IF;

  -- Reject unknown keys
  FOR v_key IN SELECT jsonb_object_keys(p_patch) LOOP
    IF NOT (v_key = ANY(v_allowed_keys)) THEN
      RAISE EXCEPTION 'Unknown key in p_patch: %. Allowed: default_payment_terms, available_payment_terms, critical_overdue_days, aging_buckets', v_key
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  -- Lock and read current row
  SELECT * INTO v_old FROM public.b2b_settings WHERE id = 1 FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'b2b_settings singleton (id=1) missing' USING ERRCODE = 'P0002';
  END IF;

  -- Merge patch onto old values
  v_new_dpt := COALESCE((p_patch->>'default_payment_terms'), v_old.default_payment_terms);
  v_new_apt := COALESCE((p_patch->'available_payment_terms'), v_old.available_payment_terms);
  v_new_cod := COALESCE((p_patch->>'critical_overdue_days')::INT, v_old.critical_overdue_days);
  v_new_ab  := COALESCE((p_patch->'aging_buckets'), v_old.aging_buckets);

  -- Validate available_payment_terms: non-empty array, all strings, unique
  IF jsonb_typeof(v_new_apt) <> 'array' OR jsonb_array_length(v_new_apt) = 0 THEN
    RAISE EXCEPTION 'available_payment_terms must be a non-empty JSON array' USING ERRCODE = 'P0001';
  END IF;

  FOR v_term IN SELECT * FROM jsonb_array_elements(v_new_apt) LOOP
    IF jsonb_typeof(v_term) <> 'string' THEN
      RAISE EXCEPTION 'available_payment_terms must contain only strings' USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  -- Uniqueness check for available_payment_terms
  IF (SELECT count(DISTINCT val) FROM jsonb_array_elements_text(v_new_apt) val) <
     jsonb_array_length(v_new_apt) THEN
    RAISE EXCEPTION 'available_payment_terms must not contain duplicate values' USING ERRCODE = 'P0001';
  END IF;

  -- Validate default_payment_terms is in available_payment_terms (post-merge)
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(v_new_apt) apt WHERE apt = v_new_dpt
  ) THEN
    RAISE EXCEPTION 'default_payment_terms (%) must be in available_payment_terms', v_new_dpt
      USING ERRCODE = 'P0001';
  END IF;

  -- Validate critical_overdue_days: 1..365
  IF v_new_cod < 1 OR v_new_cod > 365 THEN
    RAISE EXCEPTION 'critical_overdue_days must be between 1 and 365, got %', v_new_cod
      USING ERRCODE = 'P0001';
  END IF;

  -- Validate aging_buckets
  IF jsonb_typeof(v_new_ab) <> 'array' OR jsonb_array_length(v_new_ab) = 0 THEN
    RAISE EXCEPTION 'aging_buckets must be a non-empty JSON array' USING ERRCODE = 'P0001';
  END IF;

  v_bucket_count := jsonb_array_length(v_new_ab);

  FOR v_bucket_idx IN 0 .. v_bucket_count - 1 LOOP
    v_bucket := v_new_ab -> v_bucket_idx;

    -- Each bucket must be a JSON object
    IF jsonb_typeof(v_bucket) <> 'object' THEN
      RAISE EXCEPTION 'aging_buckets[%] must be a JSON object', v_bucket_idx USING ERRCODE = 'P0001';
    END IF;

    -- label: non-empty text
    v_bucket_label := v_bucket->>'label';
    IF v_bucket_label IS NULL OR length(trim(v_bucket_label)) = 0 THEN
      RAISE EXCEPTION 'aging_buckets[%].label must be a non-empty string', v_bucket_idx USING ERRCODE = 'P0001';
    END IF;

    -- min must be present and be an integer
    IF (v_bucket->'min') IS NULL OR jsonb_typeof(v_bucket->'min') <> 'number' THEN
      RAISE EXCEPTION 'aging_buckets[%].min must be an integer', v_bucket_idx USING ERRCODE = 'P0001';
    END IF;
    v_bucket_min := (v_bucket->>'min')::INT;

    -- max: null only on last bucket; otherwise must be an integer >= min
    IF v_bucket_idx < v_bucket_count - 1 THEN
      IF (v_bucket->'max') IS NULL OR jsonb_typeof(v_bucket->'max') = 'null' THEN
        RAISE EXCEPTION 'aging_buckets[%].max must not be null (only last bucket may have null max)', v_bucket_idx
          USING ERRCODE = 'P0001';
      END IF;
      v_bucket_max := (v_bucket->>'max')::INT;
      IF v_bucket_max < v_bucket_min THEN
        RAISE EXCEPTION 'aging_buckets[%].max (%) must be >= min (%)', v_bucket_idx, v_bucket_max, v_bucket_min
          USING ERRCODE = 'P0001';
      END IF;
    ELSE
      -- Last bucket: max must be JSON null
      IF (v_bucket->'max') IS NULL OR jsonb_typeof(v_bucket->'max') <> 'null' THEN
        RAISE EXCEPTION 'aging_buckets last bucket max must be null' USING ERRCODE = 'P0001';
      END IF;
    END IF;

    -- First bucket must start at 0
    IF v_bucket_idx = 0 AND v_bucket_min <> 0 THEN
      RAISE EXCEPTION 'aging_buckets first bucket min must be 0, got %', v_bucket_min USING ERRCODE = 'P0001';
    END IF;

    -- Contiguity: bucket[n].min = bucket[n-1].max + 1
    IF v_bucket_idx > 0 THEN
      v_bucket_prev_max := (v_new_ab -> (v_bucket_idx - 1) ->>'max')::INT;
      IF v_bucket_min <> v_bucket_prev_max + 1 THEN
        RAISE EXCEPTION 'aging_buckets[%].min (%) must equal aging_buckets[%].max + 1 (%)',
          v_bucket_idx, v_bucket_min, v_bucket_idx - 1, v_bucket_prev_max + 1
          USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END LOOP;

  -- Apply update
  UPDATE public.b2b_settings SET
    default_payment_terms   = v_new_dpt,
    available_payment_terms = v_new_apt,
    critical_overdue_days   = v_new_cod,
    aging_buckets           = v_new_ab,
    updated_at              = now(),
    updated_by              = v_profile_id
  WHERE id = 1;

  -- Audit log (entity_id NULL — singleton has SMALLINT id, not UUID)
  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_profile_id, 'b2b_settings.updated', 'b2b_settings', NULL,
          jsonb_build_object('old', to_jsonb(v_old), 'patch', p_patch));

  -- Return fresh row
  SELECT * INTO v_result FROM public.b2b_settings WHERE id = 1;
  RETURN to_jsonb(v_result);
END;
$$;

COMMENT ON FUNCTION public.update_b2b_settings_v1(JSONB) IS
  'S39 BO-15 — Met à jour la config B2B (patch partiel). Validations complètes. Gate: settings.update.';
