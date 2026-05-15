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

import { useKdsStore } from '@/stores/kdsStore';
import { useKdsRealtime } from '@/features/kds/hooks/useKdsRealtime';
import { KdsBoard } from '@/features/kds/KdsBoard';

export default function KdsPage() {
  const station = useKdsStore((s) => s.selectedStation);
  useKdsRealtime(station);

  return <KdsBoard station={station} />;
}
