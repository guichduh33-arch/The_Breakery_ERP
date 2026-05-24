-- 20260615000018_create_get_perishable_turnover_v1_rpc.sql
-- S30 Wave 1.A.3 — Perishable Turnover report.
-- DEV-S30-1.A-02: stock_lots.consumed_at does not exist — uses updated_at as consumed-date proxy
--                 for lots where status='consumed'. avg_days_in_stock = AVG((updated_at - received_at)/86400).
-- DEV-S30-1.A-01: stock_lots.expired_at does not exist — uses expires_at for spoilage date.
-- DEV-S30-1.A-03: stock_lots.status is text (no enum).
CREATE OR REPLACE FUNCTION get_perishable_turnover_v1(p_date_start TEXT, p_date_end TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id  UUID := auth.uid();
  v_start      TIMESTAMPTZ := (p_date_start || 'T00:00:00Z')::timestamptz;
  v_end        TIMESTAMPTZ := (p_date_end   || 'T23:59:59Z')::timestamptz;
  v_by_product JSONB;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF NOT has_permission(v_caller_id, 'reports.inventory.read') THEN
    RAISE EXCEPTION 'Permission denied: reports.inventory.read' USING ERRCODE = '42501';
  END IF;

  WITH perishable AS (
    -- Products that have at least one lot with an expiry date
    SELECT DISTINCT product_id FROM stock_lots WHERE expires_at IS NOT NULL
  ),
  consumed AS (
    -- DEV-S30-1.A-02: no consumed_at col — use updated_at as proxy for when lot was consumed
    SELECT
      product_id,
      SUM(quantity) AS consumed_qty,
      AVG(EXTRACT(EPOCH FROM (updated_at - received_at)) / 86400.0) AS avg_days
    FROM stock_lots
    WHERE status = 'consumed'
      AND updated_at BETWEEN v_start AND v_end
    GROUP BY product_id
  ),
  expired AS (
    -- DEV-S30-1.A-01: no expired_at col — use expires_at as spoilage date
    SELECT
      product_id,
      SUM(quantity) AS expired_qty
    FROM stock_lots
    WHERE status = 'expired'
      AND expires_at BETWEEN v_start AND v_end
    GROUP BY product_id
  ),
  active AS (
    SELECT product_id, SUM(quantity) AS active_qty
    FROM stock_lots
    WHERE status = 'active'
    GROUP BY product_id
  ),
  shelf AS (
    SELECT
      product_id,
      percentile_disc(0.5) WITHIN GROUP (
        ORDER BY EXTRACT(EPOCH FROM (expires_at - received_at)) / 86400.0
      ) AS shelf_p50,
      COUNT(*) AS lots_count
    FROM stock_lots
    WHERE expires_at IS NOT NULL
    GROUP BY product_id
  )
  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY (row_to_json(t)->>'consumed_qty')::numeric DESC NULLS LAST), '[]'::jsonb)
  INTO v_by_product
  FROM (
    SELECT
      pp.product_id,
      p.name                                                         AS product_name,
      COALESCE(s.lots_count, 0)                                      AS lots_count,
      COALESCE(c.consumed_qty, 0)                                    AS consumed_qty,
      COALESCE(e.expired_qty, 0)                                     AS expired_qty,
      COALESCE(a.active_qty, 0)                                      AS current_active_qty,
      CASE
        WHEN COALESCE(c.consumed_qty, 0) + COALESCE(e.expired_qty, 0) = 0 THEN 0
        ELSE ROUND(
          (COALESCE(e.expired_qty, 0)::numeric
            / (COALESCE(c.consumed_qty, 0) + COALESCE(e.expired_qty, 0))
          ) * 100, 2)
      END                                                            AS waste_pct,
      ROUND(c.avg_days::numeric, 2)                                  AS avg_days_in_stock,
      ROUND(s.shelf_p50::numeric, 0)                                 AS shelf_life_days_p50,
      CASE
        WHEN c.avg_days IS NULL THEN 1
        WHEN c.avg_days <  2   THEN 5
        WHEN c.avg_days <  4   THEN 4
        WHEN c.avg_days <  8   THEN 3
        WHEN c.avg_days < 14   THEN 2
        ELSE 1
      END                                                            AS velocity_score
    FROM perishable pp
    JOIN products p        ON p.id = pp.product_id
    LEFT JOIN consumed c   ON c.product_id = pp.product_id
    LEFT JOIN expired  e   ON e.product_id = pp.product_id
    LEFT JOIN active   a   ON a.product_id = pp.product_id
    LEFT JOIN shelf    s   ON s.product_id = pp.product_id
  ) t;

  RETURN jsonb_build_object(
    'period',     jsonb_build_object('start', p_date_start, 'end', p_date_end),
    'by_product', v_by_product
  );
END;
$$;

COMMENT ON FUNCTION get_perishable_turnover_v1(TEXT, TEXT) IS
  'S30 : Perishable Turnover — per-product velocity bucket 1-5 from avg_days_in_stock (updated_at proxy for consumed_at).';
