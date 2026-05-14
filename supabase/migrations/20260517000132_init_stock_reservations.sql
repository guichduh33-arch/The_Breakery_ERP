-- Session 13 / Phase 3.C — Migration 132
-- Stock reservations: virtual holds against current_stock. Available stock
-- is computed as current_stock - sum(active holds). Hold rows expire and a
-- pg_cron job releases them every 5 minutes.
--
-- Decision (D-W3-3C-01): reservation RPCs DO NOT call record_stock_movement_v1.
-- Rationale: section_stock would be double-counted (virtual hold vs physical
-- stock). Audit trail lives in stock_reservations rows + audit_log entries.

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stock_reservations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id    UUID NOT NULL REFERENCES public.products(id),
  section_id    UUID REFERENCES public.sections(id),
  quantity      NUMERIC(10,3) NOT NULL CHECK (quantity > 0),
  holder_id     UUID,
  holder_type   TEXT NOT NULL CHECK (holder_type IN ('cart','tablet','b2b_order')),
  expires_at    TIMESTAMPTZ NOT NULL,
  status        TEXT NOT NULL DEFAULT 'held'
                  CHECK (status IN ('held','released','consumed')),
  notes         TEXT,
  released_at   TIMESTAMPTZ,
  released_reason TEXT,
  consumed_at   TIMESTAMPTZ,
  idempotency_key UUID UNIQUE,
  created_by    UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stock_reservations_active
  ON public.stock_reservations (product_id, section_id, status)
  WHERE status = 'held';

CREATE INDEX IF NOT EXISTS idx_stock_reservations_expires
  ON public.stock_reservations (expires_at)
  WHERE status = 'held';

CREATE INDEX IF NOT EXISTS idx_stock_reservations_holder
  ON public.stock_reservations (holder_type, holder_id)
  WHERE status = 'held';

ALTER TABLE public.stock_reservations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS stock_reservations_select_auth ON public.stock_reservations;
CREATE POLICY stock_reservations_select_auth
  ON public.stock_reservations
  FOR SELECT
  TO authenticated
  USING (TRUE);

REVOKE INSERT, UPDATE, DELETE ON public.stock_reservations FROM authenticated;
GRANT  SELECT ON public.stock_reservations TO authenticated;

-- ---------------------------------------------------------------------------
-- View: v_product_available_stock
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_product_available_stock AS
SELECT
  p.id          AS product_id,
  p.sku,
  p.name,
  p.current_stock,
  COALESCE(SUM(r.quantity) FILTER (
    WHERE r.status = 'held' AND r.expires_at > now()
  ), 0)         AS held_quantity,
  GREATEST(
    0,
    p.current_stock - COALESCE(SUM(r.quantity) FILTER (
      WHERE r.status = 'held' AND r.expires_at > now()
    ), 0)
  )             AS available_quantity
FROM public.products p
LEFT JOIN public.stock_reservations r ON r.product_id = p.id
WHERE p.deleted_at IS NULL
GROUP BY p.id, p.sku, p.name, p.current_stock;

GRANT SELECT ON public.v_product_available_stock TO authenticated;

