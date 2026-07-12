// apps/pos/src/features/kds/hooks/useKdsAlarm.ts
//
// Session 59 (fiche 04 D1.3 / B1.3-B1.4) — plays a short WebAudio motif the
// moment a brand-new order lands on the board (no external asset).
//
// Design Wave C (2026-07-07) — the single flat 880 Hz beep was too easy to
// miss across a noisy kitchen, so it becomes:
//   • a louder, distinctive TWO-note rising motif for a brand-new order, and
//   • a periodic, more insistent TRIPLE-note re-bip that keeps sounding every
//     REBEEP_INTERVAL_MS as long as an URGENT order is still sitting unbumped
//     (age past the 600 s urgent band, at least one live pending/preparing
//     item). The re-bip stops the instant the order is bumped/served or the
//     board clears — it is derived from the live `items`, never a standalone
//     timer that outlives the ticket.
//
// Dedup rule (UNCHANGED): the NEW-ORDER alert is keyed on `order_id`, tracked
// in a ref (not state, so it survives re-renders without double-firing under
// StrictMode). Each order is beeped at most once — a later realtime/poll
// refetch that returns the same order again does NOT re-sound the new-order
// motif. The very first render (tickets already on the board when the hook
// mounts) seeds the "seen" set silently so opening the KDS never blasts one
// beep per existing ticket. The URGENT re-bip is a SEPARATE channel and is
// intentionally NOT deduped — its whole point is to nag until handled.
//
// Muting is delegated to the persisted `kdsStore.alarmMuted` toggle and
// respected by BOTH channels — a muted order is still marked "seen" so
// unmuting later doesn't retroactively alert for orders that arrived while
// muted.
//
// Session 59 review (finding 2) — a freshly-loaded KDS (no prior user
// gesture) starts its AudioContext `suspended`; calling `.start()` on a
// suspended context is a silent no-op, so the very first order of a shift
// would beep... nothing. We attempt `ctx.resume()` first and only emit the
// tones once the context is actually running. If resume() itself rejects
// (autoplay policy still blocking), we log once (not per-order) and give up
// silently — no retry loop, no UI change.

import { useEffect, useRef } from 'react';

import { useKdsStore } from '@/stores/kdsStore';
import { useKdsConfig } from './useKdsConfig';
import type { KdsItemRow } from './useKdsOrders';

/** How often the urgent re-bip fires while an unbumped urgent order lingers.
 *  Short enough to stay noticed during a rush, long enough not to be torture. */
const REBEEP_INTERVAL_MS = 25 * 1_000;

let hasWarnedAutoplayBlocked = false;

interface ToneSpec {
  /** Oscillator frequency in Hz. */
  freq: number;
  /** Start offset from now, in seconds. */
  start: number;
  /** Note length in seconds. */
  duration: number;
}

/** New order — a bright two-note rising "ta-da" (A5 → E6). Distinct from the
 *  urgent triple, and pleasant enough to fire on every incoming ticket. */
const NEW_ORDER_MOTIF: ToneSpec[] = [
  { freq: 880, start: 0, duration: 0.14 },
  { freq: 1318.51, start: 0.16, duration: 0.2 },
];
const NEW_ORDER_GAIN = 0.3;

/** Urgent re-bip — three insistent same-pitch pulses (B5). Louder and more
 *  staccato than the new-order motif so it reads as "act now", not "new". */
const URGENT_MOTIF: ToneSpec[] = [
  { freq: 987.77, start: 0, duration: 0.12 },
  { freq: 987.77, start: 0.18, duration: 0.12 },
  { freq: 987.77, start: 0.36, duration: 0.16 },
];
const URGENT_GAIN = 0.42;

/** Schedule every tone of a motif on the given (running) context and close it
 *  once the last tone has ended. One oscillator + gain node per tone. */
