// apps/pos/src/features/lan/__tests__/useOfflineCashGate.test.ts
// Spec 006x lot 4 — gate cash offline : activation explicite (A1b) + fenêtre
// maximale (A5). La config réseau est mockée (le hook réel lit business_config).
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

const configMock = vi.hoisted(() => ({
  value: { offlineCashEnabled: false, offlineMaxHours: 4 },
}));
vi.mock('@/features/settings/hooks/useOfflineNetworkConfig', () => ({
  useOfflineNetworkConfig: () => configMock.value,
  OFFLINE_NETWORK_DEFAULTS: { offlineCashEnabled: false, offlineMaxHours: 4 },
}));

import { useOfflineCashGate, isWindowExpired } from '../hooks/useOfflineCashGate';
import { useCloudStatusStore } from '../cloudStatusStore';
import { useHubConnectionStore } from '../hubConnectionStore';

beforeEach(() => {
  useCloudStatusStore.setState({ cloudOnline: true, lastSyncAt: null, offlineSince: null });
  useHubConnectionStore.setState({ connected: false });
  configMock.value = { offlineCashEnabled: false, offlineMaxHours: 4 };
});

describe('isWindowExpired', () => {
  const now = Date.parse('2026-07-21T12:00:00.000Z');
  it.each([
    [null, 4, false],                          // pas de coupure
    ['2026-07-21T09:00:00.000Z', 4, false],    // 3 h < 4 h
    ['2026-07-21T07:59:00.000Z', 4, true],     // 4 h 01 > 4 h
    ['2026-07-21T07:59:00.000Z', 8, false],    // fenêtre élargie
    ['not-a-date', 4, false],                  // ISO cassé = pas de blocage
  ])('since=%s max=%sh → %s', (since, maxHours, expected) => {
    expect(isWindowExpired(since, maxHours, now)).toBe(expected);
  });
});

describe('useOfflineCashGate', () => {
  function goOffline(sinceIso: string): void {
    useCloudStatusStore.setState({ cloudOnline: false, offlineSince: sinceIso });
    useHubConnectionStore.setState({ connected: true });
  }

  it('is inert when online', () => {
    const { result } = renderHook(() => useOfflineCashGate());
    expect(result.current).toEqual({ offlineMode: false, cashAllowed: false, blockedReason: null });
  });

  it('blocks with cash_disabled when the setting is off (fail-closed A1b)', () => {
    goOffline(new Date().toISOString());
    const { result } = renderHook(() => useOfflineCashGate());
    expect(result.current).toEqual({ offlineMode: true, cashAllowed: false, blockedReason: 'cash_disabled' });
  });

  it('allows cash inside the window when enabled', () => {
    configMock.value = { offlineCashEnabled: true, offlineMaxHours: 4 };
    goOffline(new Date().toISOString());
    const { result } = renderHook(() => useOfflineCashGate());
    expect(result.current).toEqual({ offlineMode: true, cashAllowed: true, blockedReason: null });
  });

  it('blocks with window_expired beyond offline_max_hours (A5)', () => {
    configMock.value = { offlineCashEnabled: true, offlineMaxHours: 4 };
    goOffline(new Date(Date.now() - 5 * 3_600_000).toISOString());
    const { result } = renderHook(() => useOfflineCashGate());
    expect(result.current).toEqual({ offlineMode: true, cashAllowed: false, blockedReason: 'window_expired' });
  });
});

describe('cloudStatusStore.offlineSince', () => {
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
