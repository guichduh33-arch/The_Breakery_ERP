-- 20260813000007_get_settings_hub_summary_v1.sql
--
-- Lot 5 chantier 1 (brief /impeccable shape validé par Mamat le 2026-08-13) —
-- le hub Réglages instancie enfin l'archétype « chaque tuile porte sa valeur
-- courante » (DESIGN.md § archétype 5). Un seul aller-retour, lecture seule.
--
-- Sécurité : SECURITY DEFINER (les tables lues ne sont pas toutes ouvertes en
-- RLS à tout le personnel) ; l'appelant doit être authentifié avec un profil
-- actif ; les sections gatées reproduisent EXACTEMENT les permissions des
-- tuiles/routes du hub (tables.update, settings.security.manage,
-- accounting.period.close, expenses.thresholds.read, lan.devices.read) via le
-- helper has_permission(auth.uid(), …). Une section absente = tuile sans
-- valeur côté client (tiret) — jamais une erreur.

CREATE FUNCTION public.get_settings_hub_summary_v1()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid        uuid := auth.uid();
  v_profile_id uuid;
  bc           business_config%ROWTYPE;
  v_next_holiday record;
  v_out        jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;
  SELECT id INTO v_profile_id
    FROM user_profiles
   WHERE auth_user_id = v_uid AND deleted_at IS NULL
   LIMIT 1;
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'no_active_profile' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO bc FROM business_config LIMIT 1;

  SELECT h.date, h.name INTO v_next_holiday
    FROM holidays h
   WHERE h.deleted_at IS NULL AND h.date >= CURRENT_DATE
   ORDER BY h.date
   LIMIT 1;

  v_out := jsonb_build_object(
    'company', jsonb_build_object(
      'name',          bc.name,
      'currency',      bc.currency,
      'tax_inclusive', bc.tax_inclusive,
      'tax_rate',      bc.tax_rate),
    'business_hours', coalesce(bc.business_hours, '{}'::jsonb),
    'holidays', jsonb_build_object(
      'upcoming_count', (SELECT count(*) FROM holidays
                          WHERE deleted_at IS NULL AND date >= CURRENT_DATE),
      'next_date', v_next_holiday.date,
      'next_name', v_next_holiday.name),
    'pos_config', jsonb_build_object(
      'quick_amounts',    coalesce(jsonb_array_length(bc.pos_quick_payment_amounts), 0),
      'opening_presets',  coalesce(jsonb_array_length(bc.pos_opening_cash_presets), 0),
      'discount_presets', coalesce(jsonb_array_length(bc.pos_discount_presets), 0)),
    'payment_methods', jsonb_build_object(
      'enabled', coalesce(jsonb_array_length(bc.enabled_payment_methods), 0)),
    'printing', jsonb_build_object(
      'auto_print_receipt', bc.pos_auto_print_receipt,
      'auto_open_drawer',   bc.pos_auto_open_drawer),
    'kds', jsonb_build_object(
      'warning_minutes',      bc.kds_warning_threshold_minutes,
      'urgent_minutes',       bc.kds_urgent_threshold_minutes,
      'auto_archive_minutes', bc.kds_auto_archive_minutes),
    'customer_display', jsonb_build_object(
      'slogan_set',        bc.display_slogan IS NOT NULL AND bc.display_slogan <> '',
      'showcase_count',    coalesce(jsonb_array_length(bc.display_showcase_product_ids), 0),
      'show_ready_orders', bc.display_show_ready_orders),
    'inventory', jsonb_build_object(
      'allow_negative_stock', bc.allow_negative_stock),
    'notifications', (SELECT jsonb_build_object(
        'active', count(*) FILTER (WHERE is_active), 'total', count(*))
      FROM notification_templates),
    'email_templates', (SELECT jsonb_build_object(
        'active', count(*) FILTER (WHERE is_active), 'total', count(*))
      FROM email_templates),
    'receipt_templates', (SELECT jsonb_build_object(
        'total', count(*),
        'default_name', (SELECT name FROM receipt_templates WHERE is_default LIMIT 1))
      FROM receipt_templates),
    'permissions', (SELECT jsonb_build_object('roles', count(*)) FROM roles)
  );

  IF has_permission(v_uid, 'tables.update') THEN
    v_out := v_out || jsonb_build_object('floor_plan',
      (SELECT jsonb_build_object('active_tables', count(*))
         FROM restaurant_tables WHERE deleted_at IS NULL AND is_active));
  END IF;
  IF has_permission(v_uid, 'settings.security.manage') THEN
    v_out := v_out || jsonb_build_object('security', jsonb_build_object(
      'pin_max_failed',      bc.pin_max_failed,
      'pin_lockout_minutes', bc.pin_lockout_minutes));
  END IF;
  IF has_permission(v_uid, 'accounting.period.close') THEN
    v_out := v_out || jsonb_build_object('accounting',
      (SELECT jsonb_build_object('open_period_start', min(period_start))
         FROM fiscal_periods WHERE status = 'open'));
  END IF;
  IF has_permission(v_uid, 'expenses.thresholds.read') THEN
    v_out := v_out || jsonb_build_object('expense_thresholds',
      (SELECT jsonb_build_object('tiers', count(*)) FROM expense_approval_thresholds));
  END IF;
  IF has_permission(v_uid, 'lan.devices.read') THEN
    v_out := v_out || jsonb_build_object('lan_devices',
      (SELECT jsonb_build_object(
          'active', count(*) FILTER (WHERE is_active), 'total', count(*))
         FROM lan_devices WHERE deleted_at IS NULL));
  END IF;

  RETURN v_out;
END $$;

COMMENT ON FUNCTION public.get_settings_hub_summary_v1() IS
  'Résumé agrégé du hub Réglages (lot 5.1, 2026-08-13) — sections gatées par les permissions des tuiles.';

-- Défense en profondeur anon (CLAUDE.md § Grants) : anon hérite EXECUTE via
-- PUBLIC, le REVOKE doit viser les deux + les privilèges par défaut.
REVOKE EXECUTE ON FUNCTION public.get_settings_hub_summary_v1() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_settings_hub_summary_v1() FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_settings_hub_summary_v1() TO authenticated;
