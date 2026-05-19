// apps/pos/src/features/tablet/__tests__/TabletOrderPage.test.tsx
//
// Session 14 / Phase 3.C — Tablet order entry page smoke.
//
// Strategy:
//   - We DO NOT exercise the menu/cart children — they have their own
//     tests. We mock `TabletMenuView`, `TabletCartPanel`, and
//     `OfflineBanner` to lightweight stubs so the test focuses on the
//     page shell behaviour.
//   - We mock the `useRestaurantTables` / `useTableOccupancy` hooks via
//     the `tablesOverride` / `occupancyOverride` test seams on the
//     component itself (no need for vi.mock here).
//   - We mock the Supabase client so `useCreateTabletOrder`'s `rpc()`
//     call is observable; alternatively we use the `onSendOverride`
//     test seam to bypass it entirely.

/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { RestaurantTable } from '@breakery/domain';
import { useTabletCartStore } from '@/stores/tabletCartStore';
import { useAuthStore } from '@/stores/authStore';

// ── Hoisted mocks ────────────────────────────────────────────────────
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
  Toaster: () => null,
}));

// Stub the heavy children — we only care about the page shell.
vi.mock('../components/TabletMenuView', () => ({
  TabletMenuView: ({ toolbar }: { toolbar?: ReactNode }) => (
    <div data-testid="mock-menu-view" className="flex-1">
      {toolbar}
      <div>menu-stub</div>
    </div>
  ),
}));
vi.mock('../components/TabletCartPanel', () => ({
  TabletCartPanel: () => <div data-testid="mock-cart-panel">cart-stub</div>,
}));
vi.mock('../components/OfflineBanner', () => ({
  OfflineBanner: ({ isOnline }: { isOnline: boolean }) => (
    <div data-testid="mock-offline-banner" data-online={isOnline ? 'true' : 'false'} />
  ),
}));

// Force the offline hook to a stable online state.
vi.mock('../hooks/useTabletOffline', () => ({
  useTabletOffline: () => ({ isOnline: true, lastSync: null }),
}));

// Hoisted RPC + supabase stub.
const supaMocks = vi.hoisted(() => ({
  rpc: vi.fn().mockResolvedValue({ data: 'new-order-uuid', error: null }),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      setSession: vi.fn(),
      signOut: vi.fn().mockResolvedValue({}),
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          order: vi.fn().mockResolvedValue({ data: [], error: null }),
          not: vi.fn(() => ({ not: vi.fn().mockResolvedValue({ data: [], error: null }) })),
        })),
        not: vi.fn(() => ({ not: vi.fn().mockResolvedValue({ data: [], error: null }) })),
      })),
    })),
    rpc: supaMocks.rpc,
    channel: vi.fn(() => ({ on: vi.fn().mockReturnThis(), subscribe: vi.fn().mockReturnThis() })),
    removeChannel: vi.fn(),
  },
  supabaseUrl: 'http://localhost:54321',
}));

// ── Helpers ──────────────────────────────────────────────────────────
function wrap(node: ReactNode): ReactNode {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/tablet/order']}>{node}</MemoryRouter>
    </QueryClientProvider>
  );
}

const TABLES: RestaurantTable[] = [
  { id: 't1', name: 'T1', seats: 2, sort_order: 1, is_active: true },
  { id: 't12', name: 'T12', seats: 4, sort_order: 112, is_active: true },
];

