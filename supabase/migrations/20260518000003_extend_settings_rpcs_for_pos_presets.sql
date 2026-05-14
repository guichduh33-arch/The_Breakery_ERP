-- 20260518000003_extend_settings_rpcs_for_pos_presets.sql
-- Session 14 / Phase 2.D — Reviewer follow-up #18.
--
-- Extends get_settings_by_category_v1 / set_setting_v1 (originally added
-- in 20260517000190) so the POS Settings page can read and write the new
-- pos_presets columns added in 20260518000002. The existing whitelist
-- (8 scalar business_config columns) is preserved verbatim ; only the
-- new branches/cases are appended.
--
-- Validation per key :
--   - pos_quick_payment_amounts, pos_opening_cash_presets : JSONB array,
--     every element must be a positive number (loop with
--     jsonb_array_elements). Non-numeric or zero/negative → setting_value_invalid.
--   - pos_discount_presets : JSONB array, every element must be an object
--     with `value` (number 0..100) and `name` (non-empty string).
--
-- Audit row pattern is identical to the existing scalar branches.

------------------------------------------------------------------------
-- get_settings_by_category_v1 — re-create with pos_presets branch.
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_settings_by_category_v1(
  p_category TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_settings JSONB;
  v_row      business_config%ROWTYPE;
BEGIN
  IF NOT has_permission(auth.uid(), 'settings.read') THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row FROM business_config WHERE id = 1;

  IF v_row IS NULL THEN
    RETURN jsonb_build_object(
      'category', p_category,
      'settings', '{}'::jsonb
    );
  END IF;

  v_settings :=
    CASE LOWER(COALESCE(p_category, ''))
      WHEN 'business' THEN jsonb_build_object(
        'name',           v_row.name,
        'fiscal_address', v_row.fiscal_address
      )
      WHEN 'localization' THEN jsonb_build_object(
        'currency', v_row.currency,
        'timezone', v_row.timezone
      )
      WHEN 'tax' THEN jsonb_build_object(
        'tax_rate',      v_row.tax_rate,
        'tax_inclusive', v_row.tax_inclusive
      )
      WHEN 'pos' THEN jsonb_build_object(
        'shift_variance_threshold_pct', v_row.shift_variance_threshold_pct,
        'shift_variance_threshold_abs', v_row.shift_variance_threshold_abs
      )
      WHEN 'pos_presets' THEN jsonb_build_object(
        'pos_quick_payment_amounts', v_row.pos_quick_payment_amounts,
        'pos_opening_cash_presets',  v_row.pos_opening_cash_presets,
        'pos_discount_presets',      v_row.pos_discount_presets
      )
      ELSE '{}'::jsonb
    END;

  RETURN jsonb_build_object(
    'category', p_category,
    'settings', v_settings
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_settings_by_category_v1(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_settings_by_category_v1(TEXT) TO authenticated;

COMMENT ON FUNCTION public.get_settings_by_category_v1(TEXT) IS
  'Session 13 / Phase 5.C (extended Session 14 / Phase 2.D). Returns business_config columns grouped by symbolic category. Categories : business | localization | tax | pos | pos_presets. Unknown category returns empty settings object (not error).';

------------------------------------------------------------------------
-- set_setting_v1 — re-create with three pos_presets cases.
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_setting_v1(
  p_key      TEXT,
  p_value    JSONB,
  p_category TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_actor_id  UUID;
  v_old       JSONB;
  v_new       JSONB;
  v_elem      JSONB;
  v_elem_val  JSONB;
  v_elem_name JSONB;
BEGIN
  IF NOT has_permission(auth.uid(), 'settings.update') THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
  END IF;

  IF p_key IS NULL OR p_key = '' THEN
    RAISE EXCEPTION 'setting_key_required' USING ERRCODE = '22023';
  END IF;

  SELECT id INTO v_actor_id
    FROM user_profiles
    WHERE auth_user_id = auth.uid() AND deleted_at IS NULL
    LIMIT 1;

  CASE p_key
    WHEN 'name' THEN
      IF jsonb_typeof(p_value) <> 'string' THEN
        RAISE EXCEPTION 'setting_type_invalid' USING ERRCODE = '22023', DETAIL = 'name expects string';
      END IF;
      IF (p_value #>> '{}') IS NULL OR (p_value #>> '{}') = '' THEN
        RAISE EXCEPTION 'setting_value_invalid' USING ERRCODE = '22023', DETAIL = 'name cannot be empty';
      END IF;
      SELECT to_jsonb(name) INTO v_old FROM business_config WHERE id = 1;
      UPDATE business_config SET name = p_value #>> '{}', updated_at = now() WHERE id = 1;
      v_new := p_value;

    WHEN 'fiscal_address' THEN
      IF p_value <> 'null'::jsonb AND jsonb_typeof(p_value) <> 'string' THEN
        RAISE EXCEPTION 'setting_type_invalid' USING ERRCODE = '22023', DETAIL = 'fiscal_address expects string or null';
      END IF;
      SELECT to_jsonb(fiscal_address) INTO v_old FROM business_config WHERE id = 1;
      UPDATE business_config
        SET fiscal_address = CASE WHEN p_value = 'null'::jsonb THEN NULL ELSE p_value #>> '{}' END,
            updated_at = now()
        WHERE id = 1;
      v_new := p_value;

    WHEN 'currency' THEN
      IF jsonb_typeof(p_value) <> 'string' OR (p_value #>> '{}') = '' THEN
        RAISE EXCEPTION 'setting_value_invalid' USING ERRCODE = '22023', DETAIL = 'currency required';
      END IF;
      SELECT to_jsonb(currency) INTO v_old FROM business_config WHERE id = 1;
      UPDATE business_config SET currency = p_value #>> '{}', updated_at = now() WHERE id = 1;
      v_new := p_value;

    WHEN 'timezone' THEN
      IF jsonb_typeof(p_value) <> 'string' OR (p_value #>> '{}') = '' THEN
        RAISE EXCEPTION 'setting_value_invalid' USING ERRCODE = '22023', DETAIL = 'timezone required';
      END IF;
      SELECT to_jsonb(timezone) INTO v_old FROM business_config WHERE id = 1;
      UPDATE business_config SET timezone = p_value #>> '{}', updated_at = now() WHERE id = 1;
      v_new := p_value;

    WHEN 'tax_rate' THEN
      IF jsonb_typeof(p_value) <> 'number' THEN
        RAISE EXCEPTION 'setting_type_invalid' USING ERRCODE = '22023', DETAIL = 'tax_rate expects number';
      END IF;
      IF (p_value #>> '{}')::NUMERIC < 0 OR (p_value #>> '{}')::NUMERIC > 1 THEN
        RAISE EXCEPTION 'setting_value_invalid' USING ERRCODE = '22023', DETAIL = 'tax_rate must be in [0, 1]';
      END IF;
      SELECT to_jsonb(tax_rate) INTO v_old FROM business_config WHERE id = 1;
      UPDATE business_config SET tax_rate = (p_value #>> '{}')::NUMERIC, updated_at = now() WHERE id = 1;
      v_new := p_value;

    WHEN 'tax_inclusive' THEN
      IF jsonb_typeof(p_value) <> 'boolean' THEN
        RAISE EXCEPTION 'setting_type_invalid' USING ERRCODE = '22023', DETAIL = 'tax_inclusive expects boolean';
      END IF;
      SELECT to_jsonb(tax_inclusive) INTO v_old FROM business_config WHERE id = 1;
      UPDATE business_config SET tax_inclusive = (p_value #>> '{}')::BOOLEAN, updated_at = now() WHERE id = 1;
      v_new := p_value;

    WHEN 'shift_variance_threshold_pct' THEN
      IF jsonb_typeof(p_value) <> 'number' THEN
        RAISE EXCEPTION 'setting_type_invalid' USING ERRCODE = '22023', DETAIL = 'shift_variance_threshold_pct expects number';
      END IF;
      IF (p_value #>> '{}')::NUMERIC < 0 THEN
        RAISE EXCEPTION 'setting_value_invalid' USING ERRCODE = '22023', DETAIL = 'shift_variance_threshold_pct must be >= 0';
      END IF;
      SELECT to_jsonb(shift_variance_threshold_pct) INTO v_old FROM business_config WHERE id = 1;
      UPDATE business_config SET shift_variance_threshold_pct = (p_value #>> '{}')::NUMERIC, updated_at = now() WHERE id = 1;
      v_new := p_value;

    WHEN 'shift_variance_threshold_abs' THEN
      IF jsonb_typeof(p_value) <> 'number' THEN
        RAISE EXCEPTION 'setting_type_invalid' USING ERRCODE = '22023', DETAIL = 'shift_variance_threshold_abs expects number';
      END IF;
      IF (p_value #>> '{}')::NUMERIC < 0 THEN
        RAISE EXCEPTION 'setting_value_invalid' USING ERRCODE = '22023', DETAIL = 'shift_variance_threshold_abs must be >= 0';
      END IF;
      SELECT to_jsonb(shift_variance_threshold_abs) INTO v_old FROM business_config WHERE id = 1;
      UPDATE business_config SET shift_variance_threshold_abs = (p_value #>> '{}')::NUMERIC, updated_at = now() WHERE id = 1;
      v_new := p_value;

    WHEN 'pos_quick_payment_amounts' THEN
      IF jsonb_typeof(p_value) <> 'array' THEN
        RAISE EXCEPTION 'setting_type_invalid' USING ERRCODE = '22023', DETAIL = 'pos_quick_payment_amounts expects array';
      END IF;
      FOR v_elem IN SELECT * FROM jsonb_array_elements(p_value) LOOP
        IF jsonb_typeof(v_elem) <> 'number' THEN
          RAISE EXCEPTION 'setting_value_invalid' USING ERRCODE = '22023', DETAIL = 'pos_quick_payment_amounts elements must be numbers';
        END IF;
        IF (v_elem #>> '{}')::NUMERIC <= 0 THEN
          RAISE EXCEPTION 'setting_value_invalid' USING ERRCODE = '22023', DETAIL = 'pos_quick_payment_amounts elements must be > 0';
        END IF;
      END LOOP;
      SELECT to_jsonb(pos_quick_payment_amounts) INTO v_old FROM business_config WHERE id = 1;
      UPDATE business_config SET pos_quick_payment_amounts = p_value, updated_at = now() WHERE id = 1;
      v_new := p_value;

    WHEN 'pos_opening_cash_presets' THEN
      IF jsonb_typeof(p_value) <> 'array' THEN
        RAISE EXCEPTION 'setting_type_invalid' USING ERRCODE = '22023', DETAIL = 'pos_opening_cash_presets expects array';
      END IF;
      FOR v_elem IN SELECT * FROM jsonb_array_elements(p_value) LOOP
        IF jsonb_typeof(v_elem) <> 'number' THEN
          RAISE EXCEPTION 'setting_value_invalid' USING ERRCODE = '22023', DETAIL = 'pos_opening_cash_presets elements must be numbers';
        END IF;
        IF (v_elem #>> '{}')::NUMERIC <= 0 THEN
          RAISE EXCEPTION 'setting_value_invalid' USING ERRCODE = '22023', DETAIL = 'pos_opening_cash_presets elements must be > 0';
        END IF;
      END LOOP;
      SELECT to_jsonb(pos_opening_cash_presets) INTO v_old FROM business_config WHERE id = 1;
      UPDATE business_config SET pos_opening_cash_presets = p_value, updated_at = now() WHERE id = 1;
      v_new := p_value;

    WHEN 'pos_discount_presets' THEN
      IF jsonb_typeof(p_value) <> 'array' THEN
        RAISE EXCEPTION 'setting_type_invalid' USING ERRCODE = '22023', DETAIL = 'pos_discount_presets expects array';
      END IF;
      FOR v_elem IN SELECT * FROM jsonb_array_elements(p_value) LOOP
        IF jsonb_typeof(v_elem) <> 'object' THEN
          RAISE EXCEPTION 'setting_value_invalid' USING ERRCODE = '22023', DETAIL = 'pos_discount_presets elements must be objects';
        END IF;
        v_elem_val  := v_elem -> 'value';
        v_elem_name := v_elem -> 'name';
        IF v_elem_val IS NULL OR jsonb_typeof(v_elem_val) <> 'number' THEN
          RAISE EXCEPTION 'setting_value_invalid' USING ERRCODE = '22023', DETAIL = 'pos_discount_presets.value must be a number';
        END IF;
        IF (v_elem_val #>> '{}')::NUMERIC < 0 OR (v_elem_val #>> '{}')::NUMERIC > 100 THEN
          RAISE EXCEPTION 'setting_value_invalid' USING ERRCODE = '22023', DETAIL = 'pos_discount_presets.value must be in [0, 100]';
        END IF;
        IF v_elem_name IS NULL OR jsonb_typeof(v_elem_name) <> 'string' OR (v_elem_name #>> '{}') = '' THEN
          RAISE EXCEPTION 'setting_value_invalid' USING ERRCODE = '22023', DETAIL = 'pos_discount_presets.name must be a non-empty string';
        END IF;
      END LOOP;
      SELECT to_jsonb(pos_discount_presets) INTO v_old FROM business_config WHERE id = 1;
      UPDATE business_config SET pos_discount_presets = p_value, updated_at = now() WHERE id = 1;
      v_new := p_value;

    ELSE
      RAISE EXCEPTION 'setting_unknown' USING ERRCODE = '22023', DETAIL = 'unknown setting key: ' || p_key;
  END CASE;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
    VALUES (
      v_actor_id,
      'setting.update',
      'setting',
      NULL,
      jsonb_build_object(
        'key',      p_key,
        'category', p_category,
        'old',      COALESCE(v_old, 'null'::jsonb),
        'new',      v_new
      )
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.set_setting_v1(TEXT, JSONB, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_setting_v1(TEXT, JSONB, TEXT) TO authenticated;

COMMENT ON FUNCTION public.set_setting_v1(TEXT, JSONB, TEXT) IS
  'Session 13 / Phase 5.C (extended Session 14 / Phase 2.D). Whitelist-driven setter for business_config singleton. Adds pos_quick_payment_amounts / pos_opening_cash_presets / pos_discount_presets keys (JSONB arrays) on top of the original 8 scalar columns. Per-element validation enforced inline. Writes audit_logs row per change.';
