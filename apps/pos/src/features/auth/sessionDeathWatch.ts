// apps/pos/src/features/auth/sessionDeathWatch.ts
//
// Critique 2026-08-14 P1 — the "dead session" regime finally gets a surface.
// Before this, an expired/revoked PIN JWT produced an endless 401 storm with
// no user-visible signal: every query failed silently and the cashier read it
// as "the POS is broken". The offline regime was honest; the auth regime was
// not.
//
// Mechanism: the shared Supabase client reports every 401 that carried a
// bearer token (setSupabaseAuthErrorHandler). When a storm is detected
// (STORM_THRESHOLD hits inside STORM_WINDOW_MS), we probe `auth-get-session`
// once via authStore.validateSession():
//   - probe OK   → the EF re-mints the JWT, the bearer is refreshed, the storm
//                  ends. Fully silent — the cashier never knew.
//   - probe 401  → the PIN session itself is dead. validateSession() locks the
//                  terminal with lockReason 'session_expired' (cart + shift
//                  survive; TerminalLockedOverlay's re-PIN mints a new session).
//   - network    → transient; the offline machinery already covers this.
// A cooldown keeps the probe from hammering the EF while a storm rages.
//
// Kiosk surfaces (KDS/Display/Tablet under kiosk JWT) are excluded: they have
// no PIN session to re-probe (isAuthenticated is false there) and own their
// token lifecycle.

import { setSupabaseAuthErrorHandler } from '@breakery/supabase';
import { useAuthStore } from '@/stores/authStore';

const STORM_WINDOW_MS = 10_000;
const STORM_THRESHOLD = 3;
const PROBE_COOLDOWN_MS = 30_000;

let hits: number[] = [];
let probing = false;
let lastProbeAt = 0;

function onAuthError(): void {
  const s = useAuthStore.getState();
  // No PIN session (kiosk surfaces, pre-login) or already surfaced → ignore.
  if (!s.isAuthenticated || !s.sessionToken || s.isLocked) return;

  const now = Date.now();
  hits = hits.filter((t) => now - t < STORM_WINDOW_MS);
  hits.push(now);
  if (hits.length < STORM_THRESHOLD) return;
  if (probing || now - lastProbeAt < PROBE_COOLDOWN_MS) return;

  probing = true;
  lastProbeAt = now;
  hits = [];
  void useAuthStore
    .getState()
    .validateSession()
    .finally(() => {
      probing = false;
    });
}

/** Register the 401-storm watchdog. Idempotent — safe under StrictMode. */
export function initSessionDeathWatch(): void {
  setSupabaseAuthErrorHandler(onAuthError);
}

/** Unregister and reset (unmount / tests). */
export function disposeSessionDeathWatch(): void {
  setSupabaseAuthErrorHandler(null);
  hits = [];
  probing = false;
  lastProbeAt = 0;
}
