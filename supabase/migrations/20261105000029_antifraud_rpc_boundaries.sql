-- Suite des corps live avec garde antifraude.
CREATE OR REPLACE FUNCTION public.get_profit_loss_v4(p_date_start date, p_date_end date, p_section_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_revenue        NUMERIC(14,2) := 0;
  v_revenue_sales  NUMERIC(14,2) := 0;
  v_revenue_disc   NUMERIC(14,2) := 0;
  v_revenue_adj    NUMERIC(14,2) := 0;
  v_cogs           NUMERIC(14,2) := 0;
  v_cogs_prod      NUMERIC(14,2) := 0;
  v_cogs_waste     NUMERIC(14,2) := 0;
  v_cogs_other     NUMERIC(14,2) := 0;
  v_opex           NUMERIC(14,2) := 0;
  v_opex_salary    NUMERIC(14,2) := 0;
  v_opex_rent      NUMERIC(14,2) := 0;
  v_opex_util      NUMERIC(14,2) := 0;
  v_opex_supplies  NUMERIC(14,2) := 0;
  v_opex_marketing NUMERIC(14,2) := 0;
  v_opex_maint     NUMERIC(14,2) := 0;
  v_opex_other     NUMERIC(14,2) := 0;
  v_lines          JSONB         := '[]'::JSONB;
BEGIN
  PERFORM public.assert_stock_owner_v1();
  IF NOT has_permission(auth.uid(), 'reports.financial.read') THEN
    RAISE EXCEPTION 'permission denied: reports.financial.read'
      USING ERRCODE = '42501';
  END IF;

  IF p_date_start IS NULL OR p_date_end IS NULL THEN
    RAISE EXCEPTION 'get_profit_loss_v3: p_date_start and p_date_end are required';
  END IF;
  IF p_date_start > p_date_end THEN
    RAISE EXCEPTION 'get_profit_loss_v3: p_date_start (%) must be <= p_date_end (%)',
      p_date_start, p_date_end;
  END IF;

  WITH agg AS (
    SELECT
      a.id            AS account_id,
      a.code          AS code,
      a.name          AS name,
      a.account_class AS account_class,
      a.balance_type  AS balance_type,
      SUM(COALESCE(jel.debit,  0))::NUMERIC(14,2) AS total_debit,
      SUM(COALESCE(jel.credit, 0))::NUMERIC(14,2) AS total_credit
    FROM reporting_private.closed_shift_journal_lines_v1 jel
    JOIN reporting_private.closed_shift_journal_entries_v1 je ON je.id = jel.journal_entry_id
    JOIN accounts a         ON a.id = jel.account_id
    WHERE je.status IN ('posted', 'locked')
      AND je.entry_date BETWEEN p_date_start AND p_date_end
      AND a.account_class IN (4, 5, 6)
      AND je.reference_type IS DISTINCT FROM 'year_close'
      AND NOT (
        je.reference_type = 'sale_void'
        AND EXISTS (SELECT 1 FROM reporting_private.closed_shift_journal_entries_v1 jr JOIN refunds rf ON rf.id = jr.reference_id WHERE jr.reference_type = 'sale_refund' AND rf.order_id = je.reference_id)
      )
    GROUP BY a.id, a.code, a.name, a.account_class, a.balance_type
  )
  SELECT
    COALESCE(SUM(CASE WHEN account_class = 4 AND code LIKE '41%'  THEN (total_credit - total_debit) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 4 AND code IN ('4190','4900') THEN (total_credit - total_debit) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 4 AND code LIKE '45%'  THEN (total_credit - total_debit) END), 0)
      + COALESCE(SUM(CASE WHEN account_class = 4 AND code LIKE '49%' AND code NOT IN ('4900','4190') THEN (total_credit - total_debit) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 4 THEN (total_credit - total_debit) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 5 AND code LIKE '51%' THEN (total_debit - total_credit) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 5 AND code LIKE '52%' THEN (total_debit - total_credit) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 5 AND code NOT LIKE '51%' AND code NOT LIKE '52%' THEN (total_debit - total_credit) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 5 THEN (total_debit - total_credit) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 6 AND code = '6111' THEN (total_debit - total_credit) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 6 AND code = '6112' THEN (total_debit - total_credit) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 6 AND code = '6113' THEN (total_debit - total_credit) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 6 AND code = '6114' THEN (total_debit - total_credit) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 6 AND code = '6115' THEN (total_debit - total_credit) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 6 AND code = '6116' THEN (total_debit - total_credit) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 6 AND code NOT IN ('6111','6112','6113','6114','6115','6116') THEN (total_debit - total_credit) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 6 THEN (total_debit - total_credit) END), 0),
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'account_id',    account_id,
          'code',          code,
          'name',          name,
          'debit',         total_debit,
          'credit',        total_credit,
          'balance',
            CASE
              WHEN balance_type = 'debit'  THEN (total_debit  - total_credit)
              ELSE                              (total_credit - total_debit)
            END,
          'account_class', account_class
        )
        ORDER BY code
      ) FILTER (WHERE total_debit <> 0 OR total_credit <> 0),
      '[]'::JSONB
    )
  INTO
    v_revenue_sales, v_revenue_disc, v_revenue_adj, v_revenue,
    v_cogs_prod, v_cogs_waste, v_cogs_other, v_cogs,
    v_opex_salary, v_opex_rent, v_opex_util, v_opex_supplies,
    v_opex_marketing, v_opex_maint, v_opex_other, v_opex,
    v_lines
  FROM agg;

  RETURN jsonb_build_object(
    'revenue', jsonb_build_object(
      'sales',       v_revenue_sales,
      'discounts',   v_revenue_disc,
      'adjustments', v_revenue_adj,
      'total',       v_revenue
    ),
    'cogs', jsonb_build_object(
      'production', v_cogs_prod,
      'waste',      v_cogs_waste,
      'other',      v_cogs_other,
      'total',      v_cogs
    ),
    'gross_profit',    (v_revenue - v_cogs)::NUMERIC(14,2),
    'opex', jsonb_build_object(
      'salary',      v_opex_salary,
      'rent',        v_opex_rent,
      'utilities',   v_opex_util,
      'supplies',    v_opex_supplies,
      'marketing',   v_opex_marketing,
      'maintenance', v_opex_maint,
      'other',       v_opex_other,
      'total',       v_opex
    ),
    'operating_profit', (v_revenue - v_cogs - v_opex)::NUMERIC(14,2),
    'net_profit',       (v_revenue - v_cogs - v_opex)::NUMERIC(14,2),
    'lines',  v_lines,
    'period', jsonb_build_object(
      'start',      p_date_start,
      'end',        p_date_end,
      'section_id', p_section_id
    )
  );
