-- 20260627000010_create_counter_fire_idempotency_keys.sql
-- S43 Wave C (P0-3) — idempotence du fire comptoir (flavor 2 S25 : table dédiée).
-- Pattern S35 held_order_idempotency_keys / S41 catalog_import_idempotency_keys :
-- RLS sans policy + REVOKE — accès RPC-only (fire_counter_order_v1 SECURITY DEFINER).
CREATE TABLE IF NOT EXISTS public.counter_fire_idempotency_keys (
  client_uuid UUID PRIMARY KEY,
  order_id    UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.counter_fire_idempotency_keys ENABLE ROW LEVEL SECURITY;
-- RLS sans policy + REVOKE : accès RPC-only (contrairement à held_order_idempotency_keys,
-- aucun chemin de lecture POS direct — le RPC renvoie order_id/order_number).
REVOKE ALL ON TABLE public.counter_fire_idempotency_keys FROM PUBLIC, anon, authenticated;