// ── Tests ────────────────────────────────────────────────────────────
describe('TabletOrderPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNavigate.mockReset();
    supaMocks.rpc.mockResolvedValue({ data: 'new-order-uuid', error: null });
    useTabletCartStore.setState({ items: [], tableNumber: null, orderType: 'dine_in' });
    useAuthStore.setState({
      user: { id: 'waiter-001', full_name: 'Demo Waiter', role_code: 'waiter', employee_code: 'EMP002' },
      permissions: ['sales.create'],
      isAuthenticated: true,
      sessionToken: 'tok',
      isLoading: false,
      error: null,
    });
  });

  it('renders the page shell with toolbar, send button, and tactile touch targets', async () => {
    const { TabletOrderPage } = await import('../TabletOrderPage');
    render(wrap(<TabletOrderPage tablesOverride={TABLES} occupancyOverride={{}} />));

    expect(screen.getByTestId('tablet-order-page')).toBeInTheDocument();
    expect(screen.getByTestId('tablet-order-toolbar')).toBeInTheDocument();

    const pickTableBtn = screen.getByTestId('tablet-order-pick-table');
    expect(pickTableBtn).toHaveTextContent(/pick a table/i);
    expect(pickTableBtn).toHaveClass('min-h-11');

    const sendBtn = screen.getByTestId('tablet-order-send');
    expect(sendBtn).toBeDisabled(); // empty cart
    expect(sendBtn).toHaveClass('min-h-11');
    expect(screen.getByTestId('tablet-order-type-dine-in')).toHaveClass('min-h-11');
    expect(screen.getByTestId('tablet-order-type-take-out')).toHaveClass('min-h-11');
  });

  it('opens the floor plan view when the table chip is tapped, and selects a table', async () => {
    const { TabletOrderPage } = await import('../TabletOrderPage');
    render(wrap(<TabletOrderPage tablesOverride={TABLES} occupancyOverride={{}} />));

    fireEvent.click(screen.getByTestId('tablet-order-pick-table'));

    // Floor plan visible.
    expect(screen.getByTestId('tablet-floor-plan')).toBeInTheDocument();

    // Tap a free table → page returns to menu mode and table is set.
    fireEvent.click(screen.getByTestId('floor-plan-cell-T1'));

    await waitFor(() => {
      expect(screen.getByTestId('tablet-order-page')).toBeInTheDocument();
    });
    expect(screen.getByTestId('tablet-order-pick-table')).toHaveTextContent('Table T1');
    expect(useTabletCartStore.getState().tableNumber).toBe('T1');
  });

  it('calls create_tablet_order_v2 RPC, clears cart, toasts, and navigates on success', async () => {
    const { TabletOrderPage } = await import('../TabletOrderPage');
    const { toast } = await import('sonner');

    useTabletCartStore.setState({
      items: [
        { id: 'l1', product_id: 'p1', name: 'Americano', unit_price: 35000, quantity: 1, modifiers: [] },
      ],
      tableNumber: 'T1',
      orderType: 'dine_in',
    });

    render(wrap(<TabletOrderPage tablesOverride={TABLES} occupancyOverride={{}} />));

    const sendBtn = screen.getByTestId('tablet-order-send');
    expect(sendBtn).not.toBeDisabled();
    fireEvent.click(sendBtn);

    await waitFor(() => {
      expect(supaMocks.rpc).toHaveBeenCalledWith(
        'create_tablet_order_v2',
        expect.objectContaining({
          p_client_uuid: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),
          p_waiter_id: 'waiter-001',
          p_table_number: 'T1',
          p_order_type: 'dine_in',
        }),
      );
    });

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('Order sent to kitchen');
    });
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/tablet/orders');
    });
    expect(useTabletCartStore.getState().items).toHaveLength(0);
  });

  it('shows an error toast when the RPC fails (via onSendOverride seam)', async () => {
    const { TabletOrderPage } = await import('../TabletOrderPage');
    const { toast } = await import('sonner');

    useTabletCartStore.setState({
      items: [
        { id: 'l1', product_id: 'p1', name: 'Americano', unit_price: 35000, quantity: 1, modifiers: [] },
      ],
      tableNumber: 'T1',
      orderType: 'dine_in',
    });

    const onSendOverride = vi.fn().mockRejectedValue(new Error('permission_denied'));
    render(
      wrap(
        <TabletOrderPage
          tablesOverride={TABLES}
          occupancyOverride={{}}
          onSendOverride={onSendOverride}
        />,
      ),
    );

    fireEvent.click(screen.getByTestId('tablet-order-send'));

    await waitFor(() => {
      expect(onSendOverride).toHaveBeenCalledWith('waiter-001');
    });
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('permission_denied');
    });
    // Cart preserved on failure.
    expect(useTabletCartStore.getState().items).toHaveLength(1);
  });

  it('toggles between dine-in and take-out via the order-type tabs', async () => {
    const { TabletOrderPage } = await import('../TabletOrderPage');
    render(wrap(<TabletOrderPage tablesOverride={TABLES} occupancyOverride={{}} />));

    const dineIn = screen.getByTestId('tablet-order-type-dine-in');
    const takeOut = screen.getByTestId('tablet-order-type-take-out');

    expect(dineIn).toHaveAttribute('aria-selected', 'true');
    expect(takeOut).toHaveAttribute('aria-selected', 'false');

    fireEvent.click(takeOut);
    expect(useTabletCartStore.getState().orderType).toBe('take_out');
    expect(takeOut).toHaveAttribute('aria-selected', 'true');
  });
});
