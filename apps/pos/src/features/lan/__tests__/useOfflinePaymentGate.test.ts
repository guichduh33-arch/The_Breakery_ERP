// apps/pos/src/features/lan/__tests__/useOfflinePaymentGate.test.ts
// ADR-015 — gate offline : activation explicite, PLUS de fenêtre de durée.
// La config réseau est mockée (le hook réel lit business_config).
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

const configMock = vi.hoisted(() => ({ value: { offlinePaymentsEnabled: false } }));
vi.mock('@/features/settings/hooks/useOfflineNetworkConfig', () => ({
  useOfflineNetworkConfig: () => configMock.value,
  OFFLINE_NETWORK_DEFAULTS: { offlinePaymentsEnabled: false },
}));

import { useOfflinePaymentGate } from '../hooks/useOfflinePaymentGate';
import { useCloudStatusStore } from '../cloudStatusStore';
import { useHubConnectionStore } from '../hubConnectionStore';

beforeEach(() => {
  useCloudStatusStore.setState({ cloudOnline: true, lastSyncAt: null, offlineSince: null });
  useHubConnectionStore.setState({ connected: false });
  configMock.value = { offlinePaymentsEnabled: false };
});

describe('useOfflinePaymentGate', () => {
  function goOffline(sinceIso: string): void {
    useCloudStatusStore.setState({ cloudOnline: false, offlineSince: sinceIso });
    useHubConnectionStore.setState({ connected: true });
  }

  it('is inert when online', () => {
    const { result } = renderHook(() => useOfflinePaymentGate());
    expect(result.current).toEqual({ offlineMode: false, paymentsAllowed: false, blockedReason: null });
  });

  it('blocks with payments_disabled when the setting is off (fail-closed)', () => {
    goOffline(new Date().toISOString());
    const { result } = renderHook(() => useOfflinePaymentGate());
    expect(result.current).toEqual({ offlineMode: true, paymentsAllowed: false, blockedReason: 'payments_disabled' });
  });

  it('allows payments when enabled', () => {
    configMock.value = { offlinePaymentsEnabled: true };
    goOffline(new Date().toISOString());
    const { result } = renderHook(() => useOfflinePaymentGate());
    expect(result.current).toEqual({ offlineMode: true, paymentsAllowed: true, blockedReason: null });
  });

  // Le cœur d'ADR-015 : la durée de coupure n'entre plus dans la décision.
  it.each([
    ['5 heures', 5],
    ['26 heures', 26],
    ['3 jours', 72],
  ])('still allows payments after a %s outage (no more window)', (_label, hours) => {
    configMock.value = { offlinePaymentsEnabled: true };
    goOffline(new Date(Date.now() - hours * 3_600_000).toISOString());
    const { result } = renderHook(() => useOfflinePaymentGate());
    expect(result.current).toEqual({ offlineMode: true, paymentsAllowed: true, blockedReason: null });
  });
});

describe('cloudStatusStore.offlineSince', () => {
  // Conservé : le store continue d'horodater la coupure (indicateur UI), même
  // si le gate ne s'en sert plus pour bloquer.
  it('is stamped on the true→false transition only, cleared on recovery', () => {
    const store = useCloudStatusStore.getState();
    store.setCloudOnline(false);
    const first = useCloudStatusStore.getState().offlineSince;
    expect(first).not.toBeNull();
    useCloudStatusStore.getState().setCloudOnline(false); // ping suivant en échec
    expect(useCloudStatusStore.getState().offlineSince).toBe(first);
    useCloudStatusStore.getState().setCloudOnline(true);
    expect(useCloudStatusStore.getState().offlineSince).toBeNull();
  });
});
