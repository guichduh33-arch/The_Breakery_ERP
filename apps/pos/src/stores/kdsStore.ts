// apps/pos/src/stores/kdsStore.ts
//
// Session 2 — KDS station selector store.
// Persisted in safeStorage (sessionStorage on web, Capacitor Preferences on
// native — see packages/utils/src/safeStorage.ts).
//
// Session 13 / Phase 4.B — adds a CLIENT-SIDE station filter on top of the
// legacy `dispatch_station` selection. `kdsStationFilter` maps to the new
// `categories.kds_station` column (hot|cold|bar|prep|expo) and is applied
// after the realtime query returns (server still filters by
// `dispatch_station`, which is indexed and has its own NOT NULL/CHECK).
//
// Spec ref: docs/superpowers/specs/2026-05-05-session-2-modifiers-kds-spec.md §4.6
//           docs/workplan/plans/2026-05-13-session-13-phase-4.B-kds-ext.md §4

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { safeStorage } from '@breakery/utils';
import type { DispatchStation } from '@breakery/domain';

export type KdsStation = Exclude<DispatchStation, 'none'>;

/** Phase 4.B — granular station filter (UI-side). 'all' shows everything. */
export type KdsStationFilter = 'all' | 'hot' | 'cold' | 'bar' | 'prep' | 'expo';

interface KdsState {
  selectedStation: KdsStation;
  setStation: (station: KdsStation) => void;
  /** Phase 4.B — client-side filter on order_items joined to categories.kds_station. */
  kdsStationFilter: KdsStationFilter;
  setKdsStationFilter: (filter: KdsStationFilter) => void;
}

const STORAGE_KEY = 'breakery-kds';

const asyncStorage = {
  getItem: (name: string) => safeStorage.get(name),
  setItem: (name: string, value: string) => safeStorage.set(name, value),
  removeItem: (name: string) => safeStorage.remove(name),
};

export const useKdsStore = create<KdsState>()(
  persist(
    (set) => ({
      selectedStation: 'kitchen',
      setStation: (station) => set({ selectedStation: station }),
      kdsStationFilter: 'all',
      setKdsStationFilter: (filter) => set({ kdsStationFilter: filter }),
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => asyncStorage),
    },
  ),
);
