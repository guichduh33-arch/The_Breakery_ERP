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

  // Audit 2026-08-24 (a11y P1) — role="alert" sur un texte qui change chaque
  // seconde faisait ré-annoncer le toast 30 fois d'affilée, pendant la fenêtre
  // où l'utilisateur devait justement cliquer « Stay signed in ». L'alerte
  // s'annonce UNE fois (message stable) ; le compteur visuel vit dans un span
  // aria-hidden. border-warning pleine : /40 était une classe morte (alpha
  // impossible sur token var() nu) — le toast n'avait AUCUNE bordure.
  return (
    <div
      data-testid="idle-warning-toast"
      className={
        className ??
        'fixed top-4 right-4 z-50 flex items-center gap-3 rounded border border-warning bg-warning-soft px-4 py-3 text-sm text-warning shadow-lg'
      }
    >
      <span role="alert">Session is about to expire.</span>
      <span data-testid="idle-countdown" aria-hidden>
        {secondsLeft}s
      </span>
      <button
        type="button"
        onClick={handleStay}
        data-testid="idle-stay-button"
        className="rounded bg-gold px-3 py-1 text-xs font-semibold text-gold-fg hover:bg-gold-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
      >
        Stay signed in
      </button>
    </div>
  );
}
