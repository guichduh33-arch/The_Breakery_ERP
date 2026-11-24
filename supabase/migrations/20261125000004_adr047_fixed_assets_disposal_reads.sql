-- ADR-047 — Équipements : sortie d'un équipement, lectures du registre et
-- tâche planifiée de la dotation.
-- Les choix techniques sont dans l'en-tête de 20261125000002.

-- ---------------------------------------------------------------------------
-- Sortie d'un équipement (vente, casse, rebut)
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.dispose_fixed_asset_v1(
  p_asset_id uuid,
  p_disposal_date date,
  p_reason public.fixed_asset_disposal_reason,
  p_sale_price numeric,
  p_proceeds_account_id uuid,
  p_notes text,
  p_manager_pin text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid        uuid := auth.uid();
  v_profile    uuid;
  v_asset      fixed_assets%ROWTYPE;
  v_accum      numeric(15,2);
  v_nbv        numeric(15,2);
  v_price      numeric(15,2) := COALESCE(p_sale_price, 0);
  v_result     numeric(15,2);
  v_acc_acc    uuid;
  v_gain_acc   uuid;
  v_loss_acc   uuid;
  v_je_id      uuid;
  v_entry_no   text;
  v_total      numeric(15,2);
  v_notes      text := NULLIF(btrim(p_notes), '');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'dispose_fixed_asset_v1: caller not authenticated' USING ERRCODE = '28000';
  END IF;
  IF NOT has_permission(v_uid, 'accounting.fixed_assets.manage') THEN
    RAISE EXCEPTION 'dispose_fixed_asset_v1: missing permission accounting.fixed_assets.manage'
      USING ERRCODE = '42501';
  END IF;
  SELECT id INTO v_profile FROM user_profiles
   WHERE auth_user_id = v_uid AND deleted_at IS NULL LIMIT 1;
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'dispose_fixed_asset_v1: no user_profile for caller' USING ERRCODE = '28000';
  END IF;
  IF p_manager_pin IS NULL OR length(p_manager_pin) < 4 THEN
    RAISE EXCEPTION 'pin_required' USING ERRCODE = 'P0001';
  END IF;
  IF NOT _verify_pin_with_lockout(v_profile, p_manager_pin) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_pin');
  END IF;

  SELECT * INTO v_asset FROM fixed_assets WHERE id = p_asset_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'fixed_asset_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_asset.status = 'disposed' THEN
    RAISE EXCEPTION 'fixed_asset_already_disposed' USING ERRCODE = 'P0001';
  END IF;
  IF p_reason IS NULL THEN
    RAISE EXCEPTION 'fixed_asset_disposal_reason_required' USING ERRCODE = '22023';
  END IF;
  IF p_disposal_date IS NULL OR p_disposal_date < v_asset.in_service_date
     OR p_disposal_date > current_date THEN
    RAISE EXCEPTION 'fixed_asset_disposal_date_invalid' USING ERRCODE = '22023';
  END IF;
  IF length(v_notes) > 500 THEN
    RAISE EXCEPTION 'fixed_asset_disposal_notes_too_long' USING ERRCODE = '22023';
  END IF;
  IF p_reason = 'sale' THEN
    IF p_sale_price IS NULL OR p_sale_price <= 0 OR p_sale_price <> round(p_sale_price, 2) THEN
      RAISE EXCEPTION 'fixed_asset_sale_price_invalid' USING ERRCODE = '22023';
    END IF;
    -- Le prix entre en trésorerie : compte de caisse ou de banque actif.
    PERFORM 1 FROM accounts WHERE id = p_proceeds_account_id AND account_class = 1
      AND cash_flow_section = 'none' AND is_active AND is_postable AND deleted_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'fixed_asset_proceeds_account_invalid' USING ERRCODE = '22023';
    END IF;
  ELSIF p_sale_price IS NOT NULL OR p_proceeds_account_id IS NOT NULL THEN
    RAISE EXCEPTION 'fixed_asset_sale_fields_only_for_sale' USING ERRCODE = '22023';
  END IF;
  -- Une dotation déjà passée sur le mois de sortie ou après interdit la date.
  IF EXISTS (SELECT 1 FROM fixed_asset_depreciations
              WHERE asset_id = v_asset.id AND status = 'posted'
                AND period_month >= date_trunc('month', p_disposal_date)::date) THEN
    RAISE EXCEPTION 'fixed_asset_disposal_before_posted_depreciation' USING ERRCODE = '22023';
  END IF;

  PERFORM check_fiscal_period_open(p_disposal_date);

  -- Les mois terminés avant le mois de sortie reçoivent d'abord leur dotation.
  PERFORM _post_fixed_asset_depreciation_v1(v_asset.id,
    (date_trunc('month', p_disposal_date) - interval '1 month')::date, v_profile);

  SELECT v_asset.opening_accumulated + COALESCE(sum(amount), 0) INTO v_accum
    FROM fixed_asset_depreciations WHERE asset_id = v_asset.id AND status = 'posted';
  v_nbv    := v_asset.cost - v_accum;
  v_result := v_price - v_nbv;   -- > 0 gain, < 0 perte

  v_acc_acc  := resolve_mapping_account('FIXED_ASSET_ACCUMULATED_DEPRECIATION');
  v_gain_acc := resolve_mapping_account('FIXED_ASSET_DISPOSAL_GAIN');
  v_loss_acc := resolve_mapping_account('FIXED_ASSET_DISPOSAL_LOSS');
  v_total    := v_asset.cost + GREATEST(v_result, 0);

  v_entry_no := next_journal_entry_number(p_disposal_date);
  INSERT INTO journal_entries (
    entry_number, entry_date, description, reference_type, reference_id,
    status, total_debit, total_credit, created_by, metadata
  ) VALUES (
    v_entry_no, p_disposal_date,
    'Disposal (' || p_reason || ') - ' || v_asset.asset_number || ' ' || left(v_asset.name, 60),
    'fixed_asset_disposal', v_asset.id,
    'posted', v_total, v_total, v_profile,
    jsonb_build_object('movement_type', 'disposal', 'kind', 'fixed_asset_disposal',
                       'reason', p_reason, 'cost', v_asset.cost,
                       'accumulated_depreciation', v_accum, 'net_book_value', v_nbv,
                       'sale_price', v_price, 'result', v_result)
  ) RETURNING id INTO v_je_id;

  IF v_accum > 0 THEN
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
    VALUES (v_je_id, v_acc_acc, v_accum, 0, 'Disposal - accumulated depreciation');
  END IF;
  IF v_price > 0 THEN
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
    VALUES (v_je_id, p_proceeds_account_id, v_price, 0, 'Disposal - sale proceeds');
  END IF;
  IF v_result < 0 THEN
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
    VALUES (v_je_id, v_loss_acc, -v_result, 0, 'Disposal - loss');
  END IF;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
  VALUES (v_je_id, v_asset.asset_account_id, 0, v_asset.cost, 'Disposal - asset cost');
  IF v_result > 0 THEN
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
    VALUES (v_je_id, v_gain_acc, 0, v_result, 'Disposal - gain');
  END IF;

  UPDATE fixed_assets
     SET status = 'disposed', disposed_at = p_disposal_date, disposal_reason = p_reason,
         disposal_price = CASE WHEN p_reason = 'sale' THEN v_price END,
         disposal_proceeds_account_id = CASE WHEN p_reason = 'sale' THEN p_proceeds_account_id END,
         disposal_notes = v_notes, disposal_je_id = v_je_id, disposed_by = v_profile
   WHERE id = v_asset.id;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_profile, 'fixed_asset.disposed', 'fixed_asset', v_asset.id, jsonb_build_object(
    'asset_number', v_asset.asset_number, 'reason', p_reason, 'disposal_date', p_disposal_date,
    'cost', v_asset.cost, 'accumulated_depreciation', v_accum, 'net_book_value', v_nbv,
    'sale_price', v_price, 'result', v_result, 'journal_entry_id', v_je_id,
    'entry_number', v_entry_no, 'notes', v_notes));

  RETURN jsonb_build_object('ok', true, 'asset_id', v_asset.id, 'journal_entry_id', v_je_id,
    'entry_number', v_entry_no, 'accumulated_depreciation', v_accum,
    'net_book_value', v_nbv, 'sale_price', v_price, 'result', v_result);
