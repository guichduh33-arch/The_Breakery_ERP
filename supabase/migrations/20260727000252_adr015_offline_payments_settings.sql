-- 20260727000252_adr015_offline_payments_settings.sql
-- ADR-015 — encaissement hors-ligne étendu à tous les moyens de paiement sauf
-- l'avoir. Volet réglages :
--   * business_config.offline_cash_enabled → offline_payments_enabled (le
--     périmètre n'est plus le cash ; défaut false INCHANGÉ, activation explicite) ;
--   * business_config.offline_max_hours SUPPRIMÉE — une coupure longue ne bloque
--     plus les encaissements (la vente continue d'entrer, l'EDC ne dépend pas
--     du réseau boutique) ;
--   * set_setting_v10 → v11, get_settings_by_category_v8 → v9.
--
-- NOTE DE MÉTHODE — set_setting_v11 n'est pas recopiée à la main.
-- Le corps de v10 fait 32,5 KB et pilote une quarantaine de clés de réglages
-- sans rapport avec ce chantier (taxes, seuils de variance, PIN, KDS…). Une
-- coquille de transcription dans l'une d'elles passerait inaperçue. La fonction
-- est donc dérivée du CORPS LIVE (pg_get_functiondef, conformément à CLAUDE.md)
-- par une transformation textuelle GUARDÉE : chaque motif attendu est vérifié
-- avant substitution, et le résultat est contrôlé après. Toute dérive de v10
-- par rapport à ce qui est attendu fait ÉCHOUER la migration au lieu de
-- produire une fonction silencieusement fausse.

-- ---------------------------------------------------------------------------
-- 1. Colonnes business_config
-- ---------------------------------------------------------------------------

ALTER TABLE public.business_config
  RENAME COLUMN offline_cash_enabled TO offline_payments_enabled;

ALTER TABLE public.business_config
  DROP CONSTRAINT IF EXISTS business_config_offline_max_hours_range;

ALTER TABLE public.business_config
  DROP COLUMN offline_max_hours;

COMMENT ON COLUMN public.business_config.offline_payments_enabled IS
  'ADR-015 : autorise l''encaissement HORS-LIGNE LAN (outbox durable rejouée au retour cloud), toutes méthodes de payment_method SAUF store_credit. Défaut false = activation explicite. Ex-offline_cash_enabled (spec 006x lot 4).';

-- ---------------------------------------------------------------------------
-- 2. get_settings_by_category_v9 — copie explicite de v8, catégorie `network`
--    réduite à une clé. 4 KB : recopie sûre, contrairement à set_setting.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_settings_by_category_v9(p_category text)
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
        'alert_email',    v_row.alert_email,
        'business_hours', v_row.business_hours
      )
      WHEN 'security' THEN jsonb_build_object(
        'pin_max_failed',      v_row.pin_max_failed,
        'pin_lockout_minutes', v_row.pin_lockout_minutes
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
        'enabled_payment_methods',    v_row.enabled_payment_methods,
        'payment_method_fees',        v_row.payment_method_fees,
        'store_credit_expiry_months', v_row.store_credit_expiry_months
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
      -- v9 (ADR-015) : mode hors-ligne LAN, tous moyens de paiement sauf
      -- l'avoir. offline_max_hours retirée avec la fenêtre de blocage.
      WHEN 'network' THEN jsonb_build_object(
        'offline_payments_enabled', v_row.offline_payments_enabled
      )
      ELSE '{}'::jsonb
    END;

  RETURN jsonb_build_object(
    'category', p_category,
    'settings', v_settings
  );
END;
$function$;

DROP FUNCTION IF EXISTS public.get_settings_by_category_v8(p_category text);

-- ---------------------------------------------------------------------------
-- 3. set_setting_v11 — dérivée GUARDÉE du corps live de v10
-- ---------------------------------------------------------------------------

DO $mig$
DECLARE
  v_src   TEXT;
  v_out   TEXT;
  v_start INT;
  v_end   INT;
  v_new_branch CONSTANT TEXT :=
    '    -- v11 (ADR-015) : catégorie network — encaissement HORS-LIGNE LAN,' || chr(10) ||
    '    -- toutes méthodes sauf store_credit. offline_payments_enabled (ex' || chr(10) ||
    '    -- offline_cash_enabled) : activation EXPLICITE, défaut false. La' || chr(10) ||
    '    -- fenêtre offline_max_hours est supprimée — une coupure longue ne' || chr(10) ||
    '    -- bloque plus la caisse.' || chr(10) ||
    '    WHEN ''offline_payments_enabled'' THEN' || chr(10) ||
    '      IF jsonb_typeof(p_value) <> ''boolean'' THEN' || chr(10) ||
    '        RAISE EXCEPTION ''setting_type_invalid'' USING ERRCODE = ''22023'', DETAIL = ''offline_payments_enabled expects boolean'';' || chr(10) ||
    '      END IF;' || chr(10) ||
    '      SELECT to_jsonb(offline_payments_enabled) INTO v_old FROM business_config WHERE id = 1;' || chr(10) ||
    '      UPDATE business_config SET offline_payments_enabled = (p_value #>> ''{}'')::BOOLEAN, updated_at = now() WHERE id = 1;' || chr(10) ||
    '      v_new := p_value;' || chr(10) || chr(10);
  v_else_anchor CONSTANT TEXT :=
    '    ELSE' || chr(10) || '      RAISE EXCEPTION ''setting_unknown''';
  v_comment_anchor CONSTANT TEXT := '    -- v5 (spec 006x lot 4, hub LAN)';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'set_setting_v10';

  IF v_src IS NULL THEN
    RAISE EXCEPTION 'ADR-015: set_setting_v10 introuvable — version live inattendue';
  END IF;

  -- Garde 1 : les deux branches à retirer doivent être présentes.
  IF position('WHEN ''offline_cash_enabled'' THEN' IN v_src) = 0
     OR position('WHEN ''offline_max_hours'' THEN' IN v_src) = 0 THEN
    RAISE EXCEPTION 'ADR-015: branches offline absentes de set_setting_v10 — corps inattendu';
  END IF;

  -- Garde 2 : les ancres de découpe doivent être uniques et ordonnées.
  v_start := position(v_comment_anchor IN v_src);
  v_end   := position(v_else_anchor IN v_src);
  IF v_start = 0 OR v_end = 0 OR v_end <= v_start THEN
    RAISE EXCEPTION 'ADR-015: ancres de découpe introuvables (start=%, end=%)', v_start, v_end;
  END IF;

  -- Découpe : tout ce qui précède le bloc network, la nouvelle branche, puis
  -- le ELSE et la fin de fonction inchangés.
  v_out := substr(v_src, 1, v_start - 1) || v_new_branch || substr(v_src, v_end);
  v_out := replace(v_out, 'public.set_setting_v10(', 'public.set_setting_v11(');

  -- Garde 3 : contrôle du résultat AVANT exécution.
  IF position('offline_max_hours' IN v_out) <> 0 THEN
    RAISE EXCEPTION 'ADR-015: offline_max_hours subsiste dans le corps dérivé';
  END IF;
  IF position('offline_cash_enabled' IN v_out) <> 0 THEN
    RAISE EXCEPTION 'ADR-015: offline_cash_enabled subsiste dans le corps dérivé';
  END IF;
  IF position('FUNCTION public.set_setting_v11(' IN v_out) = 0 THEN
    RAISE EXCEPTION 'ADR-015: renommage v10 → v11 non appliqué';
  END IF;
  -- Le corps dérivé ne perd que le bloc network : la taille doit rester du
  -- même ordre (garde-fou contre une découpe qui emporterait la moitié du CASE).
  IF length(v_out) < length(v_src) - 2000 THEN
    RAISE EXCEPTION 'ADR-015: corps dérivé trop court (% vs %) — découpe suspecte',
      length(v_out), length(v_src);
  END IF;

  EXECUTE v_out;
END;
$mig$;

DROP FUNCTION IF EXISTS public.set_setting_v10(p_key text, p_value jsonb, p_category text);

-- ---------------------------------------------------------------------------
-- 4. Grants — defense in depth (anon hérite EXECUTE via PUBLIC)
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.set_setting_v11(p_key text, p_value jsonb, p_category text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_setting_v11(p_key text, p_value jsonb, p_category text) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_setting_v11(p_key text, p_value jsonb, p_category text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_setting_v11(p_key text, p_value jsonb, p_category text) TO service_role;

REVOKE ALL ON FUNCTION public.get_settings_by_category_v9(p_category text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_settings_by_category_v9(p_category text) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_settings_by_category_v9(p_category text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_settings_by_category_v9(p_category text) TO service_role;

COMMENT ON FUNCTION public.set_setting_v11(p_key text, p_value jsonb, p_category text) IS
  'Écriture des réglages business_config (validation par clé, audit-log old/new). '
  'v11 (ADR-015) : offline_cash_enabled → offline_payments_enabled, '
  'offline_max_hours supprimée.';

COMMENT ON FUNCTION public.get_settings_by_category_v9(p_category text) IS
  'Lecture des réglages business_config par catégorie symbolique. v9 (ADR-015) : '
  'catégorie network réduite à offline_payments_enabled.';
