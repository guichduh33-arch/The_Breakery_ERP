-- 20260710000132_get_b2b_invoice_v1.sql
-- S68 — Lecture pure pour le template PDF b2b_invoice. Gate b2b.read.
-- Renvoie invoice / customer / lines / payment. AUCUNE taxe (tax_amount=0, B2B NON-PKP).
-- Paiement dérivé de la vue canonique view_b2b_invoices (voided → absent → 0).

CREATE OR REPLACE FUNCTION public.get_b2b_invoice_v1(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid   UUID := auth.uid();
  v_o     RECORD;
  v_cust  RECORD;
  v_terms INTEGER;
  v_paid  NUMERIC(14,2);
  v_lines JSONB;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;
  IF NOT has_permission(v_uid, 'b2b.read') THEN
    RAISE EXCEPTION 'permission_denied: b2b.read' USING ERRCODE = 'P0003';
  END IF;

  SELECT id, order_number, invoice_number, created_at, status,
         subtotal, tax_amount, total, notes, customer_id, order_type
    INTO v_o
    FROM orders WHERE id = p_order_id;
  IF v_o.id IS NULL OR v_o.order_type <> 'b2b' THEN
    RAISE EXCEPTION 'invoice_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT name, b2b_company_name, b2b_tax_id, phone, email,
         COALESCE(b2b_payment_terms_days, 0) AS terms
    INTO v_cust
    FROM customers WHERE id = v_o.customer_id;
  v_terms := COALESCE(v_cust.terms, 0);

  -- Paiement : dérivé de la vue canonique (voided absent → 0).
  SELECT COALESCE(amount_paid, 0) INTO v_paid
    FROM view_b2b_invoices WHERE invoice_id = p_order_id;
  v_paid := COALESCE(v_paid, 0);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'name',       oi.name_snapshot,
           'quantity',   oi.quantity,
           'unit_price', oi.unit_price,
           'line_total', oi.line_total
         ) ORDER BY oi.id), '[]'::jsonb)
    INTO v_lines
    FROM order_items oi WHERE oi.order_id = p_order_id;

  RETURN jsonb_build_object(
    'invoice', jsonb_build_object(
      'invoice_number', v_o.invoice_number,
      'order_number',   v_o.order_number,
      'invoice_date',   v_o.created_at::date,
      'due_date',       (v_o.created_at::date + (v_terms || ' days')::interval)::date,
      'status',         v_o.status,
      'subtotal',       v_o.subtotal,
      'tax_amount',     v_o.tax_amount,
      'total',          v_o.total,
      'notes',          v_o.notes
    ),
    'customer', jsonb_build_object(
      'company_name',       v_cust.b2b_company_name,
      'tax_id',             v_cust.b2b_tax_id,
      'name',               v_cust.name,
      'phone',              v_cust.phone,
      'email',              v_cust.email,
      'payment_terms_days', v_terms
    ),
    'lines',   v_lines,
    'payment', jsonb_build_object(
      'amount_paid', v_paid,
      'outstanding', GREATEST(v_o.total - v_paid, 0)
    )
  );
END $function$;

REVOKE ALL ON FUNCTION public.get_b2b_invoice_v1(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_b2b_invoice_v1(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_b2b_invoice_v1(uuid) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
