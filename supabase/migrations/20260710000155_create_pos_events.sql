-- S72 Lot 1 — pos_events: append-only operational audit journal, partitioned by
-- month on occurred_at (purge = DROP old partition, owner decision 2026-07-11).
-- No FKs (audit_logs convention). Offline idempotence via UNIQUE
-- (client_event_id, occurred_at) — occurred_at is stamped once at emit time and
-- replayed identically, so a re-synced event never double-inserts. actor_id =
-- operator at emit time; synced_by = whoever flushed the outbox.

CREATE TYPE public.pos_event_type AS ENUM (
  'order_opened','order_type_changed','table_assigned','table_transferred',
  'item_added','item_qty_changed','item_removed_pre_fire','item_voided_post_fire',
  'discount_applied','discount_removed','note_added',
  'sent_to_kitchen','kitchen_bumped','kitchen_recalled','order_held','order_resumed',
  'payment_started','payment_method_selected','payment_completed','payment_failed',
  'change_given','receipt_printed','receipt_reprinted','refund_issued','sale_completed',
  'session_opened','session_closed','cash_drawer_opened','paid_in','paid_out',
  'manager_pin_used','login','logout','device_switch'
);

CREATE TABLE public.pos_events (
  id                uuid NOT NULL DEFAULT gen_random_uuid(),
  client_event_id   uuid NOT NULL,
  event_type        public.pos_event_type NOT NULL,
  occurred_at       timestamptz NOT NULL,
  recorded_at       timestamptz NOT NULL DEFAULT now(),
  device_id         uuid NOT NULL,
  device_seq        bigint,
  actor_id          uuid,
  synced_by         uuid,
  session_id        uuid,
  order_id          uuid,
  order_number_snap text,
  order_item_id     uuid,
  amount            numeric,
  reason            text,
  payload           jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (id, occurred_at),
  UNIQUE (client_event_id, occurred_at)
) PARTITION BY RANGE (occurred_at);

CREATE INDEX pos_events_occurred_idx ON public.pos_events (occurred_at DESC);
CREATE INDEX pos_events_order_idx    ON public.pos_events (order_id, occurred_at);
CREATE INDEX pos_events_type_idx     ON public.pos_events (event_type, occurred_at DESC);
CREATE INDEX pos_events_device_idx   ON public.pos_events (device_id, device_seq);
CREATE INDEX pos_events_actor_idx    ON public.pos_events (actor_id, occurred_at DESC);

-- Initial monthly partitions (bounds are WITA — the DB runs Asia/Makassar) + a
-- DEFAULT catch-all so an out-of-range occurred_at never rejects an event.
CREATE TABLE public.pos_events_2026_07 PARTITION OF public.pos_events
  FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE public.pos_events_2026_08 PARTITION OF public.pos_events
  FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE public.pos_events_2026_09 PARTITION OF public.pos_events
  FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE public.pos_events_default PARTITION OF public.pos_events DEFAULT;

ALTER TABLE public.pos_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY pos_events_read ON public.pos_events
  FOR SELECT TO authenticated
  USING (has_permission(auth.uid(), 'reports.audit.read'));

REVOKE ALL ON public.pos_events FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE ON public.pos_events FROM authenticated;
GRANT SELECT ON public.pos_events TO authenticated;

-- Defense-in-depth: immutability. Writes go through record_pos_events_v1
-- (SECURITY DEFINER, INSERT-only). UPDATE/DELETE are always rejected; purge is
-- DROP PARTITION (DDL), not row DELETE, so it is unaffected.
CREATE OR REPLACE FUNCTION public.pos_events_block_mutations()
RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN
  RAISE EXCEPTION 'pos_events is append-only (% blocked)', TG_OP USING ERRCODE = '0A000';
END;
$function$;

CREATE TRIGGER pos_events_no_update BEFORE UPDATE ON public.pos_events
  FOR EACH ROW EXECUTE FUNCTION public.pos_events_block_mutations();
CREATE TRIGGER pos_events_no_delete BEFORE DELETE ON public.pos_events
  FOR EACH ROW EXECUTE FUNCTION public.pos_events_block_mutations();

COMMENT ON TABLE public.pos_events IS
  'S72 append-only POS operational audit journal, partitioned monthly on occurred_at. Idempotent on (client_event_id, occurred_at). Written only by record_pos_events_v1; read gated reports.audit.read.';
