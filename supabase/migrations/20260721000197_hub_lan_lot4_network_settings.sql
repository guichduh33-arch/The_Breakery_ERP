-- 20260721000197_hub_lan_lot4_network_settings.sql
-- Spec 006x (hub LAN) lot 4 — §5 : nouvelle catégorie symbolique `network`
-- sur business_config pour le cash hors-ligne différé :
--   * offline_cash_enabled BOOLEAN NOT NULL DEFAULT false — activation
--     EXPLICITE du cash offline (arbitrage A1b ; défaut fermé) ;
--   * offline_max_hours INTEGER NOT NULL DEFAULT 4, CHECK [1, 24] — fenêtre
--     offline maximale (arbitrage A5 : 4 h) ; au-delà, le POS bloque les
--     nouveaux encaissements cash (bannière rouge).
--
-- Cérémonie RPC (versioning monotone, corps repris du LIVE pg_get_functiondef
-- du 2026-07-21 — md5 vérifié IDENTIQUE au fichier _195, pas de drift) :
--   * set_setting_v4 → v5 : + 2 branches WHEN (boolean pattern tax_inclusive,
--     entier pattern kds_thresholds), v4 droppée ici même ;
--   * get_settings_by_category_v3 → v4 : + branche 'network', v3 droppée ici même.
-- Aucune edge function n'appelle ces RPCs (vérifié par grep supabase/functions).

-- ---------------------------------------------------------------------------
-- 1. Colonnes
-- ---------------------------------------------------------------------------

ALTER TABLE public.business_config
  ADD COLUMN offline_cash_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN offline_max_hours INTEGER NOT NULL DEFAULT 4
    CONSTRAINT business_config_offline_max_hours_range CHECK (offline_max_hours BETWEEN 1 AND 24);

COMMENT ON COLUMN public.business_config.offline_cash_enabled IS
  'Spec 006x lot 4 (A1b) : autorise l''encaissement CASH en mode hors-ligne LAN (outbox durable rejouée au retour cloud). Défaut false = activation explicite.';
COMMENT ON COLUMN public.business_config.offline_max_hours IS
  'Spec 006x lot 4 (A5) : fenêtre offline maximale en heures. Au-delà, le POS refuse de nouveaux encaissements cash offline jusqu''au retour du cloud.';

