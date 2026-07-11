-- 20260711000159_settings_org_display_printing.sql
-- S73 Lot 2 — promote customer-display copy + payment auto-toggles from
-- per-terminal localStorage to org-level business_config (audit
-- docs/workplan/audits/settings-pos-bo-audit.md, owner decision B1 2026-07-11).
-- Same-signature CREATE OR REPLACE (precedent: _128 S67); function bodies taken
-- from the LIVE pg_get_functiondef (DEV-S57-02), with only the new category /
-- key branches inserted. ACLs are preserved by CREATE OR REPLACE; the new
-- columns inherit business_config's existing RLS (auth_read / super_admin_write).
-- '' on the two text keys deliberately means "built-in default" (parity with
-- the former localStorage behaviour). NO BEGIN/COMMIT (MCP wraps).

ALTER TABLE business_config
  ADD COLUMN display_footer_message text    NOT NULL DEFAULT '',
  ADD COLUMN display_slogan         text    NOT NULL DEFAULT '',
  ADD COLUMN pos_auto_print_receipt boolean NOT NULL DEFAULT true,
  ADD COLUMN pos_auto_open_drawer   boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN business_config.display_footer_message IS
  'Customer display idle footer. '''' = built-in default (S73).';
COMMENT ON COLUMN business_config.display_slogan IS
  'Customer display brand slogan. '''' = built-in default (S73).';
COMMENT ON COLUMN business_config.pos_auto_print_receipt IS
  'Org default: auto-print receipt on payment success (S73).';
COMMENT ON COLUMN business_config.pos_auto_open_drawer IS
  'Org default: auto-open cash drawer on cash tender (S73).';

