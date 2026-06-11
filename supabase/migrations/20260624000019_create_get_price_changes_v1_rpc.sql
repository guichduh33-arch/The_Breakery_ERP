-- 20260624000019_create_get_price_changes_v1_rpc.sql
-- S40 — retail price change history from audit_logs (product.update payload).
-- Payload format verified on cloud: flat patch object (e.g. {"retail_price": 25000})
-- → payload->>'retail_price' is correct, no nesting.
-- History only reaches back to the update_product_v1 era (S27). Variant edits
-- via update_variant_v1 do not emit product.update — documented limitation.

CREATE OR REPLACE FUNCTION public.get_price_changes_v1(
  p_date_start TEXT,
  p_date_end   TEXT,
  p_product_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_start DATE; v_end DATE; v_tz TEXT;
  v_changes JSONB; v_count INT;
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
  SELECT COALESCE(MAX(timezone), 'Asia/Makassar') INTO v_tz
    FROM business_config WHERE id = 1;

  WITH price_events AS (
    -- ALL product.update events carrying retail_price, regardless of range:
    -- LAG needs the full per-product history so old_price is correct at the
    -- range boundary.
    SELECT al.entity_id                                   AS product_id,
           al.created_at,
           al.actor_id,
           (al.payload->>'retail_price')::NUMERIC(12,2)   AS new_price,
           LAG((al.payload->>'retail_price')::NUMERIC(12,2))
             OVER (PARTITION BY al.entity_id ORDER BY al.created_at, al.id) AS old_price
      FROM audit_logs al
     WHERE al.action = 'product.update'
       AND al.entity_type = 'product'
       AND al.payload ? 'retail_price'
       AND (p_product_id IS NULL OR al.entity_id = p_product_id)
  ),
  in_range AS (
    SELECT pe.*,
           ((pe.created_at AT TIME ZONE v_tz))::date AS day
      FROM price_events pe
     WHERE ((pe.created_at AT TIME ZONE v_tz))::date BETWEEN v_start AND v_end
     ORDER BY pe.created_at DESC
     LIMIT 501
  )
  SELECT COALESCE(jsonb_agg(
           jsonb_build_object(
             'changed_at',   ir.created_at,
             'actor_name',   COALESCE(up.full_name, 'system'),
             'product_id',   ir.product_id,
             'product_name', COALESCE(p.name, '(deleted product)'),
             'new_price',    ir.new_price,
             'old_price',    ir.old_price,
             'delta_pct',    CASE WHEN ir.old_price IS NULL OR ir.old_price = 0 THEN NULL
                                  ELSE ROUND((ir.new_price - ir.old_price) / ir.old_price * 100, 2) END
           ) ORDER BY ir.created_at DESC
         ), '[]'::jsonb),
         COUNT(*)
    INTO v_changes, v_count
    FROM in_range ir
    LEFT JOIN user_profiles up ON up.id = ir.actor_id
    LEFT JOIN products p       ON p.id  = ir.product_id;

  IF v_count > 500 THEN
    v_changes := (SELECT jsonb_agg(e) FROM (
      SELECT e FROM jsonb_array_elements(v_changes) e LIMIT 500
    ) t);
  END IF;

  RETURN jsonb_build_object(
    'period',    jsonb_build_object('start', v_start, 'end', v_end),
    'changes',   v_changes,
    'truncated', v_count > 500
  );
END;
$$;

COMMENT ON FUNCTION public.get_price_changes_v1(TEXT, TEXT, UUID) IS
  'S40 — retail_price change log from audit_logs product.update payloads, '
  'old_price via LAG over full per-product history. Gate reports.financial.read.';

REVOKE ALL ON FUNCTION public.get_price_changes_v1(TEXT, TEXT, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_price_changes_v1(TEXT, TEXT, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_price_changes_v1(TEXT, TEXT, UUID) TO authenticated;
