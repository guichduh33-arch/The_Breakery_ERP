// apps/pos/src/features/lan/cloudStatusStore.ts
// Spec 006x lot 3 — état de joignabilité du CLOUD (Supabase), alimenté par
// useCloudPing (pattern useTabletOffline : navigator.onLine + ping HEAD).
// Volatile par design. Défaut true : on ne bascule jamais en OFFLINE sur un
// simple démarrage — il faut un échec de ping constaté.
//
// Lot 4 — offlineSince : horodatage de l'ENTRÉE en cloud-down (posé sur la
// transition true→false, conservé pendant toute la coupure). Porte la fenêtre
// offline maximale (arbitrage A5) : au-delà de offline_max_hours, le POS
// bloque les nouveaux encaissements cash.

import { create } from 'zustand';

interface CloudStatusState {
  cloudOnline: boolean;
  lastSyncAt: string | null;
  /** ISO — début de la coupure cloud courante, null quand online. */
  offlineSince: string | null;
  setCloudOnline: (online: boolean) => void;
}

export const useCloudStatusStore = create<CloudStatusState>((set) => ({
  cloudOnline: true,
  lastSyncAt: null,
  offlineSince: null,
  setCloudOnline: (online) =>
    set((s) =>
      online
        ? { cloudOnline: true, lastSyncAt: new Date().toISOString(), offlineSince: null }
        : {
            cloudOnline: false,
            // Transition true→false uniquement — les pings suivants en échec
            // ne repoussent pas le début de fenêtre.
            offlineSince: s.cloudOnline ? new Date().toISOString() : s.offlineSince,
          },
    ),
}));
