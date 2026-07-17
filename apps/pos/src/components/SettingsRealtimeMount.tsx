// apps/pos/src/components/SettingsRealtimeMount.tsx
//
// Settings §6.C (ADR-006 décision 4) — mounts the settings realtime
// propagation at the App shell (mirror of IdleTimeoutMount /
// PosEventOutboxMount) so every PIN-authenticated POS route — counter,
// tablet and KDS alike — picks up BO settings changes in push.
//
// Gated on bootstrapStatus === 'ready' AND isAuthenticated: subscribing
// before the persisted PIN bearer is restored would join the channel as anon
// (RLS filters every event → dead subscription). Flipping the gate re-arms
// the effect, so login/logout re-subscribes with the fresh token. The kiosk
// customer-display surface has its own mount (CustomerDisplayPage), keyed on
// its kiosk JWT lifecycle instead.

import { useSettingsRealtime } from '@/features/settings/hooks/useSettingsRealtime';
import { useAuthStore } from '@/stores/authStore';

export function SettingsRealtimeMount(): null {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const bootstrapStatus = useAuthStore((s) => s.bootstrapStatus);

  useSettingsRealtime(bootstrapStatus === 'ready' && isAuthenticated);

  return null;
}
