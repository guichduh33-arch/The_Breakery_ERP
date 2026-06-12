-- 20260627000011_create_fire_counter_order_v1.sql
-- S43 Wave C (P0-3) — persiste le "Send to Kitchen" comptoir en DB.
-- Symétrique de create_tablet_order_v2 (S25) : mêmes inserts orders/order_items
-- (kitchen_status='pending', is_locked=true) mais created_via='pos',
-- session_id obligatoire, et mode APPEND (p_order_id) pour les fires successifs.
-- Totaux laissés à 0 comme v2 — pay_existing_order_v7 calcule le vrai total.
-- Silent-skip interdit (DEV-S25-1.A-03) : produit inconnu = P0002 franche.
CREATE OR REPLACE FUNCTION fire_counter_order_v1(
  p_client_uuid  UUID,
  p_session_id   UUID,
  p_items        JSONB,
  p_order_id     UUID DEFAULT NULL,
  p_table_number TEXT DEFAULT NULL,
  p_order_type   order_type DEFAULT 'take_out'
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id            UUID := auth.uid();
  v_existing_order_id  UUID;
  v_order_id           UUID := p_order_id;
  v_order_number       TEXT;
  v_seq_number         INTEGER;
  v_item               JSONB;
  v_product_id         UUID;
  v_quantity           DECIMAL(10,3);
  v_unit_price         DECIMAL(12,2);
  v_modifiers          JSONB;
  v_modifiers_per_unit DECIMAL(12,2);
  v_line_discount      DECIMAL(12,2);
  v_line_total         DECIMAL(12,2);
  v_dispatch_station   TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001';
  END IF;
  IF p_client_uuid IS NULL THEN
    RAISE EXCEPTION 'client_uuid required' USING ERRCODE = 'check_violation';
  END IF;

  -- Replay idempotent AVANT tout write (pattern create_tablet_order_v2).
  SELECT order_id INTO v_existing_order_id
    FROM counter_fire_idempotency_keys WHERE client_uuid = p_client_uuid;
  IF v_existing_order_id IS NOT NULL THEN
    SELECT jsonb_build_object('order_id', o.id, 'order_number', o.order_number, 'idempotent_replay', true)
      INTO STRICT v_item FROM orders o WHERE o.id = v_existing_order_id;
    RETURN v_item;
  END IF;

  IF NOT has_permission(v_user_id, 'pos.sale.create') THEN
    RAISE EXCEPTION 'Permission denied: pos.sale.create' USING ERRCODE = 'P0003';
  END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Fire must contain at least one item' USING ERRCODE = 'check_violation';
  END IF;
  IF p_session_id IS NULL THEN
    RAISE EXCEPTION 'session_id required for counter orders' USING ERRCODE = 'check_violation';
  END IF;

  IF v_order_id IS NULL THEN
    -- CREATE : nouvel ordre comptoir pending_payment.
    INSERT INTO order_sequences (date, last_number)
      VALUES (CURRENT_DATE, 1)
      ON CONFLICT (date) DO UPDATE SET last_number = order_sequences.last_number + 1
      RETURNING last_number INTO v_seq_number;
    v_order_number := '#' || LPAD(v_seq_number::TEXT, 4, '0');

    INSERT INTO orders (
      order_number, order_type, status, created_via, session_id,
      table_number, sent_to_kitchen_at, subtotal, tax_amount, total
    ) VALUES (
      v_order_number, p_order_type, 'pending_payment', 'pos', p_session_id,
      p_table_number, now(), 0, 0, 0
    ) RETURNING id INTO v_order_id;
  ELSE
    -- APPEND : l'ordre doit être un comptoir pending_payment de CETTE session.
    SELECT o.order_number INTO v_order_number
      FROM orders o
      WHERE o.id = p_order_id AND o.created_via = 'pos'
        AND o.status = 'pending_payment' AND o.session_id = p_session_id;
    IF v_order_number IS NULL THEN
      RAISE EXCEPTION 'Order not found or not appendable' USING ERRCODE = 'P0002';
    END IF;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_product_id    := (v_item->>'product_id')::UUID;
    v_quantity      := (v_item->>'quantity')::DECIMAL;
    v_unit_price    := (v_item->>'unit_price')::DECIMAL;
    v_modifiers     := COALESCE(v_item->'modifiers', '[]'::jsonb);
    v_line_discount := COALESCE((v_item->>'discount_amount')::DECIMAL(12,2), 0);

    -- Silent-skip interdit (DEV-S25-1.A-03) : produit inconnu = erreur franche.
    IF NOT EXISTS (SELECT 1 FROM products p WHERE p.id = v_product_id) THEN
      RAISE EXCEPTION 'Product % not found', v_product_id USING ERRCODE = 'P0002';
    END IF;

    SELECT COALESCE(SUM((m->>'price_adjustment')::DECIMAL(12,2)), 0)
      INTO v_modifiers_per_unit FROM jsonb_array_elements(v_modifiers) m;

    v_line_total := round_idr((v_unit_price + v_modifiers_per_unit) * v_quantity) - v_line_discount;

    SELECT c.dispatch_station INTO v_dispatch_station
      FROM products p JOIN categories c ON c.id = p.category_id
      WHERE p.id = v_product_id;

    -- order_items.discount_amount est NOT NULL DEFAULT 0 → insert direct (pas de NULLIF).
    INSERT INTO order_items (
      order_id, product_id, name_snapshot, unit_price, quantity, line_total,
      modifiers, modifiers_total, dispatch_station,
      discount_amount, is_locked, kitchen_status, sent_to_kitchen_at
    )
    SELECT
      v_order_id, p.id, p.name, v_unit_price, v_quantity, v_line_total,
      v_modifiers, round_idr(v_modifiers_per_unit * v_quantity), v_dispatch_station,
      v_line_discount, true, 'pending', now()
    FROM products p WHERE p.id = v_product_id;
  END LOOP;

  -- Idempotency key insert : si un appel concurrent a gagné la course,
  -- la PK lève unique_violation → catch + re-read pour renvoyer leur ordre.
  BEGIN
    INSERT INTO counter_fire_idempotency_keys (client_uuid, order_id)
      VALUES (p_client_uuid, v_order_id);
  EXCEPTION WHEN unique_violation THEN
    SELECT order_id INTO v_existing_order_id
      FROM counter_fire_idempotency_keys WHERE client_uuid = p_client_uuid;
    SELECT jsonb_build_object('order_id', o.id, 'order_number', o.order_number, 'idempotent_replay', true)
      INTO STRICT v_item FROM orders o WHERE o.id = v_existing_order_id;
    RETURN v_item;
  END;

  RETURN jsonb_build_object('order_id', v_order_id, 'order_number', v_order_number, 'idempotent_replay', false);
END $$;

-- REVOKE pair canonique S25 (PUBLIC + anon + default privileges).
GRANT EXECUTE ON FUNCTION fire_counter_order_v1(UUID, UUID, JSONB, UUID, TEXT, order_type) TO authenticated;
REVOKE EXECUTE ON FUNCTION fire_counter_order_v1(UUID, UUID, JSONB, UUID, TEXT, order_type) FROM PUBLIC, anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon;

COMMENT ON FUNCTION fire_counter_order_v1(UUID, UUID, JSONB, UUID, TEXT, order_type) IS
  'S43 P0-3 — persiste le fire comptoir (Send to Kitchen) en DB avant impression. Idempotent sur p_client_uuid (flavor 2 S25). Mode CREATE (p_order_id NULL) ou APPEND. Retourne {order_id, order_number, idempotent_replay}.';
