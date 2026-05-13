// apps/backoffice/src/features/inventory/__tests__/ExpiringStockPage.smoke.test.tsx
// Session 13 — F1 expiry tracking. Smoke test for the BO expiring page.
//
// Goals (smoke level — full e2e lives in Playwright Phase 5+) :
//   1. Renders without crashing when permission is granted.
//   2. Shows the empty state when the RPC returns zero rows.
//   3. Renders rows when the RPC returns expiring lots.
//   4. Status pill renders 'Expired' for hours_remaining <= 0 and 'Last call'
//      for 0 < hours_remaining <= 4.
//   5. Window selector triggers a re-query with the new p_hours_ahead arg.
//   6. Permission gate : returns the access-denied banner when inventory.read
//      is missing.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ExpiringStockPage from '../pages/ExpiringStockPage.js';

// ---- Mocks ----------------------------------------------------------------

const mockRpc = vi.fn();
interface RpcResult { data: unknown; error: { message: string } | null }

vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    rpc: (fn: string, args: unknown) => {
      const out = mockRpc(fn, args) as RpcResult | undefined;
      return Promise.resolve(out ?? { data: [], error: null });
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => Promise.resolve({ data: [], error: null }),
        }),
      }),
    }),
  },
}));

// Auth store mock — page renders only when the caller has inventory.read.
let mockHasPerm = (_perm: string) => true;
vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: <T,>(selector: (s: { hasPermission: (p: string) => boolean }) => T) =>
    selector({ hasPermission: (perm: string) => mockHasPerm(perm) }),
}));

function buildLot(overrides: Partial<{
  id: string;
  product_sku: string;
  product_name: string;
  quantity: number;
  unit: string;
  expires_at: string;
  hours_remaining: number;
  status: 'active' | 'expired' | 'consumed';
  total_count: number;
}> = {}) {
  return {
    id:             overrides.id ?? 'lot-1',
    product_id:     'p-1',
    product_sku:    overrides.product_sku ?? 'BREAD-01',
    product_name:   overrides.product_name ?? 'Sourdough loaf',
    location_id:    null,
    location_name:  null,
    quantity:       overrides.quantity ?? 5,
    unit:           overrides.unit ?? 'pcs',
    expires_at:     overrides.expires_at ?? new Date(Date.now() + 8 * 3600_000).toISOString(),
    received_at:    new Date(Date.now() - 4 * 3600_000).toISOString(),
    batch_number:   'B-2026-001',
    status:         overrides.status ?? 'active',
    hours_remaining: overrides.hours_remaining ?? 8,
    total_count:    overrides.total_count ?? 1,
  };
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ExpiringStockPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ---- Tests -----------------------------------------------------------------

describe('ExpiringStockPage', () => {
  beforeEach(() => {
    mockRpc.mockReset();
    mockHasPerm = () => true;
  });

  it('renders the heading and the window selector', async () => {
    mockRpc.mockReturnValue({ data: [], error: null });
    renderPage();
    expect(screen.getByRole('heading', { name: /Expiring stock/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/Window/i)).toBeInTheDocument();
    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith('get_expiring_lots_v1', expect.objectContaining({
        p_hours_ahead: 24,
        p_limit:       50,
        p_offset:      0,
      }));
    });
  });

  it('shows the empty state when no lots are returned', async () => {
    mockRpc.mockReturnValue({ data: [], error: null });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/Inventory is healthy/i)).toBeInTheDocument();
    });
  });

  it('renders rows when the RPC returns expiring lots', async () => {
    mockRpc.mockReturnValue({
      data: [
        buildLot({ id: 'lot-A', product_name: 'Croissant', hours_remaining: 3 }),
        buildLot({ id: 'lot-B', product_name: 'Sourdough', hours_remaining: 22, total_count: 2 }),
      ],
      error: null,
    });
    renderPage();
    expect(await screen.findByText('Croissant')).toBeInTheDocument();
    expect(screen.getByText('Sourdough')).toBeInTheDocument();
  });

  it('renders the Expired pill for hours_remaining <= 0', async () => {
    mockRpc.mockReturnValue({
      data: [buildLot({ id: 'lot-overdue', hours_remaining: -2 })],
      error: null,
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/^Expired$/i)).toBeInTheDocument();
    });
  });

  it('renders the Last call pill for 0 < hours_remaining <= 4', async () => {
    mockRpc.mockReturnValue({
      data: [buildLot({ id: 'lot-soon', hours_remaining: 2 })],
      error: null,
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/Last call/i)).toBeInTheDocument();
    });
  });

  it('changing the window re-queries the RPC with the new hours_ahead', async () => {
    mockRpc.mockReturnValue({ data: [], error: null });
    renderPage();
    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith('get_expiring_lots_v1', expect.objectContaining({ p_hours_ahead: 24 }));
    });
    fireEvent.change(screen.getByLabelText(/Window/i), { target: { value: '4' } });
    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith('get_expiring_lots_v1', expect.objectContaining({ p_hours_ahead: 4 }));
    });
  });

  it('shows the permission-denied banner when inventory.read is missing', () => {
    mockHasPerm = () => false;
    renderPage();
    expect(screen.getByText(/do not have permission/i)).toBeInTheDocument();
  });
});
