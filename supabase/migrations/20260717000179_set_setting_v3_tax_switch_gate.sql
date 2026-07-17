-- 20260717000179_set_setting_v3_tax_switch_gate.sql
-- Lot 6b (Settings, ADR-006 décision 7) — bascule tax_inclusive gardée.
--
-- Le Lot 6a a rendu le réglage global `tax_inclusive` effectif par construction
-- (`_pb1_split_v1`, unique porteur de la formule PB1). Rendre la bascule
-- UTILISABLE exige un garde-fou : une commande ouverte au moment du flip
-- verrait son total recalculé sous le nouveau mode au paiement ou à l'édition
-- (_recalc_order_totals → _pb1_split_v1) — le client paierait un montant
-- différent de celui annoncé.
--
-- Arbitrage propriétaire (2026-07-17, confirmé en session Lot 6b) :
--   * la bascule est REFUSÉE tant qu'il existe des commandes `draft` ou
--     `pending_payment` (erreur `tax_mode_switch_blocked`, P0001) ;
--   * un write no-op (même valeur) reste permis — le gate ne s'applique
--     qu'au changement effectif de mode ;
--   * `b2b_pending` est exclu du gate : hors champ PBJT (ADR-005,
--     `tax_amount = 0` délibéré), la bascule n'a aucun effet sur ces commandes ;
--   * aucune conversion automatique des prix — le réglage change
--     l'interprétation de `retail_price` (TTC ↔ HT), pas sa valeur.
--
-- Corps repris de la définition LIVE de set_setting_v2 (pg_get_functiondef,
-- 2026-07-17) ; seuls le nom, la déclaration `v_open_orders` et la branche
-- `tax_inclusive` changent. v2 est droppée dans la même migration
-- (versioning monotone).

