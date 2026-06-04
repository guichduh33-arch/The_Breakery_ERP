// apps/pos/src/stores/posSettingsStore.ts
//
// Session 35 (F-009) — per-terminal POS print settings, persisted to
// localStorage under `pos:settings`. Holds the print-server URL plus the
// auto-print / auto-open-drawer toggles read later by `printService` and
// `SuccessModal`. Per-terminal config (localStorage is device-scoped).
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export interface PosSettingsState {
  printerUrl: string;        // '' = fall back to VITE_PRINT_SERVER_URL then localhost:3001
  autoPrint: boolean;        // auto-print receipt on SuccessModal mount
  autoOpenDrawer: boolean;   // auto-pop the cash drawer (cash payments)
  setPrinterUrl: (url: string) => void;
  setAutoPrint: (on: boolean) => void;
  setAutoOpenDrawer: (on: boolean) => void;
}

export const usePosSettingsStore = create<PosSettingsState>()(
  persist(
    (set) => ({
      printerUrl: '',
      autoPrint: true,
      autoOpenDrawer: true,
      setPrinterUrl: (url) => set({ printerUrl: url.trim() }),
      setAutoPrint: (on) => set({ autoPrint: on }),
      setAutoOpenDrawer: (on) => set({ autoOpenDrawer: on }),
    }),
    {
      name: 'pos:settings',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        printerUrl: s.printerUrl,
        autoPrint: s.autoPrint,
        autoOpenDrawer: s.autoOpenDrawer,
      }),
    },
  ),
);
