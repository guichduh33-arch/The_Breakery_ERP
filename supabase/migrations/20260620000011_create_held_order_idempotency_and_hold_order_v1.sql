-- Session 35 — F-003 Held orders (Wave C2): idempotency table + hold_order_v1.
-- Dedicated idempotency table (S25 pattern): one hold per client_uuid.
CREATE TABLE IF NOT EXISTS public.held_order_idempotency_keys (
  client_uuid UUID PRIMARY KEY,
  order_id    UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.held_order_idempotency_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.held_order_idempotency_keys FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.held_order_idempotency_keys FROM authenticated;
GRANT SELECT ON TABLE public.held_order_idempotency_keys TO authenticated;
CREATE POLICY held_order_idem_select_auth ON public.held_order_idempotency_keys
  FOR SELECT TO authenticated USING (true);

-- hold_order_v1: snapshot the live cart as a draft + is_held order.
-- Mirrors create_tablet_order_v2's order_items insert (round_idr, name/station from products).
-- Gate: pos.sale.create (CASHIER+). Idempotent on p_client_uuid.
CREATE OR REPLACE FUNCTION public.hold_order_v1(
  p_client_uuid  UUID,
  p_cart_payload JSONB,
  p_table_number TEXT DEFAULT NULL,
  p_notes        TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_uid              UUID := auth.uid();
  v_existing         UUID;
  v_order_id         UUID;
  v_order_number     TEXT;
  v_item             JSONB;
  v_product_id       UUID;
  v_quantity         DECIMAL(10,3);
  v_unit_price       DECIMAL(12,2);
  v_modifiers        JSONB;
  v_mod_per_unit     DECIMAL(12,2);
  v_mod_total        DECIMAL(12,2);
  v_line_total       DECIMAL(12,2);
  v_dispatch_station TEXT;
  v_subtotal         DECIMAL(12,2) := 0;
  v_order_type       order_type;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001';
  END IF;
  IF p_client_uuid IS NULL THEN
    RAISE EXCEPTION 'client_uuid required' USING ERRCODE = 'check_violation';
  END IF;

  SELECT order_id INTO v_existing FROM held_order_idempotency_keys WHERE client_uuid = p_client_uuid;
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;

  IF NOT has_permission(v_uid, 'pos.sale.create') THEN
    RAISE EXCEPTION 'Permission denied: pos.sale.create' USING ERRCODE = 'P0003';
  END IF;
  IF p_cart_payload IS NULL OR jsonb_array_length(COALESCE(p_cart_payload->'items', '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'Held order must contain at least one item' USING ERRCODE = 'check_violation';
  END IF;

  v_order_type   := COALESCE(p_cart_payload->>'order_type', 'dine_in')::order_type;
  v_order_number := 'HELD-' || replace(p_client_uuid::text, '-', '');

  INSERT INTO orders (
    order_number, order_type, status, created_via, is_held,
    table_number, customer_id, notes, subtotal, tax_amount, total
  ) VALUES (
    v_order_number, v_order_type, 'draft', 'pos', true,
    p_table_number, NULLIF(p_cart_payload->>'customerId','')::UUID, p_notes, 0, 0, 0
  ) RETURNING id INTO v_order_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_cart_payload->'items') LOOP
    v_product_id := (v_item->>'product_id')::UUID;
    v_quantity   := (v_item->>'quantity')::DECIMAL;
    v_unit_price := (v_item->>'unit_price')::DECIMAL;
    v_modifiers  := COALESCE(v_item->'modifiers', '[]'::jsonb);

    SELECT COALESCE(SUM((m->>'price_adjustment')::DECIMAL(12,2)), 0)
      INTO v_mod_per_unit FROM jsonb_array_elements(v_modifiers) m;

    v_mod_total  := round_idr(v_mod_per_unit * v_quantity);
    v_line_total := round_idr((v_unit_price + v_mod_per_unit) * v_quantity);

    SELECT c.dispatch_station INTO v_dispatch_station
      FROM products p JOIN categories c ON c.id = p.category_id WHERE p.id = v_product_id;

    INSERT INTO order_items (
      order_id, product_id, name_snapshot, unit_price, quantity, line_total,
      modifiers, modifiers_total, dispatch_station, is_locked, kitchen_status
    )
    SELECT v_order_id, p.id, p.name, v_unit_price, v_quantity, v_line_total,
           v_modifiers, v_mod_total, v_dispatch_station, false, 'pending'
    FROM products p WHERE p.id = v_product_id;

    v_subtotal := v_subtotal + v_line_total;
  END LOOP;

  UPDATE orders SET subtotal = v_subtotal, total = v_subtotal WHERE id = v_order_id;

  BEGIN
    INSERT INTO held_order_idempotency_keys (client_uuid, order_id) VALUES (p_client_uuid, v_order_id);
  EXCEPTION WHEN unique_violation THEN
    SELECT order_id INTO v_existing FROM held_order_idempotency_keys WHERE client_uuid = p_client_uuid;
    RETURN v_existing;
  END;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_uid, 'order.held', 'orders', v_order_id,
          jsonb_build_object('table_number', p_table_number,
                             'item_count', jsonb_array_length(p_cart_payload->'items')));

  RETURN v_order_id;
END $function$;
