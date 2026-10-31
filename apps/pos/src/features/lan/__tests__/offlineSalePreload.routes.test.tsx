import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { queryClient as applicationClient } from '@/lib/queryClient';
import { useAuthStore } from '@/stores/authStore';
import { useShiftStore } from '@/stores/shiftStore';
import { useCurrentShift } from '@/features/shift/hooks/useShift';
import { useSaleQueryEnabled } from '../hooks/useSaleQueryEnabled';
import { useCloudStatusStore } from '../cloudStatusStore';
import { useLanCredential } from '../lanCredential';
import { OfflineSaleContext } from '../OfflineSaleContext';
import { restoreSaleSnapshot, saveSaleSnapshot, SALE_SNAPSHOT_KEY } from '../offlineSaleSnapshot';
import type * as SessionModule from '@/features/auth/localSession';

const mocks = vi.hoisted(() => ({ from: vi.fn<(table: string) => void>() }));
interface ModifierChain {
  select: () => ModifierChain; or: () => ModifierChain; eq: () => ModifierChain;
  is: () => Promise<{ data: []; error: null }>;
  maybeSingle: () => Promise<{ data: typeof shift; error: null }>;
}
vi.mock('@/lib/supabase', () => ({ supabaseUrl: 'https://offline.invalid', supabase: {
  from: (table: string) => {
    if (table !== 'pos_sessions') mocks.from(table);
    const chain: ModifierChain = { select: () => chain, or: () => chain, eq: () => chain,
      is: () => Promise.resolve({ data: [], error: null }),
      maybeSingle: () => Promise.resolve({ data: shift, error: null }) };
    return chain;
  },
} }));
vi.mock('@/features/auth/localSession', async (original) => ({
  ...await original<typeof SessionModule>(), isSameTabReload: () => true,
}));
const base = { sku: 'SKU', name: 'Coffee', retail_price: 35000, wholesale_price: null, current_stock: 1,
  is_active: true, is_favorite: false, is_sellable: true, track_inventory: false, image_url: null, dispatch_station: 'barista' };
const products = [
  { ...base, id: 'parent', category_id: 'drinks', has_variants: true, product_type: 'finished' },
  { ...base, id: 'combo', category_id: 'food', has_variants: false, product_type: 'combo' },
];
const variant = { id: 'variant', name: 'Large coffee', retail_price: 40000, variant_label: 'Large', variant_axis: 'size',
  variant_sort_order: 0, is_active: true, current_stock: 1, deduct_stock: false };
const variants = new Map([['parent', [variant]]]);
vi.mock('@/features/products/hooks/useProducts', () => ({ useProducts: () => useQuery({
  queryKey: ['products'], queryFn: () => Promise.resolve(products), enabled: useSaleQueryEnabled(),
}) }));
vi.mock('@/features/products/hooks/usePromotionVariants', () => ({ usePromotionVariants: () => variants }));
vi.mock('@/features/cart/hooks/useStationMap', () => ({ useStationMap: () => ({}) }));
vi.mock('@/features/products/hooks/useCategories', () => ({ useCategories: () => ({}) }));
vi.mock('@/features/combos/hooks/useComboConfig', () => ({ useComboConfig: () => ({}) }));
vi.mock('@/features/settings/hooks/useTaxConfig', () => ({ useTaxConfig: () => ({}) }));
vi.mock('@/features/settings/hooks/useOfflineNetworkConfig', () => ({ useOfflineNetworkConfig: () => ({}) }));
vi.mock('@/features/promotions/hooks/usePromotions', () => ({ usePromotions: () => ({}) }));
vi.mock('../TabletOptionsPreload', () => ({ TabletOptionsPreload: () => null }));

