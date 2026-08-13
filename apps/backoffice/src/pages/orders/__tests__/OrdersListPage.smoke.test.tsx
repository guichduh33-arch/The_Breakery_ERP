// apps/backoffice/src/pages/orders/__tests__/OrdersListPage.smoke.test.tsx
// Session 32 / Wave 3.C — OrdersListPage smoke test (3 cases).
// Session 33 / Wave 4 corrective — bumped RPC name v1→v2 + added mocks for
// useOrdersRealtime (channel) + useLanDevices + useAuthStore so the page
// can mount cleanly in JSDOM without a live supabase client.
// Session 37 / C2 (BO-03) — T4: toast.error fires when loadItemsAndOpenEdit fails.
//
// T1 : default mount calls get_orders_list_v2 with empty filters.
// T2 : URL params propagate into p_filters JSONB.
// T3 : clicking the row date link navigates to /backoffice/orders/:id.
// T4 (C2/BO-03) : toast.error fired when order_items fetch fails.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import OrdersListPage from '../OrdersListPage.js';

// ── sonner mock ────────────────────────────────────────────────────────────
const toastErrorSpy = vi.fn();
vi.mock('sonner', () => ({ toast: { error: (...a: unknown[]): void => { toastErrorSpy(...a); } } }));

// ── supabase mock ──────────────────────────────────────────────────────────
const rpcMock = vi.fn();
const fromMock = vi.fn();
const channelMock = {
  on: vi.fn().mockReturnThis(),
  subscribe: vi.fn((cb?: (s: string) => void) => { cb?.('SUBSCRIBED'); return channelMock; }),
};

vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    rpc:           (...args: unknown[]): unknown => rpcMock(...args) as unknown,
    channel:       vi.fn(() => channelMock),
    removeChannel: vi.fn(),
    from:          (...args: unknown[]): unknown => fromMock(...args) as unknown,
  },
}));

// useLanDevices : no terminals (don't trip the page on missing data)
vi.mock('@/features/devices/hooks/useLanDevices.js', () => ({
  useLanDevices: () => ({ data: [], isLoading: false, error: null }),
}));

// useAuthStore : grant all permissions so row actions render
vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (selector: (s: { hasPermission: (c: string) => boolean }) => unknown) =>
    selector({ hasPermission: (_c: string) => true }),
}));

// ── default from() chain returning empty data ──────────────────────────────
function makeFromChain(overrides: Partial<{ error: unknown; data: unknown[] }> = {}) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq:     vi.fn().mockReturnThis(),
    is:     vi.fn().mockReturnThis(),
    then:   (
      resolve: (r: { data: unknown[]; error: unknown }) => void,
    ) =>
      Promise.resolve({
        data: overrides.data ?? [],
        error: overrides.error ?? null,
      }).then(resolve),
  };
  return chain;
}

