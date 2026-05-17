// packages/ui/src/components/IdleWarningToast.tsx
// Session 21 / Phase 1.C.2 — Idle-session warning toast.
//
// Listens for CustomEvent `idle:warning` (dispatched by useIdleTimeout 30s
// before firing) and renders a persistent fixed-position banner with a
// live countdown. A "Stay signed in" button dispatches `idle:reset` which
// restarts the useIdleTimeout timer and hides the toast.
//
// On `idle:fired` the toast is hidden (the app handles the actual sign-out).
//
// Mount once near the root of POS and BO layouts (alongside <Toaster />).
// Renders null when inactive — no DOM overhead on normal usage.

import { useEffect, useState, useRef, type JSX } from 'react';
import { IDLE_WARNING_LEAD_MS } from '../hooks/useIdleTimeout.js';

const WARNING_SECONDS = Math.round(IDLE_WARNING_LEAD_MS / 1000);

export interface IdleWarningToastProps {
  /** Optional class name override for the toast container. */
  className?: string;
}

/**
 * Persistent warning banner that appears 30s before idle logout.
 * "Stay signed in" button dispatches `idle:reset` to restart the timer.
 */
export function IdleWarningToast({ className }: IdleWarningToastProps): JSX.Element | null {
  const [visible, setVisible] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(WARNING_SECONDS);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const clearCountdown = (): void => {
      if (countdownRef.current !== null) {
        clearInterval(countdownRef.current);
        countdownRef.current = null;
      }
    };

    const handleWarning = (): void => {
      setSecondsLeft(WARNING_SECONDS);
      setVisible(true);
      clearCountdown();
      countdownRef.current = setInterval(() => {
        setSecondsLeft((s) => {
          if (s <= 1) {
            clearCountdown();
            return 0;
          }
          return s - 1;
        });
      }, 1_000);
    };

    const handleFired = (): void => {
      clearCountdown();
      setVisible(false);
    };

    window.addEventListener('idle:warning', handleWarning);
    window.addEventListener('idle:fired', handleFired);

    return (): void => {
      clearCountdown();
      window.removeEventListener('idle:warning', handleWarning);
      window.removeEventListener('idle:fired', handleFired);
    };
  }, []);

  if (!visible) return null;

  const handleStay = (): void => {
    window.dispatchEvent(new CustomEvent('idle:reset'));
    setVisible(false);
    if (countdownRef.current !== null) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
  };

  return (
    <div
      role="alert"
      aria-live="assertive"
      data-testid="idle-warning-toast"
      className={
        className ??
        'fixed top-4 right-4 z-50 flex items-center gap-3 rounded border border-amber-400 bg-amber-50 px-4 py-3 text-sm text-amber-900 shadow-lg'
      }
    >
      <span data-testid="idle-countdown">
        Session expires in {secondsLeft}s
      </span>
      <button
        type="button"
        onClick={handleStay}
        data-testid="idle-stay-button"
        className="rounded bg-amber-600 px-3 py-1 text-xs font-semibold text-white hover:bg-amber-700 focus:outline-none focus:ring-2 focus:ring-amber-500"
      >
        Stay signed in
      </button>
    </div>
  );
}
