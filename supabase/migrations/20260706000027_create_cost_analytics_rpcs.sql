-- 20260706000027_create_cost_analytics_rpcs.sql
-- Cost & Spend Analytics — two read RPCs powering the new Purchase-COGS +
-- Operating-Expenses reports and the consolidated "Cost & Spend" dashboard.
--
--   get_purchase_cogs_breakdown_v1 — material purchasing spend (COGS proxy)
--     ventilated by PRODUCT CATEGORY and by day. Gate reports.inventory.read
--     (same as the other purchase reports). Item-level: SUM(poi.subtotal).
--     JOINs verified from 20260517000110_init_purchase_orders.sql +
--     20260624000012_create_get_purchase_items_v1_rpc.sql:
--       purchase_order_items.po_id      -> purchase_orders.id
--       purchase_order_items.product_id -> products.id
--       products.category_id            -> categories.id  (nullable)
--       purchase_orders.supplier_id     -> suppliers.id
--     po.status CHECK ('draft','pending','partial','received','cancelled');
--     excl. draft/cancelled. poi.subtotal is GENERATED (quantity * unit_cost).
--
--   get_expenses_by_category_v1 — operational expense ledger ventilated by
--     EXPENSE CATEGORY and by day. Gate reports.financial.read (finance domain).
--     Source: expenses + expense_categories (20260517000120_init_expenses.sql).
--     Default status scope = committed spend (excl. 'draft' + 'rejected');
--     p_status filters to a single status when provided.
--
-- Both: SECURITY DEFINER, search_path pinned, 366-day clamp (S30 pattern),
-- REVOKE PUBLIC + anon (S20 defense-in-depth), GRANT authenticated.

BEGIN;

