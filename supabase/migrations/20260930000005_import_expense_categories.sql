-- Corps extrait de pg_get_functiondef sur V3 dev le 2026-09-30.
-- Le trigger commun valide aussi les affectations pendant le commit réel.
CREATE OR REPLACE FUNCTION public.import_expenses_v3(p_payload jsonb, p_dry_run boolean DEFAULT true, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor_profile UUID := _current_profile_id();  -- audit_logs.actor_id = user_profiles.id, jamais auth.uid()
  v_caller    UUID := auth.uid();
  v_existing  JSONB;
  v_errors    JSONB;
  v_summary   JSONB;
  v_report    JSONB;
  v_err_count INT;
  r           RECORD;
  v_cat       UUID;
  v_expno     TEXT;
BEGIN
  IF v_caller IS NULL OR NOT has_permission(v_caller, 'expenses.create') THEN
    RAISE EXCEPTION 'permission denied: expenses.create required' USING ERRCODE = '42501';
  END IF;

  IF NOT p_dry_run THEN
    IF p_idempotency_key IS NULL THEN
      RAISE EXCEPTION 'idempotency_key_required' USING ERRCODE = 'P0001';
    END IF;
    SELECT report INTO v_existing
      FROM import_master_data_idempotency_keys WHERE key = p_idempotency_key;
    IF FOUND THEN
      RETURN v_existing || jsonb_build_object('idempotent_replay', true);
    END IF;
  END IF;

  DROP TABLE IF EXISTS t_exp, t_err;

  CREATE TEMP TABLE t_exp ON COMMIT DROP AS
  SELECT ord::INT                                          AS row_num,
         NULLIF(trim(elt->>'expense_date'), '')            AS expense_date,
         NULLIF(trim(elt->>'category'), '')                AS category,
         NULLIF(elt->>'description', '')                   AS description,
         (elt->>'amount')::NUMERIC                         AS amount,
         COALESCE((elt->>'vat_amount')::NUMERIC, 0)        AS vat_amount,
         COALESCE(NULLIF(trim(elt->>'payment_method'),''),'cash') AS payment_method,
         NULLIF(trim(elt->>'vendor_name'), '')             AS vendor_name
    FROM jsonb_array_elements(COALESCE(p_payload, '[]'::jsonb)) WITH ORDINALITY AS t(elt, ord);

  CREATE TEMP TABLE t_err (sheet TEXT, row_num INT, sku TEXT, code TEXT, message TEXT) ON COMMIT DROP;

  INSERT INTO t_err SELECT 'Expenses', row_num, category, 'missing_required',
         'expense_date, category, description, amount are required'
    FROM t_exp WHERE expense_date IS NULL OR category IS NULL OR description IS NULL OR amount IS NULL;
  INSERT INTO t_err SELECT 'Expenses', row_num, category, 'invalid_amount',
         'amount must be greater than 0'
    FROM t_exp WHERE amount IS NOT NULL AND amount <= 0;
  INSERT INTO t_err SELECT 'Expenses', row_num, category, 'invalid_vat',
         'vat_amount must be 0 or greater'
    FROM t_exp WHERE vat_amount IS NOT NULL AND vat_amount < 0;
  INSERT INTO t_err SELECT 'Expenses', row_num, category, 'invalid_date',
         format('expense_date "%s" must be YYYY-MM-DD', expense_date)
    FROM t_exp WHERE expense_date IS NOT NULL AND expense_date !~ '^\d{4}-\d{2}-\d{2}$';
  INSERT INTO t_err SELECT 'Expenses', row_num, category, 'invalid_payment_method',
         format('payment_method "%s" must be one of cash, transfer, card, credit', payment_method)
    FROM t_exp WHERE payment_method NOT IN ('cash','transfer','card','credit');
  INSERT INTO t_err SELECT 'Expenses', e.row_num, e.category, 'unknown_category',
         format('category "%s" not found (expense category code or name)', e.category)
    FROM t_exp e WHERE e.category IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM expense_categories ec
                        WHERE ec.code = e.category OR lower(ec.name) = lower(e.category));

  INSERT INTO t_err SELECT 'Expenses', e.row_num, e.category, 'inactive_category',
         format('category "%s" is inactive', e.category)
    FROM t_exp e WHERE NOT coalesce((SELECT ec.is_active FROM expense_categories ec
      WHERE ec.code = e.category OR lower(ec.name) = lower(e.category)
      ORDER BY (ec.code = e.category) DESC LIMIT 1), true);

  SELECT jsonb_build_object('Expenses', jsonb_build_object(
    'expenses_created', (SELECT COUNT(*) FROM t_exp)
  )) INTO v_summary;

  SELECT COUNT(*), COALESCE(jsonb_agg(jsonb_build_object(
           'sheet', sheet, 'row', row_num, 'sku', sku, 'code', code, 'message', message) ORDER BY row_num),
         '[]'::jsonb)
    INTO v_err_count, v_errors FROM t_err;

  v_report := jsonb_build_object('valid', v_err_count = 0, 'errors', v_errors,
                                 'summary', v_summary, 'idempotent_replay', false);

  IF p_dry_run OR v_err_count > 0 THEN
    RETURN v_report;
  END IF;

  FOR r IN SELECT * FROM t_exp ORDER BY row_num LOOP
    SELECT ec.id INTO v_cat FROM expense_categories ec
      WHERE ec.code = r.category OR lower(ec.name) = lower(r.category)
      ORDER BY (ec.code = r.category) DESC LIMIT 1;

    v_expno := 'IMP-EXP-' || lpad(nextval('historical_expenses_seq')::TEXT, 6, '0');

    INSERT INTO expenses (
      expense_number, category_id, amount, vat_amount, payment_method, description,
      vendor_name, expense_date, status, is_historical_import,
      created_by, submitted_by, approved_by, paid_by,
      submitted_at, approved_at, paid_at
    ) VALUES (
      v_expno, v_cat, r.amount, r.vat_amount, r.payment_method, r.description,
      r.vendor_name, r.expense_date::DATE, 'paid', TRUE,
      v_actor_profile, v_actor_profile, v_actor_profile, v_actor_profile,
      r.expense_date::timestamptz, r.expense_date::timestamptz, r.expense_date::timestamptz
    );
  END LOOP;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_actor_profile, 'expenses.imported', 'expenses', NULL, v_summary);

  BEGIN
    INSERT INTO import_master_data_idempotency_keys (key, entity, report, created_by)
    VALUES (p_idempotency_key, 'expenses', v_report, v_caller);
  EXCEPTION WHEN unique_violation THEN
    SELECT report INTO v_existing FROM import_master_data_idempotency_keys WHERE key = p_idempotency_key;
    RETURN v_existing || jsonb_build_object('idempotent_replay', true);
  END;

  RETURN v_report;
END;
$function$;

DROP FUNCTION public.import_expenses_v2(jsonb,boolean,uuid);
REVOKE ALL ON FUNCTION public.import_expenses_v3(jsonb,boolean,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_expenses_v3(jsonb,boolean,uuid) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
