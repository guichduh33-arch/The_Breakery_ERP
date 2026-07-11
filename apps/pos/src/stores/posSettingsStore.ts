// apps/pos/src/stores/posSettingsStore.ts
//
// Session 35 (F-009) — per-terminal POS settings, persisted to localStorage
// under `pos:settings`. Device-scoped config (localStorage is per-device), so
// this is the home for terminal preferences that should NOT sync across the
// fleet: printer wiring and default order type. Read by `printService` and
// `cartStore` (default order type).
//
// Audit 2026-06-25 — the POS Settings page exposed only printerUrl + the two
// auto toggles; the Behavior / Automation / Advanced / Devices / Display tabs
// were placeholders. This store now backs all of them with real, persisted
// fields so each tab does something on this terminal.
//
// S73 Lot 2 — the auto-print/auto-open-drawer toggles and the customer-display
// copy (footer message + slogan) moved OFF this store, hard cutover, to
// `business_config` (org-level, shared by every terminal). See
// `apps/pos/src/features/settings/hooks/useOrgDisplaySettings.ts`.
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { OrderType } from '@breakery/domain';

export interface PosSettingsState {
  // ── Printing / devices ──────────────────────────────────────────────
  printerUrl: string;        // '' = fall back to VITE_PRINT_SERVER_URL then localhost:3001
  // Session 59 (21 D1.1) — this terminal's `lan_devices.code` (e.g.
  // "POS-FRONT-01"), pre-registered by an operator. '' = unregistered:
  // useLanHeartbeat no-ops rather than emit against an unknown code.
  deviceCode: string;
  // ── Behavior ────────────────────────────────────────────────────────
  defaultOrderType: OrderType; // order type a fresh cart starts on (cartStore)
  // ── Setters ─────────────────────────────────────────────────────────
  setPrinterUrl: (url: string) => void;
  setDeviceCode: (code: string) => void;
  setDefaultOrderType: (t: OrderType) => void;
  /** Restore every field to its factory default (Advanced → Reset). */
  resetToDefaults: () => void;
}

const DEFAULTS = {
  printerUrl: '',
  deviceCode: '',
  defaultOrderType: 'take_out' as OrderType,
} as const;

export const usePosSettingsStore = create<PosSettingsState>()(
  persist(
    (set) => ({
      ...DEFAULTS,
      setPrinterUrl: (url) => set({ printerUrl: url.trim() }),
      setDeviceCode: (code) => set({ deviceCode: code.trim() }),
      setDefaultOrderType: (t) => set({ defaultOrderType: t }),
      resetToDefaults: () => set({ ...DEFAULTS }),
    }),
    {
      name: 'pos:settings',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        printerUrl: s.printerUrl,
        deviceCode: s.deviceCode,
        defaultOrderType: s.defaultOrderType,
      }),
    },
  ),
);
