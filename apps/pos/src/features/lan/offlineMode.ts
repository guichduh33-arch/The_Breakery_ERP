// apps/pos/src/features/lan/offlineMode.ts
// Spec 006x §4.3 — le mode OFFLINE est le ET de deux conditions :
//   internet down (échec ping cloud) ET hub LAN joignable (welcome reçu).
// Cloud down + hub down = mode dégradé actuel (spec §3-A3) : PAS de mode
// offline — impression directe seule, aucun flux métier sur le bus.

import { useHubConnectionStore } from './hubConnectionStore';
import { useCloudStatusStore } from './cloudStatusStore';

/** Lecture ponctuelle (mutations, callbacks) — pas réactive. */
export function isOfflineMode(): boolean {
  return !useCloudStatusStore.getState().cloudOnline
    && useHubConnectionStore.getState().connected;
}

/** Lecture réactive (composants). */
export function useOfflineMode(): boolean {
  const cloudOnline = useCloudStatusStore((s) => s.cloudOnline);
  const hubConnected = useHubConnectionStore((s) => s.connected);
  return !cloudOnline && hubConnected;
}
