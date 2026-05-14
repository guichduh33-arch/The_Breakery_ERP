// apps/pos/src/features/lan/lanClient.ts
//
// Session 13 / Phase 5.A — LAN client peer (D4 hybrid transport).
//
// A LAN client subscribes to messages on both channels (BroadcastChannel
// + Supabase Realtime), dedupes by `id`, and surfaces them via the
// `onMessage` callback. It also exposes `send(msg)` to publish messages.
//
// Each peer has a stable `deviceId` (a UUID stored in localStorage by the
// caller — see `useLanClient`). The deviceId is embedded in the Realtime
// channel name to keep it unique-per-mount under StrictMode (D19).

import {
  MessageDedup,
  isLanMessage,
  type LanMessage,
} from '@breakery/domain';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RealtimeChannel = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClient = any;

export interface LanClientOptions {
  supabase: SupabaseClient;
  /** Stable device id (UUID). */
  deviceId: string;
  /** Unique-per-mount UUID (D19). */
  channelKeySuffix: string;
  /** Optional BroadcastChannel for intra-tab traffic. */
  broadcastChannel?: BroadcastChannel | null;
  /** Dispatch callback. */
  onMessage?: (msg: LanMessage) => void | Promise<void>;
}

export class LanClient {
  private readonly supabase: SupabaseClient;
  private readonly deviceId: string;
  private readonly channelName: string;
  private readonly bc: BroadcastChannel | null;
  private readonly onMessage: (msg: LanMessage) => void | Promise<void>;
  private readonly dedup: MessageDedup;
  private channel: RealtimeChannel | null = null;
  private bcListener: ((evt: MessageEvent<unknown>) => void) | null = null;
  private isRunning = false;

  constructor(opts: LanClientOptions) {
    this.supabase    = opts.supabase;
    this.deviceId    = opts.deviceId;
    this.channelName = `lan-client-${opts.deviceId}-${opts.channelKeySuffix}`;
    this.bc          = opts.broadcastChannel ?? null;
    this.onMessage   = opts.onMessage ?? (() => undefined);
    this.dedup       = new MessageDedup({ maxSize: 200, ttlMs: 5_000 });
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    // Same channel name pattern as the hub but with `lan-client-` prefix.
    // Both the hub and clients listen on the global 'lan' Realtime channel
    // (peers share one broadcast room). We use a per-device channel name
    // so the channel object is unique per mount (D19) — Supabase
    // broadcast hits the topic, not the name.
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

  send(msg: LanMessage): void {
    if (this.channel !== null) {
      void this.channel.send({ type: 'broadcast', event: 'lan', payload: msg });
    }
    if (this.bc !== null) {
      this.bc.postMessage(msg);
    }
  }

  handle(raw: unknown): void {
    if (!isLanMessage(raw)) return;
    const msg = raw;

    // Drop self-emitted messages.
    if (msg.from === this.deviceId) return;

    // Drop messages targeted to a different device.
    if (msg.to !== undefined && msg.to !== this.deviceId) return;

    if (this.dedup.seen(msg.id)) return;

    void this.onMessage(msg);
  }

  dedupStats(): { size: number; dropped: number } {
    return { size: this.dedup.size(), dropped: this.dedup.droppedCount() };
  }
}
