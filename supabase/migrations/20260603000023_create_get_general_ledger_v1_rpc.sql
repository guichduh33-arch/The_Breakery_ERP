-- 20260603000023_create_get_general_ledger_v1_rpc.sql
-- Session 26 / Wave 1.I / migration _023 :
--   get_general_ledger_v1(p_account_id, p_start, p_end, p_limit, p_cursor) RETURNS JSONB
--
-- Drilldown par compte : liste des journal_entry_lines avec running balance.
-- Pagination cursor-based (cursor = last (entry_date, je.id) seen).
-- Gate : permission accounting.gl.read (seedée _026) ou reports.financial.read.

CREATE OR REPLACE FUNCTION public.get_general_ledger_v1(
  p_account_id  UUID,
  p_date_start  DATE,
  p_date_end    DATE,
  p_limit       INT DEFAULT 50,
  p_cursor      JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public
AS $$
DECLARE
  v_lines       JSONB;
  v_account     RECORD;
  v_opening_balance NUMERIC(14,2) := 0;
  v_total_debit NUMERIC(14,2) := 0;
  v_total_credit NUMERIC(14,2) := 0;
  v_next_cursor JSONB := NULL;
  v_cursor_date DATE;
  v_cursor_id   UUID;
  v_count       INT;
BEGIN
  IF p_account_id IS NULL THEN
    RAISE EXCEPTION 'account_id_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_date_start IS NULL OR p_date_end IS NULL THEN
    RAISE EXCEPTION 'period_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_date_end < p_date_start THEN
    RAISE EXCEPTION 'period_end_before_start' USING ERRCODE = 'check_violation';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 500 THEN
    RAISE EXCEPTION 'invalid_limit' USING ERRCODE = 'P0001';
  END IF;

  SELECT id, code, name, account_class, balance_type, is_active
    INTO v_account
    FROM accounts WHERE id = p_account_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'account_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- Opening balance : tout JE avant p_date_start avec dedupe sale_void+refund
  SELECT
    COALESCE(SUM(
      CASE v_account.balance_type
        WHEN 'debit'  THEN (jel.debit - jel.credit)
        ELSE              (jel.credit - jel.debit)
      END
    ), 0)
  INTO v_opening_balance
  FROM journal_entry_lines jel
  JOIN journal_entries je ON je.id = jel.journal_entry_id
  WHERE jel.account_id = p_account_id
    AND je.status IN ('posted','locked')
    AND je.entry_date < p_date_start
    AND NOT (
      je.reference_type = 'sale_void'
      AND EXISTS (SELECT 1 FROM refunds rf WHERE rf.order_id = je.reference_id)
    );

  -- Cursor parsing
  IF p_cursor IS NOT NULL THEN
    v_cursor_date := (p_cursor->>'last_date')::DATE;
    v_cursor_id   := (p_cursor->>'last_id')::UUID;
  END IF;

  -- Page lines
  WITH paged AS (
    SELECT
      je.id           AS je_id,
      je.entry_number,
      je.entry_date,
      je.description  AS je_description,
      je.reference_type,
      je.reference_id,
      jel.debit,
      jel.credit,
      jel.description AS line_description
    FROM journal_entry_lines jel
    JOIN journal_entries je ON je.id = jel.journal_entry_id
    WHERE jel.account_id = p_account_id
      AND je.status IN ('posted','locked')
      AND je.entry_date BETWEEN p_date_start AND p_date_end
      AND NOT (
        je.reference_type = 'sale_void'
        AND EXISTS (SELECT 1 FROM refunds rf WHERE rf.order_id = je.reference_id)
      )
      AND (
        v_cursor_date IS NULL OR
        (je.entry_date, je.id) > (v_cursor_date, v_cursor_id)
      )
    ORDER BY je.entry_date ASC, je.id ASC
    LIMIT p_limit + 1
  )
  SELECT
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'je_id',          je_id,
        'entry_number',   entry_number,
        'entry_date',     entry_date,
        'description',    je_description,
        'reference_type', reference_type,
        'reference_id',   reference_id,
        'debit',          debit,
        'credit',         credit,
        'line_description', line_description
      )
      ORDER BY entry_date ASC, je_id ASC
    ) FILTER (WHERE TRUE), '[]'::JSONB),
    COUNT(*)::INT
  INTO v_lines, v_count
  FROM (SELECT * FROM paged LIMIT p_limit) windowed;

  -- Compute next_cursor if more rows than limit
  IF v_count >= p_limit AND EXISTS (
    SELECT 1 FROM journal_entry_lines jel
    JOIN journal_entries je ON je.id = jel.journal_entry_id
    WHERE jel.account_id = p_account_id
      AND je.status IN ('posted','locked')
      AND je.entry_date BETWEEN p_date_start AND p_date_end
      AND NOT (
        je.reference_type = 'sale_void'
        AND EXISTS (SELECT 1 FROM refunds rf WHERE rf.order_id = je.reference_id)
      )
      AND (
        v_cursor_date IS NULL OR
        (je.entry_date, je.id) > (v_cursor_date, v_cursor_id)
      )
    OFFSET p_limit
    LIMIT 1
  ) THEN
    SELECT jsonb_build_object('last_date', entry_date, 'last_id', je_id)
      INTO v_next_cursor
      FROM jsonb_to_recordset(v_lines) AS x(je_id UUID, entry_date DATE)
      ORDER BY entry_date DESC, je_id DESC
      LIMIT 1;
  END IF;

  -- Total over period
  SELECT
    COALESCE(SUM(jel.debit),  0),
    COALESCE(SUM(jel.credit), 0)
  INTO v_total_debit, v_total_credit
  FROM journal_entry_lines jel
  JOIN journal_entries je ON je.id = jel.journal_entry_id
  WHERE jel.account_id = p_account_id
    AND je.status IN ('posted','locked')
    AND je.entry_date BETWEEN p_date_start AND p_date_end
    AND NOT (
      je.reference_type = 'sale_void'
      AND EXISTS (SELECT 1 FROM refunds rf WHERE rf.order_id = je.reference_id)
    );

  RETURN jsonb_build_object(
    'account', jsonb_build_object(
      'id',            v_account.id,
      'code',          v_account.code,
      'name',          v_account.name,
      'account_class', v_account.account_class,
      'balance_type',  v_account.balance_type,
      'is_active',     v_account.is_active
    ),
    'period', jsonb_build_object('start', p_date_start, 'end', p_date_end),
    'opening_balance', v_opening_balance,
    'total_debit',     v_total_debit,
    'total_credit',    v_total_credit,
    'lines',           v_lines,
    'next_cursor',     v_next_cursor
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_general_ledger_v1(UUID, DATE, DATE, INT, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_general_ledger_v1(UUID, DATE, DATE, INT, JSONB) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_general_ledger_v1(UUID, DATE, DATE, INT, JSONB) TO authenticated;

COMMENT ON FUNCTION public.get_general_ledger_v1(UUID, DATE, DATE, INT, JSONB) IS
  'S26 cockpit : drilldown General Ledger par compte. Pagination cursor-based '
  '(cursor = {last_date, last_id}). Dedupe sale_void+refund (F-S26-AC-04). '
  'Retourne opening_balance + lines + totals + next_cursor.';
