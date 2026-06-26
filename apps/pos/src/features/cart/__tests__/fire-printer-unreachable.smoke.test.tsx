// apps/pos/src/features/cart/__tests__/fire-printer-unreachable.smoke.test.tsx
//
// Session 34 / W4 — kitchen printer absent from map.
// Session 43 / P0-3 — semantics updated: the fire persists the order via
// fire_counter_order_v4 BEFORE printing.
// Updated (branch feat/bulk-import-purchases) to reflect park+clear-on-send:
//   kitchen printer unreachable still toasts the error, the order is persisted
//   and held via hold_fired_order_v1, and the terminal is cleared.
//   DB/KDS is the source of truth; the order is recoverable from Held Orders.
//
// Scenario: barista printer present, kitchen printer ABSENT.
// After clicking "Send to Kitchen":
//   • toast.error is called mentioning kitchen ("saved to KDS, not printed").
//   • fire_counter_order_v4 called first, then hold_fired_order_v1.
//   • Terminal is cleared: cart.items=[], pickedUpOrderId=null, printedItemIds=[], lockedItemIds=[].

/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCartStore } from '@/stores/cartStore';
import { useAuthStore } from '@/stores/authStore';
import { useShiftStore } from '@/stores/shiftStore';
import { clearMockPrintBuffer } from '@/services/print/printService';

// ── Static mocks ──────────────────────────────────────────────────────────────

const toastMock = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };

vi.mock('sonner', () => ({
  toast: toastMock,
  Toaster: () => null,
}));

// Session 43 / P0-3 — the fire now persists via fire_counter_order_v4 first.
const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpcMock(...a),
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'tok' } } }) },
  },
  supabaseUrl: 'http://localhost:54321',
}));

// Only barista printer — kitchen is absent.
const PRINTERS_MAP_NO_KITCHEN = new Map([
  ['barista', { ip_address: '192.168.1.11', port: 9100, name: 'Barista' }],
]);

vi.mock('@/features/cart/hooks/useStationPrinters', () => ({
  useStationPrinters: () => ({ data: PRINTERS_MAP_NO_KITCHEN }),
}));

const PRODUCTS = [
  { id: 'p-barista', name: 'Latte', dispatch_station: 'barista' },
  { id: 'p-kitchen', name: 'Omelette', dispatch_station: 'kitchen' },
];

vi.mock('@/features/products/hooks/useProducts', () => ({
  useProducts: () => ({ data: PRODUCTS }),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function withQuery(node: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(['products'], PRODUCTS);
  return <QueryClientProvider client={qc}>{node}</QueryClientProvider>;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

vi.mock('@/features/cart/hooks/useStationMap', () => {
  // S44 P0-B — useFireToStations now reads the station map (variant-aware) for
  // firableCount (render) and routing (getStationMap, fire path). Mock both so
  // the test never hits supabase.from.
  const STATION_MAP: Record<string, string> = { 'p-barista': 'barista', 'p-kitchen': 'kitchen', 'p-none': 'none' };
  return {
    useStationMap: () => ({ data: STATION_MAP }),
    getStationMap: () => Promise.resolve(STATION_MAP),
  };
});

describe('SendToKitchenButton — kitchen printer unreachable', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_PRINT_MOCK', '1');
    clearMockPrintBuffer();
    toastMock.error.mockReset();

    rpcMock.mockReset();
    rpcMock.mockResolvedValue({
      data: { order_id: 'order-db-1', order_number: '#0042', idempotent_replay: false },
      error: null,
    });
    useShiftStore.setState({ current: { id: 'sess-1', opened_at: '', opening_cash: 0 } });

    useCartStore.setState({
      cart: {
        items: [
          { id: 'line-barista', product_id: 'p-barista', name: 'Latte', unit_price: 30_000, quantity: 1, modifiers: [] },
          { id: 'line-kitchen', product_id: 'p-kitchen', name: 'Omelette', unit_price: 45_000, quantity: 1, modifiers: [] },
        ],
        order_type: 'dine_in',
      },
      printedItemIds: [],
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
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('toasts kitchen error, persists+holds the order, and clears the terminal (DB is the source of truth — P0-3)', async () => {
    const { SendToKitchenButton } = await import('../SendToKitchenButton');

    render(withQuery(<SendToKitchenButton />));

    const btn = screen.getByRole('button', { name: /send to kitchen/i });

    await act(async () => {
      btn.click();
    });

    // Wait for the mutation to settle — button re-enables (firableCount > 0
    // because kitchen item remains unprinted).
    await waitFor(() => {
      expect(toastMock.error).toHaveBeenCalled();
    });

    // toast.error should mention 'kitchen'.
    const errorCall = toastMock.error.mock.calls.find((args: unknown[]) =>
      String(args[0]).toLowerCase().includes('kitchen'),
    );
    expect(errorCall).toBeDefined();

    // After fire+print (with kitchen unreachable), hold_fired_order_v1 parks
    // the order and clears the terminal.
    expect(rpcMock).toHaveBeenCalledTimes(2);
    expect(rpcMock.mock.calls[0]![0]).toBe('fire_counter_order_v4');
    expect(rpcMock.mock.calls[1]![0]).toBe('hold_fired_order_v1');
    expect(rpcMock.mock.calls[1]![1]).toEqual({ p_order_id: 'order-db-1' });

    // Terminal is cleared after park.
    expect(useCartStore.getState().printedItemIds).toEqual([]);
    expect(useCartStore.getState().lockedItemIds).toEqual([]);
    expect(useCartStore.getState().pickedUpOrderId).toBeNull();
    expect(useCartStore.getState().cart.items).toHaveLength(0);
  });
});
