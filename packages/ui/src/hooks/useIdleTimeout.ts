// packages/ui/src/hooks/useIdleTimeout.ts
// Session 19 / Phase 3.A — Idle session timeout hook (Thread B).
//
// Mounts on POS + BO root. Listens for user activity events and signs out
// after `timeoutMinutes` of inactivity. timeoutMinutes is read from the
// current user's role (roles.session_timeout_minutes, Phase 1.B).
//
// Decision refs : D7 (lives in packages/ui), D8 (per-role authoritative).

import { useEffect, useRef } from 'react';

const DEFAULT_EVENTS: ReadonlyArray<string> = [
  'mousedown', 'keydown', 'touchstart', 'scroll',
];

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
 * No-op when `timeoutMinutes <= 0` (e.g. role not yet hydrated, or user
 * explicitly disabled idle logout). Cleans up on unmount.
 */
export function useIdleTimeout({
  timeoutMinutes,
  onTimeout,
  events = DEFAULT_EVENTS,
}: UseIdleTimeoutArgs): void {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onTimeoutRef = useRef(onTimeout);

  useEffect(() => {
    onTimeoutRef.current = onTimeout;
  }, [onTimeout]);

  useEffect(() => {
    if (!timeoutMinutes || timeoutMinutes <= 0) return;

    const reset = (): void => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        onTimeoutRef.current();
      }, timeoutMinutes * 60_000);
    };

    reset();
    for (const ev of events) {
      window.addEventListener(ev, reset, { passive: true });
    }

    return (): void => {
      if (timerRef.current) clearTimeout(timerRef.current);
      for (const ev of events) {
        window.removeEventListener(ev, reset);
      }
    };
  }, [timeoutMinutes, events]);
}
