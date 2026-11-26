-- ADR-049 — Une vente B2B entre dans les rapports de ventes à sa date de commande.
--
-- Avant : une commande B2B n'entrait dans les rapports qu'une fois soldée
-- (`paid`), au jour du dernier règlement. Une commande livrée mais impayée
-- (`b2b_pending`) n'y figurait pas, alors que l'écriture comptable de la vente
-- (`b2b_order`) est passée au jour de la commande. La règle des ardoises de
-- caisse (reconnues à `outstanding_at`) est inchangée.
--
-- 1. Le rapport PB1 garde l'ancienne règle, à l'identique : la vente B2B est
--    hors PB1 (ADR-040) et un mois déjà déclaré ne doit pas bouger. Il lit une
--    copie figée de la projection précédente ; son corps vient du live v7.
-- 2. La projection partagée `recognized_sales_v2` est remplacée en place : même
--    liste de colonnes, seule la règle change. Tous les rapports qui la lisent
--    suivent ensemble ; une v3 obligerait à republier une trentaine de RPC pour
--    une règle unique, et laisserait des rapports en désaccord entre eux.

-- 1a. Copie figée de la règle précédente, réservée au rapport PB1.
CREATE VIEW reporting_private.pb1_recognized_sales_v1 AS
 SELECT id,
    order_number,
    session_id,
    served_by,
    order_type,
    status,
    subtotal,
    tax_amount,
    total,
    idempotency_key,
    created_at,
    updated_at,
    paid_at,
    customer_id,
    loyalty_points_earned,
    loyalty_points_redeemed,
    loyalty_redemption_amount,
    table_number,
    created_via,
    waiter_id,
    sent_to_kitchen_at,
    discount_amount,
    discount_type,
    discount_value,
    discount_reason,
    discount_authorized_by,
    promotion_total,
    voided_at,
    voided_by,
    void_reason,
    is_held,
    notes,
    is_historical_import,
    import_reference,
    invoice_number,
    pickup_date,
    b2b_delivered_at,
    recipe_consumption_revision,
    financial_import_document_id,
    outstanding_at,
        CASE
            WHEN outstanding_at IS NOT NULL THEN outstanding_at
            ELSE COALESCE(paid_at, created_at)
        END AS recognized_at
   FROM reporting_private.closed_pos_orders_v1 o
  WHERE status <> 'voided'::order_status AND voided_at IS NULL AND (outstanding_at IS NOT NULL OR (status = ANY (ARRAY['paid'::order_status, 'completed'::order_status])));
REVOKE ALL ON reporting_private.pb1_recognized_sales_v1 FROM PUBLIC, anon, authenticated;

