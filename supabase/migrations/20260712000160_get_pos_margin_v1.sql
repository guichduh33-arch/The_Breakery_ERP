-- Reports POS refonte (dernier lot) — Margin tab: gross margin on CURRENT WAC.
-- Order scope ≡ Overview (_146/_153): paid+completed, non-B2B, non-historical,
-- no test-product line, WITA business date (paid_at ?? created_at) — so
-- summary.revenue_ttc reconciles with Overview revenue EXACTLY (pgTAP-asserted).
--   * summary     — revenue_ttc (order-level SUM(total)), revenue_ht (line-level
--                   SUM(line_total), net of item discounts, gross of order-level
--                   discounts — same basis as BO get_gross_margin_by_product_v1),
--                   cogs, gross_margin, margin_pct, orders, products_without_cost.
--   * by_product / by_category — line-level (is_cancelled=false). Promo-gift
--                   lines ARE included with revenue forced to 0: a gifted product
--                   consumes stock, so it weighs on real margin. This is the one
--                   deliberate divergence from Overview items_sold (which excludes
--                   gifts).
-- COGS = quantity × products.cost_price (CURRENT WAC — caveat surfaced in the UI;
-- the at-sale COGS snapshot stays in Vague 3). cost_price NULL/0 → cogs 0 and the
-- product is counted in products_without_cost (margin otherwise silently inflated).
-- Gated reports.financial.read (NOT reports.sales.read — costs are not for every
-- sales reader; mirrors the BO margin gate). Read-only. Money-path untouched.
-- Divergence vs BO get_gross_margin_by_product_v1 is deliberate and documented:
-- the BO includes settled B2B and does not exclude test products.

CREATE OR REPLACE FUNCTION public.get_pos_margin_v1(
  p_start_date date,
  p_end_date   date
) RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tz          TEXT;
  v_start       date;
  v_end         date;
  v_summary     JSONB;
  v_by_product  JSONB;
  v_by_category JSONB;
BEGIN
  IF auth.uid() IS NULL OR NOT has_permission(auth.uid(), 'reports.financial.read') THEN
    RAISE EXCEPTION 'permission denied: reports.financial.read required' USING ERRCODE = '42501';
  END IF;
  IF p_start_date IS NULL OR p_end_date IS NULL THEN
    RAISE EXCEPTION 'start and end dates are required' USING ERRCODE = 'P0001';
  END IF;
  IF p_start_date > p_end_date THEN
    RAISE EXCEPTION 'invalid_date_range' USING ERRCODE = 'P0001';
  END IF;
  v_start := p_start_date;
  v_end   := p_end_date;
  IF v_end - v_start > 366 THEN
    v_start := v_end - 366;  -- clamp pattern S30/S40
  END IF;

  SELECT COALESCE(MAX(timezone), 'Asia/Makassar') INTO v_tz
    FROM business_config WHERE id = 1;

  WITH scoped AS (
    SELECT o.id, o.total
    FROM orders o
    WHERE o.status IN ('paid', 'completed')
      AND o.order_type <> 'b2b'
      AND o.is_historical_import = false
      AND NOT EXISTS (
        SELECT 1 FROM order_items oi
        JOIN products p ON p.id = oi.product_id
        WHERE oi.order_id = o.id AND p.is_test = true
      )
      AND ((COALESCE(o.paid_at, o.created_at) AT TIME ZONE v_tz))::date
          BETWEEN v_start AND v_end
  ),
  lines AS (
    SELECT
      oi.product_id,
      p.name                              AS product_name,
      c.id                                AS category_id,
      COALESCE(c.name, '(uncategorized)') AS category_name,
      oi.quantity                         AS qty,
      CASE WHEN oi.is_promo_gift THEN 0 ELSE oi.line_total END AS revenue_ht,
      (oi.quantity * COALESCE(p.cost_price, 0))::numeric(14,2) AS cogs,
      (COALESCE(p.cost_price, 0) <= 0)    AS no_cost
    FROM order_items oi
    JOIN scoped   s ON s.id = oi.order_id
    JOIN products p ON p.id = oi.product_id
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE oi.is_cancelled = false
  ),
  prod AS (
    SELECT product_id, product_name, category_name,
           SUM(qty) AS qty, SUM(revenue_ht) AS rev, SUM(cogs) AS cogs
    FROM lines GROUP BY product_id, product_name, category_name
  ),
  cat AS (
    SELECT category_id, category_name,
           SUM(qty) AS qty, SUM(revenue_ht) AS rev, SUM(cogs) AS cogs
    FROM lines GROUP BY category_id, category_name
  ),
  tot AS (SELECT COALESCE(SUM(total), 0) AS ttc, COUNT(*) AS n FROM scoped),
  ltot AS (
    SELECT COALESCE(SUM(revenue_ht), 0) AS rev,
           COALESCE(SUM(cogs), 0)       AS cogs,
           COUNT(DISTINCT product_id) FILTER (WHERE no_cost) AS no_cost_products
    FROM lines
  )
  SELECT
    jsonb_build_object(
      'revenue_ttc',  (SELECT ttc FROM tot),
      'revenue_ht',   (SELECT rev FROM ltot),
      'cogs',         (SELECT cogs FROM ltot),
      'gross_margin', (SELECT rev - cogs FROM ltot),
      'margin_pct',   (SELECT COALESCE(ROUND(100 * (rev - cogs) / NULLIF(rev, 0), 2), 0) FROM ltot),
      'orders',       (SELECT n FROM tot),
      'products_without_cost', (SELECT no_cost_products FROM ltot)
    ),
    COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'product_id',    g.product_id,
        'product_name',  g.product_name,
        'category_name', g.category_name,
        'qty',           g.qty,
        'revenue_ht',    g.rev,
        'cogs',          g.cogs,
        'margin',        g.rev - g.cogs,
        'margin_pct',    COALESCE(ROUND(100 * (g.rev - g.cogs) / NULLIF(g.rev, 0), 2), 0)
      ) ORDER BY g.rev DESC) FROM prod g), '[]'::jsonb),
    COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'category_id',   g.category_id,
        'category_name', g.category_name,
        'qty',           g.qty,
        'revenue_ht',    g.rev,
        'cogs',          g.cogs,
        'margin',        g.rev - g.cogs,
        'margin_pct',    COALESCE(ROUND(100 * (g.rev - g.cogs) / NULLIF(g.rev, 0), 2), 0)
      ) ORDER BY g.rev DESC) FROM cat g), '[]'::jsonb)
  INTO v_summary, v_by_product, v_by_category;

  RETURN jsonb_build_object(
    'generated_at', now(),
    'start_date',   v_start,
    'end_date',     v_end,
    'timezone',     v_tz,
    'summary',      v_summary,
    'by_product',   v_by_product,
    'by_category',  v_by_category
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_pos_margin_v1(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_pos_margin_v1(date, date) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
COMMENT ON FUNCTION public.get_pos_margin_v1(date, date) IS
  'POS reports Margin tab: gross margin on CURRENT WAC (products.cost_price) over a WITA range; order scope shared with the Overview (paid+completed, non-B2B, non-historical, no test-product line) so revenue_ttc reconciles exactly; promo-gift lines counted in COGS with revenue 0; gated reports.financial.read. Read-only. Deliberately diverges from BO get_gross_margin_by_product_v1 (which includes B2B).';