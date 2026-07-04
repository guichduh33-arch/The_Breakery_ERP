// apps/pos/src/features/kds/hooks/useKdsAlarm.ts
//
// Session 59 (fiche 04 D1.3 / B1.3-B1.4) — plays a short WebAudio beep the
// moment a brand-new order lands on the board (no external asset).
//
// Dedup rule: alerting is keyed on `order_id`, tracked in a ref (not state,
// so it survives re-renders without re-running the effect body twice under
// StrictMode in a way that double-fires audio). Each order is beeped at most
// once — a later realtime/poll refetch that returns the same order again
// does NOT re-sound the alarm. The very first render (tickets already on
// the board when the hook mounts) seeds the "seen" set silently so opening
// the KDS never blasts one beep per existing ticket.
//
// Muting is delegated to the persisted `kdsStore.alarmMuted` toggle — a
// muted order is still marked "seen" so unmuting later doesn't retroactively
// alert for orders that arrived while muted.
//
// Session 59 review (finding 2) — a freshly-loaded KDS (no prior user
// gesture) starts its AudioContext `suspended`; calling `.start()` on a
// suspended context is a silent no-op, so the very first order of a shift
// would beep... nothing. We attempt `ctx.resume()` first and only emit the
// tone once the context is actually running. If resume() itself rejects
// (autoplay policy still blocking), we log once (not per-order) and give up
// silently — no retry loop, no UI change.

import { useEffect, useRef } from 'react';

import { useKdsStore } from '@/stores/kdsStore';
import type { KdsItemRow } from './useKdsOrders';

let hasWarnedAutoplayBlocked = false;

function emitTone(ctx: AudioContext): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = 880;
  gain.gain.value = 0.15;
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.18);
  osc.onended = () => {
    void ctx.close();
  };
}

function playBeep(): void {
  const AudioCtx =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return;

  const ctx = new AudioCtx();

  if (ctx.state === 'suspended') {
    ctx
      .resume()
      .then(() => emitTone(ctx))
      .catch(() => {
        if (!hasWarnedAutoplayBlocked) {
          hasWarnedAutoplayBlocked = true;
          console.warn(
            '[useKdsAlarm] AudioContext.resume() failed — the new-order alarm ' +
              'stays silent until a user gesture (tap/click) unlocks audio.',
          );
        }
      });
    return;
  }

  emitTone(ctx);
}

export function useKdsAlarm(items: KdsItemRow[]): void {
  const muted = useKdsStore((s) => s.alarmMuted);
  const seenOrderIdsRef = useRef<Set<string> | null>(null);

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
      playBeep();
    }
  }, [items, muted]);
}
