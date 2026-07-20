// apps/pos/src/features/lan/__tests__/offlineMode.test.ts
// Spec 006x §4.3 — offline = internet down ET hub joignable (les autres
// combinaisons ne déclenchent jamais le mode bus).
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { isOfflineMode, useOfflineMode } from '../offlineMode';
import { useCloudStatusStore } from '../cloudStatusStore';
import { useHubConnectionStore } from '../hubConnectionStore';

beforeEach(() => {
  useCloudStatusStore.setState({ cloudOnline: true, lastSyncAt: null });
  useHubConnectionStore.setState({ connected: false });
});

describe('isOfflineMode', () => {
  it.each([
    [true, true, false],   // nominal online
    [true, false, false],  // online, hub down — rien ne change
    [false, false, false], // tout down = mode dégradé actuel, PAS offline-bus
    [false, true, true],   // internet down + hub up = OFFLINE
  ])('cloudOnline=%s hubConnected=%s → %s', (cloud, hub, expected) => {
    useCloudStatusStore.setState({ cloudOnline: cloud });
    useHubConnectionStore.setState({ connected: hub });
    expect(isOfflineMode()).toBe(expected);
    const { result } = renderHook(() => useOfflineMode());
    expect(result.current).toBe(expected);
  });
});

describe('cloudStatusStore', () => {
  it('stamps lastSyncAt only on the online transition', () => {
    useCloudStatusStore.getState().setCloudOnline(false);
    expect(useCloudStatusStore.getState().lastSyncAt).toBeNull();
    useCloudStatusStore.getState().setCloudOnline(true);
    expect(useCloudStatusStore.getState().lastSyncAt).not.toBeNull();
  });
});
