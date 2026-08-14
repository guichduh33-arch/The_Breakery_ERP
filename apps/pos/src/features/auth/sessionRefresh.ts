// apps/pos/src/features/auth/sessionRefresh.ts
//
// Backlog 401 — proactive PIN-JWT refresh.
//
// The PIN JWT lives ~60 min and the shared client runs `autoRefreshToken:
// false` (session lifecycle is owned by the auth-* EFs, not GoTrue). Until
// now only the kiosk surfaces had a refresh timer (useKioskAuth) — a PIN
// session just let its JWT die, producing a 401 burst that the reactive
// watchdog (sessionDeathWatch) then had to repair mid-storm.
//
// Mechanism, mirror of the kiosk timer: schedule one `validateSession()`
// probe REFRESH_SAFETY_MARGIN_MS before `authExpiresAt`. The probe hits
// `auth-get-session`, which re-mints the JWT; authStore refreshes the bearer
// and `authExpiresAt`, and the store subscription reschedules the next tick.
// Failure modes:
//   - network (transient)   → authExpiresAt unchanged → retry every
//                             MIN_DELAY_MS until the JWT is refreshed or dies.
//   - probe 401             → validateSession() locks the terminal with
//                             lockReason 'session_expired' ; the timer stays
//                             off until the overlay's re-PIN mints a session.
// Kiosk surfaces are excluded (no PIN session — isAuthenticated is false ;
// they own their token lifecycle). A legacy EF that doesn't re-mint returns
// no expiry — the timer stays off and the reactive watchdog remains the net.

import { useAuthStore } from '@/stores/authStore';

// Same margin as kioskAuth: absorbs clock skew + gives the retry loop a
// 10-minute runway before the JWT actually dies.
const REFRESH_SAFETY_MARGIN_MS = 10 * 60 * 1000;
// Floor between two probes — the retry cadence inside the runway, and a
// guard against a tight loop on a skewed clock.
const MIN_DELAY_MS = 60_000;

let timer: ReturnType<typeof setTimeout> | null = null;
let unsubscribe: (() => void) | null = null;
let probing = false;

function clearTimer(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}

function schedule(): void {
  clearTimer();
  const s = useAuthStore.getState();
  if (!s.isAuthenticated || !s.sessionToken || s.authExpiresAt === null) return;
  // Dead session already surfaced — probing again would only re-set the same
  // lock. The re-PIN path (login) refreshes authExpiresAt and reschedules.
  if (s.lockReason === 'session_expired') return;

  const target = s.authExpiresAt * 1000 - REFRESH_SAFETY_MARGIN_MS;
  const delay = Math.max(target - Date.now(), MIN_DELAY_MS);
  timer = setTimeout(() => {
    void fire();
  }, delay);
}

async function fire(): Promise<void> {
  if (probing) return;
  const s = useAuthStore.getState();
  if (!s.isAuthenticated || !s.sessionToken) return;
  probing = true;
  try {
    // Re-mints the bearer on success ; locks the terminal on a server 401 ;
    // keeps local state on a network blip. All three are handled in the store.
    await s.validateSession();
  } finally {
    probing = false;
    // On success authExpiresAt moved → next tick lands ~50 min out. On a
    // transient failure it didn't → the MIN_DELAY_MS clamp turns this into a
    // 1/min retry inside the runway. On session death the lockReason guard
    // stops the timer.
    schedule();
  }
}

/** Start the proactive refresh scheduler. Idempotent — safe under StrictMode. */
export function initSessionRefresh(): void {
  unsubscribe ??= useAuthStore.subscribe((state, prev) => {
    if (
      state.authExpiresAt !== prev.authExpiresAt ||
      state.isAuthenticated !== prev.isAuthenticated ||
      state.lockReason !== prev.lockReason
    ) {
      schedule();
    }
  });
  schedule();
}

/** Stop the scheduler and drop the subscription (unmount / tests). */
export function disposeSessionRefresh(): void {
  clearTimer();
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  probing = false;
}