CREATE FUNCTION public.set_setting_v3(p_key text, p_value jsonb, p_category text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor_id    UUID;
  v_old         JSONB;
  v_new         JSONB;
  v_elem        JSONB;
  v_elem_val    JSONB;
  v_elem_name   JSONB;
  v_open_orders INT;
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

    -- v2 (Settings §6.A): company identity on documents + internal alert email.
    -- All four are string-or-null (fiscal_address pattern); empty/whitespace
    -- strings normalize to NULL so "cleared field" and "never set" read the same.
    WHEN 'npwp' THEN
      IF p_value <> 'null'::jsonb AND jsonb_typeof(p_value) <> 'string' THEN
        RAISE EXCEPTION 'setting_type_invalid' USING ERRCODE = '22023', DETAIL = 'npwp expects string or null';
      END IF;
      IF jsonb_typeof(p_value) = 'string' AND length(trim(p_value #>> '{}')) > 30 THEN
        RAISE EXCEPTION 'setting_value_invalid' USING ERRCODE = '22023', DETAIL = 'npwp max 30 chars';
      END IF;
      SELECT to_jsonb(npwp) INTO v_old FROM business_config WHERE id = 1;
      UPDATE business_config
        SET npwp = CASE WHEN p_value = 'null'::jsonb THEN NULL ELSE NULLIF(trim(p_value #>> '{}'), '') END,
            updated_at = now()
        WHERE id = 1;
      v_new := p_value;

    WHEN 'phone' THEN
      IF p_value <> 'null'::jsonb AND jsonb_typeof(p_value) <> 'string' THEN
        RAISE EXCEPTION 'setting_type_invalid' USING ERRCODE = '22023', DETAIL = 'phone expects string or null';
      END IF;
      IF jsonb_typeof(p_value) = 'string' AND length(trim(p_value #>> '{}')) > 30 THEN
        RAISE EXCEPTION 'setting_value_invalid' USING ERRCODE = '22023', DETAIL = 'phone max 30 chars';
      END IF;
      SELECT to_jsonb(phone) INTO v_old FROM business_config WHERE id = 1;
      UPDATE business_config
        SET phone = CASE WHEN p_value = 'null'::jsonb THEN NULL ELSE NULLIF(trim(p_value #>> '{}'), '') END,
            updated_at = now()
        WHERE id = 1;
      v_new := p_value;

    WHEN 'logo_url' THEN
      IF p_value <> 'null'::jsonb AND jsonb_typeof(p_value) <> 'string' THEN
        RAISE EXCEPTION 'setting_type_invalid' USING ERRCODE = '22023', DETAIL = 'logo_url expects string or null';
      END IF;
      IF jsonb_typeof(p_value) = 'string' AND trim(p_value #>> '{}') <> '' THEN
        IF length(trim(p_value #>> '{}')) > 500 THEN
          RAISE EXCEPTION 'setting_value_invalid' USING ERRCODE = '22023', DETAIL = 'logo_url max 500 chars';
        END IF;
        IF trim(p_value #>> '{}') !~* '^https://' THEN
          RAISE EXCEPTION 'setting_value_invalid' USING ERRCODE = '22023', DETAIL = 'logo_url must start with https://';
        END IF;
      END IF;
      SELECT to_jsonb(logo_url) INTO v_old FROM business_config WHERE id = 1;
      UPDATE business_config
        SET logo_url = CASE WHEN p_value = 'null'::jsonb THEN NULL ELSE NULLIF(trim(p_value #>> '{}'), '') END,
            updated_at = now()
        WHERE id = 1;
      v_new := p_value;

    WHEN 'alert_email' THEN
      IF p_value <> 'null'::jsonb AND jsonb_typeof(p_value) <> 'string' THEN
        RAISE EXCEPTION 'setting_type_invalid' USING ERRCODE = '22023', DETAIL = 'alert_email expects string or null';
      END IF;
      IF jsonb_typeof(p_value) = 'string' AND trim(p_value #>> '{}') <> '' THEN
        IF length(trim(p_value #>> '{}')) > 254 THEN
          RAISE EXCEPTION 'setting_value_invalid' USING ERRCODE = '22023', DETAIL = 'alert_email max 254 chars';
        END IF;
        IF trim(p_value #>> '{}') !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
          RAISE EXCEPTION 'setting_value_invalid' USING ERRCODE = '22023', DETAIL = 'alert_email must be a valid email address';
        END IF;
      END IF;
      SELECT to_jsonb(alert_email) INTO v_old FROM business_config WHERE id = 1;
      UPDATE business_config
        SET alert_email = CASE WHEN p_value = 'null'::jsonb THEN NULL ELSE NULLIF(trim(p_value #>> '{}'), '') END,
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
      -- Lot 6b — le flip du mode fiscal est refusé tant que des commandes
      -- ouvertes existent : leur total serait recalculé sous le nouveau mode
      -- au paiement/à l'édition (_recalc_order_totals → _pb1_split_v1).
      -- Un write no-op (même valeur) reste permis. b2b_pending exclu :
      -- hors champ PBJT (tax_amount = 0 délibéré), le mode n'a aucun effet.
      IF (p_value #>> '{}')::BOOLEAN IS DISTINCT FROM (v_old #>> '{}')::BOOLEAN THEN
        SELECT COUNT(*) INTO v_open_orders
          FROM orders
          WHERE status IN ('draft', 'pending_payment');
        IF v_open_orders > 0 THEN
          RAISE EXCEPTION 'tax_mode_switch_blocked' USING ERRCODE = 'P0001',
            DETAIL = v_open_orders || ' open order(s) (draft/pending_payment) must be paid or voided before switching the tax mode';
        END IF;
      END IF;
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
    -- boolean case, mirror of tax_inclusive above (without the switch gate).
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

    -- S75 (Task 5): KDS ticket-age color-band thresholds + auto-archive delay.
    -- Integer minutes in [1, 120]; warning must stay strictly below urgent in
    -- both directions (whichever branch runs last re-validates against the
    -- other's CURRENT stored value, so "set urgent first, then warning" and
    -- "set warning first, then urgent" both converge to a consistent pair).
    WHEN 'kds_warning_threshold_minutes' THEN
      IF jsonb_typeof(p_value) <> 'number' THEN
        RAISE EXCEPTION 'setting_type_invalid' USING ERRCODE = '22023', DETAIL = 'kds_warning_threshold_minutes expects integer';
      END IF;
      IF (p_value #>> '{}')::NUMERIC <> floor((p_value #>> '{}')::NUMERIC)
         OR (p_value #>> '{}')::NUMERIC < 1 OR (p_value #>> '{}')::NUMERIC > 120 THEN
        RAISE EXCEPTION 'setting_value_invalid' USING ERRCODE = '22023', DETAIL = 'kds_warning_threshold_minutes must be an integer in [1, 120]';
      END IF;
      IF (p_value #>> '{}')::INT >= (SELECT kds_urgent_threshold_minutes FROM business_config WHERE id = 1) THEN
        RAISE EXCEPTION 'setting_value_invalid' USING ERRCODE = '22023', DETAIL = 'kds_warning_threshold_minutes must be < kds_urgent_threshold_minutes';
      END IF;
      SELECT to_jsonb(kds_warning_threshold_minutes) INTO v_old FROM business_config WHERE id = 1;
      UPDATE business_config SET kds_warning_threshold_minutes = (p_value #>> '{}')::INT, updated_at = now() WHERE id = 1;
      v_new := p_value;

    WHEN 'kds_urgent_threshold_minutes' THEN
      IF jsonb_typeof(p_value) <> 'number' THEN
        RAISE EXCEPTION 'setting_type_invalid' USING ERRCODE = '22023', DETAIL = 'kds_urgent_threshold_minutes expects integer';
      END IF;
      IF (p_value #>> '{}')::NUMERIC <> floor((p_value #>> '{}')::NUMERIC)
         OR (p_value #>> '{}')::NUMERIC < 1 OR (p_value #>> '{}')::NUMERIC > 120 THEN
        RAISE EXCEPTION 'setting_value_invalid' USING ERRCODE = '22023', DETAIL = 'kds_urgent_threshold_minutes must be an integer in [1, 120]';
      END IF;
      IF (p_value #>> '{}')::INT <= (SELECT kds_warning_threshold_minutes FROM business_config WHERE id = 1) THEN
        RAISE EXCEPTION 'setting_value_invalid' USING ERRCODE = '22023', DETAIL = 'kds_urgent_threshold_minutes must be > kds_warning_threshold_minutes';
      END IF;
      SELECT to_jsonb(kds_urgent_threshold_minutes) INTO v_old FROM business_config WHERE id = 1;
      UPDATE business_config SET kds_urgent_threshold_minutes = (p_value #>> '{}')::INT, updated_at = now() WHERE id = 1;
      v_new := p_value;

    WHEN 'kds_auto_archive_minutes' THEN
      IF jsonb_typeof(p_value) <> 'number' THEN
        RAISE EXCEPTION 'setting_type_invalid' USING ERRCODE = '22023', DETAIL = 'kds_auto_archive_minutes expects integer';
      END IF;
      IF (p_value #>> '{}')::NUMERIC <> floor((p_value #>> '{}')::NUMERIC)
         OR (p_value #>> '{}')::NUMERIC < 1 OR (p_value #>> '{}')::NUMERIC > 120 THEN
        RAISE EXCEPTION 'setting_value_invalid' USING ERRCODE = '22023', DETAIL = 'kds_auto_archive_minutes must be an integer in [1, 120]';
      END IF;
      SELECT to_jsonb(kds_auto_archive_minutes) INTO v_old FROM business_config WHERE id = 1;
      UPDATE business_config SET kds_auto_archive_minutes = (p_value #>> '{}')::INT, updated_at = now() WHERE id = 1;
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

-- Versioning monotone : v2 droppée dans la même migration.
DROP FUNCTION public.set_setting_v2(text, jsonb, text);

-- Defense-in-depth anon (CLAUDE.md) : trio REVOKE + grants explicites
-- (mêmes ACLs que v2 : authenticated + service_role, jamais anon).
REVOKE EXECUTE ON FUNCTION public.set_setting_v3(text, jsonb, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_setting_v3(text, jsonb, text) FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_setting_v3(text, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_setting_v3(text, jsonb, text) TO service_role;

COMMENT ON FUNCTION public.set_setting_v3(text, jsonb, text) IS
  'Lot 6b — écriture des réglages business_config (validation par clé, '
  'audit-log old/new). v3 : la bascule de tax_inclusive est refusée '
  '(tax_mode_switch_blocked, P0001) tant que des commandes draft ou '
  'pending_payment existent ; un write no-op reste permis. b2b_pending '
  'exclu du gate (hors champ PBJT, tax_amount = 0 délibéré).';
