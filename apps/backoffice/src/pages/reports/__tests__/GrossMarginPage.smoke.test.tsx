// apps/backoffice/src/pages/reports/__tests__/GrossMarginPage.smoke.test.tsx
// S57 P2.6 — GrossMarginPage render smoke. Mocks supabase.rpc
// (get_gross_margin_by_product_v1) + supabase.from('categories'). Asserts
// heading, product rows (sorted margin desc), the WAC caveat, empty-state, and
// the CSV export trigger.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import GrossMarginPage from '@/pages/reports/GrossMarginPage.js';

const CATEGORY_ROWS = [
  { id: 'c1', name: 'Bread', slug: 'bread', sort_order: 1, is_active: true,
    dispatch_station: '', kds_station: '', show_in_pos: true, category_type: 'finished' },
];

// Non-empty margin payload: two products, unsorted (croissant has higher margin).
const MARGIN_DATA = {
  period:  { start: '2026-06-01', end: '2026-06-30' },
  summary: { revenue: 3_000_000, cogs: 1_000_000, margin: 2_000_000, margin_pct: 66.7 },
  by_product: [
    { product_id: 'p1', name: 'Baguette',  category_name: 'Bread', qty: 100,
      revenue: 1_000_000, cogs: 600_000, margin: 400_000,   margin_pct: 40.0 },
    { product_id: 'p2', name: 'Croissant', category_name: 'Bread', qty: 200,
      revenue: 2_000_000, cogs: 400_000, margin: 1_600_000, margin_pct: 80.0 },
  ],
  by_category: [
    { category_id: 'c1', category_name: 'Bread', qty: 300,
      revenue: 3_000_000, cogs: 1_000_000, margin: 2_000_000, margin_pct: 66.7 },
  ],
};

const EMPTY_DATA = {
  period:  { start: '2026-06-01', end: '2026-06-30' },
  summary: { revenue: 0, cogs: 0, margin: 0, margin_pct: 0 },
  by_product:  [],
  by_category: [],
};

let marginPayload: unknown = MARGIN_DATA;
const mockRpc = vi.fn();

vi.mock('@/lib/supabase.js', () => {
  function build() {
    const chain = {
      select: () => chain,
      is:     () => chain,
      order:  () => Promise.resolve({ data: CATEGORY_ROWS, error: null }),
    };
    return chain;
  }
  return {
    supabase: {
      from: () => build(),
      rpc:  (fn: string, args: Record<string, unknown>) => {
        mockRpc(fn, args);
        if (fn === 'get_gross_margin_by_product_v1') {
          return Promise.resolve({ data: marginPayload, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      },
    },
  };
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><GrossMarginPage /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('GrossMarginPage smoke', () => {
  beforeEach(() => { mockRpc.mockReset(); marginPayload = MARGIN_DATA; });

  it('renders the page heading', () => {
    renderPage();
    expect(
      screen.getByRole('heading', { name: /Gross Margin/i, level: 1 }),
    ).toBeInTheDocument();
  });

  it('calls get_gross_margin_by_product_v1 with p_start_date and p_end_date', async () => {
    renderPage();
    await waitFor(() => {
      const call = mockRpc.mock.calls.find(([fn]) => fn === 'get_gross_margin_by_product_v1');
      expect(call).toBeDefined();
      const args = (call as [string, { p_start_date: string; p_end_date: string }])[1];
      expect(args.p_start_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(args.p_end_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  it('renders product rows sorted by margin desc', async () => {
    renderPage();
    await screen.findByText('Croissant');
    const table = screen.getByRole('table');
    const rows = within(table).getAllByRole('row');
    // rows[0] = thead ; rows[1] = highest margin (Croissant, 1.6M).
    expect(rows[1]?.textContent ?? '').toMatch(/Croissant/);
    expect(rows[2]?.textContent ?? '').toMatch(/Baguette/);
  });

  it('surfaces the WAC cost-basis caveat', async () => {
    renderPage();
    await screen.findByText('Croissant');
    expect(screen.getByText(/weighted-average cost/i)).toBeInTheDocument();
  });

  it('shows the CSV export trigger once data is available', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('export-csv')).toBeInTheDocument();
    });
  });

  it('renders the empty state when there are no sales', async () => {
    marginPayload = EMPTY_DATA;
    renderPage();
    expect(
      await screen.findByText(/No sales in the selected date range/i),
    ).toBeInTheDocument();
  });
});