-- ---------------------------------------------------------------------------
-- RPC: reservation_hold_v1
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reservation_hold_v1(
  p_product_id      UUID,
  p_quantity        NUMERIC,
  p_holder_type     TEXT,
  p_expires_at      TIMESTAMPTZ,
  p_section_id      UUID    DEFAULT NULL,
  p_holder_id       UUID    DEFAULT NULL,
  p_notes           TEXT    DEFAULT NULL,
  p_idempotency_key UUID    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid       UUID := auth.uid();
  v_profile   UUID;
  v_current   NUMERIC(10,3);
  v_held      NUMERIC(10,3);
  v_avail     NUMERIC(10,3);
  v_res_id    UUID;
BEGIN
  IF p_product_id IS NULL THEN
    RAISE EXCEPTION 'product_id_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'quantity_must_be_positive' USING ERRCODE = 'P0001';
  END IF;
  IF p_holder_type IS NULL OR p_holder_type NOT IN ('cart','tablet','b2b_order') THEN
    RAISE EXCEPTION 'invalid_holder_type' USING ERRCODE = 'P0001';
  END IF;
  IF p_expires_at IS NULL OR p_expires_at <= now() THEN
    RAISE EXCEPTION 'expires_at_must_be_future' USING ERRCODE = 'P0001';
  END IF;

  IF v_uid IS NOT NULL THEN
    SELECT id INTO v_profile FROM user_profiles
      WHERE auth_user_id = v_uid AND deleted_at IS NULL LIMIT 1;
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_res_id FROM stock_reservations
      WHERE idempotency_key = p_idempotency_key LIMIT 1;
    IF FOUND THEN
      SELECT current_stock INTO v_current FROM products WHERE id = p_product_id;
      SELECT COALESCE(SUM(quantity), 0) INTO v_held
        FROM stock_reservations
        WHERE product_id = p_product_id
          AND status = 'held'
          AND expires_at > now();
      RETURN jsonb_build_object(
        'reservation_id', v_res_id,
        'product_id', p_product_id,
        'quantity', p_quantity,
        'available_after', GREATEST(0, v_current - v_held),
        'idempotent_replay', TRUE
      );
    END IF;
  END IF;

  SELECT current_stock INTO v_current FROM products WHERE id = p_product_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'product_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT COALESCE(SUM(quantity), 0) INTO v_held
    FROM stock_reservations
    WHERE product_id = p_product_id
      AND status = 'held'
      AND expires_at > now();

  v_avail := v_current - v_held;
  IF v_avail < p_quantity THEN
    RAISE EXCEPTION 'insufficient_available_stock' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO stock_reservations (
    product_id, section_id, quantity, holder_id, holder_type,
    expires_at, status, notes, idempotency_key, created_by
  ) VALUES (
    p_product_id, p_section_id, p_quantity, p_holder_id, p_holder_type,
    p_expires_at, 'held', p_notes, p_idempotency_key, v_profile
  ) RETURNING id INTO v_res_id;

  INSERT INTO audit_log (action, subject_table, subject_id, payload, actor_profile_id)
  VALUES (
    'stock.reservation.hold', 'stock_reservations', v_res_id,
    jsonb_build_object(
      'product_id', p_product_id,
      'section_id', p_section_id,
      'quantity', p_quantity,
      'holder_type', p_holder_type,
      'holder_id', p_holder_id,
      'expires_at', p_expires_at,
      'idempotency_key', p_idempotency_key
    ),
    v_profile
  );

  RETURN jsonb_build_object(
    'reservation_id', v_res_id,
    'product_id', p_product_id,
    'quantity', p_quantity,
    'available_after', v_avail - p_quantity,
    'idempotent_replay', FALSE
  );
END $function$;

REVOKE ALL ON FUNCTION public.reservation_hold_v1(UUID, NUMERIC, TEXT, TIMESTAMPTZ, UUID, UUID, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reservation_hold_v1(UUID, NUMERIC, TEXT, TIMESTAMPTZ, UUID, UUID, TEXT, UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- RPC: reservation_release_v1
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reservation_release_v1(
  p_reservation_id UUID,
  p_reason         TEXT DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid     UUID := auth.uid();
  v_profile UUID;
  v_status  TEXT;
BEGIN
  IF p_reservation_id IS NULL THEN
    RAISE EXCEPTION 'reservation_id_required' USING ERRCODE = 'P0001';
  END IF;
  IF v_uid IS NOT NULL THEN
    SELECT id INTO v_profile FROM user_profiles
      WHERE auth_user_id = v_uid AND deleted_at IS NULL LIMIT 1;
  END IF;

  SELECT status INTO v_status FROM stock_reservations
    WHERE id = p_reservation_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reservation_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_status = 'released' THEN
    RETURN jsonb_build_object('reservation_id', p_reservation_id, 'status', 'released', 'replay', TRUE);
  END IF;
  IF v_status = 'consumed' THEN
    RAISE EXCEPTION 'reservation_already_consumed' USING ERRCODE = 'P0003';
  END IF;

  UPDATE stock_reservations
     SET status = 'released',
         released_at = now(),
         released_reason = p_reason,
         updated_at = now()
   WHERE id = p_reservation_id;

  INSERT INTO audit_log (action, subject_table, subject_id, payload, actor_profile_id)
  VALUES (
    'stock.reservation.release', 'stock_reservations', p_reservation_id,
    jsonb_build_object('reason', p_reason),
    v_profile
  );

  RETURN jsonb_build_object('reservation_id', p_reservation_id, 'status', 'released', 'replay', FALSE);
END $function$;

REVOKE ALL ON FUNCTION public.reservation_release_v1(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reservation_release_v1(UUID, TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- RPC: reservation_consume_v1
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reservation_consume_v1(
  p_reservation_id UUID
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid     UUID := auth.uid();
  v_profile UUID;
  v_status  TEXT;
BEGIN
  IF p_reservation_id IS NULL THEN
    RAISE EXCEPTION 'reservation_id_required' USING ERRCODE = 'P0001';
  END IF;
  IF v_uid IS NOT NULL THEN
    SELECT id INTO v_profile FROM user_profiles
      WHERE auth_user_id = v_uid AND deleted_at IS NULL LIMIT 1;
  END IF;

  SELECT status INTO v_status FROM stock_reservations
    WHERE id = p_reservation_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reservation_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_status = 'consumed' THEN
    RETURN jsonb_build_object('reservation_id', p_reservation_id, 'status', 'consumed', 'replay', TRUE);
  END IF;
  IF v_status = 'released' THEN
    RAISE EXCEPTION 'reservation_already_released' USING ERRCODE = 'P0003';
  END IF;

  UPDATE stock_reservations
     SET status = 'consumed',
         consumed_at = now(),
         updated_at = now()
   WHERE id = p_reservation_id;

  INSERT INTO audit_log (action, subject_table, subject_id, payload, actor_profile_id)
  VALUES (
    'stock.reservation.consume', 'stock_reservations', p_reservation_id,
    '{}'::jsonb,
    v_profile
  );

  RETURN jsonb_build_object('reservation_id', p_reservation_id, 'status', 'consumed', 'replay', FALSE);
END $function$;

REVOKE ALL ON FUNCTION public.reservation_consume_v1(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reservation_consume_v1(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- release_expired_reservations() — pg_cron sweep (every 5 min).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.release_expired_reservations()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_count INT;
BEGIN
  WITH expired AS (
    UPDATE stock_reservations
       SET status = 'released',
           released_at = now(),
           released_reason = 'expired',
           updated_at = now()
     WHERE status = 'held'
       AND expires_at <= now()
    RETURNING id
  )
  SELECT COUNT(*)::INT INTO v_count FROM expired;
  RETURN v_count;
END $function$;

REVOKE ALL ON FUNCTION public.release_expired_reservations() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.release_expired_reservations() TO postgres;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('release-expired-reservations')
      FROM cron.job WHERE jobname = 'release-expired-reservations';
    PERFORM cron.schedule(
      'release-expired-reservations',
      '*/5 * * * *',
      $cron$ SELECT public.release_expired_reservations(); $cron$
    );
  END IF;
END $$;

COMMENT ON TABLE public.stock_reservations IS
  'Virtual stock holds. Available stock = products.current_stock − sum(active holds). Released by cron when expires_at passes.';
COMMENT ON VIEW  public.v_product_available_stock IS
  'Per-product current_stock − held_quantity. Use for UI availability checks.';
COMMENT ON FUNCTION public.release_expired_reservations() IS
  'Idempotent sweep flipping status=held -> released where expires_at <= now(). Scheduled via pg_cron every 5 minutes.';