-- ---------------------------------------------------------------------------
-- 2. set_setting_v5 — corps live de v4 + 2 branches network
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.set_setting_v5(p_key text, p_value jsonb, p_category text)
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

    -- v4 (chantier KOT copies, 2026-07-18): copies du ticket cuisine papier par
    -- station à l'envoi. Entier [0, 5] ; 0 = pas d'impression pour la station
    -- (le KDS écran reçoit toujours). Pattern des seuils KDS ci-dessous.
    WHEN 'kot_copies_barista' THEN
      IF jsonb_typeof(p_value) <> 'number' THEN
        RAISE EXCEPTION 'setting_type_invalid' USING ERRCODE = '22023', DETAIL = 'kot_copies_barista expects integer';
      END IF;
      IF (p_value #>> '{}')::NUMERIC <> floor((p_value #>> '{}')::NUMERIC)
         OR (p_value #>> '{}')::NUMERIC < 0 OR (p_value #>> '{}')::NUMERIC > 5 THEN
        RAISE EXCEPTION 'setting_value_invalid' USING ERRCODE = '22023', DETAIL = 'kot_copies_barista must be an integer in [0, 5]';
      END IF;
      SELECT to_jsonb(kot_copies_barista) INTO v_old FROM business_config WHERE id = 1;
      UPDATE business_config SET kot_copies_barista = (p_value #>> '{}')::INT, updated_at = now() WHERE id = 1;
      v_new := p_value;

    WHEN 'kot_copies_kitchen' THEN
      IF jsonb_typeof(p_value) <> 'number' THEN
        RAISE EXCEPTION 'setting_type_invalid' USING ERRCODE = '22023', DETAIL = 'kot_copies_kitchen expects integer';
      END IF;
      IF (p_value #>> '{}')::NUMERIC <> floor((p_value #>> '{}')::NUMERIC)
         OR (p_value #>> '{}')::NUMERIC < 0 OR (p_value #>> '{}')::NUMERIC > 5 THEN
        RAISE EXCEPTION 'setting_value_invalid' USING ERRCODE = '22023', DETAIL = 'kot_copies_kitchen must be an integer in [0, 5]';
      END IF;
      SELECT to_jsonb(kot_copies_kitchen) INTO v_old FROM business_config WHERE id = 1;
      UPDATE business_config SET kot_copies_kitchen = (p_value #>> '{}')::INT, updated_at = now() WHERE id = 1;
      v_new := p_value;

    WHEN 'kot_copies_display' THEN
      IF jsonb_typeof(p_value) <> 'number' THEN
        RAISE EXCEPTION 'setting_type_invalid' USING ERRCODE = '22023', DETAIL = 'kot_copies_display expects integer';
      END IF;
      IF (p_value #>> '{}')::NUMERIC <> floor((p_value #>> '{}')::NUMERIC)
         OR (p_value #>> '{}')::NUMERIC < 0 OR (p_value #>> '{}')::NUMERIC > 5 THEN
        RAISE EXCEPTION 'setting_value_invalid' USING ERRCODE = '22023', DETAIL = 'kot_copies_display must be an integer in [0, 5]';
      END IF;
      SELECT to_jsonb(kot_copies_display) INTO v_old FROM business_config WHERE id = 1;
      UPDATE business_config SET kot_copies_display = (p_value #>> '{}')::INT, updated_at = now() WHERE id = 1;
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

    -- v5 (spec 006x lot 4, hub LAN) : catégorie network — encaissement cash
    -- hors-ligne (arbitrages A1/A5). offline_cash_enabled : activation
    -- EXPLICITE (défaut false) du cash différé quand le cloud est down.
    -- offline_max_hours : fenêtre offline maximale en heures (défaut 4, A5) —
    -- au-delà le POS bloque les nouveaux encaissements cash.
    WHEN 'offline_cash_enabled' THEN
      IF jsonb_typeof(p_value) <> 'boolean' THEN
        RAISE EXCEPTION 'setting_type_invalid' USING ERRCODE = '22023', DETAIL = 'offline_cash_enabled expects boolean';
      END IF;
      SELECT to_jsonb(offline_cash_enabled) INTO v_old FROM business_config WHERE id = 1;
      UPDATE business_config SET offline_cash_enabled = (p_value #>> '{}')::BOOLEAN, updated_at = now() WHERE id = 1;
      v_new := p_value;

    WHEN 'offline_max_hours' THEN
      IF jsonb_typeof(p_value) <> 'number' THEN
        RAISE EXCEPTION 'setting_type_invalid' USING ERRCODE = '22023', DETAIL = 'offline_max_hours expects integer';
      END IF;
      IF (p_value #>> '{}')::NUMERIC <> floor((p_value #>> '{}')::NUMERIC)
         OR (p_value #>> '{}')::NUMERIC < 1 OR (p_value #>> '{}')::NUMERIC > 24 THEN
        RAISE EXCEPTION 'setting_value_invalid' USING ERRCODE = '22023', DETAIL = 'offline_max_hours must be an integer in [1, 24]';
      END IF;
      SELECT to_jsonb(offline_max_hours) INTO v_old FROM business_config WHERE id = 1;
      UPDATE business_config SET offline_max_hours = (p_value #>> '{}')::INT, updated_at = now() WHERE id = 1;
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

-- Versioning monotone : v4 droppée dans la même migration.
DROP FUNCTION public.set_setting_v4(text, jsonb, text);

-- ---------------------------------------------------------------------------
-- 3. get_settings_by_category_v4 — corps live de v3 + branche 'network'
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.get_settings_by_category_v4(p_category text)
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
      -- v2 (Settings §6.A): identity keys npwp/phone/logo_url + alert_email.
      WHEN 'business' THEN jsonb_build_object(
        'name',           v_row.name,
        'fiscal_address', v_row.fiscal_address,
        'npwp',           v_row.npwp,
        'phone',          v_row.phone,
        'logo_url',       v_row.logo_url,
        'alert_email',    v_row.alert_email
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
      -- v3 (chantier KOT copies, 2026-07-18): copies du ticket cuisine papier
      -- par station à l'envoi (0 = KDS écran seulement).
      WHEN 'printing' THEN jsonb_build_object(
        'pos_auto_print_receipt', v_row.pos_auto_print_receipt,
        'pos_auto_open_drawer',   v_row.pos_auto_open_drawer,
        'kot_copies_barista',     v_row.kot_copies_barista,
        'kot_copies_kitchen',     v_row.kot_copies_kitchen,
        'kot_copies_display',     v_row.kot_copies_display
      )
      -- S75 (Task 5): KDS timer thresholds — warning/urgent color bands +
      -- auto-archive delay for served/bumped tickets on the kitchen display.
      WHEN 'kds' THEN jsonb_build_object(
        'kds_warning_threshold_minutes', v_row.kds_warning_threshold_minutes,
        'kds_urgent_threshold_minutes',  v_row.kds_urgent_threshold_minutes,
        'kds_auto_archive_minutes',      v_row.kds_auto_archive_minutes
      )
      -- v4 (spec 006x lot 4) : réglages du mode hors-ligne LAN (cash différé).
      WHEN 'network' THEN jsonb_build_object(
        'offline_cash_enabled', v_row.offline_cash_enabled,
        'offline_max_hours',    v_row.offline_max_hours
      )
      ELSE '{}'::jsonb
    END;

  RETURN jsonb_build_object(
    'category', p_category,
    'settings', v_settings
  );
END;
$function$;

-- Versioning monotone : v3 droppée dans la même migration.
DROP FUNCTION public.get_settings_by_category_v3(text);

-- ---------------------------------------------------------------------------
-- 4. Grants — REVOKE trio (anon defense-in-depth) + miroir des ACLs v4/v3
-- ---------------------------------------------------------------------------

REVOKE EXECUTE ON FUNCTION public.set_setting_v5(text, jsonb, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_setting_v5(text, jsonb, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.set_setting_v5(text, jsonb, text) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.get_settings_by_category_v4(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_settings_by_category_v4(text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_settings_by_category_v4(text) TO authenticated, service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

COMMENT ON FUNCTION public.set_setting_v5(text, jsonb, text) IS
  'Écriture des réglages business_config (validation par clé, audit-log '
  'old/new, gate tax_inclusive inchangé). v5 : + offline_cash_enabled / '
  'offline_max_hours — cash hors-ligne LAN (spec 006x lot 4, A1b/A5).';

COMMENT ON FUNCTION public.get_settings_by_category_v4(text) IS
  'Lecture des réglages business_config par catégorie symbolique. v4 : + '
  'catégorie network (offline_cash_enabled, offline_max_hours).';
