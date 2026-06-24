-- 20260708000010_create_purchases_import_flag_and_rpc.sql
-- Phase 2a historical purchases bulk import. Direct insert of received POs + items,
-- grouped by po_reference. NO GRN, NO stock_movement, NO JE (reports-only).
-- Gate purchasing.po.create. Idempotency S25 flavor 2. Anon defense-in-depth S20.

ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS is_historical_import BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS import_reference TEXT;

COMMENT ON COLUMN purchase_orders.is_historical_import IS
  'TRUE = inserted via import_purchases_v1 (reports-only, no GRN/stock/JE). Blocks live receive/pay.';
COMMENT ON COLUMN purchase_orders.import_reference IS
  'User-supplied po_reference grouping key from the import file (traceability).';

CREATE INDEX IF NOT EXISTS idx_po_historical_import
  ON purchase_orders (is_historical_import) WHERE is_historical_import;

CREATE OR REPLACE FUNCTION public.import_purchases_v1(
  p_payload         JSONB,
  p_dry_run         BOOLEAN DEFAULT TRUE,
  p_idempotency_key UUID    DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller    UUID := auth.uid();
  v_existing  JSONB;
  v_errors    JSONB;
  v_summary   JSONB;
  v_report    JSONB;
  v_err_count INT;
  g           RECORD;
  v_po_id     UUID;
  v_po_number TEXT;
  v_supplier  UUID;
  v_subtotal  NUMERIC;
  v_terms     TEXT;
  v_date      DATE;
  v_notes     TEXT;
BEGIN
  IF v_caller IS NULL OR NOT has_permission(v_caller, 'purchasing.po.create') THEN
    RAISE EXCEPTION 'permission denied: purchasing.po.create required' USING ERRCODE = '42501';
  END IF;

  IF NOT p_dry_run THEN
    IF p_idempotency_key IS NULL THEN
      RAISE EXCEPTION 'idempotency_key_required' USING ERRCODE = 'P0001';
    END IF;
    SELECT report INTO v_existing
      FROM import_master_data_idempotency_keys WHERE key = p_idempotency_key;
    IF FOUND THEN
      RETURN v_existing || jsonb_build_object('idempotent_replay', true);
    END IF;
  END IF;

  DROP TABLE IF EXISTS t_line, t_err;

  CREATE TEMP TABLE t_line ON COMMIT DROP AS
  SELECT ord::INT                                       AS row_num,
         NULLIF(trim(elt->>'po_reference'), '')         AS po_reference,
         NULLIF(trim(elt->>'supplier_code'), '')        AS supplier_code,
         NULLIF(trim(elt->>'order_date'), '')           AS order_date,
         COALESCE(NULLIF(trim(elt->>'payment_terms'),''),'credit') AS payment_terms,
         NULLIF(elt->>'notes', '')                      AS notes,
         NULLIF(trim(elt->>'product_sku'), '')          AS product_sku,
         (elt->>'quantity')::NUMERIC                    AS quantity,
         (elt->>'unit_cost')::NUMERIC                   AS unit_cost,
         NULLIF(trim(elt->>'unit'), '')                 AS unit
    FROM jsonb_array_elements(COALESCE(p_payload, '[]'::jsonb)) WITH ORDINALITY AS t(elt, ord);

  CREATE TEMP TABLE t_err (sheet TEXT, row_num INT, sku TEXT, code TEXT, message TEXT) ON COMMIT DROP;

  -- per-line validation
  INSERT INTO t_err SELECT 'Purchases', row_num, product_sku, 'missing_required',
         'po_reference, supplier_code, order_date, product_sku, quantity, unit_cost, unit are required'
    FROM t_line WHERE po_reference IS NULL OR supplier_code IS NULL OR order_date IS NULL
       OR product_sku IS NULL OR quantity IS NULL OR unit_cost IS NULL OR unit IS NULL;
  INSERT INTO t_err SELECT 'Purchases', row_num, product_sku, 'invalid_amount',
         'quantity and unit_cost must be greater than 0'
    FROM t_line WHERE (quantity IS NOT NULL AND quantity <= 0) OR (unit_cost IS NOT NULL AND unit_cost <= 0);
  INSERT INTO t_err SELECT 'Purchases', row_num, product_sku, 'invalid_date',
         format('order_date "%s" must be YYYY-MM-DD', order_date)
    FROM t_line WHERE order_date IS NOT NULL AND order_date !~ '^\d{4}-\d{2}-\d{2}$';
  INSERT INTO t_err SELECT 'Purchases', row_num, product_sku, 'invalid_payment_terms',
         format('payment_terms "%s" must be cash or credit', payment_terms)
    FROM t_line WHERE payment_terms NOT IN ('cash', 'credit');
  INSERT INTO t_err SELECT 'Purchases', row_num, product_sku, 'invalid_unit',
         'unit must be 1..16 characters'
    FROM t_line WHERE unit IS NOT NULL AND char_length(unit) NOT BETWEEN 1 AND 16;
  INSERT INTO t_err SELECT 'Purchases', l.row_num, l.supplier_code, 'unknown_supplier',
         format('supplier_code "%s" not found', l.supplier_code)
    FROM t_line l WHERE l.supplier_code IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM suppliers s WHERE s.code = l.supplier_code AND s.deleted_at IS NULL);
  INSERT INTO t_err SELECT 'Purchases', l.row_num, l.product_sku, 'unknown_product',
         format('product_sku "%s" not found', l.product_sku)
    FROM t_line l WHERE l.product_sku IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM products p WHERE p.sku = l.product_sku AND p.deleted_at IS NULL);
  -- header consistency per po_reference group
  INSERT INTO t_err SELECT 'Purchases', MIN(row_num), po_reference, 'inconsistent_header',
         format('po_reference "%s" has inconsistent supplier_code/order_date/payment_terms across its rows', po_reference)
    FROM t_line WHERE po_reference IS NOT NULL
    GROUP BY po_reference
    HAVING COUNT(DISTINCT supplier_code) > 1 OR COUNT(DISTINCT order_date) > 1
        OR COUNT(DISTINCT payment_terms) > 1;

  SELECT jsonb_build_object('Purchases', jsonb_build_object(
    'purchase_orders_created', (SELECT COUNT(DISTINCT po_reference) FROM t_line WHERE po_reference IS NOT NULL),
    'line_items_created',      (SELECT COUNT(*) FROM t_line WHERE po_reference IS NOT NULL)
  )) INTO v_summary;

  SELECT COUNT(*), COALESCE(jsonb_agg(jsonb_build_object(
           'sheet', sheet, 'row', row_num, 'sku', sku, 'code', code, 'message', message) ORDER BY row_num),
         '[]'::jsonb)
    INTO v_err_count, v_errors FROM t_err;

  v_report := jsonb_build_object('valid', v_err_count = 0, 'errors', v_errors,
                                 'summary', v_summary, 'idempotent_replay', false);

  IF p_dry_run OR v_err_count > 0 THEN
    RETURN v_report;
  END IF;

  -- writes: one PO per po_reference group; status='received', no GRN/stock/JE
  FOR g IN SELECT po_reference, MIN(row_num) AS first_row
             FROM t_line GROUP BY po_reference ORDER BY MIN(row_num) LOOP
    SELECT s.id INTO v_supplier
      FROM t_line l JOIN suppliers s ON s.code = l.supplier_code AND s.deleted_at IS NULL
     WHERE l.po_reference = g.po_reference LIMIT 1;
    SELECT (SELECT payment_terms FROM t_line WHERE po_reference = g.po_reference LIMIT 1),
           (SELECT order_date::DATE FROM t_line WHERE po_reference = g.po_reference LIMIT 1),
           (SELECT notes FROM t_line WHERE po_reference = g.po_reference AND notes IS NOT NULL LIMIT 1),
           (SELECT SUM(quantity * unit_cost) FROM t_line WHERE po_reference = g.po_reference)
      INTO v_terms, v_date, v_notes, v_subtotal;

    v_po_number := 'PO-' || to_char(v_date, 'YYYYMMDD') || '-'
                || lpad(nextval('purchase_orders_seq')::TEXT, 4, '0');

    INSERT INTO purchase_orders (
      po_number, supplier_id, status, payment_terms, subtotal, vat_amount, total_amount,
      order_date, received_date, notes, is_historical_import, import_reference,
      created_by, received_by
    ) VALUES (
      v_po_number, v_supplier, 'received', v_terms, v_subtotal, 0, v_subtotal,
      v_date, v_date, v_notes, TRUE, g.po_reference, v_caller, v_caller
    ) RETURNING id INTO v_po_id;

    -- purchase_order_items.subtotal is a GENERATED column — do not insert it.
    INSERT INTO purchase_order_items (
      po_id, product_id, quantity, received_quantity, unit, unit_cost, unit_factor_to_base
    )
    SELECT v_po_id, p.id, l.quantity, l.quantity, l.unit, l.unit_cost, 1
      FROM t_line l JOIN products p ON p.sku = l.product_sku AND p.deleted_at IS NULL
     WHERE l.po_reference = g.po_reference;
  END LOOP;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_caller, 'purchases.imported', 'purchase_order', NULL, v_summary);

  BEGIN
    INSERT INTO import_master_data_idempotency_keys (key, entity, report, created_by)
    VALUES (p_idempotency_key, 'purchases', v_report, v_caller);
  EXCEPTION WHEN unique_violation THEN
    SELECT report INTO v_existing FROM import_master_data_idempotency_keys WHERE key = p_idempotency_key;
    RETURN v_existing || jsonb_build_object('idempotent_replay', true);
  END;

  RETURN v_report;
END;
$$;

COMMENT ON FUNCTION public.import_purchases_v1(JSONB, BOOLEAN, UUID) IS
  'Phase 2a bulk import — historical purchases grouped by po_reference, inserted as received POs (reports-only, no GRN/stock/JE). Gate purchasing.po.create.';

REVOKE ALL ON FUNCTION public.import_purchases_v1(JSONB, BOOLEAN, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.import_purchases_v1(JSONB, BOOLEAN, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.import_purchases_v1(JSONB, BOOLEAN, UUID) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
