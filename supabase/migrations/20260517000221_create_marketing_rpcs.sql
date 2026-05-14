-- 20260517000221_create_marketing_rpcs.sql
-- Session 13 / Phase 6.B — Marketing cascade : 3 SQL RPCs.
--
--   1. get_customer_cohort_v1(p_cohort_month DATE, p_lookback_months INT)
--      RETURNS TABLE(cohort_month DATE, months_since_signup INT,
--                    retained_customers INT, total_revenue NUMERIC,
--                    retention_pct NUMERIC)
--      For a given signup-month cohort, returns retention + revenue
--      buckets for months 0..lookback. Cohorts are derived from
--      `customers.created_at`. Retention = distinct customers in the
--      cohort with ≥1 paid order in month N+k. Revenue = sum(orders.total)
--      for those paid orders.
--
--   2. get_customer_segments_v1(p_segment_type TEXT)
--      RETURNS TABLE(segment TEXT, customer_count INT, total_spent NUMERIC,
--                    avg_orders NUMERIC)
--      Returns RFM-like buckets. p_segment_type='all' returns 6 rows :
--        - champions   : recency<=14d AND frequency>=5 AND monetary>=1M
--        - loyal       : recency<=30d AND frequency>=3
--        - at_risk     : recency BETWEEN 31 AND 60 AND lifetime_freq>=3
--        - new         : created_at within last 30d AND frequency>=1
--        - dormant     : recency BETWEEN 61 AND 180
--        - lost        : recency>180 OR (recency IS NULL AND created_at older than 60d)
--      p_segment_type='champions' (etc) returns just that row.
--
--   3. get_promo_roi_v1(p_promotion_id UUID, p_date_start DATE, p_date_end DATE)
--      RETURNS JSONB { promotion_id, code, name, redemptions,
--                      total_discount_given, incremental_revenue,
--                      incremental_orders, estimated_cost, roi_pct, period }
--      Aggregates `promotion_applications` ⋈ `orders` for the promo
--      over the period. `incremental_revenue` proxy = revenue minus
--      discount. ROI is a proxy — documented on the UI page.
--
-- Permission gate : all three callable by 'reports.read' holders.
-- SECURITY DEFINER to bypass RLS on `customers` / `orders` aggregates.
--
-- See deviation D-W6-6B-05 for the ROI-proxy rationale.

BEGIN;

-- ===========================================================================
-- 1. get_customer_cohort_v1
-- ===========================================================================

DROP FUNCTION IF EXISTS public.get_customer_cohort_v1(DATE, INT);