function renderRoute(initialEntry: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/backoffice/orders" element={<OrdersListPage />} />
          <Route path="/backoffice/orders/:id" element={<div>OrderDetailStub</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const SAMPLE_ROW = {
  id: 'o-1',
  order_number: 'ORD-001',
  order_type: 'dine_in',
  status: 'draft',
  total: 100_000,
  created_at: '2026-05-15T10:00:00Z',
  customer_id: null,
  customer_name: null,
  customer_type: null,
  served_by: null,
  served_by_name: 'Alice',
  terminal_id: null,
  refund_status: 'none',
  has_modifiers: false,
  payment_method_primary: 'cash',
  items_count: 3,
};

const SAMPLE_COUNTERS = {
  total:    { count: 1, amount: 100_000 },
  paid:     { count: 0, amount: 0 },
  unpaid:   { count: 1, amount: 100_000 },
  refunded: { count: 0, amount: 0 },
  by_status: { draft: { count: 1, amount: 100_000 } },
};

describe('OrdersListPage smoke', () => {
  beforeEach(() => {
    rpcMock.mockReset();
    fromMock.mockReset();
    toastErrorSpy.mockReset();
    // default: rpc returns 1 row; from() returns empty data (no order_items loaded)
    rpcMock.mockResolvedValue({
      data: { lines: [SAMPLE_ROW], next_cursor_val: null },
      error: null,
    });
    fromMock.mockReturnValue(makeFromChain());
  });

  it('T1 default mount calls RPC v4 with default range and empty filters', async () => {
    renderRoute('/backoffice/orders');
    await screen.findByText(/ORD-001/);
    expect(rpcMock).toHaveBeenCalledWith('get_orders_list_v4', expect.objectContaining({
      p_filters: {},
    }));
  });

  it('T2 URL params propagate to RPC v4 filters', async () => {
    renderRoute('/backoffice/orders?payment_method=cash&customer_id=c-1&start=2026-05-01&end=2026-05-26');
    await screen.findByText(/ORD-001/);
    expect(rpcMock).toHaveBeenCalledWith('get_orders_list_v4', expect.objectContaining({
      p_start: '2026-05-01',
      p_end: '2026-05-26',
      p_filters: { payment_method: 'cash', customer_id: 'c-1' },
    }));
  });

  it('T3 clicking Details opens the order drawer', async () => {
    renderRoute('/backoffice/orders');
    const detailsBtn = await screen.findByTestId('row-details-o-1');
    fireEvent.click(detailsBtn);
    await waitFor(() => expect(screen.getByTestId('order-detail-drawer')).toBeInTheDocument());
  });

  it('T4 (C2/BO-03) toast.error fires when order_items fetch fails', async () => {
    // Make the from('order_items') chain return an error
    fromMock.mockReturnValue(makeFromChain({ error: { message: 'db_error_42501' } }));

    renderRoute('/backoffice/orders');
    // Wait for the list row to appear
    const editBtn = await screen.findByTestId('row-edit-o-1');
    // Click Edit to trigger loadItemsAndOpenEdit
    fireEvent.click(editBtn);
    // toast.error should fire with the error message
    await waitFor(() => expect(toastErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('db_error_42501'),
    ));
  });

  // ── ADR-025 : preuves UI de la refonte List ──────────────────────────────
  it('T5 (ADR-025 D2) counters RPC is called WITHOUT the active status filter', async () => {
    renderRoute('/backoffice/orders?status=completed&payment_method=cash');
    await screen.findByText(/ORD-001/);
    // Les lignes reçoivent le statut…
    const listFiltersMatcher: unknown = expect.objectContaining({ status: 'completed', payment_method: 'cash' });
    expect(rpcMock).toHaveBeenCalledWith('get_orders_list_v4', expect.objectContaining({
      p_filters: listFiltersMatcher,
    }));
    // …les compteurs jamais : ils mesurent la fenêtre, pas le panier actif.
    const countersCalls = rpcMock.mock.calls.filter((c) => c[0] === 'get_orders_counters_v2');
    expect(countersCalls.length).toBeGreaterThan(0);
    for (const call of countersCalls) {
      const args = call[1] as unknown as { p_filters: Record<string, unknown> };
      expect(args.p_filters).not.toHaveProperty('status');
      expect(args.p_filters).toMatchObject({ payment_method: 'cash' });
    }
  });

  it('T6 (ADR-025 D3) the strip names real statuses — the fantasy labels are dead', async () => {
    renderRoute('/backoffice/orders');
    await screen.findByText(/ORD-001/);
    const strip = screen.getByTestId('orders-counters');
    expect(strip).toHaveTextContent('Pending payment');
    expect(strip).toHaveTextContent('B2B pending');
    expect(strip).toHaveTextContent('Voided');
    // « New / Preparing / Ready » projetaient des étapes cuisine sur des
    // statuts qui ne les portent pas (ADR-009) — morts avec la refonte.
    expect(screen.queryByText('Preparing')).toBeNull();
    expect(screen.queryByText('Ready')).toBeNull();
  });

  // Review PR #367 (finding 5) : un échec des compteurs ne doit JAMAIS rendre
  // des zéros présentés comme des faits.
  it('T7 counters failure renders dashes and an alert, never zeros', async () => {
    rpcMock.mockImplementation((name: unknown) =>
      Promise.resolve(
        name === 'get_orders_counters_v2'
          ? { data: null, error: { message: 'counters down' } }
          : { data: { lines: [SAMPLE_ROW], next_cursor_val: null, next_cursor_id: null }, error: null },
      ),
    );
    renderRoute('/backoffice/orders');
    await screen.findByText(/ORD-001/);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/order counts could not be loaded/i);
    const strip = screen.getByTestId('orders-counters');
    expect(strip).toHaveTextContent('—');
    // La bande ne montre aucun « 0 » inventé pour le total.
    expect(strip).not.toHaveTextContent(/All orders0/);
  });

  // Review PR #367 (finding 1) : une commande réglée PAR STATUT sans ligne
  // order_payments (règlement B2B) lit « Paid », pas « Unpaid ».
  it('T8 settled-by-status row shows Paid in the payment cell', async () => {
    const b2bRow = { ...SAMPLE_ROW, id: 'o-2', order_number: 'B2B-001', status: 'paid', payment_method_primary: null };
    rpcMock.mockImplementation((name: unknown) =>
      Promise.resolve(
        name === 'get_orders_counters_v2'
          ? { data: SAMPLE_COUNTERS, error: null }
          : { data: { lines: [b2bRow], next_cursor_val: null, next_cursor_id: null }, error: null },
      ),
    );
    renderRoute('/backoffice/orders');
    const row = await screen.findByText(/B2B-001/);
    expect(row).toBeInTheDocument();
    const table = screen.getByTestId('orders-table');
    expect(table).toHaveTextContent('Paid');
    expect(table).not.toHaveTextContent('Unpaid');
  });
});
