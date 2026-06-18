-- 20260703000010_create_get_stock_movement_ledger_v1_rpc.sql
-- 2026-06-18 — Stock-card ledger RPC powering both Backoffice stock-movement pages
-- (Reports ▸ Stock Movement History + Inventory ▸ Stock Movements).
--
-- Returns the full filtered date range (no cursor) with a per-product running
-- balance seeded by the true opening balance at p_start, so the page can render the
-- stock-card layout: beginning/incoming/outgoing/balance + price + movement_amount,
-- grouped by product. The ref_no code + type label are synthesized client-side
-- (packages/domain stockLedgerRef) — this RPC returns the raw fields they need.
--
-- price = current products.cost_price (WAC) — constant per product, matching the
-- owner's reference screenshot. movement_amount = signed quantity × price.
-- product_group = categories.name.
--
-- Volume guard: hard LIMIT (default 5000, capped 10000) with a `truncated` flag.
-- The legacy get_stock_movements_v1/v2 RPCs are left untouched (other consumers).

CREATE OR REPLACE FUNCTION get_stock_movement_ledger_v1(
  p_start         TEXT,
  p_end           TEXT,
  p_product_id    UUID DEFAULT NULL,
  p_movement_type TEXT DEFAULT NULL,
  p_section_id    UUID DEFAULT NULL,
  p_limit         INT  DEFAULT 5000
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id UUID        := auth.uid();
  v_start     TIMESTAMPTZ := (p_start || 'T00:00:00Z')::timestamptz;
  v_end       TIMESTAMPTZ := (p_end   || 'T23:59:59Z')::timestamptz;
  v_limit     INT         := LEAST(GREATEST(p_limit, 1), 10000);
  v_lines     JSONB;
  v_count     INT;
  v_total     INT;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  -- Serves the live inventory page (inventory.read) AND the report page
  -- (reports.inventory.read); accept either so both audiences pass.
  IF NOT (has_permission(v_caller_id, 'inventory.read')
          OR has_permission(v_caller_id, 'reports.inventory.read')) THEN
    RAISE EXCEPTION 'Permission denied: inventory.read' USING ERRCODE = '42501';
  END IF;

  WITH opening AS (
    -- True stock-on-hand per product at p_start, under the same filter predicate
    -- so beginning/balance reconcile row-to-row within the displayed set.
    SELECT sm.product_id, SUM(sm.quantity) AS opening_qty
    FROM stock_movements sm
    WHERE sm.created_at < v_start
      AND (p_product_id    IS NULL OR sm.product_id          = p_product_id)
      AND (p_movement_type IS NULL OR sm.movement_type::text = p_movement_type)
      AND (p_section_id    IS NULL OR sm.from_section_id = p_section_id OR sm.to_section_id = p_section_id)
    GROUP BY sm.product_id
  ),
  in_range AS (
    SELECT
      sm.id,
      sm.product_id,
      p.name                    AS product_name,
      c.name                    AS product_group,
      sm.movement_type::text    AS movement_type,
      sm.quantity,
      sm.unit,
      COALESCE(p.cost_price, 0) AS price,
      sm.reference_type,
      sm.reference_id,
      sm.created_at,
      sm.created_by,
      COALESCE(o.opening_qty, 0)
        + SUM(sm.quantity) OVER (
            PARTITION BY sm.product_id
            ORDER BY sm.created_at, sm.id
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
          ) AS balance_qty
    FROM stock_movements sm
    JOIN products p ON p.id = sm.product_id
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN opening o ON o.product_id = sm.product_id
    WHERE sm.created_at BETWEEN v_start AND v_end
      AND (p_product_id    IS NULL OR sm.product_id          = p_product_id)
      AND (p_movement_type IS NULL OR sm.movement_type::text = p_movement_type)
      AND (p_section_id    IS NULL OR sm.from_section_id = p_section_id OR sm.to_section_id = p_section_id)
    ORDER BY p.name, sm.created_at, sm.id
    LIMIT v_limit + 1
  ),
  numbered AS (
    SELECT ir.*, ROW_NUMBER() OVER (ORDER BY ir.product_name, ir.created_at, ir.id) AS rn
    FROM in_range ir
  )
  SELECT
    COALESCE(
      jsonb_agg(jsonb_build_object(
        'id',              n.id,
        'movement_date',   n.created_at::date,
        'created_time',    n.created_at,
        'movement_type',   n.movement_type,
        'product_id',      n.product_id,
        'product_name',    n.product_name,
        'product_group',   n.product_group,
        'unit',            n.unit,
        'incoming_qty',    GREATEST(n.quantity, 0),
        'outgoing_qty',    GREATEST(-n.quantity, 0),
        'beginning_qty',   n.balance_qty - n.quantity,
        'balance_qty',     n.balance_qty,
        'price',           n.price,
        'movement_amount', n.quantity * n.price,
        'reference_type',  n.reference_type,
        'reference_id',    n.reference_id,
        'created_by_name', up.full_name
      ) ORDER BY n.product_name, n.created_at, n.id)
      FILTER (WHERE n.rn <= v_limit),
      '[]'::jsonb
    ),
    COUNT(*) FILTER (WHERE n.rn <= v_limit)::int,
    COUNT(*)::int
  INTO v_lines, v_count, v_total
  FROM numbered n
  LEFT JOIN user_profiles up ON up.id = n.created_by;

  RETURN jsonb_build_object(
    'lines',     v_lines,
    'truncated', v_total > v_limit,
    'row_count', v_count
  );
END;
$$;

-- REVOKE pair (S25 canonique). authenticated/service_role keep their direct grant.
REVOKE EXECUTE ON FUNCTION get_stock_movement_ledger_v1(TEXT, TEXT, UUID, TEXT, UUID, INT) FROM PUBLIC, anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

COMMENT ON FUNCTION get_stock_movement_ledger_v1(TEXT, TEXT, UUID, TEXT, UUID, INT) IS
  'Stock-card ledger for both BO stock-movement pages: full filtered range, per-product running balance (opening-seeded), price=current cost_price, movement_amount=qty*price, product_group=category. JSONB {lines, truncated, row_count}. Gate inventory.read OR reports.inventory.read.';
