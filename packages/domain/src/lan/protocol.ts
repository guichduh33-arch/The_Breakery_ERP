// packages/domain/src/lan/protocol.ts
//
// Session 13 / Phase 5.A — LAN protocol message types (pure TS).
//
// Hybrid LAN transport per decision D4 :
//   - intra-tab / same-origin : `BroadcastChannel`
//   - cross-network / cross-tab : Supabase Realtime broadcast
//
// Every envelope is versioned (`version: 1`) so a future format bump
// can be detected at parse time without breaking older clients.
//
// Envelopes are immutable JSON. Producers MUST mint `id` via
// `crypto.randomUUID()` so the dedup ring in `messageDedup.ts` works.

/** Discriminator union of every supported LAN message type. */
export type LanMessageType =
  | 'order.update'
  | 'kds.bump'
  | 'kds.recall'
  | 'kds.undo'
  | 'print.request'
  | 'print.result'
  | 'display.cart'
  | 'display.order_ready'
  | 'heartbeat'
  | 'device.registered';

/** Common envelope fields. */
interface LanEnvelopeBase {
  /** Protocol version. Bump on breaking changes. */
  version: 1;
  /** Globally unique per emission (crypto.randomUUID()). Used by dedup. */
  id: string;
  /** Originating device id. */
  from: string;
  /** Optional target device id (undefined = broadcast). */
  to?: string;
  /** Unix ms when the producer emitted the message. */
  ts: number;
}

export interface OrderUpdateMessage extends LanEnvelopeBase {
  type: 'order.update';
  payload: {
    order_id: string;
    status: string;
    /** Optional table id (dine-in flow). */
    table_id?: string;
  };
}

export interface KdsBumpMessage extends LanEnvelopeBase {
  type: 'kds.bump';
  payload: {
    order_id: string;
    order_item_id: string;
    /** Snapshot of the new status after bump. */
    new_status: 'preparing' | 'ready' | 'served';
    station: string;
  };
}

export interface KdsRecallMessage extends LanEnvelopeBase {
  type: 'kds.recall';
  payload: {
    order_id: string;
    reason: string;
  };
}

export interface KdsUndoMessage extends LanEnvelopeBase {
  type: 'kds.undo';
  payload: {
    order_item_id: string;
    reverted_to: 'preparing';
  };
}

export interface PrintRequestMessage extends LanEnvelopeBase {
  type: 'print.request';
  payload: {
    /** Ticket type — drives the renderer (e.g., 'kitchen_chit', 'receipt'). */
    ticket_type: string;
    /** Logical reference (order id, refund id, ...). */
    reference_type: string;
    reference_id: string;
    /** Renderer payload. Opaque to LAN layer. */
    data: Record<string, unknown>;
    priority?: number;
  };
}

export interface PrintResultMessage extends LanEnvelopeBase {
  type: 'print.result';
  /** Targeted reply — `to` is the requesting device. */
  to: string;
  payload: {
    /** id of the print_queue row (server-side persistence). */
    job_id?: string;
    request_id: string;
    success: boolean;
    error?: string;
  };
}

export interface DisplayCartMessage extends LanEnvelopeBase {
  type: 'display.cart';
  payload: {
    order_id: string;
    items: Array<{ name: string; quantity: number; unit_price: number }>;
    subtotal: number;
    total: number;
  };
}

export interface DisplayOrderReadyMessage extends LanEnvelopeBase {
  type: 'display.order_ready';
  payload: {
    order_id: string;
    order_number: string;
  };
}

export interface HeartbeatMessage extends LanEnvelopeBase {
  type: 'heartbeat';
  payload: {
    device_type: 'printer' | 'kiosk_display' | 'kds' | 'tablet' | 'pos';
    capabilities?: Record<string, unknown>;
  };
}

export interface DeviceRegisteredMessage extends LanEnvelopeBase {
  type: 'device.registered';
  payload: {
    device_id: string;
    device_type: 'printer' | 'kiosk_display' | 'kds' | 'tablet' | 'pos';
    name: string;
  };
}

/** All known message shapes. */
export type LanMessage =
  | OrderUpdateMessage
  | KdsBumpMessage
  | KdsRecallMessage
  | KdsUndoMessage
  | PrintRequestMessage
  | PrintResultMessage
  | DisplayCartMessage
  | DisplayOrderReadyMessage
  | HeartbeatMessage
  | DeviceRegisteredMessage;

/** Minimal structural validator — returns true if the candidate has the
 * required envelope fields. Does NOT validate payload shape (that lives in
 * per-feature handlers). Use as a defensive parse gate at transport ingress.
 *
 * Cheap : O(1), no allocations beyond the typeof checks.
 */
export function isLanMessage(candidate: unknown): candidate is LanMessage {
  if (typeof candidate !== 'object' || candidate === null) return false;
  const m = candidate as Record<string, unknown>;
  if (m.version !== 1) return false;
  if (typeof m.id !== 'string' || m.id.length === 0) return false;
  if (typeof m.from !== 'string' || m.from.length === 0) return false;
  if (typeof m.type !== 'string') return false;
  if (typeof m.ts !== 'number' || !Number.isFinite(m.ts)) return false;
  if (typeof m.payload !== 'object' || m.payload === null) return false;
  if (m.to !== undefined && typeof m.to !== 'string') return false;
  return true;
}

/** Factory : build a well-formed envelope. `id` defaults to a fresh UUID,
 * `ts` to `Date.now()`. Keeps producers honest — no hand-rolled envelopes.
 */
export function createMessage<T extends LanMessage>(
  partial: Omit<T, 'version' | 'id' | 'ts'> & { id?: string; ts?: number },
): T {
  return {
    version: 1 as const,
    id: partial.id ?? crypto.randomUUID(),
    ts: partial.ts ?? Date.now(),
    ...partial,
  } as T;
}
