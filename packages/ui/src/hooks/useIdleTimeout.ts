// packages/ui/src/hooks/useIdleTimeout.ts
// Session 19 / Phase 3.A — Idle session timeout hook (Thread B).
// Session 21 / Phase 1.C.2 — warn 30s before fire via idle:warning CustomEvent.
//
// Mounts on POS + BO root. Listens for user activity events and signs out
// after `timeoutMinutes` of inactivity. timeoutMinutes is read from the
// current user's role (roles.session_timeout_minutes, Phase 1.B).
//
// Decision refs : D7 (lives in packages/ui), D8 (per-role authoritative).
//
// S21 additions :
//   - Dispatches `idle:warning` CustomEvent 30s before firing (detail: { remainingMs: 30_000 }).
//   - Dispatches `idle:fired` CustomEvent when the timeout actually fires.
//   - Listens for `idle:reset` CustomEvent to restart the timer (e.g. from IdleWarningToast).
// WARNING_LEAD_MS is only applied when the timeout is > 30s; for very short
// timeouts (testing) the warning fires at t=0 alongside the main timer.

import { useEffect, useRef } from 'react';

const DEFAULT_EVENTS: ReadonlyArray<string> = [
  'mousedown', 'keydown', 'touchstart', 'scroll',
];

/** Lead time before the main timeout when the `idle:warning` event is dispatched. */
export const IDLE_WARNING_LEAD_MS = 30_000;

export interface UseIdleTimeoutArgs {
  timeoutMinutes: number;
  onTimeout: () => void;
  events?: ReadonlyArray<string>;
}

/**
 * Fires `onTimeout` after `timeoutMinutes` of user inactivity.
 *
 * Activity is detected via the events list (defaults : mousedown, keydown,
 * touchstart, scroll — registered with `{ passive: true }`). Every activity
 * resets the pending timer. The latest `onTimeout` callback is captured via
 * a ref so the timer doesn't have to be rebuilt when the caller passes an
 * inline closure.
 *
 * S21 : 30s before firing, dispatches `window.CustomEvent('idle:warning', { detail: { remainingMs: 30_000 } })`.
 * On fire, dispatches `idle:fired`. Listens for `idle:reset` to restart the timer
 * (used by IdleWarningToast "Stay signed in" button).
 *
 * No-op when `timeoutMinutes <= 0` (e.g. role not yet hydrated, or user
 * explicitly disabled idle logout). Cleans up on unmount.
 */
export function useIdleTimeout({
  timeoutMinutes,
  onTimeout,
  events = DEFAULT_EVENTS,
}: UseIdleTimeoutArgs): void {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onTimeoutRef = useRef(onTimeout);

  useEffect(() => {
    onTimeoutRef.current = onTimeout;
  }, [onTimeout]);

  useEffect(() => {
    if (!timeoutMinutes || timeoutMinutes <= 0) return;

    const totalMs = timeoutMinutes * 60_000;

    const clearTimers = (): void => {
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
      if (warnTimerRef.current) { clearTimeout(warnTimerRef.current); warnTimerRef.current = null; }
    };

    const reset = (): void => {
      clearTimers();

      // Schedule warning 30s before the main fire (only if there is room).
      const warnDelay = Math.max(0, totalMs - IDLE_WARNING_LEAD_MS);
      warnTimerRef.current = setTimeout(() => {
        window.dispatchEvent(
          new CustomEvent('idle:warning', { detail: { remainingMs: IDLE_WARNING_LEAD_MS } }),
        );
      }, warnDelay);

      // Schedule main fire.
      timerRef.current = setTimeout(() => {
        window.dispatchEvent(new CustomEvent('idle:fired'));
        onTimeoutRef.current();
      }, totalMs);
    };

    // Listen for "stay signed in" button click from IdleWarningToast.
    const handleReset = (): void => { reset(); };

    reset();
    for (const ev of events) {
      window.addEventListener(ev, reset, { passive: true });
    }
    window.addEventListener('idle:reset', handleReset);

    return (): void => {
      clearTimers();
      for (const ev of events) {
        window.removeEventListener(ev, reset);
      }
      window.removeEventListener('idle:reset', handleReset);
    };
  }, [timeoutMinutes, events]);
}
