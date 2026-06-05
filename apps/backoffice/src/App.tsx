import { useEffect } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { SkipToContent, Toaster, useIdleTimeout, IdleWarningToast, BrandMark } from '@breakery/ui';
import { queryClient } from './lib/queryClient.js';
import { AppRoutes } from './routes/index.js';
import { ErrorState } from './components/ErrorState.js';
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

/** Full-viewport spinner shown while the persisted session is rehydrating. */
function BootLoading() {
  return (
    <div className="min-h-screen grid place-items-center bg-bg-base" aria-busy="true" aria-live="polite">
      <div className="flex flex-col items-center gap-4 text-text-secondary">
        <BrandMark size="md" />
        <div className="h-6 w-6 rounded-full border-2 border-border-subtle border-t-gold animate-spin" aria-hidden />
        <span className="text-sm uppercase tracking-widest">Chargement…</span>
      </div>
    </div>
  );
}

/**
 * Gates the router behind boot-time session rehydration. Without this, a hard
 * reload renders the routes/sidebar against an empty permission list before
 * `auth-get-session` lands — the guards then redirect to /backoffice and the
 * sidebar collapses to Dashboard + Products (the reported reload bug).
 *
 * Three states: loading (spinner) / error (retry + sign out) / ready (routes).
 */
function BootGate({ children }: { children: React.ReactNode }) {
  const status = useAuthStore((s) => s.bootstrapStatus);
  const bootstrap = useAuthStore((s) => s.bootstrap);
  const logout = useAuthStore((s) => s.logout);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  if (status === 'pending' || status === 'loading') return <BootLoading />;
  if (status === 'error') {
    return (
      <ErrorState
        fullScreen
        title="Connexion au serveur impossible"
        description="Impossible de restaurer votre session. Vérifiez votre connexion réseau puis réessayez."
        onRetry={() => void bootstrap()}
        secondaryAction={{ label: 'Se déconnecter', onClick: () => void logout() }}
      />
    );
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        {/* a11y: keyboard users tab here first to jump past nav chrome. */}
        <SkipToContent />
        <IdleTimeoutMount />
        {/* S21 / 1.C.2 — idle warning overlay (DEV-S19-3.A-01) */}
        <IdleWarningToast />
        <BootGate>
          <AppRoutes />
        </BootGate>
        <Toaster />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
