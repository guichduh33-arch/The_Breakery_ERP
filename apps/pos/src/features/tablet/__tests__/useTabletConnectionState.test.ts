// apps/pos/src/features/tablet/__tests__/useTabletConnectionState.test.ts
//
// Lot D de l'audit POS Waiter du 2026-08-22 — un seul état de connexion.
//
// L'invariant que ce fichier protège : l'écran et le code doivent conclure la
// MÊME chose. `isOfflineMode()` décide du chemin d'envoi ; `useTabletConnectionState`
// décide de ce que la serveuse lit. S'ils divergent, l'écran ment — c'était le
// cas avant ce lot, quand la pastille sortait d'un ping qui ignorait le hub LAN.
//
// Le dernier test est le vrai filet : il compare les deux fonctions sur les
// QUATRE combinaisons possibles, pas seulement sur celle qui a causé le défaut.

import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCloudStatusStore } from '@/features/lan/cloudStatusStore';
import { useHubConnectionStore } from '@/features/lan/hubConnectionStore';
import { isOfflineMode } from '@/features/lan/offlineMode';
import { useTabletConnectionState } from '../hooks/useTabletConnectionState';

function setNetwork(cloudOnline: boolean, hubConnected: boolean): void {
  useCloudStatusStore.setState({ cloudOnline });
  useHubConnectionStore.setState({ connected: hubConnected });
}

describe('useTabletConnectionState', () => {
  beforeEach(() => {
    useCloudStatusStore.setState({ cloudOnline: true, lastSyncAt: null, offlineSince: null });
    useHubConnectionStore.setState({ connected: false });
  });

  it('cloud debout → online, et les commandes partent', () => {
    setNetwork(true, false);
    const { result } = renderHook(() => useTabletConnectionState());
    expect(result.current.state).toBe('online');
    expect(result.current.isOnline).toBe(true);
    expect(result.current.canSendOrders).toBe(true);
  });

  it('cloud coupé + hub debout → offline_bus, les commandes partent quand même', () => {
    setNetwork(false, true);
    const { result } = renderHook(() => useTabletConnectionState());
    expect(result.current.state).toBe('offline_bus');
    expect(result.current.isOnline).toBe(false);
    expect(result.current.canSendOrders).toBe(true);
  });

  it('cloud coupé + hub coupé → no_network, plus rien ne part', () => {
    setNetwork(false, false);
    const { result } = renderHook(() => useTabletConnectionState());
    expect(result.current.state).toBe('no_network');
    expect(result.current.isOnline).toBe(false);
    expect(result.current.canSendOrders).toBe(false);
  });

  it('expose les horodatages du store cloud', () => {
    const since = '2026-08-22T10:00:00.000Z';
    const synced = '2026-08-22T09:58:00.000Z';
    useCloudStatusStore.setState({ cloudOnline: false, offlineSince: since, lastSyncAt: synced });
    useHubConnectionStore.setState({ connected: true });
    const { result } = renderHook(() => useTabletConnectionState());
    expect(result.current.offlineSince?.toISOString()).toBe(since);
    expect(result.current.lastSync?.toISOString()).toBe(synced);
  });

  // LE filet. `canSendOrders` couvre le cloud ET le bus ; `isOfflineMode()` ne
  // dit que « le bus prend le relais ». Les deux doivent rester d'accord sur la
  // seule question qui compte : la commande aboutit-elle ?
  it.each([
    { cloud: true,  hub: true },
    { cloud: true,  hub: false },
    { cloud: false, hub: true },
    { cloud: false, hub: false },
  ])('reste d’accord avec isOfflineMode (cloud=$cloud, hub=$hub)', ({ cloud, hub }) => {
    setNetwork(cloud, hub);
    const { result } = renderHook(() => useTabletConnectionState());

    // Le mode OFFLINE de la spec 006x, mot pour mot.
    expect(result.current.state === 'offline_bus').toBe(isOfflineMode());

    // Un envoi aboutit si le cloud répond, ou si le bus prend le relais.
    expect(result.current.canSendOrders).toBe(cloud || isOfflineMode());
  });
});