CREATE OR REPLACE FUNCTION public.get_customer_cohort_v1(
  p_cohort_month     DATE,
  p_lookback_months  INT DEFAULT 12
)
RETURNS TABLE (
  cohort_month         DATE,
  months_since_signup  INT,
  retained_customers   INT,
  total_revenue        NUMERIC,
  retention_pct        NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cohort_start DATE := date_trunc('month', p_cohort_month)::DATE;
  v_cohort_size  INT;
BEGIN
  IF NOT public.has_permission(auth.uid(), 'reports.read') THEN
    RAISE EXCEPTION 'permission_denied'
      USING ERRCODE = '42501', HINT = 'reports.read required';
  END IF;

  IF p_lookback_months IS NULL OR p_lookback_months < 0 OR p_lookback_months > 36 THEN
    RAISE EXCEPTION 'invalid_lookback' USING ERRCODE = '22023';
  END IF;

  -- Compute cohort size (customers who signed up in v_cohort_start month).
  SELECT COUNT(*)::INT INTO v_cohort_size
  FROM public.customers c
  WHERE c.deleted_at IS NULL
    AND date_trunc('month', c.created_at)::DATE = v_cohort_start;

  IF v_cohort_size = 0 THEN
    RETURN; -- empty set
  END IF;

  RETURN QUERY
  WITH cohort_members AS (
    SELECT c.id
    FROM public.customers c
    WHERE c.deleted_at IS NULL
      AND date_trunc('month', c.created_at)::DATE = v_cohort_start
  ),
  bucket_months AS (
    SELECT generate_series(0, p_lookback_months) AS m
  ),
  bucket_data AS (
    SELECT
      b.m AS months_since,
      (v_cohort_start + (b.m || ' months')::INTERVAL)::DATE AS bucket_start,
      (v_cohort_start + ((b.m + 1) || ' months')::INTERVAL)::DATE AS bucket_end
    FROM bucket_months b
  ),
  retained AS (
    SELECT
      bd.months_since,
      COUNT(DISTINCT o.customer_id)::INT AS retained_count,
      COALESCE(SUM(o.total), 0)::NUMERIC AS bucket_revenue
    FROM bucket_data bd
    LEFT JOIN public.orders o
      ON o.customer_id IN (SELECT id FROM cohort_members)
     AND o.status::TEXT IN ('completed', 'paid', 'refunded')
     AND o.created_at >= bd.bucket_start
     AND o.created_at <  bd.bucket_end
    GROUP BY bd.months_since
  )
  SELECT
    v_cohort_start                                              AS cohort_month,
    r.months_since                                              AS months_since_signup,
    r.retained_count                                            AS retained_customers,
    r.bucket_revenue                                            AS total_revenue,
    ROUND((r.retained_count::NUMERIC / v_cohort_size) * 100, 2) AS retention_pct
  FROM retained r
  ORDER BY r.months_since;
END;
$$;

REVOKE ALL ON FUNCTION public.get_customer_cohort_v1(DATE, INT) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_customer_cohort_v1(DATE, INT) TO authenticated;

COMMENT ON FUNCTION public.get_customer_cohort_v1(DATE, INT) IS
  'Session 13 / Phase 6.B — Returns retention + revenue buckets for the cohort that signed up in p_cohort_month, over the next p_lookback_months months. Cohorts derived from customers.created_at. Retention computed as distinct customers with at least one completed/paid/refunded order in the bucket.';

-- ===========================================================================
-- 2. get_customer_segments_v1
-- ===========================================================================

DROP FUNCTION IF EXISTS public.get_customer_segments_v1(TEXT);

CREATE OR REPLACE FUNCTION public.get_customer_segments_v1(
  p_segment_type TEXT DEFAULT 'all'
)
RETURNS TABLE (
  segment        TEXT,
  customer_count INT,
  total_spent    NUMERIC,
  avg_orders     NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_segments TEXT[] := ARRAY['champions','loyal','at_risk','new','dormant','lost'];
BEGIN
  IF NOT public.has_permission(auth.uid(), 'reports.read') THEN
    RAISE EXCEPTION 'permission_denied'
      USING ERRCODE = '42501', HINT = 'reports.read required';
  END IF;

  IF p_segment_type IS NULL THEN
    p_segment_type := 'all';
  END IF;
  IF p_segment_type NOT IN ('all','champions','loyal','at_risk','new','dormant','lost') THEN
    RAISE EXCEPTION 'invalid_segment_type' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH stats AS (
    SELECT
      c.id,
      c.total_spent,
      c.created_at,
      c.last_visit_at,
      c.total_visits,
      EXTRACT(EPOCH FROM (now() - COALESCE(c.last_visit_at, c.created_at))) / 86400.0 AS days_since_last,
      EXTRACT(EPOCH FROM (now() - c.created_at)) / 86400.0 AS days_since_signup,
      (
        SELECT COUNT(*)::INT
        FROM public.orders o
        WHERE o.customer_id = c.id
          AND o.status::TEXT IN ('completed','paid','refunded')
          AND o.created_at >= now() - INTERVAL '90 days'
      ) AS freq_90d
    FROM public.customers c
    WHERE c.deleted_at IS NULL
  ),
  classified AS (
    SELECT
      s.*,
      CASE
        WHEN s.days_since_last <= 14 AND s.freq_90d >= 5 AND s.total_spent >= 1000000
          THEN 'champions'
        WHEN s.days_since_last <= 30 AND s.freq_90d >= 3
          THEN 'loyal'
        WHEN s.days_since_signup <= 30 AND s.freq_90d >= 1
          THEN 'new'
        WHEN s.days_since_last BETWEEN 31 AND 60 AND s.total_visits >= 3
          THEN 'at_risk'
        WHEN s.days_since_last BETWEEN 61 AND 180
          THEN 'dormant'
        WHEN s.days_since_last > 180
            OR (s.last_visit_at IS NULL AND s.days_since_signup > 60)
          THEN 'lost'
        ELSE 'lost'
      END AS seg
    FROM stats s
  ),
  bucket_template AS (
    SELECT unnest(v_segments) AS seg
  )
  SELECT
    bt.seg                                                    AS segment,
    COUNT(cl.id)::INT                                         AS customer_count,
    COALESCE(SUM(cl.total_spent), 0)::NUMERIC                 AS total_spent,
    ROUND(COALESCE(AVG(cl.freq_90d), 0)::NUMERIC, 2)          AS avg_orders
  FROM bucket_template bt
  LEFT JOIN classified cl ON cl.seg = bt.seg
  WHERE p_segment_type = 'all' OR bt.seg = p_segment_type
  GROUP BY bt.seg
  ORDER BY
    CASE bt.seg
      WHEN 'champions' THEN 1 WHEN 'loyal'    THEN 2 WHEN 'new'    THEN 3
      WHEN 'at_risk'   THEN 4 WHEN 'dormant'  THEN 5 WHEN 'lost'   THEN 6
      ELSE 99 END;
END;
$$;

REVOKE ALL ON FUNCTION public.get_customer_segments_v1(TEXT) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_customer_segments_v1(TEXT) TO authenticated;

COMMENT ON FUNCTION public.get_customer_segments_v1(TEXT) IS
  'Session 13 / Phase 6.B — Returns RFM-like segment buckets (champions/loyal/at_risk/new/dormant/lost). Recency from customers.last_visit_at, frequency from 90-day order count, monetary from customers.total_spent.';

-- ===========================================================================
-- 3. get_promo_roi_v1
-- ===========================================================================

DROP FUNCTION IF EXISTS public.get_promo_roi_v1(UUID, DATE, DATE);

CREATE OR REPLACE FUNCTION public.get_promo_roi_v1(
  p_promotion_id UUID,
  p_date_start   DATE,
  p_date_end     DATE
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_promo          RECORD;
  v_redemptions    INT     := 0;
  v_orders         INT     := 0;
  v_discount       NUMERIC := 0;
  v_revenue        NUMERIC := 0;
  v_increment      NUMERIC := 0;
  v_roi_pct        NUMERIC := 0;
BEGIN
  IF NOT public.has_permission(auth.uid(), 'reports.read') THEN
    RAISE EXCEPTION 'permission_denied'
      USING ERRCODE = '42501', HINT = 'reports.read required';
  END IF;

  IF p_promotion_id IS NULL OR p_date_start IS NULL OR p_date_end IS NULL THEN
    RAISE EXCEPTION 'invalid_args' USING ERRCODE = '22023';
  END IF;
  IF p_date_end < p_date_start THEN
    RAISE EXCEPTION 'invalid_date_range' USING ERRCODE = '22023';
  END IF;

  SELECT id, slug, name INTO v_promo
  FROM public.promotions
  WHERE id = p_promotion_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'promotion_not_found' USING ERRCODE = 'P0002';
  END IF;

  WITH appls AS (
    SELECT pa.id, pa.amount, pa.order_id
    FROM public.promotion_applications pa
    JOIN public.orders o ON o.id = pa.order_id
    WHERE pa.promotion_id = p_promotion_id
      AND o.status::TEXT IN ('completed','paid','refunded')
      AND o.created_at >= p_date_start::TIMESTAMPTZ
      AND o.created_at <  (p_date_end::TIMESTAMPTZ + INTERVAL '1 day')
  )
  SELECT
    COUNT(*)::INT,
    COUNT(DISTINCT order_id)::INT,
    COALESCE(SUM(amount), 0)::NUMERIC
  INTO v_redemptions, v_orders, v_discount
  FROM appls;

  SELECT COALESCE(SUM(o.total), 0)::NUMERIC INTO v_revenue
  FROM public.orders o
  WHERE o.id IN (
    SELECT DISTINCT order_id FROM public.promotion_applications
    WHERE promotion_id = p_promotion_id
  )
  AND o.status::TEXT IN ('completed','paid','refunded')
  AND o.created_at >= p_date_start::TIMESTAMPTZ
  AND o.created_at <  (p_date_end::TIMESTAMPTZ + INTERVAL '1 day');

  -- Proxy : revenue net of the discount given.
  v_increment := v_revenue - v_discount;
  v_roi_pct := CASE
    WHEN v_discount > 0
      THEN ROUND(((v_increment - v_discount) / v_discount) * 100, 2)
    ELSE 0
  END;

  RETURN jsonb_build_object(
    'promotion_id',         v_promo.id,
    'code',                 v_promo.slug,
    'name',                 v_promo.name,
    'redemptions',          v_redemptions,
    'incremental_orders',   v_orders,
    'total_discount_given', v_discount,
    'total_revenue',        v_revenue,
    'incremental_revenue',  v_increment,
    'estimated_cost',       v_discount,
    'roi_pct',              v_roi_pct,
    'period', jsonb_build_object(
      'start', p_date_start::TEXT,
      'end',   p_date_end::TEXT
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_promo_roi_v1(UUID, DATE, DATE) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_promo_roi_v1(UUID, DATE, DATE) TO authenticated;

COMMENT ON FUNCTION public.get_promo_roi_v1(UUID, DATE, DATE) IS
  'Session 13 / Phase 6.B — Promo ROI summary for one promotion over a date range. Computes redemptions, total discount given, total revenue on promo-flagged orders, an incremental_revenue proxy (revenue - discount), and an ROI proxy. See D-W6-6B-05 for incrementality caveats.';

COMMIT;