CREATE OR REPLACE FUNCTION public.get_settings_by_category_v1(p_category text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
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
        'shift_variance_threshold_abs', v_row.shift_variance_threshold_abs,
        'shift_variance_pin_threshold_pct', v_row.shift_variance_pin_threshold_pct,
        'shift_variance_pin_threshold_abs', v_row.shift_variance_pin_threshold_abs,
        'shift_denomination_count_enabled', v_row.shift_denomination_count_enabled
      )
      WHEN 'pos_presets' THEN jsonb_build_object(
        'pos_quick_payment_amounts', v_row.pos_quick_payment_amounts,
        'pos_opening_cash_presets',  v_row.pos_opening_cash_presets,
        'pos_discount_presets',      v_row.pos_discount_presets
      )
      WHEN 'inventory' THEN jsonb_build_object(
        'allow_negative_stock', v_row.allow_negative_stock
      )
      WHEN 'payments' THEN jsonb_build_object(
        'enabled_payment_methods', v_row.enabled_payment_methods
      )
      -- S73: org-level customer display copy + payment automation toggles
      WHEN 'customer_display' THEN jsonb_build_object(
        'display_footer_message', v_row.display_footer_message,
        'display_slogan',         v_row.display_slogan
      )
      WHEN 'printing' THEN jsonb_build_object(
        'pos_auto_print_receipt', v_row.pos_auto_print_receipt,
        'pos_auto_open_drawer',   v_row.pos_auto_open_drawer
      )
      ELSE '{}'::jsonb
    END;

  RETURN jsonb_build_object(
    'category', p_category,
    'settings', v_settings
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_setting_v1(p_key text, p_value jsonb, p_category text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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

    -- S66 (12 D2.1): manager-PIN thresholds for close_shift_v4 — mirror of the
    -- shift_variance_threshold_* cases above.
    WHEN 'shift_variance_pin_threshold_pct' THEN
      IF jsonb_typeof(p_value) <> 'number' THEN
        RAISE EXCEPTION 'setting_type_invalid' USING ERRCODE = '22023', DETAIL = 'shift_variance_pin_threshold_pct expects number';
      END IF;
      IF (p_value #>> '{}')::NUMERIC < 0 THEN
        RAISE EXCEPTION 'setting_value_invalid' USING ERRCODE = '22023', DETAIL = 'shift_variance_pin_threshold_pct must be >= 0';
      END IF;
      SELECT to_jsonb(shift_variance_pin_threshold_pct) INTO v_old FROM business_config WHERE id = 1;
      UPDATE business_config SET shift_variance_pin_threshold_pct = (p_value #>> '{}')::NUMERIC, updated_at = now() WHERE id = 1;
      v_new := p_value;

    WHEN 'shift_variance_pin_threshold_abs' THEN
      IF jsonb_typeof(p_value) <> 'number' THEN
        RAISE EXCEPTION 'setting_type_invalid' USING ERRCODE = '22023', DETAIL = 'shift_variance_pin_threshold_abs expects number';
      END IF;
      IF (p_value #>> '{}')::NUMERIC < 0 THEN
        RAISE EXCEPTION 'setting_value_invalid' USING ERRCODE = '22023', DETAIL = 'shift_variance_pin_threshold_abs must be >= 0';
      END IF;
      SELECT to_jsonb(shift_variance_pin_threshold_abs) INTO v_old FROM business_config WHERE id = 1;
      UPDATE business_config SET shift_variance_pin_threshold_abs = (p_value #>> '{}')::NUMERIC, updated_at = now() WHERE id = 1;
      v_new := p_value;

    -- S67 (12 D2.3): opt-in denomination-grid count at shift open/close —
    -- boolean case, mirror of tax_inclusive above.
    WHEN 'shift_denomination_count_enabled' THEN
      IF jsonb_typeof(p_value) <> 'boolean' THEN
        RAISE EXCEPTION 'setting_type_invalid' USING ERRCODE = '22023', DETAIL = 'shift_denomination_count_enabled expects boolean';
      END IF;
      SELECT to_jsonb(shift_denomination_count_enabled) INTO v_old FROM business_config WHERE id = 1;
      UPDATE business_config SET shift_denomination_count_enabled = (p_value #>> '{}')::BOOLEAN, updated_at = now() WHERE id = 1;
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

    WHEN 'allow_negative_stock' THEN
      IF jsonb_typeof(p_value) <> 'boolean' THEN
        RAISE EXCEPTION 'setting_type_invalid' USING ERRCODE = '22023', DETAIL = 'allow_negative_stock expects boolean';
      END IF;
      SELECT to_jsonb(allow_negative_stock) INTO v_old FROM business_config WHERE id = 1;
      UPDATE business_config SET allow_negative_stock = (p_value #>> '{}')::BOOLEAN, updated_at = now() WHERE id = 1;
      v_new := p_value;

    WHEN 'enabled_payment_methods' THEN
      IF jsonb_typeof(p_value) <> 'array' THEN
        RAISE EXCEPTION 'setting_type_invalid' USING ERRCODE = '22023',
          DETAIL = 'enabled_payment_methods expects array';
      END IF;
      IF jsonb_array_length(p_value) = 0 THEN
        RAISE EXCEPTION 'setting_value_invalid' USING ERRCODE = '22023',
          DETAIL = 'at least one payment method must remain enabled';
      END IF;
      FOR v_elem IN SELECT * FROM jsonb_array_elements(p_value) LOOP
        IF jsonb_typeof(v_elem) <> 'string'
           OR (v_elem #>> '{}') NOT IN ('cash','card','qris','edc','transfer','store_credit') THEN
          RAISE EXCEPTION 'setting_value_invalid' USING ERRCODE = '22023',
            DETAIL = 'unknown payment method: ' || COALESCE(v_elem #>> '{}', jsonb_typeof(v_elem));
        END IF;
      END LOOP;
      IF (SELECT COUNT(*) FROM jsonb_array_elements_text(p_value))
         <> (SELECT COUNT(DISTINCT e) FROM jsonb_array_elements_text(p_value) AS e) THEN
        RAISE EXCEPTION 'setting_value_invalid' USING ERRCODE = '22023',
          DETAIL = 'duplicate payment method';
      END IF;
      SELECT enabled_payment_methods INTO v_old FROM business_config WHERE id = 1;
      UPDATE business_config SET enabled_payment_methods = p_value, updated_at = now() WHERE id = 1;
      v_new := p_value;

    -- S73 Lot 2: org-level customer display copy ('' = built-in default) +
    -- payment automation toggles, editable from POS Printing/Display tabs
    -- and the BO Customer Display / Printing pages.
    WHEN 'display_footer_message' THEN
      IF jsonb_typeof(p_value) <> 'string' THEN
        RAISE EXCEPTION 'setting_type_invalid' USING ERRCODE = '22023', DETAIL = 'display_footer_message expects string';
      END IF;
      IF length(p_value #>> '{}') > 120 THEN
        RAISE EXCEPTION 'setting_value_invalid' USING ERRCODE = '22023', DETAIL = 'display_footer_message max 120 chars';
      END IF;
      SELECT to_jsonb(display_footer_message) INTO v_old FROM business_config WHERE id = 1;
      UPDATE business_config SET display_footer_message = p_value #>> '{}', updated_at = now() WHERE id = 1;
      v_new := p_value;

    WHEN 'display_slogan' THEN
      IF jsonb_typeof(p_value) <> 'string' THEN
        RAISE EXCEPTION 'setting_type_invalid' USING ERRCODE = '22023', DETAIL = 'display_slogan expects string';
      END IF;
      IF length(p_value #>> '{}') > 80 THEN
        RAISE EXCEPTION 'setting_value_invalid' USING ERRCODE = '22023', DETAIL = 'display_slogan max 80 chars';
      END IF;
      SELECT to_jsonb(display_slogan) INTO v_old FROM business_config WHERE id = 1;
      UPDATE business_config SET display_slogan = p_value #>> '{}', updated_at = now() WHERE id = 1;
      v_new := p_value;

    WHEN 'pos_auto_print_receipt' THEN
      IF jsonb_typeof(p_value) <> 'boolean' THEN
        RAISE EXCEPTION 'setting_type_invalid' USING ERRCODE = '22023', DETAIL = 'pos_auto_print_receipt expects boolean';
      END IF;
      SELECT to_jsonb(pos_auto_print_receipt) INTO v_old FROM business_config WHERE id = 1;
      UPDATE business_config SET pos_auto_print_receipt = (p_value #>> '{}')::BOOLEAN, updated_at = now() WHERE id = 1;
      v_new := p_value;

    WHEN 'pos_auto_open_drawer' THEN
      IF jsonb_typeof(p_value) <> 'boolean' THEN
        RAISE EXCEPTION 'setting_type_invalid' USING ERRCODE = '22023', DETAIL = 'pos_auto_open_drawer expects boolean';
      END IF;
      SELECT to_jsonb(pos_auto_open_drawer) INTO v_old FROM business_config WHERE id = 1;
      UPDATE business_config SET pos_auto_open_drawer = (p_value #>> '{}')::BOOLEAN, updated_at = now() WHERE id = 1;
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
