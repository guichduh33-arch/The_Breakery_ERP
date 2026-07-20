// apps/pos/src/features/lan/hubConnectionStore.ts
// Spec 006x lot 2 — état de connexion au hub LAN, partagé entre
// useHubPresence (écrivain : welcome/close) et useLanHeartbeat (lecteur :
// quand le hub est connecté, c'est LUI l'écrivain cloud du heartbeat — le
// terminal se tait ; fallback direct sinon, spec §3-A3 mode dégradé).
// Volatile par design : jamais persisté (une connexion ne survit pas à un
// reload).

import { create } from 'zustand';

interface HubConnectionState {
  /** true entre le `welcome` du hub et la fermeture du socket. */
  connected: boolean;
  setConnected: (connected: boolean) => void;
}

export const useHubConnectionStore = create<HubConnectionState>((set) => ({
  connected: false,
  setConnected: (connected) => set({ connected }),
}));
