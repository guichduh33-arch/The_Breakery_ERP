import { act, render, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/stores/authStore';
import { useShiftStore } from '@/stores/shiftStore';
import { useLanCredential } from '../lanCredential';
import { supabaseUrl } from '@/lib/supabase';
import { OfflineSaleContext } from '../OfflineSaleContext';
import { SALE_SNAPSHOT_KEY, saveSaleSnapshot } from '../offlineSaleSnapshot';
import { useCloudStatusStore } from '../cloudStatusStore';
import { useProducts } from '@/features/products/hooks/useProducts';
import { useCurrentShift } from '@/features/shift/hooks/useShift';
import type * as SessionModule from '@/features/auth/localSession';
import { usePromotionsAutoEval } from '@/features/promotions/hooks/usePromotionsAutoEval';
import { useCartStore } from '@/stores/cartStore';
import { supabase } from '@/lib/supabase';
import type { Promotion } from '@breakery/domain';

vi.mock('@/features/auth/localSession', async (original) => ({
  ...await original<typeof SessionModule>(), isSameTabReload: () => true,
}));
const shift = { id: 'shift', opened_at: '2026-10-02T00:00:00Z', opening_cash: 100000 };
const identity = { project: supabaseUrl, terminal: 'terminal', user: 'cashier', session: 'session' };
function fixture() {
  const client = new QueryClient();
  client.setQueryData(['station-map'], {});
  client.setQueryData(['promotions', 'active'], []);
  client.setQueryData(['products'], []);
  client.setQueryData(['categories'], []);
  client.setQueryData(['business-config', 'offline-network'], { offlinePaymentsEnabled: true });
  client.setQueryData(['business-config', 'tax-config'], { taxRate: 0.08, taxInclusive: false });
  client.setQueryData(['business-config', 'enabled-payment-methods'], ['cash']);
  saveSaleSnapshot(sessionStorage, client, identity, shift);
}
function mount(client: QueryClient) {
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/pos']}>
    <OfflineSaleContext />
  </MemoryRouter></QueryClientProvider>);
}
beforeEach(() => {
  sessionStorage.clear();
  useCloudStatusStore.setState({ cloudOnline: false });
  const now = Date.now();
  useAuthStore.setState({
    user: { id: 'cashier', full_name: 'Test', role_code: 'CASHIER', employee_code: 'TEST' },
    sessionToken: 'session', isAuthenticated: true, isLocked: false, bootstrapStatus: 'ready', cloudValidated: false,
    localSession: { version: 1, token: 'session', userId: 'cashier', permissions: [],
      expiresAt: now + 3600000, lastActivityAt: now, observedAt: now, idleMs: 1800000 },
  });
  useLanCredential.setState({ credential: { id: 'terminal', code: 'TEST', secret: 'test', device_type: 'pos' } });
  useShiftStore.setState({ current: null });
  fixture();
});
describe('same-tab sale restoration', () => {
  it('keeps an applied promotion when automatic evaluation resumes after reload', async () => {
    const promo: Promotion = { id: 'promo', name: 'Ten percent', slug: 'ten', description: null, type: 'percentage', scope: 'cart',
      discount_value: 10, max_discount_amount: null, scope_product_ids: [], scope_category_ids: [],
      bogo_trigger_product_ids: [], bogo_reward_product_ids: [], bogo_trigger_qty: null, bogo_reward_qty: null,
      bogo_reward_discount_pct: null, gift_product_id: null, gift_qty: 1, min_items_total: 0,
      customer_category_ids: [], customer_tier_ids: [], start_at: null, end_at: null, day_of_week_mask: 127,
      start_hour: null, end_hour: null, priority: 1, stackable_with_promo: true, stackable_with_manual: true,
      is_active: true, created_at: '2026-10-02T00:00:00Z' };
    const source = new QueryClient();
    const stored = JSON.parse(sessionStorage.getItem(SALE_SNAPSHOT_KEY)!) as { entries: { key: string[]; data: unknown }[] };
    for (const entry of stored.entries) source.setQueryData(entry.key, entry.data);
    source.setQueryData(['promotions', 'active'], [promo]);
    expect(saveSaleSnapshot(sessionStorage, source, identity, shift)).toBe(true);
    useCartStore.getState().clear();
    useCartStore.getState().add({ id: 'coffee', sku: 'COFFEE', name: 'Coffee', category_id: 'drinks',
      retail_price: 35000, wholesale_price: null, product_type: 'finished', image_url: null,
      current_stock: 1, is_active: true, is_favorite: false }, []);
    useCartStore.getState().setAppliedPromotions([{ promotion_id: 'promo', name: 'Ten percent', slug: 'ten',
      type: 'percentage', amount: 3500, description: 'Ten percent' }]);
    const rpc = vi.spyOn(supabase, 'rpc').mockRejectedValue(new TypeError('cloud offline'));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const client = new QueryClient();
    mount(client);
    renderHook(() => usePromotionsAutoEval(), {
      wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
    });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 350)); });
    expect(rpc).toHaveBeenCalled();
    expect(useCartStore.getState().appliedPromotions).toEqual(expect.arrayContaining([
      expect.objectContaining({ promotion_id: 'promo', amount: 3500 }),
    ]));
    vi.restoreAllMocks();
  });
  it('keeps stale catalogue usable when WAN is down but navigator remains online', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    const snapshot = JSON.parse(sessionStorage.getItem(SALE_SNAPSHOT_KEY)!) as { entries: { updatedAt: number }[] };
    for (const entry of snapshot.entries) entry.updatedAt = Date.now() - 3600000;
    sessionStorage.setItem(SALE_SNAPSHOT_KEY, JSON.stringify(snapshot));
    const client = new QueryClient();
    mount(client);
    const { result } = renderHook(() => useProducts(), {
      wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
    });
    expect(result.current.isSuccess).toBe(true);
    expect(result.current.fetchStatus).toBe('idle');
    expect(result.current.data).toEqual([]);
    act(() => client.getQueryCache().find({ queryKey: ['products'] })!.setState({ status: 'error', error: new Error('cloud unavailable') }));
    expect(client.getQueryState(['products'])?.status).toBe('success');
    vi.restoreAllMocks();
  });
  it('hydrates the actual shift store and settings while the cloud remains unavailable', () => {
    const client = new QueryClient();
    mount(client);
    expect(useShiftStore.getState().current).toEqual(shift);
    const { result } = renderHook(() => useCurrentShift(), {
      wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
    });
    // Même consommateur et même condition que PosPage, sans mock du hook caisse.
    expect(result.current.data).toEqual(shift);
    expect(!result.current.isLoading && !result.current.data).toBe(false);
    expect(result.current.fetchStatus).toBe('idle');
    expect(client.getQueryData(['business-config', 'offline-network'])).toEqual({ offlinePaymentsEnabled: true });
  });
  it('revalidates the restored shift as soon as the cloud session is validated', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: 300000 } } });
    mount(client);
    const key = ['pos_sessions', 'current', identity.user];
    expect(client.getQueryState(key)?.dataUpdatedAt).toBe(1);
    const revalidate = vi.fn().mockResolvedValue(null);
    // Aucun accès cloud avant sa revalidation ; la caisse connue reste disponible.
    expect(revalidate).not.toHaveBeenCalled();
    const { result } = renderHook(() => useCurrentShift(), {
      wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
    });
    expect(result.current.data).toEqual(shift);
    const from = vi.spyOn(supabase, 'from').mockImplementation(() => ({
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: revalidate.mockResolvedValue({ data: null, error: null }) }) }) }),
    }) as unknown as ReturnType<typeof supabase.from>);
    act(() => { useCloudStatusStore.setState({ cloudOnline: true }); useAuthStore.setState({ cloudValidated: true }); });
    await waitFor(() => expect(revalidate).toHaveBeenCalled());
    await waitFor(() => expect(result.current.data).toBeNull());
    expect(useShiftStore.getState().current).toBeNull();
    from.mockRestore();
  });
  it.each(['locked', 'expired', 'different-user'])('does not restore for %s', (kind) => {
    if (kind === 'locked') useAuthStore.setState({ isLocked: true });
    if (kind === 'expired') useAuthStore.setState({ localSession: { ...useAuthStore.getState().localSession!, expiresAt: 1 } });
    if (kind === 'different-user') useAuthStore.setState({ user: { ...useAuthStore.getState().user!, id: 'other' } });
    const client = new QueryClient();
    mount(client);
    expect(useShiftStore.getState().current).toBeNull();
    expect(client.getQueryData(['products'])).toBeUndefined();
    expect(sessionStorage.getItem(SALE_SNAPSHOT_KEY)).toBeNull();
  });
  it('purges on shift closure and logout without removing unrelated pending state', () => {
    sessionStorage.setItem('pending-operations', 'preserved');
    mount(new QueryClient());
    act(() => useShiftStore.getState().clear());
    expect(sessionStorage.getItem(SALE_SNAPSHOT_KEY)).toBeNull();
    fixture();
    act(() => useAuthStore.setState({ sessionToken: null, user: null, isAuthenticated: false }));
    expect(sessionStorage.getItem(SALE_SNAPSHOT_KEY)).toBeNull();
    expect(sessionStorage.getItem('pending-operations')).toBe('preserved');
  });
});
