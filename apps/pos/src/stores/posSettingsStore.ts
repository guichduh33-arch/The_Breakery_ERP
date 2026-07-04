// apps/pos/src/stores/posSettingsStore.ts
//
// Session 35 (F-009) — per-terminal POS settings, persisted to localStorage
// under `pos:settings`. Device-scoped config (localStorage is per-device), so
// this is the home for terminal preferences that should NOT sync across the
// fleet: printer wiring, automation toggles, default order type, and the
// customer-display copy. Read by `printService`, `SuccessModal`, `cartStore`
// (default order type) and `CustomerDisplayPage` (display copy).
//
// Audit 2026-06-25 — the POS Settings page exposed only printerUrl + the two
// auto toggles; the Behavior / Automation / Advanced / Devices / Display tabs
// were placeholders. This store now backs all of them with real, persisted
// fields so each tab does something on this terminal.
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { OrderType } from '@breakery/domain';

export interface PosSettingsState {
  // ── Printing / devices ──────────────────────────────────────────────
  printerUrl: string;        // '' = fall back to VITE_PRINT_SERVER_URL then localhost:3001
  autoPrint: boolean;        // auto-print receipt on SuccessModal mount
  autoOpenDrawer: boolean;   // auto-pop the cash drawer (cash payments)
  // Session 59 (21 D1.1) — this terminal's `lan_devices.code` (e.g.
  // "POS-FRONT-01"), pre-registered by an operator. '' = unregistered:
  // useLanHeartbeat no-ops rather than emit against an unknown code.
  deviceCode: string;
  // ── Behavior ────────────────────────────────────────────────────────
  defaultOrderType: OrderType; // order type a fresh cart starts on (cartStore)
  // ── Customer display (KDS & Display tab) ────────────────────────────
  displayFooterMessage: string; // '' = built-in "Open daily · 07:00 — 21:00"
  // ── Setters ─────────────────────────────────────────────────────────
  setPrinterUrl: (url: string) => void;
  setAutoPrint: (on: boolean) => void;
  setAutoOpenDrawer: (on: boolean) => void;
  setDeviceCode: (code: string) => void;
  setDefaultOrderType: (t: OrderType) => void;
  setDisplayFooterMessage: (t: string) => void;
  /** Restore every field to its factory default (Advanced → Reset). */
  resetToDefaults: () => void;
}

const DEFAULTS = {
  printerUrl: '',
  autoPrint: true,
  autoOpenDrawer: true,
  deviceCode: '',
  defaultOrderType: 'take_out' as OrderType,
  displayFooterMessage: '',
} as const;

export const usePosSettingsStore = create<PosSettingsState>()(
  persist(
    (set) => ({
      ...DEFAULTS,
      setPrinterUrl: (url) => set({ printerUrl: url.trim() }),
      setAutoPrint: (on) => set({ autoPrint: on }),
      setAutoOpenDrawer: (on) => set({ autoOpenDrawer: on }),
      setDeviceCode: (code) => set({ deviceCode: code.trim() }),
      setDefaultOrderType: (t) => set({ defaultOrderType: t }),
      setDisplayFooterMessage: (t) => set({ displayFooterMessage: t }),
      resetToDefaults: () => set({ ...DEFAULTS }),
    }),
    {
      name: 'pos:settings',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        printerUrl: s.printerUrl,
        autoPrint: s.autoPrint,
        autoOpenDrawer: s.autoOpenDrawer,
        deviceCode: s.deviceCode,
        defaultOrderType: s.defaultOrderType,
        displayFooterMessage: s.displayFooterMessage,
      }),
    },
  ),
);
