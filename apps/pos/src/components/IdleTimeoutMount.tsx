// apps/pos/src/components/IdleTimeoutMount.tsx
//
// Session 19 / Phase 3.A — Idle session timeout, mounted at the App shell so
// it's active across every route once a user is authenticated. The timeout
// (minutes) is sourced from the user's role via auth-get-session ; null/0
// disables the hook.
//
// S36 / DEV-S36-C-01 — on idle expiry we now LOCK the terminal (session-
// preserving) instead of logging out. lock() keeps the open shift + the cart
// intact; <TerminalLockedOverlay> handles the re-PIN. This is a ratified
// reversal of the S35 "manual lock only — no idle→lock rewire" decision:
// lock() > signOut() operationally (no lost cash shift on a brief idle). POS
// only — the BackOffice keeps logout-on-idle (no cash shift to preserve).

import { useIdleTimeout } from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore';

export function IdleTimeoutMount(): null {
  const timeoutMinutes = useAuthStore((s) => (s.isAuthenticated ? s.sessionTimeoutMinutes ?? 0 : 0));
  useIdleTimeout({
    timeoutMinutes,
    onTimeout: () => {
      // Guard against locking an unauthenticated store (e.g. the login screen).
      if (useAuthStore.getState().isAuthenticated) useAuthStore.getState().lock();
    },
  });
  return null;
}