END;
$function$
;
REVOKE ALL ON FUNCTION public.get_profit_loss_v4(p_date_start date, p_date_end date, p_section_id uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_profit_loss_v4(p_date_start date, p_date_end date, p_section_id uuid) TO authenticated,service_role;
DROP FUNCTION public.get_profit_loss_v3(p_date_start date, p_date_end date, p_section_id uuid);

CREATE OR REPLACE FUNCTION public.get_trial_balance_v5(p_date_start date, p_date_end date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_lines JSONB; v_total_debit NUMERIC(14,2); v_total_credit NUMERIC(14,2);
  v_balanced BOOLEAN; v_delta NUMERIC(14,2);
BEGIN
  PERFORM public.assert_stock_owner_v1();
  IF NOT has_permission(auth.uid(), 'accounting.tb.read') THEN
    RAISE EXCEPTION 'permission denied: accounting.tb.read' USING ERRCODE = '42501';
  END IF;
  IF p_date_start IS NULL OR p_date_end IS NULL THEN
    RAISE EXCEPTION 'period_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_date_end < p_date_start THEN
    RAISE EXCEPTION 'period_end_before_start' USING ERRCODE = 'check_violation';
  END IF;

  WITH agg AS (
    SELECT a.id, a.code, a.name, a.account_class, a.balance_type,
      -- Période [start, end] — year_close exclue (écriture technique de clôture ;
      -- JE entière toutes classes → l'invariant Σ débit = Σ crédit reste vrai)
      SUM(CASE WHEN je.entry_date BETWEEN p_date_start AND p_date_end
                AND je.reference_type IS DISTINCT FROM 'year_close'
               THEN COALESCE(jel.debit, 0) ELSE 0 END)::NUMERIC(14,2)  AS per_debit,
      SUM(CASE WHEN je.entry_date BETWEEN p_date_start AND p_date_end
                AND je.reference_type IS DISTINCT FROM 'year_close'
               THEN COALESCE(jel.credit, 0) ELSE 0 END)::NUMERIC(14,2) AS per_credit,
      -- Ouverture (cumul strictement avant start — year_close INCLUSE : 3200 porte
      -- le report, les 4/5/6 rouvrent à 0)
      SUM(CASE WHEN je.entry_date < p_date_start
               THEN COALESCE(jel.debit, 0) ELSE 0 END)::NUMERIC(14,2)  AS open_debit,
      SUM(CASE WHEN je.entry_date < p_date_start
               THEN COALESCE(jel.credit, 0) ELSE 0 END)::NUMERIC(14,2) AS open_credit,
      -- Cumul as-of end (= ouverture + période — year_close INCLUSE)
      SUM(COALESCE(jel.debit, 0))::NUMERIC(14,2)  AS cum_debit,
      SUM(COALESCE(jel.credit, 0))::NUMERIC(14,2) AS cum_credit
    FROM accounts a
    LEFT JOIN (
      journal_entry_lines jel
      JOIN reporting_private.closed_shift_journal_entries_v1 je ON je.id = jel.journal_entry_id
        AND je.status IN ('posted','locked')
        AND je.entry_date <= p_date_end
        AND NOT (je.reference_type = 'sale_void'
          AND EXISTS (SELECT 1 FROM reporting_private.closed_shift_journal_entries_v1 jr JOIN refunds rf ON rf.id = jr.reference_id WHERE jr.reference_type = 'sale_refund' AND rf.order_id = je.reference_id))
    ) ON jel.account_id = a.id
    WHERE a.is_active = TRUE
    GROUP BY a.id, a.code, a.name, a.account_class, a.balance_type
  )
  SELECT
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'account_id', id, 'code', code, 'name', name, 'account_class', account_class,
        'balance_type', balance_type,
        -- Colonnes Débit/Crédit affichées = mouvements de période (compat v2)
        'total_debit', per_debit, 'total_credit', per_credit,
        -- Solde d'ouverture signé (cumul < start)
        'opening_balance', CASE balance_type WHEN 'debit' THEN (open_debit - open_credit)
                                             ELSE (open_credit - open_debit) END,
        -- Solde : permanents (1/2/3) = cumul as-of end ; résultat (4/5/6) = net de période
        'balance', CASE
          WHEN account_class IN (1,2,3) THEN
            CASE balance_type WHEN 'debit' THEN (cum_debit - cum_credit)
                              ELSE (cum_credit - cum_debit) END
          ELSE
            CASE balance_type WHEN 'debit' THEN (per_debit - per_credit)
                              ELSE (per_credit - per_debit) END
        END)
      ORDER BY code)
      FILTER (WHERE per_debit <> 0 OR per_credit <> 0
              OR (account_class IN (1,2,3) AND (cum_debit <> 0 OR cum_credit <> 0))),
      '[]'::JSONB),
    -- Totaux + invariant : mouvements de période (s'équilibrent toujours)
    COALESCE(SUM(per_debit), 0), COALESCE(SUM(per_credit), 0)
  INTO v_lines, v_total_debit, v_total_credit FROM agg;

  v_delta := (v_total_debit - v_total_credit)::NUMERIC(14,2);
  v_balanced := ABS(v_delta) < 0.01;

  RETURN jsonb_build_object(
    'period', jsonb_build_object('start', p_date_start, 'end', p_date_end),
    'lines', v_lines, 'total_debit', v_total_debit, 'total_credit', v_total_credit,
    'balanced', v_balanced, 'delta', v_delta);
END; $function$
;
REVOKE ALL ON FUNCTION public.get_trial_balance_v5(p_date_start date, p_date_end date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_trial_balance_v5(p_date_start date, p_date_end date) TO authenticated,service_role;
DROP FUNCTION public.get_trial_balance_v4(p_date_start date, p_date_end date);

CREATE OR REPLACE FUNCTION public.pay_existing_order_v25(p_order_id uuid, p_payment jsonb DEFAULT NULL::jsonb, p_customer_id uuid DEFAULT NULL::uuid, p_loyalty_points_redeemed integer DEFAULT 0, p_idempotency_key uuid DEFAULT NULL::uuid, p_discount_amount numeric DEFAULT 0, p_discount_type text DEFAULT NULL::text, p_discount_value numeric DEFAULT NULL::numeric, p_discount_reason text DEFAULT NULL::text, p_discount_authorized_by uuid DEFAULT NULL::uuid, p_discount_auth_id uuid DEFAULT NULL::uuid, p_promotions jsonb DEFAULT '[]'::jsonb, p_payments jsonb DEFAULT NULL::jsonb, p_offline_replay boolean DEFAULT false, p_session_id uuid DEFAULT NULL::uuid, p_outstanding boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_order orders; v_actor uuid; v_saved pos_payment_attempt_keys; v_request jsonb; v_result jsonb;
 v_payments jsonb; v_session uuid; v_paid numeric; v_tender jsonb; v_amount numeric;
BEGIN
 IF p_outstanding IS NULL OR p_offline_replay IS NULL THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023'; END IF;
 IF auth.uid() IS NULL OR NOT has_permission(auth.uid(),'payments.process') THEN
  RAISE EXCEPTION 'permission_denied: payments.process' USING ERRCODE='P0003'; END IF;
 SELECT id INTO v_actor FROM user_profiles WHERE auth_user_id=auth.uid() AND deleted_at IS NULL;
 IF v_actor IS NULL OR p_idempotency_key IS NULL THEN RAISE EXCEPTION 'payment_identity_required' USING ERRCODE='22023'; END IF;
 IF p_payment IS NOT NULL AND p_payments IS NOT NULL THEN RAISE EXCEPTION 'ambiguous_tenders' USING ERRCODE='22023'; END IF;
 v_payments:=COALESCE(p_payments,CASE WHEN p_payment IS NOT NULL THEN jsonb_build_array(p_payment) ELSE '[]'::jsonb END);
 IF jsonb_typeof(v_payments) IS DISTINCT FROM 'array' OR jsonb_array_length(v_payments)>5 THEN
  RAISE EXCEPTION 'invalid_tenders' USING ERRCODE='23514'; END IF;
 FOR v_tender IN SELECT * FROM jsonb_array_elements(v_payments) LOOP
  v_amount:=(v_tender->>'amount')::numeric;
  IF v_amount IS NULL OR v_amount<=0 OR v_amount::text IN ('NaN','Infinity','-Infinity') OR v_amount<>round(v_amount,2)
   OR (v_tender->>'method') IS NULL THEN RAISE EXCEPTION 'invalid_tender' USING ERRCODE='23514'; END IF;
 END LOOP;
 v_request:=jsonb_build_object('order_id',p_order_id,'payments',v_payments,'customer_id',p_customer_id,
  'points',p_loyalty_points_redeemed,'discount',p_discount_amount,'discount_type',p_discount_type,'discount_value',p_discount_value,
  'discount_reason',p_discount_reason,'authorized_by',p_discount_authorized_by,'promotions',p_promotions,
  'session_id',p_session_id,'outstanding',p_outstanding,'offline',p_offline_replay);
 PERFORM pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text,0));
 SELECT * INTO v_saved FROM pos_payment_attempt_keys WHERE key=p_idempotency_key;
 IF FOUND THEN
  IF v_saved.actor_id<>v_actor OR v_saved.order_id<>p_order_id OR v_saved.request<>v_request THEN
   RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='22023'; END IF;
  RETURN v_saved.result||jsonb_build_object('idempotent_replay',true);
 END IF;
 SELECT * INTO v_order FROM orders WHERE id=p_order_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'order_not_found' USING ERRCODE='P0002'; END IF;
 IF EXISTS(SELECT 1 FROM orders WHERE idempotency_key=p_idempotency_key AND id<>p_order_id) THEN
  RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='22023'; END IF;
 v_session:=COALESCE(p_session_id,v_order.session_id);
 IF v_session IS NULL THEN RAISE EXCEPTION 'no_open_shift' USING ERRCODE='P0001'; END IF;
 -- Le verrou partagé empêche une clôture de dépasser un encaissement en vol.
 PERFORM id FROM pos_sessions WHERE id=v_session AND (status='open' OR p_offline_replay) FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'no_open_shift' USING ERRCODE='P0001'; END IF;
 IF p_outstanding AND p_offline_replay THEN RAISE EXCEPTION 'outstanding_unavailable_offline' USING ERRCODE='23514'; END IF;
 PERFORM set_config('breakery.payment_session_id',v_session::text,true);
 IF v_order.outstanding_at IS NOT NULL THEN
  v_result:=_receive_pos_outstanding_v1(p_order_id,v_payments,p_customer_id,v_actor,p_idempotency_key,p_outstanding);
 ELSE
  v_result:=stock_private.pay_existing_order_v23(p_order_id,NULL,p_customer_id,p_loyalty_points_redeemed,p_idempotency_key,
   p_discount_amount,p_discount_type,p_discount_value,p_discount_reason,p_discount_authorized_by,p_discount_auth_id,
   p_promotions,v_payments,p_offline_replay,p_outstanding);
  SELECT COALESCE(sum(amount),0) INTO v_paid FROM order_payments WHERE order_id=p_order_id;
  v_result:=v_result||jsonb_build_object('amount_received',v_paid,'amount_paid',v_paid,'remaining_due',GREATEST((v_result->>'total')::numeric-v_paid,0));
 END IF;
 v_result:=stock_private.mask_stock_payload(v_result);
 BEGIN
  INSERT INTO pos_payment_attempt_keys(key,order_id,actor_id,request,result) VALUES(p_idempotency_key,p_order_id,v_actor,v_request,v_result);
 EXCEPTION WHEN unique_violation THEN
  SELECT * INTO STRICT v_saved FROM pos_payment_attempt_keys WHERE key=p_idempotency_key;
  IF v_saved.actor_id<>v_actor OR v_saved.order_id<>p_order_id OR v_saved.request<>v_request THEN
   RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='22023'; END IF;
  RETURN v_saved.result||jsonb_build_object('idempotent_replay',true);
 END;
 RETURN v_result;
EXCEPTION WHEN OTHERS THEN
 IF NOT public.can_view_business_day_v2(current_date) AND SQLSTATE='P0002' AND SQLERRM ~* '(insufficient.*stock|have )' THEN
  RAISE EXCEPTION 'insufficient_stock' USING ERRCODE='P0002'; END IF;
 RAISE;
END $function$
;
REVOKE ALL ON FUNCTION public.pay_existing_order_v25(p_order_id uuid, p_payment jsonb, p_customer_id uuid, p_loyalty_points_redeemed integer, p_idempotency_key uuid, p_discount_amount numeric, p_discount_type text, p_discount_value numeric, p_discount_reason text, p_discount_authorized_by uuid, p_discount_auth_id uuid, p_promotions jsonb, p_payments jsonb, p_offline_replay boolean, p_session_id uuid, p_outstanding boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pay_existing_order_v25(p_order_id uuid, p_payment jsonb, p_customer_id uuid, p_loyalty_points_redeemed integer, p_idempotency_key uuid, p_discount_amount numeric, p_discount_type text, p_discount_value numeric, p_discount_reason text, p_discount_authorized_by uuid, p_discount_auth_id uuid, p_promotions jsonb, p_payments jsonb, p_offline_replay boolean, p_session_id uuid, p_outstanding boolean) TO authenticated,service_role;
DROP FUNCTION public.pay_existing_order_v24(p_order_id uuid, p_payment jsonb, p_customer_id uuid, p_loyalty_points_redeemed integer, p_idempotency_key uuid, p_discount_amount numeric, p_discount_type text, p_discount_value numeric, p_discount_reason text, p_discount_authorized_by uuid, p_discount_auth_id uuid, p_promotions jsonb, p_payments jsonb, p_offline_replay boolean, p_session_id uuid, p_outstanding boolean);

CREATE OR REPLACE FUNCTION public._dashboard_cash_on_hand_v2()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_out JSONB;
BEGIN
  WITH wallets AS (
    SELECT a.code, a.name,
           COALESCE(SUM(CASE WHEN je.id IS NOT NULL THEN jel.debit - jel.credit ELSE 0 END), 0)::numeric AS balance
      FROM accounts a
      LEFT JOIN reporting_private.closed_shift_journal_lines_v1 jel ON jel.account_id = a.id
      LEFT JOIN reporting_private.closed_shift_journal_entries_v1 je
             ON je.id = jel.journal_entry_id AND je.status = 'posted'
     WHERE a.code IN ('1110', '1111', '1117')
     GROUP BY a.code, a.name
  ),
  drawer AS (
    SELECT COALESCE(SUM(
             s.opening_cash + s.cash_in_total - s.cash_out_total
             + COALESCE((SELECT SUM(op.amount)
                           FROM order_payments op
                           JOIN orders o ON o.id = op.order_id
                          WHERE o.session_id = s.id
                            AND o.status IN ('paid', 'completed')
                            AND op.method = 'cash'), 0)
           ), 0) AS expected
      FROM pos_sessions s
     WHERE s.status = 'open' AND public.is_business_owner_v1()
  )
  SELECT jsonb_build_object(
           'value',      COALESCE((SELECT SUM(balance) FROM wallets), 0),
           'drawer',     CASE WHEN public.is_business_owner_v1() THEN (SELECT expected FROM drawer) END,
           'safe',       CASE WHEN public.is_business_owner_v1() THEN COALESCE((SELECT SUM(balance) FROM wallets), 0)
                           - (SELECT expected FROM drawer) END,
           'is_derived', public.is_business_owner_v1(),
           'wallets',    COALESCE((SELECT jsonb_agg(jsonb_build_object(
                            'code', code, 'name', name, 'balance', balance
                          ) ORDER BY code) FROM wallets), '[]'::jsonb))
    INTO v_out;

  RETURN v_out;
END;
$function$
;
REVOKE ALL ON FUNCTION public._dashboard_cash_on_hand_v2() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public._dashboard_cash_on_hand_v2() TO service_role;
DROP FUNCTION public._dashboard_cash_on_hand_v1();

CREATE OR REPLACE FUNCTION public.get_pos_order_snapshot_v5(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
 IF NOT public.can_view_order_v2(p_order_id) THEN RAISE EXCEPTION 'business_day_not_released' USING ERRCODE='P0003'; END IF;
 RETURN stock_private.mask_stock_payload(stock_private.get_pos_order_snapshot_v2(p_order_id)) ||
  (SELECT jsonb_build_object('outstanding_at',o.outstanding_at,'total',o.total,
    'amount_paid',COALESCE((SELECT sum(amount) FROM order_payments WHERE order_id=o.id),0))
   FROM orders o WHERE id=p_order_id);
EXCEPTION WHEN OTHERS THEN
 IF NOT public.can_view_business_day_v2(current_date)
    AND (SQLERRM ~* '(stock|shortage)' OR COALESCE(SQLERRM,'') ~* 'have [0-9]')
 THEN RAISE EXCEPTION 'stock_operation_rejected' USING ERRCODE=SQLSTATE; END IF;
 RAISE;
END $function$
;
REVOKE ALL ON FUNCTION public.get_pos_order_snapshot_v5(p_order_id uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_pos_order_snapshot_v5(p_order_id uuid) TO authenticated,service_role;
DROP FUNCTION public.get_pos_order_snapshot_v4(p_order_id uuid);
