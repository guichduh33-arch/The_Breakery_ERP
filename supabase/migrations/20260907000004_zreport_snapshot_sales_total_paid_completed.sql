-- Audit lot 2, P0-3 — le Z-report comptait des ventes JAMAIS encaissées.
--
-- `v_sales_total` filtrait `status NOT IN ('voided')`, donc `draft`,
-- `pending_payment` et `b2b_pending` entraient dans le total de ventes du
-- document de fin de service. L'ADR-009 déc. 4 dit l'inverse : les lecteurs
-- financiers lisent `paid` ET `completed`. La fonction cite d'ailleurs cette
-- décision en commentaire — mais seulement au-dessus des blocs QRIS et carte.
--
-- Mesuré sur V3 dev avant correctif :
--   session b3621a75… → 205 000 affichés / 140 000 encaissés (+46 %)
--   session 03242df1… → 625 000 affichés / 580 000 encaissés (+7,8 %)
-- Le `totals_by_payment_method` du MÊME snapshot est bâti sur `order_payments`,
-- donc sur l'argent réel : le document se contredisait lui-même.
--
-- Portée du correctif — une seule des quatre occurrences change :
--   * `v_payment_totals` : NON TOUCHÉ. Il somme `order_payments`, pas
--     `orders.total`. Une ardoise `pending_payment` avec acompte porte de vrais
--     encaissements ; les restreindre à paid|completed retirerait du Z de
--     l'argent réellement dans le tiroir.
--   * `v_sales_total`    : CORRIGÉ (le P0).
--   * `v_voids_total`    : NON TOUCHÉ, il cible `= 'voided'` volontairement.
--   * `v_top_products`   : NON TOUCHÉ ici. Il ignore `is_cancelled` et
--     `is_promo_gift` — défaut réel (P1, R-04 du relevé), hors du mandat P0.
--
-- Aucun Z-report signé ne porte le chiffre faux : 64 lignes dans `z_reports`,
-- **0 signée**. Il n'y a donc pas d'historique à reprendre.
--
-- Helper non versionné (pas de suffixe `_vN`) : CREATE OR REPLACE, ACL preservee.

