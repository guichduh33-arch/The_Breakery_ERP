// apps/pos/src/features/lan/cloudStatusStore.ts
// Spec 006x lot 3 — état de joignabilité du CLOUD (Supabase), alimenté par
// useCloudPing (pattern useTabletOffline : navigator.onLine + ping HEAD).
// Volatile par design. Défaut true : on ne bascule jamais en OFFLINE sur un
// simple démarrage — il faut un échec de ping constaté.

import { create } from 'zustand';

interface CloudStatusState {
  cloudOnline: boolean;
  lastSyncAt: string | null;
  setCloudOnline: (online: boolean) => void;
}

export const useCloudStatusStore = create<CloudStatusState>((set) => ({
  cloudOnline: true,
  lastSyncAt: null,
  setCloudOnline: (online) =>
    set(online ? { cloudOnline: true, lastSyncAt: new Date().toISOString() } : { cloudOnline: false }),
}));
