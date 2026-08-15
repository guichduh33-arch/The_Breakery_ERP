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
  // Spec 006x lot 1 — shared secret of the LAN hub bus (bridge HUB_TOKEN).
  // '' = hub without token check. Sent in the WS hello, never in the URL.
  hubToken: string;
  // Numérotation par origine (2026-08-16) — code du poste dans le numéro de
  // commande (P = caisse, T1/T2 = tablettes, BO = back office). Envoyé aux
  // portes de création (`p_source_code` / `source_code`) ; le serveur valide
  // ^(P|T[0-9]+|BO)$ et applique son défaut quand il est omis.
  orderSourceCode: string;
  // ── Behavior ────────────────────────────────────────────────────────
  defaultOrderType: OrderType; // order type a fresh cart starts on (cartStore)
  // ── Setters ─────────────────────────────────────────────────────────
  setPrinterUrl: (url: string) => void;
  setDeviceCode: (code: string) => void;
  setHubToken: (token: string) => void;
  setOrderSourceCode: (code: string) => void;
  setDefaultOrderType: (t: OrderType) => void;
  /** Restore every field to its factory default (Advanced → Reset). */
  resetToDefaults: () => void;
}

const DEFAULTS = {
  printerUrl: '',
  deviceCode: '',
  hubToken: '',
  orderSourceCode: 'P',
  defaultOrderType: 'take_out' as OrderType,
} as const;

/** Mirror of the server-side gate — an invalid local value is never sent. */
export const ORDER_SOURCE_CODE_REGEX = /^(P|T[0-9]+|BO)$/;

/**
 * This terminal's order source code, or null when unset/invalid — callers omit
 * the RPC arg and let the server default apply. Non-hook accessor for modules
 * outside React (offline replay).
 */
export function getOrderSourceCode(): string | null {
  const code = usePosSettingsStore.getState().orderSourceCode;
  return ORDER_SOURCE_CODE_REGEX.test(code) ? code : null;
}

/**
 * Tablet flavor: only a T-code (T1, T2, …) is forwarded — a tablet left on the
 * factory default 'P' omits the arg and gets the server default 'T1' instead
 * of minting counter-labelled numbers.
 */
export function getTabletSourceCode(): string | null {
  const code = getOrderSourceCode();
  return code !== null && /^T[0-9]+$/.test(code) ? code : null;
}

export const usePosSettingsStore = create<PosSettingsState>()(
  persist(
    (set) => ({
      ...DEFAULTS,
      setPrinterUrl: (url) => set({ printerUrl: url.trim() }),
      setDeviceCode: (code) => set({ deviceCode: code.trim() }),
      setHubToken: (token) => set({ hubToken: token.trim() }),
      setOrderSourceCode: (code) => set({ orderSourceCode: code.trim().toUpperCase() }),
      setDefaultOrderType: (t) => set({ defaultOrderType: t }),
      resetToDefaults: () => set({ ...DEFAULTS }),
    }),
    {
      name: 'pos:settings',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        printerUrl: s.printerUrl,
        deviceCode: s.deviceCode,
        hubToken: s.hubToken,
        orderSourceCode: s.orderSourceCode,
        defaultOrderType: s.defaultOrderType,
      }),
    },
  ),
);
