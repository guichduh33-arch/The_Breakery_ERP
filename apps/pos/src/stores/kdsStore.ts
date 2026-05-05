// apps/pos/src/stores/kdsStore.ts
//
// Session 2 — KDS station selector store.
// Persisted in safeStorage (sessionStorage on web, Capacitor Preferences on
// native — see packages/utils/src/safeStorage.ts).
//
// Spec ref: docs/superpowers/specs/2026-05-05-session-2-modifiers-kds-spec.md §4.6

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { safeStorage } from '@breakery/utils';
import type { DispatchStation } from '@breakery/domain';

export type KdsStation = Exclude<DispatchStation, 'none'>;

interface KdsState {
  selectedStation: KdsStation;
  setStation: (station: KdsStation) => void;
}

const STORAGE_KEY = 'breakery-kds';

// Wrap safeStorage (object with .get/.set/.remove) into a StateStorage shape
// expected by zustand's createJSONStorage.
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
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => asyncStorage),
    },
  ),
);
