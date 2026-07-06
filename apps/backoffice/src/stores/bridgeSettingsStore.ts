// apps/backoffice/src/stores/bridgeSettingsStore.ts
// URL du print-bridge pour CETTE machine BO (localStorage) — miroir du pattern
// posSettingsStore.printerUrl côté POS. Spec §5.2.
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface BridgeSettingsState {
  bridgeUrl: string;
  setBridgeUrl: (url: string) => void;
}

export const useBridgeSettingsStore = create<BridgeSettingsState>()(
  persist(
    (set) => ({ bridgeUrl: '', setBridgeUrl: (bridgeUrl) => set({ bridgeUrl }) }),
    { name: 'bo-bridge-settings' },
  ),
);

export function resolveBridgeUrl(): string {
  const url = useBridgeSettingsStore.getState().bridgeUrl.trim();
  return (url !== '' ? url : 'http://localhost:3001').replace(/\/+$/, '');
}
