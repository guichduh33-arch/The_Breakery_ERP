// apps/pos/src/pages/Kds.tsx
//
// Session 2 — Kitchen Display System root page.
// Session 14 / Phase 3.A — slimmed to a thin wrapper around `KdsBoard`. The
// page owns the realtime subscription (DO NOT move this into KdsBoard — the
// `useKdsRealtime` hook MUST mount once per station, and the StrictMode
// channel-name uniqueness guarantee in `useKdsRealtime.ts` is wired around
// that contract).
//
// Spec ref: docs/superpowers/specs/2026-05-05-session-2-modifiers-kds-spec.md §4.5
//           docs/workplan/plans/2026-05-14-session-14-INDEX.md §6 (Phase 3.A)

import { useState } from 'react';

import { useKdsStore } from '@/stores/kdsStore';
import { useKdsRealtime } from '@/features/kds/hooks/useKdsRealtime';
import { useReconnectInvalidate } from '@/lib/useReconnectInvalidate';
import { useLanHeartbeat } from '@/features/lan/hooks/useLanHeartbeat';
import { useHubPresence } from '@/features/lan/hooks/useHubPresence';
import { useCloudPing } from '@/features/lan/hooks/useCloudPing';
import { useKdsOfflineBus } from '@/features/kds/hooks/useKdsOfflineBus';
import { usePosSettingsStore } from '@/stores/posSettingsStore';
import { KdsBoard } from '@/features/kds/KdsBoard';

export default function KdsPage() {
  const station = useKdsStore((s) => s.selectedStation);
  // Design Wave C — surface realtime channel health as a board banner. Starts
  // optimistic (true) so a healthy first subscribe never flashes the warning.
  const [realtimeConnected, setRealtimeConnected] = useState(true);
  useKdsRealtime(station, { onConnectionChange: setRealtimeConnected });
  // S57 P2.3 (C-D2) — resync the board after a LAN outage so the kitchen never
  // keeps a stale queue silently (backlog TASK-04-006). Reuses the canonical
  // reconnect net already wired on the other realtime hooks (display, tablet…).
  useReconnectInvalidate([['kds', station]]);
  // Session 59 (21 D1.1) — heartbeat so BO "LAN Devices" reflects this screen
  // as online. No-ops until an operator sets a device code in POS Settings →
  // Devices. Spec 006x lot 1 — also join the LAN hub bus (presence only).
  const deviceCode = usePosSettingsStore((s) => s.deviceCode);
  useLanHeartbeat({ deviceCode, deviceType: 'kds' });
  useHubPresence({ deviceCode, deviceType: 'kds' });
  // Spec 006x lot 3 — détection de coupure internet + tickets par le bus LAN
  // (order.fired / order.item_status, catchup au join).
  useCloudPing();
  useKdsOfflineBus();

  return <KdsBoard station={station} isRealtimeConnected={realtimeConnected} />;
}
