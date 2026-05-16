// apps/backoffice/src/features/inventory-production/__tests__/MarginWatchPage.smoke.test.tsx
//
// Session 15 / Phase 5.A — MarginWatchPage smoke tests.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MarginWatchPage from '@/pages/inventory/MarginWatchPage.js';

const mockSelect = vi.fn();
const mockUpdate = vi.fn();

let currentPerms = new Set<string>([
  'reports.inventory.read',
  'inventory.production.create',
]);

vi.mock('@/stores/authStore.js', () => {
  const state = {
    hasPermission: (p: string) => currentPerms.has(p),
    user: { id: 'profile-1', full_name: 'Tester', role_code: 'MANAGER', employee_code: 'EMP000' },
  };
  const fn = (sel: (s: typeof state) => unknown) => sel(state);
  (fn as unknown as { getState: () => typeof state }).getState = () => state;
  return { useAuthStore: fn };
});

interface RpcResult { data: unknown; error: unknown }

vi.mock('@/lib/supabase.js', () => {
  function buildChain(table: string): any {
    const chain: any = {
      _filters: [],
      select: () => chain,
      eq:     () => chain,
      gte:    () => chain,
      lte:    () => chain,
      is:     () => chain,
      not:    () => chain,
      in:     () => chain,
      order:  () => chain,
      update: (payload: unknown) => {
        mockUpdate(table, payload);
        return chain;
      },
      insert: () => chain,
      delete: () => chain,
      single: () => {
        const data = mockSelect(table);
        const row = Array.isArray(data) ? (data[0] ?? null) : data;
        return Promise.resolve({ data: row, error: null });
      },
      then: (onResolve: (v: RpcResult) => unknown) => {
        const result = { data: mockSelect(table), error: null };
        return Promise.resolve(result).then(onResolve);
      },
    };
    return chain;
  }
  return {
    supabase: {
      from: (table: string) => buildChain(table),
      rpc:  () => Promise.resolve({ data: null, error: null }),
    },
  };
});

function renderPage(): ReturnType<typeof render> {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MarginWatchPage />
    </QueryClientProvider>,
  );
}

const ALERT_ROW = {
  id:                   'a-1',
  product_id:           'p-1',
  expected_margin_pct:  20,
  target_margin_pct:    60,
  delta_pct:            -40,
  cost_per_unit:        8000,
  selling_price:        10000,
  computed_at:          '2026-05-16T02:00:00Z',
  acknowledged_at:      null,
  acknowledged_by:      null,
  notes:                null,
};

const ALERT_ROW_SMALL = {
  id:                   'a-2',
  product_id:           'p-2',
  expected_margin_pct:  55,
  target_margin_pct:    60,
  delta_pct:            -5,
  cost_per_unit:        4500,
  selling_price:        10000,
  computed_at:          '2026-05-16T02:00:00Z',
  acknowledged_at:      null,
  acknowledged_by:      null,
  notes:                null,
};

describe('MarginWatchPage smoke', () => {
  beforeEach(() => {
    currentPerms = new Set([
      'reports.inventory.read',
      'inventory.production.create',
    ]);
    mockSelect.mockReset();
    mockUpdate.mockReset();
    mockSelect.mockImplementation((table: string) => {
      if (table === 'margin_alerts') {
        return [ALERT_ROW, ALERT_ROW_SMALL];
      }
      if (table === 'products') {
        return [
          { id: 'p-1', name: 'Croissant' },
          { id: 'p-2', name: 'Baguette' },
        ];
      }
      return [];
    });
  });

  it('renders the page with header + table when permitted', async () => {
    renderPage();
    expect(screen.getByRole('heading', { name: /Margin Watch/i })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId('margin-watch-table')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByText('Croissant')).toBeInTheDocument();
      expect(screen.getByText('Baguette')).toBeInTheDocument();
    });
  });

  it('shows worst delta first (sorted ascending)', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Croissant')).toBeInTheDocument();
    });
    const table = screen.getByTestId('margin-watch-table');
    const rows = table.querySelectorAll('tbody tr');
    expect(rows.length).toBeGreaterThanOrEqual(2);
    // Croissant (-40%) should appear before Baguette (-5%) — the query
    // already orders by delta_pct ASC.
    expect(rows[0]?.textContent ?? '').toContain('Croissant');
    expect(rows[1]?.textContent ?? '').toContain('Baguette');
  });

  it('opens the ack modal and triggers an UPDATE mutation', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Croissant')).toBeInTheDocument();
    });
    const ackButtons = screen.getAllByRole('button', { name: /Acknowledge alert for/i });
    fireEvent.click(ackButtons[0]!);

    await waitFor(() => {
      expect(screen.getByTestId('ack-modal')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText(/Acknowledgement notes/i), {
      target: { value: 'Negotiating with supplier' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Confirm acknowledge/i }));

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalled();
    });
    const [table, payload] = mockUpdate.mock.calls[0]!;
    expect(table).toBe('margin_alerts');
    expect(payload).toMatchObject({
      acknowledged_by: 'profile-1',
      notes:           'Negotiating with supplier',
    });
  });

  it('blocks the page when reports.inventory.read is missing', () => {
    currentPerms = new Set([]);
    renderPage();
    expect(
      screen.getByText(/You do not have permission to view margin alerts/i),
    ).toBeInTheDocument();
  });

  it('hides Acknowledge buttons when inventory.production.create is missing', async () => {
    currentPerms = new Set(['reports.inventory.read']);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Croissant')).toBeInTheDocument();
    });
    expect(screen.queryAllByRole('button', { name: /Acknowledge alert for/i })).toHaveLength(0);
  });
});
