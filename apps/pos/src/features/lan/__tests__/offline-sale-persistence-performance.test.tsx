import { act, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider, QueryObserver } from '@tanstack/react-query';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/stores/authStore';
import { useShiftStore } from '@/stores/shiftStore';
import { OfflineSaleContext } from '../OfflineSaleContext';
import { useCloudStatusStore } from '../cloudStatusStore';
import { useLanCredential } from '../lanCredential';
import { SALE_SNAPSHOT_KEY, restoreSaleSnapshot } from '../offlineSaleSnapshot';
import { supabaseUrl } from '@/lib/supabase';
import type * as SessionModule from '@/features/auth/localSession';
import { IdleTimeoutMount } from '@/components/IdleTimeoutMount';

vi.mock('@/features/auth/localSession', async (original) => ({
  ...await original<typeof SessionModule>(), isSameTabReload: () => false,
}));

const shift = { id: 'shift', opened_at: '2026-11-02T00:00:00Z', opening_cash: 100000 };
const identity = { project: supabaseUrl, terminal: 'terminal', user: 'cashier', session: 'session' };
let client: QueryClient;
let write: ReturnType<typeof vi.spyOn<Storage, 'setItem'>>;
const writes = () => write.mock.calls.filter(([key]) => key === SALE_SNAPSHOT_KEY).length;

function Navigation() {
  const navigate = useNavigate();
  return <><button onClick={() => { void navigate('/pos/settings'); }}>Settings</button>
    <button onClick={() => { void navigate('/pos'); }}>POS</button></>;
}
function mount() {
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/pos']}>
    <IdleTimeoutMount /><OfflineSaleContext /><Navigation />
  </MemoryRouter></QueryClientProvider>);
}

beforeEach(() => {
  sessionStorage.clear();
  const now = Date.now();
  useAuthStore.setState({
    user: { id: 'cashier', full_name: 'Test', role_code: 'CASHIER', employee_code: 'TEST' },
    sessionToken: 'session', isAuthenticated: true, isLocked: false, bootstrapStatus: 'ready', cloudValidated: true,
    localSession: { version: 1, token: 'session', userId: 'cashier', permissions: [],
      expiresAt: now + 3600000, lastActivityAt: now, observedAt: now, idleMs: 1800000 },
  });
  useLanCredential.setState({ credential: { id: 'terminal', code: 'TEST', secret: 'test', device_type: 'pos' } });
  useCloudStatusStore.setState({ cloudOnline: true });
  useShiftStore.setState({ current: shift });
  client = new QueryClient({ defaultOptions: { queries: { staleTime: 300000, retry: false } } });
  client.setQueryData(['station-map'], {});
  client.setQueryData(['promotions', 'active'], []);
  client.setQueryData(['products'], []);
  client.setQueryData(['categories'], []);
  client.setQueryData(['business-config', 'offline-network'], { offlinePaymentsEnabled: true });
  client.setQueryData(['business-config', 'tax-config'], { taxRate: 0.08, taxInclusive: false });
  client.setQueryData(['business-config', 'enabled-payment-methods'], ['cash']);
  client.setQueryData(['pos_sessions', 'current', identity.user], shift);
  write = vi.spyOn(Storage.prototype, 'setItem');
});
afterEach(() => { vi.restoreAllMocks(); client.clear(); });

