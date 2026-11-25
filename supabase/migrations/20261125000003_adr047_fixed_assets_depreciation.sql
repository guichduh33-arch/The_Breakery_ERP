-- ADR-047 — Équipements : marque « équipement » d'une dépense, dotation
-- mensuelle et inscription d'un équipement déjà au bilan.
-- Les choix techniques sont dans l'en-tête de 20261125000002.

-- ---------------------------------------------------------------------------
-- Marque « équipement » d'un brouillon de dépense
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.set_expense_equipment_v1(
  p_expense_id uuid,
  p_asset_type public.fixed_asset_type,
  p_tax_group public.fixed_asset_tax_group DEFAULT NULL,
  p_asset_name text DEFAULT NULL,
  p_quantity integer DEFAULT 1)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid     uuid := auth.uid();
  v_profile uuid;
  v_expense expenses%ROWTYPE;
  v_name    text := btrim(p_asset_name);
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'set_expense_equipment_v1: caller not authenticated' USING ERRCODE = '28000';
  END IF;
  IF NOT (has_permission(v_uid, 'expenses.create') OR has_permission(v_uid, 'expenses.manage')) THEN
    RAISE EXCEPTION 'set_expense_equipment_v1: missing permission expenses.create' USING ERRCODE = '42501';
  END IF;
  SELECT id INTO v_profile FROM user_profiles
   WHERE auth_user_id = v_uid AND deleted_at IS NULL LIMIT 1;
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'set_expense_equipment_v1: no user_profile for caller' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_expense FROM expenses WHERE id = p_expense_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'expense_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_expense.created_by IS DISTINCT FROM v_profile AND NOT has_permission(v_uid, 'expenses.manage') THEN
    RAISE EXCEPTION 'expense_not_owner' USING ERRCODE = '42501';
  END IF;
  IF v_expense.status <> 'draft' THEN
    RAISE EXCEPTION 'expense_not_draft' USING ERRCODE = 'P0001';
  END IF;

  IF p_asset_type IS NULL THEN
    UPDATE expenses SET asset_type = NULL, asset_tax_group = NULL, asset_name = NULL,
                        asset_quantity = NULL
     WHERE id = p_expense_id;
    IF v_expense.asset_type IS NOT NULL THEN
      INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
      VALUES (v_profile, 'expense.equipment_unmarked', 'expense', p_expense_id,
              jsonb_build_object('previous_asset_type', v_expense.asset_type,
                                 'previous_tax_group', v_expense.asset_tax_group,
                                 'previous_quantity', v_expense.asset_quantity));
    END IF;
    RETURN jsonb_build_object('expense_id', p_expense_id, 'asset_type', NULL);
  END IF;

  IF p_tax_group IS NULL THEN
    RAISE EXCEPTION 'fixed_asset_tax_group_required' USING ERRCODE = '22023';
  END IF;
  IF v_name IS NULL OR length(v_name) NOT BETWEEN 2 AND 120 THEN
    RAISE EXCEPTION 'fixed_asset_name_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_quantity IS NULL OR p_quantity NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'fixed_asset_quantity_invalid' USING ERRCODE = '22023';
  END IF;
  IF v_expense.amount < 2000000 * p_quantity THEN
    RAISE EXCEPTION 'fixed_asset_below_threshold' USING ERRCODE = '22023';
  END IF;

  UPDATE expenses SET asset_type = p_asset_type, asset_tax_group = p_tax_group,
                      asset_name = v_name, asset_quantity = p_quantity
   WHERE id = p_expense_id;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_profile, 'expense.equipment_marked', 'expense', p_expense_id,
          jsonb_build_object('asset_type', p_asset_type, 'tax_group', p_tax_group,
                             'asset_name', v_name, 'quantity', p_quantity,
                             'amount', v_expense.amount));

  RETURN jsonb_build_object('expense_id', p_expense_id, 'asset_type', p_asset_type,
    'tax_group', p_tax_group, 'asset_name', v_name, 'quantity', p_quantity);
END $function$;

