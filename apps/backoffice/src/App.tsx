import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { SkipToContent, Toaster, useIdleTimeout, IdleWarningToast } from '@breakery/ui';
import { queryClient } from './lib/queryClient.js';
import { AppRoutes } from './routes/index.js';
import { useAuthStore } from './stores/authStore.js';

/**
 * Session 19 / Phase 3.A — Idle session timeout.
 *
 * Mounted at the App shell so it covers every route once the operator is
 * authenticated. The timeout is sourced from the user's role via
 * auth-get-session (`session_timeout_minutes`). On idle expiry we call
 * `logout()`, which revokes the server session and clears local state —
 * the next render bounces to /login through the existing <Protected> gate.
 */
function IdleTimeoutMount() {
  const timeoutMinutes = useAuthStore((s) => (s.isAuthenticated ? s.sessionTimeoutMinutes ?? 0 : 0));
  const logout = useAuthStore((s) => s.logout);
  useIdleTimeout({ timeoutMinutes, onTimeout: logout });
  return null;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        {/* a11y: keyboard users tab here first to jump past nav chrome. */}
        <SkipToContent />
        <IdleTimeoutMount />
        {/* S21 / 1.C.2 — idle warning overlay (DEV-S19-3.A-01) */}
        <IdleWarningToast />
        <AppRoutes />
        <Toaster />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
