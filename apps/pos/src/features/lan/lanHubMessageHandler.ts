// apps/pos/src/features/lan/lanHubMessageHandler.ts
//
// Session 13 / Phase 5.A — central message dispatcher for the LAN hub.
//
// Each incoming, deduped `LanMessage` is routed to the matching handler
// based on `type`. Handlers are pure side-effect functions (DB write,
// UI invalidate, audit log) — they receive the message + a "context"
// bag (supabase client, react-query client, etc.) and never block the
// hub's transport loop.

import type { QueryClient } from '@tanstack/react-query';
import type { Json, TypedSupabaseClient } from '@breakery/supabase';
import type {
  LanMessage,
  KdsBumpMessage,
  PrintRequestMessage,
  PrintResultMessage,
  HeartbeatMessage,
} from '@breakery/domain';

export interface LanHandlerContext {
  supabase: TypedSupabaseClient;
  /** Optional react-query client to invalidate on inbound events. */
  queryClient?: QueryClient;
  /** Hub's own device id, for `to=`-targeted replies. */
  hubDeviceId: string;
  /** Callback to send a reply back through the hub transport. */
  reply: (msg: LanMessage) => void;
}

export async function handleLanMessage(
  msg: LanMessage,
  ctx: LanHandlerContext,
): Promise<void> {
  switch (msg.type) {
    case 'kds.bump':
      await handleKdsBump(msg, ctx);
      return;

    case 'kds.recall':
    case 'kds.undo':
      ctx.queryClient?.invalidateQueries({ queryKey: ['kds'] });
      return;

    case 'print.request':
      await handlePrintRequest(msg, ctx);
      return;

    case 'print.result':
      handlePrintResult(msg, ctx);
      return;

    case 'heartbeat':
      await handleHeartbeat(msg, ctx);
      return;

    case 'order.update':
      ctx.queryClient?.invalidateQueries({ queryKey: ['orders'] });
      ctx.queryClient?.invalidateQueries({ queryKey: ['kds'] });
      return;

    case 'display.cart':
    case 'display.order_ready':
      // Customer-display payload — forward to the local DOM via the
      // companion `displayBroadcast` channel (Phase 4.C wiring). The hub
      // itself doesn't render the display ; it just keeps the message in
      // the dedup ring so it doesn't get re-processed.
      return;

    case 'device.registered':
      // Future : maintain a peers map. For Phase 5.A this is observability-only.
      return;

    default: {
      // Exhaustive check — TS narrows `msg` to `never` here. If a new
      // member is added to the union without a case, the compiler errors.
      const _exhaustive: never = msg;
      void _exhaustive;
      return;
    }
  }
}

// ---------------------------------------------------------------------------

async function handleKdsBump(
  msg: KdsBumpMessage,
  ctx: LanHandlerContext,
): Promise<void> {
  // The bump invalidates downstream caches so cashier-side dashboards refresh.
  ctx.queryClient?.invalidateQueries({ queryKey: ['kds'] });
  ctx.queryClient?.invalidateQueries({ queryKey: ['orders'] });

  // Legacy kitchen-chit print path (S13). Since S34, prep tickets print via the
  // direct station bridge (Path A: useFireToStations -> printStationTicket). To
  // avoid the post-S34 double-print risk, this legacy enqueue is OFF by default
  // and only runs when VITE_LEGACY_KITCHEN_CHIT === '1'. The flag exists ONLY as
  // a rollback during print-bridge rollout; it MUST be removed once the bridge is
  // stable in prod. See plan 2026-06-01-pos-double-print-risk (gate b) +
  // 2026-06-01-pos-print-bridge-deploy (DEV-S34-W0-02).
  const legacyChitEnabled = import.meta.env.VITE_LEGACY_KITCHEN_CHIT === '1';
  if (legacyChitEnabled && msg.payload.new_status === 'preparing') {
    const p_payload: Json = {
      ticket_type:    'kitchen_chit',
      order_item_id:  msg.payload.order_item_id,
      order_id:       msg.payload.order_id,
      station:        msg.payload.station,
    };
    // p_device_id (uuid) accepts NULL at runtime; generated Args omits `| null`.
    const { error } = await ctx.supabase.rpc('enqueue_print_job_v1', {
      p_device_id:      null as unknown as string,
      p_payload,
      p_source:         'kds',
      p_reference_type: 'order_item',
      p_reference_id:   msg.payload.order_item_id,
      p_priority:       5,
    });
    if (error !== null) {
      // Surface but don't throw — print queue is best-effort.
      console.warn('[lan-hub] enqueue_print_job failed', error.message);
    }
  }
}

async function handlePrintRequest(
  msg: PrintRequestMessage,
  ctx: LanHandlerContext,
): Promise<void> {
  // Persist the print job. The actual print server (separate process)
  // polls `claim_print_job_v1` for the targeted device.
  // `enqueue_print_job_v1(p_device_id uuid, ...)` accepts NULL at runtime
  // (unassigned/broadcast job); the generated Args type omits the `| null`.
  const p_payload: Json = msg.payload.data as Json;
  const { data, error } = await ctx.supabase.rpc('enqueue_print_job_v1', {
    p_device_id:      null as unknown as string,
    p_payload,
    p_source:         'pos',
    p_reference_type: msg.payload.reference_type,
    p_reference_id:   msg.payload.reference_id,
    p_priority:       msg.payload.priority ?? 5,
  });

  if (error !== null) {
    console.warn('[lan-hub] print.request enqueue failed', error.message);
    return;
  }

  // Reply to the requesting device only (targeted via `to: msg.from`).
  // 21-003 P2 audit : do NOT broadcast print results.
  const jobId = (data as { id?: string } | null)?.id;
  const payload: PrintResultMessage['payload'] = jobId !== undefined
    ? { job_id: jobId, request_id: msg.id, success: true }
    : { request_id: msg.id, success: true };
  const reply: PrintResultMessage = {
    version: 1,
    id: crypto.randomUUID(),
    from: ctx.hubDeviceId,
    to: msg.from,
    type: 'print.result',
    ts: Date.now(),
    payload,
  };
  ctx.reply(reply);
}

function handlePrintResult(
  msg: PrintResultMessage,
  ctx: LanHandlerContext,
): void {
  // Result already targeted — clients filter via `to`. The hub
  // invalidates the print-queue cache so any BO operator viewing the
  // queue page sees the new row state.
  ctx.queryClient?.invalidateQueries({ queryKey: ['print-queue'] });
  void msg;
}

async function handleHeartbeat(
  msg: HeartbeatMessage,
  ctx: LanHandlerContext,
): Promise<void> {
  // Touch lan_devices.last_heartbeat_at by code (= device id here).
  const { error } = await ctx.supabase.rpc('update_lan_heartbeat_v1', {
    p_device_code: msg.from,
  });
  if (error !== null) {
    // Device not registered yet — silent. The BO operator can create it.
    // Don't log noise.
  }
}
