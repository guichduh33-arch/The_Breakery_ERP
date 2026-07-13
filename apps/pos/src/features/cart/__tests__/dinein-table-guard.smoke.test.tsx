// apps/pos/src/features/cart/__tests__/dinein-table-guard.smoke.test.tsx
//
// Fiche 02 D2.5 — table OBLIGATOIRE en dine-in au fire (useDineInTableGuard).
// Scenarios:
//   1. dine_in cart WITHOUT table → click "Send to Kitchen" blocks: warning
//      toast, fire RPC never called, floor plan opens.
//   2. dine_in cart WITH table → fire proceeds (RPC called).
//   3. take_out cart without table → guard is a no-op, fire proceeds.

/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useCartStore } from '@/stores/cartStore';
import { useAuthStore } from '@/stores/authStore';
import { useShiftStore } from '@/stores/shiftStore';
import { clearMockPrintBuffer } from '@/services/print/printService';
import { SendToKitchenButton } from '../SendToKitchenButton';

// ── Static mocks (mirror fire-to-stations.smoke) ─────────────────────────────

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  Toaster: () => null,
}));

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...a: unknown[]): unknown => rpcMock(...a) as unknown,
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'tok' } } }) },
  },
  supabaseUrl: 'http://localhost:54321',
}));

const PRINTERS_MAP = new Map([
  ['barista', { ip_address: '192.168.1.11', port: 9100, name: 'Barista' }],
]);

vi.mock('@/features/cart/hooks/useStationPrinters', () => ({
  useStationPrinters: () => ({ data: PRINTERS_MAP }),
}));

// The guard's floor plan mounts these once it trips — mock them so the modal
// renders without touching supabase.from / realtime channels.
vi.mock('@/features/tables/hooks/useRestaurantTables', () => ({
  useRestaurantTables: () => ({
    data: [
      { id: 't1', name: 'T-01', seats: 2, sort_order: 1, is_active: true, section_id: null },
      { id: 't2', name: 'T-02', seats: 4, sort_order: 2, is_active: true, section_id: null },
    ],
  }),
}));
vi.mock('@/features/tables/hooks/useTableOccupancy', () => ({
  useTableOccupancy: () => ({}),
}));

vi.mock('@/features/cart/hooks/useStationMap', () => {
  const STATION_MAP: Record<string, string[]> = { 'p-barista': ['barista'] };
  return {
    useStationMap: () => ({ data: STATION_MAP }),
    getStationMap: () => Promise.resolve(STATION_MAP),
  };
});

function withQuery(node: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{node}</QueryClientProvider>;
}

function seedCart(orderType: string, tableNumber?: string) {
  useCartStore.setState({
    cart: {
      items: [
        { id: 'l1', product_id: 'p-barista', name: 'Latte', unit_price: 30_000, quantity: 1, modifiers: [] },
      ],
      order_type: orderType,
      ...(tableNumber ? { tableNumber } : {}),
    },
    printedItemIds: [],
    lockedItemIds: [],
    attachedCustomer: null,
    pickedUpOrderId: null,
  } as never);
}

describe('SendToKitchenButton — dine-in table guard (fiche 02 D2.5)', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_PRINT_MOCK', '1');
    clearMockPrintBuffer();
    vi.mocked(toast.warning).mockClear();
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.error).mockClear();
    rpcMock.mockReset();
    rpcMock.mockResolvedValue({
      data: { order_id: 'order-db-1', order_number: '#0042', idempotent_replay: false },
      error: null,
    });
    useShiftStore.setState({ current: { id: 'sess-1', opened_at: '', opening_cash: 0 } });
    useAuthStore.setState({
      user: { id: 'u1', full_name: 'Tester', role_code: 'CASHIER', employee_code: 'EMP1' },
      sessionToken: 'tok',
      permissions: ['pos.sale.create'],
      isAuthenticated: true,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('blocks a dine-in fire without a table: warning toast, no RPC, floor plan opens', async () => {
    seedCart('dine_in');
    render(withQuery(<SendToKitchenButton />));

    fireEvent.click(screen.getByRole('button', { name: /send to kitchen/i }));

    await waitFor(() => {
      expect(toast.warning).toHaveBeenCalledWith(
        expect.stringMatching(/dine-in orders need a table/i),
      );
    });
    expect(rpcMock).not.toHaveBeenCalled();
    // The guard's floor plan is open.
    expect(await screen.findByTestId('floor-plan-canvas')).toBeInTheDocument();
  });

  it('fires a dine-in order once a table is set', async () => {
    seedCart('dine_in', 'T-01');
    render(withQuery(<SendToKitchenButton />));

    fireEvent.click(screen.getByRole('button', { name: /send to kitchen/i }));

    await waitFor(() => {
      expect(rpcMock).toHaveBeenCalledWith(
        'fire_counter_order_v4',
        expect.objectContaining({ p_table_number: 'T-01', p_order_type: 'dine_in' }),
      );
    });
  });

  it('take-out without a table fires normally (guard is dine-in only)', async () => {
    seedCart('take_out');
    render(withQuery(<SendToKitchenButton />));

    fireEvent.click(screen.getByRole('button', { name: /send to kitchen/i }));

    await waitFor(() => {
      expect(rpcMock).toHaveBeenCalledWith('fire_counter_order_v4', expect.anything());
    });
    expect(toast.warning).not.toHaveBeenCalledWith(
      expect.stringMatching(/dine-in orders need a table/i),
    );
  });
});
