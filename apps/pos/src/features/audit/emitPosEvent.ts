// apps/pos/src/features/audit/emitPosEvent.ts
//
// S72 Lot 2 — the single client entry point for the POS operational audit
// journal. `emitPosEvent(type, fields?)` stamps an immutable envelope
// (client_event_id + occurred_at frozen once, at emit time), queues it to the
// durable outbox, and schedules a non-blocking flush. It NEVER throws and never
// awaits the network: the caisse flow calls it fire-and-forget.
//
// occurred_at is stamped exactly once here and replayed identically on retry —
// that is what makes the server-side UNIQUE (client_event_id, occurred_at)
// dedup work across an offline span or a double flush (no loss, no duplicate).

import { logger } from '@breakery/utils';
import type { Database } from '@breakery/supabase';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { getDeviceToken, nextDeviceSeq } from './deviceIdentity';
import { enqueueEvent, getPendingEvents, removeEvents } from './outbox';

/** The 34 audit event kinds — sourced from the DB enum to avoid drift. */
export type PosEventType = Database['public']['Enums']['pos_event_type'];

/** Optional context an emitter can attach. All fields are nullable server-side. */
export interface PosEventFields {
  order_id?: string | null;
  order_number_snap?: string | null;
  session_id?: string | null;
  order_item_id?: string | null;
  amount?: number | null;
  reason?: string | null;
  payload?: Record<string, unknown>;
  /** Override the actor (defaults to the logged-in operator). */
  actor_id?: string | null;
}

/** The immutable record shipped to `record_pos_events_v1`. */
export interface PosEventEnvelope {
  client_event_id: string;
  event_type: PosEventType;
  occurred_at: string; // ISO 8601, stamped once at emit
  device_seq: number;
  actor_id: string | null;
  order_id?: string | null;
  order_number_snap?: string | null;
  session_id?: string | null;
  order_item_id?: string | null;
  amount?: number | null;
  reason?: string | null;
  payload: Record<string, unknown>;
}

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(16)}-${Math.round(Math.random() * 1e12).toString(16)}`;
  }
}

/**
 * Emit one audit event. Fire-and-forget: returns immediately, queues durably,
 * and schedules a flush. Any failure is swallowed (logged) so the caisse flow
 * is never affected.
 */
export function emitPosEvent(type: PosEventType, fields: PosEventFields = {}): void {
  try {
    const envelope: PosEventEnvelope = {
      client_event_id: newId(),
      event_type: type,
      occurred_at: new Date().toISOString(),
      device_seq: nextDeviceSeq(),
      actor_id: fields.actor_id ?? useAuthStore.getState().user?.id ?? null,
      payload: fields.payload ?? {},
    };
    if (fields.order_id != null) envelope.order_id = fields.order_id;
    if (fields.order_number_snap != null) envelope.order_number_snap = fields.order_number_snap;
    if (fields.session_id != null) envelope.session_id = fields.session_id;
    if (fields.order_item_id != null) envelope.order_item_id = fields.order_item_id;
    if (fields.amount != null) envelope.amount = fields.amount;
    if (fields.reason != null) envelope.reason = fields.reason;

    void enqueueEvent(envelope)
      .then(() => scheduleFlush())
      .catch((err) => logger.warn('pos_events.enqueue_failed', { type, err: String(err) }));
  } catch (err) {
    logger.warn('pos_events.emit_failed', { type, err: String(err) });
  }
}

// ── Flush ───────────────────────────────────────────────────────────────────

let flushing = false;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

/** Debounced flush trigger — batches emit bursts (e.g. rapid cart edits). */
export function scheduleFlush(delayMs = 400): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushPosEvents();
  }, delayMs);
}

/**
 * Ship the durable queue to the server in one idempotent batch. No-op when
 * offline or unauthenticated (events stay queued for the next attempt). Returns
 * the number of records the server acked (and we dropped).
 */
export async function flushPosEvents(): Promise<number> {
  if (flushing) return 0;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 0;
  if (!useAuthStore.getState().isAuthenticated) return 0;

  flushing = true;
  try {
    const pending = await getPendingEvents();
    if (pending.length === 0) return 0;

    const { error } = await supabase.rpc('record_pos_events_v1', {
      p_device_token: getDeviceToken(),
      p_events: pending.map((r) => r.event) as unknown as Database['public']['Functions']['record_pos_events_v1']['Args']['p_events'],
    });
    if (error) {
      // Keep the queue intact for the next attempt (network/auth blip).
      logger.warn('pos_events.flush_failed', { count: pending.length, err: error.message });
      return 0;
    }

    // Server acked every event (inserted or deduped) — safe to drop them all.
    await removeEvents(pending.map((r) => r.id));
    return pending.length;
  } catch (err) {
    logger.warn('pos_events.flush_threw', { err: String(err) });
    return 0;
  } finally {
    flushing = false;
  }
}
