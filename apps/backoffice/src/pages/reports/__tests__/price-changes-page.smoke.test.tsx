// apps/backoffice/src/pages/reports/__tests__/price-changes-page.smoke.test.tsx
// S40 Wave B3 — Smoke test: PriceChangesPage renders heading, calls RPC, shows changes + CSV.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import PriceChangesPage from '@/pages/reports/PriceChangesPage.js';

// Mutable flag read by the rpc mock to switch between happy path and error path.
let simulateError = false;

vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    rpc: (fn: string) => {
      if (simulateError) {
        return Promise.resolve({ data: null, error: { message: 'RPC price changes error' } });
      }
      if (fn === 'get_price_changes_v1') {
        return Promise.resolve({
          data: {
            period:  { start: '2026-05-13', end: '2026-06-12' },
            changes: [
              {
                changed_at:   '2026-06-01T10:00:00Z',
                actor_name:   'Admin',
                product_id:   'p-1',
                product_name: 'Croissant',
                new_price:    25_000,
                old_price:    22_000,
                delta_pct:    13.6,
              },
              {
                changed_at:   '2026-06-02T11:00:00Z',
                actor_name:   'Manager',
                product_id:   'p-2',
                product_name: 'Baguette',
                new_price:    18_000,
                old_price:    null,
                delta_pct:    null,
              },
            ],
            truncated: false,
          },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    },
    // Product filter dropdown query via .from('products')
    from: () => ({
      select: () => ({
        is: () => ({
          eq: () => ({
            order: () => ({
              limit: () => Promise.resolve({ data: [], error: null }),
            }),
          }),
        }),
      }),
    }),
  },
}));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><PriceChangesPage /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('PriceChangesPage (smoke)', () => {
  beforeEach(() => { simulateError = false; });

  it('renders heading, change rows, first-recorded label, and CSV export once data loads', async () => {
    renderPage();
    expect(screen.getByRole('heading', { name: /Price Changes/i, level: 1 })).toBeInTheDocument();
    expect(await screen.findByText('Croissant')).toBeInTheDocument();
    expect(screen.getByText('Baguette')).toBeInTheDocument();
    // "first recorded" for null old_price
    expect(screen.getByText(/first recorded/i)).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId('export-csv')).toBeInTheDocument();
    });
    // No PDF export button (CSV-only page)
    expect(screen.queryByTestId('export-pdf')).toBeNull();
  });

  it('surfaces an error message when the RPC fails', async () => {
    simulateError = true;
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('RPC price changes error');
  });
});