-- ---------------------------------------------------------------------------
-- Dotation d'un équipement jusqu'à un mois (interne)
-- ---------------------------------------------------------------------------
CREATE FUNCTION public._post_fixed_asset_depreciation_v1(
  p_asset_id uuid, p_through_month date, p_actor uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_asset      fixed_assets%ROWTYPE;
  v_month      date;
  v_last_month date;
  v_entry_date date;
  v_index      integer;
  v_posted     numeric(15,2);
  v_amount     numeric(15,2);
  v_dep_acc    uuid;
  v_acc_acc    uuid;
  v_je_id      uuid;
  v_entry_no   text;
  v_msg        text;
  v_inserted   boolean;
  v_n_posted   integer := 0;
  v_n_refused  integer := 0;
BEGIN
  SELECT * INTO v_asset FROM fixed_assets WHERE id = p_asset_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'fixed_asset_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- Un équipement sorti ne reçoit plus rien : la sortie a soldé son cumul. Un
  -- mois resté refusé à la sortie le reste pour toujours (signalé, jamais
  -- posté), sinon le 1690 serait crédité sur un actif déjà décomptabilisé.
  -- La sortie appelle cette fonction AVANT de passer la fiche à « disposed ».
  IF v_asset.status = 'disposed' THEN
    RETURN jsonb_build_object('asset_id', v_asset.id, 'posted', 0, 'refused', 0);
  END IF;

  -- Dernier mois du plan, borné par le mois demandé.
  v_last_month := LEAST(
    date_trunc('month', p_through_month)::date,
    (date_trunc('month', v_asset.in_service_date)
       + make_interval(months => v_asset.useful_life_months - 1))::date);

  v_dep_acc := resolve_mapping_account('FIXED_ASSET_DEPRECIATION_EXPENSE');
  v_acc_acc := resolve_mapping_account('FIXED_ASSET_ACCUMULATED_DEPRECIATION');

  v_month := v_asset.depreciation_start_month;
  WHILE v_month <= v_last_month LOOP
    IF NOT EXISTS (SELECT 1 FROM fixed_asset_depreciations
                    WHERE asset_id = v_asset.id AND period_month = v_month AND status = 'posted') THEN
      SELECT COALESCE(sum(amount), 0) INTO v_posted
        FROM fixed_asset_depreciations WHERE asset_id = v_asset.id AND status = 'posted';
      -- La dotation s'arrête quand la valeur nette atteint zéro.
      EXIT WHEN v_asset.cost - v_asset.opening_accumulated - v_posted <= 0;

      v_index  := _fixed_asset_month_index_v1(v_asset.in_service_date, v_month);
      v_amount := LEAST(_fixed_asset_month_amount_v1(v_asset.cost, v_asset.useful_life_months, v_index),
                        v_asset.cost - v_asset.opening_accumulated - v_posted);
      v_entry_date := (v_month + interval '1 month' - interval '1 day')::date;

      IF v_amount > 0 THEN
        BEGIN
          PERFORM check_fiscal_period_open(v_entry_date);

          v_entry_no := next_journal_entry_number(v_entry_date);
          INSERT INTO journal_entries (
            entry_number, entry_date, description, reference_type, reference_id,
            status, total_debit, total_credit, created_by, metadata
          ) VALUES (
            v_entry_no, v_entry_date,
            'Depreciation ' || to_char(v_month, 'YYYY-MM') || ' - ' || v_asset.asset_number
              || ' ' || left(v_asset.name, 60),
            'fixed_asset_depreciation', v_asset.id,
            'posted', v_amount, v_amount, p_actor,
            jsonb_build_object('movement_type', to_char(v_month, 'YYYY-MM'),
                               'kind', 'fixed_asset_depreciation',
                               'period_month', v_month, 'month_index', v_index)
          ) RETURNING id INTO v_je_id;

          INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
            (v_je_id, v_dep_acc, v_amount, 0, 'Depreciation expense'),
            (v_je_id, v_acc_acc, 0, v_amount, 'Accumulated depreciation');

          INSERT INTO fixed_asset_depreciations (asset_id, period_month, entry_date, month_index,
                                                 amount, status, journal_entry_id)
          VALUES (v_asset.id, v_month, v_entry_date, v_index, v_amount, 'posted', v_je_id)
          ON CONFLICT (asset_id, period_month) DO UPDATE
            SET status = 'posted', amount = EXCLUDED.amount, entry_date = EXCLUDED.entry_date,
                month_index = EXCLUDED.month_index, journal_entry_id = EXCLUDED.journal_entry_id,
                refused_reason = NULL, attempts = fixed_asset_depreciations.attempts + 1;

          INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
          VALUES (p_actor, 'fixed_asset.depreciation_posted', 'fixed_asset', v_asset.id,
                  jsonb_build_object('period_month', v_month, 'month_index', v_index,
                                     'amount', v_amount, 'journal_entry_id', v_je_id,
                                     'entry_number', v_entry_no));
          v_n_posted := v_n_posted + 1;
        EXCEPTION WHEN SQLSTATE 'P0004' THEN
          -- Période fermée ou absente : le mois est refusé et signalé. Il sera
          -- retenté à SA date au passage suivant ; il n'est jamais reporté.
          GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
          INSERT INTO fixed_asset_depreciations (asset_id, period_month, entry_date, month_index,
                                                 amount, status, refused_reason)
          VALUES (v_asset.id, v_month, v_entry_date, v_index, v_amount, 'refused', v_msg)
          ON CONFLICT (asset_id, period_month) DO UPDATE
            SET refused_reason = EXCLUDED.refused_reason, amount = EXCLUDED.amount,
                attempts = fixed_asset_depreciations.attempts + 1
          RETURNING (xmax = 0) INTO v_inserted;
          IF v_inserted THEN
            INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
            VALUES (p_actor, 'fixed_asset.depreciation_refused', 'fixed_asset', v_asset.id,
                    jsonb_build_object('period_month', v_month, 'month_index', v_index,
                                       'amount', v_amount, 'reason', v_msg));
          END IF;
          v_n_refused := v_n_refused + 1;
        END;
      END IF;
    END IF;
    v_month := (v_month + interval '1 month')::date;
  END LOOP;

  RETURN jsonb_build_object('asset_id', v_asset.id, 'posted', v_n_posted, 'refused', v_n_refused);
END $function$;

-- ---------------------------------------------------------------------------
-- Passage automatique (pg_cron)
-- ---------------------------------------------------------------------------
-- Poste, pour chaque équipement, tous les mois TERMINÉS à la date p_as_of.
-- p_as_of n'existe que pour les tests : la tâche planifiée l'omet.
CREATE FUNCTION public.run_fixed_asset_depreciation_v1(p_as_of date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_through date := (date_trunc('month', COALESCE(p_as_of, current_date)) - interval '1 month')::date;
  v_asset   record;
  v_result  jsonb;
  v_posted  integer := 0;
  v_refused integer := 0;
BEGIN
  -- Deux passages simultanés se gênent (verrous par fiche) : le second se retire.
  IF NOT pg_try_advisory_xact_lock(hashtext('fixed_asset_depreciation_run')) THEN
    RETURN jsonb_build_object('skipped', true);
  END IF;
  FOR v_asset IN SELECT id FROM fixed_assets WHERE status = 'active' ORDER BY asset_number LOOP
    v_result  := _post_fixed_asset_depreciation_v1(v_asset.id, v_through, NULL);
    v_posted  := v_posted + (v_result->>'posted')::int;
    v_refused := v_refused + (v_result->>'refused')::int;
  END LOOP;
  RETURN jsonb_build_object('through_month', v_through, 'posted', v_posted, 'refused', v_refused);
END $function$;

-- ---------------------------------------------------------------------------
-- Inscription d'un équipement déjà au bilan
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.register_existing_fixed_asset_v1(
  p_name text,
  p_asset_type public.fixed_asset_type,
  p_tax_group public.fixed_asset_tax_group,
  p_in_service_date date,
  p_cost numeric,
  p_accumulated numeric,
  p_accumulated_as_of date,
  p_idempotency_key uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid      uuid := auth.uid();
  v_profile  uuid;
  v_existing fixed_assets%ROWTYPE;
  v_id       uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'register_existing_fixed_asset_v1: caller not authenticated' USING ERRCODE = '28000';
  END IF;
  IF NOT has_permission(v_uid, 'accounting.fixed_assets.manage') THEN
    RAISE EXCEPTION 'register_existing_fixed_asset_v1: missing permission accounting.fixed_assets.manage'
      USING ERRCODE = '42501';
  END IF;
  SELECT id INTO v_profile FROM user_profiles
   WHERE auth_user_id = v_uid AND deleted_at IS NULL LIMIT 1;
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'register_existing_fixed_asset_v1: no user_profile for caller' USING ERRCODE = '28000';
  END IF;
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'idempotency_key_required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_existing FROM fixed_assets WHERE idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.created_by IS DISTINCT FROM v_profile THEN
      RAISE EXCEPTION 'idempotency_key_conflict' USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_build_object('asset_id', v_existing.id, 'asset_number', v_existing.asset_number,
                              'idempotent_replay', true);
  END IF;

  IF p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 2 AND 120 THEN
    RAISE EXCEPTION 'fixed_asset_name_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_asset_type IS NULL OR p_tax_group IS NULL THEN
    RAISE EXCEPTION 'fixed_asset_type_and_group_required' USING ERRCODE = '22023';
  END IF;
  IF p_cost IS NULL OR p_cost <= 0 OR p_cost <> round(p_cost, 2) THEN
    RAISE EXCEPTION 'fixed_asset_cost_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_accumulated IS NULL OR p_accumulated < 0 OR p_accumulated > p_cost
     OR p_accumulated <> round(p_accumulated, 2) THEN
    RAISE EXCEPTION 'fixed_asset_accumulated_invalid' USING ERRCODE = '22023';
  END IF;
  -- Le cumul se constate à une fin de mois : la dotation repart du mois suivant.
  IF p_accumulated_as_of IS NULL
     OR p_accumulated_as_of <> (date_trunc('month', p_accumulated_as_of) + interval '1 month' - interval '1 day')::date THEN
    RAISE EXCEPTION 'fixed_asset_as_of_must_be_month_end' USING ERRCODE = '22023';
  END IF;
  IF p_in_service_date IS NULL OR p_in_service_date > p_accumulated_as_of THEN
    RAISE EXCEPTION 'fixed_asset_in_service_after_as_of' USING ERRCODE = '22023';
  END IF;
  IF p_accumulated_as_of > current_date THEN
    RAISE EXCEPTION 'fixed_asset_as_of_in_future' USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_id := _insert_fixed_asset_v1(p_name, p_asset_type, p_tax_group, p_in_service_date,
              p_cost, 'opening', NULL, NULL, p_accumulated, p_accumulated_as_of,
              v_profile, p_idempotency_key);
  EXCEPTION WHEN unique_violation THEN
    SELECT * INTO v_existing FROM fixed_assets WHERE idempotency_key = p_idempotency_key;
    IF NOT FOUND OR v_existing.created_by IS DISTINCT FROM v_profile THEN
      RAISE;
    END IF;
    RETURN jsonb_build_object('asset_id', v_existing.id, 'asset_number', v_existing.asset_number,
                              'idempotent_replay', true);
  END;

  RETURN jsonb_build_object('asset_id', v_id,
    'asset_number', (SELECT asset_number FROM fixed_assets WHERE id = v_id),
    'idempotent_replay', false);
END $function$;

-- ---------------------------------------------------------------------------
-- Droits : fermés, puis ouverts objet par objet
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public._post_fixed_asset_depreciation_v1(uuid, date, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._post_fixed_asset_depreciation_v1(uuid, date, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public._post_fixed_asset_depreciation_v1(uuid, date, uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.run_fixed_asset_depreciation_v1(date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.run_fixed_asset_depreciation_v1(date) FROM anon;
REVOKE EXECUTE ON FUNCTION public.run_fixed_asset_depreciation_v1(date) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.set_expense_equipment_v1(uuid, public.fixed_asset_type, public.fixed_asset_tax_group, text, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_expense_equipment_v1(uuid, public.fixed_asset_type, public.fixed_asset_tax_group, text, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_expense_equipment_v1(uuid, public.fixed_asset_type, public.fixed_asset_tax_group, text, integer) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.register_existing_fixed_asset_v1(text, public.fixed_asset_type, public.fixed_asset_tax_group, date, numeric, numeric, date, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.register_existing_fixed_asset_v1(text, public.fixed_asset_type, public.fixed_asset_tax_group, date, numeric, numeric, date, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.register_existing_fixed_asset_v1(text, public.fixed_asset_type, public.fixed_asset_tax_group, date, numeric, numeric, date, uuid) TO authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
