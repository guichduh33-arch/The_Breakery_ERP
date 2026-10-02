import { act, render, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePaymentFlowLogic } from '@/features/payment/hooks/usePaymentFlowLogic';
import { useAuthStore } from '@/stores/authStore';
import { useCartStore } from '@/stores/cartStore';
import { usePaymentStore } from '@/stores/paymentStore';
import { useShiftStore } from '@/stores/shiftStore';
import { OfflineSaleContext } from '../OfflineSaleContext';
import { saveSaleSnapshot } from '../offlineSaleSnapshot';
import { getPendingIntents } from '../offlineOutbox';
import { useCloudStatusStore } from '../cloudStatusStore';
import { useHubConnectionStore } from '../hubConnectionStore';
import { useLanCredential } from '../lanCredential';
import type * as SessionModule from '@/features/auth/localSession';

const { cloud, publish, print } = vi.hoisted(() => ({
  cloud: vi.fn(() => { throw new Error('Cloud session awaits validation'); }),
  publish: vi.fn(() => false),
  print: vi.fn().mockResolvedValue({ success: false, error: 'printer unavailable' }),
}));
vi.mock('@/lib/supabase', () => ({ supabase: { from: cloud, rpc: cloud }, supabaseUrl: 'http://sb.test' }));
vi.mock('@/features/auth/localSession', async (original) => ({
  ...await original<typeof SessionModule>(), isSameTabReload: () => true,
}));
vi.mock('@/features/lan/hubBusClient', () => ({ hubBus: { publish } }));
vi.mock('@/features/audit/emitPosEvent', () => ({ emitPosEvent: vi.fn() }));
// Le matériel et ses réglages restent hors de cette preuve de reprise commerciale.
vi.mock('@/features/cart/hooks/useStationPrinters', () => ({ useStationPrinters: () => ({ data: new Map() }) }));
vi.mock('@/features/settings/hooks/useKotCopies', () => ({ getKotCopies: () => Promise.resolve({ barista: 1, kitchen: 1, display: 1 }) }));
vi.mock('@/features/settings/hooks/usePOSPresets', () => ({ usePOSPresets: () => ({ presets: { quickPayments: [] } }) }));
vi.mock('@/services/print/printJobs', () => ({ runPrintJob: print }));

const identity = { project: 'http://sb.test', terminal: 'terminal', user: 'cashier', session: 'session' };
const shift = { id: 'shift', opened_at: '2026-10-02T00:00:00Z', opening_cash: 100000 };
function saveCompleteCatalogue() {
  const source = new QueryClient();
  source.setQueryData(['products'], [{ id: 'coffee', sku: 'COFFEE', name: 'Americano', category_id: 'drinks',
    retail_price: 35000, wholesale_price: null, product_type: 'finished', image_url: null, current_stock: 10,
    is_active: true, is_favorite: false, has_variants: true, is_sellable: true, track_inventory: false, dispatch_station: 'barista' }]);
  source.setQueryData(['categories'], [{ id: 'drinks', name: 'Drinks', slug: 'drinks', sort_order: 0, is_active: true }]);
  source.setQueryData(['station-map'], { coffee: ['barista'], iced: ['barista', 'display'] });
  source.setQueryData(['promotions', 'active'], []);
  source.setQueryData(['pos-product-variants', 'coffee'], [{ id: 'iced', name: 'Iced Americano', retail_price: 35000,
    variant_label: 'Iced', variant_axis: 'format', variant_sort_order: 0, is_active: true, current_stock: 10, deduct_stock: false }]);
  source.setQueryData(['product-modifiers', 'coffee', 'drinks'], []);
  source.setQueryData(['product-modifiers', 'iced', 'drinks'], []);
  source.setQueryData(['business-config', 'offline-network'], { offlinePaymentsEnabled: true });
  source.setQueryData(['business-config', 'tax-config'], { taxRate: 0.1, taxInclusive: true });
  source.setQueryData(['business-config', 'enabled-payment-methods'], ['qris']);
  expect(saveSaleSnapshot(sessionStorage, source, identity, shift)).toBe(true);
  source.clear();
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.clearAllMocks();
  usePaymentStore.getState().reset();
  useCartStore.getState().clear();
  useShiftStore.setState({ current: null });
  useCloudStatusStore.setState({ cloudOnline: false });
  // Mode offline engagé ; le transport hub refuse ensuite la publication.
  useHubConnectionStore.setState({ connected: true });
  const now = Date.now();
  useAuthStore.setState({
    user: { id: identity.user, full_name: 'Cashier', role_code: 'CASHIER', employee_code: 'TEST' },
    sessionToken: identity.session, isAuthenticated: true, isLocked: false, bootstrapStatus: 'ready', cloudValidated: false,
    localSession: { version: 1, token: identity.session, userId: identity.user, permissions: [],
      expiresAt: now + 3600000, lastActivityAt: now, observedAt: now, idleMs: 1800000 },
  });
  useLanCredential.setState({ credential: { id: identity.terminal, code: 'TEST', secret: 'test', device_type: 'pos' } });
  saveCompleteCatalogue();
});
afterEach(() => { useHubConnectionStore.setState({ connected: false }); });

describe('payment after same-tab offline reload', () => {
  it.each(['coffee', 'iced'])('persists fire then QRIS payment for %s with the real routing getter and no cloud', async (productId) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const context = render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/pos']}>
      <OfflineSaleContext />
    </MemoryRouter></QueryClientProvider>);
    expect(useShiftStore.getState().current).toEqual(shift);
    useCartStore.setState({ cart: { items: [{ id: 'line', product_id: productId, name: 'Americano',
      unit_price: 35000, quantity: 1, modifiers: [] }], order_type: 'take_out' },
      lockedItemIds: [], printedItemIds: [], pickedUpOrderId: null, offlineOrder: null, appliedPromotions: [] });
    usePaymentStore.setState({ selectedMethod: 'qris', cashReceivedStr: '35000' });
    const flow = renderHook(() => usePaymentFlowLogic(), {
      wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
    });
    await act(async () => { await flow.result.current.handleProcess(); });
    expect(flow.result.current.lastError).toBeNull();
    expect(flow.result.current.success).toEqual(expect.objectContaining({ total: 35000, offline: true, paymentMethod: 'qris' }));
    const pending = await getPendingIntents();
    expect(pending.map((intent) => intent.kind)).toEqual(['fire', 'payment']);
    expect(pending[0]).toEqual(expect.objectContaining({ items: [expect.objectContaining({ product_id: productId })] }));
    expect(pending[1]).toEqual(expect.objectContaining({ root_client_uuid: pending[0]!.id, payments: [{ method: 'qris', amount: 35000 }] }));
    expect(print).toHaveBeenCalledTimes(productId === 'iced' ? 2 : 1);
    expect(cloud).not.toHaveBeenCalled();
    // Un deuxième clic reprend le résultat durable, sans doubler l'envoi ni le paiement.
    await act(async () => { await flow.result.current.handleProcess(); });
    expect(await getPendingIntents()).toHaveLength(2);
    flow.unmount();
    context.unmount();
    client.clear();
  });
});
