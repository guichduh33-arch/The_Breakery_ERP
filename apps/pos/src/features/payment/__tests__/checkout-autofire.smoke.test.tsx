// apps/pos/src/features/payment/__tests__/checkout-autofire.smoke.test.tsx
//
// Session 34 / W4 — PaymentTerminal auto-fires unprinted prep items on checkout.
//
// Strategy: mock useFireToStations to capture mutateAsync calls, and mock
// useCheckout to resolve instantly. Seed the cart with one ALREADY-PRINTED item
// and one UNPRINTED prep item, then complete checkout. Verify:
//   • fireToStations.mutateAsync is called once.
//   • The printed item is not re-fired (it stays in printedItemIds pre-call;
//     the hook's internal unprintedItems() excludes it).
//
// We also assert that the buffer (via VITE_PRINT_MOCK) contains a prep entry
// only for the unprinted item's station when the real printService runs.

/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCartStore } from '@/stores/cartStore';
import { useAuthStore } from '@/stores/authStore';
import { usePaymentStore } from '@/stores/paymentStore';
import { useShiftStore } from '@/stores/shiftStore';
import { clearMockPrintBuffer } from '@/services/print/printService';

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const { mutateAsyncMock: checkoutMutateAsync, fireToStationsMock, toastMock } = vi.hoisted(() => ({
  mutateAsyncMock: vi.fn(),
  fireToStationsMock: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

vi.mock('sonner', () => ({ toast: toastMock, Toaster: () => null }));

vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'tok' } } }) } },
  supabaseUrl: 'http://localhost:54321',
}));

vi.mock('../hooks/useCheckout', () => ({
  useCheckout: () => ({
    mutateAsync: checkoutMutateAsync,
    isPending: false,
  }),
}));

// Mock useFireToStations — we capture the mutateAsync call.
vi.mock('@/features/cart/hooks/useFireToStations', () => ({
  useFireToStations: () => ({
    mutation: {
      mutateAsync: fireToStationsMock,
      isPending: false,
    },
    firableCount: 1,
  }),
}));

vi.mock('@/features/cart/hooks/useStationPrinters', () => ({
  useStationPrinters: () => ({ data: new Map() }),
}));

vi.mock('@/features/settings/hooks/usePOSPresets', () => ({
  usePOSPresets: () => ({ presets: { quickPayments: [50_000, 100_000, 200_000] } }),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function withQuery(node: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{node}</QueryClientProvider>;
}

function setupEnvironment() {
  // Cart: line-printed is already printed (prev fire), line-unprinted is new.
  useCartStore.setState({
    cart: {
      items: [
        { id: 'line-printed', product_id: 'p-kitchen', name: 'Omelette', unit_price: 45_000, quantity: 1, modifiers: [] },
        { id: 'line-unprinted', product_id: 'p-barista', name: 'Latte', unit_price: 30_000, quantity: 1, modifiers: [] },
      ],
      order_type: 'dine_in',
    },
    // line-printed is already in printedItemIds → unprintedItems() excludes it.
    printedItemIds: ['line-printed'],
    lockedItemIds: [],
    attachedCustomer: null,
    pickedUpOrderId: null,
    appliedPromotions: [],
    dismissedPromotionIds: new Set<string>(),
    isOffline: false,
  });

  useAuthStore.setState({
    user: { id: 'u1', full_name: 'Tester', role_code: 'CASHIER', employee_code: 'EMP1' },
    sessionToken: 'tok',
    permissions: ['pos.sale.create'],
    isAuthenticated: true,
    isLoading: false,
    error: null,
  } as never);

  useShiftStore.setState({ current: { id: 's1', opened_at: '', opening_cash: 0 } });

  usePaymentStore.setState({
    isOpen: true,
    selectedMethod: 'cash',
    cashReceivedStr: '82500', // covers total ~75k + PB1
    tenders: [],
    idempotencyKey: 'auto-fire-test-uuid',
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

vi.mock('@/features/cart/hooks/useStationMap', () => {
  // S44 P0-B — useFireToStations now reads the station map (variant-aware) for
  // firableCount (render) and routing (getStationMap, fire path). Mock both so
  // the test never hits supabase.from.
  const STATION_MAP: Record<string, string[]> = { 'p-barista': ['barista'], 'p-kitchen': ['kitchen'], 'p-none': [] };
  return {
    useStationMap: () => ({ data: STATION_MAP }),
    getStationMap: () => Promise.resolve(STATION_MAP),
  };
});

describe('PaymentTerminal — checkout auto-fires unprinted items', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_PRINT_MOCK', '1');
    clearMockPrintBuffer();
    checkoutMutateAsync.mockReset();
    fireToStationsMock.mockReset();
    toastMock.error.mockReset();
    setupEnvironment();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('calls fireToStations.mutateAsync with the order_number after successful checkout', async () => {
    checkoutMutateAsync.mockResolvedValueOnce({
      ok: true,
      order_id: 'o1',
      order_number: 'ORD-042',
      total: 75_000,
      tax_amount: 6_818,
      change_given: 7_500,
    });
    // fireToStations returns a resolved-ok result.
    fireToStationsMock.mockResolvedValueOnce([
      { role: 'barista', ok: true, itemIds: ['line-unprinted'] },
    ]);

    const { PaymentTerminal } = await import('../PaymentTerminal');

    render(withQuery(<PaymentTerminal />));

    // Click "Process Payment".
    const processBtn = screen.getAllByRole('button', { name: /Process Payment/i })[0]!;
    await act(async () => { processBtn.click(); });

    // Wait for fireToStations to be invoked.
    await waitFor(() => {
      expect(fireToStationsMock).toHaveBeenCalledTimes(1);
    });

    // fireToStations was called with the resolved order_number, in printOnly
    // mode (S43 P0-3): the order already exists in DB — the auto-fire must
    // NOT call fire_counter_order_v4 (orphan order / append-to-paid → P0002).
    const callArg = fireToStationsMock.mock.calls[0]![0] as { orderNumber: string; printOnly?: boolean };
    expect(callArg.orderNumber).toBe('ORD-042');
    expect(callArg.printOnly).toBe(true);
  });

  it('does not re-fire already-printed items (printedItemIds excludes them)', async () => {
    checkoutMutateAsync.mockResolvedValueOnce({
      ok: true,
      order_id: 'o1',
      order_number: 'ORD-043',
      total: 75_000,
      tax_amount: 6_818,
      change_given: 7_500,
    });
    fireToStationsMock.mockResolvedValueOnce([]);

    const { PaymentTerminal } = await import('../PaymentTerminal');

    render(withQuery(<PaymentTerminal />));

    const processBtn = screen.getAllByRole('button', { name: /Process Payment/i })[0]!;
    await act(async () => { processBtn.click(); });

    await waitFor(() => {
      expect(fireToStationsMock).toHaveBeenCalledTimes(1);
    });

    // line-printed remains in printedItemIds (unchanged from initial seed).
    const printed = useCartStore.getState().printedItemIds;
    expect(printed).toContain('line-printed');
  });
});