END $function$;

-- ---------------------------------------------------------------------------
-- Lectures du registre (reports.statements.read)
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.get_fixed_assets_v1()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT has_permission(auth.uid(), 'reports.statements.read') THEN
    RAISE EXCEPTION 'get_fixed_assets_v1: missing permission reports.statements.read' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', a.id, 'asset_number', a.asset_number, 'name', a.name,
      'asset_type', a.asset_type, 'tax_group', a.tax_group,
      'useful_life_months', a.useful_life_months,
      'account_code', acc.code, 'account_name', acc.name,
      'in_service_date', a.in_service_date, 'cost', a.cost,
      'monthly_depreciation', a.monthly_depreciation, 'origin', a.origin,
      'expense_id', a.expense_id, 'expense_number', e.expense_number,
      'accumulated_depreciation', a.opening_accumulated + COALESCE(d.posted_total, 0),
      'net_book_value', a.cost - a.opening_accumulated - COALESCE(d.posted_total, 0),
      'months_posted', COALESCE(d.posted_count, 0),
      'last_posted_month', d.last_posted_month,
      'refused_months', COALESCE(d.refused_count, 0),
      'status', a.status, 'disposed_at', a.disposed_at, 'disposal_reason', a.disposal_reason,
      'created_at', a.created_at
    ) ORDER BY a.asset_number)
    FROM fixed_assets a
    JOIN accounts acc ON acc.id = a.asset_account_id
    LEFT JOIN expenses e ON e.id = a.expense_id
    LEFT JOIN LATERAL (
      SELECT sum(amount) FILTER (WHERE status = 'posted') AS posted_total,
             count(*) FILTER (WHERE status = 'posted') AS posted_count,
             max(period_month) FILTER (WHERE status = 'posted') AS last_posted_month,
             count(*) FILTER (WHERE status = 'refused') AS refused_count
        FROM fixed_asset_depreciations WHERE asset_id = a.id
    ) d ON true
  ), '[]'::jsonb);
