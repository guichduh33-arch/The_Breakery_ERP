import { useEffect } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'sonner';
import { SkipToContent, IdleWarningToast, BrandMark } from '@breakery/ui';
import { queryClient } from './lib/queryClient';
import { AppRoutes } from './routes';
import { ErrorState } from './components/ErrorState';
import { IdleTimeoutMount } from './components/IdleTimeoutMount';
import { useAuthStore } from './stores/authStore';

/** Full-viewport spinner shown while a persisted PIN session rehydrates. */
function BootLoading() {
  return (
    <div className="h-[100dvh] grid place-items-center bg-bg-base" aria-busy="true" aria-live="polite">
      <div className="flex flex-col items-center gap-4 text-text-secondary">
        <BrandMark size="md" />
        <div className="h-6 w-6 rounded-full border-2 border-border-subtle border-t-gold animate-spin" aria-hidden />
        <span className="text-sm uppercase tracking-widest">Chargement…</span>
      </div>
    </div>
  );
}

/**
 * Gates the router behind boot-time rehydration. Without this, a hard reload
 * renders routes and fires queries before the PIN bearer is restored — every
 * Supabase request 401s (anon key only), triggering the empty-state +
 * retry-storm bug. On a fresh load with no persisted session, bootstrap() flips
 * to 'ready' immediately, so /login and the kiosk surfaces aren't delayed.
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
        <Toaster theme="dark" position="top-right" />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
