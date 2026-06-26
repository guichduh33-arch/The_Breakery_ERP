// apps/pos/src/features/cart/__tests__/fire-unrouted-warning.smoke.test.tsx
//
// LOT 3 (KDS, audit 2026-06-25) — when a fired cart contains a line whose
// category routes to no station (dispatch_station 'none' / unmapped), the
// "Send to Kitchen" button must surface a NON-BLOCKING warning toast. The
// order still persists and the routed lines still print.

/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useCartStore } from '@/stores/cartStore';
import { useAuthStore } from '@/stores/authStore';
import { useShiftStore } from '@/stores/shiftStore';
import { clearMockPrintBuffer } from '@/services/print/printService';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  Toaster: () => null,
}));

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpcMock(...a),
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'tok' } } }) },
  },
  supabaseUrl: 'http://localhost:54321',
}));

const BARISTA_PRINTER = { ip_address: '192.168.1.11', port: 9100, name: 'Barista' };
const PRINTERS_MAP = new Map([['barista', BARISTA_PRINTER]]);

vi.mock('@/features/cart/hooks/useStationPrinters', () => ({
  useStationPrinters: () => ({ data: PRINTERS_MAP }),
}));

// Station map: one routed product (barista) + one product routed nowhere ('none').
vi.mock('@/features/cart/hooks/useStationMap', () => {
  const STATION_MAP: Record<string, string[]> = { 'p-barista': ['barista'], 'p-none': [] };
  return {
    useStationMap: () => ({ data: STATION_MAP }),
    getStationMap: () => Promise.resolve(STATION_MAP),
  };
});

function withQuery(node: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{node}</QueryClientProvider>;
}

describe('SendToKitchenButton — unrouted product warning (LOT 3)', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_PRINT_MOCK', '1');
    clearMockPrintBuffer();

    rpcMock.mockReset();
    rpcMock.mockResolvedValue({
      data: { order_id: 'order-db-1', order_number: '#0042', idempotent_replay: false },
      error: null,
    });
    (toast.warning as ReturnType<typeof vi.fn>).mockClear();

    useShiftStore.setState({ current: { id: 'sess-1', opened_at: '', opening_cash: 0 } });

    useCartStore.setState({
      cart: {
        items: [
          { id: 'line-barista', product_id: 'p-barista', name: 'Latte', unit_price: 30_000, quantity: 1, modifiers: [] },
          { id: 'line-none', product_id: 'p-none', name: 'Croissant', unit_price: 20_000, quantity: 1, modifiers: [] },
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

  it('warns that 1 line is not routed to any kitchen station', async () => {
    const { SendToKitchenButton } = await import('../SendToKitchenButton');
    render(withQuery(<SendToKitchenButton />));

    const btn = screen.getByRole('button', { name: /send to kitchen/i });
    // The routed barista line keeps the button enabled.
    expect(btn).not.toBeDisabled();

    await act(async () => {
      btn.click();
    });

    await waitFor(() => {
      expect(toast.warning).toHaveBeenCalled();
    });
    expect((toast.warning as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toMatch(/1 item\(s\) not routed/i);

    // Non-blocking: the order was still persisted and the barista line printed.
    // Bloc 2: hold_fired_order_v1 is called after fire, so 2 RPC calls total.
    expect(rpcMock).toHaveBeenCalledTimes(2);
    // After hold succeeds, resetCartAfterCheckout clears the terminal — the
    // barista line was printed (before the reset), and now the store is clean.
    expect(rpcMock).toHaveBeenNthCalledWith(2, 'hold_fired_order_v1', expect.objectContaining({ p_order_id: 'order-db-1' }));
  });
});