const clients: QueryClient[] = [];
const identity = { project: 'https://offline.invalid', terminal: 'terminal', user: 'cashier', session: 'session' };
const shift = { id: 'shift', opened_at: '2026-10-02T00:00:00Z', opening_cash: 100000 };
function makeClient() {
  const defaults = applicationClient.getDefaultOptions();
  const client = new QueryClient({ defaultOptions: { ...defaults, queries: { ...defaults.queries, retry: false } } });
  clients.push(client);
  return client;
}
function seed(client: QueryClient) {
  client.setQueryData(['products'], products);
  client.setQueryData(['categories'], ['drinks', 'food'].map((id) => ({ id, name: id, slug: id, sort_order: 0, is_active: true })));
  client.setQueryData(['station-map'], { parent: ['barista'], variant: ['barista'], combo: ['kitchen'] });
  client.setQueryData(['promotions', 'active'], []);
  client.setQueryData(['business-config', 'offline-network'], { offlinePaymentsEnabled: true });
  client.setQueryData(['business-config', 'tax-config'], { taxRate: 0.08, taxInclusive: false });
  client.setQueryData(['business-config', 'enabled-payment-methods'], ['cash']);
  client.setQueryData(['pos-product-variants', 'parent'], [variant]);
  for (const [id, category] of [['parent', 'drinks'], ['variant', 'drinks'], ['combo', 'food']]) {
    client.setQueryData(['product-modifiers', id, category], []);
  }
  client.setQueryData(['combo-config', 'combo'], { combo_product_id: 'combo', name: 'Meal', base_price: 50000, groups: [] });
  expect(saveSaleSnapshot(sessionStorage, client, identity, shift)).toBe(true);
}
function ShiftConsumer() {
  const { data: currentShift } = useCurrentShift();
  return <output>{currentShift ? 'Sale ready' : 'No shift'}</output>;
}
function SaleConsumer() {
  const { pathname } = useLocation();
  return pathname === '/pos' || pathname === '/pos/' ? <ShiftConsumer /> : null;
}
function Navigation() {
  const navigate = useNavigate();
  return <><button onClick={() => { void navigate('/pos/stock'); }}>Stock</button>
    <button onClick={() => { void navigate('/pos/settings'); }}>Settings</button>
    <button onClick={() => { void navigate('/pos'); }}>Sale</button></>;
}
function mount(path: string) {
  const client = makeClient();
  seed(client);
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}>
    <OfflineSaleContext /><Navigation /><SaleConsumer />
  </MemoryRouter></QueryClientProvider>);
  return client;
}
function modifierObservers(client: QueryClient) {
  return client.getQueryCache().findAll({ queryKey: ['product-modifiers'] }).map((query) => query.getObserversCount());
}
beforeEach(() => {
  sessionStorage.clear(); localStorage.clear(); mocks.from.mockClear();
  const now = Date.now();
  useAuthStore.setState({
    user: { id: 'cashier', full_name: 'Test', role_code: 'CASHIER', employee_code: 'TEST' },
    sessionToken: 'session', isAuthenticated: true, isLocked: false, bootstrapStatus: 'ready', cloudValidated: true,
    localSession: { version: 1, token: 'session', userId: 'cashier', permissions: [],
      expiresAt: now + 4 * 3600000, lastActivityAt: now, observedAt: now, idleMs: 2 * 3600000 },
  });
  useCloudStatusStore.setState({ cloudOnline: true });
  useLanCredential.setState({ credential: { id: 'terminal', code: 'TEST', secret: 'test', device_type: 'pos' } });
  useShiftStore.setState({ current: null });
});
afterEach(() => {
  cleanup(); for (const client of clients.splice(0)) client.clear(); vi.useRealTimers();
});
it.each(['/pos', '/pos/'])('keeps product and variant modifier observers on the exact sale route %s', (path) => {
  expect(modifierObservers(mount(path))).toEqual([1, 1, 1]);
});
it.each(['/pos/stock', '/pos/stock/', '/pos/settings', '/pos/settings/printing'])('does not mount modifier observers on %s', (path) => {
  const client = mount(path);
  expect(modifierObservers(client)).toEqual([0, 0, 0]);
  expect(mocks.from).not.toHaveBeenCalled();
});
it('removes observers on stock and restores them on return to sale without refetching fresh data', () => {
  const client = mount('/pos');
  expect(modifierObservers(client)).toEqual([1, 1, 1]);
  fireEvent.click(screen.getByRole('button', { name: 'Stock' }));
  expect(modifierObservers(client)).toEqual([0, 0, 0]);
  fireEvent.click(screen.getByRole('button', { name: 'Sale' }));
  expect(modifierObservers(client)).toEqual([1, 1, 1]);
  expect(mocks.from).not.toHaveBeenCalled();
});
it('keeps the saved catalogue available on a short offline stock-to-sale return', () => {
  const client = mount('/pos');
  fireEvent.click(screen.getByRole('button', { name: 'Stock' }));
  const snapshot = sessionStorage.getItem(SALE_SNAPSHOT_KEY);
  act(() => { useCloudStatusStore.setState({ cloudOnline: false }); useAuthStore.setState({ cloudValidated: false }); });
  fireEvent.click(screen.getByRole('button', { name: 'Sale' }));
  expect(client.getQueryData(['products'])).toEqual(products);
  expect(modifierObservers(client)).toEqual([1, 1, 1]);
  expect(sessionStorage.getItem(SALE_SNAPSHOT_KEY)).toBe(snapshot);
  expect(mocks.from).not.toHaveBeenCalled();
});
it.each(['Stock', 'Settings'])('preserves the durable snapshot and outbox bytes after the global 30min GC on %s', async (destination) => {
  vi.useFakeTimers();
  expect(applicationClient.getDefaultOptions().queries?.gcTime).toBe(30 * 60 * 1000);
  const client = mount('/pos');
  localStorage.setItem('pos:offline_outbox', 'pending-original-bytes');
  fireEvent.click(screen.getByRole('button', { name: destination }));
  act(() => { useCloudStatusStore.setState({ cloudOnline: false }); useAuthStore.setState({ cloudValidated: false }); });
  const snapshot = sessionStorage.getItem(SALE_SNAPSHOT_KEY);
  await act(async () => { await vi.advanceTimersByTimeAsync(31 * 60 * 1000); });
  expect(client.getQueryData(['products'])).toBeUndefined();
  expect(sessionStorage.getItem(SALE_SNAPSHOT_KEY)).toBe(snapshot);
  expect(localStorage.getItem('pos:offline_outbox')).toBe('pending-original-bytes');
  const reloaded = makeClient();
  expect(restoreSaleSnapshot(sessionStorage, reloaded, identity)).toEqual(shift);
  expect(reloaded.getQueryData(['products'])).toEqual(products);
});
it('keeps sale usable on an offline return after the global cache has expired on stock', async () => {
  vi.useFakeTimers();
  const client = mount('/pos');
  fireEvent.click(screen.getByRole('button', { name: 'Stock' }));
  act(() => { useCloudStatusStore.setState({ cloudOnline: false }); useAuthStore.setState({ cloudValidated: false }); });
  await act(async () => { await vi.advanceTimersByTimeAsync(31 * 60 * 1000); });
  expect(client.getQueryData(['products'])).toBeUndefined();
  expect(client.getQueryData(['pos_sessions', 'current', identity.user])).toBeUndefined();
  expect(useShiftStore.getState().current).toEqual(shift);
  fireEvent.click(screen.getByRole('button', { name: 'Sale' }));
  expect(screen.getByText('Sale ready')).toBeTruthy();
  expect(screen.queryByText('No shift')).toBeNull();
  expect(client.getQueryData(['pos_sessions', 'current', identity.user])).toEqual(shift);
  expect(useShiftStore.getState().current).toEqual(shift);
  expect(client.getQueryData(['products'])).toEqual(products);
  expect(modifierObservers(client)).toEqual([1, 1, 1]);
  expect(mocks.from).not.toHaveBeenCalled();
});

