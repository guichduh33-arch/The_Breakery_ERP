import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'sonner';
import { SkipToContent, useIdleTimeout } from '@breakery/ui';
import { queryClient } from './lib/queryClient';
import { AppRoutes } from './routes';
import { useAuthStore } from './stores/authStore';

/**
 * Session 19 / Phase 3.A — Idle session timeout.
 *
 * Mounted at the App shell level so it's active across every route once a
 * user is authenticated. The timeout (minutes) is sourced from the user's
 * role via auth-get-session ; null/0 disables the hook. On idle expiry we
 * call `logout()`, which clears local state, revokes the server session,
 * and drops the cached bearer token — the next render bounces to /login
 * via the existing <Protected> gate.
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
        <AppRoutes />
        <Toaster theme="dark" position="top-right" />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