-- 1b. get_pb1_report_v8 : corps live de la v7, seule la source change.
CREATE FUNCTION public.get_pb1_report_v8(p_period_month integer, p_period_year integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller_id      UUID := auth.uid();
  v_start_date     DATE;
  v_end_date       DATE;
  v_pb1_rate       NUMERIC;
  v_taxable_base   NUMERIC(15,2);
  v_pb1_collected  NUMERIC(15,2);
  v_pb1_payable    NUMERIC(15,2);
  v_pb1_account_id UUID;
  v_balance        NUMERIC(15,2);
  v_by_day         JSONB;
  v_calc           JSONB;
BEGIN
  PERFORM public.assert_statements_visible_v1();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF NOT has_permission(v_caller_id, 'reports.financial.read') THEN
    RAISE EXCEPTION 'Permission denied: reports.financial.read' USING ERRCODE = '42501';
  END IF;
  IF p_period_month < 1 OR p_period_month > 12 THEN
    RAISE EXCEPTION 'Invalid month: %', p_period_month USING ERRCODE = '22023';
  END IF;
  IF p_period_year < 2000 OR p_period_year > 2100 THEN
    RAISE EXCEPTION 'Invalid year: %', p_period_year USING ERRCODE = '22023';
  END IF;

  v_start_date := make_date(p_period_year, p_period_month, 1);
  v_end_date   := (v_start_date + INTERVAL '1 month' - INTERVAL '1 day')::date;

  v_pb1_rate := current_pb1_rate();

  -- ADR-049 : la PB1 garde la règle antérieure (B2B au solde, ADR-040 hors PB1).
  SELECT
    COALESCE(SUM(subtotal),    0),
    COALESCE(SUM(tax_amount),  0)
  INTO v_taxable_base, v_pb1_collected
  FROM reporting_private.pb1_recognized_sales_v1
  WHERE recognized_at::date BETWEEN v_start_date AND v_end_date
    AND status NOT IN ('voided');

  -- Reuse calculate_pb1_payable helper — signature: (p_period_start DATE, p_period_end DATE)
  -- DEV-S30-1.B-01: actual signature uses DATE args, not TEXT as originally assumed
  -- Lot D1 : bump _v1→_v2 — calculate_pb1_payable a gagné le gate reports.financial.read,
  -- règle RPC versioning monotone oblige (jamais éditer une _vN publiée).
  v_calc := calculate_pb1_payable_v6(v_start_date, v_end_date);
  v_pb1_payable := COALESCE((v_calc->>'pb1_payable')::numeric, v_pb1_collected);

  -- Balance on account 2110 (PB1 Payable) at period end
  SELECT id INTO v_pb1_account_id FROM accounts WHERE code = '2110' LIMIT 1;
  IF v_pb1_account_id IS NOT NULL THEN
    SELECT COALESCE(SUM(jel.credit - jel.debit), 0)
    INTO v_balance
    FROM reporting_private.closed_shift_journal_lines_v1 jel
    JOIN reporting_private.closed_shift_journal_entries_v1 je ON je.id = jel.journal_entry_id
    WHERE jel.account_id = v_pb1_account_id
      AND je.entry_date <= v_end_date;
  ELSE
    v_balance := 0;
  END IF;

  -- Daily breakdown
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.day ASC), '[]'::jsonb)
  INTO v_by_day
  FROM (
    SELECT
      recognized_at::date                AS day,
      COALESCE(SUM(subtotal),   0)   AS taxable_base,
      COALESCE(SUM(tax_amount), 0)   AS pb1_collected
    FROM reporting_private.pb1_recognized_sales_v1
    WHERE recognized_at::date BETWEEN v_start_date AND v_end_date
      AND status NOT IN ('voided')
    GROUP BY recognized_at::date
  ) t;

  RETURN jsonb_build_object(
    'period', jsonb_build_object(
      'month', p_period_month,
      'year',  p_period_year,
      'start', v_start_date::text,
      'end',   v_end_date::text
    ),
    'pb1_rate',              v_pb1_rate,
    'taxable_base',          v_taxable_base,
    'pb1_collected',         v_pb1_collected,
    'pb1_payable',           v_pb1_payable,
    'by_day',                v_by_day,
    'balance_account_code',  '2110',
    'balance_at_period_end', v_balance
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_pb1_report_v8(integer, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_pb1_report_v8(integer, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_pb1_report_v8(integer, integer) TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

DROP FUNCTION public.get_pb1_report_v7(integer, integer);

-- 2. Nouvelle règle de la projection partagée (mêmes colonnes, même ordre).
CREATE OR REPLACE VIEW reporting_private.recognized_sales_v2 AS
 SELECT id,
    order_number,
    session_id,
    served_by,
    order_type,
    status,
    subtotal,
    tax_amount,
    total,
    idempotency_key,
    created_at,
    updated_at,
    paid_at,
    customer_id,
    loyalty_points_earned,
    loyalty_points_redeemed,
    loyalty_redemption_amount,
    table_number,
    created_via,
    waiter_id,
    sent_to_kitchen_at,
    discount_amount,
    discount_type,
    discount_value,
    discount_reason,
    discount_authorized_by,
    promotion_total,
    voided_at,
    voided_by,
    void_reason,
    is_held,
    notes,
    is_historical_import,
    import_reference,
    invoice_number,
    pickup_date,
    b2b_delivered_at,
    recipe_consumption_revision,
    financial_import_document_id,
    outstanding_at,
        CASE
            WHEN order_type = 'b2b'::order_type THEN created_at
            WHEN outstanding_at IS NOT NULL THEN outstanding_at
            ELSE COALESCE(paid_at, created_at)
        END AS recognized_at
   FROM reporting_private.closed_pos_orders_v1 o
  WHERE status <> 'voided'::order_status AND voided_at IS NULL
    AND (outstanding_at IS NOT NULL
      OR (status = ANY (ARRAY['paid'::order_status, 'completed'::order_status]))
      OR (order_type = 'b2b'::order_type AND status = 'b2b_pending'::order_status));
REVOKE ALL ON reporting_private.recognized_sales_v2 FROM PUBLIC, anon, authenticated;
