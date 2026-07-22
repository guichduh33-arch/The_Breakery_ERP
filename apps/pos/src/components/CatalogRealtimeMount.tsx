// apps/pos/src/components/CatalogRealtimeMount.tsx
//
// ADR-011 décision 3 — mounts the catalog realtime propagation at the App
// shell (mirror of SettingsRealtimeMount) so every PIN-authenticated POS
// route — counter and tablet alike — picks up BO catalog changes in push.
//
// Gated on bootstrapStatus === 'ready' AND isAuthenticated: subscribing
// before the persisted PIN bearer is restored would join the channel as anon
// (RLS filters every event → dead subscription). Flipping the gate re-arms
// the effect, so login/logout re-subscribes with the fresh token.

import { useCatalogRealtime } from '@/features/products/hooks/useCatalogRealtime';
import { useAuthStore } from '@/stores/authStore';

export function CatalogRealtimeMount(): null {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const bootstrapStatus = useAuthStore((s) => s.bootstrapStatus);

  useCatalogRealtime(bootstrapStatus === 'ready' && isAuthenticated);

  return null;
}