it.each(['terminal', 'user', 'session', 'expired', 'locked', 'closed', 'different', 'known-null', 'known-different'])('refuses offline route recovery for %s', async (reason) => {
  vi.useFakeTimers();
  const client = mount('/pos');
  fireEvent.click(screen.getByRole('button', { name: 'Stock' }));
  act(() => { useCloudStatusStore.setState({ cloudOnline: false }); useAuthStore.setState({ cloudValidated: false }); });
  await act(async () => { await vi.advanceTimersByTimeAsync(31 * 60 * 1000); });
  act(() => {
    if (reason === 'terminal') useLanCredential.setState({ credential: { id: 'other', code: 'TEST', secret: 'test', device_type: 'pos' } });
    if (reason === 'user') useAuthStore.setState({ user: { id: 'other', full_name: 'Other', role_code: 'CASHIER', employee_code: 'OTHER' } });
    if (reason === 'session') useAuthStore.setState({ sessionToken: 'other' });
    if (reason === 'expired') useAuthStore.setState({ localSession: { ...useAuthStore.getState().localSession!, expiresAt: Date.now() - 1 } });
    if (reason === 'locked') useAuthStore.setState({ isLocked: true });
    if (reason === 'closed') useShiftStore.setState({ current: null });
    if (reason === 'different') useShiftStore.setState({ current: { ...shift, id: 'different' } });
    if (reason === 'known-null') client.setQueryData(['pos_sessions', 'current', identity.user], null);
    if (reason === 'known-different') client.setQueryData(['pos_sessions', 'current', identity.user], { ...shift, id: 'different' });
  });
  const knownShift = client.getQueryData(['pos_sessions', 'current', identity.user]);
  fireEvent.click(screen.getByRole('button', { name: 'Sale' }));
  expect(client.getQueryData(['products'])).toBeUndefined();
  expect(client.getQueryData(['pos_sessions', 'current', identity.user])).toEqual(knownShift);
});
it('preserves existing values and timestamps while recovering missing offline sale data', async () => {
  vi.useFakeTimers();
  const client = mount('/pos');
  fireEvent.click(screen.getByRole('button', { name: 'Stock' }));
  act(() => { useCloudStatusStore.setState({ cloudOnline: false }); useAuthStore.setState({ cloudValidated: false }); });
  await act(async () => { await vi.advanceTimersByTimeAsync(31 * 60 * 1000); });
  const updatedAt = Date.now();
  client.setQueryData(['promotions', 'active'], [], { updatedAt });
  client.setQueryData(['business-config', 'tax-config'], null, { updatedAt });
  client.setQueryData(['pos_sessions', 'current', identity.user], shift, { updatedAt });
  fireEvent.click(screen.getByRole('button', { name: 'Sale' }));
  expect(client.getQueryData(['products'])).toEqual(products);
  for (const key of [['promotions', 'active'], ['business-config', 'tax-config'], ['pos_sessions', 'current', identity.user]]) {
    expect(client.getQueryState(key)?.dataUpdatedAt).toBe(updatedAt);
  }
  expect(client.getQueryData(['promotions', 'active'])).toEqual([]);
  expect(client.getQueryData(['business-config', 'tax-config'])).toBeNull();
  expect(client.getQueryData(['pos_sessions', 'current', identity.user])).toEqual(shift);
});
