-- Session 59 — Task 5 (17 D1.1) — _103
-- Bump create_tablet_order_v2 -> v3 : add p_notes (order-level free-text note,
-- e.g. "no gluten" / allergy), written to orders.notes (existing column, never
-- populated by the tablet flow until now). Line-level notes (order_items.note,
-- fiche 17 D2.1) are OUT of scope for this migration.
--
-- Procedure (DEV-S57-02): body below is the LIVE v2 definition (fetched via
-- pg_get_functiondef), NOT the original _000011 migration file — the live
-- body already carries the B-1 Ph2 multi-station dispatch resolution
-- (_resolve_dispatch_stations_v1 / dispatch_stations[]) which post-dates _000011.
-- Only change vs. the live body: + p_notes arg, + notes column/value on the
-- orders INSERT. Idempotency mechanics (p_client_uuid + tablet_order_idempotency_keys)
-- are untouched.
--
-- RPC versioning monotone (CLAUDE.md): new _v3 + DROP FUNCTION v2(<same args>)
-- in the same migration.

CREATE OR REPLACE FUNCTION public.create_tablet_order_v3(
  p_client_uuid  UUID,
  p_waiter_id    UUID,
  p_table_number TEXT,
  p_order_type   order_type,
  p_items        JSONB,
  p_notes        TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id            UUID;
  v_existing_order_id  UUID;
  v_order_id           UUID;
  v_order_number       TEXT;
  v_seq_number         INTEGER;
  v_item               JSONB;
  v_product_id         UUID;
  v_quantity           DECIMAL(10,3);
  v_unit_price         DECIMAL(12,2);
  v_modifiers          JSONB;
  v_modifiers_per_unit DECIMAL(12,2);
  v_modifiers_total    DECIMAL(12,2);
  v_line_total         DECIMAL(12,2);
  v_dispatch_station   TEXT;
  v_dispatch_stations  TEXT[];
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001';
  END IF;

  IF p_client_uuid IS NULL THEN
    RAISE EXCEPTION 'client_uuid required' USING ERRCODE = 'check_violation';
  END IF;

  -- Idempotent replay check FIRST (before permission check, before any writes)
  SELECT order_id INTO v_existing_order_id
    FROM tablet_order_idempotency_keys
    WHERE client_uuid = p_client_uuid;

  IF v_existing_order_id IS NOT NULL THEN
    RETURN v_existing_order_id;
  END IF;

  IF NOT has_permission(v_user_id, 'sales.create') THEN
    RAISE EXCEPTION 'Permission denied: sales.create' USING ERRCODE = 'P0003';
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Order must contain at least one item' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO order_sequences (date, last_number)
    VALUES (CURRENT_DATE, 1)
    ON CONFLICT (date) DO UPDATE
      SET last_number = order_sequences.last_number + 1
    RETURNING last_number INTO v_seq_number;

  v_order_number := '#' || LPAD(v_seq_number::TEXT, 4, '0');

  INSERT INTO orders (
    order_number, order_type, status, created_via,
    waiter_id, table_number, sent_to_kitchen_at,
    subtotal, tax_amount, total, notes
  ) VALUES (
    v_order_number, p_order_type, 'pending_payment', 'tablet',
    p_waiter_id, p_table_number, now(),
    0, 0, 0, p_notes
  ) RETURNING id INTO v_order_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_product_id := (v_item->>'product_id')::UUID;
    v_quantity   := (v_item->>'quantity')::DECIMAL;
    v_unit_price := (v_item->>'unit_price')::DECIMAL;
    v_modifiers  := COALESCE(v_item->'modifiers', '[]'::jsonb);

    SELECT COALESCE(SUM((m->>'price_adjustment')::DECIMAL(12,2)), 0)
      INTO v_modifiers_per_unit
      FROM jsonb_array_elements(v_modifiers) m;

    v_modifiers_total := round_idr(v_modifiers_per_unit * v_quantity);
    v_line_total      := round_idr((v_unit_price + v_modifiers_per_unit) * v_quantity);

    -- Spec B-1 Ph2 — résolution multi-station (override produit > catégorie).
    v_dispatch_stations := _resolve_dispatch_stations_v1(v_product_id);
    v_dispatch_station  := v_dispatch_stations[1];  -- legacy single = 1er élément (NULL si vide)

    INSERT INTO order_items (
      order_id, product_id, name_snapshot, unit_price, quantity, line_total,
      modifiers, modifiers_total, dispatch_station, dispatch_stations,
      is_locked, kitchen_status, sent_to_kitchen_at
    )
    SELECT
      v_order_id, p.id, p.name, v_unit_price, v_quantity, v_line_total,
      v_modifiers, v_modifiers_total, v_dispatch_station, v_dispatch_stations,
      true, 'pending', now()
    FROM products p WHERE p.id = v_product_id;
  END LOOP;

  -- Idempotency key insert : if another concurrent call won the race,
  -- the PK constraint raises unique_violation. Catch + re-read to return their winner order_id.
  BEGIN
    INSERT INTO tablet_order_idempotency_keys (client_uuid, order_id)
      VALUES (p_client_uuid, v_order_id);
  EXCEPTION WHEN unique_violation THEN
    SELECT order_id INTO v_existing_order_id
      FROM tablet_order_idempotency_keys
      WHERE client_uuid = p_client_uuid;
    RETURN v_existing_order_id;
  END;

  RETURN v_order_id;
END $function$;

GRANT EXECUTE ON FUNCTION public.create_tablet_order_v3(uuid, uuid, text, order_type, jsonb, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.create_tablet_order_v3(uuid, uuid, text, order_type, jsonb, text) FROM PUBLIC, anon;

COMMENT ON FUNCTION public.create_tablet_order_v3(uuid, uuid, text, order_type, jsonb, text) IS
  'S59 (17 D1.1) — adds p_notes (order-level free-text note -> orders.notes). Idempotent replay via p_client_uuid unchanged (S25). v2 dropped in same migration (CLAUDE.md RPC versioning rule).';

DROP FUNCTION public.create_tablet_order_v2(uuid, uuid, text, order_type, jsonb);