-- =============================================================================
-- 1. get_purchase_cogs_breakdown_v1
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_purchase_cogs_breakdown_v1(
  p_date_start  TEXT,
  p_date_end    TEXT,
  p_category_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_start       DATE;
  v_end         DATE;
  v_total       NUMERIC;
  v_line_count  INT;
  v_by_category JSONB;
  v_by_day      JSONB;
BEGIN
  IF auth.uid() IS NULL OR NOT has_permission(auth.uid(), 'reports.inventory.read') THEN
    RAISE EXCEPTION 'permission denied: reports.inventory.read required'
      USING ERRCODE = '42501';
  END IF;

  v_start := p_date_start::DATE;
  v_end   := p_date_end::DATE;
  IF v_end < v_start THEN
    RAISE EXCEPTION 'invalid range: end before start' USING ERRCODE = 'P0001';
  END IF;
  IF v_end - v_start > 366 THEN
    v_start := v_end - 366;
  END IF;

  -- Base set: received-ish PO lines within range, optional category filter.
  WITH lines AS (
    SELECT
      COALESCE(c.id, '00000000-0000-0000-0000-000000000000'::uuid) AS category_id,
      COALESCE(c.name, 'Uncategorized')                            AS category_name,
      po.order_date                                                AS order_date,
      poi.subtotal                                                 AS subtotal,
      poi.quantity                                                 AS quantity
    FROM purchase_order_items poi
    JOIN purchase_orders po ON po.id = poi.po_id
    JOIN products p         ON p.id  = poi.product_id
    LEFT JOIN categories c  ON c.id  = p.category_id
    WHERE po.status NOT IN ('draft', 'cancelled')
      AND po.deleted_at IS NULL
      AND po.order_date BETWEEN v_start AND v_end
      AND (p_category_id IS NULL OR p.category_id = p_category_id)
  )
  SELECT
    COALESCE(SUM(subtotal), 0),
    COUNT(*)::INT
  INTO v_total, v_line_count
  FROM lines;

  -- by_category (share computed against the period total)
  SELECT COALESCE(jsonb_agg(row ORDER BY (row->>'total')::numeric DESC), '[]'::jsonb)
  INTO v_by_category
  FROM (
    SELECT jsonb_build_object(
      'category_id', g.category_id,
      'name',        g.category_name,
      'total',       g.total,
      'qty',         g.qty,
      'share_pct',   CASE WHEN v_total > 0 THEN ROUND(g.total / v_total * 100, 2) ELSE 0 END
    ) AS row
    FROM (
      SELECT
        category_id,
        category_name,
        SUM(subtotal) AS total,
        SUM(quantity) AS qty
      FROM (
        SELECT
          COALESCE(c.id, '00000000-0000-0000-0000-000000000000'::uuid) AS category_id,
          COALESCE(c.name, 'Uncategorized')                            AS category_name,
          poi.subtotal AS subtotal,
          poi.quantity AS quantity
        FROM purchase_order_items poi
        JOIN purchase_orders po ON po.id = poi.po_id
        JOIN products p         ON p.id  = poi.product_id
        LEFT JOIN categories c  ON c.id  = p.category_id
        WHERE po.status NOT IN ('draft', 'cancelled')
          AND po.deleted_at IS NULL
          AND po.order_date BETWEEN v_start AND v_end
          AND (p_category_id IS NULL OR p.category_id = p_category_id)
      ) src
      GROUP BY category_id, category_name
    ) g
  ) sub;

  -- by_day
  SELECT COALESCE(jsonb_agg(row ORDER BY (row->>'date')), '[]'::jsonb)
  INTO v_by_day
  FROM (
    SELECT jsonb_build_object('date', d.day::TEXT, 'total', d.total) AS row
    FROM (
      SELECT po.order_date AS day, SUM(poi.subtotal) AS total
      FROM purchase_order_items poi
      JOIN purchase_orders po ON po.id = poi.po_id
      JOIN products p         ON p.id  = poi.product_id
      WHERE po.status NOT IN ('draft', 'cancelled')
        AND po.deleted_at IS NULL
        AND po.order_date BETWEEN v_start AND v_end
        AND (p_category_id IS NULL OR p.category_id = p_category_id)
      GROUP BY po.order_date
    ) d
  ) sub;

  RETURN jsonb_build_object(
    'period', jsonb_build_object('start', v_start, 'end', v_end),
    'summary', jsonb_build_object(
      'total',          v_total,
      'line_count',     v_line_count,
      'category_count', jsonb_array_length(v_by_category)
    ),
    'by_category', v_by_category,
    'by_day',      v_by_day
  );
END;
$$;

COMMENT ON FUNCTION public.get_purchase_cogs_breakdown_v1(TEXT, TEXT, UUID) IS
  'Cost analytics — material purchasing spend (poi.subtotal) ventilated by '
  'product category + by day (excl. draft/cancelled POs). Optional category '
  'filter. 366-day clamp. Gate reports.inventory.read.';

REVOKE ALL     ON FUNCTION public.get_purchase_cogs_breakdown_v1(TEXT, TEXT, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_purchase_cogs_breakdown_v1(TEXT, TEXT, UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_purchase_cogs_breakdown_v1(TEXT, TEXT, UUID) TO authenticated;

-- =============================================================================
-- 2. get_expenses_by_category_v1
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_expenses_by_category_v1(
  p_date_start  TEXT,
  p_date_end    TEXT,
  p_category_id UUID DEFAULT NULL,
  p_status      TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_start       DATE;
  v_end         DATE;
  v_total       NUMERIC;
  v_count       INT;
  v_by_category JSONB;
  v_by_day      JSONB;
BEGIN
  IF auth.uid() IS NULL OR NOT has_permission(auth.uid(), 'reports.financial.read') THEN
    RAISE EXCEPTION 'permission denied: reports.financial.read required'
      USING ERRCODE = '42501';
  END IF;

  v_start := p_date_start::DATE;
  v_end   := p_date_end::DATE;
  IF v_end < v_start THEN
    RAISE EXCEPTION 'invalid range: end before start' USING ERRCODE = 'P0001';
  END IF;
  IF v_end - v_start > 366 THEN
    v_start := v_end - 366;
  END IF;

  IF p_status IS NOT NULL
     AND p_status NOT IN ('draft','submitted','approved','rejected','paid') THEN
    RAISE EXCEPTION 'invalid status: %', p_status USING ERRCODE = 'P0001';
  END IF;

  -- Summary over the filtered set. NULL status => committed spend
  -- (everything except draft + rejected).
  SELECT COALESCE(SUM(e.amount), 0), COUNT(*)::INT
  INTO v_total, v_count
  FROM expenses e
  WHERE e.deleted_at IS NULL
    AND e.expense_date BETWEEN v_start AND v_end
    AND (p_category_id IS NULL OR e.category_id = p_category_id)
    AND (
      (p_status IS NOT NULL AND e.status = p_status)
      OR (p_status IS NULL AND e.status NOT IN ('draft','rejected'))
    );

  -- by_category
  SELECT COALESCE(jsonb_agg(row ORDER BY (row->>'total')::numeric DESC), '[]'::jsonb)
  INTO v_by_category
  FROM (
    SELECT jsonb_build_object(
      'category_id', ec.id,
      'code',        ec.code,
      'name',        ec.name,
      'total',       g.total,
      'count',       g.cnt,
      'share_pct',   CASE WHEN v_total > 0 THEN ROUND(g.total / v_total * 100, 2) ELSE 0 END
    ) AS row
    FROM (
      SELECT e.category_id, SUM(e.amount) AS total, COUNT(*) AS cnt
      FROM expenses e
      WHERE e.deleted_at IS NULL
        AND e.expense_date BETWEEN v_start AND v_end
        AND (p_category_id IS NULL OR e.category_id = p_category_id)
        AND (
          (p_status IS NOT NULL AND e.status = p_status)
          OR (p_status IS NULL AND e.status NOT IN ('draft','rejected'))
        )
      GROUP BY e.category_id
    ) g
    JOIN expense_categories ec ON ec.id = g.category_id
  ) sub;

  -- by_day
  SELECT COALESCE(jsonb_agg(row ORDER BY (row->>'date')), '[]'::jsonb)
  INTO v_by_day
  FROM (
    SELECT jsonb_build_object('date', d.day::TEXT, 'total', d.total) AS row
    FROM (
      SELECT e.expense_date AS day, SUM(e.amount) AS total
      FROM expenses e
      WHERE e.deleted_at IS NULL
        AND e.expense_date BETWEEN v_start AND v_end
        AND (p_category_id IS NULL OR e.category_id = p_category_id)
        AND (
          (p_status IS NOT NULL AND e.status = p_status)
          OR (p_status IS NULL AND e.status NOT IN ('draft','rejected'))
        )
      GROUP BY e.expense_date
    ) d
  ) sub;

  RETURN jsonb_build_object(
    'period', jsonb_build_object('start', v_start, 'end', v_end),
    'summary', jsonb_build_object(
      'total', v_total,
      'count', v_count,
      'avg',   CASE WHEN v_count > 0 THEN ROUND(v_total / v_count, 2) ELSE 0 END
    ),
    'by_category', v_by_category,
    'by_day',      v_by_day
  );
END;
$$;

COMMENT ON FUNCTION public.get_expenses_by_category_v1(TEXT, TEXT, UUID, TEXT) IS
  'Cost analytics — operational expense ledger ventilated by expense category '
  '+ by day. NULL p_status = committed spend (excl. draft/rejected). Optional '
  'category filter. 366-day clamp. Gate reports.financial.read.';

REVOKE ALL     ON FUNCTION public.get_expenses_by_category_v1(TEXT, TEXT, UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_expenses_by_category_v1(TEXT, TEXT, UUID, TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_expenses_by_category_v1(TEXT, TEXT, UUID, TEXT) TO authenticated;

COMMIT;
