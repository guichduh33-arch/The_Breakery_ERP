-- 20260710000093_create_get_gross_margin_by_product_v1.sql
-- S57 Chantier B (B-D1/B-D2/B-D3) — Gross margin by product.
--
-- Schema facts verified on pieces:
--   order_items.line_total  — HT revenue per line, already net of item discount
--     (orders.subtotal = SUM(order_items.line_total), 20260618000013).
--   order_items.is_cancelled — cancelled lines excluded from order totals
--     (20260710000083 recalcs WHERE is_cancelled = false) — mirrored here.
--   products.cost_price     — WAC per base unit (trigger tr_update_product_cost_on_purchase).
--   products.category_id NOT NULL, categories.name.
--   orders.status enum: draft/paid/voided/pending_payment/completed/b2b_pending.
--     paid/completed = settled (POS AND B2B — create_b2b_order_v3 inserts
--     status='b2b_pending' at creation, record_b2b_payment_v2 flips to 'paid'
--     + sets paid_at only on full settlement — 20260710000075/67).
--   orders.voided_at — belt-and-suspenders alongside status <> 'voided'
--     (pattern get_daily_sales_v1, 20260624000011).
--   business_config.timezone (id=1, default 'Asia/Makassar') — tz bucketing pattern.
--
-- Caveat (documented in COMMENT + surfaced in UI per B-D2): cost = products.cost_price
-- CURRENT WAC, not a snapshot at time of sale. Refunds are not deducted per-product
-- (no line-level refund granularity) — global caveat, see B-D3.

CREATE OR REPLACE FUNCTION public.get_gross_margin_by_product_v1(
  p_start_date  TEXT,
  p_end_date    TEXT,
  p_category_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_start    DATE;
  v_end      DATE;
  v_tz       TEXT;
  v_summary  JSONB;
  v_by_prod  JSONB;
  v_by_cat   JSONB;
BEGIN
  IF auth.uid() IS NULL OR NOT has_permission(auth.uid(), 'reports.financial.read') THEN
    RAISE EXCEPTION 'permission denied: reports.financial.read required'
      USING ERRCODE = '42501';
  END IF;

  v_start := p_start_date::DATE;
  v_end   := p_end_date::DATE;
  IF v_end < v_start THEN
    RAISE EXCEPTION 'invalid range: end before start' USING ERRCODE = 'P0001';
  END IF;
  -- clamp pattern S30/S40 : 366 jours max
  IF v_end - v_start > 366 THEN
    v_start := v_end - 366;
  END IF;

  SELECT COALESCE(MAX(timezone), 'Asia/Makassar') INTO v_tz
    FROM business_config WHERE id = 1;

  WITH valid_lines AS (
    SELECT
      oi.product_id,
      p.name                              AS product_name,
      COALESCE(p.category_id, '00000000-0000-0000-0000-000000000000'::uuid) AS category_id,
      COALESCE(c.name, 'Uncategorized')   AS category_name,
      oi.quantity                         AS qty,
      oi.line_total                       AS revenue,
      (oi.quantity * p.cost_price)::NUMERIC(14,2) AS cogs
    FROM order_items oi
    JOIN orders o    ON o.id = oi.order_id
    JOIN products p  ON p.id = oi.product_id
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE o.status IN ('paid', 'completed')
      AND o.voided_at IS NULL
      AND oi.is_cancelled = false
      AND o.paid_at IS NOT NULL
      AND ((o.paid_at AT TIME ZONE v_tz))::date BETWEEN v_start AND v_end
      AND (p_category_id IS NULL OR p.category_id = p_category_id)
  ),
  by_product AS (
    SELECT
      product_id,
      MAX(product_name)   AS name,
      MAX(category_name)  AS category_name,
      SUM(qty)            AS qty,
      SUM(revenue)::NUMERIC(14,2) AS revenue,
      SUM(cogs)::NUMERIC(14,2)    AS cogs
    FROM valid_lines
    GROUP BY product_id
  ),
  by_category AS (
    SELECT
      category_id,
      MAX(category_name)  AS category_name,
      SUM(qty)            AS qty,
      SUM(revenue)::NUMERIC(14,2) AS revenue,
      SUM(cogs)::NUMERIC(14,2)    AS cogs
    FROM valid_lines
    GROUP BY category_id
  )
  SELECT
    jsonb_build_object(
      'revenue',    COALESCE((SELECT SUM(revenue) FROM valid_lines), 0),
      'cogs',       COALESCE((SELECT SUM(cogs)    FROM valid_lines), 0),
      'margin',     COALESCE((SELECT SUM(revenue) - SUM(cogs) FROM valid_lines), 0),
      'margin_pct', CASE WHEN COALESCE((SELECT SUM(revenue) FROM valid_lines), 0) = 0 THEN 0
                         ELSE ROUND(
                           ((SELECT SUM(revenue) - SUM(cogs) FROM valid_lines)
                             / (SELECT SUM(revenue) FROM valid_lines)) * 100, 2)
                    END
    ),
    (SELECT COALESCE(jsonb_agg(
       jsonb_build_object(
         'product_id',  bp.product_id,
         'name',        bp.name,
         'category_name', bp.category_name,
         'qty',         bp.qty,
         'revenue',     bp.revenue,
         'cogs',        bp.cogs,
         'margin',      bp.revenue - bp.cogs,
         'margin_pct',  CASE WHEN bp.revenue = 0 THEN 0
                              ELSE ROUND(((bp.revenue - bp.cogs) / bp.revenue) * 100, 2)
                         END
       ) ORDER BY (bp.revenue - bp.cogs) DESC
     ), '[]'::jsonb)
     FROM by_product bp),
    (SELECT COALESCE(jsonb_agg(
       jsonb_build_object(
         'category_id',   bc.category_id,
         'category_name', bc.category_name,
         'qty',           bc.qty,
         'revenue',       bc.revenue,
         'cogs',          bc.cogs,
         'margin',        bc.revenue - bc.cogs,
         'margin_pct',    CASE WHEN bc.revenue = 0 THEN 0
                                ELSE ROUND(((bc.revenue - bc.cogs) / bc.revenue) * 100, 2)
                           END
       ) ORDER BY (bc.revenue - bc.cogs) DESC
     ), '[]'::jsonb)
     FROM by_category bc)
  INTO v_summary, v_by_prod, v_by_cat;

  RETURN jsonb_build_object(
    'period',      jsonb_build_object('start', v_start, 'end', v_end),
    'summary',     v_summary,
    'by_product',  v_by_prod,
    'by_category', v_by_cat
  );
END;
$$;

COMMENT ON FUNCTION public.get_gross_margin_by_product_v1(TEXT, TEXT, UUID) IS
  'S57 B-D1/B-D2 — Gross margin by product (revenue HT net PB1 via order_items.line_total, '
  'cost = products.cost_price CURRENT WAC — NOT a snapshot at time of sale, see backlog P3). '
  'POS + B2B, statuses paid/completed non-voided, is_cancelled lines excluded. Partial '
  'refunds not deducted per-product (no line-level granularity). Bornes en business_config.timezone. '
  '366-day clamp. Gate reports.financial.read.';

REVOKE ALL     ON FUNCTION public.get_gross_margin_by_product_v1(TEXT, TEXT, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_gross_margin_by_product_v1(TEXT, TEXT, UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_gross_margin_by_product_v1(TEXT, TEXT, UUID) TO authenticated;