function emitMotif(ctx: AudioContext, motif: ToneSpec[], peakGain: number): void {
  let lastOsc: OscillatorNode | null = null;
  let lastEnd = Number.NEGATIVE_INFINITY;

  for (const tone of motif) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = tone.freq;
    gain.gain.value = peakGain;
    osc.connect(gain);
    gain.connect(ctx.destination);

    const startAt = ctx.currentTime + tone.start;
    const endAt = startAt + tone.duration;
    osc.start(startAt);
    osc.stop(endAt);

    if (endAt >= lastEnd) {
      lastEnd = endAt;
      lastOsc = osc;
    }
  }

  if (lastOsc) {
    lastOsc.onended = () => {
      void ctx.close();
    };
  }
}

/** Create a context (resuming if the autoplay policy suspended it) and play
 *  the motif. Silent, logged-once no-op if audio can't be unlocked. */
function playMotif(motif: ToneSpec[], peakGain: number): void {
  const AudioCtx =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return;

  const ctx = new AudioCtx();

  if (ctx.state === 'suspended') {
    ctx
      .resume()
      .then(() => emitMotif(ctx, motif, peakGain))
      .catch(() => {
        if (!hasWarnedAutoplayBlocked) {
          hasWarnedAutoplayBlocked = true;
          console.warn(
            '[useKdsAlarm] AudioContext.resume() failed — the KDS alarm ' +
              'stays silent until a user gesture (tap/click) unlocks audio.',
          );
        }
      });
    return;
  }

  emitMotif(ctx, motif, peakGain);
}

/** True when at least one order is past the urgent age band AND still has a
 *  live (non-cancelled, pending/preparing) item — i.e. not yet bumped. */
function hasUrgentUnbumpedOrder(items: KdsItemRow[], now: number, urgentMs: number): boolean {
  const oldestByOrder = new Map<string, number>();
  const liveByOrder = new Map<string, boolean>();

  for (const item of items) {
    const sentAt = new Date(item.sent_to_kitchen_at).getTime();
    if (Number.isFinite(sentAt)) {
      const prev = oldestByOrder.get(item.order_id);
      if (prev === undefined || sentAt < prev) oldestByOrder.set(item.order_id, sentAt);
    }
    const isLive =
      !item.is_cancelled &&
      (item.kitchen_status === 'pending' || item.kitchen_status === 'preparing');
    if (isLive) liveByOrder.set(item.order_id, true);
  }

  for (const [orderId, oldest] of oldestByOrder) {
    if (liveByOrder.get(orderId) && now - oldest >= urgentMs) {
      return true;
    }
  }
  return false;
}

export function useKdsAlarm(items: KdsItemRow[]): void {
  const muted = useKdsStore((s) => s.alarmMuted);
  const { urgentMs } = useKdsConfig();
  const seenOrderIdsRef = useRef<Set<string> | null>(null);

  // Latest snapshots read by the interval below without re-arming it.
  const itemsRef = useRef(items);
  const mutedRef = useRef(muted);
  const urgentMsRef = useRef(urgentMs);
  itemsRef.current = items;
  mutedRef.current = muted;
  urgentMsRef.current = urgentMs;

  // Channel 1 — one motif per newly-arrived order (deduped by order_id).
  useEffect(() => {
    const currentIds = new Set(items.map((item) => item.order_id));

    if (seenOrderIdsRef.current === null) {
      // First run — seed without alerting so existing tickets never beep.
      seenOrderIdsRef.current = currentIds;
      return;
    }

    const seen = seenOrderIdsRef.current;
    let hasNewOrder = false;
    for (const id of currentIds) {
      if (!seen.has(id)) {
        seen.add(id);
        hasNewOrder = true;
      }
    }

    if (hasNewOrder && !muted) {
      playMotif(NEW_ORDER_MOTIF, NEW_ORDER_GAIN);
    }
  }, [items, muted]);

  // Channel 2 — periodic urgent re-bip while an unbumped urgent order lingers.
  // Armed once; reads live state via refs so it never restarts on every render.
  useEffect(() => {
    const id = setInterval(() => {
      if (mutedRef.current) return;
      if (hasUrgentUnbumpedOrder(itemsRef.current, Date.now(), urgentMsRef.current)) {
        playMotif(URGENT_MOTIF, URGENT_GAIN);
      }
    }, REBEEP_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);
}
