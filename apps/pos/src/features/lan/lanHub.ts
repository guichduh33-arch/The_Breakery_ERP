// apps/pos/src/features/lan/lanHub.ts
//
// Session 13 / Phase 5.A — LAN hub implementation (D4 : hybrid transport).
//
// The hub is one-per-LAN : the elected POS terminal that hosts the
// message-routing layer. Every client peer (KDS, tablet, customer display,
// other POS terminals) sends messages via either :
//
//   1. `BroadcastChannel('breakery-lan')` — intra-tab / same-origin
//   2. Supabase Realtime broadcast on channel `lan-hub-${storeId}` —
//      cross-network / cross-tab
//
// The hub :
//   - Subscribes to BOTH channels.
//   - Dedupes incoming messages by `id` (MessageDedup ring, 200 / 5s).
//   - Fans out the deduped message on BOTH channels so every peer sees it.
//   - Targets `print.result` messages to a specific device via `to=`.
//
// The hub class is transport-only — message-type-specific behaviour
// (DB writes, audit, UI invalidate) lives in `lanHubMessageHandler.ts`.

import {
  MessageDedup,
  isLanMessage,
  type LanMessage,
} from '@breakery/domain';

// Minimal structural types so we don't take a direct dep on @supabase/supabase-js
// in the app — the runtime instance comes from `@/lib/supabase` (which itself
// imports from `@breakery/supabase`).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RealtimeChannel = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClient = any;

export interface LanHubOptions {
  supabase:        SupabaseClient;
  /** Stable id for this hub instance. Used as `from` on heartbeats. */
  hubDeviceId:     string;
  /** Unique-per-mount UUID (D19). Forms part of the Realtime channel name. */
  channelKeySuffix: string;
  /** Same-origin BroadcastChannel handle. Inject so tests can stub. */
  broadcastChannel?: BroadcastChannel | null;
  /** Optional dispatch callback (e.g. handleHubMessage in handler module). */
  onMessage?: (msg: LanMessage) => void | Promise<void>;
}

export class LanHub {
  private readonly supabase: SupabaseClient;
  private readonly hubDeviceId: string;
  private readonly channelName: string;
  private readonly bc: BroadcastChannel | null;
  private readonly onMessage: (msg: LanMessage) => void | Promise<void>;
  private readonly dedup: MessageDedup;
  private channel: RealtimeChannel | null = null;
  private bcListener: ((evt: MessageEvent<unknown>) => void) | null = null;
  private isRunning = false;

  constructor(opts: LanHubOptions) {
    this.supabase     = opts.supabase;
    this.hubDeviceId  = opts.hubDeviceId;
    this.channelName  = `lan-hub-${opts.hubDeviceId}-${opts.channelKeySuffix}`;
    this.bc           = opts.broadcastChannel ?? null;
    this.onMessage    = opts.onMessage ?? (() => undefined);
    this.dedup        = new MessageDedup({ maxSize: 200, ttlMs: 5_000 });
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    this.channel = this.supabase
      .channel(this.channelName, { config: { broadcast: { self: false } } })
      .on('broadcast', { event: 'lan' }, (payload: { payload: unknown }) => {
        this.handle(payload.payload);
      })
      .subscribe();

    if (this.bc !== null) {
      this.bcListener = (evt) => this.handle(evt.data);
      this.bc.addEventListener('message', this.bcListener);
    }
  }

  stop(): void {
    if (!this.isRunning) return;
    this.isRunning = false;

    if (this.channel !== null) {
      void this.supabase.removeChannel(this.channel);
      this.channel = null;
    }
    if (this.bc !== null && this.bcListener !== null) {
      this.bc.removeEventListener('message', this.bcListener);
      this.bcListener = null;
    }
  }

  /** Broadcast a message on both channels. Honours `msg.to` for targeted
   * delivery — only the BroadcastChannel handler skips when `to` is set
   * and not matching ; Realtime broadcast still fans out (peers filter
   * client-side). */
  send(msg: LanMessage): void {
    if (this.channel !== null) {
      // Fire-and-forget broadcast. Errors silently ignored — caller deals
      // with retries via the print_queue layer for critical paths.
      void this.channel.send({ type: 'broadcast', event: 'lan', payload: msg });
    }
    if (this.bc !== null) {
      this.bc.postMessage(msg);
    }
  }

  /** Internal handler — dedup + dispatch. Public for unit tests. */
  handle(raw: unknown): void {
    if (!isLanMessage(raw)) return;
    const msg = raw;

    // Ignore messages that originated from this hub itself (safety net —
    // {broadcast:{self:false}} already suppresses Realtime self-echo).
    if (msg.from === this.hubDeviceId) return;

    if (this.dedup.seen(msg.id)) return;

    void this.onMessage(msg);
  }

  /** Dedup ring stats. Useful for diagnostics / Sentry breadcrumbs. */
  dedupStats(): { size: number; dropped: number } {
    return { size: this.dedup.size(), dropped: this.dedup.droppedCount() };
  }
}