CREATE OR REPLACE FUNCTION public._build_zreport_snapshot(p_shift_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_session         pos_sessions%ROWTYPE;
  v_snapshot        JSONB;
  v_payment_totals  JSONB;
  v_top_products    JSONB;
  v_sales_total     NUMERIC(15,2);
  v_refunds_total   NUMERIC(15,2);
  v_voids_total     NUMERIC(15,2);
  v_expenses_cash   NUMERIC(15,2);
  -- S67 additions
  v_qris_expected   NUMERIC;
  v_card_expected   NUMERIC;
BEGIN
  SELECT * INTO v_session FROM pos_sessions WHERE id = p_shift_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Shift % not found', p_shift_id USING ERRCODE = 'P0002';
  END IF;

  -- Payment totals by method (excluding voided orders).
  -- Volontairement PAS restreint a paid|completed : cette somme porte sur
  -- order_payments, donc sur de l'argent reellement encaisse. Une ardoise
  -- pending_payment avec acompte doit y figurer.
  SELECT COALESCE(jsonb_object_agg(method, total), '{}'::jsonb) INTO v_payment_totals
  FROM (
    SELECT op.method::text, SUM(op.amount) AS total
    FROM order_payments op
    JOIN orders o ON o.id = op.order_id
    WHERE o.session_id = p_shift_id
      AND o.status::text NOT IN ('voided')
    GROUP BY op.method
  ) t;

  -- Gross sales total. ADR-009 dec. 4 : les lecteurs financiers lisent
  -- paid|completed. Un NOT IN ('voided') laissait entrer draft,
  -- pending_payment et b2b_pending — des ventes jamais encaissees.
  SELECT COALESCE(SUM(total), 0) INTO v_sales_total
  FROM orders
  WHERE session_id = p_shift_id
    AND status IN ('paid', 'completed');

  -- Refunds: refunds.order_id → orders.session_id join
  SELECT COALESCE(SUM(r.total), 0) INTO v_refunds_total
  FROM refunds r
  JOIN orders o ON o.id = r.order_id
  WHERE o.session_id = p_shift_id;

  -- Voids total
  SELECT COALESCE(SUM(total), 0) INTO v_voids_total
  FROM orders
  WHERE session_id = p_shift_id
    AND status::text = 'voided';

  -- Top 10 products by quantity (excluding voided orders)
  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO v_top_products
  FROM (
    SELECT
      oi.product_id,
      oi.name_snapshot  AS product_name,
      SUM(oi.quantity)::numeric    AS qty,
      SUM(oi.line_total)::numeric  AS revenue
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    WHERE o.session_id = p_shift_id
      AND o.status::text NOT IN ('voided')
    GROUP BY oi.product_id, oi.name_snapshot
    ORDER BY qty DESC
    LIMIT 10
  ) t;

  -- Cash expenses paid during this shift window
  SELECT COALESCE(SUM(amount + COALESCE(vat_amount, 0)), 0) INTO v_expenses_cash
  FROM expenses e
  WHERE e.payment_method = 'cash'
    AND e.status = 'paid'
    AND e.paid_at >= v_session.opened_at
    AND (v_session.closed_at IS NULL OR e.paid_at <= v_session.closed_at);

  -- S67 (12 D2.2): expected per non-cash volet, mirror of close_shift.
  -- ADR-009 déc. 4 : statuts paid|completed.
  SELECT COALESCE(SUM(op.amount), 0) INTO v_qris_expected
    FROM order_payments op
    JOIN orders o ON o.id = op.order_id
   WHERE o.session_id = p_shift_id
     AND o.status IN ('paid', 'completed')
     AND op.method IN ('qris', 'gopay', 'ovo', 'dana');
  SELECT COALESCE(SUM(op.amount), 0) INTO v_card_expected
    FROM order_payments op
    JOIN orders o ON o.id = op.order_id
   WHERE o.session_id = p_shift_id
     AND o.status IN ('paid', 'completed')
     AND op.method IN ('card', 'edc');

  v_snapshot := jsonb_build_object(
    'shift_id',              p_shift_id,
    'opened_at',             v_session.opened_at,
    'closed_at',             v_session.closed_at,
    'opened_by',             v_session.opened_by,
    'closed_by',             v_session.closed_by,
    'opening_cash',          v_session.opening_cash,
    'closing_cash_expected', v_session.expected_cash,
    'closing_cash_counted',  v_session.closing_cash,
    'cash_variance',         COALESCE(v_session.closing_cash - v_session.expected_cash, 0),
    'cash_in_total',         COALESCE(v_session.cash_in_total, 0),
    'cash_out_total',        COALESCE(v_session.cash_out_total, 0),
    'totals_by_payment_method', v_payment_totals,
    'sales_total',           v_sales_total,
    'refunds_total',         v_refunds_total,
    'voids_total',           v_voids_total,
    'expenses_cash_total',   v_expenses_cash,
    'reconciliation',        jsonb_build_object(
      'cash', jsonb_build_object(
        'expected', v_session.expected_cash,
        'counted',  v_session.closing_cash,
        'variance', COALESCE(v_session.closing_cash - v_session.expected_cash, 0)
      ),
      'qris', jsonb_build_object(
        'expected', v_qris_expected,
        'counted',  v_session.counted_qris,
        'variance', CASE WHEN v_session.counted_qris IS NULL THEN NULL
                         ELSE v_session.counted_qris - v_qris_expected END
      ),
      'card', jsonb_build_object(
        'expected', v_card_expected,
        'counted',  v_session.counted_card,
        'variance', CASE WHEN v_session.counted_card IS NULL THEN NULL
                         ELSE v_session.counted_card - v_card_expected END
      )
    ),
    'denominations',         v_session.closing_denominations,
    'top_products',          v_top_products,
    'generated_at',          now()
  );

  RETURN v_snapshot;
END;
$function$;

COMMENT ON FUNCTION public._build_zreport_snapshot(uuid) IS
  'Snapshot du Z-report. sales_total lit paid|completed (ADR-009 dec. 4) ; totals_by_payment_method reste sur order_payments (argent reellement encaisse, acomptes compris).';