END $function$;

CREATE FUNCTION public.get_fixed_asset_v1(p_asset_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_row jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT has_permission(auth.uid(), 'reports.statements.read') THEN
    RAISE EXCEPTION 'get_fixed_asset_v1: missing permission reports.statements.read' USING ERRCODE = '42501';
  END IF;
  SELECT r INTO v_row FROM jsonb_array_elements(get_fixed_assets_v1()) r
   WHERE r->>'id' = p_asset_id::text;
  IF v_row IS NULL THEN
    RAISE EXCEPTION 'fixed_asset_not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN v_row || (
    SELECT jsonb_build_object(
      'opening_accumulated', a.opening_accumulated,
      'opening_accumulated_as_of', a.opening_accumulated_as_of,
      'depreciation_start_month', a.depreciation_start_month,
      'disposal_price', a.disposal_price,
      'disposal_notes', a.disposal_notes,
      'disposal_proceeds_account_code', pa.code,
      'disposal_entry_number', dj.entry_number,
      'depreciations', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'period_month', d.period_month, 'entry_date', d.entry_date,
          'month_index', d.month_index, 'amount', d.amount, 'status', d.status,
          'entry_number', j.entry_number, 'refused_reason', d.refused_reason,
          'attempts', d.attempts) ORDER BY d.period_month)
          FROM fixed_asset_depreciations d
          LEFT JOIN journal_entries j ON j.id = d.journal_entry_id
         WHERE d.asset_id = a.id), '[]'::jsonb))
    FROM fixed_assets a
    LEFT JOIN accounts pa ON pa.id = a.disposal_proceeds_account_id
    LEFT JOIN journal_entries dj ON dj.id = a.disposal_je_id
   WHERE a.id = p_asset_id);
END $function$;

-- ---------------------------------------------------------------------------
-- Droits : fermés, puis ouverts objet par objet
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.dispose_fixed_asset_v1(uuid, date, public.fixed_asset_disposal_reason, numeric, uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.dispose_fixed_asset_v1(uuid, date, public.fixed_asset_disposal_reason, numeric, uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.dispose_fixed_asset_v1(uuid, date, public.fixed_asset_disposal_reason, numeric, uuid, text, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.get_fixed_assets_v1() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_fixed_assets_v1() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_fixed_assets_v1() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.get_fixed_asset_v1(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_fixed_asset_v1(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_fixed_asset_v1(uuid) TO authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- Tâche planifiée : chaque jour à 00:30 Asia/Makassar (16:30 UTC)
-- ---------------------------------------------------------------------------
-- Le passage poste les mois TERMINÉS : la dotation de novembre part le
-- 1er décembre à 00:30, datée du 30 novembre. Les jours suivants ne trouvent
-- rien à faire, sauf un mois refusé dont la période a rouvert.
SELECT cron.schedule('fixed-asset-depreciation', '30 16 * * *',
                     'SELECT public.run_fixed_asset_depreciation_v1()');