describe('sale persistence avoids blocking navigation', () => {
  it('does not rebuild or rewrite on real activity, observer churn or settings navigation', async () => {
    const serialize = vi.spyOn(JSON, 'stringify');
    const snapshotsSerialized = () => serialize.mock.calls.filter(([value]: [unknown, ...unknown[]]) =>
      typeof value === 'object' && value !== null && 'entries' in value && 'identity' in value && 'shift' in value).length;
    mount();
    await act(async () => { await Promise.resolve(); });
    const initialWrites = writes();
    expect(initialWrites).toBe(1);
    const stored = sessionStorage.getItem(SALE_SNAPSHOT_KEY);
    const initialSerializations = snapshotsSerialized();
    expect(initialSerializations).toBe(1);
    await act(async () => {
      const observer = new QueryObserver(client, { queryKey: ['products'], enabled: false });
      for (let index = 0; index < 100; index++) {
        const stop = observer.subscribe(() => undefined);
        observer.setOptions({ queryKey: ['products'], enabled: false, staleTime: 300000 + index });
        stop();
      }
      observer.destroy();
      client.setQueryData(['customers'], [{ id: 'unrelated' }]);
      client.setQueryData(['business-config', 'printer'], { changed: true });
      await Promise.resolve();
    });
    const originalSession = useAuthStore.getState().localSession;
    for (let index = 0; index < 10; index++) {
      fireEvent.mouseDown(window);
      fireEvent.keyDown(window, { key: 'ArrowDown' });
      fireEvent.touchStart(window);
      fireEvent.scroll(window);
    }
    expect(useAuthStore.getState().localSession).not.toBe(originalSession);
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    fireEvent.click(screen.getByRole('button', { name: 'POS' }));
    await act(async () => { await Promise.resolve(); });
    expect(writes()).toBe(initialWrites);
    expect(snapshotsSerialized()).toBe(initialSerializations);
    expect(sessionStorage.getItem(SALE_SNAPSHOT_KEY)).toBe(stored);
  });

  it('persists a burst once with the latest complete data and restores it into a fresh cache', async () => {
    mount();
    await act(async () => { await Promise.resolve(); });
    const initialWrites = writes();
    await act(async () => {
      client.setQueryData(['business-config', 'tax-config'], { taxRate: 0.09, taxInclusive: false });
      client.setQueryData(['business-config', 'tax-config'], { taxRate: 0.10, taxInclusive: true });
      client.setQueryData(['categories'], [{ id: 'drinks', name: 'Drinks', slug: 'drinks', sort_order: 0, is_active: true }]);
      expect(writes()).toBe(initialWrites);
      await Promise.resolve();
    });
    expect(writes()).toBe(initialWrites + 1);
    const restored = new QueryClient();
    expect(restoreSaleSnapshot(sessionStorage, restored, identity)).toEqual(shift);
    expect(restored.getQueryData(['business-config', 'tax-config'])).toEqual({ taxRate: 0.10, taxInclusive: true });
    expect(restored.getQueryData(['categories'])).toEqual(client.getQueryData(['categories']));
    restored.clear();
  });

  it('keeps the last valid snapshot when a batched update is incomplete', async () => {
    mount();
    await act(async () => { await Promise.resolve(); });
    const stored = sessionStorage.getItem(SALE_SNAPSHOT_KEY);
    const initialWrites = writes();
    await act(async () => {
      client.setQueryData(['business-config', 'tax-config'], { taxRate: 0.12, taxInclusive: false });
      client.removeQueries({ queryKey: ['categories'], exact: true });
      await Promise.resolve();
    });
    expect(writes()).toBe(initialWrites);
    expect(sessionStorage.getItem(SALE_SNAPSHOT_KEY)).toBe(stored);
  });

  it.each(['lock', 'logout', 'cloud-suspended', 'shift-closed', 'expired', 'different-user'])(
    'does not write or resurrect a queued snapshot after %s', async (change) => {
      mount();
      await act(async () => { await Promise.resolve(); });
      const initialWrites = writes();
      sessionStorage.setItem('pending-payment', 'preserved');
      await act(async () => {
        client.setQueryData(['business-config', 'tax-config'], { taxRate: 0.13, taxInclusive: false });
        if (change === 'lock') useAuthStore.setState({ isLocked: true });
        if (change === 'logout') useAuthStore.setState({ isAuthenticated: false, sessionToken: null, user: null });
        if (change === 'cloud-suspended') useAuthStore.setState({ cloudValidated: false });
        if (change === 'shift-closed') useShiftStore.getState().clear();
        if (change === 'expired') useAuthStore.setState({ localSession: { ...useAuthStore.getState().localSession!, expiresAt: 1 } });
        if (change === 'different-user') useAuthStore.setState({
          user: { ...useAuthStore.getState().user!, id: 'other' },
          localSession: { ...useAuthStore.getState().localSession!, userId: 'other' },
        });
        await Promise.resolve();
      });
      expect(writes()).toBe(initialWrites);
      expect(sessionStorage.getItem('pending-payment')).toBe('preserved');
      if (change === 'logout' || change === 'shift-closed' || change === 'expired') {
        expect(sessionStorage.getItem(SALE_SNAPSHOT_KEY)).toBeNull();
      }
    },
  );

  it('discards the old terminal queue and saves only under the newly validated identity', async () => {
    mount();
    await act(async () => { await Promise.resolve(); });
    const initialCalls = write.mock.calls.length;
    await act(async () => {
      client.setQueryData(['business-config', 'tax-config'], { taxRate: 0.13, taxInclusive: false });
      useLanCredential.setState({ credential: { ...useLanCredential.getState().credential!, id: 'other' } });
      await Promise.resolve();
    });
    const newWrites = write.mock.calls.slice(initialCalls).filter(([key]) => key === SALE_SNAPSHOT_KEY);
    expect(newWrites).toHaveLength(1);
    const saved = JSON.parse(String(newWrites[0]?.[1])) as { identity: { terminal: string } };
    expect(saved.identity.terminal).toBe('other');
    expect(restoreSaleSnapshot(sessionStorage, new QueryClient(), identity)).toBeNull();
  });

  it('flushes the pending update on pagehide before a same-tab reload', async () => {
    mount();
    await act(async () => { await Promise.resolve(); });
    const initialWrites = writes();
    await act(async () => {
      client.setQueryData(['business-config', 'tax-config'], { taxRate: 0.11, taxInclusive: true });
      window.dispatchEvent(new Event('pagehide'));
      expect(writes()).toBe(initialWrites + 1);
      await Promise.resolve();
    });
    expect(writes()).toBe(initialWrites + 1);
    const restored = new QueryClient();
    expect(restoreSaleSnapshot(sessionStorage, restored, identity)).toEqual(shift);
    expect(restored.getQueryData(['business-config', 'tax-config'])).toEqual({ taxRate: 0.11, taxInclusive: true });
    restored.clear();
  });
});
