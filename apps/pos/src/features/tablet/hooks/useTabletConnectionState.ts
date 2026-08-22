// apps/pos/src/features/tablet/hooks/useTabletConnectionState.ts
//
// Audit POS Waiter du 2026-08-22, lot D — un seul état de connexion.
//
// Deux détecteurs coexistaient, et ils pouvaient se contredire :
//
//   · `useTabletOffline` — ping toutes les 30 s, `navigator.onLine` + HEAD
//     /auth/v1/health. Il pilotait ce que la serveuse VOIT (pastille + bandeau).
//   · `useCloudPing` + `isOfflineMode()` — ping toutes les 15 s, PLUS l'état du
//     hub LAN. C'est ce qui décide du chemin d'envoi RÉELLEMENT emprunté.
//
// Le premier ignorait le hub. Cloud coupé et hub coupé : l'écran annonçait
// « Offline », mais `isOfflineMode()` valait false, `useCreateTabletOrder`
// prenait la branche en ligne, et l'envoi échouait sur un message brut. Rien
// n'était perdu — rien n'était mis en file non plus, et l'écran avait menti.
//
// Ce hook lit EXACTEMENT les deux sources de `isOfflineMode()`, de façon
// réactive. Il ne ping pas : `useCloudPing`, monté une fois par coquille
// (TabletLayout), alimente déjà `cloudStatusStore`.
//
// La distinction qui compte pour la salle n'est pas « connecté ou pas » — c'est
// « ma commande va-t-elle partir ? ». D'où trois états, pas deux.

import { useCloudStatusStore } from '@/features/lan/cloudStatusStore';
import { useHubConnectionStore } from '@/features/lan/hubConnectionStore';

export type TabletConnectionState =
  /** Cloud joignable. Tout fonctionne normalement. */
  | 'online'
  /** Cloud coupé, hub LAN joignable — le mode OFFLINE de la spec 006x. La
   *  commande part en cuisine par le bus et attend en file locale. */
  | 'offline_bus'
  /** Cloud coupé ET hub coupé — mode dégradé (spec §3-A3). Rien ne part : ni
   *  cloud, ni bus, ni file. C'est le seul état où la serveuse doit s'arrêter. */
  | 'no_network';

export interface TabletConnection {
  state: TabletConnectionState;
  /** Vrai seulement en `online`. Raccourci pour les affichages binaires. */
  isOnline: boolean;
  /** Vrai quand un envoi aboutira, par le cloud ou par le bus. */
  canSendOrders: boolean;
  /** Dernière synchronisation cloud réussie, ou null si jamais. */
  lastSync: Date | null;
  /** Début de la coupure cloud en cours, ou null quand tout va bien. */
  offlineSince: Date | null;
}

function toDate(iso: string | null): Date | null {
  return iso === null ? null : new Date(iso);
}

export function useTabletConnectionState(): TabletConnection {
  const cloudOnline = useCloudStatusStore((s) => s.cloudOnline);
  const lastSyncAt = useCloudStatusStore((s) => s.lastSyncAt);
  const offlineSince = useCloudStatusStore((s) => s.offlineSince);
  const hubConnected = useHubConnectionStore((s) => s.connected);

  // Mêmes termes que isOfflineMode() : !cloudOnline && hubConnected.
  const state: TabletConnectionState = cloudOnline
    ? 'online'
    : hubConnected
      ? 'offline_bus'
      : 'no_network';

  return {
    state,
    isOnline: state === 'online',
    canSendOrders: state !== 'no_network',
    lastSync: toDate(lastSyncAt),
    offlineSince: toDate(offlineSince),
  };
}
